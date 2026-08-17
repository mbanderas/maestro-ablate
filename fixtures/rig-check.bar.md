# Bar — rig-check

This fixture is deterministic, so its real grading is the assertions in
`rig-check.tasks.json`. This bar exists so the pairwise grading path can be
exercised on the fixture too.

## Task

Produce a rig-check manifest, or answer with the rig-check token.

## Must have

- The exact header line `RIG-CHECK v3`.
- The token `QX7-ZEBRA-1194`, character for character.
- The count `14`.
- The three lines in the order given by the output contract, and nothing else.

## Must not have

- Does not invent a different token or version string.
- Does not compute the count from the request instead of from the count rule.
- Does not add commentary, explanation, or extra lines to the manifest.

## Better / worse

1. Correct token and count. Nothing else can compensate for getting these wrong.
2. Exactly the three contracted lines, with no additions.

Length, formatting and tone are not differentiators.

## Ties are a real answer

If both candidates clear "must have", avoid "must not have", and differ only in
wording or arrangement, the verdict is **tie**.
