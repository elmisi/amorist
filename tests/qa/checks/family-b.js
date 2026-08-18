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
const { performanceFixture } = require("../lib/performance-fixture");
const { runTauriAppChecks } = require("../lib/tauri-app-e2e");

function nearestRankP95(samples) {
  return samples.slice().sort((a, b) => a - b)[18];
}

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

  {
    id: "REQ-B4",
    title: "Visual Markdown projection keeps subsequent typing at the caret",
    note: "Real key sequences catch the empty-projection case where a hidden marker has no visible character available for caret mapping.",
    async run(ctx) {
      const failures = [];
      const cases = [
        { name: "bullet", prefix: "- ", text: "alpha", expected: "- alpha", measureMarker: true },
        { name: "ordered item", prefix: "1. ", text: "alpha", expected: "1. alpha", measureMarker: true },
        { name: "quote", prefix: "> ", text: "alpha", expected: "> alpha" },
        { name: "heading", prefix: "# ", text: "alpha", expected: "# alpha" },
        { name: "task item", prefix: "- [ ] ", text: "alpha", expected: "- [ ] alpha", measureMarker: true },
      ];

      for (const sample of cases) {
        await ctx.page.open("");
        await ctx.page.focusSurface();
        await ctx.page.sendKeys(Array.from(sample.prefix));
        if (sample.measureMarker) {
          const geometry = await ctx.page.projectedCaretGeometry();
          if (!geometry || !geometry.afterMarker) {
            failures.push({
              fixture: sample.name,
              detail: "Immediately after the Markdown shortcut, the visible caret was not after its projected marker.",
              expected: "caret x at or beyond the marker's right edge",
              actual: JSON.stringify(geometry),
            });
          }
        }
        await ctx.page.sendKeys(Array.from(sample.text));
        await ctx.page.settle(80);
        const markdown = await ctx.page.markdown();
        const rendered = await ctx.page.surfaceText();
        if (markdown !== sample.expected || !rendered.includes(sample.text)) {
          failures.push({
            fixture: sample.name,
            detail: "Typing did not continue after the projected Markdown marker.",
            expected: sample.expected,
            actual: markdown,
            rendered,
          });
        }
      }

      return { failures, fixturesExercised: cases.map((sample) => sample.name) };
    },
  },

  {
    id: "REQ-B6",
    title: "Lists continue, split, exit and lose their marker like a conventional editor",
    note: "Every case uses real keys and asserts exact Markdown. Continuation is inspected before typing the next item so a misplaced caret cannot be hidden by the following render.",
    async run(ctx) {
      const failures = [];
      const cases = [
        { name: "dash item continues", source: "- alpha", caret: 7, first: { key: "Enter" }, intermediate: "- alpha\n- ", text: "beta", expected: "- alpha\n- beta", marker: true },
        { name: "asterisk item continues", source: "* alpha", caret: 7, first: { key: "Enter" }, intermediate: "* alpha\n* ", text: "beta", expected: "* alpha\n* beta", marker: true },
        { name: "plus item continues", source: "+ alpha", caret: 7, first: { key: "Enter" }, intermediate: "+ alpha\n+ ", text: "beta", expected: "+ alpha\n+ beta", marker: true },
        { name: "dotted ordered item increments", source: "7. alpha", caret: 8, first: { key: "Enter" }, intermediate: "7. alpha\n8. ", text: "beta", expected: "7. alpha\n8. beta", marker: true },
        { name: "ordered item increments", source: "7) alpha", caret: 8, first: { key: "Enter" }, intermediate: "7) alpha\n8) ", text: "beta", expected: "7) alpha\n8) beta", marker: true },
        { name: "indented marker and spacing are retained", source: "  *  alpha", caret: 10, first: { key: "Enter" }, intermediate: "  *  alpha\n  *  ", text: "beta", expected: "  *  alpha\n  *  beta", marker: true },
        { name: "item splits in the middle", source: "- alpha", caret: 4, first: { key: "Enter" }, intermediate: "- al\n- pha", text: "X", expected: "- al\n- Xpha", marker: true },
        { name: "task continuation starts unchecked", source: "- [x] done", caret: 10, first: { key: "Enter" }, intermediate: "- [x] done\n- [ ] ", text: "next", expected: "- [x] done\n- [ ] next", marker: true },
        { name: "empty item exits the list", source: "- alpha\n- ", caret: 10, first: { key: "Enter" }, intermediate: "- alpha\n", text: "beta", expected: "- alpha\nbeta" },
        { name: "Backspace removes the item prefix", source: "- alpha", caret: 2, first: { key: "Backspace" }, intermediate: "alpha", text: "", expected: "alpha" },
      ];

      for (const sample of cases) {
        await ctx.page.open(sample.source);
        await ctx.page.setRawSelection(sample.caret);
        await ctx.page.sendKeys([sample.first]);
        await ctx.page.settle(60);
        const intermediate = await ctx.page.markdown();
        if (intermediate !== sample.intermediate) {
          failures.push({
            fixture: sample.name,
            detail: "The structural key did not produce the expected local list transaction.",
            expected: sample.intermediate,
            actual: intermediate,
          });
          continue;
        }
        if (sample.marker) {
          const geometry = await ctx.page.projectedCaretGeometry();
          if (!geometry || !geometry.afterMarker) {
            failures.push({
              fixture: sample.name,
              detail: "The continued item caret was not visibly placed after its marker.",
              expected: "caret x at or beyond the marker's right edge",
              actual: JSON.stringify(geometry),
            });
          }
        }
        if (sample.text) await ctx.page.sendKeys(Array.from(sample.text));
        await ctx.page.settle(60);
        const actual = await ctx.page.markdown();
        if (actual !== sample.expected) {
          failures.push({
            fixture: sample.name,
            detail: "Typing after the structural key did not stay in the intended item.",
            expected: sample.expected,
            actual,
          });
        }
      }

      return { failures, fixturesExercised: cases.map((sample) => sample.name) };
    },
  },

  {
    id: "REQ-B7",
    title: "Headings and quotes continue or exit without exposing broken prefixes",
    note: "These are the non-list instances of the same hidden-prefix boundary. Real keys assert the whole workflow, including the text typed after the structural action.",
    async run(ctx) {
      const failures = [];
      const cases = [
        { name: "quote continues", source: "> alpha", caret: 7, key: "Enter", intermediate: "> alpha\n> ", text: "beta", expected: "> alpha\n> beta" },
        { name: "quote splits", source: "> alpha", caret: 4, key: "Enter", intermediate: "> al\n> pha", text: "X", expected: "> al\n> Xpha" },
        { name: "empty quote exits", source: "> alpha\n> ", caret: 10, key: "Enter", intermediate: "> alpha\n", text: "beta", expected: "> alpha\nbeta" },
        { name: "quote Backspace removes prefix", source: "> alpha", caret: 2, key: "Backspace", intermediate: "alpha", text: "", expected: "alpha" },
        { name: "heading Enter creates prose", source: "## alpha", caret: 8, key: "Enter", intermediate: "## alpha\n", text: "beta", expected: "## alpha\nbeta" },
        { name: "heading splits into prose", source: "## alpha", caret: 5, key: "Enter", intermediate: "## al\npha", text: "X", expected: "## al\nXpha" },
        { name: "empty heading exits", source: "# ", caret: 2, key: "Enter", intermediate: "", text: "beta", expected: "beta" },
        { name: "heading Backspace removes prefix", source: "## alpha", caret: 3, key: "Backspace", intermediate: "alpha", text: "", expected: "alpha" },
      ];

      for (const sample of cases) {
        await ctx.page.open(sample.source);
        await ctx.page.setRawSelection(sample.caret);
        await ctx.page.sendKeys([{ key: sample.key }]);
        await ctx.page.settle(60);
        const intermediate = await ctx.page.markdown();
        if (intermediate !== sample.intermediate) {
          failures.push({
            fixture: sample.name,
            detail: "The structural key did not produce the expected heading/quote transaction.",
            expected: sample.intermediate,
            actual: intermediate,
          });
          continue;
        }
        if (sample.text) await ctx.page.sendKeys(Array.from(sample.text));
        await ctx.page.settle(60);
        const actual = await ctx.page.markdown();
        if (actual !== sample.expected) {
          failures.push({
            fixture: sample.name,
            detail: "Typing after the structural key landed in the wrong source position.",
            expected: sample.expected,
            actual,
          });
        }
      }

      return { failures, fixturesExercised: cases.map((sample) => sample.name) };
    },
  },

  {
    id: "REQ-B5",
    title: "Pipe-table columns align visually without changing the Markdown",
    note: "The source is deliberately ragged; corresponding pipe positions are measured in pixels while byte identity is asserted separately.",
    async run(ctx) {
      const markdown = [
        "| a | bbbbbbbb | c |",
        "|---|---|---|",
        "| longer | b | ccccc |",
      ].join("\n");
      await ctx.page.open(markdown);
      await ctx.page.settle(80);
      const positions = await ctx.page.tableColumnPositions();
      const after = await ctx.page.markdown();
      const failures = [];

      if (after !== markdown) {
        failures.push({
          fixture: "ragged pipe table",
          detail: "Visual alignment changed the source Markdown.",
          expected: markdown,
          actual: after,
        });
      }
      if (positions.length !== 3 || positions.some((row) => row.length !== positions[0].length)) {
        failures.push({
          fixture: "ragged pipe table",
          detail: "The rendered table did not expose the same pipe boundaries on every row.",
          actual: JSON.stringify(positions),
        });
      } else {
        positions[0].forEach((_, column) => {
          const values = positions.map((row) => row[column]);
          if (Math.max(...values) - Math.min(...values) > 1) {
            failures.push({
              fixture: "ragged pipe table",
              detail: `Pipe boundary ${column + 1} is not visually aligned.`,
              expected: "positions within 1px",
              actual: values.join(", "),
            });
          }
        });
      }

      return { failures, fixturesExercised: ["ragged pipe table"] };
    },
  },
  {
    id: "REQ-B8",
    title: "Tables and fenced code are framed blocks with independent horizontal scrolling",
    note: "The live projection wrappers are observed through computed style and native scroll state; alignment remains owned by REQ-B5.",
    async run(ctx) {
      const wideA = "A".repeat(180);
      const wideB = "B".repeat(200);
      const wideCode = "const payload = \"" + "C".repeat(220) + "\";";
      const markdown = [
        "| a | b |", "|---|---|", "| c | d |", "",
        `| ${wideA} | one |`, "|---|---|", "| x | two |", "",
        `| ${wideB} | red |`, "|---|---|", "| y | blue |", "",
        "```javascript", wideCode, "```", "",
        "~~~text", "tilde fence", "~~~",
      ].join("\n");
      await ctx.page.setHostWidth(640);
      await ctx.page.open(markdown);
      await ctx.page.settle(80);
      const blocks = await ctx.page.blockPresentation();
      const failures = [];
      const types = blocks.map((block) => block.type);
      if (JSON.stringify(types) !== JSON.stringify(["table", "table", "table", "code", "code"])) {
        failures.push({
          fixture: "table and fence containment",
          detail: "The projection did not create exactly one wrapper per table/fenced region.",
          expected: "table, table, table, code, code",
          actual: types.join(", "),
        });
      }
      blocks.forEach((block, index) => {
        const style = [block.borderTopWidth, block.borderRadius, block.paddingTop, block.paddingRight, block.overflowX, block.overflowY];
        const expected = ["1px", "8px", "16px", "16px", "auto", "hidden"];
        if (JSON.stringify(style) !== JSON.stringify(expected)) {
          failures.push({
            fixture: `projection block ${index + 1}`,
            detail: "The live wrapper does not use the approved frame and horizontal-only overflow.",
            expected: expected.join(", "),
            actual: style.join(", "),
          });
        }
        if (block.rows.length !== 3) {
          failures.push({
            fixture: `projection block ${index + 1}`,
            detail: "The wrapper lost a line-addressable descendant.",
            expected: "3 source rows",
            actual: String(block.rows.length),
          });
        }
      });
      [blocks[1], blocks[2], blocks[3]].forEach((block, index) => {
        if (!block || block.scrollWidth <= block.clientWidth) {
          failures.push({
            fixture: `wide projection block ${index + 1}`,
            detail: "The deliberately wide block has no local horizontal scroll extent.",
          });
        }
      });

      const first = await ctx.page.scrollProjectionBlock("table", 1);
      const second = await ctx.page.scrollProjectionBlock("table", 2);
      const code = await ctx.page.scrollProjectionBlock("code", 0);
      if (!first || first.blocks[1] <= 0 || first.blocks.some((value, index) => index !== 1 && value !== 0)) {
        failures.push({ fixture: "first wide table", detail: "Scrolling one table moved another projection block or did not move locally.", actual: JSON.stringify(first) });
      }
      if (!second || second.blocks[1] <= 0 || second.blocks[2] <= 0 || second.blocks.some((value, index) => index !== 1 && index !== 2 && value !== 0)) {
        failures.push({ fixture: "second wide table", detail: "The two table scroll owners are not independent.", actual: JSON.stringify(second) });
      }
      if (!code || code.blocks[1] <= 0 || code.blocks[2] <= 0 || code.blocks[3] <= 0) {
        failures.push({ fixture: "wide fenced code", detail: "The fenced block did not scroll independently of both tables.", actual: JSON.stringify(code) });
      }
      for (const state of [first, second, code]) {
        if (state && (state.surface !== 0 || state.document !== 0)) {
          failures.push({ fixture: "document containment", detail: "Local block scrolling moved the surface or document viewport.", actual: JSON.stringify(state) });
        }
      }
      const after = await ctx.page.markdown();
      if (after !== markdown) {
        failures.push({ fixture: "table and fence containment", detail: "Rendering or scrolling changed source bytes.", expected: markdown, actual: after });
      }
      return { failures, fixturesExercised: ["narrow table", "two wide tables", "backtick fence", "tilde fence"] };
    },
  },
  {
    id: "REQ-B9",
    title: "Stable same-line typing is DOM-local and meets the event-to-frame budgets",
    note: "Each engine records 80 samples: 500/1500 lines times prose/table targets times 20 real keys; raw reports compose to the required 160.",
    async run(ctx) {
      const failures = [];
      const localityCases = [
        { name: "prose", source: "alpha TARGET omega\nuntouched sentinel", target: "TARGET", mutable: [0] },
        { name: "list", source: "- TARGET item\nuntouched sentinel", target: "TARGET", mutable: [0] },
        { name: "table", source: "| TARGET | b |\n|---|---|\n| c | d |\nuntouched sentinel", target: "TARGET", mutable: [0, 1, 2] },
        { name: "fenced code", source: "```js\nTARGET\n```\nuntouched sentinel", target: "TARGET", mutable: [1] },
      ];
      for (const sample of localityCases) {
        await ctx.page.open(sample.source);
        const at = sample.source.indexOf(sample.target) + sample.target.length;
        await ctx.page.setRawSelection(at);
        const before = await ctx.page.projectionIdentity();
        await ctx.page.sendKeys(["x"]);
        await ctx.page.settle(30);
        const after = await ctx.page.projectionIdentity();
        before.rows.forEach((id, line) => {
          if (!sample.mutable.includes(line) && after.rows[line] !== id) {
            failures.push({ fixture: sample.name, line: line + 1, detail: "A same-line key replaced a DOM row outside its projection unit." });
          }
        });
        const expected = sample.source.slice(0, at) + "x" + sample.source.slice(at);
        const actual = await ctx.page.markdown();
        if (actual !== expected) failures.push({ fixture: sample.name, detail: "The local key was lost or reordered.", expected, actual });
      }

      const compositionSource = "prima COMPOSITION dopo\nuntouched composition row";
      const compositionAt = compositionSource.indexOf("COMPOSITION") + "COMPOSITION".length;
      await ctx.page.open(compositionSource);
      await ctx.page.setRawSelection(compositionAt);
      const compositionIdentity = await ctx.page.projectionIdentity();
      await ctx.page.compositionInput("è");
      await ctx.page.settle(30);
      const compositionAfter = await ctx.page.projectionIdentity();
      const compositionMarkdown = await ctx.page.markdown();
      const compositionExpected = compositionSource.slice(0, compositionAt) + "è" + compositionSource.slice(compositionAt);
      if (compositionMarkdown !== compositionExpected || compositionIdentity.rows[1] !== compositionAfter.rows[1]) {
        failures.push({
          fixture: "IME composition",
          detail: "A composition transaction was doubled/lost or replaced an untouched row.",
          expected: compositionExpected,
          actual: compositionMarkdown,
        });
      }

      const scrolledTarget = "SCROLLED_TABLE_TARGET";
      const scrolledTableSource = [
        `| ${"wide ".repeat(40)} | ${scrolledTarget} |`,
        "|---|---|",
        "| short | value |",
      ].join("\n");
      await ctx.page.setHostWidth(640);
      await ctx.page.open(scrolledTableSource);
      const scrolledAt = scrolledTableSource.indexOf(scrolledTarget) + scrolledTarget.length;
      await ctx.page.setRawSelection(scrolledAt);
      await ctx.page.scrollProjectionBlock("table", 0);
      const scrolledBefore = (await ctx.page.blockPresentation())[0];
      await ctx.page.sendKeys(["x"]);
      await ctx.page.settle(30);
      const scrolledAfter = (await ctx.page.blockPresentation())[0];
      const expectedScroll = scrolledAfter.scrollWidth - scrolledAfter.clientWidth;
      if (scrolledBefore.scrollLeft <= 0
        || scrolledAfter.scrollLeft <= 0
        || Math.abs(scrolledAfter.scrollLeft - expectedScroll) > 1) {
        failures.push({
          fixture: "typing at the end of a horizontally scrolled table",
          detail: "Rebuilding the local table projection lost its right-edge horizontal anchor.",
          expected: `scrollLeft ${expectedScroll} (right edge)`,
          actual: `before ${scrolledBefore.scrollLeft}, after ${scrolledAfter.scrollLeft}`,
        });
      }
      const scrolledMarkdown = await ctx.page.markdown();
      const scrolledExpected = scrolledTableSource.slice(0, scrolledAt) + "x" + scrolledTableSource.slice(scrolledAt);
      if (scrolledMarkdown !== scrolledExpected) {
        failures.push({
          fixture: "typing at the end of a horizontally scrolled table",
          detail: "The scroll-preservation gesture changed or reordered source text.",
          expected: scrolledExpected,
          actual: scrolledMarkdown,
        });
      }

      const timing = [];
      for (const size of [500, 1500]) {
        const fixture = performanceFixture(size);
        if (fixture.lineCount !== size) throw new Error(`Generated ${fixture.lineCount} lines for the ${size}-line fixture.`);
        for (const target of ["plain", "table"]) {
          await ctx.page.open(fixture.markdown);
          const offset = target === "plain" ? fixture.plainOffset : fixture.tableOffset;
          await ctx.page.setRawSelection(offset);
          await ctx.page.sendKeys(["w", "w", "w"]);
          await ctx.page.settle(40);
          const identity = await ctx.page.projectionIdentity();
          await ctx.page.resetLatencies();
          for (let sample = 0; sample < 20; sample += 1) {
            await ctx.page.sendKeys(["x"]);
            await ctx.page.settle(20);
          }
          const samples = await ctx.page.latencies();
          const afterIdentity = await ctx.page.projectionIdentity();
          const p95 = samples.length === 20 ? nearestRankP95(samples) : null;
          const limit = size === 500 ? 50 : 100;
          timing.push({ engine: ctx.engine, lines: size, target, warmups: 3, samples, p95, limit });
          if (samples.length !== 20) {
            failures.push({ fixture: `${size} lines / ${target}`, detail: "The harness did not record exactly 20 event-to-frame samples.", expected: "20", actual: String(samples.length) });
          } else if (p95 > limit) {
            failures.push({ fixture: `${size} lines / ${target}`, detail: "Nearest-rank p95 exceeds the blocking latency budget.", expected: `<= ${limit} ms`, actual: `${p95} ms` });
          }
          const untouched = size - 1;
          if (identity.rows[untouched] !== afterIdentity.rows[untouched]) {
            failures.push({ fixture: `${size} lines / ${target}`, line: size, detail: "An untouched row lost DOM identity during ordinary typing." });
          }
          const expectedLength = fixture.markdown.length + 23;
          const actual = await ctx.page.markdown();
          if (actual.length !== expectedLength) {
            failures.push({ fixture: `${size} lines / ${target}`, detail: "Measured typing lost or duplicated source characters.", expected: String(expectedLength), actual: String(actual.length) });
          }
        }
      }
      return { failures, fixturesExercised: localityCases.map((sample) => sample.name).concat(["IME composition", "scrolled table typing", "500-line mixed document", "1500-line mixed document"]), metrics: { timing } };
    },
  },
  {
    id: "REQ-B4",
    scope: "run",
    title: "The built application places the caret after projected markers",
    async run() {
      const app = await runTauriAppChecks();
      return {
        failures: app.B4,
        fixturesExercised: app.fixtures.filter((fixture) => fixture.includes("structural editing")),
        delegated: app.delegated ? [app.delegated] : [],
      };
    },
  },
  {
    id: "REQ-B6",
    scope: "run",
    title: "The built application supports conventional list workflows",
    async run() {
      const app = await runTauriAppChecks();
      return {
        failures: app.B6,
        fixturesExercised: app.fixtures.filter((fixture) => fixture.includes("structural editing")),
        delegated: app.delegated ? [app.delegated] : [],
      };
    },
  },
  {
    id: "REQ-B7",
    scope: "run",
    title: "The built application supports heading and quote workflows",
    async run() {
      const app = await runTauriAppChecks();
      return {
        failures: app.B7,
        fixturesExercised: app.fixtures.filter((fixture) => fixture.includes("structural editing")),
        delegated: app.delegated ? [app.delegated] : [],
      };
    },
  },
];
