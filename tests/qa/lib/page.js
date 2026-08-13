"use strict";

// The page-side API, as seen from a check.
//
// Every call goes through engine.evaluate, so a check never touches a protocol
// and never learns which engine it is running on.

function call(engine, method, args = []) {
  const encoded = args.map((value) => JSON.stringify(value)).join(", ");
  return engine.evaluate(`window.__qa.${method}(${encoded})`);
}

function makePage(engine) {
  return {
    engine,

    open: (text) => call(engine, "open", [text]),
    markdown: () => call(engine, "markdown"),
    mode: () => call(engine, "mode"),
    toggleMode: () => call(engine, "toggleMode"),
    focusSurface: () => call(engine, "focusSurface"),
    focusSource: () => call(engine, "focusSource"),
    setCaretAtTextOffset: (offset) => call(engine, "setCaretAtTextOffset", [offset]),
    caretTextOffset: () => call(engine, "caretTextOffset"),
    surfaceText: () => call(engine, "surfaceText"),
    sourceValue: () => call(engine, "sourceValue"),
    sourceSelection: () => call(engine, "sourceSelection"),
    setSourceSelection: (start, end) => call(engine, "setSourceSelection", [start, end]),
    lineBoxes: () => call(engine, "lineBoxes"),
    firstCharacterTop: (needle) => call(engine, "firstCharacterTop", [needle]),
    selectTextRange: (start, end) => call(engine, "selectTextRange", [start, end]),
    paste: (html, text) => call(engine, "paste", [html, text]),
    setHostWidth: (pixels) => call(engine, "setHostWidth", [pixels]),
    fontFingerprint: () => call(engine, "fontFingerprint"),
    toolbarAction: (name) => call(engine, "toolbarAction", [name]),
    caretScreenY: () => call(engine, "caretScreenY"),
    viewportSourceLine: () => call(engine, "viewportSourceLine"),
    scrollCaretIntoView: () => call(engine, "scrollCaretIntoView"),

    sendKeys: (sequence) => engine.sendKeys(sequence),
    evaluate: (expression) => engine.evaluate(expression),

    // Give the editor's own debounced work a chance to settle before reading
    // back. Waiting on a timer is a smell, but the alternative — reaching into
    // the editor's internals — would make the check depend on how the editor is
    // built rather than on what it produces.
    settle: (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

module.exports = { makePage };
