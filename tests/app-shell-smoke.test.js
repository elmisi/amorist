const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const RUN_FLAG = "AMORIST_RUN_BROWSER_SMOKE";

if (!process.env[RUN_FLAG]) {
  console.log(`Skipping browser smoke test. Set ${RUN_FLAG}=1 to run it.`);
  process.exit(0);
}

const browser = findBrowser();
if (!browser) {
  console.log("Skipping browser smoke test. No Chromium-compatible browser was found.");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run() {
  await runCloseIdleTabCheck();
  await runEditCheck();
  await runUndoFindCheck();
  await runListIndentCheck();
  await runDirtyIpcCheck();
  console.log("app-shell-smoke.test.js passed");
}

async function runDirtyIpcCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-smoke-dirty-ipc-"));
  const markdownPath = path.join(tempDir, "stub.md");
  fs.writeFileSync(markdownPath, "stub server document", "utf8");
  let server;
  let chrome;
  let pageSocket;
  try {
    server = await startAmorist(markdownPath);
    chrome = await startChrome(browser, tempDir);
    const instrumented = await openInstrumentedPage(chrome.debuggingUrl, server.url, tauriStubScript());
    pageSocket = instrumented.socket;
    const result = await evaluateWithNavigationRetry(pageSocket, dirtyIpcBrowserScript());
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Dirty IPC check failed.");
    assert.deepEqual(result.result.value, {
      dirtyBeforeSave: true,
      dirtyAfterSave: false,
      setDirtyArguments: [true, false],
      savedLength: 20,
    });
  } finally {
    if (pageSocket) pageSocket.close();
    if (chrome) await terminate(chrome.process);
    if (server) await terminate(server.process);
    await removeTempDir(tempDir);
  }
}

function tauriStubScript() {
  return `(() => {
    const calls = [];
    let markdown = "";
    window.__TAURI_INVOKES__ = calls;
    window.__TAURI__ = {
      core: {
        invoke: async function (command, args) {
          calls.push({ command: command, args: args || {} });
          if (command === "read_document") return { markdown: markdown, recoveryMarkdown: null, exists: true, name: "stub.md", path: "/tmp/stub.md" };
          if (command === "get_version") return "test";
          if (command === "set_dirty" || command === "discard_working_copy" || command === "persist_working_copy" || command === "force_close") return null;
          if (command === "save_document") { markdown = args.markdown; window.__TAURI_SAVED__ = markdown; return null; }
          throw new Error("Unexpected Tauri command: " + command);
        }
      },
      event: { listen: async function () { return function () {}; } },
      dialog: { confirm: async function () { return true; } },
      window: { getCurrentWindow: function () { return { setTitle: async function () {} }; } }
    };
  })();`;
}

function dirtyIpcBrowserScript() {
  return `(${async function () {
    function waitFor(predicate, label) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const tick = () => {
          if (predicate()) { resolve(); return; }
          if (Date.now() > deadline) { reject(new Error("Timed out: " + label)); return; }
          setTimeout(tick, 25);
        };
        tick();
      });
    }
    await waitFor(() => document.querySelector(".amorist-editor-surface"), "editor mount");
    const surface = document.querySelector(".amorist-editor-surface");
    const row = surface.querySelector(".amorist-source-line");
    const range = document.createRange();
    range.selectNodeContents(row);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    surface.focus();
    for (let index = 0; index < 20; index += 1) {
      surface.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "x",
      }));
    }
    await waitFor(() => document.body.classList.contains("is-dirty"), "dirty transition");
    const dirtyBeforeSave = document.body.classList.contains("is-dirty");
    document.getElementById("save-button").click();
    await waitFor(() => !document.body.classList.contains("is-dirty"), "clean transition");
    document.getElementById("reload-button").click();
    await waitFor(() => document.getElementById("status").textContent === "Loaded", "clean reload");
    return {
      dirtyBeforeSave: dirtyBeforeSave,
      dirtyAfterSave: document.body.classList.contains("is-dirty"),
      setDirtyArguments: window.__TAURI_INVOKES__
        .filter(function (call) { return call.command === "set_dirty"; })
        .map(function (call) { return call.args.dirty; }),
      savedLength: (window.__TAURI_SAVED__ || "").length,
    };
  }})()`;
}

async function runCloseIdleTabCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-smoke-close-"));
  const markdownPath = path.join(tempDir, "close.md");
  fs.writeFileSync(markdownPath, "# Close\n\nIdle\n", "utf8");

  let server;
  let chrome;
  let pageSocket;
  try {
    server = await startAmorist(markdownPath);
    chrome = await startChrome(browser, tempDir);
    const page = await openPage(chrome.debuggingUrl, server.url);
    pageSocket = await WebSocketConnection.open(page.webSocketDebuggerUrl);

    const result = await evaluateWithNavigationRetry(pageSocket, waitForEditorScript());
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
    }

    pageSocket.close();
    pageSocket = null;
    await closePage(chrome.debuggingUrl, page.id);
    await waitForExit(server.process, 16000);
    server = null;
  } finally {
    if (pageSocket) pageSocket.close();
    if (chrome) await terminate(chrome.process);
    if (server) await terminate(server.process);
    await removeTempDir(tempDir);
  }
}

async function runEditCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-smoke-"));
  const markdownPath = path.join(tempDir, "smoke.md");
  fs.writeFileSync(markdownPath, "# Smoke\n\nInitial\n", "utf8");

  let server;
  let chrome;
  let pageSocket;
  try {
    server = await startAmorist(markdownPath);
    chrome = await startChrome(browser, tempDir);
    const page = await openPage(chrome.debuggingUrl, server.url);
    pageSocket = await WebSocketConnection.open(page.webSocketDebuggerUrl);

    const result = await evaluateWithNavigationRetry(pageSocket, browserScript());
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
    }

    assert.equal(fs.readFileSync(markdownPath, "utf8"), "Changed from smoke");
    assert.deepEqual(result.result.value, {
      dirty: false,
      status: "Loaded",
      text: "Changed from smoke",
    });
  } finally {
    if (pageSocket) pageSocket.close();
    if (chrome) await terminate(chrome.process);
    if (server) await terminate(server.process);
    await removeTempDir(tempDir);
  }
}

async function runUndoFindCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-smoke-undo-"));
  const markdownPath = path.join(tempDir, "undo.md");
  fs.writeFileSync(markdownPath, "# Hello\n\nWorld\n", "utf8");

  let server;
  let chrome;
  let pageSocket;
  try {
    server = await startAmorist(markdownPath);
    chrome = await startChrome(browser, tempDir);
    const page = await openPage(chrome.debuggingUrl, server.url);
    pageSocket = await WebSocketConnection.open(page.webSocketDebuggerUrl);

    const result = await evaluateWithNavigationRetry(pageSocket, undoFindBrowserScript());
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Undo/find check failed.");
    }

    assert.deepEqual(result.result.value, {
      undoWorked: true,
      findBarOpened: true,
      matchCount: "1 of 3",
      findBarClosed: true,
    });
  } finally {
    if (pageSocket) pageSocket.close();
    if (chrome) await terminate(chrome.process);
    if (server) await terminate(server.process);
    await removeTempDir(tempDir);
  }
}

function undoFindBrowserScript() {
  return `(${async function () {
    function waitFor(predicate, label) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const tick = () => {
          if (predicate()) { resolve(); return; }
          if (Date.now() > deadline) { reject(new Error("Timed out: " + label)); return; }
          setTimeout(tick, 50);
        };
        tick();
      });
    }

    await waitFor(() => document.querySelector(".amorist-editor-surface"), "editor mount");
    var surface = document.querySelector(".amorist-editor-surface");
    var source = document.querySelector(".amorist-editor-source");

    // Insert through the editor's current beforeinput transaction path. Direct
    // innerHTML mutation belonged to the removed DOM-authoritative editor and
    // could no longer make the application dirty.
    var walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    var target = walker.nextNode();
    while (target && !target.textContent.includes("World")) target = walker.nextNode();
    if (!target) throw new Error("Could not locate the word to edit.");
    var range = document.createRange();
    range.setStart(target, target.textContent.indexOf("World") + "World".length);
    range.collapse(true);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    surface.focus();
    surface.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "!",
    }));
    await waitFor(() => document.body.classList.contains("is-dirty"), "dirty");

    // Wait for debounce to push to history
    await new Promise(r => setTimeout(r, 600));

    // Undo via Ctrl+Z
    surface.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 100));
    var undoWorked = surface.textContent.includes("World") && !surface.textContent.includes("World!");

    // Open find bar via Ctrl+F
    surface.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 100));
    var findBar = document.querySelector(".amorist-editor-findbar");
    var findBarOpened = findBar && !findBar.hidden;

    // Type a search query — "l" appears twice in Hello and once in World.
    var findInput = document.querySelector(".amorist-editor-findbar-input");
    findInput.value = "l";
    findInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    var countLabel = document.querySelector(".amorist-editor-findbar-count");
    var matchCount = countLabel ? countLabel.textContent : "";

    // Close with Escape
    findInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 100));
    var findBarClosed = findBar.hidden === true;

    return { undoWorked, findBarOpened, matchCount, findBarClosed };
  }})()`;
}

function findBrowser() {
  if (process.env.BROWSER && fs.existsSync(process.env.BROWSER)) return process.env.BROWSER;
  for (const candidate of ["google-chrome", "chromium", "chromium-browser"]) {
    const found = childProcess.spawnSync("which", [candidate], { encoding: "utf8" });
    if (found.status === 0) return found.stdout.trim();
  }
  return "";
}

function startAmorist(markdownPath) {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn("./bin/amorist", ["--no-open", markdownPath], {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for amorist URL.")), 10000);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const match = stdout.match(/^URL: (.+)$/m);
      if (match) {
        clearTimeout(timer);
        resolve({ process: proc, url: match[1] });
      }
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (!stdout.includes("URL: ")) reject(new Error(`amorist exited before printing a URL: ${code}`));
    });
  });
}

function startChrome(browserPath, tempDir) {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn(browserPath, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${path.join(tempDir, "chrome-profile")}`,
      "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools URL.")), 10000);
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ process: proc, debuggingUrl: match[1] });
      }
    });
    proc.on("error", reject);
  });
}

async function openPage(browserWebSocketUrl, targetUrl) {
  const browserUrl = new URL(browserWebSocketUrl);
  const body = await httpRequest({
    method: "PUT",
    hostname: browserUrl.hostname,
    port: browserUrl.port,
    path: `/json/new?${encodeURIComponent(targetUrl)}`,
  });
  return JSON.parse(body);
}

async function openInstrumentedPage(browserWebSocketUrl, targetUrl, preloadScript) {
  const page = await openPage(browserWebSocketUrl, "about:blank");
  const socket = await WebSocketConnection.open(page.webSocketDebuggerUrl);
  await socket.send("Page.enable", {});
  await socket.send("Page.addScriptToEvaluateOnNewDocument", { source: preloadScript });
  await socket.send("Page.navigate", { url: targetUrl });
  return { page, socket };
}

async function closePage(browserWebSocketUrl, pageId) {
  const browserUrl = new URL(browserWebSocketUrl);
  await httpRequest({
    method: "GET",
    hostname: browserUrl.hostname,
    port: browserUrl.port,
    path: `/json/close/${encodeURIComponent(pageId)}`,
  });
}

function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function waitForEditorScript() {
  return `(${async function () {
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const tick = () => {
        if (document.querySelector(".amorist-editor-surface")) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("Timed out waiting for editor mount"));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
    return true;
  }})()`;
}

// Tab / Shift-Tab drive list nesting in the WYSIWYG surface. Asserting on the
// saved file (not just the DOM) covers the whole chain: the keyboard handler
// restructures the list, the serializer indents it, and the parser reads the
// nesting back on reload.
async function runListIndentCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-smoke-indent-"));
  const markdownPath = path.join(tempDir, "indent.md");
  fs.writeFileSync(markdownPath, "- one\n- two\n- three\n", "utf8");

  let server;
  let chrome;
  let pageSocket;
  try {
    server = await startAmorist(markdownPath);
    chrome = await startChrome(browser, tempDir);
    const page = await openPage(chrome.debuggingUrl, server.url);
    pageSocket = await WebSocketConnection.open(page.webSocketDebuggerUrl);

    const indented = await evaluateWithNavigationRetry(pageSocket, listIndentBrowserScript("indent"));
    if (indented.exceptionDetails) {
      throw new Error(indented.exceptionDetails.text || "List indent check failed.");
    }
    assert.equal(indented.result.value, true);
    assert.equal(fs.readFileSync(markdownPath, "utf8"), "- one\n  - two\n- three\n");

    const outdented = await evaluateWithNavigationRetry(pageSocket, listIndentBrowserScript("outdent"));
    if (outdented.exceptionDetails) {
      throw new Error(outdented.exceptionDetails.text || "List outdent check failed.");
    }
    assert.equal(outdented.result.value, true);
    assert.equal(fs.readFileSync(markdownPath, "utf8"), "- one\n- two\n- three\n");
  } finally {
    if (pageSocket) pageSocket.close();
    if (chrome) await terminate(chrome.process);
    if (server) await terminate(server.process);
    await removeTempDir(tempDir);
  }
}

function listIndentBrowserScript(step) {
  return `(${async function (mode) {
    function waitFor(predicate, label) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const tick = () => {
          if (predicate()) {
            resolve();
            return;
          }
          if (Date.now() > deadline) {
            reject(new Error(`Timed out waiting for ${label}`));
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      });
    }

    function caretAtEndOf(row) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let target = walker.nextNode();
      let next = target;
      while (next) { target = next; next = walker.nextNode(); }
      target = target || row;
      const range = document.createRange();
      const offset = target.nodeType === 3
        ? (target.textContent === "\n" ? 0 : target.textContent.length)
        : 0;
      range.setStart(target, offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function pressTab(row, shiftKey) {
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }));
    }

    async function save() {
      await waitFor(() => document.body.classList.contains("is-dirty"), "dirty state");
      document.getElementById("save-button").click();
      await waitFor(
        () => !document.body.classList.contains("is-dirty") && document.getElementById("status").textContent === "Saved",
        "save",
      );
    }

    await waitFor(() => document.querySelector(".amorist-editor-surface"), "editor mount");
    const surface = document.querySelector(".amorist-editor-surface");
    const second = surface.querySelectorAll(".amorist-source-line")[1];
    if (!second) throw new Error("Expected a second projected source line.");
    caretAtEndOf(second);

    if (mode === "indent") {
      pressTab(second, false);
      await save();
      return true;
    }

    pressTab(second, true);
    await save();
    return true;
  }})(${JSON.stringify(step)})`;
}

function browserScript() {
  return `(${async function () {
    function waitFor(predicate, label) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const tick = () => {
          if (predicate()) {
            resolve();
            return;
          }
          if (Date.now() > deadline) {
            reject(new Error(`Timed out waiting for ${label}`));
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      });
    }

    await waitFor(() => document.querySelector(".amorist-editor-surface"), "editor mount");
    document.querySelector('[data-action="source"]').click();
    const source = document.querySelector(".amorist-editor-source");
    source.value = "Changed from smoke";
    source.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Changed from smoke" }));
    await waitFor(() => document.body.classList.contains("is-dirty"), "dirty state");
    document.getElementById("save-button").click();
    await waitFor(() => !document.body.classList.contains("is-dirty") && document.getElementById("status").textContent === "Saved", "save");
    document.getElementById("reload-button").click();
    await waitFor(() => (
      document.querySelector(".amorist-editor-surface").textContent.trim() === "Changed from smoke" &&
      document.getElementById("status").textContent === "Loaded"
    ), "reload");
    const surface = document.querySelector(".amorist-editor-surface");
    return {
      dirty: document.body.classList.contains("is-dirty"),
      status: document.getElementById("status").textContent,
      text: surface.textContent.trim(),
    };
  }})()`;
}

async function evaluateWithNavigationRetry(pageSocket, expression) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await pageSocket.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
    } catch (error) {
      if (!String(error.message).includes("Execution context was destroyed") || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Browser evaluation did not complete.");
}

function waitForExit(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`Process did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function terminate(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    let killTimer;
    const giveUpTimer = setTimeout(() => {
      resolve();
    }, 5000);
    proc.once("exit", () => {
      clearTimeout(killTimer);
      clearTimeout(giveUpTimer);
      resolve();
    });
    killTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    }, 2000);
    proc.kill("SIGTERM");
  });
}

async function removeTempDir(tempDir) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (error.code !== "ENOTEMPTY" && error.code !== "EBUSY" && error.code !== "EPERM") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

class WebSocketConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => {
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
  }

  static open(webSocketUrl) {
    return new Promise((resolve, reject) => {
      const url = new URL(webSocketUrl);
      const socket = net.createConnection(Number(url.port), url.hostname);
      const key = crypto.randomBytes(16).toString("base64");
      let handshake = "";
      socket.on("connect", () => {
        socket.write([
          `GET ${url.pathname}${url.search} HTTP/1.1`,
          `Host: ${url.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"));
      });
      socket.on("data", function onHandshake(chunk) {
        handshake += chunk.toString("binary");
        const end = handshake.indexOf("\r\n\r\n");
        if (end === -1) return;
        socket.off("data", onHandshake);
        const head = Buffer.from(handshake.slice(0, end), "binary").toString("utf8");
        if (!head.startsWith("HTTP/1.1 101")) {
          reject(new Error(`WebSocket handshake failed: ${head.split("\r\n")[0]}`));
          return;
        }
        const connection = new WebSocketConnection(socket);
        const rest = Buffer.from(handshake.slice(end + 4), "binary");
        if (rest.length) connection.receive(rest);
        resolve(connection);
      });
      socket.on("error", reject);
    });
  }

  send(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.socket.write(encodeFrame(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const parsed = decodeFrame(this.buffer);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.bytes);
      if (parsed.opcode === 8) return;
      if (parsed.opcode !== 1) continue;
      const message = JSON.parse(parsed.payload.toString("utf8"));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    }
  }

  close() {
    this.socket.end();
  }
}

function encodeFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = crypto.randomBytes(4);
  const header = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  return {
    opcode: first & 0x0f,
    payload: buffer.subarray(offset, offset + length),
    bytes: offset + length,
  };
}
