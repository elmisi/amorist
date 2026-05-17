# Area: App Shell   (pass: 2026-05-18, commit: 40d5d727a7b6b584a94321f69c1d4c5f7b5a7339)

## Enumeration
- `web/app.js` — 238 LOC, no persistent tests, owns document API calls, dirty state, demo mode, heartbeat, editor mounting.
- `web/app.css` — 175 LOC, app chrome and responsive layout.
- `web/index.html` — 36 LOC, static shell and asset loading order.

## Purposes
- `web/app.js`: adapts local HTTP API to the embeddable editor and browser lifecycle.
- `web/app.css`: owns topbar/statusbar/editor container layout.
- `web/index.html`: declares the app skeleton and script order.

## Lens Scan
- Temporal coupling: signal — app shell changed with sticky/header and screenshot work, less frequently than editor core.
- Change amplification: none significant; document lifecycle concepts are centralized.
- Shotgun ceremony: none.
- Semantic drift: none significant.
- Asymmetric abstractions: none significant.
- Hidden policy: signal — heartbeat and optional version degradation are silent.
- Test gravity: signal — save/reload/dirty lifecycle has no committed browser tests.
- Negative space: signal — `fetch(...).catch(() => {})` lacks local explanation.

## Smell Leads
- [APP-SL1] Dirty/save lifecycle has no persistent contract test: negative space / evidence `web/app.js:73-94 @40d5d72 -- "reloadDocument()"`, `web/app.js:110-133 @40d5d72 -- "saveDocument()"` / why-status recovered / suspicion core file safety behaviour depends on ad hoc checks / inspect-next fixture a local server browser smoke path / risk medium / bucket Do later.

## Promoted Refactor Candidates
- none.

## Acceptable as-is
- `web/app.js`: cohesive adapter layer; 238 LOC is readable and has clear boundaries to editor and server.
- `web/app.css`/`web/index.html`: small, coherent presentation shell.

## Looks messy, leave alone
- Screenshot demo route in production app shell: acceptable because it is isolated by `screenshot` query param and supports repo docs.

## Research tasks
- none.

## Open questions / assumptions
- Silent heartbeat failure is accepted because browser close detection is best effort in a local tool.
