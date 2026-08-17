---
name: ablate
description: Use for /ablate and $ablate. Finds which parts of a SKILL.md earn their tokens and rebuilds the skill without the rest. Use when asked to ablate, audit, shrink, slim, or trim a skill, when skill bloat or per-session context cost comes up, or to work out which sections of a skill are load-bearing.
---

# Maestro: Ablate

Two phases. **Phase A** is a static audit: one reasoning pass per skill, no trial runs, covers
everything. **Phase B** is an empirical loop: baseline, stub, measured add-back, real `claude -p`
runs, expensive. **Run Phase A first, always.**

Scripts do the mechanics, take `--help`, and are invoked by absolute path from this skill's
directory. The judgement is yours: classification, task authoring, mapping failures to sections.

## Before anything writes

`~/.claude/skills/` has no version control by default, and `apply.mjs` destructively rewrites
`SKILL.md` files — it refuses to touch a skill whose own files are uncommitted. Git is the
rollback path; the `.bak` is a convenience, not a safety net.

```sh
cd ~/.claude/skills && git init && git add -A && git commit -m "chore: snapshot skills"
```

## Cost — say this before starting Phase B

Phase A costs one reasoning pass per skill. Phase B **spends real money against the user's own
subscription, consumes their rate limits, and competes with the session they are in** — budget
30–60 nested runs per skill plus grading. Never begin one without saying so and getting a yes.

## Start with the inventory

`node scripts/inventory.mjs --top 20` ranks targets by lines × recorded usage.

- **Zero-usage skills are a roster-prune candidate, not an ablation target.** A description loads
  into every session whether the skill is invoked or not, so archiving an unused one helps every
  session; shrinking a skill nobody calls saves nothing.
- **Vendor-maintained skills get re-pinned upstream, not ablated.** Ablating forks them.

## Phase A — static audit

```sh
node scripts/sections.mjs <skill>
node scripts/apply.mjs <skill> --decisions d.json --dry-run
node scripts/apply.mjs <skill> --decisions d.json
node scripts/report.mjs <skill>
```

Read `references/static-rubric.md` before deciding and `references/classify.md` for the gotcha
inventory. Four rules, none negotiable:

- **Extract before drop.** A template or lookup table is misplaced, not dead: in prose it costs
  tokens every invocation, in a referenced file it costs nothing until read.
- **Phase A never drops a gotcha.** A gotcha may only be cut if a task built to trigger the
  failure it guards passes without it, which a static pass cannot establish.
- **`kind`, prose ratio and section size order the search. They never justify a drop.** The best
  content in most skills, verification steps and irreducible gotchas, is pure prose.
- **Every drop names a rubric category.** If you cannot name one, keep it.

Hand over the diff, the decision table with low-confidence drops on top, and the gotcha inventory.

## Phase B — empirical loop

Follow `references/protocol.md`. The commands, in order:

```sh
node scripts/labinit.mjs <skill> --model <id>
node scripts/run.mjs <lab> --variant control --task <id> --reps 2
node scripts/stub.mjs <lab>
node scripts/run.mjs <lab> --variant stub --task <id> --reps 2
node scripts/run.mjs <lab> --gate                     # BLOCKING
node scripts/stub.mjs <lab> --keep <ids> --label <l>
node scripts/run.mjs <lab> --variant iter --iter <l> --task <id> --reps 2
node scripts/run.mjs <lab> --grade --a <dir> --b <dir>
```

- **`run.mjs` is the only way to start a trial or a grading call.** Improvised setup drifts, and
  drift invalidates every comparison in the lab.
- **`--gate` is blocking; exit 2 means halt.** A stub that passes everything means the harness is
  broken, not that the skill body is worthless.
- **A split result across reps is a keep.** Two reps disagreeing means you do not know.
- Delete the lab when done: `<lab>/config/` holds a copy of the user's credentials.

Validate the rig first per `fixtures/README.md`. Do not self-ablate this skill.

## The two gates

Grading in between is autonomous. **Gate 1, before the runs:** operator reviews `bar.md`,
`tasks.json`, the gotcha inventory — a bad bar wastes every run after it. **Gate 2, after the
rebuild:** rebuilt versus control per task, dropped and extracted with iteration evidence,
thin-margin drops flagged for individual veto. Then spot-check the rebuild in real work: the clean
room cannot see the context pressure that motivates the method.

## References

`references/`: `static-rubric.md` Phase A · `classify.md` deterministic-vs-taste and gotchas ·
`protocol.md` the loop · `bar-template.md` success criteria. Also `SPIKE.md` (why isolation works)
and `fixtures/README.md` (rig validation).
