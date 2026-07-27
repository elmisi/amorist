"use strict";

// Family G — requirements on the checking system itself.
//
// These two are the reason the rest can be believed. Everything else in the
// suite measures the product; these measure whether the suite is capable of
// measuring anything at all.
//
// They judge the RUN, not the editor, so they execute once after the engines
// have had their turn. A sub-run started from here carries a flag that switches
// them off, so a check that spawns the runner cannot spawn itself.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RUNNER = path.resolve(__dirname, "..", "run.js");
const ROOT = path.resolve(__dirname, "..", "..", "..");

// Start the runner as a separate process, deliberately broken in one way, and
// see whether it notices. Note what is asserted: a NON-ZERO exit and a cause
// named in the output. Exit zero here would mean the gate turns green precisely
// when it has been blinded — worse than having no gate, because it manufactures
// confidence.
function runSabotaged(environment, args) {
  const result = childProcess.spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 240000,
    env: { ...process.env, ...environment, AMORIST_QA_SELFTEST: "1" },
  });
  return {
    status: result.status,
    output: `${result.stdout || ""}${result.stderr || ""}`,
    timedOut: result.error && result.error.code === "ETIMEDOUT",
  };
}

module.exports = [
  {
    id: "REQ-G1",
    scope: "run",
    title: "A check that cannot execute is a failure, never a pass",
    note: "Verified by breaking the run on purpose and requiring it to notice. A suite that has never been shown to fail has not been shown to work.",
    async run() {
      const failures = [];
      const emptyCorpus = fs.mkdtempSync(path.join(os.tmpdir(), "amorist-qa-empty-"));

      const sabotages = [
        {
          name: "the fixture directory is empty",
          environment: { AMORIST_QA_CORPUS: emptyCorpus },
          args: ["--only", "A", "--engine", "chromium"],
          expectInOutput: "contains no .md files",
        },
        {
          name: "the stand-in browser cannot be found",
          environment: { AMORIST_QA_CHROMIUM: "/nonexistent/browser" },
          args: ["--only", "A", "--engine", "chromium"],
          expectInOutput: "does not exist",
        },
        {
          name: "the shipping engine's driver cannot be found",
          environment: { AMORIST_QA_WEBKIT_DRIVER: "/nonexistent/driver" },
          args: ["--only", "A", "--engine", "webkitgtk"],
          expectInOutput: "was not found",
        },
      ];

      try {
        for (const sabotage of sabotages) {
          const result = runSabotaged(sabotage.environment, sabotage.args);
          if (result.timedOut) {
            failures.push({
              fixture: sabotage.name,
              detail: "The sabotaged run never finished, so it produced no verdict either way.",
            });
            continue;
          }
          if (result.status === 0) {
            failures.push({
              fixture: sabotage.name,
              detail: "The run reported success while it was unable to check anything. "
                + "A gate that turns green when it cannot look is worse than no gate.",
              expected: "a non-zero exit status",
              actual: `exit status ${result.status}`,
            });
            continue;
          }
          if (!result.output.includes(sabotage.expectInOutput)) {
            failures.push({
              fixture: sabotage.name,
              detail: "The run failed but did not say why, so the failure is not actionable.",
              expected: `output containing ${JSON.stringify(sabotage.expectInOutput)}`,
              actual: result.output.slice(-300),
            });
          }
        }
      } finally {
        fs.rmSync(emptyCorpus, { recursive: true, force: true });
      }

      return { failures, fixturesExercised: sabotages.map((s) => s.name) };
    },
  },

  {
    id: "REQ-G2",
    scope: "run",
    title: "The editor checks run on the engine that ships, not only on a stand-in",
    note: "A requirement that passes on one engine and fails on the other is a failure, and the report names which engine failed rather than averaging the two.",
    async run(ctx) {
      const failures = [];
      const report = ctx.report;
      const exercised = report.engines.map((engine) => engine.id);

      // Running one engine on purpose is a debugging convenience, not a
      // verdict — so the requirement is not asserted in that case, it is
      // recorded as not measured, which keeps the run red.
      if (ctx.options.engine) {
        return {
          failures: [],
          fixturesExercised: exercised,
          notCovered: [
            `this run was restricted to the ${ctx.options.engine} engine, so the `
            + "agreement between engines was not measured",
          ],
        };
      }

      if (!exercised.includes("webkitgtk")) {
        failures.push({
          fixture: "engine coverage",
          detail: "The engine the application ships with produced no verdict at all. "
            + "Everything else in this report describes a browser the user does not run.",
          expected: "a verdict from the shipping engine",
          actual: `engines exercised: ${exercised.join(", ") || "none"}`,
        });
      }

      // Divergence between engines: real information, and information the
      // report must not average away.
      const byRequirement = new Map();
      for (const result of report.results) {
        if (result.engine === "the run itself") continue;
        if (!byRequirement.has(result.requirement)) byRequirement.set(result.requirement, {});
        byRequirement.get(result.requirement)[result.engine] = result.verdict;
      }
      for (const [requirement, verdicts] of byRequirement) {
        const distinct = new Set(Object.values(verdicts));
        if (Object.keys(verdicts).length > 1 && distinct.size > 1) {
          failures.push({
            fixture: requirement,
            detail: "The engines disagree about this requirement. Either the engines "
              + "genuinely differ — which the user will meet — or the check depends on "
              + "something it should not. Both need looking at.",
            expected: "the same verdict on every engine",
            actual: JSON.stringify(verdicts),
          });
        }
      }

      return { failures, fixturesExercised: exercised };
    },
  },
];
