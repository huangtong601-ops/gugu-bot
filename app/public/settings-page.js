import {createUpdateSettings} from './update-settings.js';
export function createSettingsPage({api,notice,refresh=async()=>{},beforeSwitch=()=>{},beforeUpdate=beforeSwitch,afterSwitch=()=>location.reload(),onWorkspaceChange=()=>{}}){
 const $=id=>document.getElementById(id),root=$('settings');let saved={mode:'local',url:''},busy=false,adminBusy=false,adminState={qqAdmins:[],qqAdminVersion:0},adminKey='';
 const element=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
 const model=$('settingsForm').closest('article'),qq=element('article','settings');
 qq.append($('qqConnectionPanel'));model.append($('keyStatus'));
 const entry=root.querySelector('.setup-entry'),layout=element('div','settings-layout'),nav=element('nav','settings-nav'),content=element('div','settings-content');
 nav.setAttribute('aria-label','设置分类');
 const panes=new Map(),groups=[['model','模型服务','服务商、模型与计费',[model,$('usageSettingsPanel')]],['qq','QQ 机器人','登录、连接与群聊',[qq,$('qqGroupPanel')]],['business','排表设置','群内录入方式',[$('qqEnrollmentPanel')]],['skills','技能与术语','导入技能、核对术语',[$('skillSettingsPanel')]],['server','服务器连接','选择工作区位置',[]],['update','软件更新','版本与更新',[]]];
 for(const [id,title,subtitle,nodes]of groups){
  const button=element('button','settings-nav-item');button.type='button';button.dataset.settingsTab=id;button.append(element('strong',null,title),element('small',null,subtitle));button.setAttribute('aria-controls','settings-pane-'+id);button.onclick=()=>select(id);nav.append(button);
  const pane=element('div','settings-pane');pane.id='settings-pane-'+id;pane.hidden=true;pane.append(...nodes);panes.set(id,pane);content.append(pane);
 }
 layout.append(nav,content);root.replaceChildren(entry,layout);
 const updates=createUpdateSettings({host:panes.get('update'),api,beforeInstall:beforeUpdate});
 const server=element('article','settings server-settings');server.innerHTML=`<div class="section-heading"><h2>服务器连接</h2><span id="serverModeBadge" class="settings-badge">本机运行</span></div>
 <form id="serverConnectionForm"><label>运行方式<select id="serverMode"><option value="local">本机运行</option><option value="remote">连接服务器</option></select></label>
 <div id="serverRemoteFields" hidden><label>服务器地址<input id="serverAddress" type="url" autocomplete="off" placeholder="https://bot.example.com"></label><label>访问令牌<input id="serverAccessToken" type="password" autocomplete="off" spellcheck="false" maxlength="256" placeholder="填写服务器生成的访问令牌"></label></div>
 <div class="actions"><button id="serverTest" type="button" class="secondary" hidden>测试连接</button><button id="serverSave" type="submit">保存设置</button></div></form>
 <p id="serverConnectionStatus" role="status" aria-live="polite"></p><dl class="server-workspace-info"><dt>当前工作区</dt><dd id="serverCurrentWorkspace">本机</dd><dt>最近连接</dt><dd id="serverLastConnected">—</dd></dl>`;
 panes.get('server').append(server);
 const admin=element('article','settings admin-settings');admin.innerHTML='<div class="section-heading"><h2>管理员</h2><button id="qqAdminAdd" type="button" class="secondary">新增管理员</button></div><div id="qqAdminList" class="admin-list" aria-label="已保存的管理员"></div><form id="qqAdminForm" hidden><label for="qqAdminAccount">管理员 QQ</label><div class="admin-input-row"><input id="qqAdminAccount" inputmode="numeric" pattern="[0-9]{5,12}" maxlength="12" autocomplete="off" required><button id="qqAdminSave" type="submit">保存</button><button id="qqAdminCancel" type="button" class="secondary">取消</button></div></form><p id="qqAdminStatus" role="status" aria-live="polite"></p>';panes.get('qq').insertBefore(admin,$('qqGroupPanel'));
 function adminForm(show){$('qqAdminForm').hidden=!show;$('qqAdminAdd').hidden=show;if(!show)$('qqAdminAccount').value='';else $('qqAdminAccount').focus();}
 function adminLoading(value){adminBusy=value;for(const control of admin.querySelectorAll('button,input'))control.disabled=value;}
 function syncAdmins(next){
  const list=Array.isArray(next.qqAdmins)?next.qqAdmins:next.qqAdmin?[String(next.qqAdmin)]:[],version=next.qqAdminVersion||0,key=JSON.stringify([list,version]);adminState={qqAdmins:list,qqAdminVersion:version};if(key===adminKey)return;adminKey=key;
  const host=$('qqAdminList');host.replaceChildren();if(!list.length)host.append(element('p','hint admin-empty','尚未添加管理员'));
  for(const qq of list){const row=element('div','admin-row'),number=element('span','admin-qq',qq),remove=element('button','admin-remove','删除');remove.type='button';remove.disabled=adminBusy;remove.setAttribute('aria-label','删除管理员 '+qq);remove.onclick=()=>mutateAdmin('remove',qq);row.append(number,remove);host.append(row);}
 }
 async function mutateAdmin(action,qq){if(adminBusy)return;adminLoading(true);$('qqAdminStatus').textContent=action==='add'?'正在保存…':'正在删除…';try{const result=await api('qq-admin',{action,qqAdmin:qq,version:adminState.qqAdminVersion});syncAdmins(result);if(action==='add')adminForm(false);await refresh().catch(()=>{});$('qqAdminStatus').textContent=action==='add'?'已保存':'已删除';}catch(e){await refresh().catch(()=>{});$('qqAdminStatus').textContent=e.message;}finally{adminLoading(false);}}
 $('qqAdminAdd').onclick=()=>{adminForm(true);$('qqAdminStatus').textContent='';};$('qqAdminCancel').onclick=()=>{adminForm(false);$('qqAdminStatus').textContent='';$('qqAdminAdd').focus();};
 $('qqAdminForm').onsubmit=e=>{e.preventDefault();void mutateAdmin('add',$('qqAdminAccount').value);};
 function select(id){if(!panes.has(id))id='model';for(const [key,pane]of panes)pane.hidden=key!==id;for(const b of nav.children){b.classList.toggle('active',b.dataset.settingsTab===id);b.setAttribute('aria-current',b.dataset.settingsTab===id?'page':'false');}if(id==='update')void updates.load();root.dispatchEvent(new Event('settings-panel-change'));}
 function drawMode(){const remote=$('serverMode').value==='remote';$('serverRemoteFields').hidden=!remote;$('serverAddress').required=remote;$('serverTest').hidden=!remote;$('serverSave').textContent=remote?'保存并启用服务器':saved.mode==='remote'?'切回本机运行':'保存设置';}
 function status(text){$('serverConnectionStatus').textContent=text;}
 function setBusy(value){busy=value;for(const id of ['serverMode','serverAddress','serverAccessToken','serverTest','serverSave'])$(id).disabled=value;$('serverSave').setAttribute('aria-busy',String(value));}
 function drawSaved(){
  const remote=saved.mode==='remote';$('serverModeBadge').textContent=remote?'服务器模式':'本机运行';$('serverCurrentWorkspace').textContent=remote?(saved.name||'谷谷bot服务器')+' · '+saved.url:'本机';$('serverLastConnected').textContent=saved.lastSuccess?new Date(saved.lastSuccess).toLocaleString('zh-CN',{hour12:false}):'—';onWorkspaceChange();
  $('qqRuntimePicker').hidden=remote;for(const id of ['qqPrepare','qqLoginWindow','qqAccountForm','openSetupGuide'])$(id).hidden=remote;
  $('qqConnectionPanel').querySelector('h2').textContent=remote?'服务器 QQ 机器人':'连接 QQ 机器人';$('qqCheckLogin').textContent=remote?'检查在线状态':'检查登录状态';$('qqUrl').closest('label').firstChild.textContent=remote?'服务器本机 OneBot WebSocket 地址':'本机 OneBot WebSocket 地址';
  $('serverAccessToken').placeholder=saved.hasToken?'已安全保存；留空沿用此地址的令牌':'填写服务器生成的访问令牌';
 }
 async function load(){saved=await api('server-connection');$('serverMode').value=saved.mode;$('serverAddress').value=saved.url||'';$('serverAccessToken').value='';drawSaved();drawMode();if(saved.lastError)status(saved.lastError);return saved;}
 $('serverMode').onchange=()=>{drawMode();status('');};
 $('serverTest').onclick=async()=>{if(busy)return;setBusy(true);status('正在测试连接…');try{const r=await api('server-test',{url:$('serverAddress').value,token:$('serverAccessToken').value});status('连接成功 · '+r.name+' · '+r.version);}catch(e){status(e.message);}finally{setBusy(false);}};
 $('serverConnectionForm').onsubmit=async e=>{e.preventDefault();if(busy)return;setBusy(true);status('正在保存…');try{await beforeSwitch();const result=await api('server-connection',{mode:$('serverMode').value,url:$('serverAddress').value,token:$('serverAccessToken').value});$('serverAccessToken').value='';const changed=result.mode!==saved.mode||result.url!==saved.url||result.serverId!==saved.serverId;saved=result;drawSaved();status('已保存');if(changed)await afterSwitch();}catch(e){status(e.message);notice(e.message);}finally{setBusy(false);drawMode();}};
 select('model');return {load,select,isRemote:()=>saved.mode==='remote',workspace:()=>({mode:saved.mode,url:saved.url||'',serverId:saved.serverId||''}),sync:syncAdmins};
}
