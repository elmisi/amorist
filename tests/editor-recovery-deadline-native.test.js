'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
const {closeOwnedNative,crashOwnedNative}=require('./qa/lib/close-owned-native');
async function waitFor(probe,label,timeout=10000){const end=Date.now()+timeout;while(!await probe()){assert.ok(Date.now()<end,label);await new Promise(r=>setTimeout(r,30));}}
async function main(){
  assert.equal(process.platform,'linux');
  const application=process.env.AMORIST_QA_APPLICATION||path.resolve('src-tauri/target/debug/amorist');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-recovery-deadline-'));
  const results=[];
  try {for(const size of [500,1500])for(const mode of ['idle','continuous']){
    const owned=path.join(scratch,`${size}-${mode}`);fs.mkdirSync(owned);
    const file=path.join(owned,'deadline λ.md'),original=Array.from({length:size},(_,n)=>`line ${n}`).join('\n');fs.writeFileSync(file,original);
    const environment={...process.env,XDG_DATA_HOME:path.join(owned,'data'),XDG_CONFIG_HOME:path.join(owned,'config'),XDG_CACHE_HOME:path.join(owned,'cache')};
    const create=()=>new TauriEngine(discoverDriver(),application,['--',file],environment);
    let engine=create();
    try {
      await engine.start();await waitFor(()=>engine.evaluate("!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert"),'Editor ready');
      const recoveryRoot=path.join(environment.XDG_DATA_HOME,'amorist','recovery-sessions');
      const samples=[];let previousLength=original.length,watchError=null;
      const readCopy=()=>{
        try {for(const entry of fs.readdirSync(recoveryRoot,{withFileTypes:true})){
          if(!entry.isDirectory())continue;
          const recordPath=path.join(recoveryRoot,entry.name,'record.json');
          let record;try{record=JSON.parse(fs.readFileSync(recordPath,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
          if(record.path!==file||record.unsavedSource.length<=previousLength)continue;
          const complete=Date.now();
          assert.ok(record.unsavedSource.startsWith(original));assert.match(record.unsavedSource.slice(original.length),/^x+$/);
          samples.push({complete,firstInput:previousLength-original.length,lastInput:record.unsavedSource.length-original.length-1,source:record.unsavedSource,revision:record.revision});
          previousLength=record.unsavedSource.length;
        }}catch(error){watchError=error;}
      };
      const watcher=fs.watch(recoveryRoot,{recursive:true},readCopy);
      // Atomic replacement can detach an inode watch; poll the record as well.
      const polling=setInterval(readCopy,10);
      try {
      await engine.evaluate(`(()=>{
        const source=document.querySelector('.amorist-editor-source');if(source.hidden)document.querySelector('[data-action="source"]').click();source.focus();source.setSelectionRange(source.value.length,source.value.length);
        window.__deadline={inputs:[],interval:null};
        source.addEventListener('input',()=>window.__deadline.inputs.push(Date.now()),true);return true;
      })()`);
      if(mode==='idle'){
        for(let n=1;n<=20;n++){
          await engine.sendKeys(['x']);
          await waitFor(()=>{if(watchError)throw watchError;return samples.length>=n;},'Idle checkpoint');
        }
      } else {
        await engine.evaluate(`(()=>{const source=document.querySelector('.amorist-editor-source');const edit=()=>{source.setRangeText('x',source.value.length,source.value.length,'end');source.dispatchEvent(new Event('input',{bubbles:true}));};edit();window.__deadline.interval=setInterval(edit,250);return true;})()`);
        await waitFor(()=>{if(watchError)throw watchError;return samples.length>=20;},'Continuous checkpoints',120000);
        await engine.evaluate('clearInterval(window.__deadline.interval)');
      }
      const inputs=await engine.evaluate('window.__deadline.inputs');
      assert.equal(samples.length,20);
      for(const sample of samples){
        sample.first=inputs[sample.firstInput];sample.last=inputs[sample.lastInput];
        assert.ok(Number.isFinite(sample.first)&&Number.isFinite(sample.last));
        assert.ok(sample.complete-sample.first<=(mode==='idle'?2100:5100),`${size}/${mode} completion latency ${sample.complete-sample.first}ms`);
      }
      }finally{watcher.close();clearInterval(polling);}
      const lastPersisted=samples.at(-1).source;
      assert.equal(fs.readFileSync(file,'utf8'),original);
      await crashOwnedNative(engine);engine=create();await engine.start();
      await waitFor(()=>engine.evaluate("!!document.querySelector('#recovery-dialog[open]')||!!document.querySelector('.amorist-editor-source')"),'Recovery startup');
      if(await engine.evaluate("!!document.querySelector('#recovery-dialog[open]')"))await engine.evaluate("document.getElementById('recover-selected').click()");
      await waitFor(()=>engine.evaluate("!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert&&!document.querySelector('#recovery-dialog[open]')"),'Recovered document');
      assert.equal(await engine.evaluate('document.querySelector(".amorist-editor-source").value'),lastPersisted);
      assert.equal(fs.readFileSync(file,'utf8'),original);
      results.push({size,mode,samples:samples.map(({source,...timing})=>timing),crashRecoveryExact:true,originalUnchanged:true});
      console.log(JSON.stringify({size,mode,status:'pass',samples:20,maximumLatencyMs:Math.max(...samples.map(s=>s.complete-s.first)),observation:'atomic recovery record on disk'}));
    }catch(error){
      console.error(JSON.stringify({size,mode,ui:await engine.evaluate('({inputs:window.__deadline?.inputs,notice:document.getElementById("notice").textContent,valueLength:document.querySelector(".amorist-editor-source")?.value.length})'),
        records:fs.readdirSync(path.join(environment.XDG_DATA_HOME,'amorist','recovery-sessions'),{recursive:true}).filter(name=>name.endsWith('record.json')).map(name=>{
          const record=JSON.parse(fs.readFileSync(path.join(environment.XDG_DATA_HOME,'amorist','recovery-sessions',name),'utf8'));
          return {keys:Object.keys(record),path:record.path,length:record.unsavedSource?.length};
        })}));
      throw error;
    }finally{await closeOwnedNative(engine);}
  }}finally{
    if(process.env.AMORIST_QA_RECOVERY_TIMING_REPORT)fs.writeFileSync(process.env.AMORIST_QA_RECOVERY_TIMING_REPORT,JSON.stringify({results},null,2)+'\n');
    fs.rmSync(scratch,{recursive:true,force:true});
  }
  return results;
}
module.exports={run:main};
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
