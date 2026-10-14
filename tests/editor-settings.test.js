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
        console.log(`settings: ${entry.id} passed`);
      } finally { await engine.close(); }
    }
  } finally { await server.stop(); }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
