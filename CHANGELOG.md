# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Automated documentation sync stage (7b) between verify and create-pr: `documentation-sync` agent, discovery/fingerprint/links/report scripts under `.claude/scripts/doc-sync/`, and `docs/doc-sync-report.md`.
- `doc-sync-completeness-check` hook blocks PR creation without a COMPLETE, current doc-sync report; `doc-sync-write-guard` restricts the agent's writes to an allow-list.
- Demonstration change in `src/textutil.js` with tests under `tests/`.
- Pipeline state in `.pipeline/status.json`, managed by `.claude/scripts/pipeline-status.js`.

### Changed
- Consolidated agents, commands, rules, skills and hooks into the current 8-step layout (`commit-guard`, `pr-gate`, `lib`); legacy phase-numbered files removed.
