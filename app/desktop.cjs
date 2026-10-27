const { app, BrowserWindow, shell, safeStorage,dialog,nativeImage,Tray,Menu,session } = require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{randomBytes,createHash}=require('node:crypto');
const {isQQNT,findPortableQQ,runtimePaths,findNodeRuntime,saveRuntimePath}=require('./qq-runtime.cjs');
// Keep source and packaged upgrades on the same profile. An explicit launch
// directory supports independent workspaces and clean first-run verification.
const profileDirectory=app.commandLine.getSwitchValue('user-data-dir');
const userDataDirectory=profileDirectory?path.resolve(profileDirectory):path.join(app.getPath('appData'),'pingu-desk');
fs.mkdirSync(userDataDirectory,{recursive:true});app.setPath('userData',userDataDirectory);app.setPath('sessionData',userDataDirectory);
// Display name changes must not move the established profile or Windows identity.
app.setName('谷谷bot');
let service,win=null,tray=null,quitting=false,trayHintShown=false;
const iconPath=path.join(__dirname,'assets','icon.ico'),trayPath=path.join(__dirname,'assets','tray.png');
function showWindow(){if(!win||win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();}
function buildTray(){
  const icon=nativeImage.createFromPath(trayPath);
  tray=new Tray(icon.isEmpty()?nativeImage.createEmpty():icon);
  tray.on('click',showWindow);tray.on('double-click',showWindow);
  const refresh=()=>{const qq=service?.status?.().qq||'未连接',remote=service?.isRemote?.();tray.setToolTip(remote?'谷谷bot · 服务器工作区':`谷谷bot · QQ ${qq}\n关闭窗口后机器人继续在后台运行`);
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'打开谷谷bot',click:showWindow},
      {type:'separator'},
      {label:`QQ：${qq}`,enabled:false},
      {type:'separator'},
      {label:remote?'退出谷谷bot':'退出（机器人也会停止）',click:()=>{quitting=true;app.quit();}}
    ]));};
  refresh();const timer=setInterval(refresh,15000);timer.unref?.();
}
// A second launch must not open a second QQ connection; it only brings the running window back.
if(!app.requestSingleInstanceLock()){app.quit();}
else {
app.setAppUserModelId('local.pingu.desk');
app.on('second-instance',showWindow);
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  const { start } = await import('./server.mjs');
  const { createCredentialStore } = await import('./credentials.mjs');
  const dataDir=app.getPath('userData');
  const credentialStore=createCredentialStore(dataDir,{
    encrypt:bytes=>{if(!safeStorage.isEncryptionAvailable())throw Error('本机密钥加密服务不可用');return safeStorage.encryptString(bytes.toString('utf8'));},
    decrypt:bytes=>Buffer.from(safeStorage.decryptString(bytes),'utf8')
  });
  let loginWindow;
  const updater=await require('./app-update-desktop.cjs')({app,dialog,window:()=>win,shutdown:()=>service?.shutdown()});
  const desktopActions={
    async appUpdate(action){if(!['snapshot','check','download','install'].includes(action))throw Error('更新操作无效');return updater[action]();},
    async openNapcatDownload(){await shell.openExternal('https://github.com/NapNeko/NapCatQQ/releases/latest');},
    async qqRuntimeInfo(){try{const runtime=runtimePaths(__dirname,dataDir);return {supported:true,available:runtime.kind==='node'||fs.existsSync(path.join(runtime.root,'napimain.exe')),root:runtime.root,kind:runtime.kind,source:runtime.source};}catch(e){return {supported:true,available:false,root:'',error:e.message};}},
    async selectQQRuntime({connected=false}={}){
      const picked=await dialog.showOpenDialog(win||undefined,{title:'选择已解压的 NapCat Windows Node 运行包文件夹',properties:['openDirectory']});
      if(picked.canceled)return {cancelled:true};const selected=findNodeRuntime(picked.filePaths[0]);if(!selected)throw Error('未找到完整的NapCat Windows Node运行包。请先解压 NapCat.Shell.Windows.Node.zip，再选择包含 node.exe 和 index.js 的文件夹');
      let previous;try{previous=runtimePaths(__dirname,dataDir);}catch{}
      if(connected&&previous?.root.toLowerCase()!==selected.root.toLowerCase())throw Error('当前机器人已连接。请先退出原NapCat运行环境，再选择新的位置');
      saveRuntimePath(dataDir,selected);return {...await desktopActions.qqRuntimeInfo(),ok:true};
    },
    async prepareAlbumImages(bytes){const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('相册图片无法解码');const {width,height}=image.getSize(),{planImageTiles}=await import('./public/image-geometry.js');return planImageTiles(width,height).map(bounds=>'data:image/jpeg;base64,'+image.crop(bounds).toJPEG(94).toString('base64'));},
    async openQQLogin(url){const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.protocol!=='http:')throw Error('QQ登录地址无效');if(loginWindow&&!loginWindow.isDestroyed()){loginWindow.show();loginWindow.focus();return;}loginWindow=new BrowserWindow({width:1000,height:780,title:'QQ登录',icon:iconPath,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});loginWindow.webContents.on('will-navigate',(e,dest)=>{if(new URL(dest).origin!==u.origin)e.preventDefault();});loginWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));await loginWindow.loadURL(url);loginWindow.show();loginWindow.focus();},
    async prepareQQ(){
      const managed=runtimePaths(__dirname,dataDir);
      if(managed.kind==='node'){
        const file=path.join(managed.configRoot,'config/webui.json');let cfg={};try{cfg=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
        cfg.port||=6099;let response;try{response=await fetch('http://127.0.0.1:'+cfg.port+'/webui/',{signal:AbortSignal.timeout(1500)});}catch{}
        if(response){let auth;try{if(cfg.token&&response.ok){const r=await fetch('http://127.0.0.1:'+cfg.port+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hash:createHash('sha256').update(cfg.token+'.napcat').digest('hex')}),signal:AbortSignal.timeout(2000)});auth=await r.json();}}catch{}if(auth?.code===0&&auth.data?.Credential)return {ready:true,message:'QQ登录服务已启动'};throw Error('QQ登录端口被其他运行环境占用，请先退出原NapCat，再启动所选环境');}
        cfg.host='127.0.0.1';cfg.port||=6099;cfg.token||=randomBytes(32).toString('hex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(cfg,null,2));
        // 单进程模式：NapCat 默认会 fork 一个 worker，Windows 11 会把它接到可见终端窗口；关掉多进程以保持静默。
        const child=spawn(path.join(managed.root,'node.exe'),['index.js'],{cwd:managed.root,detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,NAPCAT_DISABLE_MULTI_PROCESS:'1'}});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('QQ登录服务启动失败')));});child.unref();return {message:'QQ登录服务正在启动'};
      }
      const runtime=path.resolve(__dirname,'../runtime/napcat/framework'),installer=path.resolve(__dirname,'../runtime/napcat/onekey/NapCatInstaller.exe');
      if(!fs.existsSync(path.join(runtime,'napimain.exe')))throw Error('尚未下载QQ运行组件');
      const webuiFile=path.join(runtime,'config/webui.json');let config={};if(fs.existsSync(webuiFile))config=JSON.parse(fs.readFileSync(webuiFile,'utf8'));
      if(config.port){try{const response=await fetch('http://127.0.0.1:'+config.port+'/webui/',{signal:AbortSignal.timeout(1500)});if(response.ok)return {ready:true,message:'QQ登录服务已启动'};}catch{}}
      const remembered=path.join(dataDir,'qq-runtime.json');let savedPath;try{savedPath=JSON.parse(fs.readFileSync(remembered,'utf8')).qqPath;}catch{}
      let qq=isQQNT(savedPath)?savedPath:findPortableQQ(path.dirname(installer));
      if(!qq){
      const choice=await dialog.showMessageBox({type:'question',title:'准备QQ运行环境',message:'选择QQ运行环境',detail:'独立安装器来自NapCat官方发行版。也可以选择已有的QQNT客户端。',buttons:['选择已有QQNT','运行官方安装器','取消'],defaultId:0,cancelId:2});
      if(choice.response===2)return {cancelled:true};
      if(choice.response===1){if(!fs.existsSync(installer))throw Error('安装器尚未下载');spawn(installer,[],{cwd:path.dirname(installer),detached:true,stdio:'ignore',windowsHide:false}).unref();return {message:'已打开官方安装器，完成后再次选择QQNT启动'};}
      const picked=await dialog.showOpenDialog({title:'选择机器人使用的QQNT客户端 QQ.exe',properties:['openFile'],filters:[{name:'QQ客户端',extensions:['exe']}]});if(picked.canceled)return {cancelled:true};qq=picked.filePaths[0];if(!isQQNT(qq))throw Error('请选择QQNT客户端QQ.exe');
      }
      config.host='127.0.0.1';config.port=config.port||6099;config.token||=randomBytes(32).toString('hex');fs.writeFileSync(webuiFile,JSON.stringify(config,null,2));fs.writeFileSync(remembered,JSON.stringify({qqPath:qq}));
      const child=spawn(path.join(runtime,'napimain.exe'),[qq,path.join(runtime,'napiloader.dll'),path.join(runtime,'nativeLoader.cjs').replaceAll('\\','/')],{cwd:runtime,detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,NAPCAT_DISABLE_BYPASS:'1'}});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('QQ登录服务启动失败')));});child.unref();return {message:'QQ登录服务正在启动，请稍后检查登录状态'};
    }
  };
  try{let remote=false;try{remote=JSON.parse(fs.readFileSync(path.join(dataDir,'server-connection.json'),'utf8')).mode==='remote';}catch{}const previous=JSON.parse(fs.readFileSync(path.join(dataDir,'workspace.json'),'utf8'));if(!remote&&previous.qqSettings?.url&&runtimePaths(__dirname,dataDir).kind==='node')await desktopActions.prepareQQ();}catch{}
  service = await start({port:0, dataDir, credentialStore,desktopActions});
  win = new BrowserWindow({title:'谷谷bot',width:1240,height:850,minWidth:900,minHeight:650,backgroundColor:'#f4f6fa',icon:fs.existsSync(iconPath)?iconPath:undefined,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.removeMenu();
  // Preserve the documented page refresh shortcuts after removing the native menu.
  win.webContents.on('before-input-event',(event,input)=>{
    if(input.type==='keyDown'&&!input.alt&&!input.meta&&!input.shift&&(input.key==='F5'||(input.control&&input.key.toLowerCase()==='r'))){event.preventDefault();win.webContents.reload();}
  });
  // Closing the window only hides it; the QQ connection keeps running until "退出" in the tray menu.
  win.on('close',event=>{
    if(quitting)return;
    event.preventDefault();win.hide();
    if(!trayHintShown&&tray){trayHintShown=true;try{tray.displayBalloon({title:'谷谷bot',content:'窗口已收进托盘，机器人在后台继续运行。单击或双击托盘图标可重新打开，退出请用托盘右键菜单。',iconType:'info',noSound:true});}catch{}}
  });
  win.webContents.setWindowOpenHandler(({url}) => {try{const u=new URL(url);if(u.protocol==='https:'&&u.hostname==='prts.wiki')void shell.openExternal(url);}catch{}return {action:'deny'};});
  win.webContents.on('will-navigate', (event, url) => {if (new URL(url).origin !== service.url) event.preventDefault();});
  buildTray();
  await win.loadURL(service.url);
  win.show();
  win.focus();
}).catch(error => {console.error(error.message);app.quit();});
}
app.on('before-quit',()=>{quitting=true;try{service?.server.close();}catch{}});
