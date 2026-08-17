#!/usr/bin/env node
// sections.mjs -- split a SKILL.md into the addressable units that keep / drop /
// extract operate on.
//
// Deterministic. Read-only.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgv, fail } from './lib/args.mjs';
import { resolveSkill } from './lib/paths.mjs';
import { parseSections, countLines, estTokens } from './lib/md.mjs';

const USAGE = `Usage: node sections.mjs <skill-name-or-path> [options]

  --max-level <n>   Split at heading level n or shallower. Default: the shallowest
                    heading level below the document title, so a section absorbs
                    its own subheadings. Raise it when a section proves too coarse.
  --show <id>       Print one section's text verbatim and exit.
  --json            Emit JSON.
  --text            Include section text in JSON output.
`;

const argv = parseArgv(process.argv.slice(2), {
  string: ['max-level', 'show'],
  boolean: ['json', 'text', 'help'],
});
if (argv.help || argv._.length === 0) {
  process.stdout.write(USAGE);
  process.exit(argv.help ? 0 : 1);
}

const file = resolveSkill(argv._[0]);
if (!file) fail(`no skill found for ${JSON.stringify(argv._[0])}`);

const text = fs.readFileSync(file, 'utf8');
const maxLevel = argv['max-level'] ? Number(argv['max-level']) : null;
if (maxLevel !== null && !(maxLevel >= 1 && maxLevel <= 6)) fail('--max-level must be 1..6');

const { frontmatter, frontmatterText, splitLevel, sections } = parseSections(text, { maxLevel });

if (argv.show) {
  if (argv.show === 'fm') { process.stdout.write(`${frontmatterText}\n`); process.exit(0); }
  const s = sections.find((x) => x.id === argv.show || x.id.startsWith(`${argv.show}-`));
  if (!s) fail(`no section with id ${JSON.stringify(argv.show)}`);
  process.stdout.write(`${s.text}\n`);
  process.exit(0);
}

const fmRow = {
  id: 'fm',
  heading: 'frontmatter',
  level: 0,
  startLine: 1,
  endLine: countLines(frontmatterText),
  lines: countLines(frontmatterText),
  estTokens: estTokens(frontmatterText),
  kind: 'frontmatter',
  ablatable: false,
};

const rows = [fmRow, ...sections.map((s) => ({ ...s, ablatable: true }))];

if (argv.json) {
  process.stdout.write(`${JSON.stringify({
    skill: path.basename(path.dirname(file)),
    path: file,
    name: frontmatter.name ?? null,
    splitLevel,
    totalLines: countLines(text),
    sections: rows.map(({ text: t, ...rest }) => (argv.text ? { ...rest, text: t } : rest)),
  }, null, 2)}\n`);
  process.exit(0);
}

const w = (s, n) => String(s).padEnd(n);
const r = (s, n) => String(s).padStart(n);
const idW = Math.max(2, ...rows.map((x) => x.id.length));
const headW = Math.min(52, Math.max(7, ...rows.map((x) => (x.heading ?? '').length)));

process.stdout.write(`${file}\nsplit level: h${splitLevel}   ${countLines(text)} lines total\n\n`);
process.stdout.write(`${w('id', idW)} ${r('lvl', 3)} ${w('heading', headW)} ${r('lines', 6)} ${r('~tok', 6)} ${w('kind', 11)}\n`);
process.stdout.write(`${'-'.repeat(idW)} ${'-'.repeat(3)} ${'-'.repeat(headW)} ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(11)}\n`);
for (const x of rows) {
  const head = (x.heading ?? '(untitled)').slice(0, headW);
  process.stdout.write(`${w(x.id, idW)} ${r(x.level || '-', 3)} ${w(head, headW)} ${r(x.lines, 6)} ${r(x.estTokens, 6)} ${w(x.kind, 11)}${x.ablatable ? '' : '  [never ablatable]'}\n`);
}

const ablatable = rows.filter((x) => x.ablatable);
process.stdout.write(`\n${ablatable.length} ablatable section(s), ${ablatable.reduce((n, x) => n + x.lines, 0)} lines, ~${ablatable.reduce((n, x) => n + x.estTokens, 0)} tokens\n`);
process.stdout.write(`
kind orders the search; it never justifies a drop. The highest-value keep items --
verification steps, irreducible gotchas -- are pure prose, and a "code is payload"
prior protects exactly the blocks that should be extracted to a file instead.
Every drop needs run evidence, not a prior.
`);
