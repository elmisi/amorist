const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function load(path, window) {
  const context = vm.createContext({ window, console });
  vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path });
  return context.window;
}

const window = load("web/editor/amorist-document-model.js", {});
const { DocumentModel, TransactionJournal } = window.AmoristInternals;
const model = new DocumentModel("uno\r\ndue\ntre");
const journal = new TransactionJournal(3);
const first = model.transaction(5, 5, "!", "insert");
journal.push(first);
assert.equal(model.source, "uno\r\n!due\ntre");
assert.equal(model.display, "uno\n!due\ntre");
assert.equal(model.rawOffset(4), 5, "display offset maps around CRLF without changing it");
journal.undo(model);
assert.equal(model.source, "uno\r\ndue\ntre", "undo applies only the inverse transaction");
journal.redo(model);
assert.equal(model.source, "uno\r\n!due\ntre", "redo reapplies only the forward transaction");

const second = model.transaction(5, 6, "", "delete");
journal.push(second);
assert.equal(journal.redo(model), null, "a new transaction drops redo history");
assert.ok(journal.entries.every((entry) => entry.forward && entry.inverse));

// The WYSIWYG renderer removes Markdown delimiters from the visible projection.
// Selection offsets must still resolve to the corresponding raw bytes.
window.AmoristInternals.HtmlToMarkdown = {};
window.AmoristInternals.MarkdownCodec = {};
load("web/editor/amorist-editor.js", window);
const helpers = window.__editorTestHelpers;
assert.equal(helpers.sourceOffsetForVisibleText("**bold**", "bold", 0), 2);
assert.equal(helpers.sourceOffsetForVisibleText("**bold**", "bold", 4), 6);
assert.equal(helpers.sourceOffsetForVisibleText("[label](https://example.test)", "label", 5), 6);
assert.equal(helpers.visibleOffsetForSourcePrefix("**bold", "bold"), 4);
assert.equal(helpers.projectionLine("# Title").tag, "h1", "headings keep a WYSIWYG projection");
assert.equal(helpers.projectionLine("> quoted").tag, "blockquote", "quotes keep a WYSIWYG projection");
assert.equal(helpers.projectionLine("- item").list, "bullet", "lists keep their visual marker");
assert.equal(helpers.projectionLine("1. item").list, "ordered", "ordered lists keep their visual marker");

console.log("editor-history: transaction journal tests passed");
