const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadModule() {
  const window = { AmoristInternals: { MarkdownCodec: { serializeBlocks: () => "" } } };
  const context = vm.createContext({ window, console });
  vm.runInContext(fs.readFileSync("web/editor/amorist-text-utils.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("web/editor/amorist-html-to-markdown.js", "utf8"), context, {
    filename: "amorist-html-to-markdown.js",
  });
  return window.AmoristInternals.HtmlToMarkdown;
}

const H = loadModule();

assert.equal(H._isStripped("SCRIPT"), true);
assert.equal(H._isStripped("STYLE"), true);
assert.equal(H._isStripped("P"), false);
assert.equal(H._isUnwrapped("SPAN"), true);
assert.equal(H._isUnwrapped("FONT"), true);
assert.equal(H._isUnwrapped("STRONG"), false);

assert.equal(H._cleanupMarkdown("a\n\n\n\nb\n\n"), "a\n\nb");
assert.equal(H._cleanupMarkdown("   \n\nhi  "), "hi");

// Two trailing spaces are a hard line break, not stray whitespace: stripping
// them would destroy every <br> on the paste path, the one route where pasted
// HTML turns into Markdown.
assert.equal(H._cleanupMarkdown("a  \nb"), "a  \nb");
assert.equal(H._cleanupMarkdown("a   \nb"), "a  \nb");
// A single trailing space carries no meaning, so it is still noise.
assert.equal(H._cleanupMarkdown("a \nb"), "a\nb");
assert.equal(H._cleanupMarkdown("a\t\nb"), "a\nb");
// Whitespace-only lines are blank lines, not breaks.
assert.equal(H._cleanupMarkdown("a\n  \nb"), "a\n\nb");

const code = "first  \n\n\n```nested```\nlast\t\n";
const pre = { nodeType: 1, tagName: "PRE", textContent: code };
const source = H._nodeToSource(pre);
assert.equal(source, "````\n" + code + "````\n\n");
assert.equal(H._cleanupMarkdown(source), "````\n" + code + "````");
assert.equal(H._nodeToSource({ nodeType: 1, tagName: "PRE", textContent: "``````" }),
  "```````\n``````\n```````\n\n");
assert.equal(H._nodeToSource({ nodeType: 1, tagName: "PRE", textContent: "~~~~~" }),
  "``````\n~~~~~\n``````\n\n");

const text=value=>({nodeType:3,textContent:value});
const el=(tag,children,attrs={})=>({nodeType:1,tagName:tag,childNodes:children,children:children.filter(child=>child.nodeType===1),getAttribute:name=>attrs[name]??null});
const nested=el("OL",[
 el("LI",[text("parent"),el("UL",[el("LI",[text("nested")])])]),
 el("LI",[text("explicit")],{value:"12"}),
 el("LI",[text("next")]),
],{start:"5"});
assert.equal(H._cleanupMarkdown(H._nodeToSource(nested)),"5. parent\n   - nested\n12. explicit\n13. next");
assert.equal(H._cleanupMarkdown(H._nodeToSource(el("H2",[text("Title"),el("EM",[text(" styled")])]))),"## Title* styled*");
assert.equal(H._cleanupMarkdown(H._nodeToSource(el("BLOCKQUOTE",[el("P",[text("first")]),el("BLOCKQUOTE",[el("P",[text("nested")])])]))),"> first\n>\n> > nested");
const table=el("TABLE",[]);
const rows=[el("TR",[el("TH",[text("Name")]),el("TH",[text("Note")])]),el("TR",[el("TD",[text("A|B")]),el("TD",[text("value")])])];
rows.forEach(row=>{row.closest=()=>table;});table.querySelectorAll=()=>rows;
assert.equal(H._cleanupMarkdown(H._nodeToSource(table)),"| Name | Note |\n| --- | --- |\n| A\\|B | value |");
const inlineCode=el("CODE",[]);inlineCode.textContent="a``b";
assert.equal(H._nodeToSource(inlineCode),"```a``b```");
inlineCode.textContent="`edge`";assert.equal(H._nodeToSource(inlineCode),"`` `edge` ``");
assert.equal(H._nodeToSource(el("A",[text("Read")],{href:"docs/my (notes).md"})),"[Read](<docs/my (notes).md>)");
assert.equal(H._nodeToSource(text("*literal* [name]")),"\\*literal\\* \\[name\\]");
assert.equal(H._nodeToSource(text("1. literal")),"1\\. literal");
assert.equal(H._nodeToSource(text("- literal")),"\\- literal");
const codeCell=el("CODE",[]);codeCell.textContent="a|b";
rows[1].children[0].childNodes=[codeCell];
assert.equal(H._cleanupMarkdown(H._nodeToSource(table)),"| Name | Note |\n| --- | --- |\n| `a|b` | value |");
console.log("html-to-markdown pure helpers OK");
