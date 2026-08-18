// A verdict the contract assigns to another platform's run is DELEGATED, not
// missing: the macOS run must say so out loud and still exit green, because
// release readiness is composed across platforms by the gate, not claimed by
// one run. This file pins that three-way distinction — pass / delegated /
// everything else — at the level where it is decided.

const assert = require("node:assert/strict");

// The platform check sits at the top of runOnce(); faking darwin before the
// first require is enough to walk the exact branch CI's macOS runner takes.
Object.defineProperty(process, "platform", { value: "darwin" });

const { runTauriAppChecks } = require("./qa/lib/tauri-app-e2e");
const { Report } = require("./qa/lib/report");

(async () => {
  const app = await runTauriAppChecks();
  assert.ok(app.delegated, "on a non-Linux platform the app-level checks declare delegation");
  assert.match(app.delegated, /linux/i, "the delegation names the platform that supplies the verdict");
  assert.equal(app.unsupported, undefined, "the old silent-gap marker is gone");
  for (const family of ["B4", "B6", "B7", "C2", "E1", "E2"]) {
    assert.deepEqual(app[family], [], `no failures are invented for ${family} on the delegating platform`);
  }

  // The run-level checks must route the marker into outcome.delegated, with
  // notCovered left empty — notCovered is for gaps, and gaps stay red.
  const familyB = require("./qa/checks/family-b");
  const familyC = require("./qa/checks/family-c");
  for (const [checks, id] of [[familyB, "REQ-B4"], [familyB, "REQ-B6"], [familyB, "REQ-B7"], [familyC, "REQ-C2"]]) {
    const check = checks.find((candidate) => candidate.id === id && candidate.scope === "run");
    assert.ok(check, `${id} has a run-level check`);
    const outcome = await check.run({});
    assert.deepEqual(outcome.failures, [], `${id} reports no failures when delegating`);
    assert.deepEqual(outcome.notCovered || [], [], `${id} does not report delegation as a coverage gap`);
    assert.equal((outcome.delegated || []).length, 1, `${id} names its delegation exactly once`);
  }

  // The exit code is where "visible but not red" is enforced.
  const base = {
    requirement: "REQ-E1",
    title: "t",
    severity: "blocking",
    engine: "the run itself",
    durationMs: 0,
    failures: [],
    fixturesExercised: [],
    notCovered: [],
    delegated: [],
  };

  const delegatedRun = new Report("now");
  delegatedRun.recordResult({ ...base, verdict: "delegated", delegated: ["linux supplies this verdict"] });
  assert.equal(delegatedRun.exitCode(), 0, "a delegated blocking verdict does not fail the run");

  const incompleteRun = new Report("now");
  incompleteRun.recordResult({ ...base, verdict: "incomplete", notCovered: ["a real gap"] });
  assert.equal(incompleteRun.exitCode(), 1, "a genuine coverage gap still fails the run");

  const failedRun = new Report("now");
  failedRun.recordResult({ ...base, verdict: "fail", failures: [{ detail: "broken" }] });
  assert.equal(failedRun.exitCode(), 1, "a failure still fails the run");

  // The requirement rollup carries the delegation so the summary can print it.
  const entry = delegatedRun.byRequirement().find((r) => r.requirement === "REQ-E1");
  assert.deepEqual(entry.delegated, ["linux supplies this verdict"], "delegations survive into the per-requirement view");

  console.log("qa-platform-delegation: all assertions passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
