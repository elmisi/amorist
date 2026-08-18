"use strict";

// The stand-in engine: any Chromium-family browser, over the DevTools protocol.
//
// It is not the engine that ships. It is kept because it starts fast, is easy to
// debug, and because a check that behaves differently on the two engines is
// itself a finding — either an engine difference worth knowing about, or a check
// that depends on something it should not.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { WebSocketConnection } = require("./websocket");
const keys = require("./keys");

// Tried in order. The existing smoke test looks only for a binary named
// "chromium" and exits successfully when it finds nothing, which on a machine
// carrying Google Chrome means it has never run. That is the silent skip
// REQ-G1 forbids.
const CANDIDATES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
];

// On macOS the browser is inside an application bundle and is not on the path,
// so name lookup alone finds nothing. Looking only for names would have made
// the stand-in silently unavailable on one of the two platforms.
const BUNDLE_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function discover() {
  const override = process.env.AMORIST_QA_CHROMIUM;
  if (override) {
    if (!fs.existsSync(override)) {
      return { available: false, reason: `AMORIST_QA_CHROMIUM points at ${override}, which does not exist.` };
    }
    return { available: true, binary: override };
  }
  const tried = [];
  for (const candidate of CANDIDATES) {
    const found = childProcess.spawnSync("which", [candidate], { encoding: "utf8" });
    if (found.status === 0) return { available: true, binary: found.stdout.trim() };
    tried.push(candidate);
  }
  for (const candidate of BUNDLE_CANDIDATES) {
    if (fs.existsSync(candidate)) return { available: true, binary: candidate };
    tried.push(candidate);
  }
  return {
    available: false,
    reason: `No Chromium-family browser found. Tried: ${tried.join(", ")}. `
      + "Set AMORIST_QA_CHROMIUM to a browser binary.",
  };
}

class ChromiumEngine {
  constructor(binary) {
    this.id = "chromium";
    this.binary = binary;
    this.label = "unknown";
    this.process = null;
    this.socket = null;
    this.profileDir = null;
  }

  static discover() {
    return discover();
  }

  async start() {
    const version = childProcess.spawnSync(this.binary, ["--version"], { encoding: "utf8" });
    this.label = (version.stdout || "").trim() || path.basename(this.binary);

    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-qa-chromium-"));
    const debuggingUrl = await new Promise((resolve, reject) => {
      const proc = childProcess.spawn(this.binary, [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--remote-debugging-port=0",
        `--user-data-dir=${this.profileDir}`,
        "about:blank",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      this.process = proc;

      let stderr = "";
      const timer = setTimeout(() => {
        reject(new Error(`${this.binary} did not report a DevTools endpoint within 20s.`));
      }, 20000);
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      proc.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`${this.binary} exited with code ${code} before starting. ${stderr.slice(-400)}`));
      });
    });

    const browserUrl = new URL(debuggingUrl);
    const page = JSON.parse(await httpRequest({
      method: "PUT",
      hostname: browserUrl.hostname,
      port: browserUrl.port,
      path: "/json/new?about:blank",
    }));
    this.socket = await WebSocketConnection.open(page.webSocketDebuggerUrl);
  }

  // Fixing width, height and scale explicitly rather than inheriting whatever
  // the machine happens to have. REQ-B1 measures rendered geometry, and geometry
  // inherited from the environment is geometry that differs between machines.
  async setViewport(width, height) {
    await this.socket.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  async navigate(url) {
    await this.socket.send("Page.enable", {});
    await this.socket.send("Page.navigate", { url });
    await this.evaluate(`new Promise((resolve) => {
      if (document.readyState === "complete") { resolve(true); return; }
      window.addEventListener("load", () => resolve(true), { once: true });
    })`);
  }

  async evaluate(expression) {
    const result = await this.socket.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      const text = (details.exception && details.exception.description) || details.text;
      throw new Error(`Page threw while evaluating: ${text}`);
    }
    return result.result.value;
  }

  async sendKeys(sequence) {
    for (const item of keys.normalizeSequence(sequence)) {
      if (item.text !== undefined) {
        await this.dispatchChar(item.text);
        continue;
      }
      const named = keys.CDP[item.key];
      let modifiers = 0;
      for (const [name, bit] of Object.entries(keys.CDP_MODIFIERS)) {
        if (item[name]) modifiers |= bit;
      }
      for (let n = 0; n < item.repeat; n += 1) {
        if (named) {
          await this.socket.send("Input.dispatchKeyEvent", {
            type: named.text && !modifiers ? "keyDown" : "rawKeyDown",
            key: item.key,
            code: named.code,
            windowsVirtualKeyCode: named.vk,
            nativeVirtualKeyCode: named.vk,
            text: modifiers ? undefined : named.text,
            modifiers,
          });
          await this.socket.send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: item.key,
            code: named.code,
            windowsVirtualKeyCode: named.vk,
            nativeVirtualKeyCode: named.vk,
            modifiers,
          });
        } else {
          // A printable key held with a modifier: a shortcut, not text.
          const upper = item.key.toUpperCase();
          const vk = upper.charCodeAt(0);
          await this.socket.send("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            key: item.key,
            code: `Key${upper}`,
            windowsVirtualKeyCode: vk,
            nativeVirtualKeyCode: vk,
            modifiers,
          });
          await this.socket.send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: item.key,
            code: `Key${upper}`,
            windowsVirtualKeyCode: vk,
            nativeVirtualKeyCode: vk,
            modifiers,
          });
        }
      }
    }
  }

  async dispatchChar(char) {
    // A Unicode code point is not a Windows virtual-key code: '#' is 35
    // (End) and '.' is 46 (Delete). Passing code points here made a literal
    // typing check silently press navigation/editing keys. CDP provides the
    // protocol-neutral text insertion primitive for exactly this case; named
    // and modified keys still use dispatchKeyEvent in sendKeys above.
    await this.socket.send("Input.insertText", { text: char });
  }

  async close() {
    if (this.socket) this.socket.close();
    if (this.process) await terminate(this.process);
    if (this.profileDir) {
      try {
        fs.rmSync(this.profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // The browser keeps writing into its profile as it shuts down, so the
        // directory can refuse to go even after the process is gone. A leftover
        // temporary directory is not a reason to fail a run — but swallowing
        // the error is only acceptable because nothing depends on the removal.
      }
    }
  }
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

function terminate(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 2000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}

module.exports = { ChromiumEngine, terminate, httpRequest };
