// Usage counting: how often each skill was actually invoked, read from Claude
// Code's own transcripts.
//
// The transcript corpus is large (gigabytes, thousands of files), so the scan is
// built around two cheap outs: skip any file whose text does not contain the
// literal `"Skill"` at all, and skip any file whose mtime and size match the
// cache.

import fs from 'node:fs';
import path from 'node:path';
import { cacheDir, projectsDir } from './paths.mjs';

const CACHE_VERSION = 2;
const NEEDLE = '"Skill"';

function cachePath() {
  return path.join(cacheDir(), 'usage.json');
}

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (raw.version === CACHE_VERSION) return raw;
  } catch { /* absent or stale format */ }
  return { version: CACHE_VERSION, files: {} };
}

function saveCache(cache) {
  fs.writeFileSync(cachePath(), JSON.stringify(cache), 'utf8');
}

/** Collect every `*.jsonl` under the transcript root, subagent transcripts included. */
export function transcriptFiles(root = projectsDir()) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Pull every skill invocation out of one parsed transcript record.
 *
 * The record of interest is a `tool_use` block named `Skill`, which normally
 * sits inside `message.content[]` but is walked for generically so a change in
 * envelope shape does not silently zero the counts. A plugin-qualified name
 * (`plugin:skill`) is credited to both the qualified and the bare name, because
 * the skill on disk is the bare one.
 */
export function collectFromRecord(node, into, depth = 0) {
  if (depth > 8 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectFromRecord(item, into, depth + 1);
    return;
  }
  if (node.type === 'tool_use' && node.name === 'Skill') {
    const raw = node.input?.skill;
    if (typeof raw === 'string' && raw) {
      into.push(raw);
      const colon = raw.indexOf(':');
      if (colon !== -1) into.push(raw.slice(colon + 1));
    }
  }
  for (const key of ['message', 'content', 'toolUseResult', 'input']) {
    if (key in node) collectFromRecord(node[key], into, depth + 1);
  }
}

/**
 * Every skill invoked in one transcript, in order. This is what the skill-fired
 * positive control checks: if the control run's transcript does not name the
 * skill under test, the run measured nothing and its result is meaningless.
 */
export function skillsInTranscript(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes(NEEDLE)) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    collectFromRecord(rec, out);
  }
  return out;
}

function scanFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  if (!text.includes(NEEDLE)) return {};
  const counts = {};
  for (const line of text.split('\n')) {
    if (!line.includes(NEEDLE)) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const names = [];
    collectFromRecord(rec, names);
    for (const n of names) counts[n] = (counts[n] ?? 0) + 1;
  }
  return counts;
}

/**
 * Count skill invocations across all transcripts.
 *
 * Returns `{ counts, stats }` where `counts` maps skill name to invocation count.
 * Set `progress` to receive `(done, total)` callbacks -- the first uncached run
 * over a large corpus takes a while and silence reads as a hang.
 */
export function usageCounts({ progress = null, root = projectsDir() } = {}) {
  const files = transcriptFiles(root);
  const cache = loadCache();
  const counts = {};
  const stats = { files: files.length, parsed: 0, cached: 0, invocations: 0 };

  let done = 0;
  let dirty = false;
  for (const file of files) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const key = file;
    const hit = cache.files[key];
    let fileCounts;
    if (hit && hit[0] === st.mtimeMs && hit[1] === st.size) {
      fileCounts = hit[2];
      stats.cached++;
    } else {
      fileCounts = scanFile(file);
      cache.files[key] = [st.mtimeMs, st.size, fileCounts];
      dirty = true;
      stats.parsed++;
    }
    for (const [name, n] of Object.entries(fileCounts)) {
      counts[name] = (counts[name] ?? 0) + n;
      stats.invocations += n;
    }
    if (progress && ++done % 250 === 0) progress(done, files.length);
  }

  // Drop cache entries for transcripts that no longer exist.
  const live = new Set(files);
  for (const key of Object.keys(cache.files)) {
    if (!live.has(key)) { delete cache.files[key]; dirty = true; }
  }
  if (dirty) saveCache(cache);
  return { counts, stats };
}
