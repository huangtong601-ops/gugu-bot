import {isGiftCategory} from './public/catalog-utils.js';
import {orderedRecords,recordMember,groupCapacity} from './workflow.mjs';
import {financialItems} from './settlement.mjs';
import {isGift} from './order-planning.mjs';
import {giftTiers,tierLabel,giftCounts} from './public/gift-tiers.js';
import {groupRecipients} from './public/enrollment-people.js';
import {queueScope,queueEntryKey,queueVersion,orderQueue} from './queue-order.mjs';

const categoryId=p=>p.categoryId||p.type;
const money=value=>value==null?null:Math.round(value*100);
export function categoryQueues(c,db,cat){
 const products=c.products.filter(p=>categoryId(p)===cat.id),gift=isGiftCategory(cat)||(products.length>0&&products.every(p=>isGift(p,c)));
 if(cat.kind!=='group'&&!gift)return [];
 const records=orderedRecords(c),boxes=gift?['']:[...new Set(products.map(p=>p.boxId||''))];
 return boxes.map(box=>{
  const own=gift?products:products.filter(p=>(p.boxId||'')===box),columns=own.filter(p=>!gift||p.giftTier!=='set').map(p=>({id:p.id,label:gift?(Number.isInteger(p.giftTier)?tierLabel(p.giftTier)+' · ':'')+p.name:p.character||p.name,adjustmentCents:money(p.adjustment||0),priceCents:money(p.price),tier:Number.isInteger(p.giftTier)?p.giftTier:null,queue:[],sets:gift?null:groupCapacity(cat,box),unit:p.unit||'件'}));
  const byId=new Map(columns.map(col=>[col.id,col])),sets=new Map();
  for(const p of own.filter(p=>gift&&p.giftTier==='set')){
   let targets=p.giftComponents?.length?p.giftComponents.map(id=>byId.get(id)):giftTiers(p,products)?.map(tier=>{
    const matches=columns.filter(col=>col.tier===tier);
    if(matches.length===1)return matches[0];
    if(matches.length)return null;
    const virtual={id:'tier:'+tier,label:tierLabel(tier)+'特典',tier,queue:[],sets:null,priceCents:null,unit:'份'};columns.push(virtual);byId.set(virtual.id,virtual);return virtual;
   });
   if(!targets?.length||targets.some(col=>!col)||new Set(targets.map(col=>col.id)).size!==targets.length){
    const unresolved={id:p.id,label:p.name+'（组成待核对）',queue:[],sets:null,priceCents:money(p.price),unit:p.unit||'套'};columns.push(unresolved);targets=[unresolved];
   }
   sets.set(p.id,targets);
  }
  for(const r of records){
   const targets=sets.get(r.skuId)||(byId.has(r.skuId)?[byId.get(r.skuId)]:[]);
   for(const column of targets)for(let i=0;i<r.quantity;i++)column.queue.push({cn:recordMember(db,r,c.groupId),fromSet:sets.has(r.skuId),sourceId:r.sourceId||r.id,entryKey:queueEntryKey(r,i)});
  }
  const supply=c.orderPlanning?.plan?giftCounts(c.orderPlanning.plan):[];
  for(const column of columns){
   column.scope=queueScope(cat.id,box,column.id);column.manualOrder=!!c.queueOrder?.columns?.[column.scope]?.length;
   column.queue=orderQueue(c,column.scope,column.queue);column.orderVersion=queueVersion(column.queue);
   if(gift&&column.tier&&Number.isSafeInteger(supply[column.tier-1])&&supply[column.tier-1]>=0)column.sets=supply[column.tier-1];
   column.demand=column.queue.length;column.remaining=column.sets===null?null:Math.max(0,column.sets-column.demand);column.overflow=column.sets===null?0:Math.max(0,column.demand-column.sets);
  }
  return {id:box||cat.id,label:cat.name+(box?' '+box:''),gift,setPrices:gift?own.filter(p=>p.giftTier==='set').map(p=>({name:p.name,priceCents:money(p.price),unit:p.unit||'套'})):[],pricingMode:cat.pricingMode||'adjustment',columns,positions:Math.max(1,...columns.map(col=>Math.max(col.demand,col.sets||0)))};
 });
}

export function reorderQueue(c,db,{categoryId,blockId,columnId,entryKey,direction,expectedVersion}){
 const cat=enrollmentView(c,db).categories.find(cat=>cat.id===categoryId);
 if(!cat||!cat.queues.length)throw Error('只支持拼团类和特典的制品列排序');
 const column=cat.queues.find(block=>block.id===blockId)?.columns.find(col=>col.id===columnId);
 if(!column)throw Error('制品列不存在或已变化，请刷新排表');
 if(expectedVersion!==column.orderVersion)throw Error('排表已变化，请刷新后再调整');
 if(!['up','down','reset'].includes(direction))throw Error('顺序操作无效');
 const columns={...(c.queueOrder?.columns||{})};
 if(direction==='reset'){
  if(!column.manualOrder)return {changed:false,message:'本列已经按评论时间排序'};
  delete columns[column.scope];
 }else{
  const index=column.queue.findIndex(e=>e.entryKey===entryKey);if(index<0)throw Error('该排位不存在或已变化，请刷新排表');
  const to=index+(direction==='up'?-1:1);if(to<0||to>=column.queue.length)throw Error(direction==='up'?'已经是本列第一位':'已经是本列最后一位');
  const keys=column.queue.map(e=>e.entryKey);[keys[index],keys[to]]=[keys[to],keys[index]];columns[column.scope]=keys;
 }
 c.queueOrder={revision:(c.queueOrder?.revision||0)+1,columns};
 return {changed:true,message:direction==='reset'?'本列已恢复评论时间顺序':direction==='up'?'已上移并保存':'已下移并保存'};
}

export function enrollmentView(c,db={}){
 const items=financialItems(c,db);
 return {campaignId:c.id,categories:c.categories.map(cat=>{
  const products=c.products.filter(p=>categoryId(p)===cat.id),own=items.filter(i=>i.categoryId===cat.id),queues=categoryQueues(c,db,cat),gift=queues.some(q=>q.gift);
  return {id:cat.id,name:cat.name,kind:cat.kind,gift,pricingMode:cat.pricingMode||'adjustment',productCount:products.length,quantity:own.length,queues,
   people:groupRecipients(own).map(person=>({key:person.key,cn:person.cn,totalCents:person.items.some(i=>i.finalCents===null)?null:person.items.reduce((n,i)=>n+i.finalCents,0),items:person.items.map(i=>({name:i.name,boxId:i.boxId,originalCents:i.originalCents,averageCents:i.averageCents,adjustmentCents:i.adjustmentCents,finalCents:i.finalCents}))}))};
 })};
}
