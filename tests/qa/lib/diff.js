"use strict";

// Failure localisation.
//
// From the architecture note: "A failure that cannot name where it happened is
// not a usable failure." Everything here exists to turn "the bytes differ" into
// "byte 412, line 17, this became that".

// Split keeping each line's own terminator attached, because the terminator is
// part of what is being compared (REQ-A9: the rule is per line, not per file).
function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function visible(text) {
  return JSON.stringify(text === undefined ? null : text);
}

function firstDifference(expected, actual) {
  if (expected === actual) return null;

  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  let byteOffset = 0;
  while (
    byteOffset < expectedBytes.length
    && byteOffset < actualBytes.length
    && expectedBytes[byteOffset] === actualBytes[byteOffset]
  ) {
    byteOffset += 1;
  }

  const prefix = expectedBytes.subarray(0, byteOffset).toString("utf8");
  // The line CONTAINING the difference. When the common prefix ends on a line
  // break, the difference starts the next line — counting complete lines would
  // point one line too early, and the report would show two identical lines and
  // look like a bug in the check rather than in the product.
  const completeLines = splitLines(prefix).length;
  const line = prefix.endsWith("\n") ? completeLines + 1 : (completeLines || 1);
  const lastBreak = prefix.lastIndexOf("\n");
  const column = prefix.length - lastBreak;

  const expectedLines = splitLines(expected);
  const actualLines = splitLines(actual);

  return {
    byteOffset,
    line,
    column,
    expectedLine: visible(expectedLines[line - 1]),
    actualLine: visible(actualLines[line - 1]),
    expectedBytes: expectedBytes.length,
    actualBytes: actualBytes.length,
  };
}

// Which lines differ, by longest-common-subsequence over whole lines. Corpus
// files are tens of lines, so the quadratic table is free and exact beats
// clever here: REQ-A2 turns on which lines changed, and an approximation would
// make the requirement unfalsifiable.
function changedLines(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const removed = [];
  const added = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      removed.push({ line: i + 1, text: a[i] });
      i += 1;
    } else {
      added.push({ line: j + 1, text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    removed.push({ line: i + 1, text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    added.push({ line: j + 1, text: b[j] });
    j += 1;
  }

  const touched = new Set([...removed.map((r) => r.line), ...added.map((r) => r.line)]);
  return {
    removed,
    added,
    touchedLineNumbers: [...touched].sort((x, y) => x - y),
    count: removed.length + added.length,
  };
}

module.exports = { splitLines, firstDifference, changedLines, visible };
