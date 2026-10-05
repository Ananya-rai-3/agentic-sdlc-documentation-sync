---
name: stale-documentation-detection
description: Classify comparison results as STALE, MISSING or AMBIGUOUS findings with ids F-01.. and mandatory evidence, with secrets redacted. Used by the documentation-sync agent (step 3 of 5).
---

# Stale documentation detection

Input: the claim/fact/result records from `code-documentation-comparison`.

## Classification

| Class | When |
|---|---|
| STALE | result `MISMATCH`: the doc states something the code contradicts |
| MISSING | result `NOT_DOCUMENTED`: a new public symbol or behaviour has no doc mention |
| AMBIGUOUS | result `UNDECIDABLE`: cannot be judged true or false |

`MATCH` records produce no finding. An unchanged doc about unchanged code is never a finding.

## Finding rules

- Ids are sequential and unique: `F-01`, `F-02`, ... in the order found. Re-runs recompute from the current code and docs.
- Each finding has `Location` (`<path>#<section>` of the doc, or the doc where it belongs for MISSING), `Class`, and `Evidence`. Evidence is mandatory: quote the doc text and name the code location and fact, on one line, for example: `doc says truncate(text, max); src/textutil.js:12 truncate(text, max, options)`. A finding without evidence must not be reported.
- Initial status is `OPEN`. Only `documentation-update` plus `documentation-validation` may move STALE/MISSING to `RESOLVED`. AMBIGUOUS stays `OPEN` until a human acknowledges it.
- If the number of findings exceeds `DOC_SYNC_MAX_ITEMS` (see `thresholds.maxItems` from discovery), stop with `NEEDS_HUMAN` and make no edits.

## Redaction (secrets in Evidence)

The report is committed. Before writing any Evidence, replace anything that looks like a secret with `[REDACTED]`: tokens, API keys, passwords, connection strings with credentials, private key blocks, `Bearer ...` values, long random-looking strings, and values of variables named like `*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`. Quote names and structure, never the secret value. If unsure, redact. Never copy contents of `.env*` files.

## Output

The findings list, passed to `documentation-update`. AMBIGUOUS findings are listed but never edited.
