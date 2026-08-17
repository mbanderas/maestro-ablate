#!/usr/bin/env node
// report.mjs -- before/after delta for one rebuild, plus the cumulative log.
//
// Deterministic. Read-only with respect to skills; the only thing it writes is
// its own log line.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgv, fail } from './lib/args.mjs';
import { resolveSkill } from './lib/paths.mjs';
import { fileMetrics } from './lib/md.mjs';
import { readApplyRecord, appendLog, readLog, readManifest, logPath } from './lib/records.mjs';

const USAGE = `Usage: node report.mjs <skill-name-or-path> [options]
       node report.mjs --cumulative

  --before <path>   File to treat as "before". Default: SKILL.md.pre-ablation.bak.
  --lab <dir>       Lab whose manifest.json supplies iteration evidence and grades.
  --model <id>      Model id this ablation was measured against.
  --phase <A|B>     A = static audit, B = empirical loop. Default: inferred.
  --cumulative      Print the cumulative log and the falsification check, then exit.
  --no-log          Do not append to the cumulative log.
  --json            Emit JSON.
`;

const argv = parseArgv(process.argv.slice(2), {
  string: ['before', 'lab', 'model', 'phase'],
  boolean: ['cumulative', 'no-log', 'json', 'help'],
});
if (argv.help) { process.stdout.write(USAGE); process.exit(0); }

// ---------------------------------------------------------------- cumulative

function pct(n, d) {
  return d === 0 ? 0 : Number(((n / d) * 100).toFixed(1));
}

if (argv.cumulative) {
  const log = readLog();
  if (log.length === 0) fail(`no entries in ${logPath()}`);

  const totals = log.reduce((a, e) => ({
    lines: a.lines + (e.reduction?.lines ?? 0),
    estTokens: a.estTokens + (e.reduction?.estTokens ?? 0),
    better: a.better + (e.grades?.better ?? 0),
    tie: a.tie + (e.grades?.tie ?? 0),
    worse: a.worse + (e.grades?.worse ?? 0),
  }), { lines: 0, estTokens: 0, better: 0, tie: 0, worse: 0 });

  if (argv.json) {
    process.stdout.write(`${JSON.stringify({ entries: log.length, totals, log }, null, 2)}\n`);
    process.exit(0);
  }

  process.stdout.write(`${logPath()}\n${log.length} rebuild(s) recorded\n\n`);
  const nameW = Math.max(5, ...log.map((e) => String(e.skill).length));
  process.stdout.write(`${'skill'.padEnd(nameW)}  ph  ${'lines'.padStart(13)}  ${'d~tok'.padStart(9)}  model\n`);
  process.stdout.write(`${'-'.repeat(nameW)}  --  ${'-'.repeat(13)}  ${'-'.repeat(9)}  -----\n`);
  for (const e of log) {
    const b = e.before?.lines ?? 0;
    const a = e.after?.lines ?? 0;
    process.stdout.write(`${String(e.skill).padEnd(nameW)}  ${e.phase ?? '?'}   ${`${b}->${a}`.padStart(13)}  ${String(-(e.reduction?.estTokens ?? 0)).padStart(9)}  ${e.model ?? '-'}\n`);
  }
  process.stdout.write(`\ncumulative: ${totals.lines} lines removed, ~${totals.estTokens} tokens\n`);

  const graded = totals.better + totals.tie + totals.worse;
  process.stdout.write(`\nfalsification check\n`);
  if (graded === 0) {
    process.stdout.write(`  No pairwise grades recorded yet. Until some are, every reduction here is
  unverified: the log shows tokens removed, not quality held.\n`);
  } else {
    process.stdout.write(`  pairwise rebuilt-vs-original: ${totals.better} better, ${totals.tie} tie, ${totals.worse} worse (n=${graded})\n`);
    if (totals.better === 0) {
      process.stdout.write(`
  Rebuilt skills have never beaten their originals in the lab. That is the
  expected result if the only benefit is reduced context pressure -- which the
  clean room cannot observe. It is also what a broken harness looks like. Do not
  read ties as vindication; read them as "no harm measured, benefit unproven".\n`);
    }
  }
  process.exit(0);
}

// ------------------------------------------------------------- single rebuild

if (argv._.length === 0) { process.stdout.write(USAGE); process.exit(1); }

const after = resolveSkill(argv._[0]);
if (!after) fail(`no skill found for ${JSON.stringify(argv._[0])}`);
const skillDir = path.dirname(after);
const skill = path.basename(skillDir);

const beforePath = argv.before
  ? path.resolve(process.cwd(), argv.before)
  : path.join(skillDir, 'SKILL.md.pre-ablation.bak');
if (!fs.existsSync(beforePath)) {
  fail(`no "before" file at ${beforePath}. Pass --before <path>.`);
}

const beforeM = fileMetrics(fs.readFileSync(beforePath, 'utf8'));
const afterM = fileMetrics(fs.readFileSync(after, 'utf8'));
const reduction = {
  lines: beforeM.lines - afterM.lines,
  contentLines: beforeM.contentLines - afterM.contentLines,
  estTokens: beforeM.estTokens - afterM.estTokens,
  percentLines: pct(beforeM.lines - afterM.lines, beforeM.lines),
  percentTokens: pct(beforeM.estTokens - afterM.estTokens, beforeM.estTokens),
};

const applyRecord = readApplyRecord(skill);
const manifest = argv.lab ? readManifest(path.resolve(process.cwd(), argv.lab)) : null;

// Evidence for a drop is the set of iteration ids in which the section was
// absent and no task failed. A drop with no such iteration is not evidenced --
// it is a guess, and the report says so rather than averaging it away.
const evidenceById = new Map();
if (manifest?.iterations) {
  for (const it of manifest.iterations) {
    const passed = it.result === 'pass' || it.grade === 'better' || it.grade === 'tie';
    if (!passed) continue;
    for (const id of it.absent ?? []) {
      if (!evidenceById.has(id)) evidenceById.set(id, []);
      evidenceById.get(id).push(it.id);
    }
  }
}

const decisions = (applyRecord?.decisions ?? []).map((d) => {
  const fromManifest = evidenceById.get(d.id) ?? [];
  const evidence = d.evidence?.length ? d.evidence : fromManifest;
  return { ...d, evidence };
});

const dropped = decisions.filter((d) => d.op === 'drop');
const extracted = decisions.filter((d) => d.op === 'extract');
const unverifiedDrops = dropped.filter((d) => d.evidence.length === 0).map((d) => d.id);

const phase = argv.phase ?? applyRecord?.phase ?? (manifest ? 'B' : 'A');

let cliVersion = manifest?.cliVersion ?? null;
if (!cliVersion) {
  try {
    cliVersion = execFileSync('claude', ['--version'], {
      encoding: 'utf8', timeout: 10_000, shell: process.platform === 'win32',
    }).trim();
  } catch { cliVersion = null; }
}

const grades = manifest?.grades ?? countGrades(manifest);
function countGrades(m) {
  if (!m?.iterations) return null;
  const g = { better: 0, tie: 0, worse: 0 };
  for (const it of m.iterations) if (it.grade in g) g[it.grade]++;
  return g.better + g.tie + g.worse > 0 ? g : null;
}

const entry = {
  ts: new Date().toISOString(),
  skill,
  path: after,
  phase,
  model: argv.model ?? manifest?.model ?? applyRecord?.model ?? null,
  cliVersion,
  before: beforeM,
  after: afterM,
  reduction,
  decisions: decisions.map((d) => ({ id: d.id, op: d.op, heading: d.heading ?? null, lines: d.lines ?? null, file: d.file ?? null, evidence: d.evidence })),
  grades,
  unverifiedDrops,
};

let logged = null;
if (!argv['no-log']) logged = appendLog(entry);

if (argv.json) {
  process.stdout.write(`${JSON.stringify({ ...entry, logFile: logged }, null, 2)}\n`);
  process.exit(0);
}

const arrow = (a, b, label) => `  ${label.padEnd(14)} ${String(a).padStart(7)} -> ${String(b).padStart(7)}   ${String(-(a - b)).padStart(7)}\n`;
process.stdout.write(`${skill}   phase ${phase}${entry.model ? `   model ${entry.model}` : ''}${cliVersion ? `   cli ${cliVersion}` : ''}\n`);
process.stdout.write(`before: ${beforePath}\nafter:  ${after}\n\n`);
process.stdout.write(arrow(beforeM.lines, afterM.lines, 'lines'));
process.stdout.write(arrow(beforeM.contentLines, afterM.contentLines, 'non-blank'));
process.stdout.write(arrow(beforeM.estTokens, afterM.estTokens, '~tokens'));
process.stdout.write(`\n  ${reduction.percentLines}% of lines removed, ${reduction.percentTokens}% of estimated tokens\n`);

if (!applyRecord) {
  process.stdout.write(`\nNo apply record found for this skill, so the per-section breakdown below is
empty. The totals above are still accurate; the attribution is not available.\n`);
}

if (extracted.length) {
  process.stdout.write(`\nextracted (${extracted.length}) -- payload moved to a file, still available on demand:\n`);
  for (const d of extracted) {
    process.stdout.write(`  ${d.id.padEnd(30)} -> ${d.file ?? '?'}${d.lines ? `  (${d.lines} lines)` : ''}\n`);
  }
}

if (dropped.length) {
  process.stdout.write(`\ndropped (${dropped.length}):\n`);
  for (const d of dropped) {
    const ev = d.evidence.length ? d.evidence.join(', ') : 'NO ITERATION EVIDENCE';
    process.stdout.write(`  ${d.id.padEnd(30)} ${d.lines ? `${String(d.lines).padStart(4)} lines  ` : ''}${ev}\n`);
  }
}

if (unverifiedDrops.length) {
  process.stdout.write(`
${unverifiedDrops.length} drop(s) cite no iteration in which the section was absent and nothing
failed. In phase A that is expected -- a static audit reasons about a section, it
does not test it -- but it means these cuts are unverified and belong in the
operator review, not in the "measured" column:
  ${unverifiedDrops.join(', ')}\n`);
}

if (grades) {
  process.stdout.write(`\npairwise grades: ${grades.better} better, ${grades.tie} tie, ${grades.worse} worse\n`);
} else {
  process.stdout.write(`\nNo pairwise grades recorded. This rebuild shows tokens removed, not quality held.\n`);
}

if (logged) process.stdout.write(`\nappended to ${logged}\n`);
