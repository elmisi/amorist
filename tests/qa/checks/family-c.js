"use strict";

// Family C — the caret across the view switch.
//
// Losing your place on every switch discourages using the source view, and the
// source view is exactly the one that would reveal a damaged document. This
// requirement protects the user's ability to check the other requirements.

const { splitLines } = require("../lib/diff");

// Where to probe. Fractions rather than fixed offsets, so the positions scale
// with the fixture instead of clustering at the top of long files.
const PROBES = [0, 0.15, 0.4, 0.62, 0.85];

function describeCharacter(text, index) {
  if (index < 0 || index >= text.length) return `<past the end, length ${text.length}>`;
  return JSON.stringify(text[index]);
}

module.exports = [
  {
    id: "REQ-C1",
    title: "Switching views leaves the caret on the same character, in both directions",
    note: "Column numbers may differ where the file contains markers the view does not display; the CHARACTER may not.",
    async run(ctx) {
      // Files with structure worth landing on: headings, lists, tables, prose.
      const fixtures = ctx.corpus.filter((fixture) => fixture.text.length > 80);
      const failures = [];
      const exercised = [];

      for (const fixture of fixtures) {
        exercised.push(fixture.name);

        for (const fraction of PROBES) {
          await ctx.page.open(fixture.text);
          await ctx.page.focusSurface();
          const surfaceText = await ctx.page.surfaceText();
          if (!surfaceText.length) break;

          const offset = Math.min(
            surfaceText.length - 1,
            Math.floor(surfaceText.length * fraction),
          );
          await ctx.page.setCaretAtTextOffset(offset);
          const placedAt = await ctx.page.caretTextOffset();
          const expectedCharacter = surfaceText[placedAt];

          // Forward: view -> source.
          await ctx.page.toggleMode();
          await ctx.page.settle(40);
          const mode = await ctx.page.mode();
          if (mode !== "source") {
            failures.push({
              fixture: fixture.name,
              detail: "The toggle did not reach the source view, so the caret could not be compared.",
            });
            break;
          }
          const sourceValue = await ctx.page.sourceValue();
          const sourceSelection = await ctx.page.sourceSelection();
          const landedCharacter = sourceValue[sourceSelection.start];

          if (landedCharacter !== expectedCharacter) {
            failures.push({
              fixture: fixture.name,
              direction: "view to source",
              detail:
                "The caret moved to a different character when the view changed. "
                + "The user loses their place every time they check the markup.",
              caretOffsetInView: placedAt,
              caretOffsetInSource: sourceSelection.start,
              line: lineOf(sourceValue, sourceSelection.start),
              expected: describeCharacter(surfaceText, placedAt),
              actual: describeCharacter(sourceValue, sourceSelection.start),
            });
            continue;
          }

          // Backward: source -> view.
          await ctx.page.toggleMode();
          await ctx.page.settle(40);
          const backText = await ctx.page.surfaceText();
          const backOffset = await ctx.page.caretTextOffset();
          if (backText[backOffset] !== expectedCharacter) {
            failures.push({
              fixture: fixture.name,
              direction: "source to view",
              detail: "The caret did not come back to the character it left from.",
              caretOffsetInSource: sourceSelection.start,
              caretOffsetInView: backOffset,
              expected: describeCharacter(surfaceText, placedAt),
              actual: describeCharacter(backText, backOffset),
            });
          }
        }
      }

      return {
        failures,
        fixturesExercised: exercised,
        notCovered: [
          "the caret resting on a marker that exists only in the source (a heading's "
          + "hash, a list's asterisk), which the contract says must map into the view "
          + "deterministically onto the first visible character of that construct",
        ],
      };
    },
  },
];

function lineOf(text, offset) {
  return splitLines(text.slice(0, Math.max(0, offset))).length || 1;
}
