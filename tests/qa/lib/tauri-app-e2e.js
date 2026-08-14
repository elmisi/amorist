"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { TauriEngine, discoverDriver } = require("./engine-tauri");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MANIFEST = path.join(ROOT, "src-tauri", "Cargo.toml");
const APPLICATION = path.join(ROOT, "src-tauri", "target", "debug", "amorist");
const RECOVERY_INTERVAL_MS = 2000;
const TIMER_TOLERANCE_MS = 750;

let cached = null;

function runTauriAppChecks() {
  if (!cached) cached = runOnce();
  return cached;
}

async function runOnce() {
  const results = { B4: [], B6: [], B7: [], C2: [], E1: [], E2: [], fixtures: [] };
  if (process.platform !== "linux") {
    results.unsupported = "Direct tauri-driver application automation is unavailable on this platform; Linux supplies the embedding verdict.";
    return results;
  }

  const driver = discoverDriver();
  if (!driver) {
    const failure = {
      fixture: "the built Tauri application",
      detail: "tauri-driver is missing, so the real application could not be driven. Install it with: cargo install tauri-driver --locked",
    };
    results.E1.push(failure);
    results.E2.push(failure);
    results.C2.push(failure);
    results.B4.push(failure);
    results.B6.push(failure);
    results.B7.push(failure);
    return results;
  }
  if (!process.env.DISPLAY) {
    const failure = {
      fixture: "the built Tauri application",
      detail: "No graphical display is available. Run the QA command under xvfb-run so the app-level recovery check can execute.",
    };
    results.E1.push(failure);
    results.E2.push(failure);
    results.C2.push(failure);
    results.B4.push(failure);
    results.B6.push(failure);
    results.B7.push(failure);
    return results;
  }

  const build = childProcess.spawnSync(
    "cargo",
    ["build", "--manifest-path", MANIFEST],
    { encoding: "utf8", timeout: 900000 },
  );
  if (build.status !== 0 || build.error || !fs.existsSync(APPLICATION)) {
    const failure = {
      fixture: "the built Tauri application",
      detail: "The debug application did not build, so no app-level E verdict was produced.",
      actual: `${build.stdout || ""}${build.stderr || ""}`.slice(-1600),
    };
    results.E1.push(failure);
    results.E2.push(failure);
    results.C2.push(failure);
    results.B4.push(failure);
    results.B6.push(failure);
    results.B7.push(failure);
    return results;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-tauri-e2e-"));
  const dataHome = path.join(scratch, "data");
  const documentPath = path.join(scratch, "recovery.md");
  const recoveryPath = path.join(dataHome, "amorist", "working-copy.json");
  const saved = "# Recovery fixture\n\nOriginal line with two spaces  \nUnicode: caffè λ\n";
  const crashSuffix = "\nUnsaved before crash  \nSecond line Ω\n";
  const saveSuffix = "\nExplicitly saved ✓\n";
  const longLines = Array.from({ length: 90 }, (_, index) => `application matrix line ${String(index).padStart(2, "0")}`);
  longLines[0] = "ApplicationLongStartUnique";
  longLines[45] = "ApplicationLongMiddleUnique";
  longLines[89] = "ApplicationLongEndUnique";
  const longDocument = longLines.join("\n");
  fs.mkdirSync(dataHome, { recursive: true });
  fs.writeFileSync(documentPath, saved, "utf8");
  const environment = { ...process.env, XDG_DATA_HOME: dataHome };

  let engine = null;
  try {
    engine = new TauriEngine(driver, APPLICATION, [documentPath], environment);
    await engine.start();
    await waitForEditor(engine, saved);
    results.C2.push(...await verifyApplicationPositionMatrix(engine, "short", [
      "Recovery fixture", "Original line", "caffè",
    ]));

    fs.writeFileSync(documentPath, longDocument, "utf8");
    await reloadCleanDocument(engine, longDocument);
    results.C2.push(...await verifyApplicationPositionMatrix(engine, "long", [
      longLines[0], longLines[45], longLines[89],
    ]));
    results.fixtures.push("built app: six position/content combinations in both view-switch directions");

    const editing = await verifyApplicationEditing(engine, documentPath);
    results.B4.push(...editing.B4);
    results.B6.push(...editing.B6);
    results.B7.push(...editing.B7);
    results.fixtures.push("built app: projected caret and structural editing workflows");

    fs.writeFileSync(documentPath, saved, "utf8");
    await reloadCleanDocument(engine, saved);
    const originalStat = fs.statSync(documentPath, { bigint: true });
    await appendInSource(engine, crashSuffix);

    await delay(900);
    assertDocumentUnchanged(documentPath, saved, originalStat, "before the recovery timer elapsed");
    await waitForRecovery(recoveryPath, saved + crashSuffix, RECOVERY_INTERVAL_MS + TIMER_TOLERANCE_MS - 900);
    assertDocumentUnchanged(documentPath, saved, originalStat, "after the recovery copy was persisted");

    await engine.crashApplication();
    engine = null;

    engine = new TauriEngine(driver, APPLICATION, [documentPath], environment);
    await engine.start();
    await waitForEditor(engine, saved + crashSuffix);
    const recovered = await editorSnapshot(engine);
    if (recovered.source !== saved + crashSuffix || !/Recovered unsaved work/.test(recovered.notice)) {
      results.E1.push({
        fixture: "abrupt termination and restart",
        detail: "The restarted application did not expose the exact recovered source and recovery notice.",
        expected: JSON.stringify({ source: saved + crashSuffix, notice: "Recovered unsaved work" }),
        actual: JSON.stringify(recovered),
      });
    }
    assertDocumentUnchanged(documentPath, saved, originalStat, "after recovery was offered on restart");

    const confirmReplaced = await engine.evaluate(`(function () {
      if (!window.__TAURI__ || !window.__TAURI__.dialog) return false;
      window.__TAURI__.dialog.confirm = function () { return Promise.resolve(true); };
      document.getElementById("reload-button").click();
      return true;
    })()`);
    if (!confirmReplaced) throw new Error("The native confirmation adapter could not be controlled for the discard check.");
    await waitForEditor(engine, saved, { noticeHidden: true });
    await waitForMissing(recoveryPath);
    results.fixtures.push("built app: timer, SIGKILL, restart, exact recovery, Reload/discard");

    await appendInSource(engine, saveSuffix);
    await delay(900);
    assertDocumentUnchanged(documentPath, saved, originalStat, "during a second unsaved editing interval");
    await waitForRecovery(recoveryPath, saved + saveSuffix, RECOVERY_INTERVAL_MS + TIMER_TOLERANCE_MS - 900);
    assertDocumentUnchanged(documentPath, saved, originalStat, "immediately before explicit Save");
    await engine.evaluate(`document.getElementById("save-button").click()`);
    await waitForFileContents(documentPath, saved + saveSuffix);
    await waitForMissing(recoveryPath);
    results.fixtures.push("built app: file sampled before/after recovery timer and changed only by Save");
  } catch (error) {
    let recovery = "missing";
    try {
      recovery = fs.readFileSync(recoveryPath, "utf8");
    } catch {}
    let page = "unavailable";
    if (engine) {
      try {
        page = JSON.stringify(await editorSnapshot(engine));
      } catch {}
    }
    const failure = {
      fixture: "the built Tauri application",
      detail: `The app-level recovery scenario could not complete: ${error.message}`,
      actual: `page: ${page}\nrecovery: ${recovery}\ndriver: ${engine ? engine.output.slice(-800) : "unavailable"}`,
    };
    results.E1.push(failure);
    results.E2.push(failure);
    results.C2.push(failure);
    results.B4.push(failure);
    results.B6.push(failure);
    results.B7.push(failure);
  } finally {
    if (engine) await engine.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return results;
}

async function verifyApplicationEditing(engine, documentPath) {
  const failures = { B4: [], B6: [], B7: [] };
  await engine.evaluate(`(function () {
    if (window.__TAURI__ && window.__TAURI__.dialog) {
      window.__TAURI__.dialog.confirm = function () { return Promise.resolve(true); };
    }
  })()`);

  await loadApplicationFixture(engine, documentPath, "");
  await ensureApplicationWysiwyg(engine);
  await engine.evaluate(`document.querySelector(".amorist-editor-surface").focus()`);
  await engine.sendKeys(["-", " "]);
  const shortcutGeometry = await applicationCaretGeometry(engine);
  if (!shortcutGeometry || !shortcutGeometry.afterMarker) {
    failures.B4.push({
      fixture: "built app bullet shortcut",
      detail: "The compiled application's caret was not after the projected bullet.",
      expected: "caret x at or beyond the marker's right edge",
      actual: JSON.stringify(shortcutGeometry),
    });
  }
  await engine.sendKeys(["alpha"]);
  if (await applicationMarkdown(engine) !== "- alpha") {
    failures.B4.push({ fixture: "built app bullet shortcut", detail: "Typing after the projected bullet reordered the source." });
  }

  const listCases = [
    { name: "built app bullet continuation", source: "- alpha", caret: 7, key: "Enter", intermediate: "- alpha\n- ", text: "beta", expected: "- alpha\n- beta", marker: true },
    { name: "built app ordered continuation", source: "7) alpha", caret: 8, key: "Enter", intermediate: "7) alpha\n8) ", text: "beta", expected: "7) alpha\n8) beta", marker: true },
    { name: "built app list split", source: "- alpha", caret: 4, key: "Enter", intermediate: "- al\n- pha", text: "X", expected: "- al\n- Xpha", marker: true },
    { name: "built app empty-list exit", source: "- alpha\n- ", caret: 10, key: "Enter", intermediate: "- alpha\n", text: "beta", expected: "- alpha\nbeta" },
    { name: "built app list Backspace", source: "- alpha", caret: 2, key: "Backspace", intermediate: "alpha", text: "", expected: "alpha" },
    { name: "built app task continuation", source: "- [x] done", caret: 10, key: "Enter", intermediate: "- [x] done\n- [ ] ", text: "next", expected: "- [x] done\n- [ ] next", marker: true },
  ];
  for (const sample of listCases) {
    const problem = await runApplicationEditingCase(engine, documentPath, sample);
    if (problem) failures.B6.push(problem);
  }

  const blockCases = [
    { name: "built app quote continuation", source: "> alpha", caret: 7, key: "Enter", intermediate: "> alpha\n> ", text: "beta", expected: "> alpha\n> beta" },
    { name: "built app empty-quote exit", source: "> alpha\n> ", caret: 10, key: "Enter", intermediate: "> alpha\n", text: "beta", expected: "> alpha\nbeta" },
    { name: "built app heading to prose", source: "## alpha", caret: 8, key: "Enter", intermediate: "## alpha\n", text: "beta", expected: "## alpha\nbeta" },
    { name: "built app heading Backspace", source: "## alpha", caret: 3, key: "Backspace", intermediate: "alpha", text: "", expected: "alpha" },
  ];
  for (const sample of blockCases) {
    const problem = await runApplicationEditingCase(engine, documentPath, sample);
    if (problem) failures.B7.push(problem);
  }
  return failures;
}

async function runApplicationEditingCase(engine, documentPath, sample) {
  await loadApplicationFixture(engine, documentPath, sample.source);
  await setApplicationRawSelection(engine, sample.caret);
  await engine.sendKeys([{ key: sample.key }]);
  await delay(60);
  const intermediate = await applicationMarkdown(engine);
  if (intermediate !== sample.intermediate) {
    return { fixture: sample.name, detail: "The compiled app produced the wrong structural transaction.", expected: sample.intermediate, actual: intermediate };
  }
  if (sample.marker) {
    const geometry = await applicationCaretGeometry(engine);
    if (!geometry || !geometry.afterMarker) {
      return { fixture: sample.name, detail: "The compiled app caret was not after the continued marker.", actual: JSON.stringify(geometry) };
    }
  }
  if (sample.text) await engine.sendKeys([sample.text]);
  await delay(60);
  const actual = await applicationMarkdown(engine);
  return actual === sample.expected ? null : {
    fixture: sample.name,
    detail: "Typing after the structural action landed at the wrong source position.",
    expected: sample.expected,
    actual,
  };
}

async function loadApplicationFixture(engine, documentPath, source) {
  fs.writeFileSync(documentPath, source, "utf8");
  await reloadCleanDocument(engine, source);
}

async function ensureApplicationWysiwyg(engine) {
  await engine.evaluate(`(function () {
    var source = document.querySelector(".amorist-editor-source");
    if (!source.hidden) document.querySelector('[data-action="source"]').click();
  })()`);
  await delay(60);
}

async function setApplicationRawSelection(engine, offset) {
  await engine.evaluate(`(function () {
    var source = document.querySelector(".amorist-editor-source");
    var button = document.querySelector('[data-action="source"]');
    if (source.hidden) button.click();
    source.focus();
    source.setSelectionRange(${offset}, ${offset});
    button.click();
  })()`);
  await delay(60);
}

async function applicationMarkdown(engine) {
  const value = await engine.evaluate(`(function () {
    var source = document.querySelector(".amorist-editor-source");
    var button = document.querySelector('[data-action="source"]');
    if (source.hidden) button.click();
    var value = source.value;
    button.click();
    return value;
  })()`);
  await delay(60);
  return value;
}

async function applicationCaretGeometry(engine) {
  return engine.evaluate(`(function () {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    var range = selection.getRangeAt(0);
    var row = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    while (row && !row.classList.contains("amorist-source-line")) row = row.parentElement;
    if (!row) return null;
    var caretX = null;
    if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
      var probe = document.createRange();
      probe.setStart(range.startContainer, range.startOffset - 1);
      probe.setEnd(range.startContainer, range.startOffset);
      caretX = probe.getBoundingClientRect().right;
    } else caretX = range.getBoundingClientRect().left;
    var rowRect = row.getBoundingClientRect();
    var rowStyle = window.getComputedStyle(row);
    var markerStyle = window.getComputedStyle(row, "::before");
    var markerRight = rowRect.left + (parseFloat(rowStyle.paddingLeft) || 0)
      + (parseFloat(markerStyle.marginLeft) || 0) + (parseFloat(markerStyle.width) || 0);
    return { caretX: caretX, markerRight: markerRight, afterMarker: caretX >= markerRight - 1 };
  })()`);
}

async function reloadCleanDocument(engine, expected) {
  await engine.evaluate(`document.getElementById("reload-button").click()`);
  await waitForEditor(engine, expected, { noticeHidden: true });
}

async function verifyApplicationPositionMatrix(engine, size, tokens) {
  const failures = [];
  for (const [index, position] of ["start", "middle", "end"].entries()) {
    await setApplicationPosition(engine, position, tokens[index]);
    let before = await applicationPositionSnapshot(engine);
    for (const direction of ["WYSIWYG to Source", "Source to WYSIWYG"]) {
      await engine.evaluate(`document.querySelector('[data-action="source"]').click()`);
      await delay(100);
      const after = await applicationPositionSnapshot(engine);
      const fixture = `${size} content, ${position}`;
      if (after.views.source === after.views.wysiwyg) {
        failures.push({ fixture, direction, detail: "The built app did not leave exactly one view visible.", actual: JSON.stringify(after) });
      } else if (size === "short") {
        if (before.maximum > 1 || after.maximum > 1 || before.top > 1 || after.top > 1) {
          failures.push({
            fixture,
            direction,
            detail: "The built app scrolled content that fits entirely in its editor viewport.",
            expected: "top 0 and maximum 0 in both views",
            actual: `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
          });
        }
      } else if (position === "start" || position === "end") {
        if (after.edge !== position) {
          failures.push({
            fixture,
            direction,
            detail: "The built app lost the requested document boundary.",
            expected: position,
            actual: JSON.stringify(after),
          });
        }
      } else if (after.line !== before.line) {
        failures.push({
          fixture,
          direction,
          detail: "The built app changed the physical line at the editor viewport midpoint.",
          expected: `source line ${before.line}`,
          actual: `source line ${after.line}`,
        });
      }
      before = after;
    }
  }
  return failures;
}

async function setApplicationPosition(engine, position, token) {
  await engine.evaluate(`(function () {
    var source = document.querySelector(".amorist-editor-source");
    var button = document.querySelector('[data-action="source"]');
    if (!source.hidden) button.click();
    var surface = document.querySelector(".amorist-editor-surface");
    var rows = Array.prototype.slice.call(surface.querySelectorAll(".amorist-source-line"));
    var row = rows.find(function (candidate) { return candidate.textContent.indexOf(${JSON.stringify(token)}) >= 0; });
    if (!row) throw new Error("position token not found: " + ${JSON.stringify(token)});
    var walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    var node = walker.nextNode();
    if (node) {
      var range = document.createRange();
      range.setStart(node, Math.min(2, node.textContent.length));
      range.collapse(true);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      surface.focus();
    }
    if (${JSON.stringify(position)} === "middle") row.scrollIntoView({ block: "center" });
    else surface.scrollTop = ${JSON.stringify(position)} === "end" ? surface.scrollHeight : 0;
  })()`);
  await delay(60);
}

async function applicationPositionSnapshot(engine) {
  return engine.evaluate(`(function () {
    var source = document.querySelector(".amorist-editor-source");
    var surface = document.querySelector(".amorist-editor-surface");
    var sourceMode = !source.hidden;
    var scroller = sourceMode ? source : surface;
    var maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    var top = scroller.scrollTop;
    var edge = maximum <= 1 ? "both" : (top <= 1 ? "start" : (top >= maximum - 1 ? "end" : null));
    var line = null;
    if (sourceMode) {
      var style = window.getComputedStyle(source);
      var lineHeight = parseFloat(style.lineHeight) || 21;
      var contentY = top + source.clientHeight / 2 - (parseFloat(style.paddingTop) || 0);
      line = Math.max(0, Math.min(source.value.split("\\n").length - 1, Math.floor(contentY / lineHeight)));
    } else {
      var box = surface.getBoundingClientRect();
      var middle = box.top + surface.clientHeight / 2;
      var rows = Array.prototype.slice.call(surface.querySelectorAll(".amorist-source-line"));
      var row = rows.find(function (candidate) {
        var rect = candidate.getBoundingClientRect();
        return rect.top <= middle && rect.bottom >= middle;
      }) || rows.reduce(function (nearest, candidate) {
        if (!nearest) return candidate;
        var distance = function (element) {
          var rect = element.getBoundingClientRect();
          return Math.abs((rect.top + rect.bottom) / 2 - middle);
        };
        return distance(candidate) < distance(nearest) ? candidate : nearest;
      }, null);
      line = row ? Number(row.dataset.line) : null;
    }
    return {
      mode: sourceMode ? "source" : "wysiwyg",
      line: line,
      top: Math.round(top),
      maximum: Math.round(maximum),
      edge: edge,
      views: { source: !source.hidden, wysiwyg: !surface.hidden }
    };
  })()`);
}

async function waitForEditor(engine, expectedSource, options) {
  const noticeHidden = Boolean(options && options.noticeHidden);
  await waitUntil(async () => {
    const snapshot = await editorSnapshot(engine);
    return snapshot.source === expectedSource
      && snapshot.status !== "Starting"
      && snapshot.status !== "Loading"
      && (!noticeHidden || snapshot.notice === "");
  }, 15000, `editor source ${JSON.stringify(expectedSource)}`);
}

async function editorSnapshot(engine) {
  return engine.evaluate(`(function () {
    var source = document.querySelector(".amorist-editor-source");
    var button = document.querySelector('[data-action="source"]');
    if (source && source.hidden && button) button.click();
    return {
      source: source ? source.value : null,
      status: document.getElementById("status").textContent,
      notice: document.getElementById("notice").hidden ? "" : document.getElementById("notice").textContent
    };
  })()`);
}

async function appendInSource(engine, text) {
  await engine.evaluate(`(function () {
    var source = document.querySelector(".amorist-editor-source");
    var button = document.querySelector('[data-action="source"]');
    if (source.hidden) button.click();
    source.focus();
    source.setSelectionRange(source.value.length, source.value.length);
  })()`);
  // WebDriver treats a literal LF in a key action inconsistently; send the
  // protocol's named Enter key so physical Markdown lines are real input too.
  const sequence = text.split(/(\n)/).filter(Boolean).map((part) => (
    part === "\n" ? { key: "Enter" } : part
  ));
  await engine.sendKeys(sequence);
}

async function waitForRecovery(file, expected, timeout) {
  await waitUntil(() => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")).unsavedSource === expected;
    } catch {
      return false;
    }
  }, timeout, `the exact recovery copy to be persisted by the ${RECOVERY_INTERVAL_MS} ms timer`);
}

async function waitForFileContents(file, expected) {
  await waitUntil(() => fs.readFileSync(file, "utf8") === expected, 8000, "the explicit Save to reach the document");
}

async function waitForMissing(file) {
  await waitUntil(() => !fs.existsSync(file), 8000, "the recovery copy to be discarded");
}

async function waitUntil(predicate, timeout, description) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}.`);
}

function assertDocumentUnchanged(file, expected, stat, moment) {
  const current = fs.statSync(file, { bigint: true });
  if (fs.readFileSync(file, "utf8") !== expected || current.mtimeNs !== stat.mtimeNs) {
    throw new Error(`The user document changed ${moment}, without an explicit Save.`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = { runTauriAppChecks };
