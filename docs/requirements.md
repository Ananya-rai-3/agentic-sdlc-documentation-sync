# Requirements

## User Story
> As a software development team,
> I want project documentation to be automatically detected, validated,
> and synchronized when implementation changes occur,
> so that documentation remains consistent with the actual implementation
> and stale documentation is identified before the Pull Request is
> created.

## Functional Requirements
| ID | Requirement | Acceptance Criterion |
|----|-------------|----------------------|
| FR-01 | Discovery: given the set of files changed on the feature branch (diff against the base branch), identify existing documentation that references the changed files, symbols (functions, classes, config keys) or behavior. Sources are `README.md`, files under `docs/**`, and comments/docstrings in the changed files. | For a fixture change that renames a function referenced in `README.md` and `docs/x.md`, the discovery output lists both documents and the referencing sections, and lists no unrelated document. |
| FR-02 | Comparison: for each discovered documentation location, compare its claims (signatures, behavior descriptions, examples, config keys) with the current code. | For a fixture doc whose documented signature differs from the code, the comparison output records the claim, the code fact, and a mismatch result; for a matching doc it records a match result. |
| FR-03 | Classification: flag mismatches as STALE and new public behavior (new public function, class, endpoint, or config key in the diff) with no documentation as MISSING. The two classes are reported distinctly. | A fixture with one changed signature and one new undocumented public function yields exactly one STALE item and one MISSING item, each labelled with its class. |
| FR-04 | Ambiguous claims: a claim that cannot be clearly judged right or wrong is reported as a third class, AMBIGUOUS, is not auto-edited, and is listed for human review. | A fixture doc containing a vague but not false statement yields an AMBIGUOUS item, and the document content is unchanged after the run. |
| FR-05 | Update: for each STALE or MISSING item, change only the affected section(s), preserving the surrounding structure, headings, formatting and tone of the document. | After updating a fixture, a diff of the document shows changes only within the flagged sections; all other lines are byte-identical. |
| FR-06 | Re-validation: after updating, re-check that each updated section matches the code and that every link and code example inside the updated section still resolves or is consistent with the code. | For an updated section, the report records a pass result per check; an injected broken relative link in an updated section is reported as a failed validation. |
| FR-07 | Report: produce `docs/doc-sync-report.md` stating what was checked, what was found STALE / MISSING / AMBIGUOUS, and what was changed. If nothing needed changing, the report says so explicitly. | After a run on a change with no doc impact, the report contains an explicit "no documentation changes required" statement and a non-empty list of what was checked; after a run with findings, every finding and every edit appears in the report. |
| FR-08 | Scope limit: only documentation affected by the current feature branch's changes is examined; no full-repository audit. | With an unrelated, deliberately stale document present in `docs/`, the run neither reports nor modifies it. |
| FR-09 | Commit placement: documentation changes are committed on the same branch as the implementation change so they appear in the same Pull Request. | After a run with edits, `git log` on the feature branch shows the doc commit(s) after the implementation commits, and the PR diff contains both. No new branch is created. |
| FR-10 | Pipeline position: doc sync runs after verification and before the PR is created, so staleness is identified and fixed before the PR exists. | The pipeline cannot reach PR creation without a doc-sync report for the current change (see FR-11). |
| FR-11 | Completeness check: a gate prevents PR creation unless `docs/doc-sync-report.md` exists for the current change and contains no unresolved STALE or MISSING items (AMBIGUOUS items must be acknowledged in the report). | With no report or a report listing an unresolved STALE item, the PR creation attempt is blocked with a message naming the reason; with a clean report it proceeds. |
| FR-12 | Demonstration: the feature is exercised end to end on a small demonstration implementation under `src/` (chosen in the architecture phase), from code change through synchronized docs in a PR. | A recorded run on the demonstration change produces a doc-sync report and a doc edit that appear in the same branch as the code change. |

## Non-Functional Requirements
| ID | Category | Requirement |
|----|----------|-------------|
| NFR-01 | Maintainability | Edits must be minimal and section-scoped so doc diffs stay small and reviewable; the report must be deterministic in structure so it can be parsed by the gate. |
| NFR-02 | Security | The sync must not write outside `README.md`, `docs/**` and comments/docstrings of changed files, must not read or copy secrets or `.env` content into docs or the report, and must not execute documentation examples that have side effects outside a sandboxed or read-only check. |
| NFR-03 | Compliance | Auto-edits are auditable: every change is traceable in the report to a finding, and commits follow the project guard hooks (no force-push, no push to main, no secrets). |
| NFR-04 | Availability | If doc sync fails or cannot decide, it fails closed (blocks PR creation and reports why) rather than silently passing. |
| NFR-05 | Performance | Work is proportional to the branch diff, not repository size; for a typical feature branch (up to about 20 changed files) the run completes in a time acceptable for an interactive pipeline step (target under 5 minutes). |
| NFR-06 | Scalability | When a change exceeds a configurable size threshold (number of changed files or flagged items), the sync stops and asks a human instead of auto-updating. The default value is set in the architecture phase. |

## Assumptions
- Verified in this repo: the pipeline has 8 steps and step 8 is `create-pr`. There is no `documentation-sync-agent`, no "Phase 8" doc sync, none of the five named skills (`documentation-discovery`, `code-documentation-comparison`, `stale-documentation-detection`, `documentation-update`, `documentation-validation`), and no `doc-sync-completeness-check` hook. Existing hooks are `commit-guard` and `pr-gate` only (`.claude/agents`, `.claude/skills`, `.claude/hooks`, `.claude/settings.json`). The story's statement that these "already exist" is therefore treated as incorrect.
- Consequently, this feature includes creating that capability: a documentation-sync agent, its five skills, the completeness-check gate, and its integration into the pipeline. The story's names are kept as the intended names, as proposals rather than existing assets.
- The story's "Phase 8" is read as "the stage immediately before PR creation". Whether it becomes a new step, a sub-step of step 7, or a pre-step of `create-pr` (without renumbering the existing 8 steps) is decided in the architecture phase. The requirement is only the ordering in FR-10.
- Documentation sources are limited to `README.md`, `docs/**`, and comments/docstrings in changed files. External wikis and API reference sites are out of scope, as the story assumes.
- The SDLC phase documents themselves (`docs/requirements.md`, `architecture.md`, etc.) and the generated `docs/pipeline-status.md` are excluded from staleness checks, since other agents own them.
- Ambiguous claims are surfaced for human review and never auto-edited (FR-04); this resolves the story's undecided item conservatively.
- Validation means: re-read the section against the code, check that links resolve, and check that code examples are consistent with the code (signatures, names, config keys). Executing examples is not required, and is allowed only if side-effect free (NFR-02). This resolves the story's undecided item at minimum scope.
- The size threshold in NFR-06 exists; its value is left to architecture.
- The demonstration feature under `src/` does not exist yet and is chosen by the architecture phase.

## Out of Scope
- Full-repository documentation audits unrelated to the current branch's changes.
- External documentation (wikis, Confluence, hosted API reference sites, Jira content).
- Auto-resolving AMBIGUOUS claims.
- Translating, restyling or restructuring documentation beyond the flagged sections.
- Pushing the branch or creating the PR (remains with `create-pr` and needs explicit user confirmation).
- Renumbering or changing the behavior of existing pipeline steps 1-8 beyond what is needed to insert the doc-sync stage and gate.

## Open Questions
- Pipeline placement: new step 9, sub-step of verify, or pre-step of `create-pr`? (Architecture to decide; requirement is only FR-10.)
- Default size/complexity threshold for human escalation (NFR-06).
- Whether the completeness gate should extend `pr-gate` or be a separate hook named `doc-sync-completeness-check`.
- Which demonstration feature under `src/` will exercise the sync (FR-12).
- Whether link checking should cover external URLs or only repository-relative links (assumed repository-relative only).
