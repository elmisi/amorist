"use strict";

// The shared WebDriver client.
//
// Both shipping engines — WebKitGTK on Linux, Safari on macOS — speak the same
// standard protocol over plain HTTP, so the second platform reused this client
// rather than adding one. Everything that differs between them is confined to
// starting the server and opening a session; a subclass supplies those two and
// inherits the rest.
//
// That is also the argument for preferring a standard protocol over a vendor
// one wherever both exist: the cost of the second platform was a subclass.

const childProcess = require("node:child_process");
const http = require("node:http");
const net = require("node:net");

const keys = require("./keys");
const { terminate } = require("./engine-chromium");

class WebDriverEngine {
  constructor(binary) {
    this.binary = binary;
    this.label = "unknown";
    this.process = null;
    this.port = 0;
    this.sessionId = "";
    this.startupFailure = null;
    this.output = "";
  }

  // --- supplied by the subclass -------------------------------------------

  // The arguments that make the server listen on this.port.
  serverArguments() {
    throw new Error("serverArguments() must be implemented.");
  }

  // The capabilities that open a session against the right browser.
  sessionCapabilities() {
    throw new Error("sessionCapabilities() must be implemented.");
  }

  // Anything that must hold before the server is started. Return a string to
  // fail the run with that cause named; return nothing to proceed.
  checkPreconditions() {
    return "";
  }

  // --- the shared part ----------------------------------------------------

  async start() {
    const problem = this.checkPreconditions();
    if (problem) throw new Error(problem);

    this.port = await freePort();
    const version = childProcess.spawnSync(this.binary, ["--version"], { encoding: "utf8" });
    this.label = ((version.stdout || "") + (version.stderr || "")).trim().split("\n")[0]
      || this.binary;

    this.process = childProcess.spawn(this.binary, this.serverArguments(), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk) => { this.output += chunk.toString("utf8"); };
    this.process.stdout.on("data", collect);
    this.process.stderr.on("data", collect);
    this.process.on("exit", (code) => {
      if (!this.sessionId) {
        this.startupFailure = new Error(
          `${this.binary} exited with code ${code} before a session was created. `
          + `${this.output.slice(-400)}`,
        );
      }
    });

    await this.waitForDriver();

    const created = await this.request("POST", "/session", {
      capabilities: { alwaysMatch: this.sessionCapabilities() },
    });
    this.sessionId = created.value.sessionId;
    const reported = created.value.capabilities || {};
    if (reported.browserVersion) {
      this.label = `${reported.browserName || this.id} ${reported.browserVersion}`;
    }
    await this.request("POST", `/session/${this.sessionId}/timeouts`, {
      script: 30000,
      pageLoad: 30000,
    });
  }

  async waitForDriver() {
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
            + `Output so far: ${this.output.slice(-400)}`,
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
            reject(new Error(
              `${method} ${endpoint} failed: ${error.error || res.statusCode} — `
              + `${error.message || text.slice(0, 300)}`,
            ));
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
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

module.exports = { WebDriverEngine };
