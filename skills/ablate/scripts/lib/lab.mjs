// Clean-room construction and the checks that keep it clean.
//
// The isolation design is empirical: see SPIKE.md. Two things are load-bearing
// and neither is obvious. First, CLAUDE_CONFIG_DIR suppresses user-level skills,
// settings, hooks and MCP servers -- but it does NOT stop user memory reaching
// the run. Second, the CLI finds memory by walking the working directory's
// ancestors for `<ancestor>/.claude/CLAUDE.md`, so a lab anywhere beneath the
// home directory inherits the user's global instructions. On Windows
// os.tmpdir() is beneath the home directory, which makes the obvious lab
// location the wrong one.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { configDir } from './paths.mjs';

export const LAB_MARKER = '.maestro-ablate-lab';

/**
 * Default lab root, chosen to sit outside the home directory.
 *
 * Windows: `%SystemDrive%\maestro-ablate-labs` (creatable without elevation).
 * Elsewhere: os.tmpdir(), which is already outside $HOME.
 */
export function defaultLabRoot() {
  if (process.platform === 'win32') {
    const drive = process.env.SystemDrive || 'C:';
    return path.join(`${drive}${path.sep}`, 'maestro-ablate-labs');
  }
  return path.join(os.tmpdir(), 'maestro-ablate-labs');
}

/**
 * Root for ephemeral working directories -- deliberately *not* under the lab root.
 *
 * A run's working directory must not have the lab among its ancestors. A run has
 * filesystem tools and, in the stub case, a strong incentive to go looking: strip
 * a skill's instructions and the model will search for them. If walking up one
 * level reveals the lab, it finds the pristine skill and every earlier run's
 * output, and the measurement is worthless while still looking clean.
 *
 * The name is uninformative for the same reason. This makes the lab
 * undiscoverable, not unreachable -- a run can read anything its user can, so the
 * positive controls remain the real defence.
 */
export function workRoot() {
  if (process.platform === 'win32') {
    const drive = process.env.SystemDrive || 'C:';
    return path.join(`${drive}${path.sep}`, '.sa-work');
  }
  return path.join(os.tmpdir(), '.sa-work');
}

function workSlot(lab, suffix) {
  const id = createHash('sha1').update(path.resolve(lab)).digest('hex').slice(0, 12);
  return path.join(workRoot(), `${id}${suffix}`);
}

/**
 * Find memory files that would leak into a run whose cwd is `dir`.
 *
 * This tests the actual mechanism rather than a proxy for it: walk every ancestor
 * of the lab and look for both `CLAUDE.md` and `.claude/CLAUDE.md`. Checking the
 * mechanism directly also catches cases a "not under $HOME" rule would miss, such
 * as a lab placed inside a repository that has its own CLAUDE.md.
 *
 * The lab's own CLAUDE.md is excluded -- labinit writes that one deliberately.
 */
export function memoryLeaks(dir) {
  const found = [];
  let cur = path.resolve(dir);
  const labOwn = path.join(cur, 'CLAUDE.md');
  for (;;) {
    for (const candidate of [path.join(cur, 'CLAUDE.md'), path.join(cur, '.claude', 'CLAUDE.md')]) {
      if (candidate === labOwn) continue;
      if (fs.existsSync(candidate)) found.push(candidate);
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return found;
}

/**
 * Restrict a directory to the current user.
 *
 * The lab config holds a copy of the user's Claude credentials, and the default
 * lab root is outside the user's profile precisely so that memory does not leak
 * in -- which also means it is not protected by profile permissions. Best effort:
 * a failure warns rather than aborting, since an unprotected lab is a smaller
 * problem than no lab, but it must not fail silently.
 */
export function lockdown(dir) {
  try {
    if (process.platform === 'win32') {
      const user = process.env.USERNAME;
      if (!user) return { ok: false, reason: 'USERNAME not set' };
      // No /T. The grant carries (OI)(CI), which is an inheritable ACE: applying
      // it recursively hands leaf files an inherit-only entry while /inheritance:r
      // strips the entries they actually had, leaving them with no effective
      // permissions at all -- the owner included. Set it on the directory only and
      // let children inherit, which is why this runs before anything is written.
      execSync(`icacls "${dir}" /inheritance:r /grant:r "${user}:(OI)(CI)F" /C /Q`, {
        stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000,
      });
    } else {
      fs.chmodSync(dir, 0o700);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Delete a lab.
 *
 * The config directory has restrictive permissions by design, so access is
 * granted back before removal. Without this a lab can become undeletable, which
 * matters more than it sounds: a lab holds a copy of the user's credentials, and
 * "delete it when you are done" has to actually work.
 */
export function removeLab(dir) {
  if (!fs.existsSync(dir)) return;
  if (process.platform === 'win32') {
    try {
      execSync(`icacls "${dir}" /reset /T /C /Q`, { stdio: 'ignore', timeout: 60_000 });
    } catch { /* fall through; rmSync will report if it still cannot proceed */ }
  } else {
    try { fs.chmodSync(dir, 0o700); } catch { /* ditto */ }
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Paths inside a lab.
 *
 * Note where the working directory is: a *sibling* of the lab, not inside it.
 * This is not tidiness. A run has filesystem tools, and anything reachable
 * beneath its working directory is something it can find and use -- including the
 * pristine copy of the skill it is being tested without, and the output files of
 * earlier runs. A stub run that finds a control run's output does not need the
 * skill body to produce the right answer, so it passes, and a passing stub reads
 * as "this section was never needed".
 *
 * That is not hypothetical: it is what happened the first time this rig was run,
 * and the transcript showed the stub reading two control outputs and copying the
 * answer out of them. The fix is that a run's working directory contains the skill
 * under test and an empty output directory, and nothing else whatsoever.
 */
export function labPaths(lab, skill) {
  const work = workSlot(lab, '');
  return {
    lab,
    config: path.join(lab, 'config'),
    skillsrc: path.join(lab, 'skillsrc'),
    pristine: path.join(lab, 'skillsrc', 'SKILL.md'),
    state: path.join(lab, 'state', 'SKILL.md'),
    bar: path.join(lab, 'bar.md'),
    tasks: path.join(lab, 'tasks.json'),
    manifest: path.join(lab, 'manifest.json'),
    marker: path.join(lab, LAB_MARKER),
    work,
    workSkillFile: path.join(work, '.claude', 'skills', skill, 'SKILL.md'),
    workOut: path.join(work, 'out'),
    graderCwd: workSlot(lab, '-g'),
  };
}

/**
 * Build a run's working directory from scratch.
 *
 * Recreated for every single run, so no run can observe any other. Contains the
 * skill under test at project level (which is what makes it resolve at all), a
 * neutral project CLAUDE.md, and an empty output directory.
 */
export function prepareWork(lab, skill) {
  const P = labPaths(lab, skill);
  removeLab(P.work);
  const skillDir = path.dirname(P.workSkillFile);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(P.workOut, { recursive: true });

  // Everything the skill ships, then the current section subset over the top.
  copyTree(P.skillsrc, skillDir);
  fs.copyFileSync(P.state, P.workSkillFile);

  fs.writeFileSync(path.join(P.work, 'CLAUDE.md'), 'No project instructions.\n', 'utf8');
  return P;
}

/** True if `dir` looks like a lab this tool created. */
export function isLab(dir) {
  return fs.existsSync(path.join(dir, LAB_MARKER));
}

/**
 * Seed `<lab>/config/` so a headless run authenticates and skips onboarding.
 *
 * Copying `.credentials.json` is required, not defensive: without it the run
 * exits 1 with "Not logged in". The state file is `.claude.json`, which lives
 * beside `.claude/` in a normal install but inside the directory when
 * CLAUDE_CONFIG_DIR is set.
 */
export function seedConfig(config, { force = false } = {}) {
  fs.mkdirSync(config, { recursive: true });
  const src = configDir();
  const notes = [];

  // Restrict permissions first, so everything written below inherits them. Doing
  // it afterwards is what breaks the credentials file (see lockdown).
  const locked = lockdown(config);
  if (!locked.ok) {
    notes.push(`could not restrict permissions on ${config} (${locked.reason}); it will contain a copy of your credentials`);
  }

  const cred = path.join(src, '.credentials.json');
  const credTarget = path.join(config, '.credentials.json');
  if (fs.existsSync(cred)) {
    if (force || !fs.existsSync(credTarget)) fs.copyFileSync(cred, credTarget);
    // Read it back. A credentials file the CLI cannot open produces
    // "Not logged in · Please run /login" at run time, which looks like an
    // account problem and not like a permissions mistake made here.
    try {
      JSON.parse(fs.readFileSync(credTarget, 'utf8'));
      notes.push('credentials copied and readable');
    } catch (e) {
      throw new Error(`copied credentials to ${credTarget} but cannot read them back: ${e.message}
Every run would fail with "Not logged in". Check the directory permissions.`);
    }
  } else {
    notes.push(`no .credentials.json in ${src} -- runs will fail auth unless ANTHROPIC_API_KEY is set`);
  }

  // Minimal settings: no hooks, no status line, no plugins, no MCP servers.
  fs.writeFileSync(path.join(config, 'settings.json'), `${JSON.stringify({
    includeCoAuthoredBy: false,
    cleanupPeriodDays: 7,
  }, null, 2)}\n`, 'utf8');

  // First-run state. Identity fields are carried over from the real state file so
  // the CLI does not treat this as a brand new install; project history is not.
  const seed = {
    numStartups: 50,
    autoUpdates: false,
    hasCompletedOnboarding: true,
    bypassPermissionsModeAccepted: true,
    projects: {},
    mcpServers: {},
  };
  try {
    const real = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    for (const k of ['installMethod', 'userID', 'anonymousId', 'machineID', 'firstStartTime',
                     'oauthAccount', 'claudeCodeFirstTokenDate', 'lastOnboardingVersion',
                     'migrationVersion']) {
      if (real[k] !== undefined) seed[k] = real[k];
    }
    notes.push('first-run state seeded');
  } catch {
    notes.push('no ~/.claude.json to seed from; onboarding may fire on first run');
  }
  fs.writeFileSync(path.join(config, '.claude.json'), `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  return notes;
}

/** Copy a directory tree, skipping our own artefacts. */
export function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.git' || e.name.endsWith('.pre-ablation.bak')) continue;
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    const st = fs.statSync(from); // follows links: a linked-in skill must copy its content
    if (st.isDirectory()) copyTree(from, to);
    else if (st.isFile()) fs.copyFileSync(from, to);
  }
}

/** Read a lab's tasks.json, with the errors a hand-written file actually produces. */
export function readTasks(lab) {
  const p = labPaths(lab, '').tasks;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    throw new Error(`could not read ${p}: ${e.message}`);
  }
  if (!Array.isArray(doc.tasks) || doc.tasks.length === 0) {
    throw new Error(`${p}: expected a non-empty "tasks" array`);
  }
  const seen = new Set();
  for (const t of doc.tasks) {
    if (!t.id) throw new Error(`${p}: a task has no id`);
    if (seen.has(t.id)) throw new Error(`${p}: duplicate task id ${JSON.stringify(t.id)}`);
    seen.add(t.id);
    if (!t.prompt) throw new Error(`${p}: task ${t.id} has no prompt`);
  }
  return doc;
}
