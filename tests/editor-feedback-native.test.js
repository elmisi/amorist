'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
const {WindowsAttachEngine}=require('./qa/lib/engine-windows-attach');
const {closeOwnedNative}=require('./qa/lib/close-owned-native');
async function main(){
 assert.ok(['linux','win32'].includes(process.platform),'Requires native Linux or Windows application');
 const application=process.env.AMORIST_QA_APPLICATION;assert.ok(application&&fs.existsSync(application));
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-feedback-'));
 const NativeEngine=process.platform==='win32'?WindowsAttachEngine:TauriEngine;
 const driver=process.platform==='win32'?process.env.AMORIST_QA_EDGE_DRIVER:discoverDriver();assert.ok(driver);
 const offsets=[];let success=false;
 try{
  for(const [name,source] of [['rule','---\r\n\r\n- item'],['control','text\r\n\r\n- item']]){
   const file=path.join(scratch,name+'.md');fs.writeFileSync(file,source);
   const engine=new NativeEngine(driver,application,['--',file],{...process.env,XDG_DATA_HOME:path.join(scratch,'data'),XDG_CONFIG_HOME:path.join(scratch,'config'),XDG_CACHE_HOME:path.join(scratch,'cache')});
   try{
    await engine.start();const end=Date.now()+10000;
    while(!await engine.evaluate("!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert&&document.querySelectorAll('.amorist-source-line').length===3")){assert.ok(Date.now()<end,'Native document readiness');await new Promise(r=>setTimeout(r,50));}
    offsets.push(await engine.evaluate("(()=>{const s=document.querySelector('.amorist-editor-surface');return s.querySelectorAll('.amorist-source-line')[2].getBoundingClientRect().top-s.getBoundingClientRect().top})()"));
    await engine.evaluate("document.querySelector('[data-action=source]').click()");
    assert.equal(await engine.evaluate("document.querySelector('.amorist-editor-source').value"),source.replace(/\r\n/g,'\n'));
    await engine.evaluate("document.querySelector('[data-action=source]').click()");
    await engine.evaluate("(()=>{window.__feedbackLink=window.AmoristInternals.EditingPolicy.requestLink('https://example.com');return true})()");
    const g=await engine.evaluate("(()=>{const d=document.querySelector('.amorist-link-dialog'),r=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom}},b=d.querySelectorAll('button');return {dialog:r(d),title:r(d.querySelector('h2')),input:r(d.querySelector('input')),cancel:r(b[0]),save:r(b[1]),focus:document.activeElement===d.querySelector('input')}})()");
    assert.ok(g.title.bottom<g.input.top&&g.input.bottom<g.save.top&&g.cancel.right<g.save.left&&g.focus,JSON.stringify(g));
    assert.ok(g.input.left>g.dialog.left&&g.input.right<g.dialog.right);
    await engine.evaluate("document.querySelector('.amorist-link-dialog button[type=button]').click()");
    assert.equal(await engine.evaluate('window.__feedbackLink.then(value=>value===null)'),true);
    assert.equal(fs.readFileSync(file,'utf8'),source);
   }finally{await(process.platform==='win32'?engine.close():closeOwnedNative(engine));}
  }
  assert.ok(Math.abs(offsets[0]-offsets[1])<1.5,'Rule adds no visual blank row: '+JSON.stringify(offsets));
  success=true;console.log('Native feedback PASS: rule spacing matches control; link dialog layout/focus/Cancel; CRLF files unchanged');
 }finally{if(success)fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});else console.error('Diagnostic fixture retained:',scratch);}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
