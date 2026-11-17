import {createHash,randomUUID} from 'node:crypto';
import {purchasePool,isGift} from './order-planning.mjs';
import {giftCounts} from './public/gift-tiers.js';

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
const paidOrders=orders=>orders.filter(o=>o.actualPaid!=null);
export function canReplanUnpaid(c){
 const orders=c.orderPlanning?.plan?.orders||[];
 return !isCompleted(c)&&orders.some(o=>o.actualPaid!=null)&&orders.some(o=>o.actualPaid==null);
}
function purchaseTotals(orders){
 const totals=new Map();
 for(const order of orders)for(const line of order.lines||[]){
  const total=totals.get(line.id)||{id:line.id,name:line.name,unit:line.unit,quantity:0,cents:0};
  total.quantity+=line.quantity;total.cents+=line.quantity*line.unitCents;totals.set(line.id,total);
 }
 return totals;
}
export function paidBoxQuantity(c,categoryId,boxId){
 const bought=purchaseTotals(paidOrders(c.orderPlanning?.plan?.orders||[]));
 return bought.get('box:'+categoryId+'|'+boxId)?.quantity||0;
}
export const sourceHash=c=>createHash('sha256').update(JSON.stringify(purchaseSource(c))).digest('hex');
export function planningIssues(c){
 const planning=c.orderPlanning,plan=planning?.plan;if(!plan)return [];
 const issues=[];
 if(planning.source&&!same(planning.source,purchaseSource(c)))issues.push('商品价格、配数或排量已变化，请核对购买清单并更新下单方案');
 const bought=purchaseTotals(plan.orders||[]);
 if(planning.source)for(const row of purchasePool({...c,orderPlanning:undefined})){
  const quantity=bought.get(row.id)?.quantity||0;
  if(row.quantity>quantity||row.kind==='group'&&row.demand>quantity)issues.push(row.name+'排量或开配数超过已规划购买数量，请补充订单');
 }
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
 const pool=purchasePool({...c,orderPlanning:undefined}),bought=purchaseTotals(c.orderPlanning?.plan?.orders||[]);
 return pool.map(row=>{const purchased=bought.get(row.id)?.quantity||0;return {...row,purchased,quantity:Math.max(0,row.quantity-purchased)};});
}
export function remainingPurchasePool(c){
 const planning=c.orderPlanning,orders=planning.plan.orders,bought=purchaseTotals(paidOrders(orders));
 const baseline=new Map((planning.source?.pool||[]).map(row=>[row.id,row]));
 const current=new Map(purchasePool({...c,orderPlanning:undefined}).map(row=>[row.id,row]));
 const pendingPrices=new Map(orders.filter(o=>o.actualPaid==null).flatMap(o=>o.lines.map(l=>[l.id,l.unitCents/100])));
 return purchasePool(c).map(row=>{
  const purchased=bought.get(row.id)?.quantity||0,prior=baseline.get(row.id),fresh=current.get(row.id);
  const quantity=row.kind==='group'&&prior&&prior.quantity!==fresh.quantity?fresh.quantity:row.quantity;
  const price=prior&&prior.price!==fresh.price?fresh.price:pendingPrices.get(row.id)??row.price;
  return {...row,purchased,quantity:Math.max(0,quantity-purchased),price};
 });
}
export function validatePurchasedCatalog(c,next){
 if(!c.orderPlanning?.plan?.orders.some(o=>o.actualPaid!=null))return;
 const groups=new Set(c.orderPlanning.plan.orders.filter(o=>o.actualPaid!=null).flatMap(o=>o.lines||[]).filter(l=>String(l.id).startsWith('box:')).map(l=>l.id.slice(4)));
 const members=(campaign,key)=>campaign.products.filter(p=>(p.categoryId||p.type)+'|'+(p.boxId||'')===key).map(p=>p.id).sort();
 for(const key of groups)if(!same(members(c,key),members(next,key)))throw Error('已下单整盒的款式不能更换；新增整盒请使用新的盒号');
}
export function mergeOrderPlan(c,addition,{replaceUnpaid=false}={}){
 const old=c.orderPlanning.plan,kept=replaceUnpaid?paidOrders(old.orders):old.orders;
 const offset=Math.max(0,...kept.map(o=>o.number)),batchId=randomUUID(),supplement=!replaceUnpaid||c.orderLifecycle?.status==='supplement';
 const orders=[...kept,...addition.orders.map((o,i)=>({...o,id:batchId+'-'+o.id,number:offset+i+1,...(supplement?{supplement:true}:{})}))];
 const combined=new Map([...(old.pool||[]),...addition.pool].map(({purchased,...row})=>[row.id,{...row,quantity:0}]));
 for(const {cents,quantity,...line} of purchaseTotals(orders).values()){
  combined.set(line.id,{...(combined.get(line.id)||line),quantity,price:Math.round(cents/quantity)/100});
 }
 const pool=[...combined.values()],totalCents=orders.reduce((sum,order)=>sum+order.subtotal,0);
 const counts=Array.from({length:Math.max(giftCounts(old).length,addition.giftCounts.length)},(_,i)=>orders.reduce((sum,order)=>sum+(giftCounts(order)[i]||0),0));
 c.orderPlanning={...c.orderPlanning,version:(c.orderPlanning.version||0)+1,source:purchaseSource(c),supplementOpen:false,settings:addition.settings,
  pool,plan:{...addition,orders,pool,totalCents,giftCounts:counts,tier1:counts[0]||0,tier2:counts[1]||0,proven:false}};
}
