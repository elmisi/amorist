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
const keys = require("./keys");

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

  async sendKeys(sequence) {
    // Recent Safari Actions consumes Command chords before the letter reaches
    // the editable element. Element Send Keys targets that same focused element
    // through the standard WebDriver endpoint, retaining trusted native events.
    for (const item of keys.normalizeSequence(sequence)) {
      if (!item.meta) {
        await super.sendKeys([item.text === undefined ? item : item.text]);
        continue;
      }
      const active = await this.request("GET", `/session/${this.sessionId}/element/active`);
      const id = active.value["element-6066-11e4-a52e-4f735466cecf"];
      if (!id) throw new Error("Safari did not identify the focused element");
      const modifiers = Object.entries(keys.WEBDRIVER_MODIFIERS)
        .filter(([name]) => item[name]).map(([, value]) => value).join("");
      const text = modifiers + (keys.WEBDRIVER[item.key] || item.key).repeat(item.repeat) + "\uE000";
      await this.request("POST", `/session/${this.sessionId}/element/${id}/value`, {text, value:Array.from(text)});
    }
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
          + "engine could not be driven.\n"
          + "  Try first:  sudo safaridriver --enable\n"
          + "  On some configurations that is enough on its own. Where it is "
          + "not, the browser also carries a separate switch for remote "
          + "automation, kept with the web-developer settings — which are "
          + "themselves hidden until turned on.\n"
          + "  The name and location of that switch move between system "
          + "versions, and the system says where it is. Read this before "
          + "following anything above:\n"
          + `    ${error.message}`,
        );
      }
      throw error;
    }
  }
}

module.exports = { SafariEngine };
