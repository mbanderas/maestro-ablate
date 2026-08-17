#!/usr/bin/env node
// run.mjs -- the only path by which anything in this skill starts a `claude`
// process.
//
// That rule is the whole point of the script. Environment setup improvised per
// run drifts across forty iterations, and drift invalidates every comparison
// made across them. Trials, grading and the positive-control gate all go through
// here so that every result in a lab was produced the same way.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgv, fail } from './lib/args.mjs';
import { isLab, labPaths, readTasks, memoryLeaks, prepareWork, copyTree, removeLab } from './lib/lab.mjs';
import { readManifest, writeManifest } from './lib/records.mjs';
import { runClaude, cliVersion, findTranscript, skillFired, DEFAULT_TIMEOUT_MS } from './lib/claude.mjs';

const USAGE = `Usage: node run.mjs <lab> --variant control|stub|iter --task <id> [--rep <n>]
       node run.mjs <lab> --grade --a <run-dir> --b <run-dir>
       node run.mjs <lab> --validate-grader --run <run-dir>
       node run.mjs <lab> --gate

  --variant <v>       control | stub | iter
  --task <id>         Task id from tasks.json.
  --rep <n>           Repetition number. Default 1.
  --reps <n>          Run repetitions 1..n in sequence.
  --iter <label>      Iteration label; required for --variant iter.
  --model <id>        Model to run against. Default: manifest, else CLI default.
  --timeout <ms>      Per-run timeout. Default ${DEFAULT_TIMEOUT_MS}.
  --grade             Blind pairwise grade of two completed runs against bar.md.
  --validate-grader   Grade a real output against a degraded copy of it; the
                      grader must prefer the real one.
  --gate              Check the positive controls over everything recorded so far.
  --json              Emit JSON.

In the task prompt, {{OUT}} is replaced with this run's own output directory, so
tasks that produce files can be asserted per run.
`;

const argv = parseArgv(process.argv.slice(2), {
  string: ['variant', 'task', 'rep', 'reps', 'iter', 'model', 'timeout', 'a', 'b', 'run'],
  boolean: ['grade', 'validate-grader', 'gate', 'json', 'help'],
});
if (argv.help || argv._.length === 0) {
  process.stdout.write(USAGE);
  process.exit(argv.help ? 0 : 1);
}

const lab = path.resolve(process.cwd(), argv._[0]);
if (!isLab(lab)) fail(`${lab} is not an ablate lab. Run labinit.mjs first.`);
const manifest = readManifest(lab);
if (!manifest?.skill) fail(`${lab}/manifest.json is missing or has no "skill"`);
const P = labPaths(lab, manifest.skill);
const model = argv.model ?? manifest.model ?? null;
const timeoutMs = argv.timeout ? Number(argv.timeout) : DEFAULT_TIMEOUT_MS;

function save(patch) {
  writeManifest(lab, { ...readManifest(lab), ...patch });
}

function appendRun(record) {
  const m = readManifest(lab);
  save({ runs: [...(m.runs ?? []), record], cliVersion: m.cliVersion ?? cliVersion() });
}

// ------------------------------------------------------------------ assertions

function evaluateAsserts(task, runDir, output) {
  const results = [];
  for (const a of task.assert ?? []) {
    let pass = false;
    let detail = '';
    const target = a.file ? path.resolve(runDir, a.file) : null;
    switch (a.type) {
      case 'contains':
        pass = output.includes(a.value); detail = a.value; break;
      case 'not-contains':
        pass = !output.includes(a.value); detail = a.value; break;
      case 'regex':
        try { pass = new RegExp(a.value, a.flags ?? '').test(output); } catch (e) { detail = e.message; }
        detail ||= a.value; break;
      case 'min-length':
        pass = output.length >= Number(a.value); detail = `${output.length} >= ${a.value}`; break;
      case 'file-exists':
        pass = Boolean(target) && fs.existsSync(target); detail = a.file; break;
      case 'file-contains':
        pass = Boolean(target) && fs.existsSync(target) && fs.readFileSync(target, 'utf8').includes(a.value);
        detail = `${a.file}: ${a.value}`; break;
      case 'json-valid':
        try { JSON.parse(fs.readFileSync(target, 'utf8')); pass = true; } catch (e) { detail = e.message; }
        detail ||= a.file; break;
      default:
        detail = `unknown assertion type ${JSON.stringify(a.type)}`;
    }
    results.push({ ...a, pass, detail });
  }
  const checked = results.length > 0;
  return { checks: results, checked, passed: checked ? results.every((r) => r.pass) : null };
}

// ------------------------------------------------------------------- trial run

const FORCED_INVOCATION = (skill) => `Use the ${skill} skill for this. Invoke it with the Skill tool before doing anything else, then carry out the request below.

`;

async function trial({ variant, task, rep, iterLabel }) {
  const dir = variant === 'iter'
    ? path.join(lab, 'iterations', iterLabel, task.id, String(rep))
    : path.join(lab, variant, task.id, String(rep));
  fs.mkdirSync(dir, { recursive: true });

  // A working directory built from nothing, for this run alone. Every run gets its
  // own, and it is destroyed afterwards, so no run can find another run's output
  // or the pristine copy of the skill it is being tested without.
  prepareWork(lab, manifest.skill);
  const state = readManifest(lab).state ?? null;

  // Forced invocation removes trigger variance from the measurement. Without it a
  // failure could mean "the skill did not fire this time", which is a different
  // finding from "the skill fired and its body was insufficient".
  const body = task.prompt.split('{{OUT}}').join(P.workOut);
  const prompt = FORCED_INVOCATION(manifest.skill) + body;
  fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt, 'utf8');

  const res = await runClaude({
    cwd: P.work, config: P.config, prompt, model, timeoutMs,
    extraArgs: task.tools ? ['--tools', task.tools] : [],
  });
  fs.writeFileSync(path.join(dir, 'stdout.txt'), res.stdout ?? '', 'utf8');
  fs.writeFileSync(path.join(dir, 'stderr.txt'), res.stderr ?? '', 'utf8');
  fs.writeFileSync(path.join(dir, 'output.txt'), res.result ?? '', 'utf8');

  const transcript = findTranscript(P.config, res.sessionId);
  if (transcript) fs.copyFileSync(transcript, path.join(dir, 'transcript.jsonl'));
  const fired = skillFired(transcript, manifest.skill);

  // Assertions run against the working output directory, then the files are moved
  // into the lab as evidence and the working directory is destroyed.
  const asserts = evaluateAsserts(task, P.workOut, res.result ?? '');
  const files = path.join(dir, 'files');
  fs.rmSync(files, { recursive: true, force: true });
  copyTree(P.workOut, files);
  removeLab(P.work);

  const record = {
    variant,
    task: task.id,
    rep: Number(rep),
    iter: iterLabel ?? null,
    dir,
    at: new Date().toISOString(),
    model,
    cliVersion: cliVersion(),
    stateLabel: state?.label ?? null,
    sectionsPresent: state?.kept ?? null,
    sectionsAbsent: state?.absent ?? null,
    ok: res.ok,
    error: res.error ?? null,
    exitCode: res.code,
    ms: res.ms,
    costUsd: res.costUsd,
    skillFired: fired.fired,
    skillsInvoked: fired.invoked,
    configRedirected: Boolean(transcript),
    asserts,
    result: asserts.passed === null ? null : (asserts.passed ? 'pass' : 'fail'),
  };
  fs.writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  appendRun(record);
  return record;
}

// -------------------------------------------------------------------- grading

const GRADE_PROMPT = (bar, a, b) => `You are grading two candidate outputs for the same task. Judge only against the criteria below. You do not know which candidate came from which system, and it does not matter.

=== SUCCESS CRITERIA ===
${bar}

=== CANDIDATE A ===
${a}

=== CANDIDATE B ===
${b}

=== INSTRUCTIONS ===
Decide which candidate better satisfies the criteria. Reply with ONLY a JSON object, no prose and no code fence:
{"winner": "A" | "B" | "tie", "confidence": "high" | "medium" | "low", "reason": "<one sentence>", "criteria_missed": {"A": ["..."], "B": ["..."]}}

Judge substance against the criteria, not length, formatting or tone. If both satisfy the criteria equally, say "tie" -- a tie is a real answer, not a failure to decide.`;

function readOutput(dir) {
  const p = path.join(path.resolve(process.cwd(), dir), 'output.txt');
  if (!fs.existsSync(p)) fail(`no output.txt in ${dir}; run the trial first`);
  return fs.readFileSync(p, 'utf8');
}

/**
 * Blind pairwise grading in a fresh context.
 *
 * Fresh, because the context that produced an output cannot judge it. Blind and
 * side-randomised, because a grader told which candidate is the rebuild will
 * find reasons. Pairwise rather than absolute, because absolute scores drift
 * between calls and a drifting scale cannot detect a small regression.
 */
async function grade({ aDir, bDir, label = 'grade' }) {
  const bar = fs.existsSync(P.bar) ? fs.readFileSync(P.bar, 'utf8') : null;
  if (!bar) fail(`no bar.md in ${lab}. Grading against no criteria measures whether the output changed, not whether it is good.`);
  const aText = readOutput(aDir);
  const bText = readOutput(bDir);

  const flip = Math.random() < 0.5;
  const first = flip ? bText : aText;
  const second = flip ? aText : bText;
  const prompt = GRADE_PROMPT(bar, first, second);

  // The grader gets no tools. Both candidates are already in the prompt, so it has
  // no legitimate use for the filesystem -- and given one it will use it: the first
  // version of this ran with tools available and the grader went and read the lab,
  // worked out which candidate came from the control directory, and cited the run
  // logs in its reasoning. A grader that can identify the candidates is not blind,
  // and a grading that is not blind is not evidence.
  const { graderCwd } = P;
  removeLab(graderCwd);
  fs.mkdirSync(graderCwd, { recursive: true });
  fs.writeFileSync(path.join(graderCwd, 'CLAUDE.md'), 'No project instructions.\n', 'utf8');

  const res = await runClaude({
    cwd: graderCwd, config: P.config, prompt, model, timeoutMs, extraArgs: ['--tools', ''],
  });
  removeLab(graderCwd);
  let verdict = null;
  try { verdict = JSON.parse((res.result ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* reported below */ }

  // Un-blind: map the grader's A/B back onto the real inputs.
  let winner = 'unparsed';
  if (verdict?.winner === 'tie') winner = 'tie';
  else if (verdict?.winner === 'A') winner = flip ? 'b' : 'a';
  else if (verdict?.winner === 'B') winner = flip ? 'a' : 'b';

  const record = {
    kind: label,
    at: new Date().toISOString(),
    a: path.resolve(process.cwd(), aDir),
    b: path.resolve(process.cwd(), bDir),
    presentedFirst: flip ? 'b' : 'a',
    winner,
    confidence: verdict?.confidence ?? null,
    reason: verdict?.reason ?? null,
    raw: res.result ?? null,
    ok: res.ok && Boolean(verdict),
    costUsd: res.costUsd,
  };
  const m = readManifest(lab);
  save({ grades_log: [...(m.grades_log ?? []), record] });
  return record;
}

// ------------------------------------------------------------ grader validation

/**
 * Validate the grader against a planted regression before its verdicts count.
 *
 * The degraded copy keeps the first third of the output and truncates the rest,
 * which is a real loss of substance rather than a cosmetic edit. A grader that
 * cannot see that is not measuring anything, and it will pass every comparison
 * it is shown afterwards.
 */
async function validateGrader(runDir) {
  const src = path.resolve(process.cwd(), runDir);
  const text = readOutput(src);
  if (text.trim().length < 200) {
    fail(`${src}/output.txt is too short (${text.trim().length} chars) to degrade meaningfully. Validate the grader on a substantial output.`);
  }
  const degradedDir = path.join(lab, 'grader-validation');
  fs.mkdirSync(degradedDir, { recursive: true });
  const cut = Math.max(120, Math.floor(text.length / 3));
  fs.writeFileSync(path.join(degradedDir, 'output.txt'), `${text.slice(0, cut).trimEnd()}\n`, 'utf8');

  const record = await grade({ aDir: src, bDir: degradedDir, label: 'grader-validation' });
  const caught = record.winner === 'a';
  save({ graderValidated: caught, graderValidation: { ...record, caught } });
  return { ...record, caught };
}

// -------------------------------------------------------------- positive gate

/**
 * The positive controls, checked mechanically.
 *
 * Every other trap in the method assumes the experiment ran at all. These three
 * are what establish that, and they are blocking on purpose: a harness that
 * silently measures nothing produces a confident, wrong, and very tidy result.
 */
function gate() {
  const m = readManifest(lab);
  const runs = m.runs ?? [];
  const findings = [];
  const controls = runs.filter((r) => r.variant === 'control');
  const stubs = runs.filter((r) => r.variant === 'stub');

  // 1a. A stub must actually be a stub. This is the check that catches a "stub"
  // that has been made resolvable to the original -- by a mislabelled --keep, or
  // by the state file being rebuilt between runs. Nothing else would notice: the
  // runs pass, and passing stub runs read as "the body was never needed".
  const notEmpty = stubs.filter((r) => Array.isArray(r.sectionsPresent) && r.sectionsPresent.length > 0);
  if (stubs.length > 0) {
    findings.push(notEmpty.length === 0
      ? ['PASS', 'stub-is-empty', `all ${stubs.length} stub run(s) ran against a frontmatter-only skill`]
      : ['FAIL', 'stub-is-empty', `${notEmpty.length}/${stubs.length} stub run(s) had sections present, so they were not stub runs: `
        + `${[...new Set(notEmpty.map((r) => r.dir))].join(', ')}. `
        + `Their results are on record and would read as stub evidence. Discard them: delete those directories and their entries from manifest.json "runs", or rebuild the lab with labinit --clean. This stays failing until they are gone, deliberately.`]);
  }

  // 1b. The current stub state must fail at least one task.
  //
  // Scoped to the most recent stub state on purpose. A failure recorded against
  // some earlier state says nothing about this one, and letting old failures
  // satisfy the control is how a broken stub slips through.
  if (stubs.length === 0) {
    findings.push(['PENDING', 'stub-fails', 'no stub runs recorded yet']);
  } else {
    const sig = (r) => `${r.stateLabel ?? '?'}|${(r.sectionsPresent ?? []).join('+')}`;
    const latest = sig(stubs[stubs.length - 1]);
    const current = stubs.filter((r) => sig(r) === latest);
    const failed = current.filter((r) => r.result === 'fail' || r.ok === false);
    const scope = `${failed.length}/${current.length} run(s) in the current stub state`;
    if (failed.length > 0) {
      findings.push(['PASS', 'stub-fails', `${scope} failed, as they must`]);
    } else {
      const anyChecked = current.some((r) => r.asserts?.checked);
      findings.push(['FAIL', 'stub-fails', anyChecked
        ? `every run in the current stub state (${latest}) passed. A skill stripped to its frontmatter cannot do its job, so this means the harness is measuring nothing -- not that the body is worthless. Check that the state really is a bare stub, that the skill fired, and that the tasks are hard enough to need it.`
        : 'no run in the current stub state has any assertion to fail. Add assertions, or grade the stub runs, before treating anything as evidence.']);
    }
  }

  // 2. The control transcript must show the skill fired.
  if (controls.length === 0) {
    findings.push(['PENDING', 'skill-fired', 'no control runs recorded yet']);
  } else {
    const notFired = controls.filter((r) => !r.skillFired);
    findings.push(notFired.length === 0
      ? ['PASS', 'skill-fired', `all ${controls.length} control run(s) show ${m.skill} firing`]
      : ['FAIL', 'skill-fired', `${notFired.length}/${controls.length} control run(s) do not show ${m.skill} in the transcript: ${notFired.map((r) => r.dir).join(', ')}`]);
  }

  // 3. The grader must have caught a planted regression, for taste skills.
  const needsGrader = m.classification !== 'deterministic';
  if (!needsGrader) {
    findings.push(['PASS', 'grader-validated', 'deterministic skill: graded by assertions, no LLM judge needed']);
  } else if (m.graderValidated) {
    findings.push(['PASS', 'grader-validated', 'grader preferred the real output over a degraded copy']);
  } else {
    findings.push(['FAIL', 'grader-validated', 'grader has not been validated against a planted regression. Run --validate-grader before trusting any of its verdicts.']);
  }

  // 4. Flaky control: a task the full skill passes only sometimes cannot be a baseline.
  const byTask = new Map();
  for (const r of controls) {
    if (r.result === null) continue;
    if (!byTask.has(r.task)) byTask.set(r.task, []);
    byTask.get(r.task).push(r.result);
  }
  const flaky = [...byTask.entries()].filter(([, rs]) => rs.includes('pass') && rs.includes('fail'));
  findings.push(flaky.length === 0
    ? ['PASS', 'control-stable', 'no control task passes only intermittently']
    : ['FAIL', 'control-stable', `control task(s) ${flaky.map(([t]) => t).join(', ')} pass only sometimes. Fix the task before judging any section against it -- non-determinism reads as regression.`]);

  // 5. The isolation the whole lab depends on.
  const leaks = memoryLeaks(P.work);
  findings.push(leaks.length === 0
    ? ['PASS', 'isolated', 'no ancestor CLAUDE.md in scope']
    : ['FAIL', 'isolated', `ancestor memory files in scope: ${leaks.join(', ')}`]);
  const unredirected = runs.filter((r) => r.configRedirected === false);
  if (unredirected.length) {
    findings.push(['FAIL', 'config-redirected', `${unredirected.length} run(s) wrote no transcript under ${P.config}; CLAUDE_CONFIG_DIR may not have been honoured`]);
  }

  return findings;
}

// ------------------------------------------------------------------------ main

const out = [];

if (argv.gate) {
  const findings = gate();
  if (argv.json) {
    process.stdout.write(`${JSON.stringify({ lab, findings: findings.map(([status, id, detail]) => ({ status, id, detail })) }, null, 2)}\n`);
  } else {
    process.stdout.write(`positive controls -- ${lab}\n\n`);
    for (const [status, id, detail] of findings) {
      process.stdout.write(`  ${status.padEnd(7)} ${id.padEnd(18)} ${detail}\n`);
    }
    const failed = findings.filter(([s]) => s === 'FAIL');
    process.stdout.write(failed.length === 0
      ? `\nAll controls pass. Section evidence from this lab can be trusted.\n`
      : `\n${failed.length} control(s) failing. HALT: do not read section evidence from this lab until they pass.\n`);
  }
  process.exit(findings.some(([s]) => s === 'FAIL') ? 2 : 0);
}

if (argv['validate-grader']) {
  if (!argv.run) fail('--validate-grader needs --run <run-dir>');
  const rec = await validateGrader(argv.run);
  if (argv.json) process.stdout.write(`${JSON.stringify(rec, null, 2)}\n`);
  else {
    process.stdout.write(`grader validation: ${rec.caught ? 'PASS' : 'FAIL'}\n`);
    process.stdout.write(`  winner ${rec.winner} (real output is "a")\n  reason ${rec.reason ?? '-'}\n`);
    if (!rec.caught) {
      process.stdout.write(`\nThe grader did not prefer the full output over a truncated third of it.
Its verdicts cannot be trusted. Tighten bar.md into checkable criteria and
re-validate before grading anything.\n`);
    }
  }
  process.exit(rec.caught ? 0 : 2);
}

if (argv.grade) {
  if (!argv.a || !argv.b) fail('--grade needs --a <run-dir> and --b <run-dir>');
  if (!readManifest(lab).graderValidated && readManifest(lab).classification !== 'deterministic') {
    process.stderr.write(`warning: the grader has not been validated on this lab (--validate-grader). This verdict does not count yet.\n`);
  }
  const rec = await grade({ aDir: argv.a, bDir: argv.b });
  if (argv.json) process.stdout.write(`${JSON.stringify(rec, null, 2)}\n`);
  else {
    process.stdout.write(`winner     ${rec.winner}\nconfidence ${rec.confidence ?? '-'}\nreason     ${rec.reason ?? '-'}\n`);
    process.stdout.write(`(presented ${rec.presentedFirst} first; sides randomised)\n`);
  }
  process.exit(rec.ok ? 0 : 1);
}

// trial mode
if (!argv.variant) fail('--variant control|stub|iter is required');
if (!['control', 'stub', 'iter'].includes(argv.variant)) fail(`unknown variant ${JSON.stringify(argv.variant)}`);
if (argv.variant === 'iter' && !argv.iter) fail('--variant iter requires --iter <label>');
if (!argv.task) fail('--task <id> is required');

let tasks;
try { tasks = readTasks(lab); } catch (e) { fail(e.message); }
const task = tasks.tasks.find((t) => t.id === argv.task);
if (!task) fail(`no task ${JSON.stringify(argv.task)} in ${P.tasks}.\nKnown: ${tasks.tasks.map((t) => t.id).join(', ')}`);
if (tasks.classification && !readManifest(lab).classification) {
  save({ classification: tasks.classification });
}

// Refuse a stub run against a state that still has sections in it. The gate
// catches this afterwards, but afterwards is too late to be useful: the runs are
// already on record, they passed, and a passing stub is indistinguishable from
// "the body was never needed". A non-empty state is an --variant iter run.
const currentState = readManifest(lab).state;
if (argv.variant === 'stub' && (currentState?.kept?.length ?? 0) > 0) {
  fail(`the lab state is "${currentState.label}" with ${currentState.kept.length} section(s) present, so this would not be a stub run.

A stub is frontmatter only. Runs against a partial skill belong to an iteration:

  node scripts/stub.mjs ${lab}                       # back to a bare stub
  node scripts/run.mjs ${lab} --variant iter --iter <label> --task ${argv.task}`);
}

const first = argv.rep ? Number(argv.rep) : 1;
const count = argv.reps ? Number(argv.reps) : 1;
const reps = argv.reps ? Array.from({ length: count }, (_, i) => i + 1) : [first];

for (const rep of reps) {
  const rec = await trial({ variant: argv.variant, task, rep, iterLabel: argv.iter });
  out.push(rec);
  if (!argv.json) {
    const verdict = rec.result ?? (rec.ok ? 'ungraded' : 'ERROR');
    process.stdout.write(`${argv.variant}/${task.id}/${rep}  ${verdict.padEnd(9)} skill-fired=${rec.skillFired} ${rec.ms}ms${rec.costUsd ? ` $${rec.costUsd.toFixed(4)}` : ''}\n`);
    if (rec.error) process.stdout.write(`  error: ${rec.error}\n`);
    for (const c of rec.asserts.checks) {
      if (!c.pass) process.stdout.write(`  assert failed: ${c.type} ${c.detail}\n`);
    }
    if (!rec.skillFired) {
      process.stdout.write(`  warning: ${manifest.skill} does not appear in this run's transcript. `
        + `${argv.variant === 'control' ? 'A control run that did not fire the skill measures nothing.' : 'The forced-invocation preamble may not be working.'}\n`);
    }
  }
}

if (argv.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`\noutputs under ${argv.variant === 'iter' ? path.join(lab, 'iterations', argv.iter) : path.join(lab, argv.variant)}\n`);
