const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadEditorHelpers() {
  // Stub the dependency guards so the IIFE runs in node.
  const window = {
    AmoristInternals: {
      TextUtils: {}, MarkdownCodec: {}, EditingPolicy: {},
    },
  };
  const context = vm.createContext({ window, console, Intl, document: { querySelector: () => null } });
  vm.runInContext(fs.readFileSync("web/editor/amorist-text-utils.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("web/editor/amorist-editor.js", "utf8"), context, { filename: "amorist-editor.js" });
  return window.__editorTestHelpers;
}

const h = loadEditorHelpers();

// midViewportLine(scrollTop, clientHeight, lineHeight)
assert.equal(h.midViewportLine(0, 400, 20), 10);      // center at y=200 -> line 10
assert.equal(h.midViewportLine(200, 400, 20), 20);     // scrolled 200 -> center y=400 -> line 20
assert.equal(h.midViewportLine(0, 0, 20), 0);
assert.equal(h.midViewportLine(0, 400, 0), 0);         // guard against /0

console.log("midViewportLine OK");
