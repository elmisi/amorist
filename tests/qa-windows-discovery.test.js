'use strict';
const assert=require('node:assert/strict');
Object.defineProperty(process,'platform',{value:'win32'});
process.env.AMORIST_QA_TAURI_DRIVER='/nonexistent/tauri-driver.exe';
process.env.AMORIST_QA_EDGE_DRIVER='/nonexistent/msedgedriver.exe';
process.env.AMORIST_QA_CHROMIUM='/nonexistent/chrome.exe';
const {resolveEngines,publishedPlatformsNotCovered}=require('./qa/lib/engines');
const engines=resolveEngines();
for(const id of ['webview2','chromium']){
 const engine=engines.find(entry=>entry.id===id);assert.equal(engine.applicable,true);assert.equal(engine.available,false);assert.ok(engine.reason);
}
assert.match(engines.find(entry=>entry.id==='webview2').reason,/not found/);
for(const id of ['safari','webkitgtk'])assert.equal(engines.find(entry=>entry.id===id).applicable,false);
assert.deepEqual(publishedPlatformsNotCovered(),['linux','macos']);
console.log('Windows engine discovery: missing mandatory drivers and browser remain unavailable');
