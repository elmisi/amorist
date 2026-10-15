'use strict';
const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http');
const {WebDriverEngine}=require('./engine-webdriver');
class WindowsAttachEngine extends WebDriverEngine {
 constructor(driver,application,args,environment=process.env){super(driver);this.application=application;this.applicationArgs=args;this.environment=environment;this.id='webview2';this.applicationProcess=null;this.profile=null;this.debugPort=0;}
 checkPreconditions(){return process.platform==='win32'?'':'Direct WebView2 attachment requires Windows.';}
 serverArguments(){return [`--port=${this.port}`];}
 sessionCapabilities(){return {browserName:'webview2','ms:edgeOptions':{debuggerAddress:`127.0.0.1:${this.debugPort}`}};}
 async start(){
  this.debugPort=await freePort();this.profile=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-webview-attach-'));
  this.applicationProcess=cp.spawn(this.application,this.applicationArgs,{stdio:['ignore','pipe','pipe'],env:{...this.environment,TAURI_WEBVIEW_AUTOMATION:'true',WEBVIEW2_USER_DATA_FOLDER:this.profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${this.debugPort}`}});
  this.applicationProcess.on('error',error=>{this.applicationError=error;});
  this.applicationOutput='';
  for(const stream of [this.applicationProcess.stdout,this.applicationProcess.stderr]) stream.on('data',chunk=>{this.applicationOutput=(this.applicationOutput+chunk.toString()).slice(-4000);});
  const deadline=Date.now()+60000;
  for(;;){
   if(this.applicationError || this.applicationProcess.exitCode!==null) throw new Error('Owned application exited before WebView2 attachment: '+(this.applicationError||this.applicationProcess.exitCode)+' '+this.applicationOutput);
   try {await debugEndpoint(this.debugPort);break;}
   catch(error){if(Date.now()>deadline)throw new Error('Owned WebView2 debug endpoint did not become ready: '+error.message+' '+this.applicationOutput);}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  await super.start();
 }
 async crashApplication(){
  const application=this.applicationProcess;
  if(!application?.pid || application.exitCode!==null || application.signalCode!==null)throw new Error('The owned application is not live; refusing an unrelated process kill.');
  const exited=new Promise(resolve=>application.once('exit',resolve));application.kill();await exited;
  this.sessionId='';await this.close();
 }
 async close(){
  try{await super.close();}finally{
   if(this.applicationProcess&&this.applicationProcess.exitCode===null&&this.applicationProcess.signalCode===null){this.applicationProcess.kill();await new Promise(resolve=>this.applicationProcess.once('exit',resolve));}
   if(this.profile){
    const cleanup=cp.spawnSync('powershell.exe',['-NoProfile','-Command',
      `$owned=Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($env:AMORIST_QA_PROFILE_DIR,[StringComparison]::OrdinalIgnoreCase) -ge 0 }; $owned | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      {encoding:'utf8',timeout:30000,env:{...process.env,AMORIST_QA_PROFILE_DIR:this.profile}});
    if(cleanup.status!==0)throw new Error('Owned WebView2 profile cleanup failed: '+(cleanup.error?.message||cleanup.stderr||`exit ${cleanup.status}, signal ${cleanup.signal}`));
    fs.rmSync(this.profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
   }
  }
 }
}
function debugEndpoint(port){return new Promise((resolve,reject)=>{
 const request=http.get({hostname:'127.0.0.1',port,path:'/json/version'},response=>{
  let text='';response.on('data',chunk=>{text+=chunk;});response.on('end',()=>{
   try{const info=JSON.parse(text);if(!info.webSocketDebuggerUrl)throw new Error('Missing debugger URL');resolve(info);}catch(error){reject(error);}
  });
 });
 request.setTimeout(1000,()=>request.destroy(new Error('Debug endpoint timeout')));request.on('error',reject);
});}
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
module.exports={WindowsAttachEngine};
