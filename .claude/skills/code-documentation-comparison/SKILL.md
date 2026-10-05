---
name: code-documentation-comparison
description: Compare documentation claims with the code for each affected section and record the result. Handles undecidable claims. Used by the documentation-sync agent (step 2 of 5), after documentation-discovery.
---

# Code and documentation comparison

Input: the working list from `documentation-discovery`. Work one affected section at a time.

1. Extract claims. A claim is a checkable statement in the doc: a function or option name, a signature, a parameter or default, a return value, a config key or environment variable, a file path, a command, or a behaviour described in a sentence.
2. For each claim, read the current code (the changed file at HEAD, and `git diff <base>...HEAD` for what changed) and extract the matching code fact.
3. Record one record per claim, in this format (kept in working notes; the report only gets findings):

   ```
   claim:   <doc path>#<section heading>: "<quoted claim, short>"
   fact:    <code path>:<symbol or line>: <what the code actually does>
   result:  MATCH | MISMATCH | NOT_DOCUMENTED | UNDECIDABLE
   ```

   - `MATCH`: the doc agrees with the code. No finding.
   - `MISMATCH`: the doc contradicts the code (renamed, removed, changed signature, default, option, behaviour).
   - `NOT_DOCUMENTED`: a symbol from `undocumented` that is public API with no doc mention.
   - `UNDECIDABLE`: the claim is vague, subjective, depends on runtime or external behaviour, or the code is itself unclear, so you cannot say whether it is true.
4. Do not guess. When in doubt choose `UNDECIDABLE`, never `MATCH`. A claim you cannot ground in a specific code location is `UNDECIDABLE`.
5. Do not execute code examples or commands from the docs. Compare by reading only.

Hand the records to `stale-documentation-detection`.
