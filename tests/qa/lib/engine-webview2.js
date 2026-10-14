'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const {TauriEngine}=require('./engine-tauri');

function find(name){
 const result=cp.spawnSync('where.exe',[name],{encoding:'utf8'});
 return result.status===0?result.stdout.trim().split(/\r?\n/)[0]:'';
}

class WebView2Engine extends TauriEngine {
 constructor(driver,options){
  super(driver,options.application,['--new-document'],process.env);
  this.id='webview2';this.nativeDriver=options.nativeDriver;
 }
 static discover(){
  const driver=process.env.AMORIST_QA_TAURI_DRIVER||find('tauri-driver.exe');
  const nativeDriver=process.env.AMORIST_QA_EDGE_DRIVER||find('msedgedriver.exe');
  const application=process.env.AMORIST_QA_APPLICATION||path.resolve(__dirname,'../../../src-tauri/target/debug/amorist.exe');
  for(const [name,value] of [['tauri-driver',driver],['Edge WebDriver',nativeDriver],['compiled Amorist application',application]]) {
   if(!value||!fs.existsSync(value))return {available:false,reason:`${name} was not found for mandatory Windows WebView2 checks.`};
  }
  return {available:true,binary:driver,browser:{application,nativeDriver}};
 }
 checkPreconditions(){
  if(process.platform!=='win32')return 'WebView2 application tests require Windows.';
  if(!fs.existsSync(this.application)||!fs.existsSync(this.nativeDriver))return 'WebView2 application or Edge WebDriver is missing.';
  return '';
 }
 serverArguments(){return [...super.serverArguments(),'--native-driver',this.nativeDriver];}
 async crashApplication(){throw new Error('Windows process-isolated crash acceptance requires the Windows application process controller.');}
}
module.exports={WebView2Engine};
