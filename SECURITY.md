# Security policy

## Supported versions

Security fixes are applied to the latest published release. Older releases may not receive backports.

## Report a vulnerability

Use GitHub's private security-advisory flow for this repository. Do not disclose a vulnerability in a public issue before a fix is available.

Include:

- the affected version and host;
- the exact installation or invocation path;
- reproduction steps;
- expected and observed behavior;
- impact and affected files;
- a minimal proof of concept when safe.

Do not include live credentials, private customer data, or another person's personal information.

## Security boundary

Maestro: Ablate contains Markdown, JSON, and local Node.js scripts. It has no project-operated server, database, telemetry endpoint, authentication system, or bundled MCP server, and it declares no third-party runtime dependency.

The installer writes only to an explicitly selected skill destination. It refuses to replace a different existing installation unless `--force` is provided. A dry-run mode shows destinations without writing.

Two behaviors deserve attention before use.

**The skill rewrites `SKILL.md` files in place.** `scripts/apply.mjs` is destructive by design: it deletes and relocates sections of the file it is pointed at. It refuses to write into a skill root that is not a git repository with a clean working tree unless `--force` is passed, and it leaves a `SKILL.md.pre-ablation.bak` beside the file it rewrote. Version control is the intended rollback path; the backup file is a convenience.

**The Phase B lab holds a copy of the operator's Claude credentials.** Measured trial runs need to authenticate, so `scripts/labinit.mjs` copies the active credential file into `<lab>/config/` and restricts the copy to the current user account. The lab is created outside the home directory so that ambient user memory does not reach a trial. Labs are not deleted automatically: `labinit.mjs --clean` removes one, and every `labinit` run prints the path. Delete a lab when the measurement is finished.

The host application, model provider, `claude` CLI, package registry, and operating system remain separate security boundaries governed by their own controls.
