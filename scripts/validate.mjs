#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "1.0.0";
const PLUGIN_NAME = "maestro-ablate";
const PACKAGE_NAME = "@maestroablate/ablate";
const SKILL_NAME = "ablate";
const DISPLAY_NAME = "Maestro: Ablate";

const REQUIRED_SKILL_FILES = [
  "SKILL.md",
  "SPIKE.md",
  "fixtures/README.md",
  "fixtures/rig-check.bar.md",
  "fixtures/rig-check.tasks.json",
  "fixtures/rig-check/SKILL.md",
  "references/bar-template.md",
  "references/classify.md",
  "references/protocol.md",
  "references/static-rubric.md",
  "scripts/apply.mjs",
  "scripts/inventory.mjs",
  "scripts/labinit.mjs",
  "scripts/lib/args.mjs",
  "scripts/lib/claude.mjs",
  "scripts/lib/lab.mjs",
  "scripts/lib/md.mjs",
  "scripts/lib/paths.mjs",
  "scripts/lib/records.mjs",
  "scripts/lib/usage.mjs",
  "scripts/report.mjs",
  "scripts/run.mjs",
  "scripts/sections.mjs",
  "scripts/stub.mjs",
].sort();

const REQUIRED_ROOT_FILES = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".github/workflows/validate.yml",
  "DISCLAIMER.md",
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "assets/PROVENANCE.md",
  "package.json",
  "scripts/install.mjs",
  "scripts/validate.mjs",
];

const IGNORED_TREES = [".git/", "node_modules/", ".cache/", "labs/"];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root, base = root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path, base)));
    else if (entry.isFile()) files.push(relative(base, path).replaceAll("\\", "/"));
  }
  return files;
}

async function readJson(path, errors, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return {};
  }
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (field) fields.set(field[1], field[2].trim().replace(/^['"]|['"]$/g, ""));
  }
  return fields;
}

function markdownLinks(markdown) {
  const links = [];
  const pattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*)?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z]+:|#)/i.test(target)) continue;
    links.push(decodeURIComponent(target.split(/[?#]/, 1)[0]));
  }
  return links;
}

export async function validateRoot(root = DEFAULT_ROOT) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  for (const file of REQUIRED_ROOT_FILES) {
    check(await exists(join(root, file)), `missing required file: ${file}`);
  }

  const skillsRoot = join(root, "skills");
  const skillDirs = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  check(
    JSON.stringify(skillDirs) === JSON.stringify([SKILL_NAME]),
    `skills/ must expose only ${SKILL_NAME}; found ${skillDirs.join(", ")}`,
  );

  const skillRoot = join(skillsRoot, SKILL_NAME);
  const skillFiles = (await listFiles(skillRoot)).sort();
  check(
    JSON.stringify(skillFiles) === JSON.stringify(REQUIRED_SKILL_FILES),
    `skill file set differs from the reviewed allowlist: ${JSON.stringify(skillFiles)}`,
  );

  const packageJson = await readJson(join(root, "package.json"), errors, "package.json");
  const codex = await readJson(join(root, ".codex-plugin", "plugin.json"), errors, ".codex-plugin/plugin.json");
  const claude = await readJson(join(root, ".claude-plugin", "plugin.json"), errors, ".claude-plugin/plugin.json");
  const codexMarket = await readJson(join(root, ".agents", "plugins", "marketplace.json"), errors, ".agents/plugins/marketplace.json");
  const claudeMarket = await readJson(join(root, ".claude-plugin", "marketplace.json"), errors, ".claude-plugin/marketplace.json");

  check(packageJson.name === PACKAGE_NAME, `package name must be ${PACKAGE_NAME}`);
  check(packageJson.version === VERSION, `package version must be ${VERSION}`);
  check(codex.name === PLUGIN_NAME, `Codex plugin name must be ${PLUGIN_NAME}`);
  check(codex.version === VERSION, `Codex plugin version must be ${VERSION}`);
  check(claude.name === PLUGIN_NAME, `Claude plugin name must be ${PLUGIN_NAME}`);
  check(claude.version === VERSION, `Claude plugin version must be ${VERSION}`);

  check(codex.skills === "./skills/", "Codex plugin must discover ./skills/");
  check(!("apps" in codex), "Codex plugin must not declare apps without an app manifest");
  check(!("mcpServers" in codex), "Codex plugin must not declare MCP servers");
  check(!("hooks" in codex), "Codex plugin must not declare unsupported hooks");
  check(codex.interface?.displayName === DISPLAY_NAME, "Codex display name is wrong");
  check(Array.isArray(codex.interface?.defaultPrompt), "Codex defaultPrompt must be an array");
  check((codex.interface?.defaultPrompt?.length ?? 0) <= 3, "Codex defaultPrompt supports at most three entries");
  for (const prompt of codex.interface?.defaultPrompt ?? []) {
    check(prompt.length <= 128, "Codex defaultPrompt entry exceeds 128 characters");
    check(prompt.includes(`/${SKILL_NAME}`), `Codex defaultPrompt entries must invoke /${SKILL_NAME}`);
  }
  for (const path of [codex.interface?.composerIcon, codex.interface?.logo].filter(Boolean)) {
    check(path.startsWith("./assets/"), `Codex plugin asset must be under ./assets/: ${path}`);
    check(await exists(resolve(root, path)), `Codex plugin asset is missing: ${path}`);
  }

  const codexEntry = codexMarket.plugins?.[0];
  check(codexMarket.name === PLUGIN_NAME, "Codex marketplace name is wrong");
  check(codexEntry?.name === PLUGIN_NAME, "Codex marketplace plugin name is wrong");
  check(codexEntry?.source?.source === "url", "Codex team marketplace must use a URL source");
  check(codexEntry?.source?.url === `https://github.com/mbanderas/${PLUGIN_NAME}.git`, "Codex team marketplace URL is wrong");
  check(codexEntry?.policy?.installation === "AVAILABLE", "Codex marketplace installation policy is wrong");
  check(codexEntry?.policy?.authentication === "ON_INSTALL", "Codex marketplace authentication policy is wrong");
  check(codexEntry?.category === "Productivity", "Codex marketplace category is wrong");

  const claudeEntry = claudeMarket.plugins?.[0];
  check(claudeMarket.name === PLUGIN_NAME, "Claude marketplace name is wrong");
  check(claudeEntry?.name === PLUGIN_NAME, "Claude marketplace plugin name is wrong");
  check(claudeEntry?.source === "./", "Claude marketplace source must be ./");

  const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
  const frontmatter = parseFrontmatter(skill);
  check(frontmatter !== null, "SKILL.md must have YAML frontmatter");
  if (frontmatter) {
    check(
      JSON.stringify([...frontmatter.keys()]) === JSON.stringify(["name", "description"]),
      "SKILL.md frontmatter must contain only name and description",
    );
    check(frontmatter.get("name") === SKILL_NAME, `SKILL.md name must match the ${SKILL_NAME} folder`);
    const description = frontmatter.get("description") ?? "";
    check(description.length > 80 && description.length <= 1024, "SKILL.md description must be informative and at most 1024 characters");
    check(
      description.includes(`$${SKILL_NAME}`) && description.includes(`/${SKILL_NAME}`),
      `SKILL.md description must declare $${SKILL_NAME} and /${SKILL_NAME} invocation`,
    );
  }
  check(!skill.includes("[TODO"), "SKILL.md contains a scaffold placeholder");

  // The skill is a token-discipline tool; a bloated body of its own would be a
  // standing counter-example, so the ceiling it recommends is enforced here.
  const skillBodyLines = skill.split(/\r?\n/).length;
  check(skillBodyLines <= 120, `SKILL.md is ${skillBodyLines} lines; keep it at or under 120`);

  const allFiles = (await listFiles(root)).filter(
    (file) => !IGNORED_TREES.some((tree) => file.startsWith(tree)),
  );
  for (const file of allFiles.filter((file) => file.endsWith(".json"))) {
    await readJson(join(root, file), errors, file);
  }
  for (const file of allFiles.filter((file) => file.endsWith(".md"))) {
    const content = await readFile(join(root, file), "utf8");
    for (const link of markdownLinks(content)) {
      check(await exists(resolve(dirname(join(root, file)), link)), `${file} has a broken relative link: ${link}`);
    }
  }

  const textFiles = allFiles.filter((file) => /\.(?:json|md|mjs|ya?ml)$/.test(file));
  for (const file of textFiles) {
    const content = await readFile(join(root, file), "utf8");
    check(!content.includes("\r\n"), `${file} must use LF line endings`);
    check(content.endsWith("\n"), `${file} must end with a newline`);
    // Markdown is exempt from the trailing-whitespace rule: a hard line break is
    // two trailing spaces, and the fill-in templates ship with empty list items.
    if (file.endsWith(".md")) continue;
    check(!/[ \t]+$/m.test(content), `${file} contains trailing whitespace`);
  }

  return errors;
}

function isDirectRun() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const errors = await validateRoot();
  if (errors.length > 0) {
    process.stderr.write(`Validation failed with ${errors.length} finding(s):\n`);
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Validation passed: ${PLUGIN_NAME} ${VERSION}, one public skill (${SKILL_NAME}), ${REQUIRED_SKILL_FILES.length} skill files\n`,
    );
  }
}
