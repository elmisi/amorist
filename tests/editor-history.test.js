const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadClassicScript(path, window = {}) {
  const context = vm.createContext({ window, console, Intl, document: {}, NodeFilter: {}, Promise });
  vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path });
  return context.window;
}

function loadMarkdownHistory() {
  const window = loadClassicScript("web/editor/amorist-text-utils.js");
  loadClassicScript("web/editor/amorist-table-codec.js", window);
  loadClassicScript("web/editor/amorist-markdown-codec.js", window);
  window.AmoristInternals.EditingPolicy = { create: function () { return {}; } };
  loadClassicScript("web/editor/amorist-editor.js", window);
  return window.AmoristInternals.MarkdownHistory;
}

const MarkdownHistory = loadMarkdownHistory();

// Basic push and undo
var h = new MarkdownHistory(100, 50 * 1024 * 1024);
h.push("a");
h.push("b");
h.push("c");
assert.equal(h.undo(), "b");
assert.equal(h.undo(), "a");
assert.equal(h.undo(), null);

// Redo
assert.equal(h.redo(), "b");
assert.equal(h.redo(), "c");
assert.equal(h.redo(), null);

// New edit after undo clears forward history
h = new MarkdownHistory(100, 50 * 1024 * 1024);
h.push("a");
h.push("b");
h.push("c");
h.undo();
h.push("d");
assert.equal(h.redo(), null);
assert.equal(h.undo(), "b");

// Duplicate push is skipped
h = new MarkdownHistory(100, 50 * 1024 * 1024);
h.push("a");
h.push("a");
assert.equal(h.entries.length, 1);

// Entry cap
h = new MarkdownHistory(3, 50 * 1024 * 1024);
h.push("a");
h.push("b");
h.push("c");
h.push("d");
assert.equal(h.entries.length, 3);
assert.equal(h.entries[0], "b");
assert.equal(h.entries[1], "c");
assert.equal(h.entries[2], "d");

// Code unit cap
h = new MarkdownHistory(100, 10);
h.push("aaaa");
h.push("bbbb");
h.push("cccc");
assert.ok(h.totalCodeUnits <= 10);
assert.equal(h.entries[h.entries.length - 1], "cccc");
assert.ok(h.entries.length <= 2);

// Undo on empty history
h = new MarkdownHistory(100, 50 * 1024 * 1024);
assert.equal(h.undo(), null);
assert.equal(h.redo(), null);

// Undo with single entry
h = new MarkdownHistory(100, 50 * 1024 * 1024);
h.push("only");
assert.equal(h.undo(), null);

console.log("editor-history: all tests passed");
