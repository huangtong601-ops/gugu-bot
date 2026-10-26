export function connectionSummary(state,account={},checking=false){
 const configured=!!state?.qqSettings?.url||state?.qq?.connected===true,connected=state?.qq?.connected===true;
 const qq=/^\d{5,12}$/.test(String(account.qq||''))?String(account.qq):'';
 const title=qq?'QQ '+qq:configured?'已保存机器人连接':'尚未连接机器人';
 if(!configured)return {configured,title,label:'未配置',tone:'neutral'};
 if(!connected)return {configured,title,label:'连接已断开',tone:'offline'};
 if(account.online===true&&qq)return {configured,title,label:'在线',tone:'online'};
 if(account.online===false)return {configured,title,label:'QQ 未登录',tone:'offline'};
 return {configured,title,label:checking?'正在确认':account.error?'检查失败':'等待确认',tone:'neutral'};
}

export function createQQConnection({api,isSetup=()=>false,isQQSetup=()=>false}){
 const $=id=>document.getElementById(id),panel=$('qqConnectionPanel'),heading=panel.querySelector('h2');
 const controls=[...panel.children].filter(n=>n!==heading),overview=document.createElement('div'),details=document.createElement('details'),toggle=document.createElement('summary');
 overview.id='qqConnectionOverview';overview.className='qq-connection-overview';
 overview.innerHTML='<span class="qq-account-icon" aria-hidden="true">QQ</span><div class="qq-account-info"><strong id="qqConnectedAccount">尚未连接机器人</strong><span id="qqConnectedNickname" hidden></span></div><span id="qqConnectionBadge" class="qq-connection-badge" role="status" aria-live="polite">未配置</span>';
 details.id='qqConnectionDetails';details.className='qq-connection-details';toggle.id='qqConnectionToggle';toggle.textContent='管理连接';details.append(toggle,...controls);panel.append(overview,details);
 let state=null,account={},checking=false,active=null,lastChecked=0,manualOpen=null,assignedOpen=false,lastConfigured=null,lastConnection='',lastURL='',generation=0,seeded=false;
 const visible=()=>isQQSetup()||(!$('settings').hidden&&!$('settings-pane-qq').hidden&&!isSetup());
 function draw(){
  const view=connectionSummary(state,account,checking),setup=isSetup();
  if(!heading.textContent.startsWith('服务器'))heading.textContent=view.configured&&!setup?'QQ 机器人':'连接 QQ 机器人';
  if(lastConfigured!==view.configured){lastConfigured=view.configured;manualOpen=null;}
  assignedOpen=setup||!view.configured||manualOpen===true;details.open=assignedOpen;
  toggle.hidden=setup||!view.configured;toggle.textContent=details.open?'收起连接设置':'管理连接';overview.hidden=setup;
  $('qqConnectedAccount').textContent=view.title;$('qqConnectionBadge').textContent=view.label;$('qqConnectionBadge').dataset.tone=view.tone;
  $('qqConnectedNickname').textContent=String(account.nickname||'').slice(0,80);$('qqConnectedNickname').hidden=!account.nickname;
 }
 async function check(force=false){
  if(!state||!visible()||!state.qq?.connected)return;
  if(active)return active;if(!force&&Date.now()-lastChecked<15000)return;
  lastChecked=Date.now();checking=true;const token=generation;draw();
  active=(async()=>{try{
   const result=await api('qq-status',{}),qq=String(result.identity?.user_id||'');if(token!==generation)return;if(!/^\d{5,12}$/.test(qq))throw Error('账号身份未确认');
   account={qq,nickname:String(result.identity?.nickname||'').slice(0,80),online:result.status?.online===true};
   if(!seeded&&account.qq){seeded=true;if(!$('qqAccount').value&&document.activeElement!==$('qqAccount'))$('qqAccount').value=account.qq;}
  }catch{if(token===generation)account={...account,online:null,error:true};}
  finally{checking=false;active=null;draw();if(token!==generation)void check();}})();return active;
 }
 function sync(next){state=next;const url=String(state?.qqSettings?.url||''),connection=url+'|'+String(state?.qq?.connected===true);if(url!==lastURL){lastURL=url;account={};seeded=false;}if(connection!==lastConnection){lastConnection=connection;generation++;account={...account,online:null,error:false};lastChecked=0;}draw();void check();}
 toggle.addEventListener('click',e=>{if(isSetup()||!connectionSummary(state).configured)return;e.preventDefault();manualOpen=!details.open;draw();});
 details.addEventListener('toggle',()=>{toggle.textContent=details.open?'收起连接设置':'管理连接';});
 $('settings').addEventListener('settings-panel-change',()=>{void check(true);});
 draw();return {sync,check,connected(qq){account={...account,qq:String(qq||account.qq||''),online:true,error:false};manualOpen=null;draw();}};
}
