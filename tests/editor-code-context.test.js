"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveEngines } = require("./qa/lib/engines");
const { startStaticServer } = require("./qa/lib/server");

async function main() {
  const entries = resolveEngines().filter((entry) => entry.applicable);
  assert.ok(entries.length, "No applicable engine declared for this platform");
  const server = await startStaticServer(path.resolve(__dirname, ".."));
  const original = "before\r\n````js\r\n# literal heading\r\n1. literal number\r\n- [x] task\r\n> quote\r\n\r\n```\r\nend\r\n````\r\nafter";
  try {
    for (const entry of entries) {
      assert.ok(entry.available, entry.reason);
      const engine = entry.create();
      try {
        await engine.start();
        await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);
        await engine.evaluate(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/web/settings.js';script.onload=()=>resolve(true);script.onerror=reject;document.body.append(script);})`);
        // The driver may finish before WebKit delivers its final input event.
        const sendKeys = async sequence => {
          await engine.sendKeys(sequence);
          await new Promise(resolve => setTimeout(resolve, 60));
        };
        const opening = await engine.evaluate(`(() => {
          const host = document.getElementById("host");
          const editor = window.__codeRegression = window.AmoristEditor.create(host, {value: ${JSON.stringify(original)}});
          const rows = Array.from(host.querySelectorAll(".amorist-source-line"));
          return { source: editor.getMarkdown(),
            codeRows: rows.filter(row => row.classList.contains("amorist-wysiwyg-code")).map(row => ({
              text: row.textContent, prefix: row.dataset.prefix,
              classes: row.className, height: row.getBoundingClientRect().height })),
            fences: rows.filter(row => row.classList.contains("amorist-wysiwyg-fence")).map(row => row.getBoundingClientRect().height) };
        })()`);
        assert.equal(opening.source, original);
        assert.equal(opening.codeRows.length, 7, `${entry.id}: every physical code content line remains`);
        for (const row of opening.codeRows) {
          assert.equal(row.prefix, "0");
          assert.doesNotMatch(row.classes, /wysiwyg-(h[1-6]|list|quote|task|fence)/);
        }
        assert.equal(opening.fences.length, 2);
        assert.ok(opening.fences.every(height => height === 0), `${entry.id}: hidden fences add no height`);
        assert.ok(opening.codeRows[4].height > 0, `${entry.id}: original blank code line is visible`);

        const at = original.indexOf("# literal heading");
        await engine.evaluate(`(() => { window.__codeRegression.focus(); window.__codeRegression.setSurfaceSelection(${at}, ${at}); return true; })()`);
        await sendKeys([{ key: "Backspace" }]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), original.slice(0, at - 2) + original.slice(at), `${entry.id}: code Backspace joins physical lines without stripping markers`);
        await engine.evaluate("(() => { window.__codeRegression.undo(); return true; })()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), original);

        const end = at + "# literal heading".length;
        await engine.evaluate(`(() => { window.__codeRegression.focus(); window.__codeRegression.setSurfaceSelection(${end}, ${end}); return true; })()`);
        await sendKeys([{ key: "Enter" }]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), original.slice(0, end) + "\r\n" + original.slice(end));
        await engine.evaluate("(() => { window.__codeRegression.undo(); window.__codeRegression.showSourceMode(); window.__codeRegression.showWysiwygMode(); return true; })()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), original);
        for (const [body, fence] of [
          ["alpha```middle``````omega", "```````"],
          ["alpha~~~~~omega", "``````"],
          ["```\n# original literal\n```", "````"],
        ]) {
          const source = "before\r\n" + body.replace(/\n/g, "\r\n") + "\r\nafter";
          const wrapped = await engine.evaluate(`(() => {
            const editor = window.__codeRegression;
            editor.setMarkdown(${JSON.stringify(source)});
            editor.showSourceMode();
            editor.source.setSelectionRange(7, 7 + ${JSON.stringify(body)}.length);
            editor.toolbar.querySelector('[data-action="codeblock"]').click();
            return editor.getMarkdown();
          })()`);
          assert.equal(wrapped, "before\r\n" + fence + "\r\n" + body.replace(/\n/g, "\r\n") + "\r\n" + fence + "\r\nafter",
            `${entry.id}: safe generated fence preserves selected content and external bytes`);
          await engine.evaluate("(() => { window.__codeRegression.undo(); return true; })()");
          assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), source);
        }
        const converted = await engine.evaluate(`window.AmoristInternals.HtmlToMarkdown.convert(
          "<pre><code>first  \\n\\n\\n&#96;&#96;&#96;nested&#96;&#96;&#96;\\nlast\\t\\n</code></pre>")`);
        assert.equal(converted, "````\nfirst  \n\n\n```nested```\nlast\t\n````",
          `${entry.id}: HTML PRE keeps whitespace and uses safe fences`);
        const identical = "```\nfirst\n```\n# outside\n```\nlast\n```";
        const interpretation = await engine.evaluate(`(() => {
          const editor = window.__codeRegression;
          editor.setMarkdown(${JSON.stringify(identical)});
          return { source: editor.getMarkdown(),
            blocks: editor.surface.querySelectorAll(".amorist-wysiwyg-code-block").length,
            heading: editor.surface.querySelector(".amorist-wysiwyg-h1").textContent.trim() };
        })()`);
        assert.deepEqual(interpretation, { source: identical, blocks: 2, heading: "outside" },
          `${entry.id}: an identical delimiter closes existing code; opening never rewrites it`);
        const table = "before\r\n| Left | Right |\r\n| --- | --- |\r\n| `a|b` | c\\|d |\r\nafter";
        const cells = await engine.evaluate(`(() => {
          const editor = window.__codeRegression; editor.setMarkdown(${JSON.stringify(table)});
          const row = editor.surface.querySelectorAll('.amorist-wysiwyg-table')[2];
          return {source:editor.getMarkdown(),cells:row.querySelectorAll('.amorist-wysiwyg-table-cell').length,
            code:row.querySelector('code').textContent};
        })()`);
        assert.deepEqual(cells, {source:table,cells:4,code:"a|b"},
          `${entry.id}: code and escaped pipes stay inside their cells`);
        const codeAt = table.indexOf("a|b") + 2;
        await engine.evaluate(`(() => {window.__codeRegression.focus();window.__codeRegression.setSurfaceSelection(${codeAt},${codeAt});return true;})()`);
        await sendKeys(["x"]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), table.slice(0,codeAt)+"x"+table.slice(codeAt),
          `${entry.id}: editing code in a table preserves surrounding delimiters and bytes`);
        await engine.evaluate("(() => {window.__codeRegression.undo();window.__codeRegression.showSourceMode();window.__codeRegression.showWysiwygMode();return true;})()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),table);
        for (const [source, selector, caret, rawCaret] of [
          ["same **same** same", "strong .amorist-inline-text", 2, 9],
          ["same \\*same\\* same", '.amorist-inline-text[data-inline-start="5"]', 1, 7],
          ["same \\*same\\* same", '.amorist-inline-text[data-inline-start="5"]', 0, 5],
          ["same ``same`same`` same", "code", 5, 12],
          ["same __same__ same", "strong .amorist-inline-text", 2, 9],
          ["same ~~same~~ same", "del .amorist-inline-text", 2, 9],
        ]) {
          await engine.evaluate(`(() => {
            const editor=window.__codeRegression; editor.setMarkdown(${JSON.stringify(source)});
            const node=editor.surface.querySelector(${JSON.stringify(selector)}).firstChild;
            const range=document.createRange();range.setStart(node,${caret});range.collapse(true);
            editor.focus();const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
            return true;
          })()`);
          await sendKeys(["X"]);
          assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),source.slice(0,rawCaret)+"X"+source.slice(rawCaret),
            `${entry.id}: DOM caret uses exact source span for ${source}`);
          await engine.evaluate("(() => {window.__codeRegression.undo();return true;})()");
          assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),source);
        }
        const terminal = "same ``same`same``";
        await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(terminal)});editor.focus();editor.setSurfaceSelection(${terminal.length},${terminal.length});return true;})()`);
        await sendKeys(["X"]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),terminal+"X", `${entry.id}: end-of-row caret stays outside closing code delimiter`);
        const shifted = "first\r\nsame **same** same";
        await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(shifted)});window.__mappedRow=editor.surface.querySelectorAll('.amorist-source-line')[1];editor.focus();editor.setSurfaceSelection(3,3);return true;})()`);
        await sendKeys(["X"]);
        const shiftedCaret = await engine.evaluate(`(() => {
          const editor=window.__codeRegression;
          const row=editor.surface.querySelectorAll('.amorist-source-line')[1];
          const node=row.querySelector('strong .amorist-inline-text').firstChild;
          const range=document.createRange();range.setStart(node,2);range.collapse(true);
          const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
          return row===window.__mappedRow;
        })()`);
        assert.equal(shiftedCaret,true,`${entry.id}: earlier typing preserves later row DOM`);
        await sendKeys(["Y"]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), "firXst\r\nsame **saYme** same",
          `${entry.id}: preserved later row uses updated source base`);
        const boundaries = "prefix\r\n| Left | Right |\r\n| --- | --- |\r\n| same | `same|same` |\r\n\r\n```\r\nsame **same**\r\n```\r\n# \r\n- [ ] \r\nlast **same**";
        const offsets = [0, 6, 8, boundaries.indexOf("| same"), boundaries.indexOf("| same")+2,
          boundaries.indexOf("same|same")+4, boundaries.indexOf("\r\n\r\n")+2,
          boundaries.indexOf("same **same**"), boundaries.indexOf("same **same**")+6,
          boundaries.indexOf("# ")+2, boundaries.indexOf("- [ ] ")+6, boundaries.length];
        const roundTrip = await engine.evaluate(`(() => {
          const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(boundaries)});
          return ${JSON.stringify(offsets)}.map(offset => {editor.setSurfaceSelection(offset,offset);return editor.selectionRaw();});
        })()`);
        assert.deepEqual(roundTrip, offsets.map(offset=>({start:offset,end:offset})),
          `${entry.id}: explicit mappings cover pipes, literal code, empty rows and CRLF boundaries`);
        for (const [side, at] of [["before",5],["after",13]]) {
          const source="same **same** same";
          await engine.evaluate(`(() => {
            const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(source)});editor.focus();
            const strong=editor.surface.querySelector('strong');const range=document.createRange();
            range.${side === "before" ? "setStartBefore" : "setStartAfter"}(strong);range.collapse(true);
            const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return true;
          })()`);
          await sendKeys(["X"]);
          assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),source.slice(0,at)+"X"+source.slice(at),
            `${entry.id}: element boundary ${side} emphasis is outside its delimiters`);
        }
        await engine.evaluate("(() => {const editor=window.__codeRegression;editor.setMarkdown('# title\\n- item');editor.focus();return true;})()");
        await sendKeys([{key:"a",ctrl:process.platform!=="darwin",meta:process.platform==="darwin"}]);
        assert.deepEqual(await engine.evaluate("window.__codeRegression.selectionRaw()"),{start:0,end:14},
          `${entry.id}: native Select All reaches both document boundaries`);
        await sendKeys(["Z"]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),"Z",
          `${entry.id}: native Select All includes the first hidden structural prefix`);
        const blocks = "First title\r\n===\r\n\r\nSecond title\r\n---\r\n\r\n    # literal\r\n    1. literal\r\n\r\n    **literal**\r\n\r\nparagraph\r\n    continuation\r\n\r\n- list\r\n  continuation";
        const classification = await engine.evaluate(`(() => {
          const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(blocks)});
          return {source:editor.getMarkdown(),headings:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-h1,.amorist-wysiwyg-h2')).map(row=>row.textContent.trim()),
            delimiterHeights:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-setext-delimiter')).map(row=>row.getBoundingClientRect().height),
            codeRows:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-code')).map(row=>({prefix:row.dataset.prefix,text:row.textContent,classes:row.className,bold:!!row.querySelector('strong')})),
            blocks:editor.surface.querySelectorAll('.amorist-wysiwyg-code-block').length};
        })()`);
        assert.equal(classification.source,blocks);
        assert.deepEqual(classification.headings,["First title","Second title"]);
        assert.deepEqual(classification.delimiterHeights,[0,0]);
        const changedLevel=await engine.evaluate(`(() => {
          const editor=window.__codeRegression;editor.apply(${blocks.indexOf("===")},${blocks.indexOf("===")+3},'---','replace-underlining');
          return Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-h2')).map(row=>row.textContent.trim());
        })()`);
        assert.deepEqual(changedLevel,["First title","Second title"],`${entry.id}: changing underline level updates its dependent title row`);
        await engine.evaluate("(() => {window.__codeRegression.undo();return true;})()");
        assert.equal(classification.blocks,1,`${entry.id}: indented code does not interrupt prose or swallow list continuation`);
        assert.equal(classification.codeRows.length,4,`${entry.id}: genuine blank row remains inside indented code`);
        for (const row of classification.codeRows) {
          assert.equal(row.prefix,"0"); assert.equal(row.bold,false);
          assert.doesNotMatch(row.classes,/wysiwyg-(h[1-6]|list|quote|task|fence)/);
        }
        await engine.evaluate("(() => {const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(5,5);return true;})()");
        await sendKeys(["X"]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),blocks.slice(0,5)+"X"+blocks.slice(5),`${entry.id}: editing setext title preserves its underline and other blocks`);
        await engine.evaluate("(() => {const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),blocks);
        const indentedEnd=blocks.indexOf("# literal")+"# literal".length;
        await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(${indentedEnd},${indentedEnd});return true;})()`);
        await sendKeys([{key:"Enter"}]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),blocks.slice(0,indentedEnd)+"\r\n    "+blocks.slice(indentedEnd),`${entry.id}: indented code Enter keeps indentation and CRLF`);
        await engine.evaluate("(() => {const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),blocks);
        const metadata="---\r\n# literal heading\r\n- literal list\r\n**literal emphasis**\r\n---\r\nafter";
        const metadataView=await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(metadata)});return {source:editor.getMarkdown(),text:editor.surface.textContent,heading:!!editor.surface.querySelector('.amorist-wysiwyg-h1'),list:!!editor.surface.querySelector('.amorist-wysiwyg-list-item'),bold:!!editor.surface.querySelector('strong')};})()`);
        assert.deepEqual(metadataView,{source:metadata,text:metadata.replace(/\r\n/g,"\n"),heading:false,list:false,bold:false},`${entry.id}: metadata stays visible literal source`);
        const metadataEnd=metadata.indexOf("- literal list")+"- literal list".length;
        await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(${metadataEnd},${metadataEnd});return true;})()`);
        await sendKeys([{key:"Enter"}]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),metadata.slice(0,metadataEnd)+"\r\n"+metadata.slice(metadataEnd),`${entry.id}: metadata Enter never continues a Markdown list marker`);
        await engine.evaluate("(() => {const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),metadata);
        for (const ending of ["\r\n","\r"]) {
          const source="```"+ending+"literal";
          await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(source)});editor.focus();editor.setSurfaceSelection(${source.length},${source.length});return true;})()`);
          await sendKeys([{key:"Enter"}]);
          assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),source+ending,
            `${entry.id}: code Enter at unterminated EOF inherits the last physical terminator`);
          await engine.evaluate("(() => {window.__codeRegression.undo();return true;})()");
          assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),source);
        }
        for (const nested of [
          '123. item\r\n     ````js\r\n     # literal **bold**\r\n     ```\r\n     ````\r\n124. next',
          '- item\r\n\r\n      # literal **bold**\r\n\r\n      - literal task\r\n- next',
        ]) {
          const view=await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(nested)});return {source:editor.getMarkdown(),code:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-code')).map(row=>({text:row.textContent,classes:row.className,bold:!!row.querySelector('strong')})),fences:editor.surface.querySelectorAll('.amorist-wysiwyg-fence').length};})()`);
          assert.equal(view.source,nested);
          assert.ok(view.code.some(row=>row.text.includes('# literal **bold**')),`${entry.id}: code inside list item is literal`);
          assert.ok(view.code.every(row=>!row.text.includes('next')),`${entry.id}: code does not consume the neighboring item`);
          for(const row of view.code){assert.equal(row.bold,false);assert.doesNotMatch(row.classes,/wysiwyg-(h[1-6]|list|quote|task|fence)/);}
          assert.equal(view.fences,nested.includes('````')?2:0);
          const end=nested.indexOf('# literal **bold**')+'# literal **bold**'.length;
          await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(${end},${end});return true;})()`);
          await sendKeys(['X']);assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),nested.slice(0,end)+'X'+nested.slice(end));
          await engine.evaluate('(() => {const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()');
          assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),nested);
          await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(${end},${end});return true;})()`);
          await sendKeys([{key:'Enter'}]);
          const indentation=nested.slice(nested.lastIndexOf('\n',end)+1,end).match(/^ */)[0];
          assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),nested.slice(0,end)+'\r\n'+indentation+nested.slice(end),`${entry.id}: code Enter retains container indentation without inline markers`);
          await engine.evaluate('(() => {const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()');
          assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),nested);
        }
        for(const prefix of ['> ', '> > ']) {
          const quoted=[prefix+'````js',prefix+'# literal **bold**',prefix,prefix+'```',prefix+'````','outside'].join('\r\n');
          const view=await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(quoted)});return {source:editor.getMarkdown(),rows:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-code')).map(row=>({text:row.textContent,styled:!!row.querySelector('strong,h1'),classes:row.className})),fences:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-fence')).map(row=>row.getBoundingClientRect().height)};})()`);
          assert.equal(view.source,quoted);assert.equal(view.rows.length,3,`${entry.id}: quoted code physical rows`);
          assert.equal(view.rows[0].text.replace(/\n$/, ''),'# literal **bold**');assert.equal(view.rows[2].text.replace(/\n$/, ''),'```');
          assert.ok(view.rows.every(row=>!row.styled&&!/wysiwyg-(h[1-6]|list|quote|task)/.test(row.classes)));
          assert.deepEqual(view.fences,[0,0]);
          const at=quoted.indexOf('# literal **bold**')+'# literal **bold**'.length;
          await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(${at},${at});return true;})()`);
          await sendKeys([{key:'Enter'}]);assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),quoted.slice(0,at)+'\r\n'+prefix+quoted.slice(at));
          await engine.evaluate('(() => {const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()');
          assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),quoted);
          const indented=[prefix+'prose',prefix,prefix+'    # literal **bold**',prefix,prefix+'    - [x] literal task','outside'].join('\r\n');
          const indentedView=await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(indented)});return {source:editor.getMarkdown(),rows:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-code')).map(row=>({text:row.textContent,styled:!!row.querySelector('strong'),classes:row.className}))};})()`);
          assert.equal(indentedView.source,indented);assert.equal(indentedView.rows.length,3,`${entry.id}: indented code inside quote`);
          assert.equal(indentedView.rows[0].text.replace(/\n$/, ''),'    # literal **bold**');assert.ok(indentedView.rows.every(row=>!row.styled&&!/wysiwyg-(h[1-6]|list|quote|task)/.test(row.classes)));
          const indentAt=indented.indexOf('# literal **bold**')+'# literal **bold**'.length;
          await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(${indentAt},${indentAt});return true;})()`);
          await sendKeys([{key:'Enter'}]);assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),indented.slice(0,indentAt)+'\r\n'+prefix+'    '+indented.slice(indentAt));
          await engine.evaluate('(() => {const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()');
          assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),indented);
          const continued=prefix+'prose\r\n'+prefix+'    continued **bold**\r\noutside';
          const continuedView=await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(continued)});return {source:editor.getMarkdown(),code:editor.surface.querySelectorAll('.amorist-wysiwyg-code').length,bold:!!editor.surface.querySelector('strong')};})()`);
          assert.deepEqual(continuedView,{source:continued,code:0,bold:true},`${entry.id}: indented continuation cannot interrupt quoted prose with code`);
        }
        for(const [marker,indent,quote] of [['- ','  ','> '],['123. ','     ','> '],['- parent\r\n  123. ','       ','> > '],['- ','\t','> '],['- parent\r\n  123. ','\t\t','> > ']]) {
          const prefix=indent+quote,source=[marker+'item',prefix+'````js',prefix+'# literal **bold**',prefix,prefix+'```',prefix+'````',indent+'continuation','- sibling'].join('\r\n');
          const view=await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(source)});return {source:editor.getMarkdown(),rows:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-code')).map(row=>row.textContent.replace(/\\n$/,'')),continuation:editor.lineDescriptors.find(row=>row.raw.trim()==='continuation').listOwner?.index};})()`);
          assert.equal(view.source,source);assert.equal(view.rows.length,3,`${entry.id}: fenced code in quote within list`);assert.equal(view.rows[0],'# literal **bold**');assert.equal(view.rows[2],'```');assert.equal(view.continuation,marker.includes('\r\n')?1:0);
          const at=source.indexOf('# literal **bold**')+'# literal **bold**'.length;
          await engine.evaluate(`(() => {const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(${at},${at});return true;})()`);await sendKeys([{key:'Enter'}]);assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),source.slice(0,at)+'\r\n'+prefix+source.slice(at));
          await engine.evaluate('(() => {const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()');assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),source);
        }
        for(const [quote,marker,indent] of [['> ','- ','  '],['> > ','123. ','     ']]){
          for(const indented of [false,true]){
            const prefix=quote+indent;
            const rows=indented?[quote+marker+'item',quote,prefix+'    # literal **bold**',quote,prefix+'    - [x] literal task',quote+marker+'sibling']
              :[quote+marker+'item',quote,prefix+'````js',prefix+'# literal **bold**',prefix,prefix+'```',prefix+'````',quote+marker+'sibling'];
            const source=rows.join('\r\n');
            const view=await engine.evaluate(`(()=>{const editor=window.__codeRegression;editor.setMarkdown(${JSON.stringify(source)});return {source:editor.getMarkdown(),rows:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-code')).map(row=>({text:row.textContent.replace(/\\n$/,''),styled:!!row.querySelector('strong'),owner:editor.lineDescriptors[Number(row.dataset.line)].listOwner?.index})),fences:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-fence')).map(row=>row.getBoundingClientRect().height)};})()`);
            assert.equal(view.source,source);assert.equal(view.rows.length,3,entry.id+': code inside quoted list');assert.equal(view.rows[0].text,(indented?'    ':'')+'# literal **bold**');assert.ok(view.rows.every(row=>!row.styled&&row.owner===0));assert.ok(view.fences.every(height=>height===0));
            const at=source.indexOf('# literal **bold**')+'# literal **bold**'.length;
            await engine.evaluate(`(()=>{const editor=window.__codeRegression;editor.focus();editor.setSurfaceSelection(${at},${at});return true;})()`);await sendKeys([{key:'Enter'}]);assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),source.slice(0,at)+'\r\n'+prefix+(indented?'    ':'')+source.slice(at));
            await engine.evaluate('(()=>{const editor=window.__codeRegression;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()');assert.equal(await engine.evaluate('window.__codeRegression.getMarkdown()'),source);
            const fragment=await engine.evaluate(`window.__codeRegression.clipboardFragment({start:${source.indexOf('# literal **bold**')},end:${at}})`);
            assert.equal(fragment,quote+'```'+(indented?'':'js')+'\r\n'+quote+'# literal **bold**\r\n'+quote+'```',entry.id+': quoted list code clipboard strips outer list indentation');
            const geometry=await engine.evaluate(`(()=>{const editor=window.__codeRegression,owner=editor.rowNodes[0],row=editor.surface.querySelector('.amorist-wysiwyg-code'),block=row.parentElement;return {padding:parseFloat(getComputedStyle(owner).paddingLeft),codeLeft:row.getBoundingClientRect().left-owner.getBoundingClientRect().left,background:getComputedStyle(block).backgroundImage};})()`);
            assert.ok(Math.abs(geometry.padding-geometry.codeLeft)<1,entry.id+': code aligns with quoted list content '+JSON.stringify(geometry));assert.notEqual(geometry.background,'none');
            for(const [baseFontSize,codeScale] of [[12,.75],[24,1.5]]){
              const scaled=await engine.evaluate(`(()=>{const editor=window.__codeRegression;editor.applySettings({...window.AmoristSettings.defaults,baseFontSize:${baseFontSize},codeScale:${codeScale}});const owner=editor.rowNodes[0],row=editor.surface.querySelector('.amorist-wysiwyg-code');return {source:editor.getMarkdown(),padding:parseFloat(getComputedStyle(owner).paddingLeft),left:row.getBoundingClientRect().left-owner.getBoundingClientRect().left,font:parseFloat(getComputedStyle(row).fontSize)};})()`);
              assert.equal(scaled.source,source);assert.equal(scaled.font,baseFontSize*codeScale);assert.ok(Math.abs(scaled.padding-scaled.left)<1,entry.id+': quoted list code alignment with independent font scales '+JSON.stringify(scaled));
            }
            await engine.evaluate('(()=>{window.__codeRegression.applySettings(window.AmoristSettings.defaults);return true;})()');
          }
        }
        console.log(`code-context: ${entry.id} passed`);
      } finally { await engine.close(); }
    }
  } finally { await server.stop(); }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
