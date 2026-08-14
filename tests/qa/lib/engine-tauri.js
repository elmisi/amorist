"use strict";

// Linux Tauri application embedding, driven through the official
// tauri-driver intermediary. Unlike engine-webkitgtk.js, this starts the real
// Amorist executable: CLI parsing, Tauri invokes, timers and app-data storage
// are all inside the boundary under test.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");

const { WebDriverEngine } = require("./engine-webdriver");
const { terminate } = require("./engine-chromium");

class TauriEngine extends WebDriverEngine {
  constructor(driver, application, applicationArgs, environment) {
    super(driver);
    this.id = "tauri-webkitgtk";
    this.application = fs.realpathSync(application);
    this.applicationArgs = applicationArgs;
    this.environment = environment;
    this.nativePort = 0;
  }

  checkPreconditions() {
    if (process.platform !== "linux") return "tauri-driver application tests are supported on Linux in this suite.";
    if (!process.env.DISPLAY) return "The Tauri application test needs a display; run it under xvfb-run.";
    if (!fs.existsSync(this.application)) return `The built application is missing at ${this.application}.`;
    return "";
  }

  async start() {
    this.nativePort = await freePort();
    await super.start();
  }

  serverArguments() {
    return ["--port", String(this.port), "--native-port", String(this.nativePort)];
  }

  serverEnvironment() {
    return this.environment;
  }

  sessionCapabilities() {
    return {
      browserName: "wry",
      "tauri:options": {
        application: this.application,
        args: this.applicationArgs,
      },
    };
  }

  async crashApplication() {
    const pid = await waitForApplication(this.process.pid, this.application);
    process.kill(pid, "SIGKILL");
    await waitForExit(pid);

    // The WebDriver session belongs to the process we deliberately killed.
    // Do not turn the crash into a graceful DELETE /session during cleanup.
    this.sessionId = "";
    if (this.process) await terminate(this.process);
    this.process = null;
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

function childrenOf(pid) {
  try {
    const children = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
    return children ? children.split(/\s+/).map(Number) : [];
  } catch {
    return [];
  }
}

function descendantsOf(pid) {
  const found = [];
  const pending = childrenOf(pid);
  while (pending.length) {
    const child = pending.shift();
    found.push(child);
    pending.push(...childrenOf(child));
  }
  return found;
}

function executableOf(pid) {
  try {
    return fs.realpathSync(`/proc/${pid}/exe`);
  } catch {
    return "";
  }
}

async function waitForApplication(driverPid, application) {
  const deadline = Date.now() + 10000;
  do {
    const pid = descendantsOf(driverPid).find((candidate) => executableOf(candidate) === application);
    if (pid) return pid;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Could not identify the ${application} process below tauri-driver; refusing a broad process kill.`);
}

async function waitForExit(pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await delay(50);
  }
  throw new Error(`The deliberately killed application process ${pid} did not exit.`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function discoverDriver() {
  const override = process.env.AMORIST_QA_TAURI_DRIVER;
  if (override) return fs.existsSync(override) ? override : "";
  const found = childProcess.spawnSync("which", ["tauri-driver"], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : "";
}

module.exports = { TauriEngine, discoverDriver };
