#!/usr/bin/env node
// labinit.mjs -- build the clean room.
//
// Deterministic. Writes only inside the lab.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgv, fail } from './lib/args.mjs';
import { resolveSkill, skillRoot } from './lib/paths.mjs';
import { splitFrontmatter, parseSections } from './lib/md.mjs';
import { writeManifest } from './lib/records.mjs';
import {
  defaultLabRoot, memoryLeaks, labPaths, seedConfig, copyTree, removeLab, LAB_MARKER,
} from './lib/lab.mjs';

const USAGE = `Usage: node labinit.mjs <skill-name-or-path> [options]

  --lab <dir>       Lab location. Default: <default-root>/<skill>.
  --model <id>      Model the loop will measure against. Recorded in manifest.json.
  --clean           Delete the lab first.
  --force           Build the lab even if ancestor CLAUDE.md files would leak in.

Default lab root: ${defaultLabRoot()}

The lab must not sit below any directory containing CLAUDE.md or
.claude/CLAUDE.md. The CLI walks the working directory's ancestors for those, so
such a lab silently inherits instructions the control and stub runs should not
see -- which contaminates every comparison, invisibly. On Windows that rules out
os.tmpdir(), which lives inside the home directory.

Note: <lab>/config/ receives a copy of your Claude credentials so headless runs
can authenticate. Permissions are restricted to you, and the lab should be
deleted when the loop is done.
`;

const argv = parseArgv(process.argv.slice(2), {
  string: ['lab', 'model'],
  boolean: ['clean', 'force', 'json', 'help'],
});
if (argv.help || argv._.length === 0) {
  process.stdout.write(USAGE);
  process.exit(argv.help ? 0 : 1);
}

const source = resolveSkill(argv._[0]);
if (!source) fail(`no skill found for ${JSON.stringify(argv._[0])}`);
const sourceDir = path.dirname(source);
const original = fs.readFileSync(source, 'utf8');
const { frontmatter } = splitFrontmatter(original);
const skill = frontmatter.name?.trim() || path.basename(sourceDir);

const lab = argv.lab
  ? path.resolve(process.cwd(), argv.lab)
  : path.join(defaultLabRoot(), skill);

if (argv.clean) { removeLab(lab); removeLab(labPaths(lab, skill).work); }

// Check for the leak before creating anything, so a refusal leaves no mess. The
// working directory is a sibling of the lab, so it shares the lab's ancestors and
// one check covers both.
fs.mkdirSync(lab, { recursive: true });
const leaks = memoryLeaks(lab);
if (leaks.length > 0) {
  if (!argv.force) {
    fail(`this lab would inherit instructions from outside it:
  ${leaks.join('\n  ')}

The CLI walks the working directory's ancestors for CLAUDE.md and
.claude/CLAUDE.md, and CLAUDE_CONFIG_DIR does not prevent it. Those files would
load into both the control and the stub runs, so every comparison would be made
against a contaminated baseline -- and nothing in the output would say so.

Pick a lab outside them:
  node labinit.mjs ${argv._[0]} --lab ${path.join(defaultLabRoot(), skill)}

Or pass --force to accept contaminated measurements.`);
  }
  process.stderr.write(`warning: proceeding with ${leaks.length} ancestor memory file(s) in scope (--force):\n  ${leaks.join('\n  ')}\n`);
}

// --------------------------------------------------------------------- layout

const P = labPaths(lab, skill);
for (const dir of [P.config, P.skillsrc, path.dirname(P.state), path.join(lab, 'control'),
                   path.join(lab, 'stub'), path.join(lab, 'iterations')]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(P.marker, `${new Date().toISOString()}\n`, 'utf8');

// A pristine copy of everything the skill ships. run.mjs assembles each run's
// working directory from this plus the current section subset, so nothing in the
// lab itself is ever a run's working directory -- see labPaths for why that
// distinction is load-bearing rather than cosmetic.
copyTree(sourceDir, P.skillsrc);
fs.rmSync(path.join(P.skillsrc, LAB_MARKER), { force: true });
fs.writeFileSync(P.pristine, original, 'utf8');

// Current state starts as the full original, which is what a control run needs.
fs.writeFileSync(P.state, original, 'utf8');

const configNotes = seedConfig(P.config);

if (!fs.existsSync(P.bar)) {
  const template = path.join(skillRoot(), 'references', 'bar-template.md');
  if (fs.existsSync(template)) fs.copyFileSync(template, P.bar);
  else fs.writeFileSync(P.bar, '# Bar\n\nSee references/bar-template.md.\n', 'utf8');
}

const { sections } = parseSections(original);
if (!fs.existsSync(P.tasks)) {
  fs.writeFileSync(P.tasks, `${JSON.stringify({
    skill,
    classification: 'TODO: deterministic | taste | mixed -- see references/classify.md',
    tasks: [
      {
        id: 'TODO-t1',
        workflow: 'which claim in the skill description this exercises',
        gotcha: null,
        prompt: 'The task, written as a user would ask for it.',
        assert: [],
      },
    ],
  }, null, 2)}\n`, 'utf8');
}

writeManifest(lab, {
  skill,
  source,
  sourceDir,
  created: new Date().toISOString(),
  model: argv.model ?? null,
  cliVersion: null,
  classification: null,
  leaksAccepted: leaks.length > 0 ? leaks : [],
  sections: sections.map(({ text, ...rest }) => rest),
  gotchas: [],
  // Control runs happen before stub.mjs is ever called, so the starting state is
  // recorded here: every run must be able to say which sections it saw.
  state: {
    label: 'original',
    kept: sections.map((s) => s.id),
    absent: [],
    at: new Date().toISOString(),
  },
  runs: [],
  iterations: [],
  grades: null,
  graderValidated: false,
});

// ---------------------------------------------------------------------- report

if (argv.json) {
  process.stdout.write(`${JSON.stringify({ lab, skill, paths: P, sections: sections.length, configNotes }, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`lab      ${lab}\nskill    ${skill} (${sections.length} ablatable sections)\n`);
process.stdout.write(`state    ${P.state}\nworkdir  ${P.work}  (rebuilt fresh for every run)\nconfig   ${P.config}\n`);
for (const n of configNotes) process.stdout.write(`         - ${n}\n`);
// Prefer a relative path only when it is actually shorter to read; a lab outside
// the home directory is usually many levels up from the current repo.
const show = (p) => {
  const rel = path.relative(process.cwd(), p);
  return rel.startsWith('..') ? p : rel;
};

process.stdout.write(`
Next:
  1. Classify the skill and inventory its gotchas   (references/classify.md)
  2. Write ${show(P.tasks)} to the coverage rule   (references/protocol.md)
  3. Write ${show(P.bar)} as success criteria, NOT as a description
     of the control output   (references/bar-template.md)
  4. Operator gate 1: review bar.md, tasks.json, and the gotcha inventory
  5. node scripts/run.mjs ${lab} --variant control --task <id> --reps 2

Delete the lab when done -- config/ holds a copy of your credentials.
`);
