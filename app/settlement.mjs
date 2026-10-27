import {cents,isGift,purchasePool} from './order-planning.mjs';
import {orderedRecords,recordOwner,recordMember} from './workflow.mjs';
import {groupRecipients} from './public/enrollment-people.js';
import {giftCounts,giftTiers} from './public/gift-tiers.js';
import {planningIssues} from './campaign-lifecycle.mjs';
export const creditTypes=[{id:'none',name:'无优惠',paid:0,face:0},{id:'600-620',name:'600–620',paid:600,face:620},{id:'1000-1050',name:'1000–1050',paid:1000,face:1050},{id:'3000-3200',name:'3000–3200',paid:3000,face:3200}];
export function settlementSettings(b={}){
 if(b.creditType&&b.creditType!=='custom'&&!creditTypes.some(x=>x.id===b.creditType))throw Error('请选择支持的购物金类型');
 const customCredit=b.creditType==='custom'?customCreditValue(b.customCredit):null;
 const giftRevenue=b.giftRevenue==null?null:cents(b.giftRevenue,'特典抵扣收入')/100;
 return {creditType:b.creditType||'',...(customCredit?{customCredit}:{}),giftRevenue,groupPricing:b.groupPricing||{}};
}
export function customCreditValue(value){
 const paid=cents(value?.paid,'购物金购买金额'),face=cents(value?.face,'购物金到账面额');
 if(paid<=0||face<=0||paid>face||face>100000000)throw Error('购物金金额须大于0、购买金额不超过到账面额，且面额不超过100万元');
 return {paid:paid/100,face:face/100};
}
export function groupPricingMode(c,cat,boxId=''){
 const explicit=cat?.averageModesByBox?.[boxId];if(explicit)return explicit==='auto'?'auto':'current';
 const configured=c.settlement?.groupPricing?.[cat?.id+'|'+boxId];if(configured)return configured;
 const products=c.products.filter(p=>(p.categoryId||p.type)===cat?.id&&(p.boxId||'')===boxId);
 return products.length&&products.every(p=>p.averagePrice==null&&p.price==null)?'auto':'current';
}
function groupOriginalCents(c,cat,boxId,pool){
 const box=pool.find(x=>x.kind==='group'&&x.categoryId===cat.id&&x.boxId===boxId);
 const roles=c.products.filter(p=>(p.categoryId||p.type)===cat.id&&(p.boxId||'')===boxId).length;
 const bought=c.orderPlanning?.source?(c.orderPlanning.plan.orders||[]).flatMap(o=>o.lines||[]).filter(l=>l.id==='box:'+cat.id+'|'+boxId):[],quantity=bought.reduce((n,l)=>n+l.quantity,0);
 if(quantity&&roles)return bought.reduce((n,l)=>n+l.quantity*l.unitCents,0)/quantity/roles;
 // Each pass SKU is one character's pair: a 350-yuan, seven-role box is 50 per pair.
 return box?.price==null||!roles?null:cents(box.price)/roles;
}
export function applyAutomaticGroupPrices(c,db={}){
 const result=settlementSummary(c,db);if(result.rate===null)return {updated:0,summary:result};
 const pool=c.orderPlanning?.plan?.pool||purchasePool(c);let updated=0;
 for(const p of c.products){const cat=c.categories.find(x=>x.id===(p.categoryId||p.type)),box=p.boxId||'';if(cat?.kind!=='group'||cat.pricingMode==='fixed'||groupPricingMode(c,cat,box)!=='auto')continue;
  const original=groupOriginalCents(c,cat,box,pool);if(original===null)continue;const average=Math.round(original*result.rate),price=average+Math.round((p.adjustment||0)*100);
  cat.averageModesByBox??={};cat.averageModesByBox[box]='auto';c.settlement.groupPricing??={};c.settlement.groupPricing[cat.id+'|'+box]='auto';
  const nextPrice=price<0?null:price/100;if(p.averagePrice!==average/100||p.price!==nextPrice){p.averagePrice=average/100;p.price=nextPrice;updated++;}
 }
 if(updated){c.revision=(c.revision||0)+1;for(const r of c.records){const p=c.products.find(p=>p.id===r.skuId);if(p&&['暂估','待定价'].includes(r.status)){r.unitCents=p.price==null?null:Math.round(p.price*100);r.status=p.price==null?'待定价':'暂估';}}}
 return {updated,summary:settlementSummary(c,db)};
}
// Allocate actual gift demand in comment order; a SET needs both tiers atomically.
export function defaultGiftRevenue(c){
 const plan=c.orderPlanning?.plan,details=[],missing=[];
 if(!plan?.orders?.length)return {cents:null,details,missing:['请先生成下单规划']};
 const counts=giftCounts(plan),supply=Object.fromEntries(Array.from({length:Math.max(2,counts.length)},(_,i)=>['tier'+(i+1),counts[i]??0]));
 if(Object.values(supply).some(n=>!Number.isSafeInteger(n)||n<0))return {cents:null,details,missing:['下单规划缺少特典数量，请重新规划']};
 const remaining={...supply};let revenue=0;
 for(const r of orderedRecords(c)){
  const p=c.products.find(p=>p.id===r.skuId);if(!p||!isGift(p,c))continue;
  let quantity=0;
  const tiers=giftTiers(p,c.products);
  if(tiers){const required={};for(const tier of tiers)required['tier'+tier]=(required['tier'+tier]||0)+1;quantity=Math.min(r.quantity,...Object.entries(required).map(([key,n])=>Math.floor((remaining[key]??0)/n)));for(const [key,n]of Object.entries(required))if(key in remaining)remaining[key]-=quantity*n;}
  else if(Object.values(supply).some(Boolean))missing.push(p.name+'尚未标记特典档次或SET组成档次');
  if(quantity&&p.price==null)missing.push(p.name+'：特典售价尚未填写');
  const income=quantity&&p.price!=null?cents(p.price)*quantity:0;revenue+=income;
  details.push({recordId:r.id,skuId:p.id,name:p.name,requested:r.quantity,quantity,excluded:r.quantity-quantity,revenueCents:quantity&&p.price==null?null:income});
 }
 return {cents:missing.length?null:revenue,details,supply,used:Object.fromEntries(Object.keys(supply).map(key=>[key,supply[key]-remaining[key]])),missing:[...new Set(missing)]};
}
export function settlementSummary(c,db={}){
 const plan=c.orderPlanning?.plan,config=c.settlement||{},missing=[];
 missing.push(...planningIssues(c));
 if(!plan?.orders?.length)missing.push('请先生成下单规划');
 const orders=plan?.orders||[];let actual=0;
 for(const o of orders){if(o.actualPaid==null){missing.push('第'+o.number+'单未填写实付金额');continue;}actual+=cents(o.actualPaid);}
 let credit=creditTypes.find(x=>x.id===config.creditType);
 if(config.creditType==='custom')try{credit={id:'custom',...customCreditValue(config.customCredit)};}catch(e){missing.push(e.message);}
 if(!credit)missing.push('请选择购物金类型');
 const complete=orders.length>0&&orders.every(o=>o.actualPaid!=null);
 const noCredit=credit?.id==='none',face=credit?cents(credit.face):0,paid=credit?cents(credit.paid):0,creditUsed=complete?(noCredit?0:actual):null,cash=complete?(noCredit?actual:0):null,creditCost=credit&&complete?(noCredit?0:actual*paid/face):null,effective=creditCost===null?null:Math.round(creditCost+(cash||0));
 const unpricedGifts=c.products.filter(p=>isGift(p,c)&&p.price==null).map(p=>({id:p.id,name:p.name}));
 const warnings=unpricedGifts.length?['特典售价尚未填写：'+unpricedGifts.map(p=>p.name).join('、')+'。请在商品建档中补充；若不收取费用，请明确填写0。']:[];
 const gifts=c.records.filter(r=>isGift(c.products.find(p=>p.id===r.skuId),c));
 for(const p of unpricedGifts)if(gifts.some(r=>r.skuId===p.id))missing.push(p.name+'：特典售价尚未填写');
 const demandCounts=giftCounts(plan).map(()=>0),giftDemand={tier1:0,tier2:0,unknown:0};
 for(const r of gifts){const p=c.products.find(p=>p.id===r.skuId),tiers=giftTiers(p,c.products);if(!tiers){giftDemand.unknown+=r.quantity;continue;}for(const tier of tiers){while(demandCounts.length<tier)demandCounts.push(0);demandCounts[tier-1]+=r.quantity;}}
 giftDemand.byTier=demandCounts;giftDemand.tier1=demandCounts[0]??0;giftDemand.tier2=demandCounts[1]??0;
 const giftDefault=defaultGiftRevenue(c),giftRevenueMode=config.giftRevenue==null?'auto':'manual';
 const giftRevenue=giftRevenueMode==='auto'?giftDefault.cents:cents(config.giftRevenue);
 if(giftRevenueMode==='auto')missing.push(...giftDefault.missing);
 if(effective!==null&&giftRevenue!==null&&giftRevenue>effective&&orders.length)missing.push('特典抵扣收入高于购物金折算成本，请核对');
 const original=plan?.totalCents??null,net=effective===null||giftRevenue===null?null:effective-giftRevenue,rate=original>0&&net!==null?net/original:null;
 const ready=!missing.length&&rate!==null,items=financialItems(c,db,ready?{rate,shoppingRate:effective/original}:null);
 const unknown=items.filter(x=>x.finalCents===null);if(unknown.length)missing.push('仍有'+unknown.length+'件商品待定价');
 for(const issue of new Set(items.map(x=>x.pricingIssue).filter(Boolean)))missing.push(issue);
 const people=groupRecipients(items).map(person=>({...person,totalCents:person.items.some(x=>x.finalCents===null)?null:person.items.reduce((n,x)=>n+x.finalCents,0)}));
 return {ready:ready&&!unknown.length,warnings,unpricedGifts,creditType:credit?.id||'',missing:[...new Set(missing)],giftDemand,giftDefault,defaultGiftRevenueCents:giftDefault.cents,giftRevenueMode,originalCents:original,actualCents:complete?actual:null,creditUsedCents:creditUsed,creditFaceCents:face,creditPaidCents:paid,cashCents:cash,creditCostCents:creditCost===null?null:Math.round(creditCost),shoppingCents:effective===null?null:Math.round(effective),giftRevenueCents:giftRevenue,netCents:net===null?null:Math.round(net),rate:ready?rate:null,people,items,receivableCents:people.some(x=>x.totalCents===null)?null:people.reduce((n,x)=>n+x.totalCents,0)};
}
export function financialItems(c,db={},conversion=null){
 const pool=c.orderPlanning?.plan?.pool||purchasePool(c),items=[];
 for(const r of orderedRecords(c)){
  const p=c.products.find(p=>p.id===r.skuId);if(!p)throw Error('报名引用的商品不存在');
  const cat=c.categories.find(x=>x.id===(p.categoryId||p.type)),gift=isGift(p,c),grouped=cat?.kind==='group',auto=conversion&&groupPricingMode(c,cat,p.boxId||'')==='auto'&&cat.pricingMode!=='fixed';
  const bought=(c.orderPlanning?.plan?.orders||[]).flatMap(o=>o.lines||[]).filter(l=>l.id==='sku:'+p.id),boughtQuantity=bought.reduce((n,l)=>n+l.quantity,0);
  const original=grouped?groupOriginalCents(c,cat,p.boxId||'',pool):boughtQuantity?bought.reduce((n,l)=>n+l.unitCents*l.quantity,0)/boughtQuantity:p.price==null?null:cents(p.price);
  const average=auto?(original===null?null:Math.round(original*conversion.rate)):p.averagePrice==null?null:cents(p.averagePrice);
  const adjustment=Number.isFinite(p.adjustment)?Math.round(p.adjustment*100):0;
  const final=gift?(p.price==null?null:cents(p.price)):grouped?(auto?(average===null?null:average+adjustment):p.price==null?null:cents(p.price)):conversion?(original===null?null:Math.round(original*conversion.rate)):p.price==null?null:cents(p.price);
  const pricingIssue=final!==null&&final<0?p.name+'折算后价格为负，请核对均价和调价':'';
  const ownerKey=r.identityMode==='cn'?'manual-cn:'+recordOwner(db,r,c.groupId):r.qq||recordOwner(db,r,c.groupId),personKey=r.proxyFor?JSON.stringify([ownerKey,r.proxyFor]):r.identityMode==='cn'?ownerKey:r.qq||r.member;
  for(let i=0;i<r.quantity;i++)items.push({recordId:r.id,skuId:p.id,personKey,ownerKey,ownerCN:recordOwner(db,r,c.groupId),cn:recordMember(db,r,c.groupId),proxyFor:r.proxyFor||'',name:p.name,unit:p.unit||(grouped?'对':'件'),categoryId:cat?.id||p.type,categoryName:cat?.name||p.type,kind:cat?.kind||'single',boxId:p.boxId||'',gift,averageCents:average,adjustmentCents:adjustment,originalValue:original===null?null:original/100,originalCents:original===null?null:Math.round(original),shoppingCents:conversion&&original!==null&&!gift?Math.round(original*conversion.shoppingRate):null,finalCents:pricingIssue?null:final,pricingIssue});
 }
 return items;
}
