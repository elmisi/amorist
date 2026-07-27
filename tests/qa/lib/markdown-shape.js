"use strict";

// Just enough structural reading of a Markdown file for the checks to aim at
// the right lines. This is NOT a parser and must never become one: the moment
// the checks share a parser with the product, the two agree with each other
// instead of agreeing with the file, and the suite stops being able to see a
// codec bug at all.
//
// It exists because of a defect found in the checks themselves: a paragraph
// finder that ignored fenced code blocks picked the lines of a code sample,
// where line breaks are preserved by definition — and reported a PASS for a
// requirement the product does not meet. A check that passes for the wrong
// reason is worse than one that fails.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const BLOCK_MARKER = /^\s*([#>*+\-|=]|\d+[.)]|\[|---)/;

// Line kinds:
//   fence  — the ``` or ~~~ line itself
//   code   — inside a fence, or indented four spaces or more
//   blank  — empty or whitespace only
//   block  — a heading, list item, quote, table row, link definition, rule
//   prose  — ordinary text, the only kind whose line breaks are the author's
//            own choice and therefore the only kind these requirements are about
function classifyLines(text) {
  const raw = text.split(/\r?\n/);
  const lines = [];
  let openFence = "";

  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index];
    const fenceMatch = line.match(FENCE);

    if (openFence) {
      const closes = fenceMatch && line.trim().startsWith(openFence[0].repeat(openFence.length));
      lines.push({ number: index + 1, text: line, kind: closes ? "fence" : "code" });
      if (closes) openFence = "";
      continue;
    }
    if (fenceMatch) {
      openFence = fenceMatch[1];
      lines.push({ number: index + 1, text: line, kind: "fence" });
      continue;
    }
    if (!line.trim()) {
      lines.push({ number: index + 1, text: line, kind: "blank" });
      continue;
    }
    if (/^ {4,}\S/.test(line) || /^\t/.test(line)) {
      lines.push({ number: index + 1, text: line, kind: "code" });
      continue;
    }
    if (BLOCK_MARKER.test(line)) {
      lines.push({ number: index + 1, text: line, kind: "block" });
      continue;
    }
    lines.push({ number: index + 1, text: line, kind: "prose" });
  }

  return lines;
}

// The first run of consecutive prose lines long enough to be a paragraph
// somebody wrapped by hand. A setext heading's underline is a block marker, so
// a title and its underline can never be mistaken for one.
function findHandWrappedParagraph(text, minimum = 3) {
  const lines = classifyLines(text);
  let run = [];
  for (const line of lines) {
    if (line.kind === "prose" && line.text.trim().length >= 20) {
      run.push(line);
      continue;
    }
    if (run.length >= minimum) return run;
    run = [];
  }
  return run.length >= minimum ? run : null;
}

function hasHandWrappedParagraph(text) {
  return findHandWrappedParagraph(text) !== null;
}

module.exports = { classifyLines, findHandWrappedParagraph, hasHandWrappedParagraph };
