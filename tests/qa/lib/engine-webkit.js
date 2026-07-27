"use strict";

// The engine that ships: WebKitGTK, the same engine the Linux application runs
// inside, driven through its own WebDriver server over plain HTTP.
//
// No third-party client library is involved — the protocol is HTTP and JSON, so
// node builtins are enough. This is the requirement that keeps families B and C
// honest: caret placement and contenteditable behaviour are exactly where
// engines disagree, and a stand-in cannot speak for this one.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const keys = require("./keys");
const { terminate } = require("./engine-chromium");

const DRIVER_CANDIDATES = ["WebKitWebDriver"];
const MINIBROWSER_CANDIDATES = [
  "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser",
  "/usr/lib/aarch64-linux-gnu/webkit2gtk-4.1/MiniBrowser",
  "/usr/libexec/webkit2gtk-4.1/MiniBrowser",
];

function which(name) {
  const found = childProcess.spawnSync("which", [name], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : "";
}

function discover() {
  const override = process.env.AMORIST_QA_WEBKIT_DRIVER;
  const driver = override || DRIVER_CANDIDATES.map(which).find(Boolean) || "";
  if (!driver || !fs.existsSync(driver)) {
    return {
      available: false,
      reason:
        "The WebDriver server for the shipping engine was not found "
        + `(looked for: ${DRIVER_CANDIDATES.join(", ")}). `
        + "Install it with:  sudo apt install webkit2gtk-driver  "
        + "— or set AMORIST_QA_WEBKIT_DRIVER to its path. "
        + "This engine is not optional: REQ-G2 requires every editor check to "
        + "produce a verdict on the engine the application actually ships with.",
    };
  }
  const browser = process.env.AMORIST_QA_MINIBROWSER
    || MINIBROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate))
    || "";
  return { available: true, binary: driver, browser };
}

class WebKitEngine {
  constructor(binary, browser) {
    this.id = "webkitgtk";
    this.binary = binary;
    this.browser = browser;
    this.label = "unknown";
    this.process = null;
    this.port = 0;
    this.sessionId = "";
  }

  static discover() {
    return discover();
  }

  async start() {
    this.port = await freePort();
    const version = childProcess.spawnSync(this.binary, ["--version"], { encoding: "utf8" });
    this.label = ((version.stdout || "") + (version.stderr || "")).trim().split("\n")[0]
      || path.basename(this.binary);

    if (!process.env.DISPLAY) {
      throw new Error(
        "No display is available and the shipping engine needs one. Start a "
        + "virtual display (Xvfb) and set DISPLAY before running the suite. "
        + "The run is not degraded to a single engine: half the coverage "
        + "missing must not be reported as a pass.",
      );
    }

    this.process = childProcess.spawn(this.binary, [`--port=${this.port}`, "--host=127.0.0.1"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    this.process.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    this.process.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    this.process.on("exit", (code) => {
      if (!this.sessionId) {
        this.startupFailure = new Error(
          `${this.binary} exited with code ${code} before a session was created. ${output.slice(-400)}`,
        );
      }
    });

    await this.waitForDriver(output);

    const browserOptions = { args: ["--automation"] };
    if (this.browser) browserOptions.binary = this.browser;
    const created = await this.request("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          "webkitgtk:browserOptions": browserOptions,
        },
      },
    });
    this.sessionId = created.value.sessionId;
    const reported = created.value.capabilities || {};
    if (reported.browserVersion) {
      this.label = `WebKitGTK ${reported.browserVersion}`;
    }
    await this.request("POST", `/session/${this.sessionId}/timeouts`, {
      script: 30000,
      pageLoad: 30000,
    });
  }

  async waitForDriver(collectedOutput) {
    const deadline = Date.now() + 15000;
    for (;;) {
      if (this.startupFailure) throw this.startupFailure;
      try {
        await this.request("GET", "/status");
        return;
      } catch (error) {
        if (Date.now() > deadline) {
          throw new Error(
            `${this.binary} did not answer on port ${this.port} within 15s: ${error.message}. `
            + `Output so far: ${collectedOutput.slice(-400)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  async setViewport(width, height) {
    await this.request("POST", `/session/${this.sessionId}/window/rect`, {
      x: 0,
      y: 0,
      width,
      height,
    });
  }

  async navigate(url) {
    await this.request("POST", `/session/${this.sessionId}/url`, { url });
  }

  async evaluate(expression) {
    const script = `
      var done = arguments[arguments.length - 1];
      Promise.resolve()
        .then(function () { return (${expression}); })
        .then(
          function (value) { done({ ok: true, value: value }); },
          function (error) { done({ ok: false, error: String((error && error.stack) || error) }); }
        );
    `;
    const response = await this.request("POST", `/session/${this.sessionId}/execute/async`, {
      script,
      args: [],
    });
    const outcome = response.value;
    if (!outcome || outcome.ok !== true) {
      throw new Error(`Page threw while evaluating: ${outcome ? outcome.error : "no result"}`);
    }
    return outcome.value;
  }

  async sendKeys(sequence) {
    const actions = [];
    for (const item of keys.normalizeSequence(sequence)) {
      if (item.text !== undefined) {
        actions.push({ type: "keyDown", value: item.text });
        actions.push({ type: "keyUp", value: item.text });
        continue;
      }
      const held = [];
      for (const [name, value] of Object.entries(keys.WEBDRIVER_MODIFIERS)) {
        if (item[name]) held.push(value);
      }
      const value = keys.WEBDRIVER[item.key] || item.key;
      for (const modifier of held) actions.push({ type: "keyDown", value: modifier });
      for (let n = 0; n < item.repeat; n += 1) {
        actions.push({ type: "keyDown", value });
        actions.push({ type: "keyUp", value });
      }
      for (const modifier of held.reverse()) actions.push({ type: "keyUp", value: modifier });
    }
    if (!actions.length) return;
    await this.request("POST", `/session/${this.sessionId}/actions`, {
      actions: [{ type: "key", id: "keyboard", actions }],
    });
  }

  async close() {
    if (this.sessionId) {
      try {
        await this.request("DELETE", `/session/${this.sessionId}`);
      } catch {
        // The session may already be gone; the process kill below is the
        // authority on cleanup.
      }
    }
    if (this.process) await terminate(this.process);
  }

  request(method, endpoint, body) {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    return new Promise((resolve, reject) => {
      const req = http.request({
        method,
        hostname: "127.0.0.1",
        port: this.port,
        path: endpoint,
        headers: payload
          ? { "content-type": "application/json; charset=utf-8", "content-length": payload.length }
          : {},
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            reject(new Error(`${method} ${endpoint} returned unparseable body: ${text.slice(0, 300)}`));
            return;
          }
          if (res.statusCode >= 400) {
            const error = parsed.value || {};
            reject(new Error(`${method} ${endpoint} failed: ${error.error || res.statusCode} — ${error.message || text.slice(0, 300)}`));
            return;
          }
          resolve(parsed);
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}

function freePort() {
  const net = require("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

module.exports = { WebKitEngine };
