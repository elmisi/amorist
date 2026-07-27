"use strict";

// Families E and F — unsaved work, and the write path.
//
// These do not run in a browser. The write path is Rust and is verified in
// Rust, over real temporary files; the recovery requirements need the built
// application, started and killed, which is a layer that does not exist yet and
// is named here rather than left out.
//
// The Rust tests are executed once and their results fed into the same report
// as everything else, so that one command still produces one verdict.

const childProcess = require("node:child_process");
const path = require("node:path");

const MANIFEST = path.resolve(__dirname, "..", "..", "..", "src-tauri", "Cargo.toml");

let cached = null;

// One cargo invocation for the whole family. Parsing the human-readable output
// is not elegant, but it avoids adding a machine-readable-output dependency to
// a project whose rule is to add none.
function runRustChecks() {
  if (cached) return cached;
  const result = childProcess.spawnSync(
    "cargo",
    // NOT --quiet: quiet mode prints dots instead of test names, and the
    // parser below would then match nothing and report an empty pass. It was
    // caught by the rule that a filter selecting nothing must fail.
    ["test", "--manifest-path", MANIFEST, "qa_req_", "--", "--test-threads=1"],
    { encoding: "utf8", timeout: 900000 },
  );
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const tests = [...output.matchAll(/^test (\S+) \.\.\. (\w+)$/gm)].map((match) => ({
    name: match[1],
    verdict: match[2],
  }));
  cached = {
    ran: result.status !== null && !result.error,
    status: result.status,
    output,
    tests,
    error: result.error ? String(result.error.message) : "",
  };
  return cached;
}

// Turn "no test matched" into a failure rather than an empty pass: a filter
// that selects nothing is the silent skip REQ-G1 forbids, and it is easy to
// cause by renaming a test.
function collect(prefix, requirement) {
  const outcome = runRustChecks();
  if (!outcome.ran) {
    return [{
      fixture: "the Rust checks",
      detail: `The Rust checks could not be executed: ${outcome.error || "cargo did not run"}. `
        + "A check that cannot run is a failure, never a pass.",
    }];
  }
  // No test lines at all plus a non-zero exit means it never got as far as
  // running anything — almost always a missing build dependency. Saying "no
  // test matched the filter" there names the symptom and hides the cause.
  if (!outcome.tests.length && outcome.status !== 0) {
    return [{
      fixture: "the Rust checks",
      detail: "The Rust checks did not build, so nothing was verified about the write path.",
      actual: outcome.output.slice(-1500),
    }];
  }
  const mine = outcome.tests.filter((test) => test.name.includes(prefix));
  if (!mine.length) {
    return [{
      fixture: "the Rust checks",
      detail: `The Rust checks built and ran, but none is named for ${requirement} `
        + `(looked for names containing "${prefix}"). A filter that selects nothing `
        + "must not pass — most likely a check was renamed.",
      actual: outcome.output.slice(-600),
    }];
  }
  return mine
    .filter((test) => test.verdict !== "ok")
    .map((test) => ({
      fixture: test.name,
      detail: `The Rust check ${test.name} did not pass.`,
      actual: outcome.output.slice(-1200),
    }));
}

module.exports = [
  {
    id: "REQ-F1",
    scope: "run",
    title: "The file is written atomically; a failed write leaves the original intact",
    note: "Correct today. This check exists so it cannot quietly regress while the save path is rewritten.",
    async run() {
      return {
        failures: collect("qa_req_f1_", "REQ-F1"),
        fixturesExercised: ["a successful save", "a save into a directory that cannot be written"],
      };
    },
  },

  {
    id: "REQ-F2",
    scope: "run",
    title: "A file changed outside amorist is detected and never silently overwritten",
    note: "Modification-time comparison has known limits on filesystems with coarse timestamps; the contract records that rather than hiding it.",
    async run() {
      return {
        failures: collect("qa_req_f2_", "REQ-F2"),
        fixturesExercised: ["a file changed between opening and saving", "a forced save after the conflict"],
      };
    },
  },

  {
    id: "REQ-E1",
    scope: "run",
    title: "Work not yet saved survives an abrupt termination",
    note: "Nothing in the product writes a working copy today, so there is nothing to recover. Verifying this properly needs the built application started and killed.",
    async run() {
      return {
        failures: [],
        fixturesExercised: [],
        notCovered: [
          "typing, killing the process without a save, and recovering on the next start — "
          + "this needs the built application driven end to end, a layer the suite does not "
          + "have yet. Independently of the measurement: the product writes no working copy "
          + "anywhere, so today there is nothing that could be recovered",
        ],
      };
    },
  },

  {
    id: "REQ-E2",
    scope: "run",
    title: "The user's file is never written except on an explicit save",
    note: "Holds today. Verifying it as stated means sampling the file during a real editing session, which needs the application rather than the component.",
    async run() {
      return {
        failures: [],
        fixturesExercised: [],
        notCovered: [
          "sampling the bytes and the modification time of the user's file throughout an "
          + "editing session with no save — this needs the built application driven end to "
          + "end. The write path itself is covered by the two checks above, which are the "
          + "only place the product writes to that file at all",
        ],
      };
    },
  },
];
