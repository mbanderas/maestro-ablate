#!/usr/bin/env node
// apply.mjs -- rebuild a SKILL.md from keep / drop / extract decisions.
//
// The only script here that writes to a skill. Everything about it is arranged
// so that a mistake is recoverable and a typo is loud.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgv, fail } from './lib/args.mjs';
import { resolveSkill } from './lib/paths.mjs';
import { parseSections, fileMetrics } from './lib/md.mjs';
import { writeApplyRecord } from './lib/records.mjs';

const USAGE = `Usage: node apply.mjs <skill-name-or-path> [options]

  --decisions <file>      JSON decision table (see references/static-rubric.md).
                          The normal path: it carries reasons and gotcha flags,
                          which the flags below cannot.
  --keep <ids>            Sections to keep verbatim. Comma/space separated,
                          repeatable, or the literal "all".
  --drop <ids>            Sections to delete. Optional: any ablatable section not
                          named by --keep or --extract is dropped anyway. Naming
                          them makes the intent explicit and is checked for
                          completeness.
  --extract <id>:<file>   Move a section body to references/<file>, leaving a
                          pointer. Repeatable.
  --max-level <n>         Section granularity; must match what you passed to
                          sections.mjs.
  --phase <A|B>           Recorded in the apply record. Default A.
  --model <id>            Model this was decided against. Recorded.
  --dry-run               Print what would change. Write nothing.
  --force                 Override the git guard and allow overwriting an
                          existing backup or reference file.

Preconditions: the skill must live in a git repository whose working tree is
clean for that skill's own files. Run "git init && git add -A && git commit" in
your skills directory first -- .bak files are a convenience, git is the rollback.
`;

const argv = parseArgv(process.argv.slice(2), {
  repeat: ['keep', 'drop', 'extract'],
  string: ['decisions', 'max-level', 'phase', 'model'],
  boolean: ['dry-run', 'force', 'json', 'help'],
});
if (argv.help || argv._.length === 0) {
  process.stdout.write(USAGE);
  process.exit(argv.help ? 0 : 1);
}

const file = resolveSkill(argv._[0]);
if (!file) fail(`no skill found for ${JSON.stringify(argv._[0])}`);
const skillDir = path.dirname(file);
const skill = path.basename(skillDir);

const BACKUP_NAME = 'SKILL.md.pre-ablation.bak';

// ------------------------------------------------------------------ git guard

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Refuse to rewrite a skill that has no rollback path.
 *
 * The check is scoped to the skill's own files rather than the whole repository.
 * What matters is that *this* skill can be restored from HEAD; an unrelated
 * uncommitted file elsewhere in a shared skills repo does not endanger that, and
 * refusing on it would make a batch static-audit pass impossible to run. The
 * wider repo state is reported as a warning so it is still visible.
 */
function checkGit() {
  let top;
  try {
    top = git(['rev-parse', '--show-toplevel'], skillDir);
  } catch {
    return { ok: false, reason: `${skillDir} is not inside a git repository` };
  }
  let porcelain;
  try {
    porcelain = git(['status', '--porcelain', '--'], top);
  } catch (e) {
    return { ok: false, reason: `git status failed: ${e.message}` };
  }
  const rel = path.relative(top, skillDir).split(path.sep).join('/');
  const entries = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  const dirty = entries.filter((line) => {
    const p = line.slice(3).replace(/^"|"$/g, '');
    // Our own backup does not endanger the rollback path, and treating it as dirt
    // would mean every second run on a skill demanded a commit of the .bak first.
    if (p.endsWith(BACKUP_NAME)) return false;
    return rel === '' || p.startsWith(`${rel}/`) || p === rel;
  });
  return { ok: dirty.length === 0, top, dirty, otherDirty: entries.length - dirty.length,
           reason: dirty.length ? `uncommitted changes under ${skillDir}:\n  ${dirty.join('\n  ')}` : null };
}

// The guard exists because this script rewrites files. --dry-run rewrites nothing,
// so requiring a rollback path for it would only stop people from looking before
// they commit -- which is the order you actually want. It still reports what the
// guard would have said, so the requirement is not a surprise later.
const gitState = checkGit();
if (!gitState.ok) {
  if (argv['dry-run']) {
    process.stderr.write(`note: ${gitState.reason}\n      --dry-run writes nothing, so this is not blocking. It will block a real run.\n`);
  } else if (!argv.force) {
    fail(`${gitState.reason}

This tool destructively rewrites SKILL.md files, and a skills directory
typically has no version control at all. Commit first so you can get back:

  cd ${gitState.top ?? skillDir}
  git init          # if needed
  git add -A
  git commit -m "chore: snapshot skills before ablation"

Then re-run. Use --force to proceed without a rollback path, or --dry-run to
preview without writing.`);
  } else {
    process.stderr.write(`warning: proceeding without a clean rollback point (--force)\n`);
  }
}
if (gitState.ok && gitState.otherDirty > 0) {
  process.stderr.write(`note: ${gitState.otherDirty} uncommitted change(s) elsewhere in ${gitState.top}; ${skill}'s own files are clean\n`);
}

// -------------------------------------------------------------------- parsing

const original = fs.readFileSync(file, 'utf8');
const maxLevel = argv['max-level'] ? Number(argv['max-level']) : null;
if (maxLevel !== null && !(maxLevel >= 1 && maxLevel <= 6)) fail('--max-level must be 1..6');
const { frontmatterText, sections } = parseSections(original, { maxLevel });
if (sections.length === 0) fail('no ablatable sections found; nothing to do');

const byId = new Map(sections.map((s) => [s.id, s]));

function splitIds(list) {
  return list.flatMap((v) => v.split(/[,\s]+/)).filter(Boolean);
}

/**
 * Resolve a user-supplied id.
 *
 * Accepts the full id, the bare number (`s03`), or the slug alone
 * (`payload-table`). The slug form matters because ids are numbered
 * sequentially: after one apply drops a section, everything below it renumbers,
 * so an id copied from a pre-apply listing will not match. Falling back to the
 * slug makes that survivable, and an unmatched or ambiguous id is a hard error
 * either way -- never a silently skipped decision.
 */
function lookup(id, where) {
  if (byId.has(id)) return byId.get(id);
  let matches = sections.filter((s) => s.id.startsWith(`${id}-`));
  if (matches.length === 0) {
    const slug = id.replace(/^s\d+-/, '');
    matches = sections.filter((s) => s.id.replace(/^s\d+-/, '') === slug);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fail(`${where}: id ${JSON.stringify(id)} is ambiguous (${matches.map((m) => m.id).join(', ')})`);
  fail(`${where}: no section with id ${JSON.stringify(id)}.\nKnown ids: ${sections.map((s) => s.id).join(', ')}`);
  return null; // unreachable
}

// Build the decision map. A decisions file and the flags may be combined; the
// flags win, so a one-off override does not require editing the file.
const decisions = new Map();
let phase = argv.phase ?? 'A';
let model = argv.model ?? null;

if (argv.decisions) {
  const p = path.resolve(process.cwd(), argv.decisions);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { fail(`could not read ${p}: ${e.message}`); }
  if (!Array.isArray(doc.decisions)) fail(`${p}: expected a "decisions" array`);
  phase = argv.phase ?? doc.phase ?? phase;
  model = argv.model ?? doc.model ?? model;
  for (const d of doc.decisions) {
    if (!d.id) fail(`${p}: a decision has no id`);
    if (!['keep', 'drop', 'extract'].includes(d.op)) fail(`${p}: ${d.id} has op ${JSON.stringify(d.op)}; expected keep, drop or extract`);
    const s = lookup(d.id, p);
    if (d.op === 'extract' && !d.file) fail(`${p}: ${d.id} is an extract with no "file"`);
    if (d.op === 'drop' && !d.reason) fail(`${p}: ${d.id} is a drop with no "reason". Every drop names a rubric category.`);
    if (d.op === 'drop' && d.gotcha === true && phase === 'A') {
      fail(`${p}: ${d.id} is marked gotcha:true and dropped in phase A.

A gotcha may only be dropped if a task built to trigger the failure it guards
passes without it, which a static audit cannot establish. See
references/classify.md. Change it to keep, or run the empirical loop.`);
    }
    decisions.set(s.id, { ...d, id: s.id });
  }
}

const keepIds = splitIds(argv.keep);
const keepAll = keepIds.includes('all');
if (keepAll) {
  for (const s of sections) decisions.set(s.id, { id: s.id, op: 'keep', reason: 'keep all' });
} else {
  for (const id of keepIds) {
    const s = lookup(id, '--keep');
    decisions.set(s.id, { id: s.id, op: 'keep' });
  }
}
for (const id of splitIds(argv.drop)) {
  const s = lookup(id, '--drop');
  decisions.set(s.id, { id: s.id, op: 'drop', reason: 'named on --drop' });
}
for (const spec of argv.extract) {
  const idx = spec.indexOf(':');
  if (idx === -1) fail(`--extract expects <id>:<file>, got ${JSON.stringify(spec)}`);
  const s = lookup(spec.slice(0, idx), '--extract');
  const target = spec.slice(idx + 1);
  if (!target) fail(`--extract ${spec}: empty filename`);
  decisions.set(s.id, { id: s.id, op: 'extract', file: target });
}

if (decisions.size === 0) fail('no decisions given. Pass --decisions, --keep, --drop or --extract.');

// Anything unmentioned is dropped -- but say so loudly, because a forgotten id
// deleting a section silently is the failure this warning exists to prevent.
const unmentioned = sections.filter((s) => !decisions.has(s.id));
for (const s of unmentioned) {
  decisions.set(s.id, { id: s.id, op: 'drop', reason: 'not named in any decision (implicit)' });
}

// --------------------------------------------------------------- reconstruction

const refsDir = path.join(skillDir, 'references');
const extractions = [];
const chunks = [];

// Chunks are joined with exactly one blank line between them, so each is trimmed
// of surrounding blank lines first. Leading newlines matter here: the preamble
// section begins with the blank line that followed the frontmatter, and keeping
// it would add a stray blank line on every rebuild -- including a rebuild that
// changes nothing, which should produce no diff at all.
const trim = (s) => s.replace(/^\n+/, '').replace(/\s+$/, '');

for (const s of sections) {
  const d = decisions.get(s.id);
  if (d.op === 'keep') {
    chunks.push(trim(s.text));
    continue;
  }
  if (d.op === 'drop') continue;

  // extract: keep the heading, replace the body with a pointer
  const rel = path.posix.join('references', d.file.replace(/\\/g, '/'));
  const headingLine = s.heading ? `${'#'.repeat(s.level)} ${s.heading}` : null;
  const bodyLines = s.text.split('\n');
  const body = (headingLine ? bodyLines.slice(1) : bodyLines).join('\n').replace(/^\s+|\s+$/g, '');
  const pointer = d.pointer ?? `Read \`${rel}\`${s.heading ? ` for ${s.heading.replace(/[`*]/g, '').toLowerCase()}` : ''}.`;
  chunks.push(trim([headingLine, '', pointer].filter((x) => x !== null).join('\n')));
  extractions.push({ id: s.id, heading: s.heading, rel, target: path.join(refsDir, d.file), body, lines: s.lines });
}

const rebuilt = `${[frontmatterText, chunks.join('\n\n')].join('\n\n').replace(/\s+$/, '')}\n`;

const beforeM = fileMetrics(original);
const afterM = fileMetrics(rebuilt);
const ops = { keep: 0, drop: 0, extract: 0 };
for (const s of sections) ops[decisions.get(s.id).op]++;

// ------------------------------------------------------------------- reporting

const w = (s, n) => String(s).padEnd(n);
const idW = Math.max(2, ...sections.map((s) => s.id.length));
process.stdout.write(`${file}\n\n`);
for (const s of sections) {
  const d = decisions.get(s.id);
  const note = d.op === 'extract' ? `-> references/${d.file}` : (d.reason ?? '');
  const flag = d.gotcha ? ' [gotcha]' : '';
  const conf = d.confidence && d.confidence !== 'high' ? ` (${d.confidence} confidence)` : '';
  process.stdout.write(`  ${w(d.op.toUpperCase(), 7)} ${w(s.id, idW)} ${String(s.lines).padStart(4)}l  ${note}${conf}${flag}\n`);
}
process.stdout.write(`\n  ${ops.keep} kept, ${ops.extract} extracted, ${ops.drop} dropped\n`);
process.stdout.write(`  ${beforeM.lines} -> ${afterM.lines} lines, ~${beforeM.estTokens} -> ~${afterM.estTokens} tokens\n`);

if (unmentioned.length) {
  process.stdout.write(`\nwarning: ${unmentioned.length} section(s) were dropped because no decision named them:\n  ${unmentioned.map((s) => s.id).join(', ')}\nIf that was not deliberate, re-run with those ids on --keep.\n`);
}

const gotchaDrops = sections.filter((s) => decisions.get(s.id).op === 'drop' && decisions.get(s.id).gotcha);
if (gotchaDrops.length) {
  process.stdout.write(`\nwarning: dropping ${gotchaDrops.length} section(s) marked as gotchas. Each needs a task built
to trigger the failure it guards, passing without it. See references/classify.md.\n`);
}

// A low-confidence drop with no run behind it is a guess. The rubric says to
// downgrade those to keep; if one gets here anyway, it should not slip past
// quietly into the operator's diff.
const thinDrops = sections.filter((s) => {
  const d = decisions.get(s.id);
  return d.op === 'drop' && d.confidence === 'low' && !(d.evidence?.length);
});
if (thinDrops.length) {
  process.stdout.write(`\nwarning: ${thinDrops.length} low-confidence drop(s) with no iteration evidence:
  ${thinDrops.map((s) => s.id).join(', ')}
These are the drops most likely to be wrong. Flag them for the operator to veto
individually, or keep them and let the empirical loop decide.\n`);
}

if (argv['dry-run']) {
  process.stdout.write(`\n--dry-run: nothing written.\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------- writing

const backup = path.join(skillDir, BACKUP_NAME);
if (fs.existsSync(backup) && !argv.force) {
  fail(`${backup} already exists.

That means this skill has been ablated before and the backup is from the earlier
original. Overwriting it with the current file would lose the true original.
Commit the current state and remove the backup, or pass --force.`);
}

for (const e of extractions) {
  if (fs.existsSync(e.target) && !argv.force) {
    fail(`${e.target} already exists. Choose another filename or pass --force.`);
  }
}

/** Write via a temp file in the same directory, then rename. */
function writeAtomic(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, target);
}

fs.copyFileSync(file, backup);
for (const e of extractions) {
  const header = e.heading ? `# ${e.heading}\n\n` : '';
  const note = `<!-- Extracted from ${skill}/SKILL.md by Maestro: Ablate. -->\n\n`;
  writeAtomic(e.target, `${header}${note}${e.body}\n`);
}
writeAtomic(file, rebuilt);

const recordFile = writeApplyRecord(skill, {
  skill,
  path: file,
  ts: new Date().toISOString(),
  phase,
  model,
  backup,
  maxLevel: maxLevel ?? null,
  before: beforeM,
  after: afterM,
  decisions: sections.map((s) => {
    const d = decisions.get(s.id);
    return {
      id: s.id, op: d.op, heading: s.heading ?? null, lines: s.lines,
      reason: d.reason ?? null, confidence: d.confidence ?? null,
      gotcha: d.gotcha ?? false,
      file: d.op === 'extract' ? path.posix.join('references', d.file.replace(/\\/g, '/')) : null,
      evidence: d.evidence ?? [],
    };
  }),
});

process.stdout.write(`\nwrote    ${file}\nbackup   ${backup}\n`);
for (const e of extractions) process.stdout.write(`extract  ${e.target}\n`);
process.stdout.write(`record   ${recordFile}\n`);
process.stdout.write(`\nNext: node scripts/report.mjs ${skill}\nRollback: git checkout -- ${path.relative(gitState.top ?? skillDir, file).split(path.sep).join('/')}\n`);
