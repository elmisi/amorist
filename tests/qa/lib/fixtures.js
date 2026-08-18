"use strict";

// Which fixtures a requirement applies to.
//
// Selection is by CONTENT, never by file name. Drop a new file into the corpus
// and every requirement whose construct it contains starts covering it, with no
// code change — which is the mechanism that turns a real defect into a permanent
// regression case.
//
// A selector that matches nothing is a failure, not an empty pass (REQ-G1): a
// check with no fixtures is green precisely because it looked at nothing.

const { hasHandWrappedParagraph } = require("./markdown-shape");

const SELECTORS = {
  any: () => true,

  hasTrailingWhitespaceOrNoFinalNewline: (fixture) => {
    if (fixture.bytes.length && !fixture.text.endsWith("\n")) return true;
    return fixture.text.split("\n").some((line) => /[ \t]+\r?$/.test(line));
  },

  hasUnsupportedConstruct: (fixture) => (
    /^---\r?$/m.test(fixture.text)                   // front matter fence
    || /^ {4}\S/m.test(fixture.text)                 // indented code block
    || /^> ?>/m.test(fixture.text)                   // nested blockquote
    || /^\[\^[^\]]+\]:/m.test(fixture.text)          // footnote definition
    || /^\[[^\]]+\]: \S/m.test(fixture.text)         // reference definition
    || /^<[a-zA-Z]/m.test(fixture.text)              // raw HTML block
    || /^(=+|-{2,})\r?$/m.test(fixture.text)         // setext heading underline
    || /\[\[[^\]]+\]\]/.test(fixture.text)           // wiki link
  ),

  hasTable: (fixture) => /^\s*\|.*\|\s*\r?$/m.test(fixture.text),

  hasList: (fixture) => /^\s*([*+-]|\d+[.)])\s+\S/m.test(fixture.text),

  hasFence: (fixture) => /^\s*(```|~~~)/m.test(fixture.text),

  hasNonUniformTerminators: (fixture) => {
    const crlf = (fixture.text.match(/\r\n/g) || []).length;
    const lf = (fixture.text.match(/\n/g) || []).length - crlf;
    if (crlf && lf) return true;                      // mixed
    if (crlf) return true;                            // entirely CRLF
    return fixture.bytes.length > 0 && !fixture.text.endsWith("\n");
  },

  hasHandWrappedParagraph: (fixture) => hasHandWrappedParagraph(fixture.text),
};

function select(corpus, selectorName) {
  const selector = SELECTORS[selectorName];
  if (!selector) throw new Error(`Unknown fixture selector: ${selectorName}`);
  const chosen = corpus.filter(selector);
  if (!chosen.length) {
    throw new Error(
      `The fixture selector "${selectorName}" matched no file in the corpus. `
      + "A check with nothing to look at must not pass (REQ-G1).",
    );
  }
  return chosen;
}

module.exports = { select, SELECTORS };
