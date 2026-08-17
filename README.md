<p align="center">
  <img src="assets/maestro-ablate-banner.png" alt="Maestro: Ablate — a Maestro mascot conducts a skill-ablation experiment, retaining its core while removing noise" width="100%" />
</p>

<h1 align="center">Maestro: Ablate</h1>

<p align="center"><strong>Find out what a skill is actually made of. Keep that. Drop the rest.</strong></p>

<p align="center">
  <a href="https://github.com/mbanderas/maestro-ablate/actions/workflows/validate.yml"><img alt="Validation status" src="https://github.com/mbanderas/maestro-ablate/actions/workflows/validate.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-F59E0B" /></a>
</p>

Every skill you install writes its `description` into the system prompt of every session you start, whether that skill is ever invoked or not. Its body loads whenever it fires. Nobody notices the first ten. At forty, a standing block of instructions rides along on every question you ask, including the ones no skill was built for.

The tax is not only tokens. A long skill spends the model's attention on rules that do not apply to the task in front of it, and on a long-context model it competes for the same budget the model would otherwise spend on your actual problem. That is why "it is only a few thousand tokens" is the wrong frame: skill bloat costs quality before it costs money.

Maestro: Ablate is the audit that tells you which parts of a `SKILL.md` are load-bearing, and rebuilds the file without the parts that are not.

> Extract before you drop. Never cut a gotcha you cannot reproduce. Every drop names a reason.

## The method

Ablation is borrowed from experimental biology: remove a part, then see whether the organism still works. Remove a section from a `SKILL.md`, run the tasks the skill exists to serve, and see whether the output still clears the bar. A section whose absence changes nothing was never earning its place.

The hard part is not the cutting. It is knowing that the measurement means anything, which is where most attempts at this quietly fail. A harness that measures nothing reports the entire skill as dead weight, and it reports it confidently.

## What Ablate does

| Capability | What it does |
|---|---|
| Inventory | Ranks every installed skill by lines multiplied by recorded usage, reading local transcripts to find which skills you actually invoke |
| Static audit | Runs one rubric pass over a `SKILL.md`, classifies each section, and produces a decision table and a reviewable diff before anything is written |
| Payload extraction | Moves templates, lookup tables, and question banks into referenced files, where they cost nothing until the model reads them |
| Rebuild | Rewrites the skill from the decision table, refusing to write into a skill root that is not a clean git repository |
| Empirical loop | Runs baseline, stub, and measured add-back trials as real `claude -p` invocations in an isolated lab, then grades them pairwise |
| Positive controls | Blocks the loop when the stub passes everything, when the control never proves the skill fired, or when the grader misses a planted regression |
| Gotcha inventory | Records what each defensive section guards, and refuses to drop it until a task built to trigger that failure passes without it |
| Reporting | Records the before and after delta, the model id, and the CLI version, so a result can be re-read after the next model release |

## Two phases, and the order matters

**Phase A is a static audit.** One reasoning pass per skill, no trial runs. It extracts payload into files, deletes categorical filler, and hands you a diff. It is cheap enough to run across every skill you own.

**Phase B is an empirical loop.** Baseline, stub, measured add-back, parity check, with real `claude -p` runs at every step. It is expensive. Reserve it for the few skills where taste matters most, and for calibrating the Phase A rubric against measured ground truth.

Run Phase A first, always. It reclaims most of the available lines at a small fraction of Phase B's cost, and payload extraction is nearly risk-free. Phase A without Phase B is unverified. Phase B without Phase A is unaffordable at any real skill count. The two belong together, in that order.

Before either one, run the inventory and read the zero-usage rows. A skill you never invoke still loads its description into every session you start. Archiving unused skills is likely the largest single win available to you, and it costs nothing to do.

## What Phase B costs

Phase B spends real money against your own Claude subscription or API account, and consumes your own rate limits. The runs are nested `claude -p` invocations. They bill to you, and they compete with the session you are working in.

At the coverage rule this skill enforces, 4 to 6 tasks times 2 repetitions times (1 control plus 1 stub) is 16 to 24 runs before a single section has been judged. A realistic add-back sequence lands somewhere between 30 and 60 runs in total, plus grading calls. On a mid-sized model that is dollars rather than cents, and on a frontier model it is more than that.

Do not start a Phase B loop casually. Phase A costs one reasoning pass per skill.

## Put your skills under version control first

`~/.claude/skills/` has no version control by default, and this tool destructively rewrites `SKILL.md` files.

```sh
cd ~/.claude/skills
git init
git add -A
git commit -m "chore: snapshot skills before ablation"
```

The rebuild step refuses to write into a skill root that is not a git repository with a clean tree unless you pass `--force`. It also leaves a `SKILL.md.pre-ablation.bak` beside the file, but treat that as a convenience rather than as the safety net. Git is the safety net. It is what lets you re-expand a skill when the next model release changes what that skill needs.

## Install from GitHub

### Claude Code

```text
/plugin marketplace add mbanderas/maestro-ablate
/plugin install maestro-ablate@maestro-ablate
```

### Codex

```sh
codex plugin marketplace add mbanderas/maestro-ablate
codex plugin add maestro-ablate@maestro-ablate
```

Start a new task or restart the host after installation so its skill registry reloads.

### Portable local install

Clone the repository, then install the skill for Codex, Claude Code, or both:

```sh
git clone https://github.com/mbanderas/maestro-ablate.git
cd maestro-ablate
node scripts/install.mjs --target universal --scope user
```

The universal user install writes to `~/.agents/skills/ablate` for Codex and Agent Skills-compatible hosts, and to `~/.claude/skills/ablate` for Claude Code. Select one host, project scope, or a dry run:

```sh
node scripts/install.mjs --target codex --scope user
node scripts/install.mjs --target claude --scope project
node scripts/install.mjs --target universal --scope user --dry-run
```

Use `--force` only when replacing a different copy at the exact `ablate` destination.

If you would rather keep the repository in your own workspace and link it, so that edits take effect immediately with no copy to keep in sync:

```sh
# macOS and Linux
ln -s /path/to/maestro-ablate/skills/ablate ~/.claude/skills/ablate
```

```powershell
# Windows (a junction, which needs no administrator rights)
New-Item -ItemType Junction -Path "$HOME\.claude\skills\ablate" -Target "C:\path\to\maestro-ablate\skills\ablate"
```

### Requirements

Node 20 or later (developed on v24.12.0) and the `claude` CLI on your `PATH` for Phase B. The skill itself declares no npm dependency and uses the Node standard library only.

## Invoke Ablate

Use `/ablate` in Claude Code, or `$ablate` in Codex.

```text
/ablate Rank my skills by how much context they cost me per session.
```

```text
/ablate Audit this SKILL.md against the rubric and show me the decision table before you write anything.
```

```text
/ablate Measure which sections of this skill are load-bearing. Tell me what it will cost first.
```

## Verify the rig before you trust it

Phase A needs nothing but the scripts. Before trusting Phase B, run the fixture check in [`skills/ablate/fixtures/README.md`](skills/ablate/fixtures/README.md).

`rig-check` is a deliberately trivial skill whose every rule is arbitrary: an output header, a token, and a count derived from a made-up rule. None of it can be guessed or inferred, so a run that answers correctly can only have read the skill body. That is what makes it a usable positive control. Expect six `PASS` lines.

Run it again after any `claude` CLI upgrade. The isolation this depends on is not documented API, and it has already changed shape once. [`skills/ablate/SPIKE.md`](skills/ablate/SPIKE.md) records what was measured and why the lab sits where it does.

## What is in the package

```
skills/ablate/
  SKILL.md                what Claude reads (under 100 lines, on purpose)
  scripts/
    inventory.mjs         rank targets by lines x recorded usage
    sections.mjs          split a SKILL.md into addressable sections
    apply.mjs             rebuild it: keep, drop, extract
    report.mjs            before and after delta, and the cumulative log
    labinit.mjs           build the clean room
    stub.mjs              set the lab to a chosen section subset
    run.mjs               the only thing that starts a claude process
  references/             rubric, classification, protocol, bar template
  fixtures/               the positive-control fixture
  SPIKE.md                what was measured about isolation, and why
```

## A note on the lab

Phase B runs headless `claude` processes in an isolated lab. To authenticate, that lab holds a copy of your Claude credentials in `<lab>/config/`. Permissions are restricted to your user account, and the setup step verifies the copy is readable before going further. The lab is created outside your home directory so that ambient user memory cannot reach a trial and quietly contaminate the comparison.

Delete labs when you are finished with them. The path is printed at the end of every setup run, and `labinit.mjs --clean` removes an existing one.

## Honest limits

**The clean room cannot observe the thing that motivates the method.** Trials run in an isolated lab with no ambient context, which is what makes them comparable, and also what stops the lab from seeing the attention contention that makes a bloated skill expensive in real work. A section that is harmless in isolation may matter in the middle of a full working session. Use each rebuilt skill once in real work before you trust it.

**Results are specific to the model you measured against.** A skill ablated against one model may under-serve the next. Reports record the model id and the CLI version for exactly that reason, and git history is how you re-expand.

**Absence of harm is not presence of benefit.** The loop proves that a cut did not break anything. It does not prove the cut helped. Grading is pairwise (better, tie, worse) partly to keep this visible: if rebuilt skills never beat their originals even in the lab, the benefit claim rests on production contention the lab cannot measure. The cumulative log surfaces that rather than hiding it.

**You can only delete a gotcha you can reproduce.** Sections that guard rare inputs are the most likely thing to be cut wrongly, because task sets drawn from real history oversample common workflows. The protocol requires a task built to trigger each gotcha before that gotcha may be dropped. This is a real constraint on how fast you can go, and it is deliberate.

## Prior art

The method comes from Mansel Scheffel's video on skill ablation: <https://www.youtube.com/watch?v=MwJ2cK1tQCg>. The core idea, stub the skill, measure what breaks, add back only what is load-bearing, is his.

This is an independent implementation. The departures are worth naming plainly:

- **A multi-task coverage rule** instead of a fixed task minimum: one task per workflow the skill's own description claims to serve, so that a multi-purpose skill cannot be judged by one of its jobs.
- **A gotcha reproduction gate**: a section that exists to guard a specific failure may only be deleted if a task constructed to trigger that failure passes without it.
- **Positive controls**: the stub run must fail at least one task or the loop halts, the control transcript must prove the skill actually fired, and the grader must catch a planted regression before its autonomous verdicts count. Without these, a harness that measures nothing reports the whole skill as dead weight.
- **Payload extraction** as a first-class operation alongside keep and drop. A template or a lookup table is usually not dead, it is misplaced. In prose it costs tokens on every invocation. In a referenced file it costs nothing until read.
- **A static audit phase** that covers every skill cheaply, with the empirical loop reserved for calibration and for the skills where it pays.

## Part of Maestro

Maestro: Ablate is one of the [Maestro](https://github.com/mbanderas/maestro) family of Agent Skills packages, alongside [Agora](https://github.com/mbanderas/maestro-agora) for argument-first writing and [Vinci](https://github.com/mbanderas/maestro-vinci) for design. Each installs on its own.

## Development

Requires Node.js 20 or later and npm.

```sh
npm ci
npm run check
```

`npm run check` validates the plugin manifests and the skill file set, then runs the installer and validator tests. CI runs the same check on Windows and Ubuntu.

## Legal and security

- [License](LICENSE)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [Disclaimer](DISCLAIMER.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Asset provenance](assets/PROVENANCE.md)
