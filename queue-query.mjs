import {matchProduct,summary,orderedRecords,recordOwner} from './workflow.mjs';
const compact=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s_\-－]/g,'');
export function queryPersonalQueue(campaigns,qq,cn=''){
 if(!/^\d{5,12}$/.test(String(qq)))return {reply:'无法确认发送者QQ，请重新发送查询',readOnly:true};
 const sections=[];
 for(const c of campaigns){
  const own=new Map();
  for(const r of orderedRecords(c)){
   if(String(r.qq||'')!==String(qq)&&!(!r.qq&&r.identityMode!=='cn'&&cn&&recordOwner({},r)===cn))continue;
   const key=JSON.stringify([r.skuId,r.proxyFor||'']);
   if(!own.has(key)){const p=c.products.find(p=>p.id===r.skuId);own.set(key,{name:p?.name||r.name,unit:p?.unit||'件',boxId:p?.boxId||'',proxyFor:r.proxyFor||'',quantity:0});}
   own.get(key).quantity+=r.quantity;
  }
  if(own.size)sections.push([`${c.name}｜你已排的制品`,...[...own.values()].map(item=>`${item.proxyFor?'代 '+item.proxyFor+'｜':''}${item.name}${item.boxId?' ['+item.boxId+']':''}：${item.quantity}${item.unit}`)].join('\n'));
 }
 return {reply:sections.join('\n\n')||'你在本群还没有排表记录',readOnly:true};
}
const sameBox=(a,b)=>compact(a)===compact(b)||(/^\d+(?:\.\d+)?$/.test(a)&&/^\d+(?:\.\d+)?$/.test(b)&&Number(a)===Number(b));
const categoryOf=(c,p)=>c.categories.find(x=>x.id===(p.categoryId||p.type));
export function parseQueueCommand(text){
 const match=String(text||'').trim().match(/^(?:查询\s*)?(排量|余量)\s*[:：]?\s*(.*)$/s);
 return match?{kind:match[1],target:match[2].trim()}:null;
}
export function selectQueueProducts(c,target){
 const q=compact(target);if(!q)return {products:c.products,label:'全部商品',bulk:true};
 // Exact category names take precedence over category + box parsing.
 const actualNames=new Set(c.categories.map(cat=>compact(cat.name))),names=cat=>[cat.name,...(cat.aliases||[]).filter(a=>!actualNames.has(compact(a)))];
 const exacts=c.categories.filter(cat=>names(cat).some(name=>compact(name)===q));if(exacts.length>1)throw Error('匹配多个大类，请使用当前大类名称');const exact=exacts[0];
 if(exact)return {products:c.products.filter(p=>categoryOf(c,p)?.id===exact.id),label:exact.name,bulk:true};
 for(const term of c.categories.flatMap(cat=>names(cat).map(name=>({cat,name}))).sort((a,b)=>b.name.length-a.name.length)){
  const cat=term.cat,name=compact(term.name),rest=q.startsWith(name)?q.slice(name.length):q.endsWith(name)?q.slice(0,-name.length):'';
  if(!rest||!/^\d+(?:\.\d+)?(?:分盒|盒)?$/.test(rest))continue;
  const box=rest.replace(/(?:分盒|盒)$/,'');
  return {products:c.products.filter(p=>categoryOf(c,p)?.id===cat.id&&sameBox(p.boxId||'',box)),label:cat.name+' '+box,bulk:true};
 }
 let candidates=c.products,phrase=String(target).normalize('NFKC');
 const box=phrase.match(/\d+\.\d+/)?.[0];if(box){candidates=candidates.filter(p=>sameBox(p.boxId||'',box));phrase=phrase.replace(box,'');}
 const found=matchProduct(phrase,candidates,6,{arknights:!c.botId||c.botId==='zhougu'});
 if(found.length>1){const error=Error('匹配到多个商品，请补充大类、款式或盒号：'+found.slice(0,8).map(p=>p.name+(p.boxId?' ['+p.boxId+']':'')).join('、'));error.code='AMBIGUOUS_QUEUE_PRODUCT';throw error;}
 return {products:found,label:target,bulk:false};
}
export function queryQueue(c,kind,target=''){
 if(!['排量','余量'].includes(kind))throw Error('请选择查询排量或查询余量');
 const selected=selectQueueProducts(c,target);let products=selected.products;
 if(!products.length)throw Error('未匹配到本期商品或分盒：'+(target||'全部商品'));
 if(kind==='余量'){
  products=products.filter(p=>categoryOf(c,p)?.kind==='group');
  if(!products.length)throw Error('余量仅支持拼团大类，单领类和特典不适用');
 }
 const ids=new Set(products.map(p=>p.id)),rows=summary(c).filter(p=>ids.has(p.id));
 const unconfigured=rows.filter(p=>p.sets===null);
 if(kind==='余量'&&unconfigured.length===rows.length){const labels=[...new Set(rows.map(p=>p.category+(p.boxId?' '+p.boxId:'')))];throw Error(labels.join('、')+'尚未设置总配数，请先在商品大类中填写开配数并保存商品');}
 const multipleBoxes=new Set(rows.map(p=>p.boxId)).size>1;
 const lines=rows.map(p=>{
  const name=p.name+(multipleBoxes&&p.boxId?' ['+p.boxId+']':'');
  if(kind==='排量')return `${name}：${p.demand}${p.unit}`;
  if(p.sets===null)return `${name}：未设置总配数，暂不能查询余量`;
  return `${name}：余量 ${p.remaining}${p.unit}（已排 ${p.demand} / 总配数 ${p.sets}${p.overflow?'，超排 '+p.overflow+p.unit:''}）`;
 });
 const total=rows.reduce((n,p)=>n+p.demand,0);
 // The reply never repeats the queried word; each line is already self-describing.
 const reply=[`${c.name}｜${selected.label}`,...lines].join('\n');
 return {reply,products:rows,totalDemand:total};
}
