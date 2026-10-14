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

module.exports.push({
  id: "REQ-I2", title: "Inline destination grammar and label mapping preserve source",
  async run(ctx) {
    const failures = [], fixturesExercised = [];
    const cases = [
      ["angle destination and named title", '[Read](<docs/caffè λ (v2).md> "Résumé &copy;")', [{text: "Read", href: "docs/caffè λ (v2).md", title: "Résumé ©"}]],
      ["escaped destination and quotes", '[Read](docs/a\\(b\\).md \'A "title"\')', [{text: "Read", href: "docs/a(b).md", title: 'A "title"'}]],
      ["parenthesized title", '[Read](notes_(v2).md (Version two))', [{text: "Read", href: "notes_(v2).md", title: "Version two"}]],
      ["character references", '[Read](?a=1&amp;b=2 "&NotEqualTilde; &#x80;")', [{text: "Read", href: "?a=1&b=2", title: "≂̸ €"}]],
      ["escaped references decode once", '[Read](a\\&copy;.md "\\&copy; &amp;copy; &#92;*")', [{text: "Read", href: "a&copy;.md", title: "&copy; &copy; \\*"}]],
      ["empty destination", '[Read](<> "")', [{text: "Read", href: "", title: ""}]],
      ["invalid destination space", '[Read](docs/my notes.md)', []],
      ["unclosed title", '[Read](notes.md "unclosed)', []],
      ["nested explicit link precedence", '[outer [inner](inside.md)](outside.md)', [{text: "inner", href: "inside.md", title: null}]],
      ["nested angle autolink precedence", '[outer <https://inside.example>](outside.md)', [{text: "https://inside.example", href: "https://inside.example", title: null}]],
      ["code label stays literal", '[`<https://literal.example>`](notes.md "T")', [{text: "<https://literal.example>", href: "notes.md", title: "T"}]],
      ["encoded executable scheme", '[unsafe](javascr&#x69;pt:alert(1))', [{text: "unsafe", href: null, title: null}]],
      ["title is inert metadata", '[Read](notes.md \'" onmouseover="alert(1)\')', [{text: "Read", href: "notes.md", title: '" onmouseover="alert(1)'}]],
      ["escaped pipe in table destination", '| Link | Other |\n| --- | --- |\n| [Read](notes\\|file.md "T") | value |', [{text: "Read", href: "notes|file.md", title: "T"}]],
    ];
    for (const [name, source, expected] of cases) {
      fixturesExercised.push(name);
      try {
        await ctx.page.open(source);
        const actual = await ctx.page.evaluate(`(() => {
          const surface = document.querySelector('.amorist-editor-surface');
          return {links: Array.from(surface.querySelectorAll('a')).map(a => ({text: a.textContent.replace(/\\u200b/g, ''), href: a.getAttribute('href'), title: a.getAttribute('title')})),
            nested: surface.querySelectorAll('a a').length, executable: surface.querySelectorAll('script,[onmouseover]').length};
        })()`);
        assert.deepEqual(actual.links, expected); assert.equal(actual.nested, 0); assert.equal(actual.executable, 0);
        assert.equal(await ctx.page.markdown(), source);
        await ctx.page.toggleMode(); await ctx.page.toggleMode();
        assert.equal(await ctx.page.markdown(), source);
      } catch (error) { failures.push({fixture: name, detail: error.message}); }
    }
    for (const [name, source, selector, offset, raw] of [
      ["styled repeated label", 'same [same 😀 **same**](<notes v2.md> "T") same\r\nuntouched  \r\n', 'a strong .amorist-inline-text', 2, 18],
      ["empty label", '[](<notes.md> "Empty")\r\n', null, 0, 1],
    ]) {
      fixturesExercised.push(name + " native editing/undo");
      try {
        await ctx.page.open(source); await ctx.page.focusSurface();
        if (selector) {
          await ctx.page.evaluate(`(() => {
            const node = document.querySelector(${JSON.stringify(selector)}).firstChild;
            const range = document.createRange(); range.setStart(node, ${offset}); range.collapse(true);
            const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return true;
          })()`);
        } else await ctx.page.setRawSelection(raw, raw);
        await ctx.page.sendKeys(["X"]); await ctx.page.settle();
        assert.equal(await ctx.page.markdown(), source.slice(0, raw) + "X" + source.slice(raw));
        await ctx.page.sendKeys([{key: "z", ctrl: true}]); await ctx.page.settle();
        assert.equal(await ctx.page.markdown(), source);
        await ctx.page.toggleMode(); await ctx.page.toggleMode(); assert.equal(await ctx.page.markdown(), source);
      } catch (error) { failures.push({fixture: name, detail: error.message}); }
    }
    return {failures, fixturesExercised};
  },
});

module.exports.push({
  id: "REQ-I3", title: "Document reference links resolve and remain editable",
  async run(ctx) {
    const failures = [], fixturesExercised = [];
    const cases = [
      ["full/collapsed/shortcut Unicode", '[Read][STRASSE] [Straße][] [STRAẞE]\r\n\r\n[Straße]: notes.md "Title"',
        Array(3).fill({text:"Read", href:"notes.md",title:"Title"}).map((link,i)=>({...link,text:["Read","Straße","STRAẞE"][i]}))],
      ["first definition", '[name]\n\n[NAME]: first.md\n[name]: second.md', [{text:"name",href:"first.md",title:null}]],
      ["whitespace", '[Read][ A\t B ]\n\n[a b]: notes.md', [{text:"Read",href:"notes.md",title:null}]],
      ["unresolved second label suppresses shortcut", '[name][missing]\n\n[name]: notes.md', []],
      ["literal code", '`[name]`\n\n~~~\n[name]: notes.md\n~~~\n\n[name]', []],
      ["escaped syntax", '\\[name]\n\n[name]: notes.md', []],
      ["raw escaped lookup", '[a*b] [a\\*b]\n\n[a\\*b]: notes.md', [{text:"a*b",href:"notes.md",title:null}]],
      ["paragraph interruption", 'ordinary paragraph\n[name]: notes.md\n\n[name]', []],
      ["multiline definition", '[name]:\r\n  <docs/λ.md>\r\n  "first\r\nsecond"\r\n\r\n[name]', [{text:"name",href:"docs/λ.md",title:"first\r\nsecond"}]],
      ["malformed next-line title", '[name]: notes.md\n"unclosed\n\n[name]', [{text:"name",href:"notes.md",title:null}]],
      ["unsafe decoded destination", '[name]\n\n[name]: javascr&#x69;pt:alert(1)', [{text:"name",href:null,title:null}]],
      ["nested reference precedence", '[outer [inner]][name]\n\n[inner]: inside.md\n[name]: outside.md', [{text:"inner",href:"inside.md",title:null},{text:"name",href:"outside.md",title:null}]],
    ];
    for (const [name, source, expected] of cases) {
      fixturesExercised.push(name);
      try {
        await ctx.page.open(source);
        const actual = await ctx.page.evaluate(`(() => {
          const surface = document.querySelector('.amorist-editor-surface');
          return {links:Array.from(surface.querySelectorAll('a')).map(a=>({text:a.textContent,href:a.getAttribute('href'),title:a.getAttribute('title')})),nested:surface.querySelectorAll('a a').length};
        })()`);
        assert.deepEqual(actual.links, expected); assert.equal(actual.nested, 0);
        assert.equal(await ctx.page.markdown(), source);
        await ctx.page.toggleMode(); await ctx.page.toggleMode();
        assert.equal(await ctx.page.markdown(), source);
      } catch (error) { failures.push({fixture:name,detail:error.message}); }
    }
    const source = '[Read][name]\r\n\r\n| Link | Note |\r\n| --- | --- |\r\n| [name] | stable |\r\n\r\n[name]: old.md "Title"\r\n\r\nuntouched tail';
    fixturesExercised.push('native destination/label edits, table dependencies and undo');
    try {
      await ctx.page.open(source); await ctx.page.focusSurface();
      await ctx.page.evaluate(`(() => { window.__referenceGateTail = document.querySelector('.amorist-editor-surface').lastElementChild; return true; })()`);
      const at = source.indexOf('old.md');
      await ctx.page.setRawSelection(at, at+3);
      await ctx.page.sendKeys(['n']); await ctx.page.settle();
      assert.equal(await ctx.page.markdown(), source.slice(0,at)+'n'+source.slice(at+3));
      const updated = await ctx.page.evaluate(`(() => {
        const surface = document.querySelector('.amorist-editor-surface');
        return {destinations:Array.from(surface.querySelectorAll('a')).map(a=>a.dataset.linkDestination),tailSame:surface.lastElementChild===window.__referenceGateTail};
      })()`);
      assert.deepEqual(updated, {destinations:['n.md','n.md'],tailSame:true});
      await ctx.page.sendKeys([{key:'z',ctrl:true}]); await ctx.page.settle();
      assert.equal(await ctx.page.markdown(), source);
      assert.deepEqual(await ctx.page.evaluate("Array.from(document.querySelectorAll('.amorist-editor-surface a')).map(a=>a.dataset.linkDestination)"), ['old.md','old.md']);
      await ctx.page.evaluate(`(() => {
        const node = document.querySelector('.amorist-editor-surface a .amorist-inline-text').firstChild;
        const range = document.createRange(); range.setStart(node,2); range.collapse(true);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return true;
      })()`);
      await ctx.page.sendKeys(['X']); await ctx.page.settle();
      assert.equal(await ctx.page.markdown(), source.slice(0,3)+'X'+source.slice(3));
      await ctx.page.sendKeys([{key:'z',ctrl:true}]); await ctx.page.settle();
      assert.equal(await ctx.page.markdown(), source);
      await ctx.page.toggleMode(); await ctx.page.toggleMode(); assert.equal(await ctx.page.markdown(), source);
    } catch (error) { failures.push({fixture:'native reference edits',detail:error.message}); }
    return {failures, fixturesExercised};
  },
});
