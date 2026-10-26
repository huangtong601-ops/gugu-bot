import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {planOrders,purchasePool} from './order-planning.mjs';import {settlementSummary,settlementSettings,defaultGiftRevenue,applyAutomaticGroupPrices} from './settlement.mjs';import {tableData,workbook} from './tables.mjs';import {ensureGiftSet,mergeBoxPrices} from './public/product-merge.js';import {catalog} from './domain.mjs';import {start} from './server.mjs';
import {parseComment,categories} from './workflow.mjs';
const settings={tier1:100,tier2:400,objective:'tier2',rewardMode:'both',rule:'once'};
const fromPrices=prices=>prices.map((price,i)=>({id:'p'+i,name:'商品'+i,price,quantity:1,unit:'件'}));
test('three-tier remainder strategies prioritize highest tier, then either lower tiers or one remainder order',()=>{
 const pool=fromPrices([500,125,125,100,100]),config={tiers:[100,250,500],rewardMode:'both',rule:'once'};
 const more=planOrders(pool,{...config,leftoverStrategy:'moreGifts'}),few=planOrders(pool,{...config,leftoverStrategy:'fewerOrders'});
 assert.deepEqual(more.giftCounts,[4,2,1]);assert.equal(more.orders.length,4);assert.deepEqual(few.giftCounts,[2,2,1]);assert.equal(few.orders.length,2);
 assert.equal(few.orders[1].subtotal,45000);assert.equal(few.totalCents,95000);assert.equal(more.totalCents,95000);assert.ok(more.proven&&few.proven);
 for(const plan of [more,few])assert.deepEqual(plan.orders.flatMap(o=>o.lines).map(l=>l.id).sort(),pool.map(x=>x.id).sort());
 const noTop=planOrders(fromPrices([100,100,100]),{...config,leftoverStrategy:'fewerOrders'});assert.equal(noTop.orders.length,1);assert.deepEqual(noTop.giftCounts,[1,1,0]);
});
test('tier thresholds strictly increase, arbitrary configured tiers produce cumulative or stacking rewards',()=>{
 const config={tiers:[100,200,300,400],rewardMode:'both',rule:'once'};
 assert.deepEqual(planOrders(fromPrices([450]),config).giftCounts,[1,1,1,1]);
 assert.deepEqual(planOrders(fromPrices([450]),{...config,rule:'stack'}).giftCounts,[4,2,1,1]);
 for(const tiers of [[],[100,100],[100,90],[100,null],[0],[100,200,199],[100,200,300,400,500,600]])assert.throws(()=>planOrders(fromPrices([500]),{...config,tiers}));
 assert.deepEqual(planOrders(fromPrices([500]),{...config,tiers:[100,200,300,400,500]}).giftCounts,[1,1,1,1,1]);
 assert.deepEqual(planOrders(fromPrices([90]),{...config,tiers:[100]}).giftCounts,[0]);
});
test('multi-tier planning matches exhaustive partitions for small mixed baskets',()=>{
 const config={tiers:[30,65,100],rewardMode:'both',rule:'once'};
 const compare=(a,b)=>{for(let i=2;i>=0;i--)if(a[i]!==b[i])return a[i]-b[i];return 0;};
 for(const values of [[48,42,38,32,28,12],[70,60,45,25,20],[90,40,35,30,25,15]]){
  let best=[0,0,0];const bins=[];
  const enumerate=i=>{if(i===values.length){const score=config.tiers.map(t=>bins.filter(v=>v>=t).length);if(compare(score,best)>0)best=score;return;}for(let j=0;j<bins.length;j++){bins[j]+=values[i];enumerate(i+1);bins[j]-=values[i];}bins.push(values[i]);enumerate(i+1);bins.pop();};enumerate(0);
  const plan=planOrders(fromPrices(values),config);assert.deepEqual(plan.giftCounts,best);assert.equal(plan.proven,true);
  const fewer=planOrders(fromPrices(values),{...config,leftoverStrategy:'fewerOrders'});assert.equal(fewer.giftCounts[2],best[2]);assert.ok(fewer.orders.filter(o=>o.subtotal<10000).length<=1);
 }
});
test('third-tier products and SET components consume the matching tier stocks and survive catalog and aliases',()=>{
 const c=priced();c.orderPlanning.plan.giftCounts=[1,1,1];c.products.push({id:'three',name:'三档赠品',giftTier:3,type:'特典',categoryId:'gift',price:30});
 c.products.find(p=>p.id==='set').giftComponents=['one','three'];c.records=[{id:'s',skuId:'set',quantity:1,createdAt:'2026-10-23T01:00:00Z'},{id:'third',skuId:'three',quantity:2,createdAt:'2026-10-23T02:00:00Z'}];
 assert.equal(defaultGiftRevenue(c).cents,2500);assert.deepEqual(defaultGiftRevenue(c).used,{tier1:1,tier2:0,tier3:1});assert.deepEqual(settlementSummary(c).giftDemand.byTier,[1,0,3]);
 assert.equal(catalog([{name:'三档赠品',type:'特典',price:30,giftTier:3}])[0].giftTier,3);assert.deepEqual(parseComment('三档特典2',[c.products.at(-1)]).items,[{skuId:'three',quantity:2}]);
 const old=priced();delete old.orderPlanning.plan.giftCounts;assert.equal(defaultGiftRevenue(old).cents,2500);
});
test('gift defaults cap existing demand and share tier stock with atomic SETs in comment order',()=>{
 const c=priced();c.orderPlanning.plan.giftCounts=[3,2];c.orderPlanning.plan.tier1=3;c.orderPlanning.plan.tier2=2;
 c.records=[{id:'late',skuId:'two',quantity:4,createdAt:'2026-10-23T03:00:00Z'},{id:'middle',skuId:'set',quantity:3,createdAt:'2026-10-23T02:00:00Z'},{id:'first',skuId:'one',quantity:2,createdAt:'2026-10-23T01:00:00Z'}];
 const result=defaultGiftRevenue(c);assert.equal(result.cents,7500);assert.deepEqual(result.details.map(x=>[x.recordId,x.quantity]),[['first',2],['middle',1],['late',1]]);assert.deepEqual(result.used,{tier1:3,tier2:2});
 c.orderPlanning.plan.giftCounts[0]=2;c.orderPlanning.plan.tier1=2;assert.equal(defaultGiftRevenue(c).cents,7000);assert.equal(defaultGiftRevenue(c).details[1].quantity,0);assert.equal(defaultGiftRevenue(c).details[2].quantity,2);
 c.records=[];assert.equal(defaultGiftRevenue(c).cents,0);
});
test('unavailable gifts do not invent income; missing prices and tiers remain unknown, manual zero survives',()=>{
 const c=priced();c.products.find(p=>p.id==='set').price=null;c.orderPlanning.plan.giftCounts[1]=0;c.orderPlanning.plan.tier2=0;
 assert.equal(defaultGiftRevenue(c).cents,0);c.orderPlanning.plan.giftCounts[1]=1;c.orderPlanning.plan.tier2=1;assert.equal(defaultGiftRevenue(c).cents,null);
 c.products.find(p=>p.id==='set').giftTier=null;assert.match(defaultGiftRevenue(c).missing.join(),/档次/);
 c.settlement.giftRevenue=0;assert.equal(settlementSummary(c).giftRevenueCents,0);assert.equal(settlementSummary(c).giftRevenueMode,'manual');assert.equal(settlementSummary(c).defaultGiftRevenueCents,null);
 c.settlement.giftRevenue=12.34;assert.equal(settlementSummary(c).giftRevenueCents,1234);
 c.settlement.giftRevenue=null;c.products.find(p=>p.id==='set').giftTier='set';c.products.find(p=>p.id==='set').price=25;assert.equal(settlementSummary(c).giftRevenueCents,2500);
 delete c.orderPlanning;assert.equal(defaultGiftRevenue(c).cents,null);
});
test('whole-box imported prices persist per box and manual purchase overrides including zero are preserved',()=>{
 const c=fixture(),group=c.categories[0];const observations=[{boxId:'55.0',price:350}];assert.equal(mergeBoxPrices(c.categories,c.products,observations),1);assert.equal(purchasePool(c)[0].price,350);
 assert.equal(mergeBoxPrices(c.categories,c.products,[{boxId:'55.0',price:400}]),0);assert.equal(group.boxPrices['55.0'],350);
 c.categories=categories(c.categories);assert.equal(c.categories[0].boxPrices['55.0'],350);assert.throws(()=>categories([{...group,boxPrices:{x:-1}}]));
 c.products.push({...c.products[0],id:'other',boxId:'56.0'});mergeBoxPrices(c.categories,c.products,[{boxId:'56.0',price:420}]);assert.equal(purchasePool(c).find(x=>x.boxId==='56.0').price,420);
 c.orderPlanning={pool:[{id:'box:g|55.0',price:null,quantity:1}]};assert.equal(purchasePool(c)[0].price,350);c.orderPlanning.pool[0].price=0;assert.equal(purchasePool(c)[0].price,0);c.orderPlanning.pool[0].price=360;assert.equal(purchasePool(c)[0].price,360);
});
test('manual deduction persists through restart while the capped default remains independently available',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-gift-default-')),c=priced();
 c.categories[0].boxPrices={'55.0':420};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[c],settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''},qqGroups:[{id:'11111',name:'测试群'}]}));
 let service=await start({port:0,dataDir:dir});
 const post=async(route,body)=>{const r=await fetch(service.url+'/api/'+route,{method:'POST',headers:{origin:service.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',...body})});assert.equal(r.status,200);return r.json();};
 try{
  const saved=await post('settlement-settings',{version:1,creditType:'600-620',giftRevenue:0,groupPricing:{'g|55.0':'auto'}});assert.equal(saved.summary.giftRevenueCents,0);assert.equal(saved.summary.defaultGiftRevenueCents,2500);
  await new Promise(r=>service.server.close(r));service=await start({port:0,dataDir:dir});
  let state=await post('planning-state',{});assert.equal(state.settlement.giftRevenue,0);assert.equal(state.summary.giftRevenueCents,0);assert.equal(state.summary.giftRevenueMode,'manual');
  const db=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(db.campaigns[0].categories[0].boxPrices['55.0'],420);
  const reset=await post('settlement-settings',{version:state.settlement.version,creditType:'600-620',giftRevenue:null,groupPricing:{'g|55.0':'auto'}});assert.equal(reset.summary.giftRevenueCents,2500);assert.equal(reset.summary.giftRevenueMode,'auto');
 }finally{await new Promise(r=>service.server.close(r));await fs.rm(dir,{recursive:true});}
});
test('planning prioritizes second-tier gifts and purchases every indivisible item once',()=>{const pool=fromPrices(Array(8).fill(100)),p=planOrders(pool,settings);assert.equal(p.tier2,2);assert.equal(p.tier1,2);assert.equal(p.totalCents,80000);assert.equal(p.orders.flatMap(o=>o.lines).reduce((n,l)=>n+l.quantity,0),8);assert.equal(planOrders(pool,{...settings,objective:'total'}).tier1,8);assert.equal(planOrders(pool,{...settings,rule:'stack'}).orders.length,1);});
test('document example reaches ten 219-yuan orders and preserves all 2313 yuan',()=>{const prices=[258,150,150,150,150,150,150,150,88,78,78,58,55,55,55,48,48,48,38,38,25,10,10,48,55,55,55,60],p=planOrders(fromPrices(prices),{...settings,tier1:219,tier2:null});assert.equal(p.tier1,10);assert.equal(p.totalCents,231300);assert.equal(p.proven,true);assert.ok(p.orders.every(o=>o.subtotal>=21900));});
test('invalid prices and thresholds are not replaced with guessed zeros',()=>{assert.throws(()=>planOrders(fromPrices([50]),{...settings,tier1:null}));assert.throws(()=>planOrders(fromPrices([50]),{...settings,tier2:50}));assert.throws(()=>planOrders([{id:'x',name:'整盒',price:null,quantity:1}],settings));});
test('identical order contents retain separate payment identities',()=>{const p=planOrders([{id:'box',name:'整盒',price:350,quantity:3}],{...settings,tier1:219,tier2:null});assert.equal(p.orders.length,3);assert.equal(new Set(p.orders.map(o=>o.id)).size,3);});
function fixture(){const categories=[{id:'g',name:'通行证',kind:'group',setsByBox:{'55.0':1}},{id:'s',name:'单领',kind:'single'},{id:'gift',name:'特典',kind:'single'}],products=[...Array.from({length:7},(_,i)=>({id:'r'+i,name:'通行证-角色'+i,type:'通行证',categoryId:'g',boxId:'55.0',character:'角色'+i,averagePrice:null,adjustment:i===0?10:i===1?-10:0,price:null,unit:'对'})),{id:'single',name:'立牌',type:'单领',categoryId:'s',price:50,unit:'件'},{id:'one',name:'一档特典',type:'特典',categoryId:'gift',price:15,giftTier:1},{id:'two',name:'二档特典',type:'特典',categoryId:'gift',price:20,giftTier:2}];ensureGiftSet(products,()=> 'set');products.find(p=>p.id==='set').price=25;const records=[{id:'a',skuId:'r0',qq:'12345',member:'测试甲',quantity:2,createdAt:'2026-10-23T01:00:00Z'},{id:'b',skuId:'single',qq:'54321',member:'测试乙',quantity:1,createdAt:'2026-10-23T02:00:00Z'},{id:'d',skuId:'set',qq:'12345',member:'测试甲',quantity:1,createdAt:'2026-10-23T03:00:00Z'}];return {id:'c',name:'示例期次',botId:'zhougu',groupId:'11111',revision:0,categories,products,records};}
function priced(){const c=fixture(),pool=purchasePool(c).map(p=>({...p,price:p.kind==='group'?350:p.price}));c.orderPlanning={version:1,pool,plan:planOrders(pool,{...settings,tier1:219,tier2:300})};for(const o of c.orderPlanning.plan.orders)o.actualPaid=o.subtotal/100;c.settlement={...settlementSettings({creditType:'600-620',groupPricing:{'g|55.0':'auto'}}),version:1};return c;}
test('automatic averages import after settlement using a 50-yuan pair, and recalculate without overwriting manual or fixed prices',()=>{
 const c=priced();c.orderPlanning.plan.orders[0].actualPaid=null;assert.equal(applyAutomaticGroupPrices(c).updated,0);assert.equal(c.products[0].averagePrice,null);
 for(const order of c.orderPlanning.plan.orders)order.actualPaid=order.subtotal/100;
 const result=applyAutomaticGroupPrices(c);assert.equal(result.updated,7);assert.equal(c.products[0].averagePrice,45.26);assert.equal(c.products[0].price,55.26);assert.equal(result.summary.items.find(i=>i.skuId==='r0').originalCents,5000);assert.equal(c.categories[0].averageModesByBox['55.0'],'auto');
 const revision=c.revision;assert.equal(applyAutomaticGroupPrices(c).updated,0);assert.equal(c.revision,revision);
 for(const order of c.orderPlanning.plan.orders)order.actualPaid=order.subtotal/200;applyAutomaticGroupPrices(c);assert.equal(c.products[0].averagePrice,21.07);
 c.categories[0].averageModesByBox['55.0']='manual';const manual=c.products[0].averagePrice;for(const order of c.orderPlanning.plan.orders)order.actualPaid=order.subtotal/100;assert.equal(applyAutomaticGroupPrices(c).updated,0);assert.equal(c.products[0].averagePrice,manual);
 c.categories[0].averageModesByBox['55.0']='auto';c.categories[0].pricingMode='fixed';assert.equal(applyAutomaticGroupPrices(c).updated,0);assert.equal(c.products[0].averagePrice,manual);
 assert.equal(categories(c.categories)[0].averageModesByBox['55.0'],'auto');
});
test('automatic pair average follows the confirmed box price rather than a hardcoded 25 or 50',()=>{
 const c=priced(),box=c.orderPlanning.plan.pool.find(p=>p.kind==='group');box.price=420;
 const s=applyAutomaticGroupPrices(c).summary,item=s.items.find(i=>i.skuId==='r0');assert.equal(item.originalCents,6000);assert.equal(item.averageCents,Math.round(6000*s.rate));
});
test('SET has its own price, survives catalog and repeat recognition, and is excluded from purchase pool',()=>{const c=fixture();assert.equal(ensureGiftSet(c.products,()=> 'bad'),0);assert.equal(c.products.filter(p=>p.giftTier==='set').length,1);assert.equal(c.products.find(p=>p.id==='set').price,25);const clean=catalog(c.products,c.categories);assert.deepEqual(clean.find(p=>p.id==='set').giftComponents,['one','two']);assert.equal(purchasePool(c).some(p=>p.id==='sku:set'),false);});
test('comments can enroll gift tiers and SET independently through tier aliases',()=>{const c=fixture();assert.deepEqual(parseComment('SET1一档2二档1',c.products).items,[{skuId:'set',quantity:1},{skuId:'one',quantity:2},{skuId:'two',quantity:1}]);});
test('shopping-money conversion precedes gift income and SET occupies both tiers only once',()=>{const c=priced(),s=settlementSummary(c);assert.equal(s.originalCents,40000);assert.equal(s.shoppingCents,38710);assert.equal(s.giftRevenueCents,2500);assert.equal(s.netCents,36210);assert.equal(s.giftDemand.tier1,1);assert.equal(s.giftDemand.tier2,1);assert.equal(s.items.filter(i=>i.gift).length,1);assert.equal(s.items.find(i=>i.skuId==='set').finalCents,2500);assert.equal(s.items.find(i=>i.skuId==='r0').averageCents,4526);assert.equal(s.items.find(i=>i.skuId==='r0').finalCents,5526);assert.equal(s.items.find(i=>i.skuId==='single').finalCents,4526);assert.equal(s.ready,true);});
test('all three configured credit types use the confirmed purchase-to-face ratio',()=>{const c=priced();for(const [id,expected]of [['600-620',38710],['1000-1050',38095],['3000-3200',37500]]){c.settlement.creditType=id;assert.equal(settlementSummary(c).shoppingCents,expected);}assert.throws(()=>settlementSettings({creditType:'400-426'}),/请选择/);});
test('unentered payments stay unavailable while explicit zero is preserved',()=>{const c=priced();c.orderPlanning.plan.orders[0].actualPaid=null;assert.equal(settlementSummary(c).ready,false);assert.equal(settlementSummary(c).actualCents,null);assert.equal(settlementSummary(c).shoppingCents,null);assert.match(settlementSummary(c).missing.join(),/实付/);for(const o of c.orderPlanning.plan.orders)o.actualPaid=0;c.settlement.giftRevenue=0;c.settlement.groupPricing={};for(const p of c.products)if(p.type==='通行证')p.price=0;assert.equal(settlementSummary(c).actualCents,0);assert.equal(settlementSummary(c).rate,0);});
test('category sheets have role queues, person merges and sample-style financial detail',()=>{const c=priced(),data=tableData(c,{}, {kind:'enrollment'});assert.deepEqual(data.map(s=>s.name),['通行证','单领','特典']);assert.equal(data[0].rows[1][0],'角色0');assert.equal(data[0].rows[2][0],'测试甲');assert.equal(data[0].rows[3][0],'测试甲');assert.ok(data[0].merges.includes('A1:G1'));const final=tableData(c,{}, {kind:'settlement'});assert.ok(final.some(s=>s.name==='折算统计'));const kidney=final.find(s=>s.name==='肾表');assert.ok(kidney.merges.includes('A2:A3'));assert.ok(kidney.merges.includes('C2:C3'));assert.equal(kidney.rows[1][2],135.52);const bytes=workbook(c,{}, {kind:'settlement'});assert.equal(bytes.readUInt32LE(0),0x04034b50);});
test('planning and actual payments persist, stale writes and replanning paid orders are rejected',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-order-test-')),c=fixture();await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[c],settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''},qqGroups:[{id:'11111',name:'测试群'}]}));const s=await start({port:0,dataDir:dir});const post=async(route,body)=>{const r=await fetch(s.url+'/api/'+route,{method:'POST',headers:{origin:s.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',...body})});return {status:r.status,data:await r.json()};};try{const state=(await post('planning-state',{})).data;const pool=state.pool.map(p=>({...p,price:p.kind==='group'?350:p.price}));const generated=await post('order-plan',{catalogRevision:0,version:0,pool,settings:{tiers:[100,200,300],rewardMode:'both',rule:'once',leftoverStrategy:'fewerOrders'}});assert.equal(generated.status,200);const planning=generated.data.planning;assert.equal((await post('order-payment',{version:planning.version,orderId:planning.plan.orders[0].id,actualPaid:230})).status,200);assert.equal((await post('order-payment',{version:planning.version,orderId:planning.plan.orders[0].id,actualPaid:200})).status,400);assert.equal((await post('order-plan',{catalogRevision:0,version:2,pool,settings})).status,400);const saved=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(saved.campaigns[0].orderPlanning.plan.orders[0].actualPaid,230);assert.deepEqual(saved.campaigns[0].orderPlanning.settings.tiers,[100,200,300]);assert.equal(saved.campaigns[0].orderPlanning.settings.leftoverStrategy,'fewerOrders');}finally{await new Promise(r=>s.server.close(r));await fs.rm(dir,{recursive:true});}});


test('no-credit-discount uses actual payment, still deducts gifts and does not invent credit balances',()=>{
 const c=priced();c.settlement.creditType=settlementSettings({creditType:'none'}).creditType;const s=settlementSummary(c);assert.equal(s.ready,true);assert.equal(s.shoppingCents,s.actualCents);assert.equal(s.shoppingCents,40000);assert.equal(s.giftRevenueCents,2500);assert.equal(s.netCents,37500);assert.equal(s.rate,0.9375);assert.equal(s.creditUsedCents,0);assert.equal(s.creditCostCents,0);assert.equal(s.creditFaceCents,0);assert.equal(s.creditPaidCents,0);assert.equal(s.cashCents,40000);assert.ok(tableData(c,{}, {kind:'settlement'}).length);c.orderPlanning.plan.orders[0].actualPaid=null;assert.equal(settlementSummary(c).shoppingCents,null);
});
test('unpriced unclaimed gifts may save and warn without blocking an otherwise complete settlement',()=>{
 const c=priced();c.products.find(p=>p.id==='one').price=null;c.products.find(p=>p.id==='two').price=null;c.products=catalog(c.products,c.categories);const s=settlementSummary(c);assert.equal(s.ready,true);assert.equal(s.unpricedGifts.length,2);assert.match(s.warnings.join(),/一档特典/);assert.equal(s.giftRevenueCents,2500);assert.equal(s.items.find(p=>p.skuId==='set').finalCents,2500);
});
test('unpriced ordered gifts block final export even when deduction is entered manually; explicit zero is valid',()=>{
 const c=priced();c.products.find(p=>p.id==='set').price=null;for(const giftRevenue of [null,25]){c.settlement.giftRevenue=giftRevenue;const s=settlementSummary(c);assert.equal(s.ready,false);assert.equal(s.rate,null);assert.match(s.missing.join(),/特典SET：特典售价尚未填写/);assert.equal(s.items.find(p=>p.skuId==='set').finalCents,null);assert.throws(()=>tableData(c,{}, {kind:'settlement'}),/售价/);assert.equal(applyAutomaticGroupPrices(c).updated,0);}c.products.find(p=>p.id==='set').price=0;c.settlement.giftRevenue=null;assert.equal(settlementSummary(c).ready,true);assert.equal(settlementSummary(c).giftRevenueCents,0);
});
