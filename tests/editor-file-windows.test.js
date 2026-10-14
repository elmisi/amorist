'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WebView2Engine}=require('./qa/lib/engine-webview2');
async function waitFor(probe,message){const start=Date.now();while(!await probe()){assert.ok(Date.now()-start<8000,message);await new Promise(resolve=>setTimeout(resolve,50));}}
async function main(){
 assert.equal(process.platform,'win32');const found=WebView2Engine.discover();assert.ok(found.available,found.reason);
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-native-file-'));const file=path.join(scratch,'original λ.md'),destination=path.join(scratch,'saved Ω.md');const base='original\r\nsecond';fs.writeFileSync(file,base);
 const engine=new WebView2Engine(found.binary,{...found.browser,arguments:['--new-document']});
 try{
  await engine.start();await waitFor(()=>engine.evaluate(`!!document.querySelector('.amorist-editor-source') && !document.getElementById('editor').inert`),'editor ready');
  const initial=await engine.evaluate(`(()=>{document.querySelector('[data-action="source"]').click();return {path:document.getElementById('file-path').textContent,source:document.querySelector('.amorist-editor-source').value};})()`);
  assert.equal(initial.path,'','QA startup must not adopt a named document');assert.ok(initial.source==='' || /^( edited)+$/.test(initial.source),'Refuse to discard any work other than the known prior QA fixture');
  await engine.evaluate(`(()=>{window.__TAURI__.dialog.open=()=>Promise.resolve(${JSON.stringify(file)});document.querySelector('[data-file-action="open"]').click();return true;})()`);
  await waitFor(async()=>{const choice=await engine.evaluate(`(()=>{const dialog=document.getElementById('file-decision-dialog');if(dialog){Array.from(dialog.querySelectorAll('button')).find(button=>button.textContent==='Discard').click();return false;}return document.getElementById('file-path').textContent.endsWith('original λ.md')&&!document.getElementById('editor').inert;})()`);return choice;},'Open adopts original test document');

  await engine.evaluate(`(()=>{document.querySelector('[data-action="source"]').click();const source=document.querySelector('.amorist-editor-source');source.focus();source.setSelectionRange(source.value.length,source.value.length);window.__fileRoot=document.querySelector('.amorist-editor');return true;})()`);
  await engine.sendKeys([' edited']);await waitFor(()=>engine.evaluate(`document.querySelector('.amorist-editor-source').value.endsWith(' edited')`),'native input complete');
  const edited=base+' edited';assert.equal(fs.readFileSync(file,'utf8'),base);
  await engine.evaluate(`(()=>{window.__TAURI__.dialog.save=()=>Promise.resolve(null);document.querySelector('[data-file-action="save-as"]').click();return true;})()`);
  await new Promise(resolve=>setTimeout(resolve,200));assert.equal(fs.existsSync(destination),false);assert.equal(fs.readFileSync(file,'utf8'),base);
  await engine.evaluate(`(()=>{document.getElementById('save-button').click();return true;})()`);
  try {await waitFor(()=>Promise.resolve(fs.readFileSync(file,'utf8')===edited),'Save writes exact CRLF source');}
  catch(error){console.error(JSON.stringify({actualFile:fs.readFileSync(file,'utf8'),expected:edited,ui:await engine.evaluate(`(()=>({path:document.getElementById('file-path').textContent,notice:document.getElementById('notice').textContent,source:document.querySelector('.amorist-editor-source').value,saveDisabled:document.getElementById('save-button').disabled,status:document.getElementById('status').textContent}))()`)}));throw error;}
  await engine.evaluate(`(()=>{window.__TAURI__.dialog.save=()=>Promise.resolve(${JSON.stringify(destination)});document.querySelector('[data-file-action="save-as"]').click();return true;})()`);
  await waitFor(()=>Promise.resolve(fs.existsSync(destination)&&fs.readFileSync(destination,'utf8')===edited),'Save As destination written');
  const after=await engine.evaluate(`(()=>({rootSame:document.querySelector('.amorist-editor')===window.__fileRoot,source:document.querySelector('.amorist-editor-source').value,path:document.getElementById('file-path').textContent}))()`);
  assert.equal(after.rootSame,true);assert.equal(after.source,edited.replace(/\r\n/g,'\n'));assert.ok(after.path.endsWith('saved Ω.md'));assert.equal(fs.readFileSync(file,'utf8'),edited);
  console.log(JSON.stringify({status:'pass',nativeKeyboard:true,cancelledSaveAsPreservesFile:true,saveExactSource:true,saveAsExactSource:true,editorRetained:true}));
 }finally{await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
