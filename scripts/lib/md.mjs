// SKILL.md parsing: frontmatter, line metrics, and the section model that
// keep / drop / extract address.

/** Rough token estimate. Four characters per token is close enough to rank by. */
export function estTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Count lines the way `wc -l`-style tools do: a trailing newline does not add a
 * line. Ground-truth line counts have to match what a human sees in an editor.
 */
export function countLines(text) {
  if (text === '') return 0;
  const parts = text.split(/\r?\n/);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

/**
 * Split a SKILL.md into `{ frontmatter, frontmatterText, body, bodyStartLine }`.
 * Frontmatter is the leading `---` block. It is never ablatable: `description`
 * is the trigger surface, and a skill with an empty description never fires.
 */
export function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, frontmatterText: '', body: text, bodyStartLine: 1 };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) {
    return { frontmatter: {}, frontmatterText: '', body: text, bodyStartLine: 1 };
  }
  const fmLines = lines.slice(1, end);
  const frontmatterText = lines.slice(0, end + 1).join('\n');
  return {
    frontmatter: parseFrontmatter(fmLines),
    frontmatterText,
    body: lines.slice(end + 1).join('\n'),
    bodyStartLine: end + 2,
  };
}

/**
 * Enough YAML for SKILL.md frontmatter: top-level `key: value` pairs, optional
 * quoting, and indented continuation lines folded onto the previous value.
 * Deliberately not a YAML parser -- a dependency-free tool should not pretend
 * to be one, and SKILL.md frontmatter has never needed more than this.
 */
function parseFrontmatter(lines) {
  const out = {};
  let key = null;
  for (const raw of lines) {
    const m = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(raw);
    if (m) {
      key = m[1];
      out[key] = unquote(m[2].trim());
    } else if (key && /^\s+\S/.test(raw)) {
      out[key] = `${out[key]} ${raw.trim()}`.trim();
    }
  }
  return out;
}

function unquote(v) {
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Mark which body lines sit inside a fenced code block. Fenced blocks are atomic
 * for every downstream decision: a `#` inside a fence is not a heading, and a
 * fence is never split across sections.
 */
export function fenceMap(lines) {
  const inFence = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence === null) {
      if (m) { fence = m[1][0].repeat(3); inFence[i] = true; }
    } else {
      inFence[i] = true;
      if (m && m[1].startsWith(fence) && m[2].trim() === '') fence = null;
    }
  }
  return inFence;
}

function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');
}

/**
 * Classify a section body so the search can be *ordered*.
 *
 * This is scheduling information only. It may never justify a drop: the highest-
 * value keep items (verification steps, irreducible gotchas) are pure prose, and
 * a naive "code is payload" prior protects exactly the blocks that should be
 * extracted instead.
 */
export function classifyKind(bodyLines, inFence) {
  let code = 0, table = 0, list = 0, prose = 0;
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (line.trim() === '') continue;
    if (inFence[i]) { code++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) || /^\s*\|?[\s:-]*-{3,}[\s:|-]*$/.test(line)) { table++; continue; }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) { list++; continue; }
    prose++;
  }
  const total = code + table + list + prose;
  if (total === 0) return 'prose';
  const ranked = [['code', code], ['table', table], ['list', list], ['prose', prose]]
    .sort((a, b) => b[1] - a[1]);
  return ranked[0][1] / total >= 0.6 ? ranked[0][0] : 'mixed';
}

/**
 * Parse a SKILL.md into addressable sections.
 *
 * The split level is the shallowest heading level *below* the document title, so
 * a section runs from its heading to the next heading of equal or higher level
 * and absorbs its own subheadings. That keeps units non-overlapping, keeps ids
 * stable while the headings are, and matches the granularity the method was
 * designed for. `maxLevel` splits deeper when a section proves too coarse.
 *
 * Returns `{ frontmatter, sections }`. Section ids are `s01`, `s02`, … suffixed
 * with a slug (`s03-when-to-use`); `fm` and `preamble` are reserved ids.
 */
export function parseSections(text, { maxLevel = null } = {}) {
  const { frontmatter, frontmatterText, body, bodyStartLine } = splitFrontmatter(text);
  const lines = body.split(/\r?\n/);
  const inFence = fenceMap(lines);

  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (m) headings.push({ index: i, level: m[1].length, heading: m[2].trim() });
  }

  // A lone leading level-1 heading is the document title, not an ablatable unit.
  const titleIsFirst = headings.length > 0
    && headings[0].level === 1
    && headings.filter((h) => h.level === 1).length === 1;
  const splittable = titleIsFirst ? headings.slice(1) : headings;

  let splitLevel;
  if (maxLevel !== null) splitLevel = maxLevel;
  else if (splittable.length === 0) splitLevel = 6;
  else splitLevel = Math.min(...splittable.map((h) => h.level));

  const cuts = splittable.filter((h) => h.level <= splitLevel);

  const sections = [];
  const mk = (id, heading, level, startIdx, endIdx) => {
    const slice = lines.slice(startIdx, endIdx + 1);
    const text = slice.join('\n');
    sections.push({
      id,
      heading,
      level,
      startLine: bodyStartLine + startIdx,
      endLine: bodyStartLine + endIdx,
      lines: countLines(text),
      estTokens: estTokens(text),
      kind: classifyKind(slice, inFence.slice(startIdx, endIdx + 1)),
      text,
    });
  };

  const firstCut = cuts.length ? cuts[0].index : lines.length;
  if (firstCut > 0) {
    const preambleEnd = firstCut - 1;
    const slice = lines.slice(0, preambleEnd + 1);
    if (slice.join('').trim() !== '') {
      mk('preamble', titleIsFirst ? headings[0].heading : null, titleIsFirst ? 1 : 0, 0, preambleEnd);
    }
  }

  for (let c = 0; c < cuts.length; c++) {
    const start = cuts[c].index;
    const end = c + 1 < cuts.length ? cuts[c + 1].index - 1 : lines.length - 1;
    const n = String(sections.filter((s) => s.id !== 'preamble').length + 1).padStart(2, '0');
    const s = slug(cuts[c].heading);
    mk(`s${n}${s ? `-${s}` : ''}`, cuts[c].heading, cuts[c].level, start, end);
  }

  return { frontmatter, frontmatterText, bodyStartLine, splitLevel, sections };
}

/**
 * File-level metrics used to rank inventory targets.
 *
 * `lines` is every line, blank ones included -- that is what an editor shows and
 * what the model is billed for. `contentLines` excludes blanks, which is what
 * most line-counting tools report; both are given because comparing the two
 * across tools is otherwise a silent source of disagreement.
 *
 * `codeLines` and `proseLines` cover the body only, since frontmatter is never
 * ablatable and does not belong in a prose-versus-payload ratio.
 */
export function fileMetrics(text) {
  const { body } = splitFrontmatter(text);
  const lines = body.split(/\r?\n/);
  const inFence = fenceMap(lines);
  let codeLines = 0, proseLines = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (inFence[i]) codeLines++;
    else proseLines++;
  }
  const denom = codeLines + proseLines;
  const all = text.split(/\r?\n/);
  let contentLines = 0;
  for (const l of all) if (l.trim() !== '') contentLines++;
  return {
    lines: countLines(text),
    contentLines,
    codeLines,
    proseLines,
    proseRatio: denom === 0 ? 0 : Number((proseLines / denom).toFixed(3)),
    estTokens: estTokens(text),
  };
}
