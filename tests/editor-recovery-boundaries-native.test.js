'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
const {closeOwnedNative,crashOwnedNative}=require('./qa/lib/close-owned-native');

async function main(){
  assert.equal(process.platform,'linux');
  const application=process.env.AMORIST_QA_APPLICATION||path.resolve('src-tauri/target/debug/amorist');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-recovery-boundaries-'));
  const file=path.join(scratch,'owned boundary λ.md'),original='alpha beta\r\n';fs.writeFileSync(file,original);
  const environment={...process.env,XDG_DATA_HOME:path.join(scratch,'data'),XDG_CONFIG_HOME:path.join(scratch,'config'),XDG_CACHE_HOME:path.join(scratch,'cache')};
  const create=()=>new TauriEngine(discoverDriver(),application,['--',file],environment);
  let engine=create();
  async function waitFor(check,label){const deadline=Date.now()+8000;while(!await check()){assert.ok(Date.now()<deadline,label);await new Promise(r=>setTimeout(r,30));}}
  function records(){const root=path.join(environment.XDG_DATA_HOME,'amorist','recovery-sessions');if(!fs.existsSync(root))return [];return fs.readdirSync(root).flatMap(name=>{try{return [JSON.parse(fs.readFileSync(path.join(root,name,'record.json'),'utf8'))];}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return [];throw error;}});}
  async function persisted(source,markers){await waitFor(()=>records().some(r=>r.unsavedSource===source&&JSON.stringify(r.boundaryState?.automaticBreaks?.map(b=>b.marker))===JSON.stringify(markers)),'Expected source and owned boundaries persisted');assert.equal(fs.readFileSync(file,'utf8'),original);}
  try{
    await engine.start();await waitFor(()=>engine.evaluate("!!document.querySelector('.amorist-inline-text')"),'Initial document');
    await engine.evaluate(`(()=>{const surface=document.querySelector('.amorist-editor-surface'),node=surface.querySelector('.amorist-inline-text').firstChild,range=document.createRange();surface.focus();range.setStart(node,6);range.collapse(true);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return true})()`);
    await engine.sendKeys([{key:'Enter'}]);await persisted('alpha \\\r\nbeta\r\n',[6]);
    await crashOwnedNative(engine);engine=create();await engine.start();
    await waitFor(()=>engine.evaluate("!!document.querySelector('#recovery-dialog[open]')||!!document.querySelector('.amorist-inline-text')"),'Recovery available');
    if(await engine.evaluate("!!document.querySelector('#recovery-dialog[open]')"))await engine.evaluate("document.getElementById('recover-selected').click()");
    await waitFor(()=>engine.evaluate("!document.querySelector('#recovery-dialog')&&!!document.querySelector('.amorist-inline-text')"),'Recovered editor');
    await waitFor(()=>engine.evaluate("document.querySelector('.amorist-editor-surface').textContent.replaceAll(String.fromCharCode(8203),'').includes('alpha \\nbeta\\n')"),'Recovered unsaved text is visible');
    await engine.evaluate("document.querySelector('.amorist-editor-surface').focus()");
    await engine.sendKeys([{key:'a',ctrl:true},{key:'Tab'},{key:'Tab'}]);
    await persisted('    alpha \r\n    beta\r\n',[]);
    await engine.sendKeys([{key:'z',ctrl:true}]);await persisted('  alpha \\\r\n  beta\r\n',[8]);
    await engine.sendKeys([{key:'z',ctrl:true}]);await persisted('alpha \\\r\nbeta\r\n',[6]);
    console.log('Native recovery boundaries PASS: generated CRLF break persisted, owned-process crash/recovery preserved ownership, indentation cleanup and each undo persisted exact source; original file unchanged');
  }finally{
    await closeOwnedNative(engine);
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
