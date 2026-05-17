# Area: Ops and Docs   (pass: 2026-05-18, commit: 40d5d727a7b6b584a94321f69c1d4c5f7b5a7339)

## Enumeration
- `scripts/install.sh` — install flow and summary.
- `scripts/uninstall.sh` — uninstall flow and cleanup.
- `scripts/capture-screenshots.sh` — 81 LOC, local demo screenshots.
- `README.md`, `scripts/README.md`, `VERSION`, `.gitignore` — user-facing docs and metadata.

## Purposes
- Installer: copy app to `/opt/amorist`, link command, install tiny runtime prerequisites.
- Screenshot script: produce docs assets via local launcher and headless browser.
- Docs: explain use, install, editor subset, embedded API, scripts.

## Lens Scan
- Temporal coupling: signal — docs/screenshots change with editor UI feature commits.
- Change amplification: low signal — feature additions usually touch README plus editor.
- Shotgun ceremony: none.
- Semantic drift: low signal — README currently aligns with implemented shortcut/table behaviours.
- Asymmetric abstractions: none.
- Hidden policy: low signal — screenshot browser selection is now documented.
- Test gravity: none.
- Negative space: none significant.

## Smell Leads
- none.

## Promoted Refactor Candidates
- none.

## Acceptable as-is
- `scripts/install.sh`: direct and user-confirmed installer flow.
- `scripts/uninstall.sh`: direct and user-confirmed cleanup flow.
- `scripts/capture-screenshots.sh`: small, clear, and documented.
- Docs: current README avoids internal QA noise and describes user-visible behaviour.

## Looks messy, leave alone
- none.

## Research tasks
- none.

## Open questions / assumptions
- Future Windows/macOS packaging is out of current Ubuntu-only scope.
