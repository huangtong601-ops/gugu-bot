import {createHash,randomUUID} from 'node:crypto';
import {groupCapacity,recordMember,recordOwner} from './workflow.mjs';
import {isCompleted,paidBoxQuantity,planningIssues,purchaseSource} from './campaign-lifecycle.mjs';
import {isGift} from './order-planning.mjs';
import {isGiftCategory} from './public/catalog-utils.js';
import {giftCounts,giftTiers} from './public/gift-tiers.js';
import {enrollment} from './domain.mjs';
import {findQueueEntry} from './queue-order.mjs';

const categoryId=p=>p.categoryId||p.type;
export const bundleRule=(c,id)=>Object.hasOwn(c.bundleRules||{},id)?c.bundleRules[id]:{mode:'normal',count:0};
export const bundleVersion=c=>createHash('sha256').update(JSON.stringify([c.revision,c.categories,c.products,c.records,c.bundleRules,c.bundleLinks,c.queueOrder,c.orderPlanning,c.orderLifecycle])).digest('hex');
const linked=(r,id,unit)=>r.bundleParent?.recordId===id&&(unit===undefined||r.bundleParent.unit===unit);
export const bundleChildren=(c,id,unit)=>c.records.filter(r=>linked(r,id,unit));
const ownLink=(link,id,unit)=>link.parent.recordId===id&&(unit===undefined||link.parent.unit===unit);
export const bundleExistingLinks=(c,id,unit)=>(c.bundleLinks||[]).filter(link=>ownLink(link,id,unit));
const personKey=(db,c,r)=>JSON.stringify([r.identityMode==='cn'?'manual-cn:'+recordOwner(db,r,c.groupId):r.qq||recordOwner(db,r,c.groupId),r.proxyFor||'']);
function scope(c,b){
 const cat=c.categories.find(cat=>cat.id===b.categoryId),box=String(b.boxId||'');
 if(!cat||cat.kind!=='group'&&!isGiftCategory(cat))throw Error('请选择拼团或特典大类');
 const products=c.products.filter(p=>categoryId(p)===cat.id&&(p.boxId||'')===box);
 if(!products.length)throw Error('本大类或分盒已变化，请刷新排表');
 return {cat,box,products};
}
function fresh(c,b){if(b.expectedVersion!==bundleVersion(c))throw Error('商品、排量或选捆规则已变化，请重新打开后核对');}
export function setBundleRule(c,b){
 fresh(c,b);const {products}=scope(c,b),p=products.find(p=>p.id===b.skuId);
 if(!p||p.giftTier==='set')throw Error('请选择本大类分盒内的独立商品');
 if(!['normal','required','available'].includes(b.mode))throw Error('请选择普通、需要上捆或可用于选捆');
 if(b.mode==='required'&&(!Number.isInteger(b.count)||b.count<1||b.count>999))throw Error('每份需带捆数量须为1～999的整数');
 const outgoing=c.records.some(r=>r.skuId===p.id&&(bundleChildren(c,r.id).length||bundleExistingLinks(c,r.id).length)),incoming=c.records.some(r=>r.skuId===p.id&&r.bundleParent)||(c.bundleLinks||[]).some(link=>link.target.skuId===p.id);
 if(outgoing&&b.mode!=='required'||incoming&&b.mode!=='available')throw Error('该商品仍有关联选捆，请先解除后再更改标记');
 const rules={...(c.bundleRules||{})};if(b.mode==='normal')delete rules[p.id];else rules[p.id]={mode:b.mode,count:b.mode==='required'?b.count:0};
 const before=structuredClone(bundleRule(c,p.id));c.bundleRules=rules;
 c.bundleEvents??=[];c.bundleEvents.push({id:randomUUID(),at:new Date().toISOString(),kind:'rule',skuId:p.id,before,after:structuredClone(bundleRule(c,p.id))});return {message:'选捆标记已保存'};
}
function parent(c,b){
 const range=scope(c,b),entry=findQueueEntry(c,b.entryKey);if(!entry)throw Error('排位标识无效，请刷新排表');
 const {record,unit}=entry,p=range.products.find(p=>p.id===record.skuId);
 if(!p||p.giftTier==='set'||record.bundleParent)throw Error('该排位已变化，或不是可上捆的独立排位');
 if(bundleRule(c,p.id).mode!=='required')throw Error('请先将该角色标记为需要上捆');
 return {...range,record,p,unit};
}
export function bundleOptions(c,db,b){
 const {cat,box,products,record,p,unit}=parent(c,b),children=bundleChildren(c,record.id,unit);
 const grouped=cat.kind==='group',configured=groupCapacity(cat,box);
 const boxCapacity=grouped&&isCompleted(c)?Math.min(configured??Infinity,paidBoxQuantity(c,cat.id,box)):configured;
 const gifts=grouped?null:new Map(c.products.filter(product=>isGift(product,c)).map(product=>[product.id,giftTiers(product,c.products)||[]]));
 const options=products.filter(item=>item.id!==p.id&&item.giftTier!=='set'&&bundleRule(c,item.id).mode==='available').map(item=>{
  const own=children.filter(r=>r.skuId===item.id).reduce((n,r)=>n+r.quantity,0);
  const usage=rows=>rows.reduce((n,r)=>n+(grouped?Number(r.skuId===item.id):(gifts.get(r.skuId)||[]).filter(t=>t===item.giftTier).length)*r.quantity,0);
  const demand=usage(c.records),previousUse=usage(children);
  const capacity=grouped?boxCapacity:Number.isInteger(item.giftTier)?giftCounts(c.orderPlanning?.plan||{})[item.giftTier-1]??null:null;
  return {id:item.id,name:item.name,unit:item.unit||(cat.kind==='group'?'对':'件'),quantity:own,stockKey:cat.kind==='group'?item.id:'tier:'+item.giftTier,available:capacity===null?null:Math.max(0,capacity-demand+previousUse),priceCents:item.price==null?null:Math.round(item.price*100)};
 });
 const existingLinks=bundleExistingLinks(c,record.id,unit),mine=personKey(db,c,record),existingOptions=[];
 for(const source of c.records){
  const item=products.find(p=>p.id===source.skuId);if(!item||item.giftTier==='set'||source.bundleParent||source.id===record.id||bundleRule(c,item.id).mode!=='available'||personKey(db,c,source)!==mine)continue;
  const others=new Set((c.bundleLinks||[]).filter(link=>link.target.recordId===source.id&&!ownLink(link,record.id,unit)).map(link=>link.target.unit));
  existingOptions.push({id:source.id,skuId:item.id,name:item.name,unit:item.unit||(cat.kind==='group'?'对':'件'),ordered:source.quantity,quantity:existingLinks.filter(link=>link.target.recordId===source.id).length,available:Math.max(0,source.quantity-others.size)});
 }
 return {version:bundleVersion(c),cn:recordMember(db,record,c.groupId),name:p.name,required:bundleRule(c,p.id).count,options,existingOptions,assigned:children.map(r=>({id:r.id,skuId:r.skuId,quantity:r.quantity})),existingAssigned:existingLinks.length,unitIndex:unit};
}
export function assignBundle(c,db,b){
 fresh(c,b);const info=bundleOptions(c,db,b),{cat,record,p,unit}=parent(c,b),previous=bundleChildren(c,record.id,unit);
 if(!Array.isArray(b.items)||b.items.length>500)throw Error('选捆商品清单无效');
 const previousLinks=bundleExistingLinks(c,record.id,unit),existing=b.existing??[];
 if(b.existing===undefined&&previousLinks.length)throw Error('本排位已有关联的原排量，请重新打开选捆窗口');
 if(!Array.isArray(existing)||existing.length>500)throw Error('已排商品清单无效');
 const ids=new Set(),stock=new Map();let total=0;
 for(const row of b.items){
  if(!row||typeof row.skuId!=='string'||ids.has(row.skuId)||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>999)throw Error('商品不能重复，数量须为1～999的整数');ids.add(row.skuId);
  const option=info.options.find(x=>x.id===row.skuId);if(!option)throw Error('只能选择当前大类分盒内已标记为可用于选捆的商品');
  if(option.available===null)throw Error('请先填写总配数；特典需先生成赠送数量');
  stock.set(option.stockKey,(stock.get(option.stockKey)||0)+row.quantity);
  if(stock.get(option.stockKey)>option.available)throw Error(option.name+'余量不足，请重新选择');total+=row.quantity;
 }
 const existingIds=new Set(),nextLinks=[];
 for(const row of existing){
  if(!row||typeof row.recordId!=='string'||existingIds.has(row.recordId)||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>999)throw Error('已排商品不能重复，数量须为1～999的整数');existingIds.add(row.recordId);
  const option=info.existingOptions.find(x=>x.id===row.recordId);if(!option)throw Error('只能使用本收款对象在当前大类同盒内已排的可选捆商品');
  if(row.quantity>option.available)throw Error(option.name+'的原排量已用于其他捆，请重新选择');
  const source=c.records.find(r=>r.id===row.recordId),others=new Set((c.bundleLinks||[]).filter(link=>link.target.recordId===source.id&&!ownLink(link,record.id,unit)).map(link=>link.target.unit));
  const oldUnits=previousLinks.filter(link=>link.target.recordId===source.id).map(link=>link.target.unit);
  const units=[...new Set([...oldUnits,...Array.from({length:source.quantity},(_,i)=>i)])].filter(i=>i>=0&&i<source.quantity&&!others.has(i)).slice(0,row.quantity);
  if(units.length!==row.quantity)throw Error('原排量已变化，请重新打开选捆窗口');
  for(const i of units)nextLinks.push({parent:{recordId:record.id,unit,skuId:p.id},target:{recordId:source.id,unit:i,skuId:source.skuId}});total+=row.quantity;
 }
 if((b.items.length||existing.length)&&total!==info.required)throw Error('本排位每份需要带'+info.required+'个商品，当前选择了'+total+'个');
 const at=new Date().toISOString(),next=b.items.map((row,index)=>{
  const old=previous.find(r=>r.skuId===row.skuId);
  if(old)return {...old,quantity:row.quantity,bundleUpdatedAt:at};
  return {...enrollment({...row,member:recordMember(db,record,c.groupId)},c.products),id:randomUUID(),...(record.qq?{qq:record.qq}:{}),...(record.identityMode?{identityMode:record.identityMode}:{}),...(record.proxyFor?{proxyFor:record.proxyFor}:{}),sourceType:'bundle',source:'工作台选捆',createdAt:at,itemIndex:index,bundleParent:{recordId:record.id,unit,skuId:p.id}};
 });
 const verifiedPurchase=isCompleted(c)&&cat.kind==='group'&&c.orderPlanning?.source&&!planningIssues(c).length;
 const removed=new Set(previous.map(r=>r.id));c.records=c.records.filter(r=>!removed.has(r.id));c.records.push(...next);
 // Allocating already purchased inventory changes demand, not the underlying purchase.
 if(verifiedPurchase){
  const source=purchaseSource(c);
  if(JSON.stringify(source)!==JSON.stringify(c.orderPlanning.source)){
   c.orderPlanning.source=source;c.orderPlanning.version=(c.orderPlanning.version||0)+1;
  }
 }
 c.bundleLinks=[...(c.bundleLinks||[]).filter(link=>!ownLink(link,record.id,unit)),...nextLinks];
 c.bundleEvents??=[];c.bundleEvents.push({id:randomUUID(),at,kind:'allocation',recordId:record.id,unit,skuId:p.id,before:structuredClone(previous),after:structuredClone(next),beforeLinks:structuredClone(previousLinks),afterLinks:structuredClone(nextLinks)});
 return {message:next.length||nextLinks.length?'选捆已保存，排表与金额已同步':'已解除选捆；原有排量保留，新增捆已移除'};
}
export function hasBundleLinks(c,records){const ids=new Set(records.map(r=>r.id));return records.some(r=>r.bundleParent)||c.records.some(r=>ids.has(r.bundleParent?.recordId))||(c.bundleLinks||[]).some(link=>ids.has(link.parent.recordId)||ids.has(link.target.recordId));}
export function validateBundleCatalog(c,products,categories=c.categories){
 const linkedIds=new Set([...c.records.filter(r=>r.bundleParent).flatMap(r=>[r.skuId,r.bundleParent.skuId]),...(c.bundleLinks||[]).flatMap(link=>[link.parent.skuId,link.target.skuId])]);
 for(const id of linkedIds){const old=c.products.find(p=>p.id===id),next=products.find(p=>p.id===id);if(!old||!next||categoryId(old)!==categoryId(next)||(old.boxId||'')!==(next.boxId||'')||old.giftTier!==next.giftTier||c.categories.find(cat=>cat.id===categoryId(old))?.kind!==categories.find(cat=>cat.id===categoryId(next))?.kind)throw Error('商品仍有关联选捆，请先解除后再删除、移动或改变SET组成');}
}
