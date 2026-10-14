'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {resolveEngines} = require('./qa/lib/engines');
const {startStaticServer} = require('./qa/lib/server');
async function main() {
  const server = await startStaticServer(path.resolve(__dirname,'..'));
  const source='# Heading\r\nText 😀 repeat\r\n\r\n| A | B |\r\n| --- | --- |\r\n| left | right |\r\n\r\n```\r\ncode\r\n```';
  try {
    for(const entry of resolveEngines().filter(entry=>entry.applicable)) {
      assert.ok(entry.available,entry.reason);
      const engine=entry.create();
      try {
        await engine.start(); await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);
        await engine.evaluate(`(() => {
          window.__prefsEditor=window.AmoristEditor.create(document.getElementById('host'),{value:${JSON.stringify(source)}});
          const button=document.createElement('button'); button.id='settings-button'; document.body.append(button);
          const css=document.createElement('link'); css.rel='stylesheet'; css.href='/web/app.css'; document.head.append(css);
          return true;
        })()`);
        await engine.evaluate(`new Promise((resolve,reject)=>{ const script=document.createElement('script'); script.src='/web/settings.js'; script.onload=()=>resolve(true); script.onerror=reject; document.body.append(script); })`);
        await engine.evaluate(`(() => {
          window.__prefsStore={...window.AmoristSettings.defaults}; window.__prefsFail=false; window.__prefsWrites=0;
          window.__prefs=window.AmoristSettings.create({getEditor:()=>window.__prefsEditor, warning:()=>{}, invoke:async(command,args)=> {
            if(command==='load_settings') return {settings:{...window.__prefsStore},warning:null};
            if(window.__prefsFail) throw new Error('denied settings write');
            window.__prefsStore={...args.settings}; window.__prefsWrites++; return {...args.settings};
          }}); return true;
        })()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        const changed=await engine.evaluate(`(() => {
          const editor=window.__prefsEditor; editor.focus(); editor.setSurfaceSelection(14,18);
          editor.applySettings({...window.AmoristSettings.defaults,baseFontSize:24,tableScale:1.5,codeScale:.75});
          return {source:editor.getMarkdown(),selection:editor.selectionRaw(),font:getComputedStyle(editor.surface.querySelector('.amorist-source-line')).fontSize,
            table:getComputedStyle(editor.surface.querySelector('.amorist-wysiwyg-table')).fontSize, code:getComputedStyle(editor.surface.querySelector('.amorist-wysiwyg-code')).fontSize,
            toolbar:getComputedStyle(editor.toolbar.querySelector('button')).fontSize};
        })()`);
        assert.equal(changed.source,source); assert.deepEqual(changed.selection,{start:14,end:18});
        assert.equal(changed.font,'48px'); assert.equal(changed.table,'36px'); assert.equal(changed.code,'18px'); assert.equal(changed.toolbar,'14px');
        const sourceMode=await engine.evaluate(`(() => {const editor=window.__prefsEditor;editor.showSourceMode();return {font:getComputedStyle(editor.source).fontSize,source:editor.getMarkdown()};})()`);
        assert.deepEqual(sourceMode,{font:'24px',source});
        await engine.evaluate(`(() => {document.getElementById('settings-button').click(); const form=document.getElementById('settings-form');form.elements.baseFontSize.value=22;form.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
        const preview=await engine.evaluate(`({mainFont:getComputedStyle(window.__prefsEditor.source).fontSize,previewFont:getComputedStyle(document.querySelector('#settings-preview .amorist-source-line')).fontSize,writes:window.__prefsWrites})`);
        assert.deepEqual(preview,{mainFont:'24px',previewFont:'44px',writes:0});
        await engine.evaluate(`(() => {document.querySelector('[data-settings="cancel"]').click();return true;})()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(await engine.evaluate('window.__prefsWrites'),0);
        await engine.evaluate(`(() => {document.getElementById('settings-button').click();const form=document.getElementById('settings-form');form.elements.baseFontSize.value=20;window.__prefsFail=true;form.requestSubmit();return true;})()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.deepEqual(await engine.evaluate(`({open:document.getElementById('settings-dialog').open,error:document.getElementById('settings-error').textContent,writes:window.__prefsWrites,font:getComputedStyle(window.__prefsEditor.source).fontSize})`),{open:true,error:'denied settings write',writes:0,font:'16px'});
        await engine.evaluate(`(() => {window.__prefsFail=false;document.getElementById('settings-form').requestSubmit();return true;})()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.deepEqual(await engine.evaluate(`({open:document.getElementById('settings-dialog').open,writes:window.__prefsWrites,font:getComputedStyle(window.__prefsEditor.source).fontSize,source:window.__prefsEditor.getMarkdown()})`),{open:false,writes:1,font:'20px',source});
        await engine.evaluate(`(() => {window.__prefsStore.baseFontSize=18;window.dispatchEvent(new Event('focus'));return true;})()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(await engine.evaluate('getComputedStyle(window.__prefsEditor.source).fontSize'),'18px');

        const wrappedSource = 'word '.repeat(90)+'\r\nsecond physical line';
        await engine.evaluate(`(() => {
          const editor=window.__prefsEditor;editor.setMarkdown(${JSON.stringify(wrappedSource)});
          editor.root.style.width='350px';editor.showWysiwygMode();editor.focus();
          editor.applySettings({...window.AmoristSettings.defaults,highlightCurrentLine:true,highlightColor:'#e8f2ff'});
          editor.setSurfaceSelection(65,65);window.scrollTo(0,0);return true;
        })()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        const wrapped=await engine.evaluate(`(() => {
          const editor=window.__prefsEditor, overlay=editor.currentLine, selection=window.getSelection();
          const range=document.createRange();range.setStart(selection.focusNode,selection.focusOffset);range.collapse(true);
          const rect=range.getBoundingClientRect(),box=overlay.getBoundingClientRect();
          return {hidden:overlay.hidden,top:box.top,bottom:box.bottom,caretTop:rect.top,caretBottom:rect.bottom,
            rowHeight:editor.surface.querySelector('.amorist-source-line').getBoundingClientRect().height,height:box.height,
            color:getComputedStyle(overlay).backgroundColor,source:editor.getMarkdown(),count:editor.root.querySelectorAll('.amorist-current-line').length};
        })()`);
        assert.equal(wrapped.hidden,false);assert.equal(wrapped.count,1);assert.equal(wrapped.color,'rgb(232, 242, 255)');
        assert.ok(wrapped.height<wrapped.rowHeight/2,`${entry.id}: only one soft-wrapped visual line`);
        assert.ok(wrapped.top<=wrapped.caretTop+1 && wrapped.bottom>=wrapped.caretBottom-1,`${entry.id}: caret lies within overlay`);
        assert.equal(wrapped.source,wrappedSource);
        await engine.evaluate(`(() => {
          const node=document.querySelector('.amorist-editor-surface .amorist-inline-text').firstChild;
          window.getSelection().setBaseAndExtent(node,80,node,5);return true;
        })()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        const backward=await engine.evaluate(`(() => {
          const editor=window.__prefsEditor,selection=window.getSelection(),range=document.createRange();
          range.setStart(selection.focusNode,selection.focusOffset);range.collapse(true);
          return {top:editor.currentLine.getBoundingClientRect().top,caret:range.getBoundingClientRect().top,offset:selection.focusOffset};
        })()`);
        assert.equal(backward.offset,5);assert.ok(Math.abs(backward.top-backward.caret)<10);
        await engine.evaluate(`(() => {document.getElementById('settings-button').focus();return true;})()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(await engine.evaluate('window.__prefsEditor.currentLine.hidden'),true);
        await engine.evaluate(`(() => {
          const editor=window.__prefsEditor;editor.showSourceMode();editor.focus();
          editor.source.setSelectionRange(0,editor.source.value.length,'backward');
          editor.source.dispatchEvent(new Event('select'));editor.scheduleCurrentLine();return true;
        })()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        const physical=await engine.evaluate(`(() => {
          const editor=window.__prefsEditor,box=editor.source.getBoundingClientRect(),style=getComputedStyle(editor.source);
          return {hidden:editor.currentLine.hidden,top:editor.currentLine.getBoundingClientRect().top,
            expected:box.top+editor.source.clientTop+parseFloat(style.paddingTop)-editor.source.scrollTop,height:editor.currentLine.getBoundingClientRect().height,lineHeight:parseFloat(style.lineHeight),source:editor.getMarkdown()};
        })()`);
        assert.equal(physical.hidden,false);assert.ok(Math.abs(physical.top-physical.expected)<1);
        assert.ok(Math.abs(physical.height-physical.lineHeight)<1);assert.equal(physical.source,wrappedSource);

        const horizontalSource='```\r\n'+ 'long code '.repeat(90)+'\r\n```';
        await engine.evaluate(`(() => {
          const editor=window.__prefsEditor;editor.setMarkdown(${JSON.stringify(horizontalSource)});editor.showWysiwygMode();editor.focus();editor.setSurfaceSelection(10,10);
          const block=editor.surface.querySelector('.amorist-wysiwyg-code-block');block.scrollLeft=100;window.scrollTo(0,0);editor.scheduleCurrentLine();return true;
        })()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        const horizontal=await engine.evaluate(`(() => {
          const editor=window.__prefsEditor,block=editor.surface.querySelector('.amorist-wysiwyg-code-block'),box=block.getBoundingClientRect(),overlay=editor.currentLine.getBoundingClientRect();
          return {hidden:editor.currentLine.hidden,insideBlock:editor.currentLine.parentElement===block,left:overlay.left,right:overlay.right,blockLeft:box.left+block.clientLeft,blockRight:box.left+block.clientLeft+block.clientWidth,source:editor.getMarkdown()};
        })()`);
        assert.equal(horizontal.hidden,false);assert.equal(horizontal.insideBlock,true);
        assert.ok(horizontal.left>=horizontal.blockLeft-1 && horizontal.right<=horizontal.blockRight+1);
        assert.equal(horizontal.source,horizontalSource);
        await engine.evaluate(`(() => {
          const editor=window.__prefsEditor,row=editor.surface.querySelector('.amorist-wysiwyg-fence'),range=document.createRange();
          range.setStart(row,0);range.collapse(true);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);editor.scheduleCurrentLine();return true;
        })()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(await engine.evaluate('window.__prefsEditor.currentLine.hidden'),true);
        console.log(`settings: ${entry.id} passed`);
      } finally { await engine.close(); }
    }
  } finally { await server.stop(); }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
