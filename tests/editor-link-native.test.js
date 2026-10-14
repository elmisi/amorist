'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const cp=require('node:child_process');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
async function main(){
 assert.equal(process.platform,'linux');const root=path.resolve(__dirname,'..');const build=cp.spawnSync('cargo',['build','--manifest-path',path.join(root,'src-tauri/Cargo.toml')],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-link-native-'));const file=path.join(scratch,'note.md');const source='# Start\r\n\r\n[Go](#target-λ)\r\n[Start](#start)\r\n[Missing](missing.md)\r\n'+Array(50).fill('Paragraph\r\n').join('')+'\r\n# Target λ\r\n';fs.writeFileSync(file,source);
 const engine=new TauriEngine(discoverDriver(),path.join(root,'src-tauri/target/debug/amorist'),['--heading-anchor','target-λ','--',file],{...process.env,XDG_DATA_HOME:path.join(scratch,'data')});
 try {await engine.start();let actual;const started=Date.now();
  do {actual=await engine.evaluate(`(()=>{const selection=window.getSelection(),node=selection?.focusNode,heading=node?.parentElement?.closest('.amorist-wysiwyg-h1');return {heading:heading?.textContent.trimEnd(),notice:document.getElementById('notice').textContent};})()`);if(actual.heading==='Target λ')break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()-started<8000);
  assert.equal(actual.heading,'Target λ',JSON.stringify(actual));assert.equal(fs.readFileSync(file,'utf8'),source);
  const result=await engine.evaluate(`(async()=>{const invoke=window.__TAURI__.core.invoke;return {anchorConsumed:await invoke('take_startup_anchor')};})()`);assert.equal(result.anchorConsumed,null);
  await engine.evaluate(`(()=>{document.querySelector('a[data-link-destination="#start"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));return true;})()`);
  let clicked;const clickStarted=Date.now();
  do {clicked=await engine.evaluate(`(()=>{const node=window.getSelection()?.focusNode;return node?.parentElement?.closest('.amorist-wysiwyg-h1')?.textContent.trimEnd();})()`);if(clicked==='Start')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()-clickStarted<4000);
  assert.equal(clicked,'Start');
  const selectLink=()=>engine.evaluate(`(()=>{
    const link=document.querySelector('a[data-link-destination="#target-λ"]'),range=document.createRange();range.selectNodeContents(link);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    document.querySelector('.amorist-editor-toolbar [data-action="link"]').click();
    return {modal:!!document.querySelector('.amorist-link-dialog'),focus:document.activeElement?.getAttribute('aria-label')};
  })()`);
  assert.deepEqual(await selectLink(),{modal:true,focus:'Link destination'});
  await engine.sendKeys(['#start',{key:'Enter'}]);
  let dialogResult;const dialogStarted=Date.now();
  do {dialogResult=await engine.evaluate(`(()=>({open:!!document.querySelector('.amorist-link-dialog'),destinations:Array.from(document.querySelectorAll('a[data-link-destination]')).map(link=>link.dataset.linkDestination)}))()`);if(!dialogResult.open&&dialogResult.destinations[0]==='#start')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()-dialogStarted<4000);
  assert.equal(dialogResult.open,false);assert.equal(dialogResult.destinations[0],'#start');
  await engine.evaluate(`(()=>{document.querySelector('.amorist-editor-surface').focus();return true;})()`);
  await engine.sendKeys([{key:'z',ctrl:true}]);
  let restored;const undoStarted=Date.now();
  do {restored=await engine.evaluate(`document.querySelector('a[data-link-destination]')?.dataset.linkDestination`);if(restored==='#target-λ')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()-undoStarted<4000);
  assert.equal(restored,'#target-λ');assert.deepEqual(await selectLink(),{modal:true,focus:'Link destination'});
  await engine.sendKeys([{key:'Escape'}]);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await engine.evaluate(`!!document.querySelector('.amorist-link-dialog')`),false);
  await engine.evaluate(`(()=>{document.querySelector('a[data-link-destination="missing.md"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));return true;})()`);
  let missing;const missingStarted=Date.now();
  do {missing=await engine.evaluate(`(()=>{const notice=document.getElementById('notice');return {visible:!notice.hidden,text:notice.textContent};})()`);if(missing.visible&&missing.text.includes('missing.md'))break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()-missingStarted<4000);
  assert.equal(missing.visible,true);assert.match(missing.text,/missing\.md/);assert.equal(fs.existsSync(path.join(scratch,'missing.md')),false);assert.equal(fs.readFileSync(file,'utf8'),source);
  console.log(JSON.stringify({status:'pass',startupAnchor:actual,oneUse:true,clicked,dialogResult,keyboardUndo:restored,keyboardCancel:true,missing,sourceUnchanged:true}));
 }finally{await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
