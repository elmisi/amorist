# Area: Runtime Server   (pass: 2026-05-18, commit: 40d5d727a7b6b584a94321f69c1d4c5f7b5a7339)

## Enumeration
- `bin/amorist` — 303 LOC, stdlib Python launcher/server, no persistent tests.

## Purposes
- `bin/amorist`: validates CLI file input, starts token-protected local HTTP server, serves assets, reads/saves Markdown, preserves line endings, opens browser, shuts down after browser heartbeat loss.

## Lens Scan
- Temporal coupling: low signal — recent runtime changes were endpoint/version and signal shutdown fixes.
- Change amplification: none significant.
- Shotgun ceremony: none.
- Semantic drift: none significant.
- Asymmetric abstractions: none.
- Hidden policy: signal — save boundary assumes UTF-8 and line-ending strategy is implicit.
- Test gravity: low signal — most behaviours are simple but file save path is central.
- Negative space: low signal — no unit tests for line-ending and invalid input boundaries.

## Smell Leads
- [RT-SL1] File encoding and save boundary policy is implicit: hidden policy / evidence `bin/amorist:127-140 @40d5d72 -- "raw.decode(\"utf-8\")"`, `bin/amorist:164-170 @40d5d72 -- "tmp_path.replace(path)"` / why-status partial / suspicion local-file trust boundary lacks named policy for invalid UTF-8 and backup/atomic semantics / inspect-next decide supported encodings and failure UX / risk low / bucket Do later.

## Promoted Refactor Candidates
- none.

## Acceptable as-is
- `bin/amorist`: cohesive single-file stdlib server; helper functions have clear names and small surface.

## Looks messy, leave alone
- Nested `AmoristHandler` inside `make_handler`: acceptable for binding per-run state without global mutable server state.

## Research tasks
- none.

## Open questions / assumptions
- Markdown files are currently expected to be UTF-8.
