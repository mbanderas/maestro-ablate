import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { destinations, parseArgs, runInstall } from "../scripts/install.mjs";

test("parseArgs defaults to a universal user install", () => {
  const options = parseArgs([]);
  assert.deepEqual(options.targets, ["universal"]);
  assert.equal(options.scope, "user");
  assert.equal(options.dryRun, false);
  assert.equal(options.force, false);
});

test("parseArgs rejects an unknown target and an unknown scope", () => {
  assert.throws(() => parseArgs(["--target", "emacs"]), /unknown target/);
  assert.throws(() => parseArgs(["--scope", "global"]), /--scope must be user or project/);
  assert.throws(() => parseArgs(["--frobnicate"]), /unknown option/);
});

test("a universal user install targets both skill roots exactly once", () => {
  const home = join(tmpdir(), "ablate-home");
  const paths = destinations(parseArgs(["--home", home])).map((item) => item.destination);
  assert.deepEqual(paths, [
    join(home, ".agents", "skills", "ablate"),
    join(home, ".claude", "skills", "ablate"),
  ]);
});

test("a dry run reports the plan without writing", async () => {
  const home = await mkdtemp(join(tmpdir(), "ablate-install-"));
  try {
    const outcome = await runInstall(["--home", home, "--target", "claude", "--dry-run"]);
    assert.equal(outcome.dryRun, true);
    assert.deepEqual(outcome.results.map((item) => item.action), ["would install"]);
    await assert.rejects(readFile(join(home, ".claude", "skills", "ablate", "SKILL.md")));
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("installing is idempotent and refuses to clobber a different copy", async () => {
  const home = await mkdtemp(join(tmpdir(), "ablate-install-"));
  const destination = join(home, ".claude", "skills", "ablate");
  try {
    const first = await runInstall(["--home", home, "--target", "claude"]);
    assert.deepEqual(first.results.map((item) => item.action), ["installed"]);

    const skill = await readFile(join(destination, "SKILL.md"), "utf8");
    assert.match(skill, /^name: ablate$/m);

    const second = await runInstall(["--home", home, "--target", "claude"]);
    assert.deepEqual(second.results.map((item) => item.action), ["current"]);

    await writeFile(join(destination, "SKILL.md"), "---\nname: ablate\n---\n", "utf8");
    await assert.rejects(
      runInstall(["--home", home, "--target", "claude"]),
      /already exists and differs/,
    );

    const forced = await runInstall(["--home", home, "--target", "claude", "--force"]);
    assert.deepEqual(forced.results.map((item) => item.action), ["replaced"]);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});
