"use strict";
const { runTauriAppChecks } = require("../lib/tauri-app-e2e");

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
}];
