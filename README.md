# skill-ablation

A Claude Code skill that finds which parts of a `SKILL.md` earn their tokens, and rebuilds the
skill without the rest.

## Why bother

A skill's `description` loads into the system prompt of **every** session, whether the skill is
ever invoked or not. Its body loads whenever it fires. Once you have a few dozen skills, that is
a standing tax on every single thing you do.

The tax is not only tokens. A long skill spends the model's attention on instructions that do not
apply to the task at hand, and on a long-context model it competes for the same budget the model
would otherwise spend thinking about your actual problem. Skill bloat costs quality, not just
money — which is why "it's only a few thousand tokens" is the wrong frame.

Ablation borrows the method from experimental biology: remove a part, see whether the organism
still works. Remove a section from a `SKILL.md`, run the tasks the skill exists to serve, and see
whether the output still clears the bar. Sections whose absence changes nothing were never
earning their place.

## The two phases

**Phase A — static audit.** One rubric pass per skill, no trial runs. Extracts payload
(templates, lookup tables, question banks) into files that cost nothing until read, deletes
categorical filler, and produces a reviewable diff. Cheap enough to run across every skill you
own.

**Phase B — empirical ablation loop.** Baseline → stub → measured add-back → parity check, with
real `claude -p` runs at every step. Expensive. Reserved for the handful of skills where taste
matters most, and for calibrating the Phase A rubric against measured ground truth.

**Run Phase A first. Always.** It reclaims most of the available lines at a small fraction of
Phase B's cost, and it is nearly risk-free for payload extraction. Phase A without Phase B is
unverified; Phase B without Phase A is unaffordable at any real skill count. The two belong
together, in that order.

Before either, run the inventory and look at the zero-usage rows. Skills you never invoke still
load their descriptions into every session. **Archiving unused skills is likely the single
largest win available, and it costs nothing to do.**

## Cost warning

**Phase B spends real money against your own Claude subscription or API account, and consumes
your own rate limits.** The runs are nested `claude -p` invocations; they bill to you and they
compete with the session you are working in.

Ballpark for one skill, at the coverage rule this skill enforces: 4–6 tasks × 2 repetitions ×
(1 control + 1 stub) is 16–24 runs before a single section has been judged, and a realistic
add-back sequence lands somewhere between 30 and 60 runs total, plus grading calls. On a
mid-sized model that is dollars, not cents, and on a frontier model it is more than that.

Do not kick off a Phase B loop casually. Phase A costs one rubric call per skill.

## Safety: version-control your skills first

`~/.claude/skills/` has no version control by default, and this tool destructively rewrites
`SKILL.md` files.

```sh
cd ~/.claude/skills
git init
git add -A
git commit -m "chore: snapshot skills before ablation"
```

`apply.mjs` refuses to write into a skill root that is not a git repository with a clean tree
unless you pass `--force`. It also writes a `SKILL.md.pre-ablation.bak`, but treat that as a
convenience, not as the safety net. Git is the safety net; it is what lets you re-expand a skill
when the next model release changes what the skill needs.

## Install

Requires **Node ≥ 20** (developed on v24.12.0) and the `claude` CLI on your `PATH`.
**Zero npm dependencies** — Node's standard library only, nothing to install.

Clone straight into place:

```sh
git clone https://github.com/<you>/skill-ablation ~/.claude/skills/skill-ablation
```

The repository root *is* the skill, so that is all it takes.

If you would rather keep it in your own workspace and link it — edits then take effect
immediately in every repo, with no copy to keep in sync:

```sh
# macOS / Linux
ln -s /path/to/skill-ablation ~/.claude/skills/skill-ablation
```

```powershell
# Windows (junction; no administrator rights needed, unlike a symlink)
New-Item -ItemType Junction -Path "$HOME\.claude\skills\skill-ablation" -Target "C:\path\to\skill-ablation"
```

Then ask Claude Code to audit a skill, or invoke it by name.

## Honest limits

- **The clean room cannot observe the thing that motivates the method.** Trials run in an
  isolated lab with no ambient context, which is what makes them comparable — and also means the
  lab cannot see the attention contention that makes a bloated skill expensive in real work. A
  section that is harmless in isolation may matter amid a full working session. Use each rebuilt
  skill once in real work before you trust it.
- **Results are specific to the model you measured against.** A skill ablated against one model
  may under-serve the next. Reports record the model id and the CLI version for exactly this
  reason, and git history is how you re-expand.
- **Absence of harm is not presence of benefit.** The loop proves a cut did not break anything.
  It does not prove the cut helped. Grading is pairwise (better / tie / worse) partly so that
  this stays visible: if rebuilt skills never beat their originals even in the lab, the benefit
  claim rests on production contention the lab cannot measure. The cumulative log surfaces that
  rather than hiding it.
- **You can only delete a gotcha you can reproduce.** Sections that guard rare inputs are the
  most likely thing to be deleted wrongly, because task sets drawn from real history oversample
  common workflows. The protocol requires a task built to trigger each gotcha before that gotcha
  may be cut. This is a real constraint on how fast you can go, and it is deliberate.

## Prior art

The method comes from **Mansel Scheffel's video on skill ablation**:
<https://www.youtube.com/watch?v=MwJ2cK1tQCg>. The core idea — stub the skill, measure what
breaks, add back only what is load-bearing — is his.

This is an independent implementation, with departures worth naming plainly:

- **Multi-task coverage rule** instead of a fixed task minimum: one task per workflow the skill's
  own description claims to serve, so a multi-purpose skill cannot be judged by one of its jobs.
- **Gotcha reproduction gate**: a section that exists to guard a specific failure may only be
  deleted if a task constructed to trigger that failure passes without it.
- **Positive controls**: the stub run must fail at least one task or the loop halts, the control
  transcript must prove the skill actually fired, and the grader must catch a planted regression
  before its autonomous verdicts count. Without these, a harness that measures nothing reports
  the whole skill as dead weight, confidently.
- **Payload extraction** as a first-class operation alongside keep and drop. A template or lookup
  table is usually not dead — it is misplaced. In prose it costs tokens on every invocation; in a
  referenced file it costs nothing until read.
- **A static audit phase** that covers every skill cheaply, with the empirical loop reserved for
  calibration and for the skills where it pays.

## License

MIT. See [LICENSE](LICENSE).
