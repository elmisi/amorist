#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const repo=process.env.AMORIST_LOOP_REPO,app=process.env.AMORIST_LOOP_APPLICATION,args=process.argv.slice(2);
if(args.includes('--build-info')){const result=cp.spawnSync(app,args,{stdio:'inherit'});process.exit(result.status??1);}
const {TauriEngine,discoverDriver}=require(path.join(repo,'tests/qa/lib/engine-tauri'));
const {closeOwnedNative}=require(path.join(repo,'tests/qa/lib/close-owned-native'));
const scratch=process.env.AMORIST_LOOP_SCRATCH,file=args.at(-1),phase=process.env.AMORIST_LOOP_PHASE;
const stage=path.join(scratch,phase+'-'+path.basename(file)+'.ready.json'),control=stage+'.close';
const engine=new TauriEngine(discoverDriver(),app,args,process.env);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(expression){const end=Date.now()+10000;while(!await engine.evaluate(expression)){assert.ok(Date.now()<end,'Native readiness timeout: '+expression);await sleep(40);}}
function ownedPid(){const matches=[];for(const name of fs.readdirSync('/proc')){if(!/^\d+$/.test(name))continue;try{const exe=fs.realpathSync('/proc/'+name+'/exe'),env=fs.readFileSync('/proc/'+name+'/environ','utf8').split('\0'),dir=env.find(item=>item.startsWith('APPDIR='))?.slice(7);if(path.basename(exe)!=='amorist')continue;if(exe!==fs.realpathSync(app)&&!(env.includes('APPIMAGE='+fs.realpathSync(app))&&dir&&exe===path.join(dir,'usr/bin/amorist')))continue;if(env.includes('AMORIST_QA_INSTANCE_NONCE='+engine.environment.AMORIST_QA_INSTANCE_NONCE)&&env.includes('XDG_DATA_HOME='+process.env.XDG_DATA_HOME))matches.push(Number(name));}catch{}}assert.equal(matches.length,1,'Owned app process must be unique');return matches[0];}
(async()=>{let closed=false;try{
await engine.start();await waitFor(`!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert&&!document.getElementById('report-button').hidden`);
await engine.evaluate(`document.querySelector('[data-action="source"]').click()`);
assert.equal(await engine.evaluate(`document.querySelector('.amorist-editor-source').value`),fs.readFileSync(file,'utf8').replace(/\r\n|\r/g,'\n'));
if(process.env.AMORIST_LOOP_BUG==='1'){
await engine.evaluate(`document.getElementById('report-button').click()`);await waitFor(`document.getElementById('report-dialog').open`);
await engine.evaluate(`(()=>{document.getElementById('report-note').value='QA native review loop interruption';document.getElementById('report-form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));return true;})()`);
await waitFor(`!document.getElementById('report-dialog').open&&document.getElementById('status').textContent.startsWith('Report saved:')`);
}
const pid=ownedPid();let wrongPidRefused=false;if(process.env.AMORIST_LOOP_BUG==='1'){const denied=cp.spawnSync('python3',[process.env.AMORIST_LOOP_CLOSE_HELPER,'amorist — '+path.basename(file),'--close',String(pid+1)],{encoding:'utf8'});assert.notEqual(denied.status,0);assert.ok(denied.stderr.includes('process identity does not match'));assert.ok(fs.existsSync('/proc/'+pid));wrongPidRefused=true;}fs.writeFileSync(stage,JSON.stringify({file,pid,control,wrongPidRefused}));
const end=Date.now()+30000;while(!fs.existsSync(control)){assert.ok(Date.now()<end,'Controller did not close the owned app');await sleep(40);}
const close=cp.spawnSync('python3',[process.env.AMORIST_LOOP_CLOSE_HELPER,'amorist — '+path.basename(file),'--close',String(pid)],{encoding:'utf8'});assert.equal(close.status,0,close.stderr);
const exitDeadline=Date.now()+5000;while(fs.existsSync('/proc/'+pid)){const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z '))break;assert.ok(Date.now()<exitDeadline,'App did not honor native close');await sleep(40);}
closed=true;engine.sessionId='';await engine.close();
}finally{if(!closed)await closeOwnedNative(engine);}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
