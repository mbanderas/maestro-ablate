// Durable records: what apply.mjs decided, and the cumulative ablation log.
//
// These live in the skill's own `.cache/`, not in the skill being rewritten. A
// tool that edits other people's directories should leave as little behind in
// them as possible.

import fs from 'node:fs';
import path from 'node:path';
import { cacheDir } from './paths.mjs';

function appliedDir() {
  const dir = path.join(cacheDir(), 'applied');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Sanitise a skill name for use as a filename. */
function safe(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

export function applyRecordPath(skill) {
  return path.join(appliedDir(), `${safe(skill)}.json`);
}

/**
 * Record what a rebuild did, so `report.mjs` can attribute every change and a
 * later re-ablation can see what the last one decided and why.
 */
export function writeApplyRecord(skill, record) {
  const file = applyRecordPath(skill);
  const prior = readApplyRecord(skill);
  const history = prior ? [...(prior.history ?? []), { ...prior, history: undefined }] : [];
  fs.writeFileSync(file, JSON.stringify({ ...record, history }, null, 2), 'utf8');
  return file;
}

export function readApplyRecord(skill) {
  try {
    return JSON.parse(fs.readFileSync(applyRecordPath(skill), 'utf8'));
  } catch {
    return null;
  }
}

export function logPath() {
  return path.join(cacheDir(), 'ablation-log.jsonl');
}

/** Append one line to the cumulative log. */
export function appendLog(entry) {
  fs.appendFileSync(logPath(), `${JSON.stringify(entry)}\n`, 'utf8');
  return logPath();
}

export function readLog() {
  let raw;
  try { raw = fs.readFileSync(logPath(), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn line rather than dying */ }
  }
  return out;
}

/** Read a lab's manifest, if one exists. */
export function readManifest(lab) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lab, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function writeManifest(lab, manifest) {
  const file = path.join(lab, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
  return file;
}
