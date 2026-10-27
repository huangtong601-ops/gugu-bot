const fs=require('node:fs/promises'),path=require('node:path'),{execFile,spawn}=require('node:child_process');
const execute=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:120000,maxBuffer:65536},(error,stdout)=>error?reject(Error('更新包解压或运行目录校验失败')):resolve(stdout)));
module.exports=async function desktopUpdater({app,dialog,window,shutdown}){
 const {createAppUpdater}=await import('./app-update.mjs'),appRoot=__dirname,target=path.dirname(app.getPath('exe')),profile=app.getPath('userData');
 const currentVersion=require('./app-metadata.cjs')().version,cacheDir=path.join(profile,'app-updates');
 let lastResult=null;try{const rows=await fs.readdir(cacheDir);const results=[];for(const name of rows){if(!/^[a-f0-9-]{36}$/.test(name))continue;const file=path.join(cacheDir,name,'result.json');try{results.push({at:(await fs.stat(file)).mtimeMs,value:JSON.parse(await fs.readFile(file,'utf8'))});}catch{}}lastResult=results.sort((a,b)=>b.at-a.at)[0]?.value||null;}catch{}
 return createAppUpdater({currentVersion,cacheDir,lastResult,supported:app.isPackaged&&process.platform==='win32'&&process.arch==='x64',
  async prepare({dir,zip,version}){
   const job={dir,zip,stage:path.join(dir,'stage'),version,target,profile,pid:process.pid,restart:true},jobFile=path.join(dir,'job.json');
   if(profile.toLowerCase().startsWith(target.toLowerCase()+path.sep))throw Error('更新前请将用户数据目录放在程序文件夹之外');
   await fs.writeFile(jobFile,JSON.stringify(job));
   for(const name of ['update-stage.ps1','update-install.ps1']){
    const body=await fs.readFile(path.join(appRoot,'assets',name),'utf8');await fs.writeFile(path.join(dir,name),'\ufeff'+body.replace(/^\ufeff/,''),'utf8');
   }
   await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(dir,'update-stage.ps1'),'-JobFile',jobFile]);
   return {...job,jobFile};
  },
  async install(job){
   const options={type:'question',title:'安装更新',message:'安装 '+job.version+' 并重启谷谷bot？',detail:'请先保存当前编辑。更新期间机器人暂时停止处理消息，完成后重新启动。',buttons:['取消','安装并重启'],defaultId:0,cancelId:0};
   const choice=window()?await dialog.showMessageBox(window(),options):await dialog.showMessageBox(options);if(choice.response!==1)return false;
   // Write helper before quitting. The detached helper waits for this exact PID.
   const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(job.dir,'update-install.ps1'),'-JobFile',job.jobFile],{detached:true,stdio:'ignore',windowsHide:true});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('安装辅助程序无法启动')));});child.unref();
   setTimeout(async()=>{try{await shutdown();app.quit();}catch{await dialog.showMessageBox(window(),{type:'error',message:'退出前保存未完成，请稍后重试更新'});}},800);
   return true;
  }
 });
};
