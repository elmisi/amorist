"use strict";

// The engine that ships on macOS — very nearly.
//
// What this drives is Safari, through the WebDriver server macOS already
// carries. What the application actually embeds is WKWebView. They are the same
// engine differently embedded, so this covers the engine and NOT the embedding:
// window chrome, focus handling, and whatever the embedding changes about
// editing behaviour stay outside automated reach (REQ-G3).
//
// That distinction has to stay visible. Calling this "the macOS engine" without
// qualification would be the failure this whole apparatus exists to prevent —
// claiming coverage instead of having it.

const childProcess = require("node:child_process");
const fs = require("node:fs");

const { WebDriverEngine } = require("./engine-webdriver");

const DRIVER_PATH = "/usr/bin/safaridriver";

function discover() {
  const driver = process.env.AMORIST_QA_SAFARIDRIVER || DRIVER_PATH;
  if (!fs.existsSync(driver)) {
    return {
      available: false,
      reason:
        `The macOS WebDriver server was not found at ${driver}. It ships with the `
        + "system; set AMORIST_QA_SAFARIDRIVER if it lives elsewhere.",
    };
  }
  return { available: true, binary: driver };
}

class SafariEngine extends WebDriverEngine {
  constructor(binary) {
    super(binary);
    this.id = "safari";
  }

  static discover() {
    return discover();
  }

  checkPreconditions() {
    // Automation is disabled until an administrator turns it on, once per
    // machine. Saying so plainly here is worth more than the error the server
    // returns, which does not mention the command that fixes it.
    const probe = childProcess.spawnSync(this.binary, ["--help"], { encoding: "utf8" });
    const text = `${probe.stdout || ""}${probe.stderr || ""}`;
    if (probe.error) {
      return `${this.binary} could not be executed: ${probe.error.message}`;
    }
    if (/enable/i.test(text) === false && probe.status !== 0) {
      return `${this.binary} did not respond as expected: ${text.slice(0, 200)}`;
    }
    return "";
  }

  serverArguments() {
    return ["-p", String(this.port)];
  }

  sessionCapabilities() {
    return { browserName: "safari" };
  }

  // The server refuses a session until automation has been enabled by an
  // administrator. Turn that into the instruction rather than the symptom.
  async start() {
    try {
      await super.start();
    } catch (error) {
      if (/not (allowed|enabled)|remote automation/i.test(error.message)) {
        throw new Error(
          "Remote automation is turned off on this machine, so the shipping "
          + "engine could not be driven. It takes two steps, once per machine:\n"
          + "    1. sudo safaridriver --enable\n"
          + "    2. tick 'Allow remote automation' in Safari's settings, under\n"
          + "       the Developer section — the setting is separate from the\n"
          + "       command above and neither works without the other.\n"
          + "The exact wording and location of the setting move between system "
          + "versions, so trust the message below over this text:\n"
          + `    ${error.message}`,
        );
      }
      throw error;
    }
  }
}

module.exports = { SafariEngine };
