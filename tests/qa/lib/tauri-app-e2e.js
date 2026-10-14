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
  const results = { B4: [], B6: [], B7: [], C2: [], E1: [], E2: [], F2: [], H1: [], H2: [], H3: [], fixtures: [] };
  if (process.platform !== "linux") {
    // Not a gap: tauri-driver drives the compiled application on Linux only,
    // so the contract's app-embedding verdict is assigned to the Linux run by
    // design. This platform's run says so on the record — and stays green,
    // because the release gate composes one green run per published platform
    // rather than asking one run to prove all of them.
    results.delegated = "Direct tauri-driver application automation exists on Linux only; the Linux run supplies the embedding verdict.";
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
    results.F2.push(failure);
    results.H1.push(failure);
    results.H2.push(failure);
    results.H3.push(failure);
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
    results.F2.push(failure);
    results.H1.push(failure);
    results.H2.push(failure);
    results.H3.push(failure);
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
    results.F2.push(failure);
    results.H1.push(failure);
    results.H2.push(failure);
    results.H3.push(failure);
    results.C2.push(failure);
    results.B4.push(failure);
    results.B6.push(failure);
    results.B7.push(failure);
    return results;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-tauri-e2e-"));
  const dataHome = path.join(scratch, "data");
  const documentPath = path.join(scratch, "recovery.md");
  const recoveryPath = path.join(dataHome, "amorist", "recovery-sessions");
  const saved = "# Recovery fixture\n\nOriginal line with two spaces  \nUnicode: caffè λ\n";
  const crashSuffix = "\nUnsaved before crash  \nSecond line Ω\n";
  const saveSuffix = "\nExplicitly saved ✓\n";
  const longLines = Array.from({ length: 90 }, (_, index) => `application matrix line ${String(index).padStart(2, "0")}`);
  longLines[0] = "ApplicationLongStartUnique";
  longLines[45] = "ApplicationLongMiddleUnique";
  longLines[89] = "ApplicationLongEndUnique";
  const longDocument = longLines.join("\n");
  const wrapperLines = Array.from({ length: 120 }, (_, index) => `application wrapper filler ${String(index).padStart(3, "0")}`);
  wrapperLines.splice(44, 3,
    "| ApplicationTableMidpointUnique | compact |",
    "|---|---|",
    "| wider cell | value |",
  );
  wrapperLines.splice(76, 3, "```javascript", "ApplicationCodeMidpointUnique const value = 1;", "```");
  const wrapperDocument = wrapperLines.join("\n");
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
    fs.writeFileSync(documentPath, wrapperDocument, "utf8");
    await reloadCleanDocument(engine, wrapperDocument);
    results.C2.push(...await verifyApplicationWrapperPositions(engine, [
      { name: "table midpoint", token: "ApplicationTableMidpointUnique" },
      { name: "fenced-code midpoint", token: "ApplicationCodeMidpointUnique" },
    ]));
    results.fixtures.push("built app: eight view-position scenarios in both view-switch directions");

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

    // An actual process restart must preserve ownership, not just Markdown.
    // Backspace distinguishes a restored generated marker from manual syntax.
    await loadApplicationFixture(engine, documentPath, "alpha");
    await setApplicationRawSelection(engine, 5);
    await engine.sendKeys([{ key: "Enter" }, "beta"]);
    await delay(60);
    const ownedSource = "alpha\\\nbeta";
    await waitForRecovery(recoveryPath, ownedSource, RECOVERY_INTERVAL_MS + TIMER_TOLERANCE_MS);
    const persistedBoundary = recoveryRecords(recoveryPath).find((r) => r.unsavedSource === ownedSource).boundaryState;
    if (!persistedBoundary || persistedBoundary.automaticBreaks.length !== 1
        || persistedBoundary.automaticBreaks[0].marker !== 5) {
      throw new Error("Generated boundary ownership was not persisted with its exact source.");
    }
    await engine.crashApplication();
    engine = null;
    engine = new TauriEngine(driver, APPLICATION, [documentPath], environment);
    await engine.start();
    await waitForEditor(engine, ownedSource);
    await setApplicationRawSelection(engine, 7);
    await engine.sendKeys([{ key: "Backspace" }]);
    await delay(60);
    const joinedSource = await applicationMarkdown(engine);
    if (joinedSource !== "alphabeta") {
      results.E1.push({ fixture: "generated boundary ownership after process restart",
        detail: "Backspace did not clean up the recovered automatic boundary.",
        expected: "alphabeta", actual: joinedSource });
    }
    if (fs.readFileSync(documentPath, "utf8") !== "alpha") {
      throw new Error("Recovery or boundary cleanup wrote the user document without Save.");
    }
    results.fixtures.push("built app: generated boundary provenance survives SIGKILL and controls cleanup after restart");
    await verifyIndependentRecoverySessions(driver, scratch);
    results.fixtures.push("built app: simultaneous same-path copies, explicit choice, own-copy discard, remaining-copy recovery and untitled restart");
    await verifyConcurrentNativeSaves(driver, scratch);
    results.fixtures.push("built app: second live instance detects the first instance's save and retains its own unsaved text");
    await verifyEditingDuringSave(driver, scratch);
    results.fixtures.push("built app: edits made while Save waits for its process lock remain dirty and recoverable after the captured snapshot is saved");
    await verifyFileLifecycle(driver, scratch);
    results.fixtures.push("built app: File lifecycle picker/choice cancellation, undo preservation, failed Open/Save, New/Discard, New/Save and successful Open");
    await verifyIndependentInstances(driver, scratch);
    results.fixtures.push("built app: independent instances preserve dirty source/recovery, inherit debug and survive parent closure");
    await verifySaveAsLifecycle(driver, scratch);
    results.fixtures.push("built app: Save As lifecycle cancellation, destination races, denied write, retained history, new identity and untitled Save/New");
  } catch (error) {
    let recovery = "missing";
    try {
      recovery = JSON.stringify(recoveryRecords(recoveryPath));
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
    results.F2.push(failure);
    results.H1.push(failure);
    results.H2.push(failure);
    results.H3.push(failure);
    results.C2.push(failure);
    results.B4.push(failure);
    results.B6.push(failure);
    results.B7.push(failure);
  } finally {
    if (engine) await engine.close().catch(() => {});
    // WebKit's storage process may finish its final origin write just after
    // the app and driver exit. Preserve the verdict across that cleanup race.
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  return results;
}

async function fileAction(engine, action) {
  await waitUntil(() => engine.evaluate(`!document.querySelector('[data-file-action="${action}"]').disabled`), 5000, "the File action to become available");
  await engine.evaluate(`(function () {
    document.getElementById('file-menu').open = true;
    var button = document.querySelector('[data-file-action="${action}"]');
    var rect = button.getBoundingClientRect();
    var hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    if (!rect.width || !rect.height || !button.contains(hit)) throw new Error('The File menu item is not visible and reachable');
    button.click();
  })()`);
}

async function decision(engine, choice) {
  await waitUntil(() => engine.evaluate(`Boolean(document.querySelector('#file-decision-dialog[open]'))`), 5000, "Save/Discard/Cancel dialog");
  if (choice === "escape") await engine.sendKeys([{ key: "Escape" }]);
  else await engine.evaluate(`document.getElementById('file-decision-${choice}').click()`);
  await delay(60);
}

async function verifyIndependentInstances(driver, scratch) {
  const data = path.join(scratch, "instances-data");
  const original = path.join(scratch, "instance original.md");
  const target = path.join(scratch, "--other caffè Ω $(literal).md");
  fs.writeFileSync(original, "original");
  fs.writeFileSync(target, "other document");
  let engine = null;
  const children = new Set();
  function instanceProcesses() {
    return fs.readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).map(Number).filter((pid) => {
      try {
        return fs.realpathSync(`/proc/${pid}/exe`) === APPLICATION &&
          fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes("XDG_DATA_HOME=" + data);
      } catch { return false; }
    });
  }
  async function launched(action) {
    const before = new Set(instanceProcesses());
    await fileAction(engine, action);
    let pid;
    await waitUntil(() => { pid = instanceProcesses().find((pid) => !before.has(pid)); return !!pid; }, 5000, "new independent process");
    children.add(pid);
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  }
  try {
    engine = new TauriEngine(driver, APPLICATION, ["--debug", original], { ...process.env, XDG_DATA_HOME: data });
    await engine.start();
    await waitForEditor(engine, "original");
    await appendInSource(engine, " unsaved");
    const directory = path.join(data, "amorist", "recovery-sessions");
    await waitForRecovery(directory, "original unsaved", 5000);
    await engine.evaluate(`(() => { window.__qaInstanceSource = document.querySelector('.amorist-editor-source');
      window.__TAURI__.dialog.open = function () { return Promise.resolve(null); }; })()`);
    const count = instanceProcesses().length;
    await fileAction(engine, "open-window");
    if (instanceProcesses().length !== count) throw new Error("Cancelled picker launched a process.");
    const rejected = await engine.evaluate(`window.__TAURI__.core.invoke('spawn_document_instance', {path: ${JSON.stringify(target + ".missing")}}).then(() => false, () => true)`);
    if (!rejected) throw new Error("Invalid new-window target was accepted.");
    await engine.evaluate(`window.__TAURI__.dialog.open = function () { return Promise.resolve(${JSON.stringify(target)}); }`);
    const args = await launched("open-window");
    if (!args.includes("--debug") || args[args.length - 1] !== target || args[args.length - 2] !== "--") {
      throw new Error("New instance changed filename arguments or debug mode: " + JSON.stringify(args));
    }
    const emptyArgs = await launched("new-window");
    if (emptyArgs.length !== 2 || emptyArgs[1] !== "--debug") throw new Error("New window inherited a file unexpectedly.");
    const unchanged = await engine.evaluate(`({same: window.__qaInstanceSource === document.querySelector('.amorist-editor-source'),
      dialog: !!document.querySelector('dialog[open]'), path: document.getElementById('file-path').textContent})`);
    if (!unchanged.same || unchanged.dialog || unchanged.path !== original || (await editorSnapshot(engine)).source !== "original unsaved"
        || !recoveryRecords(directory).some((record) => record.unsavedSource === "original unsaved")) {
      throw new Error("New window changed the original dirty session.");
    }
    await engine.crashApplication();
    await engine.close(); engine = null;
    await delay(300);
    for (const pid of children) {
      if (!instanceProcesses().includes(pid)) throw new Error("Child exited with its launching window.");
    }
    if (fs.readFileSync(original, "utf8") !== "original" || fs.readFileSync(target, "utf8") !== "other document") {
      throw new Error("Launching another window wrote a document.");
    }
  } finally {
    if (engine) await engine.close().catch(() => {});
    for (const pid of children) {
      try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
}

async function verifySaveAsLifecycle(driver, scratch) {
  const data = path.join(scratch, "save-as-data");
  const original = path.join(scratch, "save-as original.md");
  const replacement = path.join(scratch, "save-as replacement.md");
  const appears = path.join(scratch, "appeared destination.md");
  const destination = path.join(scratch, "saved caffè Ω");
  const denied = path.join(scratch, "denied save-as");
  const emptyPath = path.join(scratch, "empty untitled.md");
  const untitledPath = path.join(scratch, "saved untitled.md");
  const base = "# Original\r\nline  \r\n";
  const edited = base + "edited";
  fs.writeFileSync(original, base);
  fs.writeFileSync(replacement, "other document\r\n");
  fs.mkdirSync(denied);
  let engine = null;
  try {
    engine = new TauriEngine(driver, APPLICATION, [original], { ...process.env, XDG_DATA_HOME: data });
    await engine.start();
    await waitForEditor(engine, base.replace(/\r\n/g, "\n"));
    await appendInSource(engine, "edited");
    await delay(60);
    const directory = path.join(data, "amorist", "recovery-sessions");
    await waitForRecovery(directory, edited, 5000);
    await engine.evaluate(`window.__qaSaveAsSource = document.querySelector('.amorist-editor-source')`);
    async function unchanged() {
      const snapshot = await editorSnapshot(engine);
      const state = await engine.evaluate(`({path: document.getElementById('file-path').textContent,
        same: document.querySelector('.amorist-editor-source') === window.__qaSaveAsSource})`);
      if (!state.same || state.path !== original || snapshot.source !== edited.replace(/\r\n/g, "\n")
          || !recoveryRecords(directory).some((r) => r.unsavedSource === edited)) {
        throw new Error("Cancelled/failed Save As changed the original session: " + JSON.stringify({snapshot, state}));
      }
      if (fs.readFileSync(original, "utf8") !== base) throw new Error("Save As modified the previous file.");
    }
    await engine.evaluate(`window.__TAURI__.dialog.save = function () { return Promise.resolve(null); }`);
    await fileAction(engine, "save-as");
    await delay(60);
    await unchanged();
    await engine.sendKeys([{ key: "s", ctrl: true, shift: true }]);
    await delay(60);
    await unchanged();
    await engine.evaluate(`(function () {
      window.__TAURI__.dialog.save = function () { return Promise.resolve(${JSON.stringify(replacement)}); };
      window.__TAURI__.dialog.confirm = function () { return Promise.resolve(false); };
    })()`);
    await fileAction(engine, "save-as");
    await delay(100);
    await unchanged();
    if (fs.readFileSync(replacement, "utf8") !== "other document\r\n") throw new Error("Cancelled replacement changed the target.");

    await engine.evaluate(`(function () {
      window.__qaConfirmResolve = null;
      window.__TAURI__.dialog.confirm = function () { return new Promise(function (resolve) { window.__qaConfirmResolve = resolve; }); };
    })()`);
    await fileAction(engine, "save-as");
    await waitUntil(() => engine.evaluate(`Boolean(window.__qaConfirmResolve)`), 5000, "replacement confirmation to await the user");
    await delay(1100);
    fs.writeFileSync(replacement, "changed during confirmation\r\n");
    await engine.evaluate(`window.__qaConfirmResolve(true)`);
    await waitUntil(async () => /CONFLICT/.test((await editorSnapshot(engine)).notice), 5000, "destination conflict");
    await unchanged();
    if (fs.readFileSync(replacement, "utf8") !== "changed during confirmation\r\n") throw new Error("Save As overwrote a changed destination.");

    const prepared = await engine.evaluate(`window.__TAURI__.core.invoke('prepare_save_as', {path: ${JSON.stringify(appears)}, contextId: 1})`);
    fs.writeFileSync(appears, "created externally");
    const rejected = await engine.evaluate(`window.__TAURI__.core.invoke('save_as_document', {
      token: ${prepared.token}, contextId: 1, revision: 0, markdown: ${JSON.stringify(edited)}
    }).then(function () { return false; }, function (e) { return String(e) === 'CONFLICT'; })`);
    if (!rejected || fs.readFileSync(appears, "utf8") !== "created externally") throw new Error("Save As clobbered a newly created destination.");
    const replayRejected = await engine.evaluate(`window.__TAURI__.core.invoke('save_as_document', {
      token: ${prepared.token}, contextId: 1, revision: 0, markdown: ${JSON.stringify(edited)}
    }).then(function () { return false; }, function (e) { return /no longer valid/.test(String(e)); })`);
    if (!replayRejected) throw new Error("Save As preparation could be replayed after consumption.");
    await unchanged();
    fs.chmodSync(denied, 0o555);
    try {
      await engine.evaluate(`window.__TAURI__.dialog.save = function () { return Promise.resolve(${JSON.stringify(path.join(denied, "denied.md"))}); }`);
      await fileAction(engine, "save-as");
      await waitUntil(async () => /Permission denied|read-only/i.test((await editorSnapshot(engine)).notice), 5000, "denied Save As");
      await unchanged();
      if (fs.existsSync(path.join(denied, "denied.md"))) throw new Error("Denied Save As created a partial destination.");
    } finally { fs.chmodSync(denied, 0o755); }

    await engine.evaluate(`window.__TAURI__.dialog.save = function () { return Promise.resolve(${JSON.stringify(destination)}); }`);
    await fileAction(engine, "save-as");
    const named = destination + ".md";
    await waitForFileContents(named, edited);
    await waitUntil(() => engine.evaluate(`document.getElementById('file-path').textContent === ${JSON.stringify(named)}`), 5000, "new Save As identity");
    await waitUntil(async () => (await editorSnapshot(engine)).status === "Saved", 5000, "Save As completion status");
    if (!(await engine.evaluate(`document.querySelector('.amorist-editor-source') === window.__qaSaveAsSource`))) throw new Error("Save As reset the editor/history.");
    await waitForMissing(directory);
    await engine.sendKeys([{ key: "z", ctrl: true }]);
    await delay(60);
    if ((await editorSnapshot(engine)).source === edited.replace(/\r\n/g, "\n")) throw new Error("Save As reset undo history.");
    await engine.sendKeys([{ key: "y", ctrl: true }]);
    await waitForEditor(engine, edited.replace(/\r\n/g, "\n"));
    await appendInSource(engine, " later");
    await delay(60);
    await engine.evaluate(`document.getElementById('save-button').click()`);
    await waitForFileContents(named, edited + " later");
    await waitUntil(async () => (await editorSnapshot(engine)).status === "Saved", 5000, "Save to new path to settle");
    if (fs.readFileSync(original, "utf8") !== base) throw new Error("Subsequent Save still targeted the previous file.");

    await engine.evaluate(`(function () {
      window.__TAURI__.dialog.save = function () { return Promise.resolve(${JSON.stringify(replacement)}); };
      window.__TAURI__.dialog.confirm = function () { return Promise.resolve(true); };
    })()`);
    await fileAction(engine, "save-as");
    await waitForFileContents(replacement, edited + " later");
    await waitUntil(() => engine.evaluate(`document.getElementById('file-path').textContent === ${JSON.stringify(replacement)}`), 5000, "replacement identity");
    await fileAction(engine, "new");
    await waitForEditor(engine, "");
    await engine.evaluate(`window.__TAURI__.dialog.save = function () { return Promise.resolve(${JSON.stringify(emptyPath)}); }`);
    await engine.sendKeys([{ key: "s", ctrl: true }]);
    await waitForFileContents(emptyPath, "");
    await waitUntil(() => engine.evaluate(`document.getElementById('file-path').textContent === ${JSON.stringify(emptyPath)}`), 5000, "empty untitled identity");

    await fileAction(engine, "new");
    await waitForEditor(engine, "");
    await appendInSource(engine, "untitled\nbody");
    await delay(60);
    await engine.evaluate(`window.__TAURI__.dialog.save = function () { return Promise.resolve(null); }`);
    await fileAction(engine, "new");
    await decision(engine, "save");
    await waitForEditor(engine, "untitled\nbody");
    if (await engine.evaluate(`document.getElementById('file-path').textContent`) !== "") throw new Error("Cancelled untitled Save changed its identity.");
    await engine.evaluate(`window.__TAURI__.dialog.save = function () { return Promise.resolve(${JSON.stringify(untitledPath)}); }`);
    await fileAction(engine, "new");
    await decision(engine, "save");
    await waitForEditor(engine, "");
    if (fs.readFileSync(untitledPath, "utf8") !== "untitled\nbody") throw new Error("Untitled Save before New did not preserve LF source.");
  } finally {
    if (fs.existsSync(denied)) fs.chmodSync(denied, 0o755);
    if (engine) await engine.close().catch(() => {});
  }
}

async function verifyFileLifecycle(driver, scratch) {
  const data = path.join(scratch, "file-lifecycle-data");
  const first = path.join(scratch, "first caffè.md");
  const next = path.join(scratch, "next Ω.md");
  const missing = path.join(scratch, "missing lifecycle.md");
  const invalid = path.join(scratch, "invalid lifecycle.md");
  const saved = "Original\n";
  const edited = saved + "unsaved";
  const nextRaw = "# Next\r\nline  \r\n";
  fs.writeFileSync(first, saved);
  fs.writeFileSync(next, nextRaw);
  fs.writeFileSync(invalid, Buffer.from([255, 254]));
  let engine = null;
  try {
    engine = new TauriEngine(driver, APPLICATION, [first], { ...process.env, XDG_DATA_HOME: data });
    await engine.start();
    await waitForEditor(engine, saved);
    await appendInSource(engine, "unsaved");
    await delay(60);
    const directory = path.join(data, "amorist", "recovery-sessions");
    await waitForRecovery(directory, edited, 5000);
    await engine.evaluate(`window.__qaOriginalSource = document.querySelector('.amorist-editor-source')`);

    async function unchanged() {
      const same = await engine.evaluate(`document.querySelector('.amorist-editor-source') === window.__qaOriginalSource`);
      const snapshot = await editorSnapshot(engine);
      const currentPath = await engine.evaluate(`document.getElementById('file-path').textContent`);
      if (!same || snapshot.source !== edited || currentPath !== first
          || !recoveryRecords(directory).some((r) => r.unsavedSource === edited)) {
        throw new Error("A cancelled/failed file action changed the original session: " + JSON.stringify(snapshot));
      }
    }
    await engine.evaluate(`window.__TAURI__.dialog.open = function () { return Promise.resolve(null); }`);
    await engine.evaluate(`(function () {
      document.getElementById('file-menu').open = true;
      document.querySelector('[data-file-action="open"]').focus();
    })()`);
    await engine.sendKeys([{ key: "Escape" }]);
    if (await engine.evaluate(`document.getElementById('file-menu').open`)) throw new Error("Escape left the File menu open.");
    await unchanged();
    await fileAction(engine, "open");
    await delay(60);
    await unchanged();
    await engine.sendKeys([{ key: "o", ctrl: true }]);
    await delay(60);
    await unchanged();
    await engine.sendKeys([{ key: "n", ctrl: true }]);
    await decision(engine, "escape");
    await unchanged();
    await engine.sendKeys([{ key: "z", ctrl: true }]);
    await delay(60);
    if ((await editorSnapshot(engine)).source === edited) throw new Error("Cancellation reset undo history.");
    await engine.sendKeys([{ key: "y", ctrl: true }]);
    await delay(60);
    await waitForRecovery(directory, edited, 5000);
    await unchanged();

    // Recovery selection is part of preparation: cancelling it must not
    // commit Open, even after Discard was chosen for the original document.
    const copyIds = ["open-copy-a", "open-copy-b"];
    for (const id of copyIds) {
      const folder = path.join(directory, id);
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, "record.json"), JSON.stringify({ schemaVersion: 1,
        sessionId: id, path: next, savedSource: nextRaw, unsavedSource: nextRaw + id,
        revision: 1, boundaryState: null, legacyImport: false }));
    }
    await engine.evaluate(`window.__TAURI__.dialog.open = function () { return Promise.resolve(${JSON.stringify(next)}); }`);
    await fileAction(engine, "open");
    await decision(engine, "discard");
    await waitUntil(() => engine.evaluate(`Boolean(document.querySelector('#recovery-dialog[open]'))`), 5000, "Open recovery choice");
    await engine.sendKeys([{ key: "Escape" }]);
    await delay(60);
    await unchanged();
    for (const id of copyIds) fs.rmSync(path.join(directory, id), { recursive: true });

    for (const file of [missing, invalid]) {
      await engine.evaluate(`window.__TAURI__.dialog.open = function () { return Promise.resolve(${JSON.stringify(file)}); }`);
      await fileAction(engine, "open");
      await decision(engine, "discard");
      await waitUntil(async () => /could not|No such|UTF-8|not exist/i.test((await editorSnapshot(engine)).notice), 5000, "failed Open notice");
      await unchanged();
    }
    if (fs.existsSync(missing)) throw new Error("Open created a missing file.");
    if (!fs.readFileSync(invalid).equals(Buffer.from([255, 254]))) throw new Error("Open changed an invalid file.");

    // A rejected Save must not perform New or drop the recovery copy.
    await delay(1100);
    fs.writeFileSync(first, "external change\n");
    await engine.evaluate(`window.__TAURI__.dialog.confirm = function () { return Promise.resolve(false); }`);
    await fileAction(engine, "new");
    await decision(engine, "save");
    await waitUntil(async () => /File changed on disk/.test((await editorSnapshot(engine)).notice), 5000, "failed Save preflight");
    await unchanged();
    if (fs.readFileSync(first, "utf8") !== "external change\n") throw new Error("Failed Save overwrote the external file.");

    const unrelated = path.join(directory, "unrelated-untitled");
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(unrelated, "record.json"), JSON.stringify({ schemaVersion: 1,
      sessionId: "unrelated-untitled", path: null, savedSource: "", unsavedSource: "older untitled work",
      revision: 1, boundaryState: null, legacyImport: false }));
    await fileAction(engine, "new");
    await decision(engine, "discard");
    await waitForEditor(engine, "", { noticeHidden: true });
    if (await engine.evaluate(`document.getElementById('file-path').textContent`) !== "") throw new Error("New retained the old path.");
    await waitUntil(() => recoveryRecords(directory).length === 1, 5000, "only the old document's copy to be discarded");
    if (recoveryRecords(directory)[0].sessionId !== "unrelated-untitled") throw new Error("New discarded an unrelated untitled recovery.");
    await engine.sendKeys([{ key: "z", ctrl: true }]);
    if ((await editorSnapshot(engine)).source !== "") throw new Error("New retained the old undo history.");

    await engine.evaluate(`window.__TAURI__.dialog.open = function () { return Promise.resolve(${JSON.stringify(next)}); }`);
    await fileAction(engine, "open");
    await waitForEditor(engine, nextRaw.replace(/\r\n/g, "\n"), { noticeHidden: true });
    await appendInSource(engine, " saved before New");
    await delay(60);
    await fileAction(engine, "new");
    await decision(engine, "save");
    await waitForEditor(engine, "", { noticeHidden: true });
    if (fs.readFileSync(next, "utf8") !== nextRaw + " saved before New") throw new Error("New/Save did not commit exact source before changing context.");
    await fileAction(engine, "open");
    await waitForEditor(engine, (nextRaw + " saved before New").replace(/\r\n/g, "\n"));
    await engine.sendKeys([{ key: "z", ctrl: true }]);
    await delay(60);
    if ((await editorSnapshot(engine)).source !== (nextRaw + " saved before New").replace(/\r\n/g, "\n")) throw new Error("Open retained the previous document's undo history.");
  } finally {
    if (engine) await engine.close().catch(() => {});
  }
}

async function verifyEditingDuringSave(driver, scratch) {
  const data = path.join(scratch, "pending-save-data");
  const document = path.join(scratch, "pending save.md");
  const environment = { ...process.env, XDG_DATA_HOME: data };
  const ready = path.join(scratch, "pending-save-ready");
  const release = path.join(scratch, "pending-save-release");
  const result = path.join(scratch, "pending-save-result");
  const captured = "original first second";
  const latest = captured + " newer";
  fs.writeFileSync(document, "original");
  let engine = null;
  let worker = null;
  try {
    engine = new TauriEngine(driver, APPLICATION, [document], environment);
    await engine.start();
    await waitForEditor(engine, "original");
    await appendInSource(engine, " first");
    await delay(60);
    await engine.evaluate(`document.getElementById('save-button').click()`);
    await waitForFileContents(document, "original first");
    await waitUntil(async () => (await editorSnapshot(engine)).status === "Saved", 5000, "the first save response to settle");
    await appendInSource(engine, " second");
    await delay(60);
    const job = { root: path.join(data, "dev.elmisi.amorist", "locks"), path: document,
      ready, result, expected: "Any", content: "", append_count: 0, number: 0, hold_until: release };
    worker = childProcess.spawn("cargo", ["test", "--manifest-path", MANIFEST, "--lib",
      "file_io::tests::process_operation", "--", "--ignored", "--exact"],
    { env: { ...process.env, AMORIST_QA_FILE_JOB: JSON.stringify(job) }, stdio: "ignore" });
    await waitUntil(() => fs.existsSync(ready), 15000, "the separate process to hold the document lock");
    await engine.evaluate(`document.getElementById('save-button').click()`);
    await waitUntil(async () => /^Saving\b/.test((await editorSnapshot(engine)).status), 5000, "Save to wait for its lock");
    await appendInSource(engine, " newer");
    const editedAt = Date.now();
    const directory = path.join(data, "amorist", "recovery-sessions");
    await waitForRecovery(directory, latest, RECOVERY_INTERVAL_MS + TIMER_TOLERANCE_MS);
    if (Date.now() - editedAt > RECOVERY_INTERVAL_MS + TIMER_TOLERANCE_MS) throw new Error("Recovery missed its interval while Save waited.");
    if (fs.readFileSync(document, "utf8") !== "original first") throw new Error("Save bypassed the held process lock.");
    if (recoveryRecords(directory).find((r) => r.unsavedSource === latest).savedSource !== "original first") {
      throw new Error("Recovery before Save completed did not use the original committed base.");
    }
    fs.writeFileSync(release, "release");
    await waitForFileContents(document, captured);
    await waitUntil(async () => !/^Saving\b/.test((await editorSnapshot(engine)).status), 5000, "the save response to settle");
    await waitForRecovery(directory, latest, 5000);
    const recovered = recoveryRecords(directory).find((r) => r.unsavedSource === latest);
    if (recovered.savedSource !== captured) throw new Error("Pending-save recovery used the previous saved base.");
    await delay(60);
    const snapshot = await editorSnapshot(engine);
    if (snapshot.source !== latest || !/modified/i.test(snapshot.status)) {
      throw new Error("Save marked edits made during lock wait as saved: " + JSON.stringify(snapshot));
    }
    await waitUntil(() => fs.existsSync(result), 5000, "the lock holder to finish");
    if (JSON.parse(fs.readFileSync(result, "utf8")).Ok !== null) throw new Error("The separate lock holder failed.");
    await engine.evaluate(`(function () {
      window.__TAURI__.dialog.confirm = function () { return Promise.resolve(true); };
      document.getElementById('reload-button').click();
    })()`);
    await waitForEditor(engine, captured, { noticeHidden: true });
    const rejected = await engine.evaluate(`(async function () {
      var requests = [
        ['persist_working_copy', {savedSource: ${JSON.stringify(captured)}, unsavedSource: 'stale callback', revision: 999, boundaryState: null, contextId: 1}],
        ['discard_working_copy', {contextId: 1}],
        ['save_document', {markdown: 'stale save', force: true, revision: 999, contextId: 1}]
      ];
      for (var request of requests) {
        try { await window.__TAURI__.core.invoke(request[0], request[1]); return false; }
        catch (error) { if (String(error).indexOf('STALE_DOCUMENT') < 0) throw error; }
      }
      return true;
    })()`);
    if (!rejected || fs.readFileSync(document, "utf8") !== captured || recoveryRecords(directory).length) {
      throw new Error("An obsolete document context modified the new editor or its recovery.");
    }
  } finally {
    fs.writeFileSync(release, "release");
    if (worker && worker.exitCode === null) worker.kill("SIGTERM");
    if (engine) await engine.close().catch(() => {});
  }
}

async function verifyConcurrentNativeSaves(driver, scratch) {
  const data = path.join(scratch, "concurrent-save-data");
  const document = path.join(scratch, "concurrent save caffè.md");
  const environment = { ...process.env, XDG_DATA_HOME: data };
  const saved = "Original\r\n";
  fs.writeFileSync(document, saved);
  let first = null;
  let second = null;
  try {
    first = new TauriEngine(driver, APPLICATION, [document], environment);
    await first.start();
    await waitForEditor(first, saved.replace(/\r\n/g, "\n"));
    await appendInSource(first, "first writer");
    second = new TauriEngine(driver, APPLICATION, [document], environment);
    await second.start();
    await waitForEditor(second, saved.replace(/\r\n/g, "\n"));
    await appendInSource(second, "second writer");
    await delay(60);
    await first.evaluate(`document.getElementById('save-button').click()`);
    await waitForFileContents(document, saved + "first writer");
    await second.evaluate(`(function () {
      window.__TAURI__.dialog.confirm = function () { return Promise.resolve(false); };
      document.getElementById('save-button').click();
    })()`);
    await waitUntil(async () => /File changed on disk/.test((await editorSnapshot(second)).notice), 10000, "second-instance save conflict");
    const current = await editorSnapshot(second);
    if (current.source !== saved.replace(/\r\n/g, "\n") + "second writer") throw new Error("Conflicting Save lost the second instance's text.");
    if (fs.readFileSync(document, "utf8") !== saved + "first writer") throw new Error("The second instance silently replaced the first instance's save.");
  } finally {
    if (first) await first.close().catch(() => {});
    if (second) await second.close().catch(() => {});
  }
}

async function verifyIndependentRecoverySessions(driver, scratch) {
  const data = path.join(scratch, "independent-data");
  const document = path.join(scratch, "same path caffè.md");
  const directory = path.join(data, "amorist", "recovery-sessions");
  const environment = { ...process.env, XDG_DATA_HOME: data };
  const saved = "Session baseline\n";
  const firstText = saved + "first unique unsaved";
  const secondText = saved + "second unique unsaved";
  fs.writeFileSync(document, saved);
  let first = null;
  let second = null;
  try {
    first = new TauriEngine(driver, APPLICATION, [document], environment);
    await first.start();
    await waitForEditor(first, saved);
    await appendInSource(first, "first unique unsaved");
    await waitForRecovery(directory, firstText, 5000);
    second = new TauriEngine(driver, APPLICATION, [document], environment);
    await second.start();
    await waitForEditor(second, saved);
    await appendInSource(second, "second unique unsaved");
    await waitForRecovery(directory, secondText, 5000);
    if (recoveryRecords(directory).length !== 2) throw new Error("Live same-path sessions shared a recovery record.");
    await first.crashApplication();
    first = null;
    await second.crashApplication();
    second = null;

    first = new TauriEngine(driver, APPLICATION, [document], environment);
    await first.start();
    await waitUntil(() => first.evaluate(`Boolean(document.querySelector('#recovery-dialog[open]'))`), 10000, "explicit recovery choice");
    const fits = await first.evaluate(`(function () {
      var dialog = document.getElementById('recovery-dialog');
      var select = document.getElementById('recovery-choice');
      return dialog.getBoundingClientRect().width <= window.innerWidth
        && select.getBoundingClientRect().width <= dialog.clientWidth;
    })()`);
    if (!fits) throw new Error("The recovery dialog overflowed its viewport.");
    await first.sendKeys([{ key: "Escape" }]);
    await waitForEditor(first, saved);
    if (recoveryRecords(directory).length !== 2) throw new Error("Cancelling recovery deleted a copy.");
    await first.crashApplication();
    first = null;
    first = new TauriEngine(driver, APPLICATION, [document], environment);
    await first.start();
    await waitUntil(() => first.evaluate(`Boolean(document.querySelector('#recovery-dialog[open]'))`), 10000, "recovery choice after cancellation");
    await first.evaluate(`(function () {
      var select = document.getElementById('recovery-choice');
      var option = Array.from(select.options).find(function (o) { return o.textContent.includes('second unique unsaved'); });
      if (!option) throw new Error('Second independent copy is missing');
      select.value = option.value;
      document.getElementById('recover-selected').click();
    })()`);
    await waitForEditor(first, secondText);
    if (recoveryRecords(directory).length !== 2) throw new Error("Choosing recovery deleted another copy.");
    await first.evaluate(`window.__TAURI__.dialog.confirm = function () { return Promise.resolve(true); }`);
    await reloadCleanDocument(first, saved);
    await waitUntil(() => recoveryRecords(directory).length === 1, 5000, "own-copy discard");
    if (recoveryRecords(directory)[0].unsavedSource !== firstText) throw new Error("Discard removed the other session's work.");
    await first.crashApplication();
    first = null;
    first = new TauriEngine(driver, APPLICATION, [document], environment);
    await first.start();
    await waitForEditor(first, firstText);
    if (fs.readFileSync(document, "utf8") !== saved) throw new Error("Recovery changed the document before Save.");
    await first.evaluate(`document.getElementById('save-button').click()`);
    await waitForFileContents(document, firstText);
    await waitForMissing(directory);
    await appendInSource(first, " saved before timer");
    await delay(60);
    await first.evaluate(`document.getElementById('save-button').click()`);
    const earlySaved = firstText + " saved before timer";
    await waitForFileContents(document, earlySaved);
    await delay(RECOVERY_INTERVAL_MS + TIMER_TOLERANCE_MS);
    if (recoveryRecords(directory).length) throw new Error("A stale timer recreated recovery after Save.");
    await first.crashApplication();
    first = null;

    first = new TauriEngine(driver, APPLICATION, [], environment);
    await first.start();
    await waitForEditor(first, "");
    await appendInSource(first, "Untitled recovery Ω");
    await waitForRecovery(directory, "Untitled recovery Ω", 5000);
    if (recoveryRecords(directory)[0].path !== null) throw new Error("Untitled recovery acquired a document path.");
    await first.crashApplication();
    first = null;
    first = new TauriEngine(driver, APPLICATION, [], environment);
    await first.start();
    await waitForEditor(first, "Untitled recovery Ω");
    if (fs.readFileSync(document, "utf8") !== earlySaved) throw new Error("Untitled recovery changed an unrelated file.");
    await first.crashApplication();
    first = null;
    const legacyPath = path.join(data, "amorist", "working-copy.json");
    const legacyText = earlySaved + " migrated legacy work";
    fs.writeFileSync(legacyPath, JSON.stringify({ path: document, savedSource: earlySaved,
      unsavedSource: legacyText, revision: 9 }));
    first = new TauriEngine(driver, APPLICATION, [document], environment);
    await first.start();
    await waitForEditor(first, legacyText);
    if (!fs.existsSync(legacyPath) || recoveryRecords(directory).length !== 2) {
      throw new Error("Legacy migration did not preserve the imported and untitled copies independently.");
    }
    if (fs.readFileSync(document, "utf8") !== earlySaved) throw new Error("Legacy migration wrote the user document.");
    await first.evaluate(`document.getElementById('save-button').click()`);
    await waitForFileContents(document, legacyText);
    await waitUntil(() => recoveryRecords(directory).length === 1, 5000, "imported own-copy removal");
    await first.crashApplication();
    first = null;
    first = new TauriEngine(driver, APPLICATION, [document], environment);
    await first.start();
    await waitForEditor(first, legacyText, { noticeHidden: true });
    if (recoveryRecords(directory).length !== 1) throw new Error("Already imported legacy work reappeared after Save.");
  } finally {
    if (first) await first.close().catch(() => {});
    if (second) await second.close().catch(() => {});
  }
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
  // Reading through the Source toggle must follow the final native input event.
  await delay(60);
  const shortcutSource = await applicationMarkdown(engine);
  if (shortcutSource !== "- alpha") {
    failures.B4.push({ fixture: "built app bullet shortcut", detail: "Typing after the projected bullet reordered the source.", expected: "- alpha", actual: shortcutSource });
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
    var markerRight = markerStyle.position === "absolute"
      ? rowRect.left + (parseFloat(markerStyle.left) || 0) + (parseFloat(markerStyle.width) || 0)
      : rowRect.left + (parseFloat(rowStyle.paddingLeft) || 0)
        + (parseFloat(markerStyle.marginLeft) || 0) + (parseFloat(markerStyle.width) || 0);
    var checkbox = row.querySelector(".amorist-task-checkbox");
    if (checkbox) markerRight = checkbox.getBoundingClientRect().right;
    return { caretX: caretX, markerRight: markerRight, afterMarker: caretX >= markerRight - 1 };
  })()`);
}

async function reloadCleanDocument(engine, expected) {
  // A file can reach disk just before Save's UI response reenables Reload.
  // Fixtures must wait for that response, as a real click on the disabled
  // button cannot start a reload either.
  await waitUntil(() => engine.evaluate(`!document.getElementById('reload-button').disabled`), 5000, "Reload to become available after Save");
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

async function verifyApplicationWrapperPositions(engine, samples) {
  const failures = [];
  for (const sample of samples) {
    await setApplicationPosition(engine, "middle", sample.token);
    let before = await applicationPositionSnapshot(engine);
    for (const direction of ["WYSIWYG to Source", "Source to WYSIWYG"]) {
      await engine.evaluate(`document.querySelector('[data-action="source"]').click()`);
      await delay(100);
      const after = await applicationPositionSnapshot(engine);
      if (after.views.source === after.views.wysiwyg || after.line !== before.line) {
        failures.push({
          fixture: `long mixed geometry, ${sample.name}`,
          direction,
          detail: "The built app changed the physical line at a projection-wrapper midpoint.",
          expected: `source line ${before.line}, exactly one visible view`,
          actual: JSON.stringify(after),
        });
      }
      before = after;
    }
  }
  return failures;
}

async function setApplicationPosition(engine, position, token) {
  await engine.evaluate(`(async function () {
    var source = document.querySelector(".amorist-editor-source");
    var button = document.querySelector('[data-action="source"]');
    if (!source.hidden) button.click();
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
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
    if (${JSON.stringify(position)} === "middle") {
      var rowRect = row.getBoundingClientRect();
      var surfaceRect = surface.getBoundingClientRect();
      surface.scrollTop += (rowRect.top + rowRect.bottom) / 2
        - (surfaceRect.top + surface.clientHeight / 2);
    } else surface.scrollTop = ${JSON.stringify(position)} === "end" ? surface.scrollHeight : 0;
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

function recoveryRecords(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const file = path.join(directory, entry.name, "record.json");
      return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, "utf8"))] : [];
    });
}

async function waitForRecovery(file, expected, timeout) {
  await waitUntil(() => {
    try {
      return recoveryRecords(file).some((record) => record.unsavedSource === expected);
    } catch {
      return false;
    }
  }, timeout, `the exact recovery copy to be persisted by the ${RECOVERY_INTERVAL_MS} ms timer`);
}

async function waitForFileContents(file, expected) {
  await waitUntil(() => fs.readFileSync(file, "utf8") === expected, 8000, "the explicit Save to reach the document");
}

async function waitForMissing(file) {
  await waitUntil(() => recoveryRecords(file).length === 0, 8000, "the recovery copy to be discarded");
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
