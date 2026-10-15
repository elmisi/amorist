'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const {WindowsAttachEngine}=require('./engine-windows-attach');

function find(name){
 const result=cp.spawnSync('where.exe',[name],{encoding:'utf8'});
 return result.status===0?result.stdout.trim().split(/\r?\n/)[0]:'';
}

class WebView2Engine extends WindowsAttachEngine {
 constructor(driver,options){
  super(driver,options.application,options.arguments||['--new-document'],options.environment||process.env);
  this.id='webview2';
 }
 static discover(){
  const nativeDriver=process.env.AMORIST_QA_EDGE_DRIVER||find('msedgedriver.exe');
  const application=process.env.AMORIST_QA_APPLICATION||path.resolve(__dirname,'../../../src-tauri/target/debug/amorist.exe');
  for(const [name,value] of [['Edge WebDriver',nativeDriver],['compiled Amorist application',application]]) {
   if(!value||!fs.existsSync(value))return {available:false,reason:`${name} was not found for mandatory Windows WebView2 checks.`};
  }
  return {available:true,binary:nativeDriver,browser:{application}};
 }
 checkPreconditions(){
  if(process.platform!=='win32')return 'WebView2 application tests require Windows.';
  if(!fs.existsSync(this.application)||!fs.existsSync(this.binary))return 'WebView2 application or Edge WebDriver is missing.';
  return '';
 }
}
module.exports={WebView2Engine};
