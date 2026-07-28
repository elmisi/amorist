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

      // The caret resting on a marker that exists only in the source. The
      // contract does not require a round trip here — there is nowhere in the
      // view for a hash to be — it requires the mapping to land on the first
      // visible character of that construct, and to do so DETERMINISTICALLY.
      // So both halves are asserted: the right character, and the same answer
      // twice.
      for (const fixture of fixtures) {
        const marked = markerLine(fixture.text);
        if (!marked) continue;

        const landings = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await ctx.page.open(fixture.text);
          await ctx.page.toggleMode();
          await ctx.page.settle(40);
          const sourceValue = await ctx.page.sourceValue();
          const at = sourceValue.indexOf(marked.line);
          if (at < 0) break;
          // On the marker itself, not on the text after it.
          await ctx.page.setSourceSelection(at + marked.markerOffset);
          await ctx.page.toggleMode();
          await ctx.page.settle(40);
          const surfaceText = await ctx.page.surfaceText();
          const offset = await ctx.page.caretTextOffset();
          landings.push({ offset, character: surfaceText[offset] });
        }

        if (landings.length !== 2) continue;

        if (landings[0].offset !== landings[1].offset) {
          failures.push({
            fixture: fixture.name,
            direction: "source marker into the view",
            detail: "The same starting position produced two different landings. "
              + "A mapping that is not deterministic cannot be relied on even when "
              + "it happens to be right.",
            expected: `the same offset twice`,
            actual: `${landings[0].offset} then ${landings[1].offset}`,
          });
          continue;
        }

        if (landings[0].character !== marked.firstVisible) {
          failures.push({
            fixture: fixture.name,
            direction: "source marker into the view",
            detail: "The caret sat on a marker that the view does not display, and "
              + "the mapping did not land on the first visible character of that "
              + "construct.",
            line: lineOf(fixture.text, fixture.text.indexOf(marked.line)),
            expected: describeCharacter(marked.firstVisible, 0),
            actual: describeCharacter(landings[0].character || "", 0),
          });
        }
      }

      return { failures, fixturesExercised: exercised };
    },
  },
];

function lineOf(text, offset) {
  return splitLines(text.slice(0, Math.max(0, offset))).length || 1;
}

// A line whose first characters exist only in the source: a heading's hashes,
// a list item's bullet. Returns where the marker sits and what the first
// character the view actually shows for that construct is.
function markerLine(text) {
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(/^(#{1,6})\s+(\S)/);
    if (heading) {
      return { line: raw, markerOffset: 0, firstVisible: heading[2] };
    }
    const item = raw.match(/^([*+-]|\d+[.)])\s+(\S)/);
    if (item) {
      return { line: raw, markerOffset: 0, firstVisible: item[2] };
    }
  }
  return null;
}
