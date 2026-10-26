import {firstSetupStep} from './setup-state.js';
export function createSetupGuide({api,refresh,getState,onEnter,onVisibility=()=>{}}){
 const $=id=>document.getElementById(id),dialog=$('setupGuide');
 let step=0,busy=false,identity='',mounts=[],started=false;
 const titles=['连接模型服务','准备NapCat环境','绑定QQ机器人','可以开始拼谷了'];
 const descriptions=['选择服务商，填入API密钥，再选择模型版本。','从官方页面下载运行包，解压后选择它的位置。','登录机器人账号，并填写接收管理权限的个人QQ。','连接已保存。接下来启用群聊、新建期次，再导入商品。'];
 const status=text=>{$('setupStatus').textContent=text;};
 function draw(){
  $('setupTitle').textContent=titles[step];$('setupDescription').textContent=descriptions[step];
  document.querySelectorAll('[data-setup-panel]').forEach(p=>p.hidden=Number(p.dataset.setupPanel)!==step);
  document.querySelectorAll('[data-setup-step]').forEach((p,i)=>{p.classList.toggle('current',i===step);p.classList.toggle('done',i<step);if(i===step)p.setAttribute('aria-current','step');else p.removeAttribute('aria-current');});
  $('setupBack').hidden=step===0||step===3;$('setupFinish').hidden=step===0;
  $('setupFinish').textContent=step===3?'进入谷谷bot':step===1?'继续登录QQ':'确认并完成';
  $('setupFooter').hidden=step===0;
  $('saveSettings').textContent='保存并继续';
  dialog.scrollTop=0;
  if(step===3){const s=getState();$('setupModelSummary').textContent=s.settings.model;$('setupQQSummary').textContent=identity;$('setupAdminSummary').textContent=s.qqAdmins?.join('、')||s.qqAdmin;}
  onVisibility();
 }
 function move(id,slot){const node=$(id),anchor=document.createComment('setup origin '+id);node.before(anchor);$(slot).append(node);mounts.push({node,anchor});}
 function close(){if(busy)return;dialog.close();}
 function open(force=false){
  if(dialog.open)return;
  const s=getState(),initial=force?0:firstSetupStep(s);if(initial===null)return;
  step=initial;status('');$('setupAdmin').value=s.qqAdmin||'';
  move('settingsForm','setupModelSlot');move('keyStatus','setupModelSlot');move('qqRuntimePicker','setupRuntimeSlot');move('qqConnectionPanel','setupQQSlot');
  dialog.showModal();draw();
  void api('onboarding-start',{}).catch(e=>status(e.message));
 }
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('close',()=>{for(const {node,anchor}of mounts){anchor.replaceWith(node);}mounts=[];$('saveSettings').textContent='保存并检查连接';$('qqAccountPassword').value='';onVisibility();});
 $('setupClose').onclick=close;$('setupBack').onclick=()=>{if(!busy){step=Math.max(0,step-1);status('');draw();}};
 $('openSetupGuide').onclick=()=>open(true);
 $('setupFinish').onclick=async()=>{
  if(step===3){dialog.close();onEnter();return;}
  if(busy)return;busy=true;$('setupFinish').disabled=true;$('setupClose').disabled=true;$('setupBack').disabled=true;status('正在确认机器人在线状态…');
  try{if(step===1){const runtime=await api('qq-runtime');if(!runtime.available)throw Error('请先下载并解压NapCat，再选择有效的运行包文件夹');step=2;status('');draw();return;}const r=await api('onboarding-complete',{adminQQ:$('setupAdmin').value,qq:$('qqAccount').value});identity=r.qq;await refresh();step=3;status('');draw();}
  catch(e){status(e.message);}
  finally{busy=false;$('setupFinish').disabled=false;$('setupClose').disabled=false;$('setupBack').disabled=false;}
 };
 return {
  start(){if(started)return;started=true;open();},
  isOpen:()=>dialog.open,
  isQQ:()=>dialog.open&&step===2,
  notice(text){if(dialog.open)status(text);},
  modelSaved(){if(dialog.open&&step===0){step=1;status('API已保存并验证成功');draw();}},
 };
}
