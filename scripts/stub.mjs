#!/usr/bin/env node
// stub.mjs -- set the lab copy of the skill to a chosen subset of its sections.
//
// With no --keep, that subset is empty and the result is the frontmatter-only
// stub the baseline comparison needs. With --keep, it is the add-back state for
// one iteration. Same operation either way, which is why one script owns both:
// a stub built one way and an iteration built another would not be comparable.
//
// Deterministic. Refuses to write anywhere but inside a lab.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgv, fail } from './lib/args.mjs';
import { splitFrontmatter, parseSections, fileMetrics } from './lib/md.mjs';
import { isLab, labPaths } from './lib/lab.mjs';
import { readManifest, writeManifest } from './lib/records.mjs';

const USAGE = `Usage: node stub.mjs <lab> [options]

  --keep <ids>   Sections to include. Comma/space separated, repeatable, or
                 "all" to restore the full original. Omit for a bare stub.
  --label <s>    Label recorded in manifest.json for this state.
  --dry-run      Print what would be written; write nothing.

Frontmatter is always reproduced verbatim. Emptying "description" would stop the
skill firing at all, and every task would then fail for a reason that has nothing
to do with the section under test.
`;

const argv = parseArgv(process.argv.slice(2), {
  repeat: ['keep'],
  string: ['label'],
  boolean: ['dry-run', 'json', 'help'],
});
if (argv.help || argv._.length === 0) {
  process.stdout.write(USAGE);
  process.exit(argv.help ? 0 : 1);
}

const lab = path.resolve(process.cwd(), argv._[0]);
if (!isLab(lab)) {
  fail(`${lab} is not a skill-ablation lab.

This script rewrites a SKILL.md, so it only ever writes inside a lab built by
labinit.mjs. Pointing it at a real skill directory would empty the skill you are
trying to measure.`);
}

const manifest = readManifest(lab);
if (!manifest?.skill) fail(`${lab}/manifest.json is missing or has no "skill"`);
const P = labPaths(lab, manifest.skill);

if (!fs.existsSync(P.pristine)) fail(`no pristine copy at ${P.pristine}; re-run labinit.mjs`);
const original = fs.readFileSync(P.pristine, 'utf8');
const { frontmatterText } = splitFrontmatter(original);
const { sections } = parseSections(original, { maxLevel: manifest.maxLevel ?? null });

const requested = argv.keep.flatMap((v) => v.split(/[,\s]+/)).filter(Boolean);
const keepAll = requested.includes('all');

const byId = new Map(sections.map((s) => [s.id, s]));
const keep = new Set();
if (keepAll) {
  for (const s of sections) keep.add(s.id);
} else {
  for (const id of requested) {
    let s = byId.get(id);
    if (!s) {
      const matches = sections.filter((x) => x.id.startsWith(`${id}-`)
        || x.id.replace(/^s\d+-/, '') === id.replace(/^s\d+-/, ''));
      if (matches.length > 1) fail(`--keep: id ${JSON.stringify(id)} is ambiguous (${matches.map((m) => m.id).join(', ')})`);
      if (matches.length === 0) fail(`--keep: no section with id ${JSON.stringify(id)}.\nKnown ids: ${sections.map((x) => x.id).join(', ')}`);
      [s] = matches;
    }
    keep.add(s.id);
  }
}

const chunks = sections.filter((s) => keep.has(s.id))
  .map((s) => s.text.replace(/^\n+/, '').replace(/\s+$/, ''));
const content = `${[frontmatterText, ...chunks].join('\n\n').replace(/\s+$/, '')}\n`;

const absent = sections.filter((s) => !keep.has(s.id)).map((s) => s.id);
const m = fileMetrics(content);
const label = argv.label ?? (keepAll ? 'original' : keep.size === 0 ? 'stub' : `keep-${[...keep].join('+')}`);

if (argv.json) {
  process.stdout.write(`${JSON.stringify({
    lab, skill: manifest.skill, label, kept: [...keep], absent, metrics: m,
    target: P.state, dryRun: Boolean(argv['dry-run']),
  }, null, 2)}\n`);
} else {
  process.stdout.write(`${P.state}\nstate    ${label}\nkept     ${keep.size ? [...keep].join(', ') : '(none -- bare stub)'}\n`);
  process.stdout.write(`absent   ${absent.length ? absent.join(', ') : '(none)'}\n`);
  process.stdout.write(`size     ${m.lines} lines, ~${m.estTokens} tokens\n`);
}

if (argv['dry-run']) {
  if (!argv.json) process.stdout.write('\n--dry-run: nothing written.\n');
  process.exit(0);
}

// Written to the lab's state file, not to a working directory: run.mjs assembles
// a fresh working directory from this for every run.
fs.mkdirSync(path.dirname(P.state), { recursive: true });
const tmp = `${P.state}.tmp-${process.pid}`;
fs.writeFileSync(tmp, content, 'utf8');
fs.renameSync(tmp, P.state);

// The current state is recorded so run.mjs can stamp every run with the exact
// section set it was made against. A run whose section set is unknown is a run
// that cannot be used as evidence.
writeManifest(lab, {
  ...manifest,
  state: { label, kept: [...keep], absent, metrics: m, at: new Date().toISOString() },
});

if (!argv.json) process.stdout.write('\nwrote the lab state. The original skill was not touched.\n');
