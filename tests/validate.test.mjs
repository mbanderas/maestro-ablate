import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateRoot } from "../scripts/validate.mjs";

test("the repository satisfies its own release checks", async () => {
  const errors = await validateRoot();
  assert.deepEqual(errors, []);
});

test("a root without the packaged skill does not pass", async () => {
  const empty = await mkdtemp(join(tmpdir(), "ablate-validate-"));
  try {
    const errors = await validateRoot(empty).catch((error) => [error.message]);
    assert.ok(errors.length > 0);
  } finally {
    await rm(empty, { force: true, recursive: true });
  }
});
