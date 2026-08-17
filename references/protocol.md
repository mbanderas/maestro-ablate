# Phase B — the empirical ablation loop

The expensive half. Every step here costs real `claude -p` calls against your own account, and
they compete with the session you are working in. Run Phase A first; come here for the skills
where you need to *know*, and to calibrate the Phase A rubric against something measured.

**Before you start, read the cost line in `SKILL.md` and mean it.** A single skill through this
loop is tens of runs. Deciding halfway through that the task set was wrong means starting again.

---

## The shape of it

```
classify -> author tasks + bar -> GATE 1 -> control -> stub -> POSITIVE CONTROLS
    -> failure-directed add-back -> parity -> GATE 2 -> apply -> report -> production check
```

Two operator gates, and grading is autonomous in between. Signing off forty iterations is not a
review, it is a rubber stamp; two well-placed gates are.

---

## 1. Build the lab

```sh
node scripts/labinit.mjs <skill> --model <model-id>
```

This creates the clean room, copies the skill to project level inside it, seeds the config
directory, and refuses outright if the lab would inherit an ancestor `CLAUDE.md`. Take that
refusal seriously: contamination there is invisible in every output and poisons the whole run. See
`SPIKE.md` for why the obvious lab location is the wrong one.

`<lab>/config/` receives a copy of your credentials so headless runs can authenticate.
Permissions are restricted to you. **Delete the lab when you are done.**

## 2. Classify, and inventory the gotchas

Per `references/classify.md`. Record `classification` in `tasks.json` — it decides whether grading
is script assertions or a pairwise LLM judge, and running the wrong one wastes the entire budget.

The gotcha inventory is not optional bookkeeping. It is the list of sections that are off-limits
until you can reproduce what they guard, and it is the single thing standing between this method
and a confidently wrong result.

## 3. Author the task set — the coverage rule

Not "at least three tasks". **Coverage:**

- **One task per workflow the skill's own description claims to serve.** The description is the
  promise; each clause of it is a thing the skill must still be able to do. A skill judged by one
  of its five jobs will be gutted for the other four.
- **One task per identified gotcha, constructed to trigger it.** Not a task that happens to pass
  through the area. A task that walks into the exact hazard.
- **Draw from real transcript history where you can.** Real requests are shaped differently from
  invented ones, and the difference shows up in what the skill needs.

Write each task the way a user would actually ask, not as an instruction to the skill. The skill's
own job is to shape the response; a prompt that pre-shapes it measures your prompt instead.

Task shape:

```json
{
  "skill": "<name>",
  "classification": "deterministic | taste | mixed",
  "tasks": [
    {
      "id": "t1-basic-report",
      "workflow": "which clause of the description this covers",
      "gotcha": null,
      "prompt": "Write the audit report for example.com to {{OUT}}/report.md.",
      "assert": [
        { "type": "file-exists", "file": "report.md" },
        { "type": "file-contains", "file": "report.md", "value": "## Findings" }
      ]
    }
  ]
}
```

`{{OUT}}` becomes that run's own output directory, so file assertions are per run rather than
colliding in the lab root.

Assertion types: `contains`, `not-contains`, `regex`, `min-length`, `file-exists`,
`file-contains`, `json-valid`.

**Assert what you can, even on taste skills.** A structural assertion is free, deterministic, and
catches the case where the output degrades into something shaped nothing like the contract. Grade
the substance pairwise on top of that. Do not merge the two into one verdict — the structural
check will keep passing while the substance quietly rots, and the merged number will look fine.

A task with no assertions and no pairwise grade cannot fail, and a variant that cannot fail cannot
be evidence. `--gate` will tell you so.

## 4. Write `bar.md`

Use `references/bar-template.md`. One instruction matters more than the rest, so it is here too:

**Do not write the bar by looking at the control output.** A bar derived from the baseline collapses
grading into "did anything change", which biases every comparison toward keeping everything —
including all the filler you came to remove.

Write the bar *before* you run the control, from the task and the skill's promise. If you have
already seen the control output, write the bar from the task description alone and resist
importing details you remember.

## 5. Operator gate 1

Review `bar.md`, `tasks.json`, and the gotcha inventory — including every section marked
`fixable-in-script`, which is where a gotcha gets laundered.

This is the highest-leverage human moment in the whole method. A bad bar wastes every run that
follows it, and you will not find out until the end.

## 6. Control runs

```sh
node scripts/run.mjs <lab> --variant control --task t1-basic-report --reps 2
```

`--reps 2` at minimum, for every task. Non-determinism reads as regression, and a task the full
skill passes only sometimes will generate failures that get misattributed to a missing section.

**A flaky control must be fixed before any section is judged against it.** Either the task is
underspecified or the assertion is too tight. `--gate` flags it as `control-stable`.

Each control run also asserts that the skill fired. A control run that did not fire the skill
measured nothing.

## 7. Stub runs

```sh
node scripts/stub.mjs <lab>
node scripts/run.mjs <lab> --variant stub --task t1-basic-report --reps 2
```

`stub.mjs` reduces the lab copy to frontmatter only — `name` and `description` verbatim, body
gone. Frontmatter stays because it is the trigger surface: empty the description and the skill
never fires, and every task then fails for a reason unrelated to any section.

## 8. The positive controls — blocking

```sh
node scripts/run.mjs <lab> --gate
```

Nothing downstream means anything until this passes. Exit code 2 means halt.

| control | requirement |
|---|---|
| `stub-fails` | The stub must fail at least one task. |
| `skill-fired` | Every control transcript must show the skill under test firing. |
| `grader-validated` | For taste and mixed skills, the grader must have caught a planted regression. |
| `control-stable` | No control task may pass only intermittently. |
| `isolated` | No ancestor `CLAUDE.md` in scope; every run's transcript under the lab config. |

**If the stub passes everything, the harness is broken — not the skill.** A skill stripped to two
frontmatter lines cannot do its job. A passing stub means the tasks are too easy to need the
skill, the assertions are too loose to notice, or the runs are somehow loading the real skill
instead of the lab copy. Investigate in that order.

Validate the grader before its verdicts count:

```sh
node scripts/run.mjs <lab> --validate-grader --run <lab>/control/t1-basic-report/1
```

It grades the real output against a truncated third of itself. A grader that cannot see that loss
will pass everything you show it afterwards.

## 9. Failure-directed batch add-back

Neither blind greedy nor blind bisection.

1. **Cluster the stub failures.** Group them by what is actually missing — not by task. Three
   tasks failing for one reason is one cluster.
2. **Hypothesise the minimal section set per cluster.** Which sections, together, supply what the
   cluster lacks?
3. **Add the whole set back at once and verify.**
   ```sh
   node scripts/stub.mjs <lab> --keep s03,s07,s11 --label iter-001
   node scripts/run.mjs <lab> --variant iter --iter 001-s03-s07-s11 --task t1-basic-report --reps 2
   ```
4. **Spot-remove only the sections you doubt.** One at a time, from the set that worked.

One-at-a-time greedy from the start mismeasures jointly-necessary sections: neither alone fixes
the failure, so both get condemned. Bisection destroys per-section attribution — and that
attribution is exactly what makes re-ablation cheap at the next model release, when you need to
know *why* each section was kept. Keep bisection as a fallback for outliers with 20+ sections.

Every iteration's grades persist to `manifest.json` as they happen. A crash or a compacted context
at iteration 30 must not lose the run.

## 10. Grading

```sh
node scripts/run.mjs <lab> --grade --a <control-run-dir> --b <iter-run-dir>
```

Blind, side-randomised, in a fresh context, against `bar.md`, scored better / tie / worse.

- **Fresh context, always.** The context that produced an output cannot judge it.
- **Pairwise, not absolute.** Absolute scores drift between calls, and a drifting scale cannot
  detect a small regression.
- **Deterministic skills:** assertions only. No LLM judge. Cheaper, and sharper.

Record better / tie / worse rather than pass / fail even when you only care about "no worse". It
costs nothing and it is the only way the benefit claim stays falsifiable: if rebuilt skills never
beat originals even in the lab, then the benefit rests entirely on production context pressure the
lab cannot observe. `report.mjs --cumulative` surfaces that instead of hiding it.

## 11. The drop rule

A section may be dropped only if:

- it survives deletion across **all** tasks, at `--reps 2` or more; **and**
- **if it is a gotcha,** the task built to trigger that gotcha passed without it; **and**
- the drop cites the iteration ids where its absence caused no failure.

A split result — passes in one rep, fails in another — is a **keep**. Two reps disagreeing means
you do not know, and "we do not know" resolves to keep.

`kind`, `proseRatio` and section size may order which sections you try first. They may never
justify a drop. Evidence is runs.

## 12. Operator gate 2

```sh
node scripts/apply.mjs <skill> --decisions decisions.json
node scripts/report.mjs <skill> --lab <lab> --model <model-id>
```

Present side by side, per task: rebuilt versus control, the dropped and extracted list with the
iteration evidence for each, and a flagged sub-list of **thin-margin drops** — anything decided on
one rep, a low-confidence call, or a tie rather than a clear pass. The operator vetoes those
individually and you re-run `apply.mjs` once with the vetoes restored to `keep`.

## 13. Production spot-check

The real final gate, and the one that is easy to skip.

Use the rebuilt skill once in actual work, with full ambient context, before you consider the
ablation done. The lab cannot observe the attention contention that motivates this entire method,
which cuts both ways: a section harmless in the clean room may matter amid a real session.

Git history is the rollback path. `report.mjs` recorded the model id and CLI version, so when the
next model lands you can re-run this loop knowing what the last answer was measured against.

---

## Families of near-identical skills

Do not run this loop 60 times over a family of siblings.

Ablate **one representative deeply**. Template the resulting cuts across the siblings by hand —
they are near-identical, so the same sections are dead in each. Then verify each sibling with a
**single** comparison run. That is one deep loop plus N cheap checks, instead of N deep loops.

## Self-ablation

Do not run this loop on `skill-ablation` itself. Each of its tasks would be a full ablation of
another skill: recursive, and prohibitively expensive. Validate the rig on a small deterministic
skill instead.
