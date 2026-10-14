'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
async function main(){
 assert.equal(process.platform,'linux');const root=path.resolve(__dirname,'..');
 const build=cp.spawnSync('cargo',['build','--manifest-path',path.join(root,'src-tauri/Cargo.toml')],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-settings-native-')),file=path.join(scratch,'preferences λ.md');
 const source='# Preferences\r\nText λ\r\n\r\n| A | B |\r\n| --- | --- |\r\n| left | right |\r\n\r\n```\r\ncode\r\n```';fs.writeFileSync(file,source);
 const environment={...process.env,XDG_DATA_HOME:path.join(scratch,'data'),XDG_CACHE_HOME:path.join(scratch,'cache'),XDG_CONFIG_HOME:path.join(scratch,'config')};
 const settingsPath=path.join(scratch,'data','dev.elmisi.amorist','settings.json');
 const create=()=>new TauriEngine(discoverDriver(),path.join(root,'src-tauri/target/debug/amorist'),['--',file],environment);let engine=create();
 async function waitFor(expression){const deadline=Date.now()+7000;while(!await engine.evaluate(`!!document.getElementById('editor')&&(${expression})`)){assert.ok(Date.now()<deadline,'Timed out: '+expression);await new Promise(resolve=>setTimeout(resolve,40));}}
 async function start(){await engine.start();await waitFor(`!document.getElementById('editor').inert&&!document.getElementById('settings-button').hidden&&!!document.querySelector('.amorist-editor-source')`);}
 async function font(){return engine.evaluate(`getComputedStyle(document.querySelector('.amorist-editor-source')).fontSize`);}
 async function openSettings(){await engine.evaluate(`document.getElementById('settings-button').click()`);await waitFor(`document.getElementById('settings-dialog').open`);}
 async function chooseSize(size){await engine.evaluate(`document.getElementById('settings-form').elements.baseFontSize.focus()`);await engine.sendKeys([{key:'a',ctrl:true},String(size)]);await waitFor(`document.getElementById('settings-form').elements.baseFontSize.value==='${size}'`);}
 async function restart(){await engine.close();engine=create();await start();}
 try{
  await start();assert.equal(await font(),'16px');
  await engine.evaluate(`(()=>{document.querySelector('[data-action="source"]').click();const source=document.querySelector('.amorist-editor-source');source.focus();source.setSelectionRange(3,8,'backward');return true;})()`);
  await openSettings();assert.equal(await engine.evaluate(`document.querySelector('#settings-form button[type="submit"]').textContent`),'Save');
  await chooseSize(19);
  await engine.evaluate(`(()=>{const form=document.getElementById('settings-form');form.elements.highlightCurrentLine.checked=true;form.elements.highlightColor.value='#faedf2';form.elements.tableScale.value='1.25';form.elements.codeScale.value='1.125';form.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await engine.sendKeys([{key:'Enter'}]);await waitFor(`!document.getElementById('settings-dialog').open`);
  assert.equal(await font(),'19px');
  const saved=fs.readFileSync(settingsPath,'utf8');assert.deepEqual(JSON.parse(saved),{highlightCurrentLine:true,highlightColor:'#faedf2',baseFontSize:19,tableScale:1.25,codeScale:1.125});
  assert.deepEqual(await engine.evaluate(`(()=>{const source=document.querySelector('.amorist-editor-source');return {start:source.selectionStart,end:source.selectionEnd,direction:source.selectionDirection,value:source.value};})()`),{start:3,end:8,direction:'backward',value:source.replace(/\r\n/g,'\n')});
  assert.equal(fs.readFileSync(file,'utf8'),source);
  await openSettings();await chooseSize(22);await engine.sendKeys([{key:'Escape'}]);await waitFor(`!document.getElementById('settings-dialog').open`);
  assert.equal(await font(),'19px');assert.equal(fs.readFileSync(settingsPath,'utf8'),saved);
  await restart();await waitFor(`getComputedStyle(document.querySelector('.amorist-editor-source')).fontSize==='19px'`);
  await openSettings();await chooseSize(21);fs.renameSync(settingsPath,settingsPath+'.backup');fs.mkdirSync(settingsPath);
  await engine.sendKeys([{key:'Enter'}]);await waitFor(`document.getElementById('settings-error').textContent.length>0&&!document.getElementById('settings-form').elements.baseFontSize.disabled`);
  assert.equal(await engine.evaluate(`document.getElementById('settings-dialog').open`),true);assert.equal(await font(),'19px');
  assert.equal(fs.readFileSync(settingsPath+'.backup','utf8'),saved);assert.equal(fs.readFileSync(file,'utf8'),source);
  fs.rmdirSync(settingsPath);fs.renameSync(settingsPath+'.backup',settingsPath);
  await engine.evaluate(`document.querySelector('#settings-form button[type="submit"]').focus()`);
  await engine.sendKeys([{key:'Enter'}]);await waitFor(`!document.getElementById('settings-dialog').open`);assert.equal(await font(),'21px');
  assert.equal(JSON.parse(fs.readFileSync(settingsPath,'utf8')).baseFontSize,21);
  await engine.close();const corrupt='{broken settings';fs.writeFileSync(settingsPath,corrupt);engine=create();await start();
  await waitFor(`!document.getElementById('notice').hidden&&document.getElementById('notice').textContent.includes('defaults')`);
  assert.equal(await font(),'16px');assert.equal(fs.readFileSync(settingsPath,'utf8'),corrupt);assert.equal(fs.readFileSync(file,'utf8'),source);
  console.log('Native settings: Save/Cancel/restart, exact selection and CRLF document, failed write/retry and preserved corrupt settings passed');
 }finally{await engine.close();fs.rmSync(scratch,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
