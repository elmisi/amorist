"use strict";
const assert = require("node:assert/strict");

module.exports = [{
  id: "REQ-I1", title: "Automatic links retain literal source and exact editable spans",
  async run(ctx) {
    const failures = [], fixturesExercised = [];
    const cases = [
      ["angle URI", "before <https://notes.example/a_b?q=1&n=2> after", [{text: "https://notes.example/a_b?q=1&n=2", href: "https://notes.example/a_b?q=1&n=2"}]],
      ["angle email", "<writer+notes@example.test>", [{text: "writer+notes@example.test", href: "mailto:writer+notes@example.test"}]],
      ["plain URL punctuation", "Visit (https://notes.example/a_(b)).", [{text: "https://notes.example/a_(b)", href: "https://notes.example/a_(b)"}]],
      ["plain www and email", "www.notes.example/a writer@example.test.", [{text: "www.notes.example/a", href: "https://www.notes.example/a"}, {text: "writer@example.test", href: "mailto:writer@example.test"}]],
      ["literal code", "`<https://notes.example>` and ``writer@example.test``", []],
      ["escaped angle", "\\<https://notes.example>", []],
      ["invalid angle", "<https://notes.example/with space>", []],
      ["executable URI", "<javascript:alert(1)> [unsafe](JaVaScRiPt:alert(2))", [{text: "javascript:alert(1)", href: null}, {text: "unsafe", href: null}]],
      ["obfuscated executable URI", "[unsafe](\tjavascript:alert(3))", [{text: "unsafe", href: null}]],
      ["raw HTML literal", "<script>window.documentTextExecuted=true</script>", []],
      ["no nested anchors", "[https://label.example](https://target.example)", [{text: "https://label.example", href: "https://target.example"}]],
    ];
    for (const [name, source, expected] of cases) {
      fixturesExercised.push(name);
      try {
        await ctx.page.open(source);
        const actual = await ctx.page.evaluate(`(() => {
          const surface = document.querySelector('.amorist-editor-surface');
          return {links: Array.from(surface.querySelectorAll('a')).map(a => ({text: a.textContent, href: a.getAttribute('href')})),
            scripts: surface.querySelectorAll('script').length, nested: surface.querySelectorAll('a a').length};
        })()`);
        assert.deepEqual(actual.links, expected);
        assert.equal(actual.scripts, 0); assert.equal(actual.nested, 0);
        assert.equal(await ctx.page.markdown(), source);
        await ctx.page.toggleMode(); await ctx.page.toggleMode();
        assert.equal(await ctx.page.markdown(), source);
      } catch (error) { failures.push({fixture: name, detail: error.message}); }
    }
    const source = "repeat <https://repeat.example/repeat> repeat\r\nnext untouched  \r\n";
    fixturesExercised.push("native caret within repeated autolink with CRLF and undo");
    try {
      await ctx.page.open(source); await ctx.page.focusSurface();
      const caret = "https://".length + 3;
      await ctx.page.evaluate(`(() => {
        const node = document.querySelector('a .amorist-inline-text').firstChild;
        const range = document.createRange(); range.setStart(node, ${caret}); range.collapse(true);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return true;
      })()`);
      await ctx.page.sendKeys(["X"]); await ctx.page.settle();
      const raw = source.indexOf("<") + 1 + caret;
      assert.equal(await ctx.page.markdown(), source.slice(0, raw) + "X" + source.slice(raw));
      await ctx.page.sendKeys([{key: "z", ctrl: true}]); await ctx.page.settle();
      assert.equal(await ctx.page.markdown(), source);
      await ctx.page.toggleMode(); await ctx.page.toggleMode();
      assert.equal(await ctx.page.markdown(), source);
    } catch (error) { failures.push({fixture: "native autolink caret", detail: error.message}); }
    return {failures, fixturesExercised};
  },
}];
