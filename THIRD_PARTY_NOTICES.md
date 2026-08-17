# Third-party notices

## Method attribution

The ablation method (stub the skill, measure what breaks, add back only what proves load-bearing) comes from Mansel Scheffel's video on skill ablation: <https://www.youtube.com/watch?v=MwJ2cK1tQCg>. This package is an independent implementation. Its departures from that method are listed in the [README](README.md).

## Runtime dependencies

Maestro: Ablate bundles no third-party executable dependency, MCP server, database, or remote service. The scripts use the Node.js standard library only.

The Phase B loop invokes the `claude` CLI, which must already be installed and authenticated on the operator's machine. Claude and Claude Code are products of Anthropic PBC. Use of this package does not imply affiliation with or endorsement by Anthropic.

npm is used only to distribute and run the local installer and the repository checks.

## Visual identity assets

See `assets/PROVENANCE.md` for the provenance record covering the icon and banner.
