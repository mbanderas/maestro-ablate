# Fixtures — validating the rig

`rig-check` is a deliberately trivial skill that exists only to prove the harness works before
you spend money measuring a real one.

Every rule in it is arbitrary: an output header, a token, and a count derived from a made-up
rule. None of it can be guessed or inferred. So a run that produces the right answers can only
have read the skill body — which is exactly the property a positive control needs.

Run this after installing, after upgrading the CLI, and any time a result surprises you.

## The check

```sh
node scripts/labinit.mjs fixtures/rig-check --model claude-sonnet-5 --clean
LAB=<the lab path it prints>

cp fixtures/rig-check.tasks.json "$LAB/tasks.json"
cp fixtures/rig-check.bar.md     "$LAB/bar.md"

# Control: the full skill. Must pass, and must show the skill firing.
node scripts/run.mjs "$LAB" --variant control --task t1-manifest --reps 2
node scripts/run.mjs "$LAB" --variant control --task t2-token    --reps 2

# Stub: frontmatter only. Must fail.
node scripts/stub.mjs "$LAB"
node scripts/run.mjs "$LAB" --variant stub --task t1-manifest --reps 2
node scripts/run.mjs "$LAB" --variant stub --task t2-token    --reps 2

node scripts/run.mjs "$LAB" --gate
```

Expected: six `PASS` lines and exit 0. Roughly a dozen runs, low single-digit dollars on a
mid-sized model.

Then confirm the gate actually blocks. Make the "stub" resolvable to the full original and check
that it refuses:

```sh
node scripts/stub.mjs "$LAB" --keep all --label sabotaged
node scripts/run.mjs "$LAB" --variant stub --task t2-token --rep 3
```

That is refused before it runs, because a state with sections present is not a stub. Force the
record anyway — edit `manifest.json`, or label it as an iteration — and `--gate` fails
`stub-is-empty` and `stub-fails` with exit 2.

**Delete the lab when you are done.** `<lab>/config/` holds a copy of your credentials.

## What this caught when it was first run

Both of these were bugs in the harness, not in any skill, and both would have produced confident
nonsense. They are why the positive controls are blocking rather than advisory.

**The stub passed by reading earlier runs' output.** With run artifacts stored under the working
directory, the stub run — having no instructions to work from — searched the directory tree,
found two control runs' `manifest.txt` files, and copied the answer out of them. It passed. A
passing stub reads as "the skill body was never needed", which would have condemned every section
in the file.

Fixed: every run now gets a working directory built from nothing, containing only the skill under
test and an empty output directory, destroyed afterwards. It lives outside the lab root, so
walking up from it reveals nothing.

**The grader un-blinded itself.** Given filesystem tools, the grading call went and read the lab,
worked out which candidate came from the `control/` directory, and cited the run logs in its
stated reasoning. Grading that knows which candidate is the rebuild is not evidence.

Fixed: the grader runs with `--tools ""`. Both candidates are in its prompt; it has no legitimate
use for a filesystem.

The general lesson is worth keeping in mind when you write tasks: **a model that lacks
instructions will go looking for them,** and it is resourceful about it. Anything reachable from a
run's working directory is part of that run's input, whether you intended it or not.

## Note on grader validation

`--validate-grader` refuses on this fixture, correctly: its outputs are a couple of lines long,
and there is no meaningful way to degrade two lines. `rig-check` is classified `deterministic`, so
it is graded by assertions and needs no LLM judge at all — the gate reports `grader-validated` as
satisfied for that reason.

Validate the grader on the real taste skill you are about to measure, against a substantial
output, as `references/protocol.md` describes.
