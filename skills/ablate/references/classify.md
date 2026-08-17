# Classification — deterministic vs taste, and the gotcha inventory

Two judgements the scripts cannot make, done once per skill before any run.

The first decides how the skill gets graded. The second decides which sections are off-limits
until you can reproduce what they guard, and it is the single most important safeguard in this
method.

---

## Part 1 — deterministic or taste?

This picks the grading mechanism, and getting it wrong is expensive in both directions: an LLM
judge on a deterministic skill adds noise and cost to something a three-line assertion settles,
and a script assertion on a taste skill measures nothing that matters.

### Deterministic

The skill's success is checkable by inspecting the output. There is a right answer, or at least a
checkable property.

Signals:

- Output is a file, a command, a JSON document, a specific format.
- The skill's own body states a contract: required fields, required sections, a naming scheme.
- Success is "the tool ran and produced X", not "the result was good".
- Two competent runs would produce near-identical output.

Grade these with **script assertions**. Write them into `tasks.json` as checks: file exists, JSON
parses, output matches this regex, this key is present, the exit code was zero. No LLM judge, no
pairwise comparison, no grader validation needed. These are the cheap skills to ablate and the
right ones to validate the rig on.

### Taste

Success is a judgement. Two good runs differ, and both are fine.

Signals:

- Output is prose, design, a plan, a review, a recommendation.
- The skill's body is largely about *how to decide*, not *what to produce*.
- The word "good" is doing real work in any description of success.
- You would want to read the output before shipping it.

Grade these **pairwise and blind**: randomised A/B of rebuilt versus control against `bar.md`,
scored better / tie / worse. Never absolute scoring — absolute scores drift between calls and
across sessions, and a drifting scale cannot detect a small regression. And never the producing
context: the grader is always a fresh `claude -p`.

Taste skills also require **grader validation**: feed the grader a deliberately degraded output
against the control, once, before any of its verdicts count. A grader that passes an obvious
regression is not a grader, and it will pass everything you show it afterwards.

### Mixed

Most real skills are mixed: a deterministic shell around a taste core. A report generator has a
required structure (deterministic) and content that has to be worth reading (taste).

Handle both, separately, in the same task set. Assert the structure with a script; grade the
content pairwise. Do not average them into one verdict — the structural check will pass while the
content quietly degrades, and the average will look fine.

Record the verdict in `manifest.json` as `classification: "deterministic" | "taste" | "mixed"`.

---

## Part 2 — the gotcha inventory

**A gotcha is a section that exists because something specific went wrong.**

Not "this is important" — *this broke once*. Someone hit a failure, worked out the cause, and
wrote a line into the skill so it would not happen again. That line is now the only surviving
record of the incident.

### Why this matters more than anything else here

This is the most likely way the whole method produces a confidently wrong result.

Gotchas guard rare inputs. Task sets drawn from real transcript history oversample common
workflows, because that is what the history is made of. So the gotcha section is deleted, and
every task passes — because no task went near the rare input. The grader passes everything. The
operator's final review covers the task set, which also does not go near it. Tokens are down,
quality "held", every gate was green.

Then, months later, the skill fails on exactly the input the gotcha guarded, and nothing in the
evidence log explains why.

The section did not survive the experiment. It was never in the experiment.

### The rule

> **You may only delete a gotcha you can reproduce.**

A section marked as a gotcha may only be dropped if a task **built specifically to trigger the
failure it guards** passes without it. Not a task that happens not to fail. A task constructed to
walk into the exact hazard.

Three consequences worth stating plainly:

- **A gotcha you cannot construct a trigger for is a permanent keep.** This will happen, and it is
  the correct outcome, not a failure of the method. Record it as untestable and move on.
- **Phase A never drops a gotcha.** A static audit cannot run the trigger task, so it cannot meet
  the requirement. It records the inventory instead.
- **A gotcha surviving deletion across your existing tasks proves nothing.** That is the trap, not
  the evidence.

### Finding them

Gotchas announce themselves once you know the vocabulary. Scan for:

- **Corrective and adversative openings.** "Note that…", "Be careful…", "However…", "Watch out
  for…", "Do not…", "Never…", "Always…", "Make sure…", "IMPORTANT", "WARNING".
- **Causal justification.** "…because otherwise X", "…or it will fail", "…which silently
  produces". A stated consequence is the strongest single signal in the file: someone knew the
  consequence because they saw it.
- **Oddly specific constraints.** A named version, an exact flag, a hardcoded ordering, a magic
  number, a specific error message. Specificity that precise is remembered, not designed.
- **Negative instructions.** Most of the file says what to do. The lines saying what *not* to do
  usually exist because someone did it.
- **Emphasis out of proportion to length.** A one-line all-caps warning in an otherwise even file
  is a scar.
- **Anything you would call trivia.** That reaction is the tell. Filler reads as important;
  gotchas read as trivial. The feeling is exactly inverted from the value.

Also check the skill's git history if it has one. A one-line addition in its own commit, months
after the file was written, is almost always a gotcha — and the commit message often names the
incident.

### Recording them

One row per gotcha:

| field | content |
|---|---|
| `section` | section id |
| `guards` | the specific failure, concretely. Not "errors" — *what* error, on *what* input. |
| `trigger` | the input or condition that would provoke it, or `UNKNOWN` |
| `verdict` | `irreducible`, `fixable-in-script`, or `untestable` |
| `task` | the task id built to trigger it, once one exists |

If you cannot fill in `guards` concretely, you have not identified a gotcha — you have identified
a section you do not understand. Say so. `verdict: untestable` with an honest `guards: unclear` is
useful; a confident guess is worse than nothing, because it licenses a deletion.

### The three verdicts

**`irreducible`** — the hazard is real and only a note in the skill prevents it. Keep. Most
gotchas are these.

**`fixable-in-script`** — the hazard could be eliminated at the source, so the note would no
longer be needed. A validation that a script could perform. A required flag a wrapper could
always pass. A path a helper could compute.

This verdict is the most dangerous thing in this file, because it is how a gotcha gets laundered:
mark it fixable, delete the line, and never write the fix. Now nothing guards the hazard and the
evidence log says the cut was justified.

So: **`fixable-in-script` is a proposal, not a licence.** The section stays until the fix is
written, merged, and demonstrated. The operator reviews every one of these at gate 1 precisely
because the loop cannot be trusted to make this call about its own convenience.

**`untestable`** — real, but you cannot construct a trigger. Permanent keep. Not a defeat; a
correctly identified limit.

### Feeding the task set

Every `irreducible` and every proposed `fixable-in-script` gotcha needs a task built to trigger
it, per the coverage rule in `protocol.md`. Those tasks are usually the most valuable in the set,
because they are the only ones probing the rare inputs, and they are the ones that would never
appear if you drew tasks from transcript history alone.

Write the trigger task before you know whether the section can be cut. Writing it afterwards
invites writing one the current answer already passes.
