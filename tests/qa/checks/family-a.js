"use strict";

// Family A — the file on disk.
//
// This is the primary value. Every requirement here is a different way for the
// same promise to break: the file must not change except as the direct result
// of an edit the user made.
//
// These checks run against the editor component, not the application, and they
// compare the EXACT file text in against the EXACT file text out. That is
// deliberate and it is stronger than it looks: it means the editor must be
// transparent to line terminators rather than normalising them on the way in,
// because information normalised away at the door cannot be restored by any
// backend afterwards. REQ-A9's per-line rule is only reachable this way.

const { firstDifference, changedLines, splitLines, visible } = require("../lib/diff");
const { select } = require("../lib/fixtures");
const { findHandWrappedParagraph } = require("../lib/markdown-shape");

// Open, type one character, delete it. The neutral edit: a real edit gesture
// whose net effect on the content is nothing at all.
async function neutralEdit(page, fixture) {
  await page.open(fixture.text);
  const afterOpen = await page.markdown();

  await page.focusSurface();
  const surfaceText = await page.surfaceText();
  await page.setCaretAtTextOffset(surfaceText.length);
  await page.sendKeys(["x"]);
  await page.settle();
  await page.sendKeys([{ key: "Backspace" }]);
  await page.settle();

  return { afterOpen, afterEdit: await page.markdown() };
}

function describeDifference(fixture, produced, stage) {
  const where = firstDifference(fixture.text, produced);
  return {
    fixture: fixture.name,
    stage,
    detail: stage === "open"
      ? "The file was already altered by being opened, before any edit."
      : "The file was altered by an edit whose net effect was nothing.",
    firstDifferenceAtByte: where.byteOffset,
    line: where.line,
    column: where.column,
    expected: where.expectedLine,
    actual: where.actualLine,
    expectedTotalBytes: where.expectedBytes,
    actualTotalBytes: where.actualBytes,
  };
}

// Every byte-identity requirement is the same measurement over a different slice
// of the corpus. They stay separate so that a failure names the construct
// responsible instead of saying "some file changed".
function byteIdentity({ id, title, selector, note }) {
  return {
    id,
    title,
    note,
    async run(ctx) {
      const fixtures = select(ctx.corpus, selector);
      const failures = [];
      for (const fixture of fixtures) {
        const { afterOpen, afterEdit } = await neutralEdit(ctx.page, fixture);
        if (afterOpen !== fixture.text) {
          failures.push(describeDifference(fixture, afterOpen, "open"));
        } else if (afterEdit !== fixture.text) {
          failures.push(describeDifference(fixture, afterEdit, "edit"));
        }
      }
      return { failures, fixturesExercised: fixtures.map((f) => f.name) };
    },
  };
}

// The first prose line long enough to put a caret in the middle of. Prose only:
// a line inside a code block keeps its break by definition, so aiming at one
// would test the renderer's handling of code, not the author's line breaks.
function targetProseLine(fixture) {
  const paragraph = findHandWrappedParagraph(fixture.text);
  if (!paragraph) return null;
  const line = paragraph[Math.floor(paragraph.length / 2)];
  return { number: line.number, text: line.text };
}

module.exports = [
  byteIdentity({
    id: "REQ-A1",
    title: "Any file, one character typed and deleted, saved: byte-identical",
    selector: "any",
    note: "The whole corpus. Every other requirement in this family is a slice of this one.",
  }),

  byteIdentity({
    id: "REQ-A3",
    title: "A touched but unchanged region keeps its own line wrapping",
    selector: "hasHandWrappedParagraph",
    note: "Without this REQ-A1 would be vacuous: typing and deleting marks a region touched, and a re-emitted region loses the author's line breaks.",
  }),

  byteIdentity({
    id: "REQ-A4",
    title: "Invisible characters are preserved: trailing spaces, the final newline or its absence",
    selector: "hasTrailingWhitespaceOrNoFinalNewline",
    note: "Two trailing spaces are Markdown content, not dirt. Any tidying is by definition a change the user did not ask for.",
  }),

  byteIdentity({
    id: "REQ-A5",
    title: "Constructs the editor does not understand pass through untouched",
    selector: "hasUnsupportedConstruct",
    note: "The promise covers ANY file. With a partial codec the only way to keep it is to never let the codec near what it does not understand.",
  }),

  byteIdentity({
    id: "REQ-A6",
    title: "Table spacing is kept as found; no re-alignment on open or save",
    selector: "hasTable",
    note: "Re-alignment currently runs while the file is being READ, so open and save rewrites a hand-spaced table with no edit at all.",
  }),

  byteIdentity({
    id: "REQ-A7",
    title: "List markers and numbering are kept as the author wrote them",
    selector: "hasList",
    note: "A hardcoded marker and a progressive counter mean editing one item of a thirty-item list rewrites all thirty lines.",
  }),

  byteIdentity({
    id: "REQ-A8",
    title: "A fence keeps its information string, its character and its length",
    selector: "hasFence",
    note: "The language tag is content the author wrote.",
  }),

  byteIdentity({
    id: "REQ-A9",
    title: "Line terminators are preserved per line, with no majority computed",
    selector: "hasNonUniformTerminators",
    note: "The rule is per line, not per file: every existing line keeps its own terminator, and a line created by pressing Enter takes the terminator of the line the caret was on.",
  }),

  {
    id: "REQ-A2",
    title: "After a real edit, only the lines that edit can account for may differ",
    note: "The set of lines each gesture may change is defined in the contract, not here. A gesture the contract does not list must be added to the contract before it is tested.",
    async run(ctx) {
      const fixtures = select(ctx.corpus, "hasHandWrappedParagraph");
      const failures = [];
      const exercised = [];

      for (const fixture of fixtures) {
        const target = targetProseLine(fixture);
        if (!target) continue;
        exercised.push(fixture.name);

        // Gesture: insert one character inside a line.
        // Contract: that line only.
        await ctx.page.open(fixture.text);
        const before = await ctx.page.markdown();
        await ctx.page.focusSurface();
        const placed = await placeCaretInside(ctx.page, target.text);
        if (!placed.ok) {
          failures.push({
            fixture: fixture.name,
            gesture: "insert one character inside a line",
            detail: placed.reason,
          });
          continue;
        }
        await ctx.page.sendKeys(["X"]);
        await ctx.page.settle();
        const afterInsert = await ctx.page.markdown();
        const insertDiff = changedLines(before, afterInsert);
        const insertAllowed = new Set([target.number]);
        const insertStray = insertDiff.touchedLineNumbers.filter((n) => !insertAllowed.has(n));
        if (insertStray.length || lineCount(afterInsert) !== lineCount(before)) {
          failures.push({
            fixture: fixture.name,
            gesture: "insert one character inside a line",
            detail: "Lines changed that the gesture cannot account for.",
            editedLine: target.number,
            linesAllowedToChange: [...insertAllowed],
            linesThatChanged: insertDiff.touchedLineNumbers,
            straylines: insertStray,
            lineCountBefore: lineCount(before),
            lineCountAfter: lineCount(afterInsert),
            sampleRemoved: insertDiff.removed.slice(0, 3).map((r) => `${r.line}: ${visible(r.text)}`),
            sampleAdded: insertDiff.added.slice(0, 3).map((r) => `${r.line}: ${visible(r.text)}`),
          });
        }

        // Gesture: press Enter inside a line.
        // Contract: the line at the caret, plus one new line after it.
        await ctx.page.open(fixture.text);
        await ctx.page.focusSurface();
        await placeCaretInside(ctx.page, target.text);
        await ctx.page.sendKeys([{ key: "Enter" }]);
        await ctx.page.settle();
        const afterEnter = await ctx.page.markdown();
        const enterDelta = lineCount(afterEnter) - lineCount(before);
        const enterDiff = changedLines(before, afterEnter);
        const enterAllowed = new Set([target.number, target.number + 1]);
        const enterStray = enterDiff.touchedLineNumbers.filter((n) => !enterAllowed.has(n));
        if (enterDelta !== 1 || enterStray.length) {
          failures.push({
            fixture: fixture.name,
            gesture: "press Enter inside a line",
            detail: enterDelta !== 1
              ? `Enter changed the line count by ${enterDelta}; the contract allows exactly one new line.`
              : "Lines changed that the gesture cannot account for.",
            editedLine: target.number,
            linesAllowedToChange: [...enterAllowed],
            linesThatChanged: enterDiff.touchedLineNumbers,
            lineCountBefore: lineCount(before),
            lineCountAfter: lineCount(afterEnter),
          });
        }

        // Gesture: backspace at the start of a line.
        // Contract: the two lines, merged into one.
        if (target.number > 1) {
          await ctx.page.open(fixture.text);
          await ctx.page.focusSurface();
          const atStart = await placeCaretAtStart(ctx.page, target.text);
          if (atStart.ok) {
            await ctx.page.sendKeys([{ key: "Backspace" }]);
            await ctx.page.settle();
            const afterMerge = await ctx.page.markdown();
            const mergeDelta = lineCount(afterMerge) - lineCount(before);
            const mergeDiff = changedLines(before, afterMerge);
            const mergeAllowed = new Set([target.number - 1, target.number]);
            const mergeStray = mergeDiff.touchedLineNumbers.filter((n) => !mergeAllowed.has(n));
            if (mergeDelta !== -1 || mergeStray.length) {
              failures.push({
                fixture: fixture.name,
                gesture: "backspace across a line boundary",
                detail: mergeDelta !== -1
                  ? `The merge changed the line count by ${mergeDelta}; the contract allows exactly minus one.`
                  : "Lines changed that the gesture cannot account for.",
                editedLine: target.number,
                linesAllowedToChange: [...mergeAllowed],
                linesThatChanged: mergeDiff.touchedLineNumbers,
              });
            }
          }
        }
      }

      return {
        failures,
        fixturesExercised: exercised,
        // Declared, not hidden. The contract lists seven gestures; four are not
        // yet driven by this harness. Naming them keeps the check from reading
        // as complete coverage — silence here would be the same failure the
        // contract exists to prevent, moved into the QA system.
        notCovered: [
          "paste of N lines",
          "typing over a selection spanning several lines",
          "a toolbar action or keyboard shortcut, including indent and outdent",
          "undo and redo",
        ],
      };
    },
  },

  {
    id: "REQ-A10",
    title: "Switching views any number of times leaves the document byte-identical",
    note: "The only requirement whose failure needs no user action at all: damage accumulates on the toggle, before any save and with no signal.",
    async run(ctx) {
      const fixtures = ctx.corpus;
      const failures = [];
      for (const fixture of fixtures) {
        for (const switches of [1, 2, 10]) {
          await ctx.page.open(fixture.text);
          for (let n = 0; n < switches; n += 1) {
            await ctx.page.toggleMode();
            await ctx.page.settle(30);
          }
          // An odd number of switches leaves the source view showing; the
          // document must be identical either way.
          const produced = await ctx.page.markdown();
          if (produced !== fixture.text) {
            const where = firstDifference(fixture.text, produced);
            failures.push({
              fixture: fixture.name,
              switches,
              detail: `${switches} view switch(es) with no editing altered the document.`,
              firstDifferenceAtByte: where.byteOffset,
              line: where.line,
              column: where.column,
              expected: where.expectedLine,
              actual: where.actualLine,
            });
            break;
          }
        }
      }
      return { failures, fixturesExercised: fixtures.map((f) => f.name) };
    },
  },
];

function lineCount(text) {
  return splitLines(text).length;
}

async function placeCaretInside(page, lineText) {
  const needle = lineText.trim();
  const surfaceText = await page.surfaceText();
  const at = surfaceText.indexOf(needle);
  if (at < 0) {
    return {
      ok: false,
      reason: "The source line is not present as its own run of text in the view, "
        + "so a caret cannot be placed on it. The view is not showing the file "
        + "faithfully (see the family B requirements).",
    };
  }
  await page.setCaretAtTextOffset(at + Math.floor(needle.length / 2));
  return { ok: true };
}

async function placeCaretAtStart(page, lineText) {
  const needle = lineText.trim();
  const surfaceText = await page.surfaceText();
  const at = surfaceText.indexOf(needle);
  if (at < 0) return { ok: false };
  await page.setCaretAtTextOffset(at);
  return { ok: true };
}
