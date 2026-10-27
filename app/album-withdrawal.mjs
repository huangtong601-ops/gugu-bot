import {cleanComment,memberName,matchProduct,compareCommentTime} from './workflow.mjs';
import {isCompleted} from './campaign-lifecycle.mjs';
import {selectQueueProducts} from './queue-query.mjs';

export const withdrawalTarget=text=>cleanComment(text).match(/^撤排\s*[:：]?\s*(.*)$/u)?.[1];

// Identity comes only from the album API. A withdrawal removes the sender's own
// complete SKU position, never a same-CN manual row or a delegated person's row.
export function withdrawAlbumComment(db,c,binding,event,productIds){
 const target=withdrawalTarget(event.text);if(target===undefined)return false;
 if(!event.id||!/^\d{5,12}$/.test(String(event.qq))||!Number.isFinite(Date.parse(event.at))||String(event.groupId)!==String(binding.groupId)||String(event.albumId)!==String(binding.albumId)||c.groupId&&String(c.groupId)!==String(binding.groupId))return true;
 c.commentEvents??=[];if(c.commentEvents.some(e=>e.id===String(event.id)))return true;
 const log={id:String(event.id),qq:String(event.qq),at:event.at,order:event.order??0,text:String(event.text),albumId:binding.albumId,photoIds:event.photoIds||[],withdrawal:true};
 let message;
 try{
  if(db.albumWithdrawalEnabled!==true)throw Error('本群未开启相册撤排，请联系管理员在设置中开启。');
  if(isCompleted(c))throw Error('本期已经结束，不能自动撤排，请联系管理员。');
  const cn=memberName(db,event.qq,binding.groupId);if(!cn)throw Error('请先在本群 @机器人 发送「cn 你的CN」，登记后重新评论撤排。');
  if(!target)throw Error('请评论「撤排 制品名称」，撤掉本人该制品的全部排量。');
  if(!productIds.length)throw Error('这张图片对应的大类尚未确认，请联系管理员确认后重新评论撤排。');
  const products=c.products.filter(p=>productIds.includes(p.id));
  const selected=selectQueueProducts({...c,products},target),found=selected.products;
  if(selected.bulk)throw Error('请填写具体制品名称，不能一次撤掉整个大类。');
  if(found.length!==1)throw Error(found.length?'对应多个商品，请补充款式或盒号后重新评论撤排。':'未找到图片范围内的这个制品，不能撤排。');
  const p=found[0];
  // Do not accidentally interpret a quantity as an instruction to cancel everything.
  const literal=[p.name,...(p.aliases||[])].some(n=>cleanComment(n)===target);
  const quantity=target.match(/^(.*?)\s*\d+\s*(?:个|对|件|套|枚|张)?$/);
  if(!literal&&quantity&&!(p.boxId&&target.includes(p.boxId))&&matchProduct(quantity[1],products,6,{arknights:!c.botId||c.botId==='zhougu'}).length)throw Error('撤排会撤掉该制品全部数量，请只填写制品名称，不要附数量。');
  const rows=c.records.filter(r=>String(r.qq||'')===String(event.qq)&&!r.proxyFor&&r.skuId===p.id&&compareCommentTime(r,event)<=0);
  if(!rows.length)throw Error('你没有排过这个制品，不能撤排；代排及未绑定QQ的记录请联系管理员处理。');
  const ids=new Set(rows.map(r=>r.id));
  log.skuId=p.id;log.removed=rows;log.quantity=rows.reduce((n,r)=>n+r.quantity,0);log.success=true;
  c.records=c.records.filter(r=>!ids.has(r.id));
  message=`已撤排 ${cn}：${p.name} ${log.quantity}${p.unit||'件'}。`;
 }catch(error){message=`撤排未完成：${error.message}`;log.success=false;}
 c.commentEvents.push(log);
 binding.pending=(binding.pending||[]).filter(p=>p.id!==event.id);
 binding.withdrawalNotices??=[];binding.withdrawalNotices.push({id:log.id,qq:log.qq,message,attempts:0});
 return true;
}

export async function sendWithdrawalNotices(db,binding,{send,persist,allowed=()=>true,now=()=>Date.now()}={}){
 const c=db.campaigns.find(c=>c.id===binding.campaignId);
 if(!c||!/^\d{5,12}$/.test(String(binding.groupId))||c.groupId&&String(c.groupId)!==String(binding.groupId))return;
 for(const n of binding.withdrawalNotices||[]){
  if(!allowed())return;
  if(n.sentAt||(n.attempts||0)>=3||Number(n.retryAt||0)>now()||!/^\d{5,12}$/.test(n.qq))continue;
  n.attempts=(n.attempts||0)+1;n.retryAt=now()+30000*2**(n.attempts-1);
  await persist();if(!allowed())return;
  try{await send({group_id:Number(binding.groupId),message:[{type:'at',data:{qq:n.qq}},{type:'text',data:{text:' '+n.message}}]});n.sentAt=new Date(now()).toISOString();delete n.error;}
  catch{n.error='撤排提示发送失败，请检查机器人连接或群发言权限';}
  await persist();
 }
}
