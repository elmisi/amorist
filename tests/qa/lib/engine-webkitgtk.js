"use strict";

// The engine that ships on Linux: WebKitGTK, the same engine the application
// runs inside, driven through its own WebDriver server.
//
// Everything about speaking the protocol lives in the shared client. What is
// here is only what makes this engine different from the other one that speaks
// it: how the server is started, and how a session is opened.

const childProcess = require("node:child_process");
const fs = require("node:fs");

const { WebDriverEngine } = require("./engine-webdriver");

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
        + "This engine is not optional on this platform: REQ-G2 requires every "
        + "editor check to produce a verdict on the engine the application "
        + "actually ships with.",
    };
  }
  const browser = process.env.AMORIST_QA_MINIBROWSER
    || MINIBROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate))
    || "";
  return { available: true, binary: driver, browser };
}

class WebKitGtkEngine extends WebDriverEngine {
  constructor(binary, browser) {
    super(binary);
    this.id = "webkitgtk";
    this.browser = browser;
  }

  static discover() {
    return discover();
  }

  checkPreconditions() {
    if (!process.env.DISPLAY) {
      return "No display is available and the shipping engine needs one. Start a "
        + "virtual display and set DISPLAY before running the suite. The run is "
        + "not degraded to fewer engines: part of the coverage missing must not "
        + "be reported as a pass.";
    }
    return "";
  }

  serverArguments() {
    return [`--port=${this.port}`, "--host=127.0.0.1"];
  }

  sessionCapabilities() {
    const browserOptions = { args: ["--automation"] };
    if (this.browser) browserOptions.binary = this.browser;
    return { "webkitgtk:browserOptions": browserOptions };
  }
}

module.exports = { WebKitGtkEngine };
