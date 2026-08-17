#!/usr/bin/env node
// inventory.mjs -- enumerate skills and rank ablation targets by lines x usage.
//
// Deterministic. Read-only. Nothing here writes to a skill.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgv, fail } from './lib/args.mjs';
import { findSkillFiles, skillRoots, projectsDir } from './lib/paths.mjs';
import { fileMetrics, splitFrontmatter } from './lib/md.mjs';
import { usageCounts } from './lib/usage.mjs';

const USAGE = `Usage: node inventory.mjs [options]

  --root <path>   Additional skill root to scan (repeatable).
  --plugins       Also scan ~/.claude/plugins (vendor-maintained; re-pin, do not ablate).
  --top <n>       Show only the top N rows.
  --json          Emit JSON instead of a table.
  --no-usage      Skip the transcript scan (fast; ranks by lines alone).
  --quiet         Suppress progress output on stderr.

Extra roots may also be set in SKILL_ABLATION_ROOTS as a ${JSON.stringify(path.delimiter)}-separated list.
`;

const argv = parseArgv(process.argv.slice(2), {
  repeat: ['root'],
  string: ['top'],
  boolean: ['plugins', 'json', 'no-usage', 'quiet', 'help'],
});
if (argv.help) { process.stdout.write(USAGE); process.exit(0); }

const roots = skillRoots({ extra: argv.root, includePlugins: argv.plugins });
if (roots.length === 0) fail('no skill roots found. Pass --root <path>.');

// Collect skills, deduplicated by real path: linking a skill directory into
// ~/.claude/skills is a normal install, so the same file is often reachable from
// two roots. Counting it twice would inflate every total. The duplicate count is
// reported rather than swallowed, because a raw path count that disagrees with
// this one is otherwise baffling.
const bySource = new Map();
const aliases = [];
for (const root of roots) {
  const isPluginRoot = root.endsWith(`${path.sep}plugins`);
  for (const file of findSkillFiles(root, { requireSkillsSegment: isPluginRoot })) {
    let real;
    try { real = fs.realpathSync(file); } catch { continue; }
    const existing = bySource.get(real);
    if (existing) { aliases.push({ alias: file, canonical: existing.file }); continue; }
    bySource.set(real, { file, root, isPlugin: isPluginRoot, real });
  }
}

let counts = {};
let usageStats = null;
if (!argv['no-usage']) {
  const progress = argv.quiet ? null : (done, total) => {
    process.stderr.write(`\rscanning transcripts ${done}/${total}`);
  };
  const res = usageCounts({ progress });
  counts = res.counts;
  usageStats = res.stats;
  if (!argv.quiet) process.stderr.write('\r'.padEnd(40, ' ') + '\r');
}

const rows = [];
for (const { file, root, isPlugin } of bySource.values()) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const { frontmatter } = splitFrontmatter(text);
  const dirName = path.basename(path.dirname(file));
  const name = frontmatter.name?.trim() || dirName;
  const m = fileMetrics(text);
  const usage = argv['no-usage'] ? null : (counts[name] ?? counts[dirName] ?? 0);
  rows.push({
    name,
    path: file,
    root,
    isPlugin,
    ...m,
    usageCount: usage,
    rank: usage === null ? m.lines : m.lines * usage,
    pruneCandidate: usage === 0,
  });
}

rows.sort((a, b) => b.rank - a.rank || b.lines - a.lines || a.name.localeCompare(b.name));
const shown = argv.top ? rows.slice(0, Number(argv.top)) : rows;

// Distinct files sharing one skill name. Not the same as a link alias: these are
// separate copies that have drifted, which is a finding in its own right -- only
// one of them is the version that actually loads, and ablating the wrong copy
// changes nothing.
const nameGroups = new Map();
for (const r of rows) {
  if (!nameGroups.has(r.name)) nameGroups.set(r.name, []);
  nameGroups.get(r.name).push(r);
}
const duplicateNames = [...nameGroups.entries()]
  .filter(([, rs]) => rs.length > 1)
  .map(([name, rs]) => ({ name, copies: rs.map((r) => ({ path: r.path, lines: r.lines })) }));

const totals = {
  skills: rows.length,
  paths: rows.length + aliases.length,
  linkedDuplicates: aliases.length,
  duplicateNames: duplicateNames.length,
  lines: rows.reduce((n, r) => n + r.lines, 0),
  contentLines: rows.reduce((n, r) => n + r.contentLines, 0),
  estTokens: rows.reduce((n, r) => n + r.estTokens, 0),
  pruneCandidates: argv['no-usage'] ? null : rows.filter((r) => r.pruneCandidate).length,
};

if (argv.json) {
  process.stdout.write(`${JSON.stringify({
    roots, totals, usage: usageStats, transcriptRoot: projectsDir(),
    aliases, duplicateNames, skills: shown,
  }, null, 2)}\n`);
  process.exit(0);
}

const w = (s, n) => String(s).padEnd(n);
const r = (s, n) => String(s).padStart(n);
const nameW = Math.max(4, ...shown.map((x) => x.name.length));

process.stdout.write(`roots:\n${roots.map((x) => `  ${x}`).join('\n')}\n\n`);
process.stdout.write(`${w('skill', nameW)} ${r('lines', 6)} ${r('code', 5)} ${r('prose', 6)} ${r('pr%', 5)} ${r('~tok', 6)} ${r('used', 5)} ${r('rank', 8)}\n`);
process.stdout.write(`${'-'.repeat(nameW)} ${'-'.repeat(6)} ${'-'.repeat(5)} ${'-'.repeat(6)} ${'-'.repeat(5)} ${'-'.repeat(6)} ${'-'.repeat(5)} ${'-'.repeat(8)}\n`);
for (const x of shown) {
  process.stdout.write(`${w(x.name, nameW)} ${r(x.lines, 6)} ${r(x.codeLines, 5)} ${r(x.proseLines, 6)} ${r(Math.round(x.proseRatio * 100), 5)} ${r(x.estTokens, 6)} ${r(x.usageCount ?? '-', 5)} ${r(x.rank, 8)}\n`);
}

process.stdout.write(`\n${totals.skills} skills, ${totals.lines} lines (${totals.contentLines} non-blank), ~${totals.estTokens} tokens\n`);
if (totals.linkedDuplicates) {
  process.stdout.write(`${totals.paths} SKILL.md paths found; ${totals.linkedDuplicates} were the same file reached through a link and are counted once.\n`);
}
if (usageStats) {
  process.stdout.write(`transcripts: ${usageStats.files} files (${usageStats.parsed} parsed, ${usageStats.cached} cached), ${usageStats.invocations} skill invocations\n`);
}
if (duplicateNames.length) {
  process.stdout.write(`\n${duplicateNames.length} skill name(s) exist as more than one separate file:\n`);
  for (const d of duplicateNames) {
    process.stdout.write(`  ${d.name}\n`);
    for (const c of d.copies) process.stdout.write(`    ${String(c.lines).padStart(4)}l  ${c.path}\n`);
  }
  process.stdout.write(`\nOnly one copy of each is the one that loads, and the usage count shown is the
same for every copy because invocations are recorded by name. Work out which
copy is live before ablating anything -- editing a stale copy changes nothing,
and differing line counts above mean these have already drifted apart.\n`);
}
if (totals.pruneCandidates) {
  const names = rows.filter((x) => x.pruneCandidate).map((x) => x.name);
  process.stdout.write(`\n${totals.pruneCandidates} skill(s) with zero recorded invocations:\n  ${names.join(', ')}\n`);
  process.stdout.write(`\nThese are roster-prune candidates, not ablation targets. A skill's description
loads into every session's system prompt whether it is ever invoked or not, so
archiving an unused skill helps every session -- and is usually the single
largest win available. Ablating one you never call saves nothing.\n`);
}
