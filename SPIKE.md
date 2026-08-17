# Isolation spike — findings

Pre-build validation of the clean-room design (design spec §4.2, validation checklist items 1
and 2). Run before any script was written, because the CLI behaviour this depends on is not
documented and varies by version.

**Environment:** Claude Code `2.1.233`, Node `v24.12.0`, Windows 11, subscription (OAuth) auth,
`claude` resolved to a native `.exe` on `PATH`. Nine headless probe runs, ~$0.34 total.

Notation: `<home>` is the user's home directory, `<lab>` the clean-room root.

---

## Verdict

**Isolation works, but not for the reason the spec assumed.** `CLAUDE_CONFIG_DIR` alone is
insufficient on Windows. The working recipe has two parts, and both are load-bearing:

1. `CLAUDE_CONFIG_DIR` → `<lab>/config/`, with `.credentials.json`, `settings.json` and
   `.claude.json` seeded into it.
2. **The lab must live outside the user's home directory.**

With both in place, a headless run from `<lab>` sees: the project-level skill under test, the
CLI's own built-in skills, the lab's own `CLAUDE.md`, and nothing else. No user-level skills, no
user-level `CLAUDE.md`, no user hooks, no MCP servers.

The empirical loop (Phase B) is buildable as specced.

---

## 1. Project-level skill resolution — CONFIRMED

A skill at `<lab>/.claude/skills/<name>/SKILL.md` resolves and fires under
`CLAUDE_CONFIG_DIR` redirection. The probe skill's body instructed the model to emit a magic
token; the token came back on every run, and the transcript carried the matching record:

```json
{"type":"tool_use","name":"Skill","input":{"skill":"spike-probe"}}
```

This confirms the spec's central claim: project-level skill resolution is independent of the
config dir. It also confirms the transcript is a usable substrate for the **skill-fired
assertion** the positive controls need — the `Skill` tool_use record is present and machine-
checkable.

The v1 layout (`<lab>/skill/`) was correctly diagnosed as unresolvable; it was not tested,
because the corrected layout works and testing a path that resolves nowhere proves nothing.

## 2. User-level skills do NOT load — CONFIRMED

Asked to enumerate its available skills, the isolated run listed the probe skill plus twelve
CLI built-ins (`dataviz`, `code-review`, `simplify`, `update-config`, `keybindings-help`,
`fewer-permission-prompts`, `loop`, `schedule`, `claude-api`, `run`, `init`, `security-review`).

None of the user-level or plugin skills installed on the machine appeared. `CLAUDE_CONFIG_DIR`
redirection is doing its job here.

**Caveat to carry into the protocol.** The twelve built-ins cannot be excluded without
`--disable-slash-commands`, which would also disable the skill under test. Their descriptions
are a fixed cost present identically in the control and stub variants, so they do not bias a
differential measurement — but they are not zero, and a task whose wording could plausibly
trigger `code-review` or `simplify` should be reworded.

## 3. User-level `CLAUDE.md` DOES leak — SPEC CONTRADICTED, then fixed

This is the one place reality contradicted the spec.

The spec (§4.2) treats ancestor-`CLAUDE.md` traversal as one of the problems
`CLAUDE_CONFIG_DIR` solves. It is not. With the config dir redirected, a lab under
`os.tmpdir()` still loaded `<home>/.claude/CLAUDE.md`. The run reproduced specific,
unguessable content from that file — a named deploy platform, a numeric line-count limit, a
distinctive project-specific rule — and, asked to name its memory sources, printed the path
outright.

Four probes isolated the mechanism:

| Probe | Setup | User `CLAUDE.md` loaded? |
|---|---|---|
| 1 | `CLAUDE_CONFIG_DIR` → `<lab>/config`, lab under `os.tmpdir()` | **yes** |
| 2 | + a decoy `CLAUDE.md` inside the redirected config dir | **yes** — *both* loaded |
| 3 | + `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH` all overridden | **yes** |
| 4 | lab relocated outside the home directory | **no** |

Probe 3 rules out home-directory resolution: overriding every home variable changed nothing.
Probe 4 identifies the real mechanism — **the CLI walks cwd's ancestors looking for
`<ancestor>/.claude/CLAUDE.md`**, and on Windows `os.tmpdir()` sits at
`<home>/AppData/Local/Temp`, so `<home>/.claude/CLAUDE.md` is an ancestor hit.

Note what probe 2 shows: `<config>/CLAUDE.md` loads *in addition to* the ancestor file, not
instead of it. The config dir is one memory source among several, not a replacement root.

An earlier check that walked the ancestors looking for `<ancestor>/CLAUDE.md` found nothing and
was misleading. The traversal looks inside `.claude/`.

### Rejected fix: `--setting-sources project`

`--setting-sources user,project,local` looked like a cleaner lever. It is not: with
`--setting-sources project` from an inside-home lab, the user-level `CLAUDE.md` still loaded in
full. The flag gates *settings* files, not memory files.

### Rejected fix: `--safe-mode` and `--bare`

- `--safe-mode` disables all customisations *including skills*, so it disables the skill under
  test. Unusable.
- `--bare` skips hooks, plugins, and `CLAUDE.md` auto-discovery — genuinely attractive, and
  skills still resolve by explicit `/name` invocation, which is exactly the forced-invocation
  protocol. But it reads auth strictly from `ANTHROPIC_API_KEY` or an `apiKeyHelper`; OAuth and
  keychain are never consulted. Subscription users cannot use it. Worth documenting as an
  option for API-key users; not the default.

### Adopted fix: lab outside the home directory

`run.mjs`/`labinit.mjs` must default the lab root to a path that is not under `os.homedir()`:

- **Windows:** `%SystemDrive%\skill-ablation-labs` — confirmed creatable and writable without
  elevation.
- **macOS / Linux:** `os.tmpdir()` is already outside `$HOME` (`/tmp`, `/var/folders/…`), so the
  ordinary temp default is fine.

`labinit.mjs` must also *verify* the chosen lab root is not under `os.homedir()` and refuse to
proceed if it is, including when the user passes `--lab` explicitly. Silent leakage here
contaminates every measurement in the run, and the failure mode is invisible in the output.

## 4. Authentication — CONFIRMED, and the credentials copy is load-bearing

Copying `.credentials.json` into the redirected config dir is required, exactly as specced.
Negative control, config dir seeded with `settings.json` and `.claude.json` but no credentials:

```
exit 1 · is_error: true · "Not logged in · Please run /login"
```

With the file copied, every run authenticated and reported a normal per-run cost. Onboarding
never fired: seeding `<config>/.claude.json` with `hasCompletedOnboarding: true`,
`bypassPermissionsModeAccepted: true`, `numStartups`, `installMethod`, `userID` and the OAuth
account block from the real state file was sufficient.

`.claude.json` lives at `<home>/.claude.json` — *beside* `.claude/`, not inside it — but under
redirection the CLI reads and writes `<config>/.claude.json`. Confirmed by observing the CLI
create and populate that file, and by transcripts landing under `<config>/projects/…`. The
transcript path is a cheap, deterministic assertion that redirection actually took effect, and
`run.mjs` should check it rather than trusting the env var was honoured.

## 5. Nested spawning on Windows — CONFIRMED, with one correction

Every probe was launched from Node running inside a live Claude Code session. All completed.
Nested `claude -p` works.

**Spawn mode.** On this machine `claude` is a native `.exe`, so `shell: false` works directly;
`shell: true` also works. Both were tested and both resolve the skill and authenticate. Since
other install methods do put a `.cmd` shim on `PATH` — which `shell: false` cannot execute on
Windows — `run.mjs` attempts a direct spawn and falls back to shell mode only when the process
cannot be started at all. That keeps the common path free of shell quoting entirely while still
supporting shim installs.

**The prompt must go over stdin, not argv.** This is the correction. Shell-mode spawn
concatenates arguments without escaping (Node `DEP0190`). A multi-line prompt containing quotes
passed as `-p <prompt>` was silently mangled: the CLI received a truncated fragment and replied
`"I'm here and ready. What would you like to work on?"` — exit 0, `is_error: false`, no error
anywhere. A corrupted prompt that reports success is precisely the kind of silent measurement
failure trap 7 exists to catch, and it would have been attributed to the ablation.

Passing `-p` with no positional argument and writing the prompt to the child's stdin fixed it
completely, and works identically in both spawn modes. It also removes a `no stdin data
received in 3s` warning and the 3-second stall that goes with it: with `-p <prompt>` in argv
the CLI still waits on stdin.

Task prompts will be long and will contain quotes and newlines. **Prompts go over stdin.**

**Env stripping.** Stripping inherited `CLAUDE*` and `ANTHROPIC*` variables works and is what
`run.mjs` will do. Honesty about the evidence: a control run that *left* them in place also
succeeded on `2.1.233`, so stripping is not currently required to get a run to complete. It is
retained anyway — inheriting a parent's `CLAUDE_CONFIG_DIR` would silently nest one lab inside
another, and `CLAUDECODE` / `CLAUDE_CODE_SESSION_ID` are exactly the kind of ambient state whose
effect on a nested run is undocumented and version-dependent.

---

## Settled parameters for `run.mjs`

| Parameter | Value | Why |
|---|---|---|
| lab root | outside `os.homedir()`; Windows `%SystemDrive%\skill-ablation-labs` | §3 — ancestor `.claude/CLAUDE.md` traversal |
| `CLAUDE_CONFIG_DIR` | `<lab>/config` | suppresses user skills, settings, hooks, MCP |
| config seed | `.credentials.json`, minimal `settings.json`, `.claude.json` | §4 — auth and onboarding |
| prompt channel | child stdin | §5 — argv mangling under shell-mode spawn |
| `shell:` | direct spawn first, shell mode only if the process cannot start | native binary needs no shell; `.cmd` shim installs cannot run without one |
| env | strip `/^CLAUDE/i` and `/^ANTHROPIC/i`, then set `CLAUDE_CONFIG_DIR` | §5 |
| args | `-p --output-format json --model <id> --permission-mode bypassPermissions` | JSON gives `session_id`, `is_error`, `total_cost_usd` |
| skill-fired assertion | `Skill` tool_use record with matching `input.skill` in the transcript | §1 |
| redirection assertion | transcript written under `<config>/projects/` | §4 |

## Scope of this document

Everything above concerns isolating a run from the *user's own configuration* — memory, skills,
settings, hooks, MCP servers. That is one of two isolation problems, and the smaller one.

The other is isolating runs from **each other and from the lab**: a run has filesystem tools, and
a stub run in particular has every incentive to go looking for the instructions it is missing.
That problem was found later, during rig validation, and it is documented in
[`fixtures/README.md`](fixtures/README.md) — a stub run passed by reading two earlier control runs'
output files, and a grading call un-blinded itself by reading the lab. The design consequences
(per-run ephemeral working directories, located off the lab root, and a grader with no tools) are
in `scripts/lib/lab.mjs`.

## Residual risks

- **Built-in skills are always present** (§2). Fixed across variants, so differential
  measurements hold, but task wording must not court them.
- **All of this is version-specific.** Every behaviour here was established against `2.1.233`.
  `run.mjs` should record the CLI version alongside the model id so a later re-run can tell
  whether the harness changed underneath it.
- **The `--bare` path is untested.** Listed as a possible cleaner isolation route for API-key
  users; not validated, not the default.
- **Only Windows was exercised.** The macOS/Linux branch is reasoned, not measured: `os.tmpdir()`
  outside `$HOME` and `shell: false`. The home-directory guard in `labinit.mjs` is what makes a
  wrong guess here loud instead of silent.
