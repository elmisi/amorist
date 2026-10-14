'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
async function main(){
 assert.equal(process.platform,'linux');const root=path.resolve(__dirname,'..');
 const build=cp.spawnSync('cargo',['build','--manifest-path',path.join(root,'src-tauri/Cargo.toml')],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-startup-documents-')),data=path.join(scratch,'data'),recovery=path.join(data,'amorist','recovery-sessions');
 const files=[path.join(scratch,'one λ.md'),path.join(scratch,'two Ω.md')],saved=['First saved document\r\n','Second saved document\r\n'];
 const ids=files.map((_,index)=>'s-startup-doc-'+process.pid+'-'+Date.now()+'-'+index);
 const records=files.map((file,index)=>{fs.writeFileSync(file,saved[index]);const directory=path.join(recovery,ids[index]);fs.mkdirSync(directory,{recursive:true});const bytes=JSON.stringify({schemaVersion:1,sessionId:ids[index],path:file,savedSource:saved[index],unsavedSource:index?'Second unsaved work\r\n':'',revision:1,boundaryState:null,legacyImport:false});fs.writeFileSync(path.join(directory,'record.json'),bytes);return bytes;});
 const create=()=>new TauriEngine(discoverDriver(),path.join(root,'src-tauri/target/debug/amorist'),[],{...process.env,XDG_DATA_HOME:data,XDG_CACHE_HOME:path.join(scratch,'cache'),XDG_CONFIG_HOME:path.join(scratch,'config')});let engine=create();
 async function waitFor(expression){const deadline=Date.now()+8000;while(!await engine.evaluate(`!!document.getElementById('editor')&&(${expression})`)){assert.ok(Date.now()<deadline,'Timed out: '+expression);await new Promise(resolve=>setTimeout(resolve,30));}}
 function unchanged(){files.forEach((file,index)=>{assert.equal(fs.readFileSync(file,'utf8'),saved[index]);assert.equal(fs.readFileSync(path.join(recovery,ids[index],'record.json'),'utf8'),records[index]);});}
 try{
  await engine.start();await waitFor(`!!document.querySelector('#recovery-dialog[open]')`);
  const options=await engine.evaluate(`Array.from(document.querySelector('#recovery-choice').options).map(option=>({value:option.value,text:option.textContent}))`);
  assert.deepEqual(new Set(options.map(option=>option.value)),new Set(ids));files.forEach(file=>assert.ok(options.some(option=>option.text.includes(file))));unchanged();
  await engine.evaluate(`Array.from(document.querySelectorAll('#recovery-dialog button')).find(button=>button.textContent==='Continue without recovery').click()`);await waitFor(`!document.querySelector('#recovery-dialog')&&!document.getElementById('editor').inert`);unchanged();
  await engine.close();engine=create();await engine.start();await waitFor(`!!document.querySelector('#recovery-dialog[open]')`);
  await engine.evaluate(`(()=>{document.getElementById('recovery-choice').value=${JSON.stringify(ids[0])};document.getElementById('recover-selected').click();return true;})()`);
  await waitFor(`!document.querySelector('#recovery-dialog')&&!document.getElementById('editor').inert&&document.body.classList.contains('is-dirty')`);
  assert.equal(await engine.evaluate(`document.getElementById('file-path').textContent`),files[0]);assert.equal(await engine.evaluate(`document.querySelector('.amorist-editor-source').value`),'');unchanged();
  await engine.evaluate(`document.getElementById('save-button').click()`);await waitFor(`!document.body.classList.contains('is-dirty')`);
  assert.equal(fs.readFileSync(files[0],'utf8'),'');assert.equal(fs.readFileSync(files[1],'utf8'),saved[1]);assert.equal(fs.existsSync(path.join(recovery,ids[0],'record.json')),false);assert.equal(fs.readFileSync(path.join(recovery,ids[1],'record.json'),'utf8'),records[1]);
  for(const unavailable of ['missing','invalid-utf8']) {
   const original=path.join(scratch,unavailable+'.md'),id='s-startup-'+unavailable+'-'+process.pid;
   const originalBytes=Buffer.from([255,0,254]);if(unavailable==='invalid-utf8')fs.writeFileSync(original,originalBytes);
   const directory=path.join(recovery,id);fs.mkdirSync(directory);const source='Recovered '+unavailable+' λ\r\n';
   const bytes=JSON.stringify({schemaVersion:1,sessionId:id,path:original,savedSource:'Former saved document\r\n',unsavedSource:source,revision:1,boundaryState:null,legacyImport:false});fs.writeFileSync(path.join(directory,'record.json'),bytes);
   await engine.close();engine=create();await engine.start();await waitFor(`!!document.querySelector('#recovery-dialog[open]')`);
   await engine.evaluate(`(()=>{document.getElementById('recovery-choice').value=${JSON.stringify(id)};document.getElementById('recover-selected').click();return true;})()`);
   await waitFor(`!document.querySelector('#recovery-dialog')&&!document.getElementById('editor').inert&&document.body.classList.contains('is-dirty')`);
   assert.equal(await engine.evaluate(`document.getElementById('file-path').textContent`),'');assert.equal(await engine.evaluate(`document.querySelector('.amorist-editor-source').value`),source.replace(/\r\n/g,'\n'));
   assert.match(await engine.evaluate(`document.getElementById('notice').textContent`),/untitled document; use Save As/);assert.equal(fs.readFileSync(path.join(directory,'record.json'),'utf8'),bytes);
   const target=path.join(scratch,'saved-'+unavailable+'.md');await engine.evaluate(`window.__TAURI__.dialog.save=()=>Promise.resolve(${JSON.stringify(target)})`);await engine.evaluate(`document.getElementById('save-button').click()`);await waitFor(`!document.body.classList.contains('is-dirty')`);
   assert.equal(fs.readFileSync(target,'utf8'),source);assert.equal(fs.existsSync(path.join(directory,'record.json')),false);assert.equal(fs.readFileSync(path.join(recovery,ids[1],'record.json'),'utf8'),records[1]);
   if(unavailable==='missing')assert.equal(fs.existsSync(original),false);else assert.deepEqual(fs.readFileSync(original),originalBytes);
  }
  console.log('Native startup recovery: documents listed, continue preserves copies, empty recovery saves only own record; missing and invalid UTF-8 originals recover untitled and remain untouched after Save As');
 }finally{await engine.close();fs.rmSync(scratch,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
