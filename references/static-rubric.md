# Phase A — the static audit rubric

One pass per skill. No trial runs, no lab, no cost beyond a single reasoning pass over the
sections. This is the phase that reclaims most of the available lines, and it is where you should
spend your first hour.

Read this file, run `sections.mjs`, and produce one decision per section. Then hand the diff to
the operator. That is the whole loop.

---

## What Phase A can and cannot conclude

Phase A reasons about a section. It does not test it. Every conclusion here is a hypothesis, and
the report marks it as carrying no iteration evidence — deliberately, because the difference
between "I reasoned this was filler" and "I measured that its absence broke nothing" is the
entire difference between this phase and Phase B.

That is not a reason to distrust Phase A. It is a reason to weight its operations differently:

- **Extract is nearly risk-free.** The content still exists and is still reachable. Worst case
  you added one file read to some invocations.
- **Drop is a real bet.** You are asserting the model does not need those words. Some of those
  bets should be checked empirically before you make them at scale, which is what calibration
  (running Phase B on two or three skills Phase A already scored) is for.

So: extract freely, drop conservatively, and let the operator's diff review be a real gate rather
than a formality.

---

## Step 0 — is this skill even a candidate?

Three cases where the answer is "stop, do something else instead":

**Zero recorded invocations.** Do not ablate a skill you never call — you would be optimising a
cost you do not pay. Its description still loads into every session's system prompt, so the move
is to archive the skill, not to shrink it. `inventory.mjs` flags these.

**Vendor-maintained.** A `SKILL.md` that came from an upstream repository and is updated there
should be **re-pinned from upstream, not ablated.** Ablating it forks it: you inherit the
maintenance, you lose the upstream fixes, and the next `git pull` either clobbers your work or
conflicts with it. Tell-tale signs: a vendor's product vocabulary throughout, a long reference
table that reads like generated documentation, a version or commit pin in the frontmatter, or a
path under a plugins/marketplace directory.

**Already small.** Under about 60 lines there is little to reclaim and the review costs more than
the saving. Spend the pass on a 400-line skill instead.

---

## Step 1 — the three operations

Every section gets exactly one.

### EXTRACT — the highest-value move, and the most under-used

Move the section body to `references/<name>.md` and leave a one-line pointer. The content costs
nothing until something reads it.

Extract when the section is **payload**: material the model consults rather than reasoning it
holds. The test is a question — *would a competent practitioner need to read this end to end
before starting, or only look things up in it partway through?* Look-up material is payload.

Extract candidates:

- Templates, boilerplate, and scaffolds to be filled in.
- Question banks, prompt banks, checklists longer than a handful of items.
- Lookup tables: error code to meaning, flag to behaviour, label to score.
- Long worked examples. One short example earns its place inline; four do not.
- Detailed rubrics and scoring bands.
- Multi-step procedures that only one of several workflows uses.
- Reference documentation for an API or schema.

A section can be big and still be payload; size is not what makes the call. A 40-line table of
score bands is payload. A 40-line explanation of *why* the bands are drawn where they are is
usually not — that is reasoning the model needs while it works.

**Do not extract** the trigger conditions, the workflow order, or the gotchas. Those must be in
the model's context *before* it decides what to do, and a pointer it might not follow is not good
enough. Extracting a gotcha is how you get a gotcha that silently stops working.

### DROP — delete, with a stated reason

Drop when the words do not change behaviour. The categorical cases, in rough order of how much
they typically account for:

**Restated general competence.** Instructions the model would follow anyway. "Write clean,
readable code." "Be thorough." "Consider edge cases." "Use meaningful variable names." "Test your
work." These feel responsible and do nothing: a frontier model does not need to be told that
correctness matters. The diagnostic question is *would a competent practitioner do this without
being told?* If yes, it is filler.

Be careful with the near-miss. "Validate inputs" is general competence. "Validate inputs at the
system boundary only, because this codebase double-validates and it has caused bugs" is a
project-specific constraint that carries real information. The specificity is the signal.

**Motivational and self-congratulatory framing.** "You are an expert…" "This is a powerful
technique…" "Remember, quality matters!" Preamble that describes the skill's own importance
rather than telling the model anything. Frequently the first paragraph of every section.

**Duplication.** The same instruction stated twice in one file — often once in a "principles"
section and again in the step where it applies. Keep it where it applies; drop the abstract
statement. Also look across sibling skills in a family: five skills carrying the same 30-line
preamble means one shared reference file and five pointers.

**Explanation of what the model already knows.** Definitions of standard terms, descriptions of
how a well-known tool works, restatements of a language's semantics. Keep only what is
non-obvious, version-specific, or contrary to the model's default assumption.

**Dead conditionals.** Branches for tools, paths, or workflows that no longer exist. Cheap to
find and free to remove.

**Hedging and meta-commentary.** "You may want to consider possibly…" — either instruct or do
not. Also drop notes addressed to the skill's author rather than its user.

### KEEP — the section survives verbatim

Keep by default when a section is any of the following. When in doubt, keep: a wrong keep costs
tokens, a wrong drop costs a capability, and those are not the same size of mistake.

- **Gotchas.** Anything that exists because something specific went wrong. These are the highest
  value lines in most skills and the most tempting to cut, because a gotcha reads like trivia
  right up until it fires. See `classify.md` for the inventory rules — and note the hard
  constraint: **a gotcha may only be dropped if a task built to trigger it passes without it.**
  Phase A cannot satisfy that, so **Phase A never drops a gotcha.** It records it.
- **Verification steps.** "Check X before proceeding", "confirm the output contains Y". Pure
  prose, easy to mistake for filler, and the reason the skill's output can be trusted.
- **Non-obvious specifics.** Exact flag names, required argument order, an endpoint that behaves
  unlike its siblings, a version-specific behaviour. Anything the model would otherwise guess
  wrong.
- **Ordering and sequencing constraints.** "Do A before B or B fails." Load-bearing and invisible
  once removed.
- **Trigger conditions and scope.** When the skill applies, and when it must not. Cheap to keep,
  expensive to lose.
- **Output contracts.** Required format, required file names, required sections. Downstream
  tooling depends on these.
- **Anything that contradicts a plausible default.** If the instruction exists precisely because
  the obvious approach is wrong here, it is doing the most work per token in the file.

---

## Step 2 — what may never justify a decision

**`kind` and `proseRatio` order the search. They never justify a drop.**

`sections.mjs` reports whether a section is mostly code, table, list or prose. That is scheduling
information: it tells you which sections to look at first. Used as evidence it is actively
harmful, in both directions:

- A `kind=code` prior protects fenced blocks — and fenced blocks are exactly what EXTRACT exists
  to move out of the file.
- A high prose ratio flags the verification steps and gotchas that are the best content in the
  file.

Section size is the same kind of signal. Long does not mean wasteful and short does not mean
essential. The single most valuable line in a skill is often a one-line warning.

---

## Step 3 — the output

For each section id from `sections.mjs`, emit one row:

| field | content |
|---|---|
| `id` | the section id, exactly as `sections.mjs` printed it in *this* pass |
| `op` | `keep`, `drop`, or `extract` |
| `reason` | which rubric category, in a few words. `drop` requires one. |
| `file` | for `extract` only: the target `references/` filename |
| `confidence` | `high`, `medium`, `low` |
| `gotcha` | `yes` if this section guards a specific failure (see `classify.md`) |

Rules the output must satisfy:

- **Every `drop` names a rubric category.** "Seems unnecessary" is not a reason. If you cannot
  name the category, the answer is `keep`.
- **No section marked `gotcha: yes` may be dropped in Phase A.** Ever. Its evidence requirement
  cannot be met without a run.
- **`low` confidence never drops.** Downgrade it to `keep` and note it. Phase A's job is the
  clear cases; the unclear ones are Phase B's, and they are why Phase B exists.
- **Group related extractions.** Four small tables that belong to one workflow become one
  reference file, not four. Every extra file is another read the model has to decide to make.
- **Say what you did not touch and why.** A section you could not confidently classify is a
  finding, not an omission.
- **Re-run `sections.mjs` after any apply before deciding again.** Ids are numbered
  sequentially, so dropping a section renumbers everything below it. A stale id fails loudly
  rather than hitting the wrong section — `apply.mjs` also accepts the slug alone, which
  survives renumbering — but decisions written against a stale listing are still wrong even
  when they resolve.

Then run `apply.mjs` with those decisions, and `report.mjs` for the diff.

---

## Step 4 — the operator review

Phase A ends at a human, always. Hand over three things:

1. The diff.
2. The decision table, sorted with `drop` first and `low`/`medium` confidence at the top of that
   group — put what is most likely to be wrong where it will actually be read.
3. The gotcha inventory from `classify.md`, including everything you kept because of it.

Two warnings worth passing on with the diff:

**The reviewer is reading for capability loss, not for tidiness.** The failure mode is a reviewer
who scans a smaller, cleaner file, finds it reads well, and approves it. A file reading well is
not evidence, because filler reads well too — that is why it survived. Ask of each removal: what
input would now be handled worse?

**Percent reduction is not a score.** A pass that removes 12% of a lean skill did better work
than one that removed 50% of a bloated one by cutting its gotchas. Do not chase the number, and
do not let a small reduction read as a failed pass.

---

## Where Phase A hands off to Phase B

Send a skill to the empirical loop when:

- Phase A wanted to drop something and could not be confident.
- The skill is one whose output quality actually matters to you — taste work, client-facing work.
- You want to know whether this rubric is any good. **Run Phase B on two or three skills Phase A
  has already scored and compare predicted-dead sections to measured-dead ones.** That comparison
  is the only thing that turns this rubric from plausible into calibrated, and it is the highest-
  value use of Phase B's budget. Do it before trusting Phase A across a long tail of skills.
