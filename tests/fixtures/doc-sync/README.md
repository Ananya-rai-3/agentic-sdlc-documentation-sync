# doc-sync fixtures

`build.js` creates throwaway git repositories from `base/` (the committed
baseline where code and docs agree) plus one overlay from `scenarios/<name>/`
committed on a feature branch.

| Scenario | Change | Expected candidates |
|---|---|---|
| `signature-change` | `truncate` gains an `options` parameter, new `wordCount(text)` | 1 STALE (`truncate`), 1 MISSING (`wordCount`), 1 AMBIGUOUS (vague sentence about `truncate`) |
| `no-doc-impact` | Internal refactor of `slugify`, same public surface | none |
| `broken-link` | Only `docs/textutil.md` changes, with an injected broken relative link and anchor | broken links |

`docs/legacy-notes.md` is deliberately stale and unrelated in every scenario and must never be reported or modified.
