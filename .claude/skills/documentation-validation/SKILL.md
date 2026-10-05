---
name: documentation-validation
description: Re-validate updated documentation against the code, check relative links with links.js, check examples without executing them, and record pass/fail per check. Used by the documentation-sync agent (step 5 of 5).
---

# Documentation validation

Input: the edits from `documentation-update`. Validate each edited finding.

## Checks (one Validation row each: finding, check, result)

1. **Claim re-read**: re-read the edited section and compare it again with the code fact. Result `PASS` only if every claim in the section now matches.
2. **Links**: run `node .claude/scripts/doc-sync/links.js <doc> --section "<Heading>"` for each edited doc and section (omit `--section` for a new file). It prints JSON `{ file, checked, broken }`. Exit 0 means no broken links, 1 means broken relative links or anchors (listed in `broken`), 2 means usage or read failure. Only relative links and anchors are checked; external URLs are not fetched.
3. **Examples**: for each code example or command in the edited section, check by reading: referenced functions exist and are exported, the call matches the current signature, option and config keys exist. Never run the example, the command, or any code from a doc.
4. **Tests** (only when source comments were edited): run the project tests (every `tests/test-*.js` with `node`). Record a row whose Check contains the word `test` and whose Result starts with `PASS` or `FAIL`. The completeness hook requires a passing test row after comment edits.

Result column format: `PASS` or `FAIL: <short reason>`.

## Failure handling

- A failed check keeps the finding `OPEN`. The agent may fix and re-validate once. If the check still fails, stop with `NEEDS_HUMAN` and name the finding and check in `Reason`.
- Only when all checks for a STALE/MISSING finding are `PASS` does it become `RESOLVED`.
- Error or unexpected output from a script is a failure, never a pass. Fail closed.
