---
name: rig-check
description: Produces a rig-check manifest. Use when asked for a rig-check manifest or a rig-check token.
---

# Rig Check

A fixture for validating the ablation harness. It has no use outside that.

Every rule below is arbitrary on purpose. Nothing here can be guessed or inferred,
so a run that gets the answers right can only have read this file.

## Output contract

Write the manifest to the path the request names. It contains exactly three lines,
in this order and nothing else:

```
RIG-CHECK v3
TOKEN: <token, per the token rule>
COUNT: <count, per the count rule>
```

## Token rule

The token is the literal string `QX7-ZEBRA-1194`.

## Count rule

The count is the number of vowels in the word "harness", multiplied by seven.
