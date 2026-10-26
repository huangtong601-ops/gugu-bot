import {addComment,memberName,parseComment} from './workflow.mjs';
import {isCompleted,endedMessage} from './campaign-lifecycle.mjs';

// Closure notices are authorized by the administrator's explicit "下单完成" action.
// They never reuse the disabled missing-CN reminder and never derive recipients from text.
export async function remindCompletedComments(db,binding,{send,persist,allowed=()=>true,now=()=>Date.now()}={}){
 const c=db.campaigns.find(c=>c.id===binding.campaignId);if(!isCompleted(c)||!/^\d{5,12}$/.test(String(binding.groupId))||c.groupId&&String(c.groupId)!==String(binding.groupId)||!allowed())return;
 const recipients=new Map();for(const n of binding.closedNotices||[])if((!n.phase||n.phase===c.orderLifecycle.completedAt)&&!n.sentAt&&(n.attempts||0)<3&&Number(n.retryAt||0)<=now()){
  if(!/^\d{5,12}$/.test(n.qq))continue;if(!recipients.has(n.qq))recipients.set(n.qq,[]);recipients.get(n.qq).push(n);
 }
 for(const [qq,notices]of recipients){if(!allowed()||!isCompleted(c))return;for(const n of notices){n.attempts=(n.attempts||0)+1;n.retryAt=now()+30000*2**(n.attempts-1);}await persist();if(!allowed()||!isCompleted(c))return;
  try{await send({group_id:Number(binding.groupId),message:[{type:'at',data:{qq}},{type:'text',data:{text:' '+endedMessage(c)}}]});for(const n of notices){n.sentAt=new Date(now()).toISOString();delete n.error;}await persist();}
  catch{for(const n of notices)n.error='结束提醒发送失败，请检查机器人连接或群发言权限';await persist();}
 }
}

// Run before image classification so missing-CN notices are not delayed by model calls.
// The album reader supplies the sender QQ; never derive an @ target from comment text.
export async function remindMissingCN(db,binding,{comments=[]},{send,persist,now=()=>Date.now(),allowed=()=>true}={}){
 const group=String(binding.groupId||''),c=db.campaigns.find(c=>c.id===binding.campaignId);
 if(!/^\d{5,12}$/.test(group)||!c||(c.groupId&&String(c.groupId)!==group)||!allowed())return {notified:0,failed:0};
 const at=Number(now()),recipients=new Map();
 for(const event of comments){
  const qq=String(event.qq||''),id=String(event.id||'');
  if(!id||!/^\d{5,12}$/.test(qq)||String(event.groupId)!==group||String(event.albumId)!==String(binding.albumId)||!Number.isFinite(Date.parse(event.at)))continue;
  if(c.commentEvents?.some(e=>e.id===id)||memberName(db,qq,group)||parseComment(event.text,[]).status==='skip')continue;
  binding.cnReminders??=[];
  let notice=binding.cnReminders.find(n=>n.id===id&&n.qq===qq);
  if(!notice){notice={id,qq,attempts:0};binding.cnReminders.push(notice);}
  if(notice.sentAt||notice.attempts>=3||Number(notice.retryAt||0)>at)continue;
  if(!recipients.has(qq))recipients.set(qq,[]);recipients.get(qq).push(notice);
 }
 let notified=0,failed=0;
 for(const [qq,notices]of recipients){
  if(!allowed()||memberName(db,qq,group))continue;
  for(const n of notices){n.attempts++;n.lastAttemptAt=new Date(at).toISOString();n.retryAt=at+30000*2**(n.attempts-1);}
  // Persist the attempt before sending, so a process restart cannot immediately flood the group.
  await persist();
  if(!allowed()||memberName(db,qq,group))continue;
  try{
   await send({group_id:Number(group),message:[{type:'at',data:{qq}},{type:'text',data:{text:' 你还没有录入CN，排谷评论已保留，暂未入表。请在本群 @机器人 后发送「cn 你的CN」，例如「cn 示例用户I」。录入成功后会自动重试原评论。'}}]});
  }catch{
   for(const n of notices)n.error='CN提醒发送失败，请检查机器人连接或群发言权限';failed++;await persist();continue;
  }
  // One notice covers all this person's comments already seen in this album, including older retries.
  for(const n of binding.cnReminders.filter(n=>n.qq===qq&&!n.sentAt)){n.sentAt=new Date(at).toISOString();delete n.retryAt;delete n.error;}
  notified++;await persist();
 }
 return {notified,failed};
}

export function scopeFromCaption(text,c){
 const t=String(text||'').normalize('NFKC').trim();if(!t)return null;const key=s=>s.normalize('NFKC').toLowerCase();
 const actual=new Set(c.categories.map(x=>key(x.name))),terms=c.categories.flatMap(cat=>[cat.name,...(cat.aliases||[]).filter(a=>!actual.has(key(a)))].map(name=>({id:cat.id,name})));
 let matches=terms.filter(x=>key(t).includes(key(x.name)));matches=matches.filter(x=>!matches.some(y=>y.id!==x.id&&key(y.name).includes(key(x.name))));matches=[...new Map(matches.map(x=>[x.id,x])).values()];
 if(matches.length!==1)return null;
 const categoryId=matches[0].id,boxes=[...new Set(c.products.filter(p=>(p.categoryId||p.type)===categoryId&&p.boxId).map(p=>p.boxId))];
 const mentioned=boxes.filter(b=>t.match(/[\d]+\.\d+/g)?.includes(b));if(mentioned.length>1)return null;
 const numeric=t.match(/\b\d+\.\d+\b/g)||[];if(c.categories.find(cat=>cat.id===categoryId)?.kind==='group'&&numeric.length&&!mentioned.length)return null;
 return {categoryId,boxId:mentioned[0]||'',source:'上传说明',caption:t};
}

export function scopedProducts(c,scope){
 if(!scope)throw Error('图片商品范围尚未确认');
 if(scope.ignored)throw Error('这次上传已标记为可忽略');
 if(scope.categoryScopes!==undefined){
  if(!Array.isArray(scope.categoryScopes)||!scope.categoryScopes.length||scope.categoryScopes.length>100)throw Error('请至少选择一个商品大类');
  const selected=new Map();for(const entry of scope.categoryScopes){if(!entry||entry.categoryScopes||entry.ignored)throw Error('商品大类范围无效');for(const p of scopedProducts(c,entry))selected.set(p.id,p);}return [...selected.values()];
 }
 // 识别出的商品清单优先；盒号/大类只是补充信息，不能反过来把清单里的商品删掉。
 if(scope.productIds?.length){
  const products=c.products.filter(p=>scope.productIds.includes(p.id));
  if(!products.length)throw Error('图片未对应到本期已保存商品');
  return products;
 }
 if(!scope.categoryId)throw Error('请确认图片对应的商品');
 if(!c.categories.some(cat=>cat.id===scope.categoryId))throw Error('商品大类已不存在，请重新选择');
 let products=c.products.filter(p=>(p.categoryId||p.type)===scope.categoryId);
 if(scope.boxId)products=products.filter(p=>p.boxId===scope.boxId);
 if(!products.length)throw Error('图片未对应到本期已保存商品');return products;
}

export function commentProducts(c,binding,comment){
 if(Array.isArray(binding?.photos)&&!comment.photoIds?.some(id=>binding.photos.some(p=>p.id===id)))return [];
 const keys=new Set();
 if(comment.batchId)keys.add(String(comment.batchId));
 for(const photo of comment.photoIds||[]){const found=(binding?.photos||[]).find(p=>p.id===photo);if(found)keys.add(batchKey(found));}
 const ids=new Set();
 for(const key of keys){const scope=binding?.batchScopes?.[key];if(!scope)continue;try{for(const p of scopedProducts(c,scope))ids.add(p.id);}catch{}}
 if(!ids.size){for(const photo of comment.photoIds||[]){const scope=binding?.photoScopes?.[photo];if(!scope)continue;try{for(const p of scopedProducts(c,scope))ids.add(p.id);}catch{}}}
 return [...ids];
}

// One upload can cover multiple categories; manual confirmation remains authoritative.
export const batchKey=photo=>String(photo?.batchId||photo?.id||'');
export function batchPhotos(binding,batchId){return (binding?.photos||[]).filter(p=>batchKey(p)===String(batchId));}
export const IGNORE_SCOPE='__ignore__';
export function scopeIgnored(scope){return scope?.ignored===true;}
export function commentIgnored(binding,comment){const keys=new Set();if(comment.batchId)keys.add(String(comment.batchId));for(const id of comment.photoIds||[]){const p=(binding?.photos||[]).find(p=>p.id===id);if(p)keys.add(batchKey(p));if(binding?.photoScopes?.[id]?.ignored)return true;}for(const key of keys)if(binding?.batchScopes?.[key]?.ignored)return true;return false;}
const scopeRank=s=>s?.source==='人工确认'?3:s?.source==='上传说明'?2:1;
export function albumScope(c,input){
 const values=input.categoryScopes??[{categoryId:input.categoryId,boxId:input.boxId}];
 if(!Array.isArray(values)||!values.length||values.length>c.categories.length)throw Error('请至少选择一个商品大类');
 const seen=new Set(),entries=values.map(value=>{const categoryId=String(value?.categoryId||''),boxId=String(value?.boxId||'');if(!categoryId||seen.has(categoryId)||!c.categories.some(cat=>cat.id===categoryId))throw Error('商品大类无效、重复或已不存在');seen.add(categoryId);const entry={categoryId,boxId};scopedProducts(c,entry);return entry;});
 return {categoryScopes:entries,categoryId:entries.length===1?entries[0].categoryId:'',boxId:entries.length===1?entries[0].boxId:'',source:'人工确认'};
}
export function reconcileAlbumPhotos(binding,photos,captions){
 if(!Array.isArray(photos))throw Error('图片清单未完整读取');
 const ids=new Set(photos.map(p=>p.id)),batches=new Set(photos.map(batchKey));binding.photos=photos;
 for(const field of ['photoScopes','photoErrors','photoAttempts'])if(binding[field])for(const id of Object.keys(binding[field]))if(!ids.has(id))delete binding[field][id];
 if(binding.batchScopes)for(const key of Object.keys(binding.batchScopes))if(!batches.has(key))delete binding.batchScopes[key];
 binding.captions=(captions??binding.captions??[]).map(c=>({...c,photoIds:(c.photoIds||[]).filter(id=>ids.has(id))})).filter(c=>c.photoIds.length);
 // A deleted source no longer needs confirmation. Keep its pending data separately; never retract records.
 const present=item=>(item.photoIds||[]).some(id=>ids.has(id));
 const removed=(binding.pending||[]).filter(item=>!present(item));
 if(removed.length){const saved=new Map((binding.unavailablePending||[]).map(item=>[item.id,item]));for(const item of removed)saved.set(item.id,item);binding.unavailablePending=[...saved.values()].slice(-2000);binding.pending=(binding.pending||[]).filter(present);}
 deriveBatchScopes(binding);return binding;
}
export function deriveBatchScopes(binding){
 if(!binding)return binding?.batchScopes;
 binding.batchScopes??={};
 const groups=new Map();
 for(const photo of binding.photos||[]){const key=batchKey(photo);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(photo);}
 for(const [key,photos] of groups){
  const current=binding.batchScopes[key];if(current?.source==='人工确认')continue;
  const scopes=photos.map(p=>binding.photoScopes?.[p.id]).filter(Boolean);
  if(!scopes.length){if(current)delete binding.batchScopes[key];continue;}
  const manual=scopes.filter(s=>s.source==='人工确认'),chosen=manual.length?manual:scopes;
  if(chosen.every(s=>s.ignored)){binding.batchScopes[key]={ignored:true,boxId:'',source:chosen[0].source||'图片识别'};continue;}
  const entries=[...new Map(chosen.filter(s=>!s.ignored).flatMap(s=>s.categoryScopes||[{categoryId:s.categoryId||'',boxId:s.boxId||'',...(s.productIds?.length?{productIds:s.productIds}:{})}]).map(s=>[JSON.stringify(s),s])).values()];
  const best=[...chosen].sort((a,b)=>scopeRank(b)-scopeRank(a))[0];
  binding.batchScopes[key]={categoryScopes:entries,categoryId:entries.length===1?entries[0].categoryId:'',boxId:entries.length===1?entries[0].boxId:'',source:best.source||'图片识别'};
 }
 return binding.batchScopes;
}

export function applyAlbumComments(db,binding,{photos,comments,captions=[]}){
 const c=db.campaigns.find(c=>c.id===binding.campaignId);if(!c)throw Error('相册绑定期次不存在');
 reconcileAlbumPhotos(binding,photos,captions);binding.pending??=[];let imported=0,duplicates=0,skipped=0;
 for(const event of comments){
  if(!event.photoIds?.some(id=>photos.some(p=>p.id===id))){skipped++;continue;}
  if(c.commentEvents?.some(e=>e.id===event.id)){duplicates++;binding.pending=binding.pending.filter(p=>p.id!==event.id);continue;}
  if(isCompleted(c)){
   // QQ timestamps have second precision; a comment just after completion can share its second.
   if(Date.parse(event.at)>=Math.floor(Date.parse(c.orderLifecycle.completedAt)/1000)*1000&&!binding.pending.some(p=>p.id===event.id)&&event.id&&/^\d{5,12}$/.test(String(event.qq))&&String(event.groupId)===String(binding.groupId)&&String(event.albumId)===String(binding.albumId)){
    c.commentEvents??=[];c.commentEvents.push({id:String(event.id),qq:String(event.qq),at:event.at,text:String(event.text),closed:true});
    binding.closedNotices??=[];binding.closedNotices.push({id:String(event.id),qq:String(event.qq),attempts:0,phase:c.orderLifecycle.completedAt});binding.pending=binding.pending.filter(p=>p.id!==event.id);
   }
   skipped++;continue;
  }
  if(commentIgnored(binding,event)){skipped++;binding.pending=binding.pending.filter(p=>p.id!==event.id);continue;}
  try{
   if(!event.photoIds.length)throw Error('评论对应的图片尚未确定');
   const productIds=commentProducts(c,binding,event);
   if(!productIds.length)throw Error(c.products?.length?'这次上传还没有确认大类，请在上方图片分组里选择后重试':'本期还没有保存商品，请先在商品建档保存商品');
   const result=addComment(db,c,{...event,productIds,ignoredItems:binding.itemExclusions?.[event.id]||[]});
   if(result.skipped){skipped++;binding.pending=binding.pending.filter(p=>p.id!==event.id);continue;}
   imported+=result.count||0;binding.pending=binding.pending.filter(p=>p.id!==event.id);
  }catch(e){const item={...event,reason:e.message,issues:e.questions||[],preview:pendingPreview(c,e)};const i=binding.pending.findIndex(p=>p.id===event.id);if(i<0)binding.pending.push(item);else binding.pending[i]=item;}
 }
 binding.sync={at:new Date().toISOString(),error:'',comments:comments.length,imported,pending:binding.pending.length,skipped};
 return {...binding.sync,duplicates};
}

export function retryPending(db,binding,commentId,resolutions={},quantities={}){
 const c=db.campaigns.find(x=>x.id===binding.campaignId);if(!c)throw Error('相册绑定期次不存在');
 const item=(binding.pending||[]).find(p=>String(p.commentId)===String(commentId));if(!item)throw Error('待核对评论不存在或已处理');
 const productIds=commentProducts(c,binding,item);
 if(!productIds.length)throw Error('这条评论对应的图片范围尚未确认，请先在图片列表里确认范围');
 const result=addComment(db,c,{...item,productIds,resolutions,quantities,ignoredItems:binding.itemExclusions?.[item.id]||[]});
 if(result.skipped)throw Error(result.message);
 binding.pending=binding.pending.filter(p=>p!==item);
 const sync=binding.sync||{};
 binding.sync={...sync,at:new Date().toISOString(),imported:(sync.imported||0)+(result.count||0),pending:binding.pending.length};
 return result;
}

function pendingPreview(c,parsed){
 const invalid=new Set((parsed.questions||[]).map(q=>q.entryKey));
 return (parsed.lines||[]).filter(l=>l.skuId&&!invalid.has(l.entryKey)).map(l=>({...l,name:c.products.find(p=>p.id===l.skuId)?.name||''}));
}

// Exclusions live on the binding, not a transient pending card; polling/restart must keep them.
export function deletePendingItem(db,binding,commentId,entryKey){
 const c=db.campaigns.find(x=>x.id===binding.campaignId);
 const item=binding.pending?.find(p=>String(p.commentId)===String(commentId));
 if(!c||!item)throw Error('待核对评论不存在或已处理');
 const ids=commentProducts(c,binding,item);if(!ids.length)throw Error('请先确认图片商品范围');
 const products=c.products.filter(p=>ids.includes(p.id)),cn=memberName(db,item.qq,binding.groupId);
 const ignoredItems=binding.itemExclusions?.[item.id]||[];
 const options={allProducts:c.products,ignoredItems,arknights:!c.botId||c.botId==='zhougu'};
 const before=parseComment(item.text,products,cn,options);
 if(typeof entryKey!=='string'||!before.lines.some(l=>l.entryKey===entryKey))throw Error('商品条目已变化，请刷新后重试');
 const next=[...new Set([...ignoredItems,entryKey])];
 const parsed=parseComment(item.text,products,cn,{...options,ignoredItems:next});
 binding.itemExclusions??={};binding.itemExclusions[item.id]=next;
 if(parsed.status==='skip'){dismissPending(db,binding,commentId);return {ok:true,message:'已删除此条目'};}
 item.preview=pendingPreview(c,parsed);item.issues=parsed.questions;
 item.reason=!cn?'请先 @bot cn 你的CN':parsed.questions.map(q=>q.message).join('；');
 return {ok:true,message:'已删除此条目，其余商品保留'};
}

export function dismissPending(db,binding,commentId){
 const c=db.campaigns.find(x=>x.id===binding.campaignId);
 const item=(binding.pending||[]).find(p=>String(p.commentId)===String(commentId));if(!item)throw Error('待核对评论不存在或已处理');
 if(c){c.commentEvents??=[];if(!c.commentEvents.some(e=>e.id===item.id))c.commentEvents.push({id:String(item.id),qq:String(item.qq),at:item.at,text:String(item.text),albumId:item.albumId||'',photoIds:item.photoIds||[],feedId:item.feedId||'',dismissed:true});}
 binding.pending=binding.pending.filter(p=>p!==item);
 binding.dismissed??=[];binding.dismissed.push({commentId:String(item.commentId),at:new Date().toISOString()});
 binding.sync={...(binding.sync||{}),at:new Date().toISOString(),pending:binding.pending.length};
 return {ok:true};
}

// Only one active read per process. Backoff limits retries while QQ is disconnected.
export function createAlbumPoller({read,interval=15000,onError=()=>{}}){
 let active=null,timer=null,closed=false,failures=0;
 const schedule=()=>{if(!closed){timer=setTimeout(()=>{timer=null;void run().catch(()=>{});},Math.min(120000,interval*2**Math.min(failures,3)));timer.unref?.();}};
 function run(){if(closed)return Promise.reject(Error('相册同步已关闭'));if(active)return active;clearTimeout(timer);active=(async()=>{try{const r=await read();failures=0;return r;}catch(e){failures++;await onError(e);throw e;}finally{active=null;schedule();}})();return active;}
 schedule();return {run,idle:()=>active?.catch(()=>{})||Promise.resolve(),close(){closed=true;clearTimeout(timer);}};
}
