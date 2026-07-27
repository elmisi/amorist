"use strict";

// Family D — paste.
//
// The promise here is deliberately narrow. Conversion quality is NOT promised:
// full-fidelity conversion of arbitrary rich text is an unbounded commitment.
// What is promised is that nothing recognisable disappears without a trace.
//
// Each fixture declares, in its own file, the tokens that must survive. That
// makes the check deterministic — its weakness is coverage, not evaluability.
// A model may be used OUTSIDE this gate to discover cases nobody anticipated;
// anything it finds becomes another fixture here, and the gate keeps asserting
// fixed tokens. The verdict is never a model's.

const fs = require("node:fs");
const path = require("node:path");

const PASTE_DIR = path.resolve(__dirname, "..", "paste");

function loadPasteFixtures() {
  let names;
  try {
    names = fs.readdirSync(PASTE_DIR);
  } catch (error) {
    throw new Error(`The paste fixture directory ${PASTE_DIR} cannot be read: ${error.message}`);
  }
  const fixtures = names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ file: name, ...JSON.parse(fs.readFileSync(path.join(PASTE_DIR, name), "utf8")) }));
  if (!fixtures.length) {
    throw new Error(
      `${PASTE_DIR} contains no paste fixtures. A check with nothing to paste must not pass (REQ-G1).`,
    );
  }
  return fixtures;
}

module.exports = [
  {
    id: "REQ-D1",
    title: "Pasted content never disappears silently",
    note: "Per fixture, a declared list of tokens that must reach the file. What cannot be converted must still arrive in a readable form.",
    async run(ctx) {
      const fixtures = loadPasteFixtures();
      const failures = [];

      for (const fixture of fixtures) {
        await ctx.page.open("");
        await ctx.page.focusSurface();
        await ctx.page.paste(fixture.html, fixture.text);
        await ctx.page.settle(150);
        const produced = await ctx.page.markdown();

        const missing = fixture.mustSurvive.filter((token) => !produced.includes(token));
        if (missing.length) {
          failures.push({
            fixture: fixture.file,
            detail: `${missing.length} of ${fixture.mustSurvive.length} declared tokens did not reach the file. `
              + fixture.why,
            expected: JSON.stringify(missing),
            actual: JSON.stringify(produced.slice(0, 200)),
            producedBytes: Buffer.byteLength(produced, "utf8"),
          });
        }

        for (const group of fixture.mustBeOnSeparateLines || []) {
          const lines = produced.split(/\r?\n/);
          const found = group.map((token) => lines.findIndex((line) => line.includes(token)));
          const present = found.filter((index) => index >= 0);
          const distinct = new Set(present);
          if (present.length === group.length && distinct.size !== group.length) {
            failures.push({
              fixture: fixture.file,
              detail: "Values that belong on separate lines were concatenated onto one.",
              expected: `${group.length} distinct lines for ${JSON.stringify(group)}`,
              actual: `${distinct.size} distinct line(s)`,
            });
          }
        }
      }

      return { failures, fixturesExercised: fixtures.map((f) => f.file) };
    },
  },
];
