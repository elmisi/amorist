"use strict";

// Family C — the caret across the view switch.
//
// Losing your place on every switch discourages using the source view, and the
// source view is exactly the one that would reveal a damaged document. This
// requirement protects the user's ability to check the other requirements.
//
// HOW THIS IS ASSERTED, and why it is not the obvious way.
//
// The obvious check is: note the character under the caret, switch, read the
// character under the caret, compare. It was written that way first and it was
// nearly incapable of failing for the right reason. Measured over the corpus,
// 64 of 75 probe positions sat on a character that occurs many times in the
// same file — several on a space appearing 167 times. A mapping landing on
// completely the wrong offset would still report "same character" almost every
// time. The check would have gone green with the caret still wrong.
//
// So the caret is anchored to a token that occurs EXACTLY ONCE in the document,
// and the assertion is that it lands inside that same token at the same offset
// within it. Landing there by accident is not possible: there is only one
// place in the file where that token is.

const { splitLines } = require("../lib/diff");

// Words long enough to be distinctive. Shorter ones repeat too often to be
// unique in a document of any size.
const TOKEN = /[A-Za-zÀ-ɏ]{5,}/g;

// How many anchors to probe per fixture, spread across the document rather
// than clustered where they happen to be found first.
const ANCHORS_PER_FIXTURE = 5;

function uniqueTokens(text) {
  const counts = new Map();
  for (const match of text.matchAll(TOKEN)) {
    const word = match[0];
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  const out = [];
  for (const match of text.matchAll(TOKEN)) {
    if (counts.get(match[0]) === 1) out.push({ token: match[0], at: match.index });
  }
  return out;
}

// Spread the anchors over the document instead of taking the first N.
function spread(items, count) {
  if (items.length <= count) return items;
  const step = items.length / count;
  const out = [];
  for (let n = 0; n < count; n += 1) out.push(items[Math.floor(n * step)]);
  return out;
}

function onlyOccurrence(haystack, needle) {
  const first = haystack.indexOf(needle);
  if (first < 0) return -1;
  return haystack.indexOf(needle, first + 1) === -1 ? first : -1;
}

module.exports = [
  {
    id: "REQ-C1",
    title: "Switching views leaves the caret on the same character, in both directions",
    note: "Anchored to tokens that occur exactly once in the document, so a wrong landing cannot report itself as right. Column numbers may differ where the file contains markers the view does not display; the CHARACTER may not.",
    async run(ctx) {
      const failures = [];
      const exercised = [];
      let anchorsProbed = 0;

      for (const fixture of ctx.corpus) {
        const candidates = uniqueTokens(fixture.text);
        if (candidates.length < 3) continue;
        exercised.push(fixture.name);

        for (const candidate of spread(candidates, ANCHORS_PER_FIXTURE)) {
          await ctx.page.open(fixture.text);
          await ctx.page.focusSurface();
          const surfaceText = await ctx.page.surfaceText();

          // The token must be unique in the VIEW as well, or the anchor gives
          // away the property it was chosen for.
          const inView = onlyOccurrence(surfaceText, candidate.token);
          if (inView < 0) continue;

          const within = Math.floor(candidate.token.length / 2);
          anchorsProbed += 1;
          await ctx.page.setCaretAtTextOffset(inView + within);
          const placedAt = await ctx.page.caretTextOffset();
          const expectedCharacter = surfaceText[placedAt];

          // Forward: view -> source.
          await ctx.page.toggleMode();
          await ctx.page.settle(40);
          if ((await ctx.page.mode()) !== "source") {
            failures.push({
              fixture: fixture.name,
              detail: "The toggle did not reach the source view, so the caret could not be compared.",
            });
            break;
          }
          const sourceValue = await ctx.page.sourceValue();
          const selection = await ctx.page.sourceSelection();
          const inSource = onlyOccurrence(sourceValue, candidate.token);

          if (inSource < 0) {
            failures.push({
              fixture: fixture.name,
              direction: "view to source",
              detail: `The anchor word ${JSON.stringify(candidate.token)} is not present exactly `
                + "once in the source view, so the switch changed the document itself. "
                + "The caret cannot be judged until that is fixed.",
            });
            continue;
          }

          const expectedInSource = inSource + (placedAt - inView);
          if (selection.start !== expectedInSource) {
            failures.push({
              fixture: fixture.name,
              direction: "view to source",
              anchor: candidate.token,
              detail: "The caret did not land inside the one place in the file where "
                + `${JSON.stringify(candidate.token)} occurs. It moved by `
                + `${selection.start - expectedInSource} characters.`,
              line: lineOf(sourceValue, selection.start),
              expected: `offset ${expectedInSource}, inside ${JSON.stringify(candidate.token)}`,
              actual: `offset ${selection.start}, on ${JSON.stringify(sourceValue[selection.start] || "")}`,
              characterMatchedAnyway: sourceValue[selection.start] === expectedCharacter,
            });
            continue;
          }

          // Backward: source -> view.
          await ctx.page.toggleMode();
          await ctx.page.settle(40);
          const backText = await ctx.page.surfaceText();
          const backOffset = await ctx.page.caretTextOffset();
          const backAnchor = onlyOccurrence(backText, candidate.token);
          if (backAnchor < 0) continue;
          if (backOffset !== backAnchor + within) {
            failures.push({
              fixture: fixture.name,
              direction: "source to view",
              anchor: candidate.token,
              detail: "The caret did not come back inside the word it left from.",
              expected: `offset ${backAnchor + within}, inside ${JSON.stringify(candidate.token)}`,
              actual: `offset ${backOffset}, on ${JSON.stringify(backText[backOffset] || "")}`,
              characterMatchedAnyway: backText[backOffset] === expectedCharacter,
            });
          }
        }
      }

      // The caret resting on a marker that exists only in the source. The
      // contract does not ask for a round trip here — there is nowhere in the
      // view for a hash to be — it asks the mapping to land on the first
      // visible character of that construct, DETERMINISTICALLY. Both halves are
      // asserted: the right character, and the same answer twice.
      for (const fixture of ctx.corpus) {
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
            detail: "The same starting position produced two different landings. A "
              + "mapping that is not deterministic cannot be relied on even when it "
              + "happens to be right.",
            expected: "the same offset twice",
            actual: `${landings[0].offset} then ${landings[1].offset}`,
          });
          continue;
        }
        if (landings[0].character !== marked.firstVisible) {
          failures.push({
            fixture: fixture.name,
            direction: "source marker into the view",
            detail: "The caret sat on a marker the view does not display, and the "
              + "mapping did not land on the first visible character of that construct.",
            expected: JSON.stringify(marked.firstVisible),
            actual: JSON.stringify(landings[0].character || ""),
          });
        }
      }

      // A check with nothing to probe must not pass (REQ-G1). Without this,
      // a corpus of short files would silently reduce this requirement to the
      // marker case alone.
      if (anchorsProbed < 10) {
        failures.push({
          fixture: "the corpus",
          detail: `Only ${anchorsProbed} anchor positions could be probed across the whole `
            + "corpus. This requirement needs documents long enough to carry distinctive "
            + "words; too few anchors means it is measuring almost nothing.",
        });
      }

      return { failures, fixturesExercised: exercised, metrics: { anchorsProbed } };
    },
  },
];

function lineOf(text, offset) {
  return splitLines(text.slice(0, Math.max(0, offset))).length || 1;
}

// A line whose first characters exist only in the source: a heading's hashes,
// a list item's bullet. Returns where the marker sits and the first character
// the view actually shows for that construct.
function markerLine(text) {
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(/^(#{1,6})\s+(\S)/);
    if (heading) return { line: raw, markerOffset: 0, firstVisible: heading[2] };
    const item = raw.match(/^([*+-]|\d+[.)])\s+(\S)/);
    if (item) return { line: raw, markerOffset: 0, firstVisible: item[2] };
  }
  return null;
}
