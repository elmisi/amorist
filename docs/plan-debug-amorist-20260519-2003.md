# Plan: Debug amorist (EL-163)

ciao a tutti belli e brutti, tanto gesù vuole bene a tutti

## Context 2

Card EL-163-debug on the tasks board lists 6 items — 4 bugs and 2 feature evaluations for the amorist markdown editor. The bugs affect the core save/heartbeat flow, list serialization, and markdown coverage. The evaluations concern a potential standalone app direction.

Relevant files at commit `e829320` (current HEAD of `main`):

| File                                             | Role                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `bin/amorist` (329 LOC)                          | Python HTTP server: heartbeat monitor, save endpoint, static serving                                  |
| `web/app.js` (249 LOC)                           | App shell: save/reload, heartbeat ping, dirty tracking, error display                                 |
| `web/editor/amorist-markdown-codec.js` (292 LOC) | Markdown parser (`parseBlocks`), HTML renderer (`renderMarkdown`), DOM serializer (`serializeBlocks`) |
| `web/editor/amorist-editing-policy.js` (398 LOC) | Contenteditable shortcuts, toolbar action dispatch                                                    |
| `web/editor/amorist-editor.js` (334 LOC)         | Editor UI shell, mode toggle, toolbar                                                                 |
| `web/editor/amorist-editor.css`                  | Editor styling                                                                                        |
| `web/app.css`                                    | App-level styling                                                                                     |

## How to work with this plan

Read the entire plan before acting. Context, approach, edge cases, and open questions are all load-bearing.

For operational instructions (how to annotate, review, analyze impact, check quality): see the companion file `plan-debug-amorist-20260519-2003.ops.md` in the same directory.

## Approach

The 6 items split into three categories:

**Bugs to fix (items 1-3):** Each has a clear root cause identified during research. Fix them independently — they touch different code paths with no shared state.

**Robustness improvement (item 4):** Cross-cutting concern that touches both server and client. Addresses the fundamental fragility behind item 1 and several unhandled failure scenarios.

**Feature evaluations (items 5-6):** Standalone app with webview / NiceGUI. These are architectural decisions, not code changes. The plan captures the trade-off analysis so the owner can decide without re-researching.

Execution order: Item 4's notice infrastructure (Task 9: `showWarning`/`showError` refactor) is foundational — both Bug 1's ping tracking (Task 2) and Item 4's remaining tasks (10-12) depend on it. Within that constraint, Bugs 1-3 are independent and can be parallelized. Items 5-6 are evaluation-only.

---

## Detailed Changes

### Bug 1: Save fails with "Failed to fetch" after idle

**Symptom:** File open for several minutes → click Save → "Failed to fetch" error.

**Root cause:** The server's heartbeat monitor shuts down after 12 seconds of inactivity (`bin/amorist`, line 303: `time.time() - state.last_ping > 12`). The client pings every 3 seconds (`web/app.js`, line 195: `setInterval(ping, 3000)`), but ping failures are silently swallowed (line 192: `.catch(() => {})`). When the browser throttles a backgrounded tab (Chrome reduces timers to 1/min after 5 minutes), pings stop arriving, the server declares inactivity, and shuts down. The next save attempt hits a dead server.

**Verification:** Grep confirms the 12-second timeout at `bin/amorist` line 303 (`time.time() - state.last_ping > 12`). The silent catch is at `web/app.js` line 192. Note: `record_client_activity(state)` is called both from `POST /api/ping` (line 185) and from `GET /` (line 109, on initial page load). This means `first_ping_seen` becomes `True` as soon as the browser fetches `index.html` — even if JS hasn't loaded yet. If JS is slow to boot or blocked, the 12-second inactivity window starts ticking from the page load, not from the first ping. The timeout increase to 120s mitigates this scenario as well.

**Changes:**

1. **0 — increase inactivity timeout from 12s to 120s.**

- Line 303: change `> 12` to `> 120`.    - Rationale: 120s tolerates browser tab throttling (Chrome throttles to 1 timer/min after 5 min background). The close-deadline mechanism (`state.close_deadline`, set by `/api/close`) still provides fast shutdown on tab close — the inactivity timeout is a fallback, not the primary shutdown trigger.

1. **0 — add ping failure tracking.**

- Replace the silent `.catch(() => {})` (line 192) with a counter that tracks consecutive failures. After 3 consecutive failures, show a warning banner ("Connection to server lost — your changes are safe locally, but saving is disabled until the connection is restored"). Reset counter on success.    - Target shape (uses `noticeSource` from the notice state model — see Item 4 change 5 for `showWarning`/`hideNotice` definitions):      ```javascript      let pingFailures = 0;      const ping = () => {        fetch(`/api/ping?token=${encodeURIComponent(token)}`, { method: "POST" })          .then(() => {            if (pingFailures > 0 && noticeSource === "heartbeat") { hideNotice(); }            pingFailures = 0;          })          .catch(() => {            pingFailures += 1;            if (pingFailures >= 3) {              showWarning("Connection to server lost. Save is unavailable.");            }          });      };      ```    - **Notice state model:** The ping handler must only dismiss its own warnings, not save/reload errors. A module-level `noticeSource` variable tracks who owns the current notice (`"heartbeat"`, `"save"`, `"reload"`, `"init"`, or `null`). `showWarning()` sets `noticeSource = "heartbeat"`. `showError(msg, source)` sets `noticeSource = source`. The ping success path only calls `hideNotice()` when `noticeSource === "heartbeat"`. `hideNotice()` resets `noticeSource = null`.

**Success criteria:** Open a file, background the tab for 10 minutes, return, click Save — save succeeds. If the server is actually dead (Ctrl+C), the client shows the warning after ~9 seconds (3 failed pings).

---

### Bug 2: Lists gain empty lines when switching to source mode

**Symptom:** Write a bullet or ordered list in WYSIWYG, switch to source — each list item is separated by a blank line that wasn't in the original markdown.

**Root cause:** `serializeBlocks()` in `amorist-markdown-codec.js` (line 200-248) pushes each list item as a separate entry in the `lines` array, then joins everything with `"\n\n"` (line 205). A 3-item list produces `"- a\n\n- b\n\n- c"` instead of `"- a\n- b\n- c"`.

**Verification:** In `serializeBlocks()` at line 205: `return lines.join("\n\n")`. The UL handler (lines 226-235) calls `lines.push()` per item. The OL handler (lines 237-241) does the same. Each push adds one element to `lines`, and the join inserts `\n\n` between every element — including between items of the same list.

**Changes:**

1. **0 — collect list items into a single block string before pushing.**

- For UL (lines 226-235) and OL (lines 237-241): collect all items into a local array, then `lines.push(localItems.join("\n"))` once per list.    - Target shape for UL:      ```javascript      if (tag === "UL") {        const items = [];        Array.from(element.children).forEach((item) => {          if (item.classList.contains("amorist-task-item")) {            const checked = item.dataset.checked === "true" ? "x" : " ";            items.push(`- [${checked}] ${inlineMarkdown(item.querySelector(".amorist-task-content") || item)}`);          } else {            items.push(`- ${inlineMarkdown(item)}`);          }        });        lines.push(items.join("\n"));        return;      }      ```    - Same pattern for OL: collect `1. item` strings, push joined block.

1. **0 — add parse-only tests for lists.**

- Parse `"- a\n- b\n- c"` → assert 1 block of type `bulletList` with 3 items (no blank-line splitting).    - Same for ordered lists and task lists.    - **DOM serialization tests are out of scope for this harness.** The existing test file runs in `node:vm` with a minimal DOM shim that lacks real `Element` nodes. `serializeBlocks()` requires a real DOM tree (`element.children`, `classList`, `tagName`). Instead of introducing a DOM harness (jsdom, linkedom, happy-dom), verify the serialization fix via the browser smoke test: add a list roundtrip assertion to `tests/app-shell-smoke.test.js` (which runs in real Chromium via Playwright). This keeps the unit tests fast and the DOM-dependent tests in the existing browser harness.

**Success criteria:** Type a 3-item bullet list in WYSIWYG, switch to source — items are on consecutive lines with no blank lines between them. Existing test `editor-markdown-codec.test.js` still passes.

---

### Bug 3: `---` not converted to horizontal rule

**Symptom:** Typing `---` in source or WYSIWYG produces no visual horizontal line.

**Root cause:** Horizontal rules are completely unimplemented. The block type enum in `parseBlocks()` (`amorist-markdown-codec.js`, lines 19-140) has 8 types: `code`, `table`, `heading`, `quote`, `taskList`, `bulletList`, `orderedList`, `paragraph`. No `hr` type exists. No rendering, serialization, toolbar button, or shortcut exists.

**Verification:** `grep -rn "hr\|thematic\|horizontal\|rule" web/editor/` returns zero matches for block type handling. The only `---` in tests is table separator syntax in `tests/fixtures/tables.md`.

**Changes:**

1. **0 — add 1 block type.**

- Define a named constant at the top of the IIFE (after `BLOCK_TAGS`, before any function):      ```javascript      const HR_PATTERN = /^(-{3,}|\*{3,}|_{3,})\s*$/;      ```

- In `parseBlocks()`, add detection before the paragraph fallback (before line 126):      ```javascript      if (HR_PATTERN.test(line)) {        blocks.push({ type: "hr", sourceLine });        index += 1;        continue;      }      ```    - Position: must come **after** the code fence check (line 32) and **after** the list checks (lines 102-124), but **before** the paragraph fallback (line 126). Specifically, `---` inside a list context is already consumed by list parsing, and inside a code fence it's literal text — both are handled by earlier branches.    - Ambiguity with `---` as setext heading underline: amorist only supports ATX headings (`#`), not setext headings, so this is not a conflict. Verified: `grep -n "setext" web/editor/amorist-markdown-codec.js` returns zero results.

- In `renderBlock()` (line 152), add case:      ```javascript      case "hr":        return `<hr${attrs}>`;      ```

- In `isBlockStart()` (lines 142-150), add pattern using the same constant:      ```javascript      if (HR_PATTERN.test(line)) return true;      ```

- In `serializeBlocks()` / `serializeBlock()` (line 208), add DOM-to-markdown case:      ```javascript      if (tag === "HR") {        lines.push("---");        return;      }      ```

- **Add 0 to 1** at line 2 of `amorist-markdown-codec.js`:      ```javascript      const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "BLOCKQUOTE", "LI", "PRE", "HR"]);      ```      Without this, if the browser wraps `<hr>` inside a `<div>`, the `DIV` unwrapping logic at line 243 (`if (tag === "DIV" && BLOCK_TAGS.has(element.firstElementChild?.tagName))`) won't recognize it and will fall through to `inlineMarkdown()`, losing the rule.    - **Only modify the codec's `BLOCK_TAGS`.** There is a separate `BLOCK_TAGS` set in `amorist-editing-policy.js` line 2 (includes `"DIV"`, used by `currentSelectionBlock()` for caret block detection). That set does NOT need `"HR"` — `<hr>` is a void element and never contains a caret. Do not confuse the two sets.

1. **0 — style 1 inside the editor surface.**

```
   .amorist-surface hr {
     border: none;
     border-top: 1px solid #ccc;
     margin: 1em 0;
   }
```

1. **0 — restructure 1 and add HR conversion.**

- **Scope clarification:** The card says "non converte `---` in horizontal line" — this applies to both source→WYSIWYG rendering (handled by the parser above) and WYSIWYG typing. In WYSIWYG, the natural trigger is: user types `---` on an empty line and presses Enter. This mirrors the existing code fence shortcut (triple backtick + Enter) in `applyEnterMarkdownShortcut()` at line 118.    - **Restructuring required:** The current function at line 124 reads `if (after || !/^(`{3,}|~{3,})$/.test(before)) return false;` — this combines a shared guard (`after` text present) with a code-fence-specific regex into a single early return. When the user types `---` and presses Enter, `before = "---"` doesn't match the backtick/tilde regex, so the function returns `false` at line 124 before any HR check can run. The function must be split into a shared `after` guard and separate pattern branches.    - Target shape (replace the entire function body, `amorist-editing-policy.js` lines 118-135):      ```javascript      function applyEnterMarkdownShortcut(event) {        const block = currentSelectionBlock(surface);        if (!block || !isPlainTextBlock(block)) return false;

const before = textBeforeCaret(block).trim();        const after = textAfterCaret(block).trim();        if (after) return false;

if (/^(`{3,}|~{3,})$/.test(before)) {          event.preventDefault();          const code = document.createElement("code");          code.append(document.createElement("br"));          const pre = document.createElement("pre");          pre.append(code);          block.replaceWith(pre);          placeCaretAtEnd(code);          notifyChanged();          return true;        }

if (/^(-{3,}|\*{3,}|_{3,})$/.test(before)) {          event.preventDefault();          const hr = document.createElement("hr");          const p = document.createElement("p");          p.append(document.createElement("br"));          block.replaceWith(hr);          hr.after(p);          placeCaretAtEnd(p);          notifyChanged();          return true;        }

return false;      }      ```

1. **0 — add parse/render tests (no DOM).**

- Parse `---` → assert block type `hr`.    - Parse `***` → assert block type `hr`.    - Parse `___` → assert block type `hr`.    - Render `---` → assert HTML contains `<hr`.    - **Serialize and roundtrip tests go in the browser smoke test** (`tests/app-shell-smoke.test.js`), consistent with the list serialization test strategy from Bug 2. Add an assertion that loads a markdown file containing `---`, switches to source, and verifies `---` is preserved.

1. **0 — add 1 entry.**

- Add a horizontal rule between two paragraphs in the fixture so the roundtrip test covers it.

**Success criteria:** Markdown `---` renders as a visible horizontal line in WYSIWYG. Switching to source preserves `---`. All 3 syntaxes (`---`, `***`, `___`) parse correctly. Existing tests pass.

---

### Item 4: Make save and reload more robust

**Symptom:** Various failure scenarios produce poor UX — hanging saves, generic error messages, no retries, no offline detection.

**Root cause (summary of gaps found during research):**

| Gap                          | Location                                          | Impact                                                  |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| No fetch timeout             | `web/app.js` lines 81, 119                        | Save/reload can hang indefinitely                       |
| No retry logic               | `web/app.js` `saveDocument()`, `reloadDocument()` | Transient failure = manual retry                        |
| Silent ping failures         | `web/app.js` line 192                             | Server death goes unnoticed                             |
| No file-write error handling | `bin/amorist` lines 178-179                       | Disk full / permission denied → HTTP 500 with no detail |
| Generic error messages       | `web/app.js` lines 125, 132                       | User sees "HTTP 500" instead of actionable message      |
| No temp file cleanup         | `bin/amorist` line 178                            | Failed saves leave `.amorist-tmp` files                 |

**Changes:**

1. **0 — extract shared fetch helpers used by both 1 and 2.**

- The AbortController timeout ceremony and error detail extraction are needed by both functions. Extract two helpers to keep each function focused on its domain logic:      ```javascript      async function fetchWithTimeout(url, opts, timeoutMs = 10000) {        const controller = new AbortController();        const timer = setTimeout(() => controller.abort(), timeoutMs);        try {          return await fetch(url, { ...opts, signal: controller.signal });        } finally {          clearTimeout(timer);        }      }

async function extractErrorDetail(response) {        try {          const body = await response.json();          if (body.error) return body.error;        } catch {} // non-JSON response (e.g. 403 HTML from BaseHTTPRequestHandler); fall through        const STATUS_MESSAGES = {          413: "File is too large (max 10 MB)",          403: "Session expired — relaunch amorist from the terminal",        };        return STATUS_MESSAGES[response.status] || `HTTP ${response.status}`;      }      ```    - Both `saveDocument` and `reloadDocument` call `fetchWithTimeout` instead of raw `fetch`. On `!response.ok`, both call `extractErrorDetail(response)` to get a human-readable message.    - On `AbortError`, show: "Save timed out — the server may be unreachable. Your changes are still in the editor."

1. **0 — add single automatic retry for save.**

- Retry only on **fetch-level failures**: `TypeError` (network error — connection refused, DNS failure) and `AbortError` (timeout from AbortController). These indicate the request never reached the server or was aborted before a response.    - Do NOT retry on any HTTP response (including 5xx). Once the server responds, the error is meaningful: 500 from disk full or permission denied is permanent, and retrying would just repeat the same failure. The user sees the server's error message and retries manually if the condition is resolved.    - Wait 2 seconds before the single retry. Before retrying, update the status bar: `elements.status.textContent = "Retrying save…"` so the user knows the app hasn't frozen (worst case: 10s timeout + 2s wait + 10s retry = 22s with "Saving" then "Retrying save…"). If the retry also throws `TypeError`/`AbortError`, show the error.

1. **0 — wrap file write in try/except, return structured JSON errors.**

- The try/except must cover the entire write sequence including `mkdir` (line 175), which can also fail on permission errors before the temp file is even created. Note: `tmp_path` must be declared before the try block — if `mkdir` raises before the assignment, the except block would crash with `NameError`:      ```python      path = state.markdown_path      tmp_path = path.with_name(f".{path.name}.amorist-tmp")      try:        path.parent.mkdir(parents=True, exist_ok=True)        contents = encode_line_endings(markdown, line_ending)        tmp_path.write_text(contents, encoding="utf-8", newline="")        tmp_path.replace(path)      except OSError as exc:        if tmp_path.exists():          tmp_path.unlink(missing_ok=True)        self.send_json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)        return      ```    - **Do NOT use `self.send_error()`** — `BaseHTTPRequestHandler.send_error()` returns an HTML error page, not plain text. Instead, extend the existing `send_json()` helper (`bin/amorist`, line 230) with an optional `status` parameter. Current signature: `send_json(self, payload: dict)` — hardcodes `HTTPStatus.OK` at line 232. New signature: `send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK)`.    - The client-side error message extraction (Item 4, change 4) should parse the JSON body: `const body = await response.json(); throw new Error(body.error || ...)`.    - This cleans up orphaned temp files and returns a machine-readable error message.

1. **0 — improve error messages in 1 and 2.**

- Both functions now use `extractErrorDetail(response)` (defined in change 1 above) on `!response.ok`:      ```javascript      if (!response.ok) {        const detail = await extractErrorDetail(response);        throw new Error(`Save failed: ${detail}`);      }      ```    - The `extractErrorDetail` helper handles the JSON-first / status-code-fallback logic in one place. Its `catch {}` carries an inline comment explaining why the JSON parse failure is acceptable (non-JSON responses from `send_error`).

1. **0 — add a 1 function distinct from 2.**

- `showError()` (line 237) is used for both terminal errors and transient warnings. Add a separate `showWarning()` that uses a yellow/amber style instead of red, for non-critical issues like "connection lost" or "retrying save".    - **CSS class cycling:** The `.notice` element must always be in a clean state. Implement as:      - `showError(msg, source)`: set `elements.notice.hidden = false`, remove `"warning"` class, add `"error"` class, set text, set `noticeSource = source`. Callers: `reloadDocument` passes `"reload"`, `saveDocument` passes `"save"`, initial token check passes `"init"`.      - `showWarning(msg)`: set `elements.notice.hidden = false`, remove `"error"` class, add `"warning"` class, set text. Set `noticeSource = "heartbeat"`.      - `hideNotice()`: set `elements.notice.hidden = true`, remove both `"warning"` and `"error"` classes, reset `noticeSource = null`.    - CSS in `web/app.css`: neutralize the existing `.notice` base style (lines 126-131) — remove `background: #fff4f1` and `color: var(--danger)` from `.notice`, keeping only layout properties (`border-bottom`, `padding`). Move colors exclusively into the subclass selectors:      ```css      .notice { border-bottom: 1px solid var(--border); padding: 10px 16px; }      .notice.error { background: #f8d7da; border-color: #f0c7bf; color: #721c24; }      .notice.warning { background: #fff3cd; border-color: #ffc107; color: #856404; }      ```      This ensures a missing CSS class on the notice element produces no visible style (transparent background) rather than silently falling back to the old red-ish default.

**Success criteria:**

- Save with network glitch → automatic retry succeeds silently.
- Save with dead server → error appears within 10 seconds (not browser default timeout).
- Save with disk full → user sees "No space left on device" instead of "HTTP 500".
- Ping failures → warning banner after 3 consecutive failures.
- Temp files cleaned up on write failure.

**Server-side tests** (add to `tests/test_runtime_server.py`):

- Save to a read-only path → assert HTTP 500 with JSON body containing `"error"` key (not HTML).
- Save to a read-only path → assert no `.amorist-tmp` file left behind.
- Save to a path whose parent directory doesn't exist and can't be created → assert HTTP 500 with JSON error.

**Client-side tests** (add to `tests/app-shell-smoke.test.js`):

- Verify fetch timeout fires within ~12s (10s timeout + margin) when server is artificially delayed. Mark as optional/slow test behind `AMORIST_RUN_BROWSER_SMOKE=1`.
- Manual verification checklist for retry and warning behavior (documented in the test file as comments, not automated — the coordination between ping failures and save retry is hard to simulate reliably in Playwright).

---

### Item 5: Standalone app with webview (evaluation)

**What the card says:** "sono ancora dell'idea di una stand alone, magari con webview"

**Current architecture:** Python `http.server` + browser tab. The server's only job is file I/O and session lifecycle. The editor is pure vanilla JS with no server-side rendering.

**Evaluation of options:**

| Option                                  | Pros                                                                                                                             | Cons                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pywebview** (Python + system webview) | Single process, no browser dependency, ~5 MB installed. Python stays as server. `pywebview.create_window()` replaces `xdg-open`. | WebView2/WebKit version depends on OS. Linux requires GTK3 + WebKit2GTK (`apt install python3-gi gir1.2-webkit2-4.1`). Debugging is harder (no DevTools by default). |
| **Tauri v2** (Rust + system webview)    | Tiny binary (~3 MB), native look, great DX with DevTools. Web assets bundle into binary.                                         | Requires Rust toolchain for building. The Python server would need to be replaced with Rust file I/O (or bundled as a sidecar). Major architecture change.           |
| **Electron**                            | Full Chromium, DevTools built in, massive ecosystem.                                                                             | 150+ MB minimum. Contradicts the project's "no dependency chain" principle.                                                                                          |
| **NW.js**                               | Similar to Electron but allows Node context in browser window.                                                                   | Same size problem as Electron. Smaller ecosystem.                                                                                                                    |

**Recommendation:** pywebview is the path of least resistance — the editor JS stays identical, the Python server becomes a local API without needing a browser, and the dependency footprint is small. Tauri is better long-term but requires rewriting the server in Rust.

**Note:** This evaluation is a preliminary assessment as of 2026-05-19. Binary sizes, dependency chains, and API surfaces change across releases. Before committing to a standalone implementation, re-verify against current documentation: [pywebview](https://pywebview.flowrl.com/), [Tauri v2](https://v2.tauri.app/), [Electron](https://www.electronjs.org/), [NW.js](https://nwjs.io/).

**Decision needed from owner:** Is pywebview's dependency on GTK/WebKit acceptable for Linux? Is the goal cross-platform (macOS/Windows too) or Linux-only?

---

### Item 6: Evaluate NiceGUI for standalone (evaluation)

**What the card says:** "valutare anche NiceGUI per la standalone"

**What NiceGUI is:** A Python framework that wraps Quasar (Vue.js + Vuetify) and serves a web UI via FastAPI + uvicorn. It can also package as a standalone app using pywebview under the hood.

**Evaluation:**

| Aspect               | Assessment                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fit with amorist** | Poor. NiceGUI's value is building UIs in Python (buttons, inputs, layouts via Python API). Amorist already has a complete JS editor. Using NiceGUI would mean either: (a) wrapping the existing JS editor as a custom NiceGUI element (adds complexity, no benefit), or (b) rewriting the editor UI in NiceGUI's Python API (loses all existing code, gains nothing). |
| **Dependencies**     | Pulls in FastAPI, uvicorn, Quasar, Vue.js, plus NiceGUI itself. ~50+ MB of dependencies for a project that currently has zero runtime dependencies.                                                                                                                                                                                                                   |
| **Standalone mode**  | NiceGUI's `native=True` mode uses pywebview internally — so the standalone story is identical to "just use pywebview directly", but with the entire NiceGUI/Quasar stack in between.                                                                                                                                                                                  |

**Recommendation:** NiceGUI is not a good fit. If the goal is standalone, use pywebview directly (evaluation item 5). NiceGUI adds a framework layer with no benefit for a project that already has its own JS editor.

**Note:** Same caveat as evaluation item 5 — this assessment is as of 2026-05-19. NiceGUI's architecture and `native=True` mode should be re-checked against [NiceGUI docs](https://nicegui.io/documentation) before treating this as a final decision.

---

## Edge Cases and Risks

### Risk 1: Heartbeat timeout increase allows zombie servers

- **Likelihood:** Low — the close-deadline mechanism handles normal tab close.
- **Impact:** Orphaned `amorist` processes lingering up to 120s after a browser crash (no close signal sent).
- **Mitigation:** 120s is still bounded. Document in `--help` that `Ctrl+C` or `kill` works for cleanup.
- **Exit clause:** If users report zombie processes, reduce to 60s and add a `kill -0` check or `/proc/self` watchdog.

### Risk 2: Serialization fix breaks markdown with intentional blank lines between list items

- **Likelihood:** Low — Markdown spec says blank lines between list items create "loose" lists (paragraphs inside `<li>`). Amorist's parser doesn't support loose lists (verified: `parseBlocks` bullet/ordered list loops break on any non-matching line, including blank lines — lines 104-109, 116-121).
- **Impact:** If a user had blank-line-separated list items, the parser already treats them as separate blocks (list + paragraph + list). The serialization fix only affects items within a single parsed list block — which by definition have no blank lines.
- **Mitigation:** The roundtrip test will verify this explicitly.
- **Exit clause:** If loose-list support is needed later, the serializer would need a `loose` flag on list blocks to re-insert blank lines.

### Risk 3: `---` conflicts with YAML frontmatter

- **Likelihood:** Medium — many Markdown files start with `---\nkey: value\n---`.
- **Impact:** The parser would treat both `---` lines as horizontal rules, and the YAML block becomes visible text.
- **Mitigation:** YAML frontmatter is not currently supported by amorist's parser (verified: `grep -n "front\|yaml\|meta" web/editor/amorist-markdown-codec.js` returns zero results). The `---` rule should be added without frontmatter awareness for now. If frontmatter support is added later, the first `---` at line 1 would need special handling.
- **Exit clause:** If users report frontmatter breakage, add a check: if `index === 0` and `lines[0] === "---"`, scan ahead for a closing `---` and skip the block.

### Risk 4: AbortController timeout fires during a legitimate slow save

- **Likelihood:** Low — saves are small JSON payloads to localhost.
- **Impact:** User sees "Save timed out" even though the server is working (just slow).
- **Mitigation:** 10-second timeout is generous for localhost. The retry mechanism will catch this case — first attempt times out, retry succeeds.
- **Exit clause:** If saves are legitimately slow (large files approaching 10 MB), increase timeout to 30s.

## Failure Modes and Degradation

### Server process dies mid-session

- **What happens:** All fetch calls fail with network error.
- **Degraded behavior:** Client shows warning after 3 failed pings (~9s). Save button shows error on attempt. Editor content is preserved in the DOM — user can copy/paste to recover.
- **Thresholds:** 3 consecutive ping failures (configurable in ping handler).
- **Fallback:** User re-runs `amorist file.md` from terminal. No data loss since content lives in the browser DOM.

### Disk full during save

- **What happens:** `write_text()` raises `OSError: [Errno 28] No space left on device`.
- **Degraded behavior:** Server catches exception, cleans up temp file, returns 500 with error message. Client shows "Save failed: No space left on device".
- **Thresholds:** No retry — disk full is not transient.
- **Fallback:** User frees disk space, retries save manually.

### Network partition (localhost unreachable)

- **What happens:** Fetch calls hang until AbortController timeout (10s).
- **Degraded behavior:** Save shows "timed out" error. Ping warning appears after ~9s. Retry fires once after 2s.
- **Thresholds:** 10s timeout, 1 retry, 3 ping failures for warning.
- **Fallback:** User checks if server process is alive (`ps aux | grep amorist`). Restarts if needed.

## Open Questions

All resolved (owner decisions, 2026-05-19):

1. ~~**Ping failure threshold:**~~ 3 consecutive failures confirmed. The app runs on localhost only; the long-term goal is standalone (no network at all).
2. ~~**Warning vs. error banner styling:**~~ Auto-dismiss on recovery confirmed. Implementation: ping success calls `hideNotice()` only when `noticeSource === "heartbeat"` (see Bug 1 notice model).
3. ~~**HR toolbar button:**~~ No toolbar button. The toolbar may be redesigned in a future iteration — keep it minimal for now. Only parser/serializer/Enter-shortcut support.
4. ~~**Standalone direction:**~~ pywebview is the preferred path. Implementation deferred to a separate plan after this debug work is complete.

## Task Breakdown

**Bug 1 — Heartbeat/save timeout:**

- [ ] Task 1: Increase heartbeat timeout from 12s to 120s in `bin/amorist` line 303
- [ ] Task 2: Add ping failure tracking with `noticeSource` state model and warning banner in `web/app.js`

**Bug 2 — List serialization:**

- [ ] Task 3: Fix list serialization in `amorist-markdown-codec.js` `serializeBlocks()` — collect items per list before pushing
- [ ] Task 4: Add list parse tests in `tests/editor-markdown-codec.test.js`; add list roundtrip assertion to `tests/app-shell-smoke.test.js`

**Bug 3 — Horizontal rule:**

- [ ] Task 5: Add `hr` block type to parser, renderer, `isBlockStart`, serializer, and `BLOCK_TAGS` in `amorist-markdown-codec.js`
- [ ] Task 6: Add `<hr>` CSS styling in `web/editor/amorist-editor.css`
- [ ] Task 7: Restructure `applyEnterMarkdownShortcut()` (split line 124 guard) and add Enter-after-`---` HR conversion in `amorist-editing-policy.js`
- [ ] Task 8: Add HR parse/render tests in `tests/editor-markdown-codec.test.js`; add HR roundtrip assertion to `tests/app-shell-smoke.test.js`; update `tests/fixtures/editor-roundtrip.md`

**Item 4 — Robustness:**

- [ ] Task 9: Add `showWarning()`/`showError()` with CSS class cycling and `noticeSource` in `web/app.js` + `web/app.css`
- [ ] Task 10: Extract `fetchWithTimeout()` and `extractErrorDetail()` helpers; refactor `saveDocument` and `reloadDocument` to use them in `web/app.js`
- [ ] Task 11: Add single automatic retry on `TypeError`/`AbortError` for save in `web/app.js`
- [ ] Task 12: Extend `send_json()` with optional status param; wrap file write (including `mkdir`) in try/except with JSON error response and temp file cleanup in `bin/amorist`
- [ ] Task 13: Add server-side tests in `tests/test_runtime_server.py`: write to read-only path (JSON error, no temp file), mkdir failure

**Verification:**

- [ ] Task 14: Run all existing tests + new tests to verify no regressions

Dependencies: Task 9 is foundational — it provides `showWarning`/`showError`/`noticeSource` used by tasks 2, 10-12. After Task 9: Task 1 is independent. Task 2 depends on Task 9 only. Tasks 3-4 are independent (no shared deps). Tasks 5-8 are sequential (5 first, then 6-8 in parallel). Tasks 10-12 depend on Task 9 and are independent of each other. Task 13 depends on Task 12 (tests the server changes). Task 14 runs last.

Evaluation items 5-6 from the card (standalone/NiceGUI) require no code — the analysis is in this plan under "Item 5" and "Item 6" sections.
