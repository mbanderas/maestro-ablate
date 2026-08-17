# Privacy notice

Last updated: August 17, 2026

Maestro: Ablate is a local skill package. The project does not operate a hosted service, user-account system, analytics service, advertising system, telemetry endpoint, or prompt collection service.

## Local installation

The installer copies the packaged `ablate` skill to destinations selected on the user's computer. It does not send prompts, local files, skill contents, or measurement results to the maintainer.

Using npm or `npx` to download Ablate contacts the npm registry. Using GitHub to visit, clone, report an issue, or open a pull request contacts GitHub. Those services process information under their own privacy policies.

## What the skill reads locally

The inventory step reads skill files under the configured skill roots and, unless `--no-usage` is passed, scans local Claude Code transcript files to count how often each skill was invoked. Both reads are local. The counts stay in a local cache directory beside the installed skill; nothing is transmitted.

## Host and model processing

Ablate runs inside a host application and model provider selected by the user. That host or provider may process prompts, source material, repository content, generated output, metadata, and account information under its own terms and privacy policy.

The Phase B loop additionally starts headless `claude` processes. The contents of the skill under test, the task definitions written for it, and the resulting output are sent to the configured model provider on the operator's own account, and billed to that account. The Ablate project does not receive that material.

## Repository interactions

Public issues and pull requests are public. Do not submit confidential prompts, private skill contents, credentials, customer data, or personal information through a public repository interaction.

## Retention and deletion

Ablate does not maintain a project-operated server containing user prompts or output. Local artifacts live in three places the operator controls: the cache directory beside the installed skill, any lab directory created for a Phase B run, and the rewritten skill files themselves. All three can be deleted with the operating system; `labinit.mjs --clean` removes a lab. Data held by npm, GitHub, a host, or a model provider follows that third party's retention process.

Material changes to this notice will be published in this file.
