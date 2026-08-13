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
const { findHandWrappedParagraph, classifyLines } = require("../lib/markdown-shape");
const contract = require("../../../.qa/contract.json");

const A2_GESTURE = Object.freeze({
  "insert one character inside a line": "insert",
  "press Enter inside a line": "enter",
  "backspace across a line boundary": "backspace",
  "paste of 3 lines": "paste",
  "type over a selection spanning 3 lines": "selection-replace",
  "apply bold from the toolbar to one word": "format",
  "wrap 3 selected lines in a code block": "codeblock",
  "indent one list item with Tab": "indent",
  "undo and redo": "undo-redo",
});

function declaredGesture(name) {
  const id = A2_GESTURE[name];
  const req = contract.requirements.find((item) => item.id === "REQ-A2");
  const gestures = req && req.allowedChange && req.allowedChange.gestures;
  return id && Array.isArray(gestures) && gestures.some((item) => item.id === id) ? id : "";
}

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
      const failures = [];
      const exercised = new Set();

      // ---- the six gestures that act on prose -----------------------------

      for (const fixture of select(ctx.corpus, "hasHandWrappedParagraph")) {
        const paragraph = findHandWrappedParagraph(fixture.text);
        if (!paragraph) continue;
        const target = targetProseLine(fixture);
        if (!target) continue;
        exercised.add(fixture.name);

        const check = (outcome) => { if (outcome) failures.push({ fixture: fixture.name, ...outcome }); };

        // Insert one character inside a line -> that line only.
        check(await gesture(ctx, fixture, "insert one character inside a line", {
          allowed: [target.number],
          delta: 0,
          act: async (page) => {
            if (!(await placeCaretInside(page, target.text)).ok) return CARET_NOT_PLACEABLE;
            await page.sendKeys(["X"]);
            return null;
          },
        }));

        // Enter -> the line at the caret, plus one new line after it.
        check(await gesture(ctx, fixture, "press Enter inside a line", {
          allowed: [target.number, target.number + 1],
          delta: 1,
          act: async (page) => {
            if (!(await placeCaretInside(page, target.text)).ok) return CARET_NOT_PLACEABLE;
            await page.sendKeys([{ key: "Enter" }]);
            return null;
          },
        }));

        // Backspace across a boundary -> the two lines, merged into one.
        if (target.number > 1) {
          check(await gesture(ctx, fixture, "backspace across a line boundary", {
            allowed: [target.number - 1, target.number],
            delta: -1,
            act: async (page) => {
              if (!(await placeCaretAtStart(page, target.text)).ok) return CARET_NOT_PLACEABLE;
              await page.sendKeys([{ key: "Backspace" }]);
              return null;
            },
          }));
        }

        // Paste of N lines -> the caret line plus N-1 new lines.
        const pasted = ["riga incollata uno", "riga incollata due", "riga incollata tre"];
        check(await gesture(ctx, fixture, `paste of ${pasted.length} lines`, {
          allowed: range(target.number, target.number + pasted.length - 1),
          delta: pasted.length - 1,
          act: async (page) => {
            if (!(await placeCaretInside(page, target.text)).ok) return CARET_NOT_PLACEABLE;
            await page.paste("", pasted.join("\n"));
            await page.settle(150);
            return null;
          },
        }));

        // Typing over a selection spanning N lines -> those N lines collapsed
        // into one, plus whatever the typed text itself introduces (nothing
        // here: the replacement carries no line break).
        const span = paragraph.slice(0, 3);
        if (span.length === 3) {
          check(await gesture(ctx, fixture, "type over a selection spanning 3 lines", {
            allowed: range(span[0].number, span[2].number),
            delta: -(span.length - 1),
            act: async (page) => {
              const surface = await page.surfaceText();
              const first = surface.indexOf(span[0].text.trim());
              const lastText = span[2].text.trim();
              const last = surface.indexOf(lastText);
              if (first < 0 || last < 0) return SELECTION_NOT_PLACEABLE;
              const ok = await page.selectTextRange(first, last + lastText.length);
              if (!ok) return SELECTION_NOT_PLACEABLE;
              await page.sendKeys(["sostituito"]);
              return null;
            },
          }));

          // A code-block command is deliberately not `format`: the user asks
          // it to insert one fence on each side of the selected source lines.
          // Its envelope includes precisely those selected lines and the two
          // new fence lines, never neighbouring prose.
          check(await gesture(ctx, fixture, "wrap 3 selected lines in a code block", {
            allowed: range(span[0].number, span[2].number + 2),
            delta: 2,
            act: async (page) => {
              const surface = await page.surfaceText();
              const firstText = span[0].text.trim();
              const lastText = span[2].text.trim();
              const first = surface.indexOf(firstText);
              const last = surface.indexOf(lastText, first);
              if (first < 0 || last < 0) return SELECTION_NOT_PLACEABLE;
              if (!(await page.selectTextRange(first, last + lastText.length))) return SELECTION_NOT_PLACEABLE;
              if (!(await page.toolbarAction("codeblock"))) return "The toolbar has no code-block command.";
              await page.settle(120);
              return null;
            },
          }));
        }

        // A toolbar command -> only the lines the affected construct occupies.
        check(await gesture(ctx, fixture, "apply bold from the toolbar to one word", {
          allowed: [target.number],
          delta: 0,
          act: async (page) => {
            const surface = await page.surfaceText();
            const needle = target.text.trim();
            const at = surface.indexOf(needle);
            if (at < 0) return SELECTION_NOT_PLACEABLE;
            const word = needle.split(/\s+/).find((w) => w.length > 3) || needle.slice(0, 4);
            const wordAt = surface.indexOf(word, at);
            if (wordAt < 0) return SELECTION_NOT_PLACEABLE;
            if (!(await page.selectTextRange(wordAt, wordAt + word.length))) return SELECTION_NOT_PLACEABLE;
            if (!(await page.toolbarAction("bold"))) return "The toolbar has no bold command.";
            await page.settle(120);
            return null;
          },
        }));

        // Undo -> exactly the lines the reverted edit had touched, and no
        // others. Asserted at its strongest: the document must come back
        // identical, so the set of lines differing from the original is empty.
        check(await undoRedo(ctx, fixture, target));
      }

      // ---- the gesture the contract names explicitly ----------------------
      // Indenting one list item changes that item's line alone, not the rest
      // of the list. This is the case a progressive counter breaks.

      for (const fixture of select(ctx.corpus, "hasList")) {
        const item = indentableListItem(fixture);
        if (!item) continue;
        exercised.add(fixture.name);
        const outcome = await gesture(ctx, fixture, "indent one list item with Tab", {
          allowed: [item.number],
          delta: 0,
          act: async (page) => {
            if (!(await placeCaretInside(page, item.visible)).ok) return CARET_NOT_PLACEABLE;
            await page.sendKeys([{ key: "Tab" }]);
            await page.settle(120);
            return null;
          },
        });
        if (outcome) failures.push({ fixture: fixture.name, ...outcome });
      }

      return { failures, fixturesExercised: [...exercised].sort() };
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

function range(from, to) {
  const out = [];
  for (let n = from; n <= to; n += 1) out.push(n);
  return out;
}

const CARET_NOT_PLACEABLE =
  "The line is not present as its own run of text in the view, so a caret "
  + "cannot be placed on it. The view is not showing the file faithfully "
  + "(see the family B requirements).";
const SELECTION_NOT_PLACEABLE =
  "The text to select is not present in the view as its own run, so the "
  + "selection could not be made.";

// One gesture, from a fresh open, judged against what the contract allows it
// to change. Returns a failure object or null.
async function gesture(ctx, fixture, name, { allowed, delta, act }) {
  if (!declaredGesture(name)) {
    return { gesture: name, detail: "This gesture is not declared by REQ-A2's projected allowed_change." };
  }
  await ctx.page.open(fixture.text);
  const before = await ctx.page.markdown();
  await ctx.page.focusSurface();

  const problem = await act(ctx.page);
  if (problem) return { gesture: name, detail: problem };
  await ctx.page.settle();
  const after = await ctx.page.markdown();

  const diff = changedLines(before, after);
  const permitted = new Set(allowed);
  const stray = diff.touchedLineNumbers.filter((n) => !permitted.has(n));
  const actualDelta = lineCount(after) - lineCount(before);

  if (!stray.length && actualDelta === delta) return null;
  return {
    gesture: name,
    detail: actualDelta !== delta
      ? `The gesture changed the line count by ${actualDelta}; the contract allows ${delta}.`
      : "Lines changed that the gesture cannot account for.",
    linesAllowedToChange: allowed,
    linesThatChanged: diff.touchedLineNumbers,
    strayLines: stray,
    lineCountBefore: lineCount(before),
    lineCountAfter: lineCount(after),
    sampleRemoved: diff.removed.slice(0, 3).map((r) => `${r.line}: ${visible(r.text)}`),
    sampleAdded: diff.added.slice(0, 3).map((r) => `${r.line}: ${visible(r.text)}`),
  };
}

// Undo and redo are judged against the whole document rather than a line set:
// an undo that leaves ANY line different from the original has not undone.
async function undoRedo(ctx, fixture, target) {
  if (!declaredGesture("undo and redo")) {
    return { gesture: "undo and redo", detail: "This gesture is not declared by REQ-A2's projected allowed_change." };
  }
  await ctx.page.open(fixture.text);
  const before = await ctx.page.markdown();
  await ctx.page.focusSurface();
  if (!(await placeCaretInside(ctx.page, target.text)).ok) {
    return { gesture: "undo and redo", detail: CARET_NOT_PLACEABLE };
  }
  await ctx.page.sendKeys(["X"]);
  // The editor batches edits into history entries after a pause. Undoing
  // before that pause elapses would test the batching, not the undo.
  await ctx.page.settle(700);
  const edited = await ctx.page.markdown();

  await ctx.page.sendKeys([{ key: "z", ctrl: true }]);
  await ctx.page.settle(150);
  const undone = await ctx.page.markdown();

  if (undone !== before) {
    const diff = changedLines(before, undone);
    const where = firstDifference(before, undone);
    return {
      gesture: "undo and redo",
      detail: "Undo did not restore the document. Lines differ from the original "
        + "that the reverted edit never touched.",
      linesAllowedToChange: [],
      linesThatChanged: diff.touchedLineNumbers,
      line: where.line,
      firstDifferenceAtByte: where.byteOffset,
      expected: where.expectedLine,
      actual: where.actualLine,
    };
  }

  await ctx.page.sendKeys([{ key: "y", ctrl: true }]);
  await ctx.page.settle(150);
  const redone = await ctx.page.markdown();
  if (redone !== edited) {
    const where = firstDifference(edited, redone);
    return {
      gesture: "undo and redo",
      detail: "Redo did not restore the edited document.",
      line: where.line,
      firstDifferenceAtByte: where.byteOffset,
      expected: where.expectedLine,
      actual: where.actualLine,
    };
  }
  return null;
}

// A list item with at least one item above it in the same list, so indenting
// it is meaningful. Skips the first item of a list, which cannot be indented
// under anything.
function indentableListItem(fixture) {
  const lines = classifyLines(fixture.text);
  const marker = /^(\s*)([*+-]|\d+[.)])\s+\S/;
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    if (current.kind !== "block" || !marker.test(current.text)) continue;
    if (previous.kind !== "block" || !marker.test(previous.text)) continue;
    const indent = (current.text.match(marker) || [])[1] || "";
    const previousIndent = (previous.text.match(marker) || [])[1] || "";
    if (indent.length !== previousIndent.length) continue;
    // The SOURCE line carries the marker; the view does not render it as text.
    // Searching the view for the source line finds nothing, and the check then
    // reports a caret it could not place instead of measuring the product —
    // a check that always fails for its own reasons measures nothing at all.
    const visible = current.text.replace(marker, "$1").trim();
    if (visible.length < 3) continue;
    return { number: current.number, text: current.text, visible };
  }
  return null;
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
