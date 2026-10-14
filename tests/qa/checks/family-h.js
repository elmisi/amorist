"use strict";
const { runTauriAppChecks } = require("../lib/tauri-app-e2e");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = [{
  id: "REQ-H1", scope: "run", title: "New/Open preserve the original session on cancellation or failure",
  async run() {
    const app = await runTauriAppChecks();
    return { failures: app.H1,
      fixturesExercised: app.fixtures.filter((fixture) => fixture.includes("File lifecycle")),
      delegated: app.delegated ? [app.delegated] : [] };
  },
}, {
  id: "REQ-H2", scope: "run", title: "Save As and untitled Save preserve the current session until writing succeeds",
  async run() {
    const app = await runTauriAppChecks();
    return { failures: app.H2,
      fixturesExercised: app.fixtures.filter((fixture) => fixture.includes("Save As lifecycle")),
      delegated: app.delegated ? [app.delegated] : [] };
  },
}, {
  id: "REQ-H3", scope: "run", title: "Independent windows preserve the launching session",
  async run() {
    const app = await runTauriAppChecks();
    return { failures: app.H3, fixturesExercised: app.fixtures.filter((fixture) => fixture.includes("independent instances")),
      delegated: app.delegated ? [app.delegated] : [] };
  },
}, {
  id: "REQ-H4", scope: "run", title: "Finder startup requests and later events preserve document ownership",
  async run() {
    const check = spawnSync(process.execPath, ["--test", path.resolve(__dirname, "../../native-open-routing.test.js")], {encoding: "utf8", timeout: 30000});
    return { failures: check.status === 0 ? [] : [{fixture: "native event routing", detail: "Routing checks failed", actual: (check.stdout || "") + (check.stderr || "")}],
      fixturesExercised: ["native routing: queued startup, initial window, claimed document, dialog deferral, reentrant events and launch failure"],
      delegated: ["Actual Finder/Dock event timing and rendered bundle instances require macOS package acceptance."] };
  },
}];
