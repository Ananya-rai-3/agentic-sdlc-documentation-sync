---
paths:
  - "tests/**"
---

# Test rules

- Load the `test-harness-conventions` skill before writing or running any test.
- All tests live flat under `tests/` as `test-<kebab-name>.js`, run with plain `node tests/<file>`. Do not add a test framework.
- A test must fail when the behaviour it covers is broken. Do not write tests that only assert the code runs.
- Tests must not call external services or need real credentials.
