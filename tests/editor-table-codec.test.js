const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadClassicScript(path, window = {}) {
  const context = vm.createContext({ window, console, Intl });
  vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path });
  return context.window;
}

function loadTableCodec() {
  const window = loadClassicScript("web/editor/amorist-text-utils.js");
  loadClassicScript("web/editor/amorist-table-codec.js", window);
  return window.AmoristInternals.TableCodec;
}

const codec = loadTableCodec();

assert.deepEqual(Array.from(codec.splitTableRow("| a\\|b | c |")), ["a|b", "c"]);
assert.deepEqual(Array.from(codec.splitTableRow("| 1 | 2 | 3 |", 2)), ["1", "2 | 3"]);
assert.equal(codec.tableCellWidth("abc"), 3);
assert.equal(codec.tableCellWidth("😀"), 2);
assert.equal(codec.tableCellWidth("漢"), 2);
assert.equal(codec.tableCellWidth("e\u0301"), 1);

assert.equal(
  codec.formatMarkdownTable("| A | B |\n|---|---|\n| 1 | 2 |"),
  "| A   | B   |\n| --- | --- |\n| 1   | 2   |",
);

assert.equal(
  codec.formatMarkdownTable("| Name | Align | Center |\n|---|---:|:---:|\n| a | bb | c |"),
  "| Name | Align | Center |\n| ---- | ----: | :----: |\n| a    | bb    | c      |",
);

assert.equal(
  codec.formatMarkdownTable("| Icon | Text |\n|---|---|\n| 😀 | smile |\n| 漢字 | wide |"),
  "| Icon | Text  |\n| ---- | ----- |\n| 😀   | smile |\n| 漢字 | wide  |",
);

assert.equal(
  codec.formatMarkdownTable("| A | B |\n|---|---|\n| a\\|b | c |"),
  "| A    | B   |\n| ---- | --- |\n| a\\|b | c   |",
);

assert.equal(
  codec.formatMarkdownTable("| A | B |\n|---|---|\n| 1 | 2 | 3 |"),
  "| A   | B      |\n| --- | ------ |\n| 1   | 2 \\| 3 |",
);

assert.equal(
  codec.formatMarkdownTable("| A | B | C |\n|---|---|---|\n| 1 | 2 |"),
  "| A   | B   | C   |\n| --- | --- | --- |\n| 1   | 2   |     |",
);

const blankLineTable = [
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "| 3 | 4 |",
];
assert.equal(codec.isTableStart(blankLineTable, 0), true);
assert.equal(codec.nextNonEmptyTableRow(blankLineTable, 3, 2), 4);

const formattedFixture = fs.readFileSync("tests/fixtures/tables.md", "utf8")
  .trim()
  .split("\n\n")
  .map((table) => codec.formatMarkdownTable(table));
formattedFixture.forEach((table) => {
  assert.equal(codec.formatMarkdownTable(table), table);
});

console.log("editor-table-codec.test.js passed");
