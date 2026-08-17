// Path resolution. Every path here derives from os.homedir(), process.cwd(), or
// an environment variable -- nothing is hardcoded to a machine.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directories never worth walking into.
 *
 * `worktrees` and `.workshop-worktrees` matter more than the rest: a git worktree
 * contains a second checkout of the same skills, and counting those copies both
 * inflates every total and puts phantom duplicates in the ranking.
 */
export const SKIP_DIRS = new Set([
  'node_modules', 'worktrees', '.workshop-worktrees', '.git', '.cache', 'dist', 'build',
]);

/** This skill's own root (the repo root, since the repo *is* the skill). */
export function skillRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Where `.cache/` lives: alongside the skill, so it survives across repos. */
export function cacheDir() {
  const dir = path.join(skillRoot(), '.cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The active Claude Code config directory. Honours CLAUDE_CONFIG_DIR so that
 * inventory run from inside a lab reads that lab's transcripts, not the user's.
 */
export function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** Transcript root: `<config>/projects/`. */
export function projectsDir() {
  return path.join(configDir(), 'projects');
}

/**
 * Skill roots to scan, in priority order, deduplicated and existence-filtered.
 *
 * Defaults cover the two locations every Claude Code user has. Extra roots come
 * from `--root` or the SKILL_ABLATION_ROOTS environment variable (a
 * platform-separated list), which is how a project with its own convention
 * points the inventory at it without this tool needing to know that convention.
 *
 * Plugin skills are opt-in via `includePlugins`: they are almost always
 * vendor-maintained, and the right move on a vendor file is to re-pin it from
 * upstream, not to ablate it.
 */
export function skillRoots({ cwd = process.cwd(), extra = [], includePlugins = false, only = false } = {}) {
  const home = os.homedir();
  // `only` drops the defaults, so a single repo can be audited on its own instead
  // of alongside the whole user-level roster.
  const roots = only ? [] : [
    path.join(home, '.claude', 'skills'),
    path.join(cwd, '.claude', 'skills'),
  ];
  const fromEnv = process.env.SKILL_ABLATION_ROOTS;
  if (fromEnv && !only) {
    for (const p of fromEnv.split(path.delimiter)) {
      if (p.trim()) roots.push(path.resolve(cwd, p.trim()));
    }
  }
  for (const p of extra) roots.push(path.resolve(cwd, p));
  if (includePlugins) roots.push(path.join(home, '.claude', 'plugins'));

  const seen = new Set();
  const out = [];
  for (const r of roots) {
    let real;
    try { real = fs.realpathSync(r); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(r);
  }
  return out;
}

/**
 * Recursively collect SKILL.md paths under `root`.
 *
 * Links are followed. This matters more than it looks: Node reports a Windows
 * junction (and any symlink) as `isSymbolicLink()` and *not* `isDirectory()`, so
 * the obvious `if (e.isDirectory())` walk silently skips every linked-in skill --
 * and linking a skill directory into `~/.claude/skills` is a normal install, the
 * one this skill itself recommends. A realpath visited-set prevents link cycles
 * from looping forever.
 *
 * The filename match is case-insensitive because Windows and macOS resolve
 * `skill.md` and `SKILL.md` to the same file, so a case variant is a real skill
 * on those platforms and omitting it would undercount.
 *
 * `requireSkillsSegment` restricts hits to paths containing a `skills`
 * directory, which is what makes the plugins root usable: a marketplace
 * checkout contains editor configs and mirrored copies that are not skills.
 */
export function findSkillFiles(root, { requireSkillsSegment = false, limitDepth = 12 } = {}) {
  const out = [];
  const visited = new Set();
  const walk = (dir, depth) => {
    if (depth > limitDepth) return;
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (visited.has(real)) return;
    visited.add(real);

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const isLink = e.isSymbolicLink();
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (isLink) {
        try {
          const st = fs.statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch { continue; } // dangling link
      }
      if (isDir) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (isFile && e.name.toLowerCase() === 'skill.md') {
        if (requireSkillsSegment && !full.split(path.sep).includes('skills')) continue;
        out.push(full);
      }
    }
  };
  walk(root, 0);
  return out;
}

/** Resolve a `<skill>` argument: a name to look up, or a path to a skill dir/file. */
export function resolveSkill(arg, opts = {}) {
  const asPath = path.resolve(process.cwd(), arg);
  if (fs.existsSync(asPath)) {
    const stat = fs.statSync(asPath);
    if (stat.isFile()) return asPath;
    const candidate = path.join(asPath, 'SKILL.md');
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const root of skillRoots(opts)) {
    const includePlugins = root.endsWith(`${path.sep}plugins`);
    for (const file of findSkillFiles(root, { requireSkillsSegment: includePlugins })) {
      if (path.basename(path.dirname(file)) === arg) return file;
    }
  }
  return null;
}
