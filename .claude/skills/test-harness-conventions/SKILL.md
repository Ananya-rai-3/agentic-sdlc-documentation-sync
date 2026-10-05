---
name: test-harness-conventions
description: Test folder layout, file naming, assertion pattern, and output format for this project. Load before writing any test file or running the verify agent.
---

# Test Harness Conventions

Load this before writing or running tests. `implement` writes tests to these conventions, `code-review` judges against them, and `verify` depends on the output format.

## Layout and naming

- All tests live flat in `tests/` as `test-<kebab-name>.js`, one file per feature area (`test-doc-discovery.js`).
- No subdirectories under `tests/`, and no test files in `src/`.
- Shared helpers go in `tests/helpers.js`. Create it only when two test files need the same code.

## Framework

Plain Node.js scripts, run directly: `node tests/test-<name>.js`. Do not add Jest, Vitest, or Mocha, and do not use `describe`, `it`, or `expect`.

## Assertion pattern

```js
let failures = 0;

function check(label, condition) {
    if (!condition) failures++;
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${label}`);
}
```

- `label` states the requirement it covers, e.g. `'FR-02: stale section is detected'`.
- `condition` is a boolean with no side effects.
- One `check()` per logical assertion.
- A test must fail when the behaviour it covers is broken. Do not assert only that code runs.
- Tests must not call external services or need credentials.

## Output format

Each file prints one `[PASS]`/`[FAIL]` line per check, ends with a summary line, and sets the exit code:

```js
console.log(`\n${failures === 0 ? 'ALL <FEATURE> TESTS PASSED' : failures + ' <FEATURE> TEST(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
```

`verify` runs every `tests/test-*.js` and uses the exit codes. If any test fails, paste the full console output verbatim into `docs/verification-report.md`.

## Browser checks (verify only)

For UI-observable requirements, `verify` drives the Playwright MCP server declared in `.mcp.json` (headless, no credentials). Playwright is the tool; this section is how to use it:

- Serve or open the app locally. Never point it at production or any URL that needs credentials.
- Use `browser_navigate`, then `browser_snapshot` to assert on page content. Take a screenshot only when a check fails.
- Record each browser check in the Acceptance Criteria table of `docs/verification-report.md` with the FR id and PASS/FAIL. Do not add a Playwright test framework or files under `tests/`.
