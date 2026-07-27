"use strict";

// Family B — what the editing surface shows and does.
//
// The point of these three requirements: the user must be able to SEE the
// file's line structure while editing. Preserved on disk but invisible on
// screen means every edit is made blind, and the person editing has no way to
// tell that the line they are looking at is not the line in the file.

const { changedLines, splitLines, visible } = require("../lib/diff");
const { select } = require("../lib/fixtures");
const { findHandWrappedParagraph } = require("../lib/markdown-shape");

module.exports = [
  {
    id: "REQ-B1",
    title: "Every line of the file is shown as its own line; soft breaks are not collapsed",
    note: "Measured as rendered geometry, against a viewport deliberately too wide to wrap — so a collapsed paragraph cannot imitate the line breaks it destroyed.",
    async run(ctx) {
      const fixtures = select(ctx.corpus, "hasHandWrappedParagraph");
      const failures = [];
      const exercised = [];

      for (const fixture of fixtures) {
        const paragraph = findHandWrappedParagraph(fixture.text);
        if (!paragraph) continue;
        exercised.push(fixture.name);

        // Wide enough that the whole paragraph, joined into one line, would
        // still not reach the edge. This is the false positive REQ-B1 names:
        // at a normal width a collapsed paragraph soft-wraps and produces
        // several rendered lines that look like the ones it lost.
        const joinedLength = paragraph.reduce((total, line) => total + line.text.length + 1, 0);
        await ctx.page.setHostWidth(Math.max(4000, joinedLength * 20));
        await ctx.page.open(fixture.text);
        await ctx.page.settle(50);

        const tops = [];
        for (const line of paragraph) {
          const needle = line.text.trim().slice(0, 16);
          const rect = await ctx.page.firstCharacterTop(needle);
          if (!rect.found) {
            failures.push({
              fixture: fixture.name,
              line: line.number,
              detail: `The start of source line ${line.number} is not present in the view at all.`,
              expected: visible(needle),
            });
            continue;
          }
          tops.push({ line: line.number, top: rect.top, text: needle });
        }

        for (let index = 1; index < tops.length; index += 1) {
          const previous = tops[index - 1];
          const current = tops[index];
          if (current.top <= previous.top + 1) {
            failures.push({
              fixture: fixture.name,
              line: current.line,
              detail:
                `Source lines ${previous.line} and ${current.line} are drawn on the same `
                + "rendered line. The view has collapsed a line break into a space, so the "
                + "file's line structure is invisible while editing it.",
              expected: `a vertical position greater than ${previous.top}`,
              actual: `${current.top}`,
              measuredAgainstWidthPx: Math.max(4000, joinedLength * 20),
            });
            break;
          }
        }

        await ctx.page.setHostWidth(1200);
      }

      return { failures, fixturesExercised: exercised };
    },
  },

  {
    id: "REQ-B2",
    title: "Typing lengthens the current line and never moves the other lines of the paragraph",
    note: "Reflow would put the whole paragraph in the diff and would move line breaks the author placed deliberately.",
    async run(ctx) {
      const fixtures = select(ctx.corpus, "hasHandWrappedParagraph");
      const failures = [];
      const exercised = [];
      const addition = " una aggiunta abbastanza lunga da traboccare oltre la colonna";

      for (const fixture of fixtures) {
        const paragraph = findHandWrappedParagraph(fixture.text);
        if (!paragraph) continue;
        exercised.push(fixture.name);

        // The middle line: the one with a line above and a line below to move.
        const target = paragraph[Math.floor(paragraph.length / 2)];

        await ctx.page.open(fixture.text);
        const before = await ctx.page.markdown();
        await ctx.page.focusSurface();
        const surfaceText = await ctx.page.surfaceText();
        const at = surfaceText.indexOf(target.text.trim());
        if (at < 0) {
          failures.push({
            fixture: fixture.name,
            line: target.number,
            detail: "The line to type into is not present in the view as its own text.",
          });
          continue;
        }
        await ctx.page.setCaretAtTextOffset(at + target.text.trim().length);
        await ctx.page.sendKeys([addition]);
        await ctx.page.settle(120);
        const after = await ctx.page.markdown();

        const diff = changedLines(before, after);
        const stray = diff.touchedLineNumbers.filter((n) => n !== target.number);
        if (stray.length || splitLines(after).length !== splitLines(before).length) {
          failures.push({
            fixture: fixture.name,
            line: target.number,
            detail: "Typing into one line of a hand-wrapped paragraph moved the other lines.",
            linesAllowedToChange: [target.number],
            linesThatChanged: diff.touchedLineNumbers,
            lineCountBefore: splitLines(before).length,
            lineCountAfter: splitLines(after).length,
            sampleAdded: diff.added.slice(0, 3).map((r) => `${r.line}: ${visible(r.text)}`),
          });
        }
      }

      return { failures, fixturesExercised: exercised };
    },
  },

  {
    id: "REQ-B3",
    title: "Enter inserts a bare newline: no paragraph break, no two-space hard break",
    note: "Matches how a plain text editor behaves, and avoids writing trailing spaces that other editors delete on save.",
    async run(ctx) {
      const fixtures = select(ctx.corpus, "hasHandWrappedParagraph");
      const failures = [];
      const exercised = [];

      for (const fixture of fixtures) {
        const paragraph = findHandWrappedParagraph(fixture.text);
        if (!paragraph) continue;
        exercised.push(fixture.name);
        const target = paragraph[Math.floor(paragraph.length / 2)];

        await ctx.page.open(fixture.text);
        const before = await ctx.page.markdown();
        await ctx.page.focusSurface();
        const surfaceText = await ctx.page.surfaceText();
        const needle = target.text.trim();
        const at = surfaceText.indexOf(needle);
        if (at < 0) continue;
        await ctx.page.setCaretAtTextOffset(at + Math.floor(needle.length / 2));
        await ctx.page.sendKeys([{ key: "Enter" }]);
        await ctx.page.settle(120);
        const after = await ctx.page.markdown();

        // Exactly one newline inserted, and not one other character touched.
        const strippedBefore = before.replace(/\n/g, "");
        const strippedAfter = after.replace(/\n/g, "");
        const newlineDelta = (after.match(/\n/g) || []).length - (before.match(/\n/g) || []).length;

        if (strippedBefore !== strippedAfter) {
          failures.push({
            fixture: fixture.name,
            detail: "Enter changed characters other than inserting a newline.",
            expected: `${strippedBefore.length} non-newline characters`,
            actual: `${strippedAfter.length} non-newline characters`,
          });
        } else if (newlineDelta !== 1) {
          failures.push({
            fixture: fixture.name,
            detail: `Enter inserted ${newlineDelta} newline(s); the contract allows exactly one.`,
            expected: "1",
            actual: String(newlineDelta),
          });
        }

        const gainedTrailingSpace = splitLines(after)
          .map((line) => line.replace(/\r?\n$/, ""))
          .some((line, index) => {
            const originals = splitLines(before).map((l) => l.replace(/\r?\n$/, ""));
            return /[ \t]$/.test(line) && !originals.includes(line);
          });
        if (gainedTrailingSpace) {
          failures.push({
            fixture: fixture.name,
            detail: "Enter left trailing whitespace behind — a hard break written where the user asked for a plain newline.",
          });
        }
      }

      return { failures, fixturesExercised: exercised };
    },
  },
];
