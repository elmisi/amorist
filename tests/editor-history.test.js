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

for (const [source,offset,ending] of [
  ["no terminator",13,"\n"], ["first\r\nlast",11,"\r\n"],
  ["first\rlast",10,"\r"], ["first\r\nsecond\nlast",18,"\n"],
  ["first\nsecond\rlast",17,"\r"], ["first\r\nlast",6,"\r\n"],
]) assert.equal(new DocumentModel(source).lineEndingAt(offset),ending,"new boundaries inherit current or last preceding terminator");

const boundaryModel = new DocumentModel("literal\\\nnext");
assert.deepEqual(JSON.parse(JSON.stringify(boundaryModel.boundaryState())),{schemaVersion:1,offsetEncoding:"utf16",automaticBreaks:[]},
  "opening an existing backslash never invents automatic ownership");
const owned = new DocumentModel("first second");
const boundaryJournal = new TransactionJournal(10);
const breakEntry = owned.transaction(5,5,"\\\r\n","prose-enter",{schemaVersion:1,offsetEncoding:"utf16",automaticBreaks:[{marker:5,escapes:[]}]});
boundaryJournal.push(breakEntry);
assert.equal(owned.source,"first\\\r\n second");
const serialized = JSON.parse(JSON.stringify(owned.boundaryState()));
const restored = new DocumentModel(owned.source);
assert.equal(restored.restoreBoundaryState(serialized),true);
assert.deepEqual(JSON.parse(JSON.stringify(restored.boundaryState())),serialized,"provenance survives a JSON round trip without changing Markdown");
boundaryJournal.push(owned.transaction(0,0,"prefix ","insert"));
assert.equal(owned.boundaryState().automaticBreaks[0].marker,12,"an earlier edit rebases the owned boundary");
boundaryJournal.undo(owned);assert.equal(owned.boundaryState().automaticBreaks[0].marker,5);
boundaryJournal.undo(owned);assert.equal(owned.source,"first second");assert.equal(owned.boundaryState().automaticBreaks.length,0);
boundaryJournal.redo(owned);assert.equal(owned.boundaryState().automaticBreaks[0].marker,5);
owned.transaction(5,6,"\\","literal-replacement");
assert.equal(owned.boundaryState().automaticBreaks.length,0,"retyping the same source byte drops automatic ownership");
assert.equal(owned.source,"first\\\r\n second");
assert.equal(restored.restoreBoundaryState({schemaVersion:1,offsetEncoding:"utf16",automaticBreaks:[{marker:0,escapes:[]}]}),false);
assert.deepEqual(JSON.parse(JSON.stringify(restored.boundaryState())),serialized,"invalid recovery provenance cannot replace valid state");
const beforeInvalid = restored.source, beforeRevision = restored.revision;
assert.throws(()=>restored.transaction(0,0,"x","insert",null),/Invalid automatic boundary/);
assert.equal(restored.source,beforeInvalid);assert.equal(restored.revision,beforeRevision,"invalid metadata aborts before editing source");
const escaped = new DocumentModel("abc " + "\\".repeat(3) + "\r\nrest");
assert.equal(escaped.restoreBoundaryState({schemaVersion:1,offsetEncoding:"utf16",automaticBreaks:[{marker:6,escapes:[5]}]}),true);
escaped.transaction(0,0,"X","insert");
assert.deepEqual(JSON.parse(JSON.stringify(escaped.boundaryState())),{schemaVersion:1,offsetEncoding:"utf16",automaticBreaks:[{marker:7,escapes:[6]}]},
  "generated escaping positions rebase with the marker while the original literal backslash stays unowned");
const detached = escaped.boundaryState();detached.automaticBreaks[0].escapes.length=0;
assert.equal(escaped.boundaryState().automaticBreaks[0].escapes.length,1,"exported metadata does not alias model state");
escaped.transaction(0,0,"😀","insert");
assert.deepEqual(JSON.parse(JSON.stringify(escaped.boundaryState())),{schemaVersion:1,offsetEncoding:"utf16",automaticBreaks:[{marker:9,escapes:[8]}]},
  "supplementary Unicode characters rebase provenance in the same offset space as DOM selections");
assert.equal(escaped.restoreBoundaryState({...escaped.boundaryState(),offsetEncoding:"utf8"}),false);
escaped.transaction(7,9,"","delete-literal-glyph");
assert.deepEqual(JSON.parse(JSON.stringify(escaped.boundaryState())),{schemaVersion:1,offsetEncoding:"utf16",automaticBreaks:[{marker:7,escapes:[]}]},
  "removing an escaped literal glyph leaves the separately generated break marker owned");
const protectedModel = new DocumentModel("text"), protectedJournal = new TransactionJournal(10);
const corruptEntry = protectedModel.transaction(0,0,"!","insert");protectedJournal.push(corruptEntry);
corruptEntry.inverse.boundaryState=null;
assert.throws(()=>protectedJournal.undo(protectedModel),/Invalid automatic boundary/);
assert.equal(protectedModel.source,"!text");assert.equal(protectedJournal.index,1,"failed undo keeps the source and history position intact");

// Projection classification stays available to pure history tests.
// Source selection mappings are exercised against real DOM nodes in the engine probes.
window.AmoristInternals.HtmlToMarkdown = {};
window.AmoristInternals.MarkdownCodec = {};
load("web/editor/amorist-editor.js", window);
const helpers = window.__editorTestHelpers;
assert.equal(helpers.projectionLine("# Title").tag, "h1", "headings keep a WYSIWYG projection");
assert.equal(helpers.projectionLine("> quoted").tag, "blockquote", "quotes keep a WYSIWYG projection");
assert.equal(helpers.projectionLine("- item").list, "bullet", "lists keep their visual marker");
assert.equal(helpers.projectionLine("1. item").list, "ordered", "ordered lists keep their visual marker");

console.log("editor-history: transaction journal tests passed");
