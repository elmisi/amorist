"use strict";

// The structured result.
//
// One record per requirement per engine. A requirement that passes on one
// engine and fails on the other is a FAILURE (REQ-G2), and the report names
// which engine failed rather than averaging the two into one verdict.

const fs = require("node:fs");
const path = require("node:path");

const REPORT_DIR = path.resolve(__dirname, "..", "..", "..", ".qa", "reports");

class Report {
  constructor(startedAt) {
    this.startedAt = startedAt;
    this.engines = [];
    this.results = [];
    this.blockedEngines = [];
    this.inapplicableEngines = [];
    this.harnessErrors = [];
    this.platform = "";
    this.platformsNotCovered = [];
  }

  recordEngine(engine) {
    this.engines.push(engine);
  }

  blockEngine(id, role, reason) {
    this.blockedEngines.push({ id, role, reason });
  }

  // Declared as not belonging here, so not a failure. Recorded all the same:
  // the reader must be able to see what this run did not look at.
  skipEngine(id, role, reason) {
    this.inapplicableEngines.push({ id, role, reason });
  }

  recordResult(result) {
    this.results.push(result);
  }

  recordHarnessError(where, message) {
    this.harnessErrors.push({ where, message });
  }

  // A requirement's verdict across engines: it passes only if every engine that
  // ran it passed it.
  byRequirement() {
    const map = new Map();
    for (const result of this.results) {
      if (!map.has(result.requirement)) {
        map.set(result.requirement, {
          requirement: result.requirement,
          title: result.title,
          severity: result.severity,
          engines: {},
          failures: [],
          delegated: [],
        });
      }
      const entry = map.get(result.requirement);
      entry.engines[result.engine] = result.verdict;
      entry.failures.push(...result.failures.map((f) => ({ ...f, engine: result.engine })));
      entry.delegated.push(...(result.delegated || []));
    }
    return [...map.values()];
  }

  // Exit non-zero if and only if a blocking requirement failed, or a check
  // could not run. "Delegated" is the one verdict besides "pass" that does
  // not turn the run red: it means the contract assigns this verdict to
  // another platform's run, and the release gate — which composes a green run
  // per published platform — is where that other run is held to it. It is
  // never silent: the summary and the report both name what was delegated.
  exitCode() {
    if (this.blockedEngines.length) return 1;
    if (this.harnessErrors.length) return 1;
    const blockingFailure = this.results.some(
      (result) => result.severity === "blocking"
        && result.verdict !== "pass"
        && result.verdict !== "delegated",
    );
    return blockingFailure ? 1 : 0;
  }

  write(finishedAt) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const payload = {
      startedAt: this.startedAt,
      finishedAt,
      // REQ-G3: every report names the engines actually exercised, and names
      // what automation does not reach.
      enginesExercised: this.engines,
      enginesUnavailable: this.blockedEngines,
      enginesNotApplicableHere: this.inapplicableEngines,
      platform: this.platform,
      // A run on one platform is evidence about one platform. Naming what it
      // did not cover is REQ-G3's whole point.
      publishedPlatformsThisRunDidNotCover: this.platformsNotCovered,
      notAutomatedAnywhere: [
        {
          what: "the application's own embedding of the engine, on every platform",
          why:
            "Every run drives the engine inside a TEST host — a reference browser "
            + "on Linux, the system browser on macOS — not inside the webview the "
            + "application embeds. Same engine, different host. The engine is "
            + "covered everywhere and the embedding nowhere: window chrome, focus "
            + "handling, and whatever the embedding changes about editing.",
          manualPass: "once per release, repository owner, six-case list in REQ-G3",
        },
      ],
      harnessErrors: this.harnessErrors,
      requirements: this.byRequirement(),
      raw: this.results,
      exitCode: this.exitCode(),
    };
    const file = path.join(REPORT_DIR, "last-run.json");
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return file;
  }
}

module.exports = { Report, REPORT_DIR };
