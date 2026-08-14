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
  const results = { E1: [], E2: [], fixtures: [] };
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
    return results;
  }
  if (!process.env.DISPLAY) {
    const failure = {
      fixture: "the built Tauri application",
      detail: "No graphical display is available. Run the QA command under xvfb-run so the app-level recovery check can execute.",
    };
    results.E1.push(failure);
    results.E2.push(failure);
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
    return results;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-tauri-e2e-"));
  const dataHome = path.join(scratch, "data");
  const documentPath = path.join(scratch, "recovery.md");
  const recoveryPath = path.join(dataHome, "amorist", "working-copy.json");
  const saved = "# Recovery fixture\n\nOriginal line with two spaces  \nUnicode: caffè λ\n";
  const crashSuffix = "\nUnsaved before crash  \nSecond line Ω\n";
  const saveSuffix = "\nExplicitly saved ✓\n";
  fs.mkdirSync(dataHome, { recursive: true });
  fs.writeFileSync(documentPath, saved, "utf8");
  const originalStat = fs.statSync(documentPath, { bigint: true });
  const environment = { ...process.env, XDG_DATA_HOME: dataHome };

  let engine = null;
  try {
    engine = new TauriEngine(driver, APPLICATION, [documentPath], environment);
    await engine.start();
    await waitForEditor(engine, saved);
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
  } finally {
    if (engine) await engine.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return results;
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
