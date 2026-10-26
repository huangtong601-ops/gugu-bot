import {createHash,randomUUID} from 'node:crypto';
import {purchasePool,isGift} from './order-planning.mjs';

export const isCompleted=c=>c?.orderLifecycle?.status==='completed';
export const endedMessage=c=>`「${c.name}」本期已经结束，未录入本次排谷；如需补单，请联系管理员。`;
export function requireEnrollmentOpen(c){if(isCompleted(c))throw Error(endedMessage(c));}
// Ignore computed averages and display-only edits. A source snapshot describes purchases,
// not the catalogue revision (automatic settlement also increments that revision).
export function purchaseSource(c){
 const fresh=purchasePool({...c,orderPlanning:undefined});
 return {pool:fresh.map(x=>({id:x.id,price:x.price,quantity:x.quantity,demand:x.demand})).sort((a,b)=>a.id.localeCompare(b.id)),
  roles:c.products.filter(p=>!isGift(p,c)).map(p=>[p.id,p.categoryId||p.type,p.boxId||'']).sort((a,b)=>a[0].localeCompare(b[0]))};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const sourceHash=c=>createHash('sha256').update(JSON.stringify(purchaseSource(c))).digest('hex');
export function planningIssues(c){
 const planning=c.orderPlanning,plan=planning?.plan;if(!plan)return [];
 const issues=[];
 if(planning.source&&!same(planning.source,purchaseSource(c)))issues.push('商品价格、配数或排量已变化，请核对购买清单并更新下单方案');
 const bought=new Map();for(const o of plan.orders||[])for(const line of o.lines||[])bought.set(line.id,(bought.get(line.id)||0)+line.quantity);
 if(planning.source)for(const row of purchasePool({...c,orderPlanning:undefined}))if(row.quantity>(bought.get(row.id)||0)||row.kind==='group'&&row.demand>(bought.get(row.id)||0))issues.push(row.name+'排量或开配数超过已规划购买数量，请补充订单');
 if(planning.supplementOpen)issues.push('补单尚未完成，请生成补单方案并保存实付');
 return issues;
}
export function completeCampaign(c,{version,expectedSource}={}){
 if(version!==(c.orderLifecycle?.version||0))throw Error('期次状态已变化，请刷新后重试');
 if(expectedSource!==sourceHash(c))throw Error('排量或商品已变化，请刷新后核对再完成下单');
 if(isCompleted(c))throw Error('本期已经结束');
 const plan=c.orderPlanning?.plan;
 if(!plan?.orders?.length||plan.orders.some(o=>o.actualPaid==null))throw Error('请先保存全部订单的实付金额');
 if(!c.orderPlanning.source)throw Error('请先点击“核对并沿用原订单”核对历史方案');
 const noExtra=c.orderPlanning?.supplementOpen&&same(c.orderPlanning.source,purchaseSource(c))&&supplementaryPool(c).every(r=>r.quantity===0);
 const issues=planningIssues(noExtra?{...c,orderPlanning:{...c.orderPlanning,supplementOpen:false}}:c);if(issues.length)throw Error(issues.join('；'));
 if(noExtra)c.orderPlanning.supplementOpen=false;
 c.orderLifecycle={...c.orderLifecycle,status:'completed',version:(c.orderLifecycle?.version||0)+1,completedAt:new Date().toISOString(),purchasedOrderIds:plan.orders.map(o=>o.id)};
 // Retain pending comments for review, but never import them while this phase is closed.
 return {ok:true,message:'本期下单已完成',lifecycle:c.orderLifecycle};
}
export function openSupplement(c,{version}={}){
 if(version!==(c.orderLifecycle?.version||0))throw Error('期次状态已变化，请刷新后重试');
 if(c.orderPlanning?.supplementOpen)throw Error('已经处于补单中');
 if(!isCompleted(c)&&(!c.orderPlanning?.plan?.orders?.length||c.orderPlanning.plan.orders.some(o=>o.actualPaid==null)))throw Error('请先保存原订单全部实付，再开启补单');
 const at=new Date().toISOString();
 c.orderLifecycle={...c.orderLifecycle,status:'supplement',version:(c.orderLifecycle?.version||0)+1,supplementOpenedAt:at,purchasedOrderIds:c.orderPlanning.plan.orders.map(o=>o.id)};
 c.orderPlanning.supplementOpen=true;c.orderPlanning.version=(c.orderPlanning.version||0)+1;
 return {ok:true,message:'已开启补单，原订单与实付保留',lifecycle:c.orderLifecycle};
}
export function supplementaryPool(c){
 const pool=purchasePool({...c,orderPlanning:undefined}),purchased=new Map();
 for(const o of c.orderPlanning?.plan?.orders||[])for(const line of o.lines)purchased.set(line.id,(purchased.get(line.id)||0)+line.quantity);
 return pool.map(row=>({...row,purchased:purchased.get(row.id)||0,quantity:Math.max(0,row.quantity-(purchased.get(row.id)||0))}));
}
export function validatePurchasedCatalog(c,next){
 if(!c.orderPlanning?.plan?.orders.some(o=>o.actualPaid!=null))return;
 const groups=new Set(c.orderPlanning.plan.orders.filter(o=>o.actualPaid!=null).flatMap(o=>o.lines||[]).filter(l=>String(l.id).startsWith('box:')).map(l=>l.id.slice(4)));
 const members=(campaign,key)=>campaign.products.filter(p=>(p.categoryId||p.type)+'|'+(p.boxId||'')===key).map(p=>p.id).sort();
 for(const key of groups)if(!same(members(c,key),members(next,key)))throw Error('已下单整盒的款式不能更换；新增整盒请使用新的盒号');
}
export function appendSupplement(c,addition,pool){
 const old=c.orderPlanning.plan,offset=old.orders.length,batchId=randomUUID();
 const orders=[...old.orders,...addition.orders.map((o,i)=>({...o,id:batchId+'-'+o.id,number:offset+i+1,supplement:true}))];
 const combined=new Map((old.pool||[]).map(p=>[p.id,{...p}]));
 for(const row of pool){const previous=combined.get(row.id);if(previous){const total=previous.quantity+row.quantity;if(total&&row.quantity)previous.price=Math.round(((previous.price||0)*previous.quantity+(row.price||0)*row.quantity)/total*100)/100;previous.quantity=total;}else combined.set(row.id,{...row});}
 const counts=Array.from({length:Math.max(old.giftCounts.length,addition.giftCounts.length)},(_,i)=>(old.giftCounts[i]||0)+(addition.giftCounts[i]||0));
 c.orderPlanning={...c.orderPlanning,version:(c.orderPlanning.version||0)+1,source:purchaseSource(c),supplementOpen:false,settings:addition.settings,
  pool:[...combined.values()],plan:{...old,orders,pool:[...combined.values()],totalCents:old.totalCents+addition.totalCents,giftCounts:counts,tier1:counts[0]||0,tier2:counts[1]||0,proven:false}};
}
