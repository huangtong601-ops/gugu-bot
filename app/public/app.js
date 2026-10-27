import {createAlbumScopePicker,selectedAlbumCategories,albumSelectionKey} from './album-scope-picker.js';
import {createCatalogFeedback} from './catalog-feedback.js';
import {createProductFinder} from './product-finder.js';
import {createRuntimeStatus} from './runtime-status.js';
import {createSkillSettings} from './skill-settings.js';
import {createAlbumPicker} from './album-picker.js';
import {createModelPicker} from './model-picker.js';
import {createProductEditor,fileData,cropProduct} from './product-editor.js';
import {prepareImageParts} from './image-input.js';
import {validateImageSelection,runImageBatch} from './image-batch.js';
import {createOrderWorkspaces} from './order-workspaces.js';
import {createSetupGuide} from './setup-guide.js';
import {createRuntimePicker} from './runtime-picker.js';
import {createUsageSettings} from './usage-settings.js';
import {createEnrollmentTable} from './enrollment-table.js';
import {createSettingsPage} from './settings-page.js';
import {createQQConnection} from './qq-connection.js';
import {createWorkspaceTools} from './workspace-tools.js';
const $=id=>document.getElementById(id);
let state,currentId='',groupId='',botId='zhougu',images=[],pending=null,dirty=false,currentPage='workspace',imageGeneration=0;let groupCandidates=[];const uiPrefs={};let uiRestored=false;
const drafts=new Map();const manualSelections=new Map();let qqPresentation=null,workspaceTools=null,runtimeStatus=null,catalogFeedback=null;const undoClient=crypto.randomUUID();
const setupGuide=createSetupGuide({api,refresh,getState:()=>state,onEnter:()=>page('settings'),onVisibility:()=>qqPresentation?.sync(state)});
const albumPicker=createAlbumPicker({api,action,notice,current,activeGroup:()=>groupId,bindings:()=>state?.albums||[],refresh});
async function api(route,body){const r=await fetch('/api/'+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,undoClient})}:{});const d=await r.json();if(!r.ok)throw Error(d.error);workspaceTools?.maintenance(d.maintenance);workspaceTools?.saved(route,body,d.undo);return d;}
let prefTimer=0;
function savePrefs(patch={}){Object.assign(uiPrefs,patch);clearTimeout(prefTimer);prefTimer=setTimeout(()=>{if(!state)return;api('ui-prefs',{...uiPrefs,botId,groupId,campaignId:currentId}).catch(()=>{});},250);}
function notice(t){$('notice').textContent=t;setupGuide.notice(t);fitWorkbenches();}
async function action(fn){notice('');try{await fn();}catch(e){notice(e.message);}}
function current(){return state?.campaigns.find(c=>c.id===currentId&&c.botId===botId);}
function memberOf(qq){const g=String(current()?.groupId||groupId||'');return state?.groupMembers?.[g]?.[String(qq)]?.cn||state?.members?.[String(qq)]?.cn||'';}
function clearPending(){pending=null;$('confirm').disabled=true;$('manualRecognized').replaceChildren();}
function itemMenu(onDelete){
 const menu=document.createElement('details');menu.className='recognized-menu';
 const toggle=document.createElement('summary');toggle.textContent='⋯';toggle.setAttribute('aria-label','商品条目操作');
 const del=document.createElement('button');del.type='button';del.textContent='删除';del.className='recognized-delete';
 del.onclick=()=>{menu.open=false;onDelete();};menu.append(toggle,del);return menu;
}
function renderManualResult(){
 const host=$('manualRecognized');host.replaceChildren();if(!pending)return;
 const issues=pending.questions||[],bad=new Set(issues.map(q=>q.entryKey));
 pending.items=(pending.lines||[]).filter(l=>l.skuId&&!bad.has(l.entryKey)).map(l=>({skuId:l.skuId,quantity:l.quantity}));
 for(const line of pending.lines||[]){
  const row=document.createElement('div');row.className='recognized-entry';
  const text=document.createElement('span'),issue=issues.find(q=>q.entryKey===line.entryKey);
  text.textContent=issue?issue.message:(current()?.products.find(p=>p.id===line.skuId)?.name||line.phrase)+' ×'+line.quantity;
  row.append(text,itemMenu(()=>{pending.lines=pending.lines.filter(l=>l.entryKey!==line.entryKey);pending.questions=issues.filter(q=>q.entryKey!==line.entryKey);renderManualResult();}));host.append(row);
 }
 const ready=pending.items.length>0&&!issues.length;
 $('confirm').disabled=!ready||current()?.orderLifecycle?.status==='completed';
 $('parsed').textContent=ready?'识别完成，确认后入表':issues.length?'请补充信息，或删除不需要的条目':'没有待入表商品';
}

const picker=createModelPicker(api,notice);
const runtimePicker=createRuntimePicker(api,notice);
const usageSettings=createUsageSettings({api,notice,getState:()=>state});
const skillSettings=createSkillSettings({api,action,notice,onImported:async bot=>{preserveDraft();botId=bot.id;await refresh();loadCampaign();}});
const editor=createProductEditor({api,notice,getCampaign:current,prefs:uiPrefs,onPrefs:savePrefs,onChange:event=>{const wasDirty=dirty;dirty=event?.restored?event.dirty:true;if(!dirty)drafts.delete(currentId);$('publish').textContent=dirty?'保存商品 *':'保存商品';catalogFeedback?.changed();if(event?.before){const id=currentId,revision=current()?.revision;workspaceTools?.local({local:true,label:'编辑商品',scope:'catalog:'+id,undo:()=>{if(currentId!==id)throw Error('请切回原期次再撤销商品编辑');if(current()?.revision!==revision)throw Error('商品目录已有新版本，请先核对当前草稿');editor.restore(event.before,wasDirty);}});}}});
document.addEventListener('wheel',e=>{const t=e.target;if(t instanceof HTMLInputElement&&t.type==='number'&&document.activeElement===t){e.preventDefault();t.blur();}},{passive:false});
const orderWorkspaces=createOrderWorkspaces({api,notice,action,current,refresh,onDraftChange:entry=>workspaceTools?.local(entry),hasCatalogDrafts:()=>dirty});
const enrollmentTable=createEnrollmentTable({api,current,onChanged:()=>refresh()});
const settingsPage=createSettingsPage({api,notice,refresh,onWorkspaceChange:()=>runtimeStatus?.workspaceChanged(),beforeSwitch:()=>{if(dirty||[...drafts].some(([id,d])=>state?.campaigns.some(c=>c.id===id&&c.revision===d.revision))||pending||orderWorkspaces.hasUnsaved?.())throw Error('请先保存建档、下单或折算编辑，并处理当前识别结果，再切换工作区');clearTimeout(prefTimer);}});
workspaceTools=createWorkspaceTools({api,notice,refresh,hasUnsaved:()=>dirty||pending||[...drafts.values()].length>0||orderWorkspaces.hasUnsaved(),onUndo:async()=>{await refresh();loadCampaign();await orderWorkspaces.reset(current());},onRestore:async()=>{drafts.clear();dirty=false;clearPending();await refresh();loadCampaign();await orderWorkspaces.reset(current());}});
qqPresentation=createQQConnection({api,isSetup:()=>setupGuide.isOpen(),isQQSetup:()=>setupGuide.isQQ()});
const manualFinder=createProductFinder({id:'manualProductSearch',mode:'manual',api,getCampaign:current,getProducts:()=>current()?.products||[],onError:notice,onPick:(p,quantity)=>action(async()=>{
 const c=current();if(!c||c.orderLifecycle?.status==='completed')throw Error('本期已结束，请先开启补单');
 if(manualSelections.has(p.name)&&manualSelections.get(p.name)!==p.id&&$('message').value.includes(p.name))throw Error('已选过另一盒的同名商品，请先完成本次录入，再选择另一盒');
 manualSelections.set(p.name,p.id);const input=$('message');input.value+=(input.value.trim()?'\n':'')+p.name+' '+quantity+' '+(p.unit||'件');clearPending();input.focus();input.setSelectionRange(input.value.length,input.value.length);
})});$('message').closest('label').before(manualFinder.root);
runtimeStatus=createRuntimeStatus({api,getGroup:()=>groupId,getWorkspace:()=>settingsPage.workspace()});
catalogFeedback=createCatalogFeedback({getCampaign:current,getProductCount:()=>editor.snapshot().length,onChange:()=>{dirty=true;$('publish').textContent='保存商品 *';},onRestore:()=>action(async()=>{
 const c=current(),source=c?.lastRecognition;if(!source?.result?.products?.length)throw Error('没有可恢复的识别结果');if(editor.snapshot().length)throw Error('当前已有商品，请先核对现有草稿');
 const data=structuredClone(source.result);let original='';if(!source.textOnly&&source.imageUrl){const r=await fetch(source.imageUrl);if(!r.ok)throw Error('原图片读取失败，暂时无法恢复商品图片');original=await fileData(await r.blob());}
 for(const p of data.products){if(p.textOnly||source.textOnly){p.textOnly=true;p.imageUrl='';p.portraitUrl='';}else if(!p.imageUrl){const crop=original?await cropProduct(original,p.cropBounds):null;p.imageUrl=crop?(await api('upload',{image:crop})).url:source.imageUrl||'';}delete p.cropBounds;}
 if(current()?.id!==c.id)throw Error('期次已切换，请回到原期次恢复');const stats=editor.append(data.products,data.boxPrices,data.categories);notice('已恢复最近一张图片的识别结果，共'+stats.added+'种商品，请核对后保存。');
})});


function preserveDraft(){if(currentId&&dirty)drafts.set(currentId,{products:editor.snapshot(),categories:editor.categories(),review:catalogFeedback.snapshot(),revision:current()?.revision});}
function resetImage(){imageGeneration++;images=[];$('image').value='';$('preview').hidden=true;$('preview').replaceChildren();$('imageResult').textContent='';}
function loadCampaign(){manualSelections.clear();const maps=current()?.positionMaps||[];$("positionMap").replaceChildren(new Option("重新识别角色",""),...maps.map((m,i)=>new Option("同版式参照 "+(i+1),m.id)));
  const c=current(),cached=drafts.get(currentId);dirty=!!cached&&cached.revision===c?.revision;
  editor.load(dirty?cached.products:c?.products||[],dirty?cached.categories:c?.categories);$('publish').textContent=dirty?'保存商品 *':'保存商品';catalogFeedback.load(c);if(dirty&&cached.review)catalogFeedback.set(cached.review);clearPending();$('parsed').textContent='识别结果将在这里显示。';resetImage();renderRecords();
}
function renderBot(){const bot=state.bots.find(b=>b.id===botId);$('activeBotName').textContent=bot.name;}
function renderGroupSelect(){const groups=state?.qqGroups||[];if(!groupId||!groups.some(g=>String(g.id)===String(groupId)))groupId=groups[0]?.id||'';const options=groups.map(g=>new Option(g.name+' · '+g.id,g.id));if((state?.campaigns||[]).some(c=>!c.groupId))options.push(new Option('未分配群',''));$('group').replaceChildren(...options);$('group').value=groupId;}
function campaignsInGroup(){return (state?.campaigns||[]).filter(c=>String(c.groupId||'')===String(groupId||''));}
function renderCampaignSelect(){const list=campaignsInGroup().filter(c=>c.botId===botId);if(!list.some(c=>c.id===currentId))currentId=list[0]?.id||'';$('campaign').replaceChildren(...list.map(c=>new Option(c.name,c.id)));if(!list.length)$('campaign').add(new Option('请新建期次',''));$('campaign').value=currentId;const phase=current()?.orderLifecycle?.status||'open';const badge=$('campaignPhase');badge.textContent=phase==='completed'?'已结束':phase==='supplement'?'补单中':'拼谷中';badge.dataset.phase=phase;badge.hidden=!current();if(uiRestored)savePrefs({});}
function renderGroupManager(){const box=$('qqGroupList');if(!box)return;box.replaceChildren();const groups=state?.qqGroups||[];if(!groups.length){const p=document.createElement('p');p.className='hint';p.textContent='还没有启用的群，先读取机器人已加入的群再启用。';box.append(p);}for(const g of groups){const row=document.createElement('div');row.className='group-row';const info=document.createElement('div');const name=document.createElement('strong');name.textContent=g.name;const meta=document.createElement('small');meta.textContent=g.id+' · 期次 '+state.campaigns.filter(c=>String(c.groupId||'')===String(g.id)).length;info.append(name,meta);const remove=document.createElement('button');remove.className='secondary';remove.textContent='移除';remove.onclick=()=>action(async()=>{await api('qq-group-remove',{groupId:g.id});await refresh();notice('已移除该群');});row.append(info,remove);box.append(row);}const cand=$('qqGroupCandidates');if(!cand)return;cand.replaceChildren();const fresh=groupCandidates.filter(g=>!groups.some(x=>String(x.id)===String(g.id)));if(!fresh.length)return;const title=document.createElement('p');title.className='hint';title.textContent='机器人已加入、但还没启用的群：';cand.append(title);for(const g of fresh){const row=document.createElement('div');row.className='group-row';const info=document.createElement('div');const name=document.createElement('strong');name.textContent=g.name;const meta=document.createElement('small');meta.textContent=g.id;info.append(name,meta);const add=document.createElement('button');add.textContent='启用';add.onclick=()=>action(async()=>{await api('qq-group-add',{groupId:g.id,name:g.name});await refresh();notice('已启用该群');});row.append(info,add);cand.append(row);}}
async function refresh(connection=false){await applyState(await api('state'),connection);}
async function applyState(next,connection=false,{table=true}={}){const previous=current();state=next;settingsPage.sync(state);qqPresentation?.sync(state);Object.assign(uiPrefs,next.uiPrefs||{});if(!next.bots.some(b=>b.id===botId))botId=next.bots[0]?.id||'zhougu';if(!uiRestored){uiRestored=true;if(uiPrefs.botId&&next.bots.some(b=>b.id===uiPrefs.botId))botId=uiPrefs.botId;if(uiPrefs.groupId&&(next.qqGroups||[]).some(g=>String(g.id)===String(uiPrefs.groupId)))groupId=uiPrefs.groupId;if(uiPrefs.campaignId&&(next.campaigns||[]).some(c=>c.id===uiPrefs.campaignId))currentId=uiPrefs.campaignId;}void usageSettings.load(state);$('qqEnrollmentEnabled').checked=state.qqEnrollmentEnabled===true;$('albumWithdrawalEnabled').checked=state.albumWithdrawalEnabled===true;if($("qqStatus"))$("qqStatus").textContent=state.qq.status;if(connection&&state.qqSettings)$("qqUrl").value=state.qqSettings.url;$('bot').replaceChildren(...state.bots.map(b=>new Option(b.name,b.id)));$('bot').value=botId;renderBot();renderGroupSelect();renderGroupManager();renderCampaignSelect();if(connection){picker.sync(state);await runtimePicker.refresh();}const c=current();if(!dirty&&c&&c.id===previous?.id&&c.revision!==previous.revision)editor.load(c.products,c.categories);renderRecords({table});runtimeStatus?.sync(state);}
function renderRecords({table=true}={}){
  const c=current();if(table)void enrollmentTable.render(c,currentPage==='enrollment');
  const ended=c?.orderLifecycle?.status==='completed';$('parse').disabled=ended;if(ended)$('confirm').disabled=true;$('parse').title=ended?'本期已结束，请先开启补单':'';
  albumPicker.render(currentPage==='enrollment');renderAlbumSync();manualFinder.refresh();
  void orderWorkspaces.render(c);
}
let albumRenderKey='';const albumScopeDrafts=new Map();
function pendingChip(text,type){const span=document.createElement('span');span.className='issue-chip '+type;span.textContent=text;return span;}
function renderPending(c,binding){
  const host=$('albumPending');if(!host)return;host.replaceChildren();
  const pending=binding?.pending||[];host.hidden=!pending.length;
  for(const item of pending){
    const card=document.createElement('div');card.className='pending-card';
    const head=document.createElement('div');head.className='pending-head';
    const who=document.createElement('strong');who.textContent=memberOf(item.qq)||item.qq||'未知';
    const when=document.createElement('span');when.textContent=item.at?new Date(item.at).toLocaleString('zh-CN',{hour12:false}):'';
    head.append(who,when);card.append(head);
    const text=document.createElement('p');text.className='pending-text';text.textContent=item.text;card.append(text);
    const removeEntry=key=>action(async()=>{await api('album-comment-item-delete',{campaignId:c.id,commentId:item.commentId,entryKey:key});await refresh();notice('已删除此条目');});
    for(const x of item.preview||[]){const row=document.createElement('div');row.className='recognized-entry';const text=document.createElement('span');text.textContent=x.name+' ×'+x.quantity;row.append(text);if(x.entryKey)row.append(itemMenu(()=>removeEntry(x.entryKey)));card.append(row);}
    const issues=item.issues||[],picks=new Map();
    const already=new Map();for(const r of c.records||[])if(String(r.qq)===String(item.qq))already.set(r.skuId,(already.get(r.skuId)||0)+r.quantity);
    const label=p=>p.name+(p.boxId?' ['+p.boxId+']':'')+(already.get(p.id)?'（已排'+already.get(p.id)+'）':'');
    const canRetry=(issues.length>0||item.preview?.length>0)&&!issues.some(x=>['proxy','group'].includes(x.code));
    if(issues.length){
      const list=document.createElement('div');list.className='pending-issues';
      issues.forEach((issue,index)=>{
        const row=document.createElement('div');row.className='pending-issue recognized-entry';if(issue.entryKey)row.append(itemMenu(()=>removeEntry(issue.entryKey)));
        const main=document.createElement('div');main.className='issue-main';
        const phrase=document.createElement('span');phrase.className='issue-phrase';phrase.textContent=issue.phrase;
        main.append(phrase);
        if(issue.quantity)main.append(pendingChip('×'+issue.quantity,'qty'));
        const codeLabel=issue.code==='outside'?'不在图片范围':issue.code==='ambiguous'?'多个候选':issue.code==='quantity'?'缺数量':issue.code==='proxy'?'格式错误':issue.code==='group'?'核对款数':'未找到';
        main.append(pendingChip(codeLabel,'code'));
        const fields=document.createElement('div');fields.className='issue-fields';
        if(!['proxy','group'].includes(issue.code)&&!issue.skuId){
          const select=document.createElement('select');select.className='issue-select';select.setAttribute('aria-label','为「'+issue.phrase+'」选择商品');
          select.add(new Option('选择对应商品…',''));
          if(issue.candidates?.length)for(const cand of issue.candidates)select.add(new Option(label(cand),cand.id));
          const rest=c.products.filter(p=>!issue.candidates?.some(x=>x.id===p.id));
          if(rest.length){const group=document.createElement('optgroup');group.label='全部商品';for(const p of rest)group.append(new Option(label(p),p.id));select.append(group);}
          select.onchange=()=>{const cur=picks.get(index)||{};if(select.value)cur.skuId=select.value;else delete cur.skuId;picks.set(index,cur);};
          if(issue.code==='outside'&&issue.candidates?.length===1){select.value=issue.candidates[0].id;picks.set(index,{skuId:issue.candidates[0].id});}
          fields.append(select);
        }
        if(!['proxy','group'].includes(issue.code)&&(issue.code==='quantity'||!(issue.quantity>=1))){
          const qty=document.createElement('input');qty.type='number';qty.min='1';qty.step='1';qty.className='issue-qty';qty.value=String(issue.quantity>=1?issue.quantity:1);qty.setAttribute('aria-label','为「'+issue.phrase+'」填写数量');
          qty.oninput=()=>{const cur=picks.get(index)||{};const n=Number(qty.value);if(Number.isInteger(n)&&n>=1)cur.quantity=n;else delete cur.quantity;picks.set(index,cur);};
          const cur=picks.get(index)||{};cur.quantity=Number(qty.value);picks.set(index,cur);
          fields.append(qty);
        }
        if(fields.childNodes.length)row.append(main,fields);else row.append(main);
        list.append(row);
      });
      card.append(list);
    }else if(item.reason){const reason=document.createElement('p');reason.className='pending-reason';reason.textContent=item.reason;card.append(reason);}
    const actions=document.createElement('div');actions.className='pending-actions';
    if(canRetry){
      const retry=document.createElement('button');retry.textContent='保存并重试';
      retry.onclick=()=>action(async()=>{
        const missing=[];
        issues.forEach((x,i)=>{const cur=picks.get(i)||{};if(!x.skuId&&!cur.skuId)missing.push('「'+x.phrase+'」的商品');if((x.code==='quantity'||!(x.quantity>=1))&&!(cur.quantity>=1))missing.push('「'+x.phrase+'」的数量');});
        if(missing.length)throw Error('还缺少：'+[...new Set(missing)].join('、'));
        const resolutions=issues.map((x,i)=>{const cur=picks.get(i)||{};return {phrase:x.phrase,skuId:x.skuId||cur.skuId||'',quantity:cur.quantity};}).filter(r=>r.skuId||r.quantity);
        const r=await api('album-comment-resolve',{campaignId:c.id,commentId:item.commentId,resolutions});
        await refresh();notice(r.message||'已重新入表');
      });
      actions.append(retry);
    }
    const dismiss=document.createElement('button');dismiss.className='secondary';dismiss.textContent='忽略此条';
    dismiss.onclick=()=>action(async()=>{await api('album-comment-dismiss',{campaignId:c.id,commentId:item.commentId});await refresh();notice('已忽略这条评论');});
    actions.append(dismiss);card.append(actions);host.append(card);
  }
}
function renderAlbumSync(){
  const c=current(),binding=state?.albums?.find(a=>a.campaignId===c?.id),panel=$('albumSyncPanel');if(!panel)return;
  const sync=binding?.sync;$('albumSyncStatus').textContent=!binding?'请选择并绑定群相册':sync?.error?'同步失败：'+sync.error:sync?.at?`已同步 ${new Date(sync.at).toLocaleTimeString()} · 评论 ${sync.comments||0} 条 · 待核对 ${binding.pending?.length||0} 条${sync.skipped?` · 已跳过 ${sync.skipped} 条`:''}`:'已绑定，等待自动读取';
  const key=JSON.stringify([c?.id,c?.revision,binding?.photos,binding?.photoScopes,binding?.batchScopes,binding?.photoErrors,binding?.pending]);if(key===albumRenderKey)return;albumRenderKey=key;
  const photos=$('albumPhotos');photos.replaceChildren();
  const groups=new Map();
  for(const photo of binding?.photos||[]){const key=String(photo.batchId||photo.id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(photo);}
  for(const key of albumScopeDrafts.keys()){const [campaign,gid,album,batch]=JSON.parse(key);if(campaign===c?.id&&gid===binding?.groupId&&album===binding?.albumId&&!groups.has(batch))albumScopeDrafts.delete(key);}
  for(const [batchId,groupPhotos] of groups){
    const row=document.createElement('div');row.className='album-photo';
    const thumbs=document.createElement('div');thumbs.className='album-thumbs';
    const firstPhoto=groupPhotos[0];
    const img=document.createElement('img');img.src=`/api/album-photo?groupId=${encodeURIComponent(binding.groupId)}&albumId=${encodeURIComponent(binding.albumId)}&photoId=${encodeURIComponent(firstPhoto.id)}`;img.alt='相册商品图';img.loading='lazy';img.onerror=()=>{img.removeAttribute('src');img.classList.add('missing');img.alt='读取失败';};thumbs.append(img);
    if(groupPhotos.length>1){const more=document.createElement('span');more.className='album-thumbs-more';more.textContent='等 '+groupPhotos.length+' 张';thumbs.append(more);}
    const fields=document.createElement('div'),save=document.createElement('button'),status=document.createElement('small');fields.className='album-scope-fields';
    const scope=binding.batchScopes?.[batchId]||binding.photoScopes?.[groupPhotos[0].id],draftKey=JSON.stringify([c.id,binding.groupId,binding.albumId,batchId]);
    let savingScope=false;const picker=createAlbumScopePicker({categories:c.categories,products:c.products,scope,draft:albumScopeDrafts.get(draftKey),onChange:value=>{if(!picker.root.isConnected)return;albumScopeDrafts.set(draftKey,value);syncSave();}});
    const confirmed=scope?.source==='人工确认',savedKey=albumSelectionKey({ignored:scope?.ignored,categoryScopes:selectedAlbumCategories(scope,c.products)});
    function syncSave(){const value=picker.value(),same=confirmed&&albumSelectionKey(value)===savedKey;save.textContent=same?(value.ignored?'已忽略':'已确认'):'确认大类';save.className=(same?'confirmed ':'secondary ')+'confirm-scope';save.disabled=savingScope||!value.ignored&&!value.categoryScopes.length;}
    save.onclick=()=>action(async()=>{if(savingScope)return;const value=picker.value();if(!value.ignored&&!value.categoryScopes.length)throw Error('请至少选择一个商品大类');savingScope=true;save.disabled=true;picker.setDisabled(true);try{await api('album-batch-scope',{groupId:binding.groupId,albumId:binding.albumId,batchId,ignored:value.ignored,categoryScopes:value.categoryScopes});albumScopeDrafts.delete(draftKey);try{await api('qq-album-comments',{});}catch(error){await refresh();notice('大类已保存，评论同步失败：'+error.message);return;}await refresh();notice('这次上传的大类已保存，评论已重新核对');}finally{savingScope=false;if(save.isConnected){picker.setDisabled(false);syncSave();}}});syncSave();
    const caption=(binding.captions||[]).find(x=>(x.photoIds||[]).some(id=>groupPhotos.some(p=>p.id===id)))?.text;
    const scopeText=scope?[scope.source,scope.ignored?'可忽略':selectedAlbumCategories(scope,c.products).map(entry=>(c.categories.find(x=>x.id===entry.categoryId)?.name||'')+(entry.boxId?' '+entry.boxId:'')).join('、')].filter(Boolean).join(' · '):'未确认';
    status.textContent=scopeText+(caption?' · 说明：'+caption:'');
    fields.append(picker.root,save,status);row.append(thumbs,fields);photos.append(row);
  }
  renderPending(c,binding);
}
const titles={workspace:'商品建档',enrollment:'排表识别',planning:'下单规划',settlement:'肾表导出',settings:'设置'};
function fitWorkbenches(){for(const section of document.querySelectorAll('main>section:not([hidden])')){const wb=section.querySelector('.workbench');if(!wb)continue;const top=wb.getBoundingClientRect().top,main=wb.closest('main'),pad=main?parseFloat(getComputedStyle(main).paddingBottom)||24:24;wb.style.setProperty('--workbench-height',Math.max(360,Math.round(window.innerHeight-top-pad))+'px');}}
window.addEventListener('resize',fitWorkbenches);
function page(name){currentPage=name;document.querySelectorAll('main>section').forEach(s=>s.hidden=s.id!==name);document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));$('title').textContent=titles[name];$('campaignToolbar').hidden=!['workspace','enrollment','planning','settlement'].includes(name);albumPicker.render(name==='enrollment');void enrollmentTable.render(current(),name==='enrollment');if(name==='settings'){void action(()=>skillSettings.load());void qqPresentation?.check(true);}fitWorkbenches();}
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>page(button.dataset.page));
$('bot').onchange=()=>{preserveDraft();botId=$('bot').value;renderBot();renderCampaignSelect();loadCampaign();};
$('newCampaign').onsubmit=e=>{e.preventDefault();action(async()=>{if((state.qqGroups||[]).length&&!groupId)throw Error('请先选择所属群');preserveDraft();const c=await api('campaign',{name:$('campaignName').value,botId,groupId:String(groupId||'')});currentId=c.id;$('campaignName').value='';await refresh();loadCampaign();});};
$('campaign').onchange=()=>{preserveDraft();currentId=$('campaign').value;savePrefs({campaignId:currentId});loadCampaign();};
$('group').onchange=()=>{preserveDraft();groupId=$('group').value;renderCampaignSelect();loadCampaign();};
$('qqGroupsRefresh').onclick=()=>action(async()=>{const r=await api('qq-groups-refresh',{});groupCandidates=r.groups||[];await refresh();notice(`读取到 ${groupCandidates.length} 个已加入的群`);});
$('settingsForm').onsubmit=e=>{e.preventDefault();action(async()=>{$('saveSettings').disabled=true;$('loadModels').disabled=true;try{await api('settings',picker.configuration());picker.clearKey();await refresh(true);const result=await api('test-connection',{});notice(result.message);setupGuide.modelSaved();}finally{$('saveSettings').disabled=false;$('loadModels').disabled=false;}});};
$('image').onchange=()=>action(async()=>{
  const token=++imageGeneration,files=[...$('image').files];images=[];$('preview').replaceChildren();$('preview').hidden=true;$('imageResult').textContent='';$('recognizeImage').disabled=false;
  validateImageSelection(files);$('recognizeImage').disabled=true;
  try{
    for(let i=0;i<files.length;i++){
      $('imageResult').textContent=`正在上传 ${i+1}/${files.length}…`;
      const f=files[i],data=await fileData(f);if(token!==imageGeneration)return;
      const uploaded=await api('upload',{image:data});if(token!==imageGeneration)return;
      images.push({name:f.name,data,url:uploaded.url});
      const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=data;img.alt=f.name;caption.textContent=`${i+1}. ${f.name}`;figure.append(img,caption);$('preview').append(figure);$('preview').hidden=false;
    }
    $('imageResult').textContent=`已选择 ${images.length} 张图片。`;
  }catch(e){if(token===imageGeneration){images=[];$('preview').replaceChildren();$('preview').hidden=true;$('imageResult').textContent='';}throw e;}
  finally{if(token===imageGeneration)$('recognizeImage').disabled=false;}
});
async function recognize(mode){
  const campaignId=currentId,selectedBot=botId,token=imageGeneration;if(!campaignId)throw Error('请先新建期次');if(mode==='image'&&!images.length)throw Error('请先上传商品图');
  clearPending();const buttons=['recognizeImage','parse'];buttons.forEach(id=>$(id).disabled=true);$('image').disabled=true;
  try{
    if(mode==='image'){
      const isCurrent=()=>currentId===campaignId&&botId===selectedBot&&token===imageGeneration;
      const questions=[],note=$('recognitionNote').value,textOnly=$('textOnly').checked;
      const result=await runImageBatch([...images],{
        isCurrent,
        onProgress:(i,total)=>{$('imageResult').textContent=`正在识别 ${i}/${total} 张图片…`;},
        process:async source=>{
          const prepared=await prepareImageParts(source.data,source.url,image=>api('upload',{image}));
          if(!isCurrent())throw Error('图片或期次已更换，请重新识别');
          const response=await api('recognize',{botId:selectedBot,campaignId,mode,textOnly,positionMapId:$("positionMap").value,imageUrl:source.url,images:prepared.parts,text:note});
          if(!isCurrent())throw Error('图片或期次已更换，请重新识别');
          for(const p of response.data.products){
            if(textOnly){p.textOnly=true;p.imageUrl='';p.portraitUrl='';delete p.cropBounds;continue;}if(p.imageUrl)continue;const crop=await cropProduct(source.data,p.cropBounds);
            if(!isCurrent())throw Error('图片或期次已更换，请重新识别');
            p.imageUrl=crop?(await api('upload',{image:crop})).url:source.url;p.imageKind='商品图';delete p.cropBounds;
          }
          return response.data;
        },
        onResult:data=>{const stats=editor.append(data.products,data.boxPrices,data.categories);questions.push(...(data.questions||[]));return stats;}
      });
      const review=[...new Set(questions)];await refresh();if(!isCurrent())throw Error('图片或期次已更换，请重新识别');catalogFeedback.result(review,result.failures,current()?.lastRecognition?.at||'');
      $('imageResult').textContent=[`已处理 ${result.completed}/${images.length} 张图片`,`新增${result.added} 补图${result.updated} 调价${result.adjusted} 去重${result.duplicates}`,(review.length||result.failures.length)?`待复核 ${review.length} 项 · 失败 ${result.failures.length} 张`:'识别完成'].join('\n');
      $('recognitionDoneTitle').textContent='已完成';
      $('recognitionDone').showModal();
      return;
    }
    const qq=$('memberQQ').value.trim();if(qq&&!/^\d{5,12}$/.test(qq))throw Error('QQ号格式不正确');
    const member=memberOf(qq)||$('member').value.trim();if(!member||member.length>40)throw Error('请填写1至40字的cn，或填写已绑定cn的QQ');
    if(!$('member').value.trim())$('member').value=member;updateManualBinding();
    const response=await api('recognize',{botId:selectedBot,campaignId,mode,member,text:$('message').value,manualSelections:[...manualSelections].filter(([phrase])=>$('message').value.includes(phrase)).map(([phrase,skuId])=>({phrase,skuId}))});
    if(currentId!==campaignId||botId!==selectedBot)throw Error('已切换期次，请重新识别');
    {
      pending={...response.data,botId:selectedBot,campaignId,revision:response.revision,requestId:crypto.randomUUID(),source:$('message').value};renderManualResult();
    }
  }catch(e){if(mode==='image'&&currentId===campaignId&&token===imageGeneration)$('imageResult').textContent='';throw e;}finally{buttons.forEach(id=>$(id).disabled=false);$('image').disabled=false;}
}
$('recognizeImage').onclick=()=>action(()=>recognize('image'));$('parse').onclick=()=>action(()=>recognize('enrollment'));
$('recognitionDoneClose').onclick=()=>$('recognitionDone').close();
$('addProduct').onclick=()=>action(async()=>{if(!current())throw Error('请先新建期次');editor.add();});
$('publish').onclick=()=>action(async()=>{const c=current();if(!c)throw Error('请先新建期次');const id=c.id;$('publish').disabled=true;catalogFeedback.saveState('saving','正在保存商品…');try{const result=await api('catalog',{campaignId:id,botId,revision:c.revision,products:editor.snapshot(),categories:editor.categories(),catalogReview:catalogFeedback.snapshot()});drafts.delete(id);if(currentId===id){dirty=false;$('publish').textContent='保存商品';await refresh();editor.load(current().products,current().categories);catalogFeedback.saveState('saved','商品已保存 · '+current().products.length+'种商品');}notice('商品已保存。'+(result.updatedRecords?`已更新 ${result.updatedRecords} 条报名金额。`:''));}catch(error){if(currentId===id){catalogFeedback.saveState('error','商品未保存：'+error.message+'。当前草稿仍保留，请修改后重试。');$('publish').textContent='保存失败，重试';}throw error;}finally{$('publish').disabled=false;}});
$('message').oninput=()=>{clearPending();for(const phrase of manualSelections.keys())if(!$('message').value.includes(phrase))manualSelections.delete(phrase);};
function updateManualBinding(){$('bindCN').disabled=!/^\d{5,12}$/.test($('memberQQ').value.trim())||!$('member').value.trim();}
for(const id of ['memberQQ','member'])$(id).oninput=()=>{clearPending();updateManualBinding();};
$('confirm').onclick=()=>action(async()=>{if(!pending)throw Error('请先识别报名');$('confirm').disabled=true;try{const result=await api('enroll-batch',{...pending,member:$('member').value,qq:$('memberQQ').value,cnOnly:$('manualCNOnly').checked});clearPending();await refresh();notice(result.inferredQQ?'已入表，已按CN关联QQ：'+result.inferredQQ:'报名已入表。');}catch(e){$('confirm').disabled=false;throw e;}});
$('export').onclick=()=>action(async()=>{if(!current())throw Error('请先选择期次');const a=document.createElement('a');a.href='/api/export?campaignId='+encodeURIComponent(currentId)+'&kind=enrollment';a.click();});
$('refreshRecords').onclick=()=>action(async()=>{
 if(!current())throw Error('请先选择期次');const id=currentId,button=$('refreshRecords');button.disabled=true;
 try{
  // Read independently: refreshing a table must not replace catalogue drafts or their revision.
  const fresh=await api('state');if(currentId!==id)return;
  const c=fresh.campaigns.find(c=>c.id===id&&c.botId===botId&&String(c.groupId||'')===String(groupId||''));if(!c)throw Error('期次已变化，请重新选择期次');
  if(!dirty){await applyState(fresh,false,{table:false});editor.load(c.products,c.categories);}
  if(await enrollmentTable.render(c,true,{force:true}))notice(dirty?'排表已刷新。建档修改尚未保存，请在商品建档点击“保存商品”后再刷新。':'排表已刷新');
 }finally{button.disabled=false;}
});
$('bindCN').onclick=()=>action(async()=>{const r=await api('cn',{campaignId:currentId,groupId:String(current()?.groupId||groupId||''),qq:$('memberQQ').value.trim(),cn:$('member').value.trim()});clearPending();await refresh();notice(r.message);});

$('syncAlbum').onclick=()=>action(async()=>{$('syncAlbum').disabled=true;try{await api('qq-album-comments',{});await refresh();notice('已完成');}finally{$('syncAlbum').disabled=false;}});
setInterval(()=>{if(!dirty)refresh().catch(e=>notice(e.message));},5000);
action(async()=>{await settingsPage.load();try{await refresh(true);loadCampaign();if(!settingsPage.isRemote())setupGuide.start();}catch(e){page('settings');settingsPage.select('server');throw e;}});

$('recognitionDoneX').onclick=()=>$('recognitionDone').close();
for(const id of ['recognitionDone'])$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).close();});
let qqPreparing=false,qqSetupActive=false,qqConnecting=false;
async function qqLoginStatus(){const r=await api('qq-login-state',{});$('qqLoginStatus').textContent=r.loggedIn?(state?.qq?.connected?'QQ已登录，机器人已连接':'QQ已登录，可以连接机器人'):r.ready?'等待QQ登录'+(r.error?'：'+r.error:''):r.error;$('qqAutoConnect').disabled=!r.loggedIn||qqConnecting;return r;}
async function autoConnectQQ(){
 if(qqConnecting)return;qqConnecting=true;const button=$('reconnectBot');button.disabled=true;button.setAttribute('aria-busy','true');button.dataset.state='connecting';button.title='正在连接机器人';$('qqAutoConnect').disabled=true;notice('正在连接机器人…');
 try{const r=await api('qq-auto-connect',{});await refresh();button.dataset.state='connected';button.title='机器人已连接，点击重新连接';qqPresentation?.connected(r.qq);notice(`QQ ${r.qq} 已连接并确认在线`);}
 catch(e){button.dataset.state='error';button.title='连接失败，点击重试';throw e;}
 finally{qqConnecting=false;button.disabled=false;button.removeAttribute('aria-busy');await qqLoginStatus().catch(()=>{});}
}
$('qqPrepare').onclick=()=>action(async()=>{if(qqPreparing)return;qqPreparing=true;qqSetupActive=true;$('qqPrepare').disabled=true;try{const r=await api('qq-prepare',{});if(r.cancelled)return;if(r.message)notice(r.message);for(let i=0;i<12;i++){const login=await qqLoginStatus();if(login.ready){if(login.loggedIn){if(!state.qq.connected)await $('qqAutoConnect').onclick();}else await api('qq-login-window',{});return;}await new Promise(resolve=>setTimeout(resolve,1000));}notice('QQ环境仍在启动，请稍后检查登录状态');}finally{qqPreparing=false;$('qqPrepare').disabled=false;}});
$('qqLoginWindow').onclick=()=>action(async()=>{qqSetupActive=true;await api('qq-login-window',{});});
$('qqCheckLogin').onclick=()=>action(qqLoginStatus);
$('qqAccountForm').onsubmit=e=>{e.preventDefault();action(async()=>{qqSetupActive=true;const password=$('qqAccountPassword').value;$('qqAccountPassword').value='';const r=await api('qq-password-login',{qq:$('qqAccount').value,password});if(r.needCaptcha||r.needNewDevice)await api('qq-login-window',{});notice(r.needCaptcha||r.needNewDevice?'请在QQ登录窗口完成安全验证':'登录请求已提交，正在确认在线状态');await qqLoginStatus();});};
$('qqQuickLogin').onclick=()=>action(async()=>{qqSetupActive=true;await api('qq-quick-login',{qq:$('qqAccount').value});await qqLoginStatus();});
$('qqAutoConnect').onclick=()=>action(autoConnectQQ);
$('reconnectBot').onclick=()=>action(autoConnectQQ);


$('qqForm').onsubmit=e=>{e.preventDefault();action(async()=>{await api('qq-settings',{url:$('qqUrl').value,token:$('qqToken').value});$('qqToken').value='';await refresh();notice('QQ连接配置已保存');});};
$('albumWithdrawalEnabled').onchange=async()=>{const control=$('albumWithdrawalEnabled');control.disabled=true;await action(async()=>{const r=await api('album-withdrawal-settings',{enabled:control.checked});state.albumWithdrawalEnabled=r.enabled;notice(r.enabled?'已开启相册撤排':'已关闭相册撤排');});control.checked=state.albumWithdrawalEnabled===true;control.disabled=false;};
$('qqEnrollmentEnabled').onchange=async()=>{const control=$('qqEnrollmentEnabled');control.disabled=true;await action(async()=>{const r=await api('qq-enrollment-settings',{enabled:control.checked});state.qqEnrollmentEnabled=r.enabled;notice(r.enabled?'已开启@排表':'已关闭@排表');});control.checked=state.qqEnrollmentEnabled===true;control.disabled=false;};
setInterval(()=>{if((currentPage==='settings'||setupGuide.isQQ())&&!qqPreparing)qqLoginStatus().then(async r=>{if(r.loggedIn&&qqSetupActive&&!state.qq.connected){qqSetupActive=false;await $('qqAutoConnect').onclick();}}).catch(()=>{});},4000);
