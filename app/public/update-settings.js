export function createUpdateSettings({host,api,beforeInstall=()=>{}}){
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 const panel=node('article','settings update-settings'),head=node('div','section-heading'),title=node('h2',null,'软件更新'),version=node('span','settings-badge'),status=node('p','update-status'),notes=node('pre','update-notes'),actions=node('div','actions'),check=node('button','secondary','检查更新'),download=node('button',null,'下载更新'),install=node('button',null,'安装并重启'),progress=node('progress');
 check.id='updateCheck';download.id='updateDownload';install.id='updateInstall';status.id='updateStatus';status.setAttribute('role','status');progress.max=1;progress.setAttribute('aria-label','更新下载进度');
 head.append(title,version);actions.append(check,download,install);panel.append(head,status,progress,notes,actions);host.append(panel);let busy=false,poll=null;
 const phases={idle:'点击检查更新获取最新正式版',checking:'正在检查更新…','up-to-date':'当前版本已是最新，或高于最新正式版',available:'发现新版本',downloading:'正在下载并校验…',ready:'已下载并通过校验，可以安装',installing:'正在退出并安装更新…',unsupported:'请在Windows x64桌面程序中检查更新'};
 function draw(s){version.textContent='当前版本 '+s.currentVersion;status.textContent=s.error||phases[s.phase]||'';if(s.version&&s.phase==='available')status.textContent+=' '+s.version;if(s.lastResult?.phase==='failed'&&s.phase==='idle')status.textContent=s.lastResult.message;
  const active=busy||['checking','downloading','installing'].includes(s.phase);check.disabled=active||s.supported===false;download.hidden=!s.canDownload;download.disabled=active;install.hidden=!s.canInstall;install.disabled=active;
  progress.hidden=s.phase!=='downloading';progress.value=s.total?s.transferred/s.total:0;if(!progress.hidden&&s.total)status.textContent+=` ${Math.min(100,Math.floor(s.transferred/s.total*100))}%`;
  notes.textContent=s.notes||'';notes.hidden=!s.notes;
 }
 async function load(){try{draw(await api('app-update'));}catch(e){status.textContent=e.message;}}
 async function run(action){if(busy)return;try{if(action==='install')await beforeInstall();busy=true;for(const b of actions.children)b.disabled=true;poll=setInterval(()=>void load(),700);const s=await api('app-update',{action});busy=false;draw(s);}catch(e){busy=false;await load();status.textContent=e.message;}finally{clearInterval(poll);poll=null;}}
 check.onclick=()=>void run('check');download.onclick=()=>void run('download');install.onclick=()=>void run('install');return {load};
}
