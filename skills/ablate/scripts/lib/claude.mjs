// The single place a `claude` process is started.
//
// Every parameter here was settled empirically (SPIKE.md), and two of them are
// counter-intuitive enough to be worth stating at the top:
//
//   * The prompt goes over the child's stdin, never in argv. Under shell-mode
//     spawn Node concatenates arguments without escaping, and a multi-line
//     prompt containing quotes gets silently truncated -- the CLI then answers
//     the fragment, exits 0, and reports no error. A corrupted prompt that looks
//     like a successful run is exactly the failure that would be attributed to
//     the ablation instead of the harness.
//
//   * Inherited CLAUDE* variables are stripped. On the CLI version this was
//     built against a run survives without doing so, but an inherited
//     CLAUDE_CONFIG_DIR would nest one lab inside another silently.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { skillsInTranscript } from './usage.mjs';

export const DEFAULT_TIMEOUT_MS = 600_000;

/** Environment for a child run: ambient Claude state removed, config redirected. */
export function childEnv(config) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^CLAUDE/i.test(k) || /^ANTHROPIC_(API_KEY|AUTH_TOKEN)$/i.test(k)) continue;
    env[k] = v;
  }
  env.CLAUDE_CONFIG_DIR = config;
  return env;
}

/** The installed CLI version, or null. Recorded with every result. */
export function cliVersion() {
  try {
    return execSync('claude --version', {
      encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const BASE_ARGS = ['-p', '--output-format', 'json', '--permission-mode', 'bypassPermissions'];

function quote(arg) {
  // An empty argument must survive quoting. `--tools ""` disables every tool, and
  // an unquoted empty string simply vanishes from a shell command line -- which
  // would silently hand the grader a full toolset.
  if (arg === '') return '""';
  return /[\s"[\]{}()^&|<>]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function spawnOnce({ args, cwd, env, prompt, timeoutMs, useShell }) {
  return new Promise((resolve) => {
    // In shell mode the whole thing is one pre-quoted command string: passing an
    // args array alongside shell:true is what triggers unescaped concatenation.
    const child = useShell
      ? spawn(['claude', ...args].map(quote).join(' '), { cwd, env, shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn('claude', args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    let settled = false;
    const started = Date.now();
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill(); resolve({ timedOut: true, out, err, code: null, ms: Date.now() - started }); }
    }, timeoutMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ spawnError: e, out, err, code: null, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ code, out, err, ms: Date.now() - started });
    });
    child.stdin.on('error', () => { /* child gone; the close handler reports it */ });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Run `claude -p` once and return a structured result.
 *
 * Tries a direct spawn first and falls back to shell mode only if the process
 * could not be started at all -- some installs put a `.cmd` shim on PATH, which
 * Windows cannot execute directly, while a direct spawn avoids all quoting
 * questions when the binary is native.
 */
export async function runClaude({ cwd, config, prompt, model = null, timeoutMs = DEFAULT_TIMEOUT_MS, extraArgs = [] }) {
  const args = [...BASE_ARGS, ...(model ? ['--model', model] : []), ...extraArgs];
  const env = childEnv(config);

  let res = await spawnOnce({ args, cwd, env, prompt, timeoutMs, useShell: false });
  let usedShell = false;
  if (res.spawnError && process.platform === 'win32') {
    res = await spawnOnce({ args, cwd, env, prompt, timeoutMs, useShell: true });
    usedShell = true;
  }
  if (res.spawnError) {
    return { ok: false, error: `could not start claude: ${res.spawnError.message}`, ...res, usedShell };
  }
  if (res.timedOut) {
    return { ok: false, error: `timed out after ${timeoutMs} ms`, ...res, usedShell };
  }

  let parsed = null;
  try { parsed = JSON.parse(res.out); } catch { /* not JSON: reported below */ }

  return {
    ok: res.code === 0 && parsed?.is_error !== true,
    error: parsed ? null : `claude did not return JSON (exit ${res.code})`,
    code: res.code,
    ms: res.ms,
    usedShell,
    stdout: res.out,
    stderr: res.err,
    result: parsed ? String(parsed.result ?? '') : res.out,
    sessionId: parsed?.session_id ?? null,
    costUsd: parsed?.total_cost_usd ?? null,
    numTurns: parsed?.num_turns ?? null,
    isError: parsed?.is_error ?? null,
    subtype: parsed?.subtype ?? null,
  };
}

/**
 * Locate a run's transcript inside the redirected config dir.
 *
 * Finding it there is itself an assertion: if the transcript landed anywhere
 * else, CLAUDE_CONFIG_DIR was not honoured and the run was not isolated.
 */
export function findTranscript(config, sessionId) {
  if (!sessionId) return null;
  const root = path.join(config, 'projects');
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === `${sessionId}.jsonl`) return full;
    }
  }
  return null;
}

/**
 * The skill-fired assertion. Without it a harness that silently resolves no
 * skill at all reports the entire skill body as dead weight, confidently.
 */
export function skillFired(transcriptPath, skill) {
  if (!transcriptPath) return { fired: false, invoked: [], reason: 'no transcript found' };
  const invoked = skillsInTranscript(transcriptPath);
  const fired = invoked.some((n) => n === skill || n.endsWith(`:${skill}`));
  return { fired, invoked, reason: fired ? null : 'skill under test does not appear in the transcript' };
}
