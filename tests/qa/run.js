#!/usr/bin/env node
"use strict";

// The QA runner.
//
//   node tests/qa/run.js              everything
//   node tests/qa/run.js --only A     one family
//   node tests/qa/run.js --engine chromium
//
// Three properties this runner must keep, from .qa/architecture.md:
//
//   - It never calls a model, never opens a network connection to anything but
//     its own local static server, and reads nothing outside the repository. A
//     red result therefore always means the code is wrong — never that
//     something was unavailable. That is what makes it usable as a gate.
//   - A check that cannot execute is a failure, never a pass (REQ-G1).
//   - Every editor check runs on both engines and must pass on both (REQ-G2).

const fs = require("node:fs");
const path = require("node:path");

const { loadCorpus, CORPUS_DIR } = require("./lib/corpus");
const { resolveEngines, publishedPlatformsNotCovered, platformName } = require("./lib/engines");
const { makePage } = require("./lib/page");
const { startStaticServer } = require("./lib/server");
const { Report } = require("./lib/report");

const ROOT = path.resolve(__dirname, "..", "..");
const CONTRACT_JSON = path.join(ROOT, ".qa", "contract.json");
const HARNESS_PATH = "/tests/qa/page/harness.html";
const VIEWPORT = { width: 1400, height: 1000 };

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const report = new Report(startedAt);

  const contract = readContract(report);
  if (contract && contract.status !== "approved") {
    report.recordHarnessError(
      "contract",
      `The contract's status is "${contract.status}". The suite compiles an APPROVED contract; `
      + "running against anything else would be asserting requirements nobody agreed to.",
    );
  }

  let corpus = [];
  try {
    corpus = loadCorpus();
  } catch (error) {
    report.recordHarnessError("corpus", error.message);
  }

  const allChecks = require("./checks")
    .filter((check) => !options.only || check.id.startsWith(`REQ-${options.only}`));

  // Checks that judge the RUN rather than the editor. They execute once, after
  // the engines have had their turn, and they are skipped inside a self-test
  // sub-run so that a check which spawns the runner cannot spawn itself.
  const selfTest = process.env.AMORIST_QA_SELFTEST === "1";
  const checks = allChecks.filter((check) => check.scope !== "run");
  const runChecks = selfTest ? [] : allChecks.filter((check) => check.scope === "run");

  if (contract) {
    for (const requirement of contract.requirements) {
      if (requirement.verification !== "deterministic") continue;
      // Against every check the suite HAS, not only the ones this run will
      // execute: a requirement covered by a run-scope check is covered, and a
      // sub-run that switches those off must not report them as missing.
      if (allChecks.some((check) => check.id === requirement.id)) continue;
      if (options.only && !requirement.id.startsWith(`REQ-${options.only}`)) continue;
      report.recordHarnessError(
        "coverage",
        `${requirement.id} is a deterministic requirement of the approved contract and has no check. `
        + "A requirement with no check must be visible, not absent.",
      );
    }
  }

  report.platform = platformName();
  report.platformsNotCovered = publishedPlatformsNotCovered();

  const engines = resolveEngines(options.engine ? [options.engine] : null);
  for (const engine of engines) {
    // Declared as belonging elsewhere: skipped, recorded, not a failure.
    if (!engine.applicable) {
      report.skipEngine(engine.id, engine.role, engine.reason);
      continue;
    }
    // Belongs here and will not start: a failure that names itself.
    if (!engine.available) report.blockEngine(engine.id, engine.role, engine.reason);
  }
  const usable = engines.filter((engine) => engine.applicable && engine.available);

  if (!usable.length) {
    report.recordHarnessError("engines", "No engine could be started, so nothing was verified.");
  }

  let server = null;
  if (usable.length && corpus.length) {
    server = await startStaticServer(ROOT);
    for (const entry of usable) {
      const engine = entry.create();
      try {
        await engine.start();
        await engine.setViewport(VIEWPORT.width, VIEWPORT.height);
        await engine.navigate(`${server.origin}${HARNESS_PATH}`);
        const page = makePage(engine);
        const harnessVersion = await page.evaluate("window.__qa && window.__qa.version");
        if (harnessVersion !== 1) {
          throw new Error("The harness page did not load the editor component.");
        }
        report.recordEngine({
          id: entry.id,
          role: entry.role,
          description: entry.description,
          version: engine.label,
          // Measured, not declared: the named faces do not exist on every
          // platform, so the "pinned" font is a preference that falls through.
          // Recording what actually won keeps that visible.
          font: await page.fontFingerprint(),
        });

        for (const check of checks) {
          const started = Date.now();
          let outcome;
          try {
            outcome = await check.run({ page, corpus, engine: entry.id });
          } catch (error) {
            // A check that threw did not produce a verdict. It is a failure of
            // the run, not an absence of information.
            report.recordResult({
              requirement: check.id,
              title: check.title,
              severity: severityOf(contract, check.id),
              engine: entry.id,
              verdict: "could-not-run",
              durationMs: Date.now() - started,
              failures: [{ detail: `The check could not execute: ${error.message}` }],
              fixturesExercised: [],
              notCovered: [],
            });
            continue;
          }
          const notCovered = outcome.notCovered || [];
          report.recordResult({
            requirement: check.id,
            title: check.title,
            severity: severityOf(contract, check.id),
            engine: entry.id,
            verdict: outcome.failures.length ? "fail" : (notCovered.length ? "incomplete" : "pass"),
            durationMs: Date.now() - started,
            failures: outcome.failures,
            fixturesExercised: outcome.fixturesExercised || [],
            notCovered,
          });
        }
      } catch (error) {
        report.recordHarnessError(entry.id, error.message);
      } finally {
        await engine.close().catch(() => {});
      }
    }
    await server.stop();
  }

  for (const check of runChecks) {
    const started = Date.now();
    try {
      const outcome = await check.run({ report, corpus, contract, options });
      const notCovered = outcome.notCovered || [];
      report.recordResult({
        requirement: check.id,
        title: check.title,
        severity: severityOf(contract, check.id),
        engine: "the run itself",
        // Same rule as the per-engine path: something declared as not
        // exercised is not a pass. The two paths had drifted, and the drift
        // showed up as two requirements reporting green having measured
        // nothing at all.
        verdict: outcome.failures.length ? "fail" : (notCovered.length ? "incomplete" : "pass"),
        durationMs: Date.now() - started,
        failures: outcome.failures,
        fixturesExercised: outcome.fixturesExercised || [],
        notCovered,
      });
    } catch (error) {
      report.recordHarnessError(check.id, `The check could not execute: ${error.message}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const file = report.write(finishedAt);
  printSummary(report, corpus, file);
  process.exit(report.exitCode());
}

function severityOf(contract, id) {
  if (!contract) return "blocking";
  const found = contract.requirements.find((requirement) => requirement.id === id);
  return found ? found.severity : "blocking";
}

function readContract(report) {
  try {
    return JSON.parse(fs.readFileSync(CONTRACT_JSON, "utf8"));
  } catch (error) {
    report.recordHarnessError(
      "contract",
      `${CONTRACT_JSON} could not be read (${error.message}). Regenerate it with `
      + "python3 .qa/tools/render-eval-matrix.py — without it the runner cannot tell "
      + "which requirements exist, and a missing check would go unnoticed.",
    );
    return null;
  }
}

function parseArguments(argv) {
  const options = { only: "", engine: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--only") options.only = argv[index + 1] || "";
    if (argv[index] === "--engine") options.engine = argv[index + 1] || "";
  }
  return options;
}

function printSummary(report, corpus, file) {
  const line = (text = "") => process.stdout.write(text + "\n");

  line();
  line("amorist QA — contract-driven run");
  line("=".repeat(72));

  line(`platform: ${report.platform}`);
  line(`fixtures: ${corpus.length} file(s) from ${path.relative(ROOT, CORPUS_DIR)}`);
  for (const engine of report.engines) {
    line(`engine:   ${engine.id} (${engine.role}) — ${engine.version}`);
    if (engine.font) {
      line(`          font ${engine.font.sizePx} ${engine.font.stack}`);
      line(`               20 glyphs measure ${engine.font.referenceWidthPx}px`);
    }
  }
  for (const blocked of report.blockedEngines) {
    line(`ENGINE UNAVAILABLE: ${blocked.id} (${blocked.role})`);
    line(`  ${blocked.reason}`);
  }
  for (const skipped of report.inapplicableEngines) {
    line(`not applicable here: ${skipped.id} (${skipped.role}) — ${skipped.reason}`);
  }
  if (report.platformsNotCovered.length) {
    line(`this run says NOTHING about: ${report.platformsNotCovered.join(", ")}`);
  }
  line();

  const requirements = report.byRequirement();
  if (requirements.length) {
    const width = Math.max(...requirements.map((r) => r.requirement.length));
    for (const requirement of requirements) {
      const verdicts = Object.entries(requirement.engines)
        .map(([id, verdict]) => `${id}:${verdict}`)
        .join("  ");
      const mark = Object.values(requirement.engines).every((v) => v === "pass") ? "PASS" : "FAIL";
      line(`${mark}  ${requirement.requirement.padEnd(width)}  ${verdicts}`);
      if (mark === "PASS") continue;
      const shown = requirement.failures.slice(0, 2);
      for (const failure of shown) {
        const parts = [];
        if (failure.line !== undefined) parts.push(`line ${failure.line}`);
        if (failure.firstDifferenceAtByte !== undefined) parts.push(`byte ${failure.firstDifferenceAtByte}`);
        if (failure.gesture) parts.push(failure.gesture);
        if (failure.direction) parts.push(failure.direction);
        const where = parts.length ? ` ${parts.join(", ")}` : "";
        line(`      ${failure.engine} ${failure.fixture || ""}${where}`);
        line(`        ${failure.detail || ""}`);
        // Independently: a failure that has only an observed value still has
        // to show it. Requiring both fields hid the cause of a real CI failure
        // behind a message that named the symptom and nothing else.
        if (failure.expected !== undefined) line(`        expected ${failure.expected}`);
        if (failure.actual !== undefined) {
          for (const text of String(failure.actual).split("\n").slice(-12)) {
            line(`        actual   ${text}`);
          }
        }
      }
      if (requirement.failures.length > shown.length) {
        line(`      … and ${requirement.failures.length - shown.length} more, in the report file`);
      }
      const notCovered = report.results
        .filter((r) => r.requirement === requirement.requirement)
        .flatMap((r) => r.notCovered);
      for (const gap of [...new Set(notCovered)]) {
        line(`      NOT EXERCISED: ${gap}`);
      }
    }
  }

  if (report.harnessErrors.length) {
    line();
    line("The run itself could not do what it claims to do:");
    for (const error of report.harnessErrors) {
      line(`  [${error.where}] ${error.message}`);
    }
  }

  line();
  line(`report: ${path.relative(ROOT, file)}`);
  const code = report.exitCode();
  line(code === 0 ? "result: green" : "result: RED");
  line();
}

main().catch((error) => {
  process.stderr.write(`The runner failed before it could report: ${error.stack}\n`);
  process.exit(1);
});
