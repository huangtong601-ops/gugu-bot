import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {setBundleRule,assignBundle,bundleVersion,bundleOptions,bundleChildren,bundleExistingLinks,validateBundleCatalog} from './bundles.mjs';
import {financialItems,settlementSummary} from './settlement.mjs';import {tableData,workbook} from './tables.mjs';import {tableImagePages} from './table-images.mjs';
import {enrollmentView,reorderQueue} from './enrollment-view.mjs';import {queryQueue,queryPersonalQueue} from './queue-query.mjs';import {withdrawAlbumComment} from './album-withdrawal.mjs';import {businessState,businessDiff,createOperationHistory} from './operation-history.mjs';import {createWorkspaceBackups} from './workspace-backups.mjs';import {purchasePool,planOrders} from './order-planning.mjs';import {purchaseSource} from './campaign-lifecycle.mjs';import {start} from './server.mjs';

import {completeCampaign,sourceHash} from './campaign-lifecycle.mjs';

export function bundleFixture(){
 const product=(id,character,price,categoryId='g',boxId='55.0')=>({id,character,name:'通行证-'+character,type:'通行证',categoryId,boxId,price,averagePrice:price,adjustment:0,unit:'对',giftTier:null});
 return {id:'c',name:'合成选捆期次',groupId:'11111',botId:'zhougu',revision:0,categories:[{id:'g',name:'通行证',kind:'group',sets:4,boxPrices:{'55.0':80}},{id:'other',name:'另一大类',kind:'group',sets:4}],products:[product('a','角色甲',30),product('b','角色乙',25),product('cold','角色丙',10),product('cold2','角色丁',15),product('foreign','角色丙',10,'other'),product('box2','角色丙',10,'g','56.0')],records:[{id:'r1',skuId:'a',name:'通行证-角色甲',member:'模拟甲',qq:'12345',quantity:2,createdAt:'2026-01-01T00:00:00Z'},{id:'r2',skuId:'b',name:'通行证-角色乙',member:'模拟乙',qq:'54321',quantity:1,createdAt:'2026-01-01T00:01:00Z'}]};
}
const context=(c,extra={})=>({categoryId:'g',boxId:'55.0',expectedVersion:bundleVersion(c),...extra});
const rule=(c,skuId,mode,count)=>setBundleRule(c,context(c,{skuId,mode,count}));
const pick=(c,id,unit,items)=>assignBundle(c,{},context(c,{entryKey:JSON.stringify([id,unit]),items}));
function prepared(){const c=bundleFixture();rule(c,'a','required',1);rule(c,'b','required',2);rule(c,'cold','available');rule(c,'cold2','available');return c;}

test('per-role N and each individual queue slot remain independent; no quantities change when marking',()=>{
 const c=prepared(),original=bundleFixture();assert.deepEqual(c.records,original.records);assert.equal(c.bundleRules.a.count,1);assert.equal(c.bundleRules.b.count,2);
 pick(c,'r1',0,[{skuId:'cold',quantity:1}]);pick(c,'r2',0,[{skuId:'cold',quantity:1},{skuId:'cold2',quantity:1}]);
 assert.equal(bundleChildren(c,'r1',0).length,1);assert.equal(bundleChildren(c,'r1',1).length,0);assert.equal(bundleChildren(c,'r2',0).length,2);assert.deepEqual(c.records.filter(r=>!r.bundleParent),original.records);
 const grid=enrollmentView(c,{}).categories[0].queues[0];assert.equal(grid.columns[0].bundleRule.count,1);assert.deepEqual(grid.columns[0].queue.map(x=>x.bundleCount),[1,0]);assert.equal(grid.columns[1].queue[0].bundleCount,2);
 const before=JSON.stringify(c);assert.throws(()=>pick(c,'r1',1,[{skuId:'cold',quantity:2}]),/需要带1/);assert.equal(JSON.stringify(c),before);
});
test('stock, stale views, scope, identity and recursion are checked before any changes',()=>{
 const c=prepared(),stale=bundleVersion(c);c.records.push({id:'other-buyer',skuId:'cold',member:'已有买家',quantity:4,createdAt:'2026-01-01'});
 assert.throws(()=>assignBundle(c,{},context(c,{expectedVersion:stale,entryKey:'["r1",0]',items:[{skuId:'cold',quantity:1}]})),/已变化/);
 const before=JSON.stringify(c);for(const items of [[{skuId:'cold',quantity:1}],[{skuId:'foreign',quantity:1}],[{skuId:'box2',quantity:1}],[{skuId:'cold2',quantity:0}],[{skuId:'cold2',quantity:1},{skuId:'cold2',quantity:1}]])assert.throws(()=>pick(c,'r1',0,items));assert.equal(JSON.stringify(c),before);
 for(const count of [0,-1,1.5,1000,'2'])assert.throws(()=>rule(c,'a','required',count),/1～999/);
 assert.throws(()=>assignBundle(c,{},context(c,{entryKey:'["r1",2]',items:[]})),/排位/);
 pick(c,'r1',0,[{skuId:'cold2',quantity:1}]);const child=bundleChildren(c,'r1',0)[0];assert.throws(()=>pick(c,child.id,0,[{skuId:'cold',quantity:1}]),/独立排位/);
});
test('editing replaces only the selected bundle, preserves same-SKU record ids, releases stock and leaves other classes intact',()=>{
 const c=prepared();pick(c,'r1',0,[{skuId:'cold',quantity:1}]);pick(c,'r1',1,[{skuId:'cold2',quantity:1}]);
 const id=bundleChildren(c,'r1',0)[0].id,other=structuredClone(bundleChildren(c,'r1',1)),products=structuredClone(c.products);
 pick(c,'r1',0,[{skuId:'cold',quantity:1}]);assert.equal(bundleChildren(c,'r1',0)[0].id,id);
 pick(c,'r1',0,[{skuId:'cold2',quantity:1}]);assert.equal(c.records.some(r=>r.id===id),false);assert.deepEqual(bundleChildren(c,'r1',1),other);assert.deepEqual(c.products,products);
 assert.equal(bundleOptions(c,{},context(c,{entryKey:'["r1",0]'})).options.find(p=>p.id==='cold2').available,3);
 pick(c,'r1',0,[]);assert.equal(bundleChildren(c,'r1',0).length,0);assert.deepEqual(bundleChildren(c,'r1',1),other);assert.equal(c.records.some(r=>['foreign','box2'].includes(r.skuId)),false);
});
test('bundle charges and membership reach text queries, queues, image rows and final bills, including delegated and manual-CN recipients',()=>{
 const c=prepared();c.records[0].proxyFor='群外模拟';c.records[0].member='模拟甲 代 群外模拟';pick(c,'r1',0,[{skuId:'cold',quantity:1}]);
 const child=bundleChildren(c,'r1',0)[0];assert.equal(child.qq,'12345');assert.equal(child.proxyFor,'群外模拟');assert.equal(child.member,'模拟甲 代 群外模拟');
 const amounts=financialItems(c);assert.equal(amounts.filter(x=>x.personKey===amounts[0].personKey).reduce((n,x)=>n+x.finalCents,0),7000);
 assert.match(queryQueue(c,'排量','通行证55.0').reply,/：1对/);assert.match(queryPersonalQueue([c],'12345').reply,/代 群外模拟.*通行证-角色丙.*：1对/);
 assert.ok(tableData(c,{}, {kind:'enrollment'})[0].rows.some(r=>r.some(x=>x==='通行证-角色丙')));assert.ok(tableImagePages(c,{},['g']).some(p=>p.rows.some(r=>r.cells.some(x=>x.text==='模拟甲 代 群外模拟'))));
 c.products=c.products.filter(p=>!['foreign','box2'].includes(p.id));c.categories=c.categories.slice(0,1);c.settlement={creditType:'none',giftRevenue:0,groupPricing:{}};
 const pool=purchasePool(c),plan=planOrders(pool,{tiers:[1000,2000],rule:'once',rewardMode:'both'});plan.orders.forEach(o=>o.actualPaid=o.subtotal/100);c.orderPlanning={version:1,pool,plan,source:purchaseSource(c)};
 const s=settlementSummary(c);assert.equal(s.ready,true,s.missing.join('；'));assert.ok(s.people.some(p=>p.cn==='模拟甲 代 群外模拟'&&p.totalCents===7000));assert.ok(workbook(c,{}, {kind:'settlement'}).length>1000);
 const d=prepared();delete d.records[0].qq;d.records[0].identityMode='cn';pick(d,'r1',0,[{skuId:'cold',quantity:1}]);assert.equal(bundleChildren(d,'r1',0)[0].identityMode,'cn');assert.equal(bundleChildren(d,'r1',0)[0].qq,undefined);
});
test('withdrawals and catalogue moves cannot break bundle links; closed campaigns require paid stock for new allocations',()=>{
 const c=prepared();pick(c,'r1',0,[{skuId:'cold',quantity:1}]);const binding={groupId:'11111',campaignId:c.id,albumId:'album'},db={campaigns:[c],members:{12345:{cn:'模拟甲'}},albumWithdrawalEnabled:true};
 for(const [id,text,skuId]of [['cancel-hot','撤排 通行证-角色甲','a'],['cancel-cold','撤排 通行证-角色丙','cold']]){const records=JSON.stringify(c.records);withdrawAlbumComment(db,c,binding,{id,text,qq:'12345',groupId:'11111',albumId:'album',at:'2099-01-01T00:00:00Z'},[skuId]);assert.match(binding.withdrawalNotices.at(-1).message,/先解除选捆/);assert.equal(JSON.stringify(c.records),records);}
 assert.throws(()=>rule(c,'a','normal'),/先解除/);assert.throws(()=>rule(c,'cold','normal'),/先解除/);
 assert.throws(()=>validateBundleCatalog(c,c.products.map(p=>p.id==='cold'?{...p,boxId:'56.0'}:p)),/关联选捆/);
 c.orderLifecycle={status:'completed'};
 assert.throws(()=>pick(c,'r1',1,[{skuId:'cold2',quantity:1}]),/余量不足/);
 pick(c,'r1',0,[]);assert.equal(bundleChildren(c,'r1',0).length,0);
 rule(c,'b','required',3);assert.equal(c.bundleRules.b.count,3);
});
test('undo refuses to remove a rule underneath newly assigned records',()=>{
 const c=bundleFixture(),db={campaigns:[c]},before=businessState(db);rule(c,'a','required',1);const history=createOperationHistory(),entry=history.record('client','标记',businessDiff(before,businessState(db)));
 rule(c,'cold','available');pick(c,'r1',0,[{skuId:'cold',quantity:1}]);assert.throws(()=>history.undo(db,'client',entry.id),/新的修改或相册评论/);
});
test('gift selections share tier supply with SETs and variants instead of overselling the same tier',()=>{
 const c=prepared();c.categories=[{id:'g',name:'特典',role:'gift',kind:'single'}];c.products=c.products.slice(0,4).map((p,i)=>({...p,boxId:'',type:'特典',giftTier:i===0?2:1}));c.records=c.records.slice(0,1);c.orderPlanning={plan:{giftCounts:[3,5]}};
 c.records.push({id:'set',skuId:'set',member:'另一个人',quantity:2});c.products.push({id:'set',categoryId:'g',boxId:'',type:'特典',name:'特典SET',giftTier:'set',giftComponents:['cold','a'],price:10});
 const ctx={categoryId:'g',boxId:'',entryKey:'["r1",0]'};
 let info=bundleOptions(c,{},ctx);assert.equal(info.options.find(x=>x.id==='cold').available,1);
 setBundleRule(c,context(c,{boxId:'',skuId:'a',mode:'required',count:2}));const before=JSON.stringify(c);assert.throws(()=>assignBundle(c,{}, {...ctx,expectedVersion:bundleVersion(c),items:[{skuId:'cold',quantity:1},{skuId:'cold2',quantity:1}]}),/余量不足/);assert.equal(JSON.stringify(c),before);
});
test('changing N leaves already selected goods for explicit review; unknown prices remain unknown',()=>{
 const c=prepared();pick(c,'r1',0,[{skuId:'cold',quantity:1}]);rule(c,'a','required',2);assert.equal(bundleChildren(c,'r1',0)[0].quantity,1);
 c.products.find(p=>p.id==='cold2').price=null;let info=bundleOptions(c,{},context(c,{entryKey:'["r1",0]'}));assert.equal(info.required,2);assert.equal(info.options.find(x=>x.id==='cold2').priceCents,null);
 pick(c,'r1',0,[{skuId:'cold',quantity:1},{skuId:'cold2',quantity:1}]);assert.equal(financialItems(c).find(x=>x.skuId==='cold2').finalCents,null);
 assert.ok(tableData(c,{}, {kind:'enrollment'})[0].rows.some(r=>r.some(x=>typeof x==='string'&&x.includes('需捆 2'))));
});

const existingRecord=(extra={})=>({id:'existing-cold',skuId:'cold',name:'通行证-角色丙',member:'模拟甲',qq:'12345',quantity:3,createdAt:'2026-01-01T00:02:00Z',sourceId:'original-cold',requestId:'comment:original-cold:0',...extra});
const useExisting=(c,id,unit,existing,items=[])=>assignBundle(c,{},context(c,{entryKey:JSON.stringify([id,unit]),items,existing}));
test('already enrolled units satisfy N without changing quantities, bills, timestamps, ownership or queue order',()=>{
 const c=prepared();c.records.push(existingRecord());const before=structuredClone(c.records),charges=financialItems(c),personal=queryPersonalQueue([c],'12345').reply;
 // Existing enrollment can be linked even if no further supply is configured.
 c.categories[0].sets=0;useExisting(c,'r1',0,[{recordId:'existing-cold',quantity:1}]);assert.deepEqual(c.records,before);assert.deepEqual(financialItems(c),charges);assert.equal(queryPersonalQueue([c],'12345').reply,personal);
 assert.equal(bundleChildren(c,'r1',0).length,0);assert.equal(bundleExistingLinks(c,'r1',0).length,1);
 let option=bundleOptions(c,{},context(c,{entryKey:'["r1",0]'})).existingOptions[0];assert.equal(option.quantity,1);assert.equal(option.available,3);
 const grid=enrollmentView(c,{}).categories[0].queues[0];assert.equal(grid.columns[0].queue[0].bundleCount,1);assert.equal(grid.columns[2].queue.filter(x=>x.bundleLinked).length,1);
 const firstUnit=bundleExistingLinks(c,'r1',0)[0].target.unit;useExisting(c,'r1',0,[{recordId:'existing-cold',quantity:1}]);assert.equal(bundleExistingLinks(c,'r1',0)[0].target.unit,firstUnit);assert.deepEqual(c.records,before);
 useExisting(c,'r1',0,[]);assert.equal(c.bundleLinks.length,0);assert.deepEqual(c.records,before);assert.deepEqual(financialItems(c),charges);
});
test('each existing unit is reserved once, mixed sources can fill N, and removing links does not cancel original goods',()=>{
 const c=prepared();c.records.push(existingRecord({quantity:2}));useExisting(c,'r1',0,[{recordId:'existing-cold',quantity:1}]);useExisting(c,'r1',1,[{recordId:'existing-cold',quantity:1}]);
 assert.equal(new Set(c.bundleLinks.map(link=>link.target.unit)).size,2);const before=JSON.stringify(c);rule(c,'a','required',2);assert.throws(()=>useExisting(c,'r1',0,[{recordId:'existing-cold',quantity:2}]),/原排量已用于其他捆/);
 useExisting(c,'r1',0,[{recordId:'existing-cold',quantity:1}],[{skuId:'cold2',quantity:1}]);assert.equal(bundleChildren(c,'r1',0)[0].skuId,'cold2');assert.equal(c.records.find(r=>r.id==='existing-cold').quantity,2);
 const oldOther=structuredClone(bundleExistingLinks(c,'r1',1));useExisting(c,'r1',0,[]);assert.deepEqual(bundleExistingLinks(c,'r1',1),oldOther);assert.equal(c.records.some(r=>r.skuId==='cold2'),false);assert.equal(c.records.find(r=>r.id==='existing-cold').quantity,2);
});
test('existing goods must belong to the same recipient and scope, not another QQ, manual identity, proxy or generated bundle',()=>{
 const c=prepared();c.records.push(existingRecord(),existingRecord({id:'other-qq',qq:'77777'}),existingRecord({id:'manual',qq:undefined,identityMode:'cn'}),existingRecord({id:'proxy',proxyFor:'另一位',member:'模拟甲 代 另一位'}),existingRecord({id:'other-cat',skuId:'foreign'}),existingRecord({id:'other-box',skuId:'box2'}));
 const options=bundleOptions(c,{},context(c,{entryKey:'["r1",0]'})).existingOptions;assert.deepEqual(options.map(x=>x.id),['existing-cold']);
 for(const id of ['other-qq','manual','proxy','other-cat','other-box','r1']){const before=JSON.stringify(c);assert.throws(()=>useExisting(c,'r1',0,[{recordId:id,quantity:1}]),/本收款对象/);assert.equal(JSON.stringify(c),before);}
 useExisting(c,'r1',0,[{recordId:'existing-cold',quantity:1}]);assert.throws(()=>pick(c,'r1',0,[]),/重新打开/);
 const before=JSON.stringify(c);assert.throws(()=>useExisting(c,'r1',0,[{recordId:'existing-cold',quantity:1},{recordId:'existing-cold',quantity:1}]),/不能重复/);assert.equal(JSON.stringify(c),before);
});
test('linked original goods cannot be withdrawn, relocated or undone underneath another active link',()=>{
 const c=prepared(),db={campaigns:[c],members:{12345:{cn:'模拟甲'}},albumWithdrawalEnabled:true},before=businessState(db);c.records.push(existingRecord());
 const history=createOperationHistory(),saved=history.record('manual-client','手动录入',businessDiff(before,businessState(db)));
 useExisting(c,'r1',0,[{recordId:'existing-cold',quantity:1}]);assert.throws(()=>history.undo(db,'manual-client',saved.id),/新的修改/);assert.throws(()=>rule(c,'cold','normal'),/先解除/);assert.throws(()=>validateBundleCatalog(c,c.products.map(p=>p.id==='cold'?{...p,boxId:'56.0'}:p)),/关联选捆/);
 const binding={groupId:'11111',campaignId:'c',albumId:'a'},event={id:'cancel-original',text:'撤排 通行证-角色丙',qq:'12345',groupId:'11111',albumId:'a',at:'2099-01-01T00:00:00Z'};
 withdrawAlbumComment(db,c,binding,event,['cold']);assert.match(binding.withdrawalNotices.at(-1).message,/先解除选捆/);assert.equal(c.records.find(r=>r.id==='existing-cold').quantity,3);
 useExisting(c,'r1',0,[]);withdrawAlbumComment(db,c,binding,{...event,id:'cancel-after-unlink'},['cold']);assert.equal(c.records.some(r=>r.id==='existing-cold'),false);
});
test('existing links persist, undo and restore without billing changes, and ignoring source photos cannot remove linked enrollments',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-existing-bundles-'));let app;const client=randomUUID();
 try{
  const c=prepared();c.records.push(existingRecord());c.commentEvents=[{id:'original-cold',photoIds:['photo']}];const binding={groupId:'11111',campaignId:'c',albumId:'album',photos:[{id:'photo',batchId:'batch'}],batchScopes:{batch:{categoryId:'g'}},photoScopes:{photo:{categoryId:'g'}}};
  const db={campaigns:[c],albums:[binding],members:{},groupMembers:{},qqGroups:[{id:'11111'}],settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''}};
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(db));const launch=()=>start({port:0,dataDir:dir,credentialStore:{get:async()=>'',set:async()=>{}}});app=await launch();
  const post=async(route,body={})=>{const res=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',undoClient:client,...body})});return {status:res.status,data:await res.json()};};
  const body={categoryId:'g',boxId:'55.0',entryKey:'["r1",0]',items:[],existing:[{recordId:'existing-cold',quantity:1}]};let view=(await post('enrollment-view')).data;
  let result=await post('bundle-assign',{...body,expectedVersion:view.bundleVersion});assert.equal(result.status,200,result.data.error);const undo=result.data.undo.id;
  const ignored=await post('album-batch-scope',{groupId:'11111',albumId:'album',batchId:'batch',ignored:true});assert.equal(ignored.status,400);assert.match(ignored.data.error,/先解除/);
  let state=await fetch(app.url+'/api/state').then(r=>r.json());assert.deepEqual(state.campaigns[0].records,c.records);assert.equal(state.albums[0].batchScopes.batch.ignored,undefined);
  assert.equal((await post('undo',{id:undo})).status,200);view=(await post('enrollment-view')).data;assert.equal((await post('bundle-assign',{...body,expectedVersion:view.bundleVersion})).status,200);
  state=await fetch(app.url+'/api/state').then(r=>r.json());const backups=await createWorkspaceBackups(dir),backup=await backups.create(state);
  await app.shutdown();app=await launch();state=await fetch(app.url+'/api/state').then(r=>r.json());assert.equal(bundleExistingLinks(state.campaigns[0],'r1',0).length,1);assert.deepEqual(state.campaigns[0].records,c.records);
  const preview=await backups.preview(state,backup.id),restored=await backups.restore(state,{id:backup.id,hash:preview.hash,currentHash:preview.currentHash});assert.equal(restored.campaigns[0].bundleLinks.length,1);assert.deepEqual(restored.campaigns[0].records,c.records);
 }finally{await app?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
test('closed campaign bundles update enrollment and settlement, preserve orders, and persist through undo and restore',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-bundles-'));let app;const client=randomUUID();
 try{
  const c=prepared();c.products=c.products.slice(0,4);c.categories=c.categories.slice(0,1);c.records.push(existingRecord({quantity:2}));
  c.settlement={creditType:'none',giftRevenue:0,groupPricing:{}};
  const pool=purchasePool(c),plan=planOrders(pool,{tiers:[100],rule:'once',rewardMode:'both'});
  for(const order of plan.orders)order.actualPaid=order.subtotal/100;
  c.orderPlanning={version:1,pool,plan,source:purchaseSource(c)};
  completeCampaign(c,{version:0,expectedSource:sourceHash(c)});
  const paid=structuredClone(plan.orders);
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[c],albums:[],members:{},groupMembers:{},qqGroups:[],settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''}}));
  const launch=()=>start({port:0,dataDir:dir,credentialStore:{get:async()=>'',set:async()=>{}},upstreamFetch:async()=>{throw Error('No model calls');}});app=await launch();
  const post=async(route,body={})=>{const res=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',undoClient:client,...body})});return {status:res.status,data:await res.json()};};
  let view=(await post('enrollment-view')).data;
  const input={categoryId:'g',boxId:'55.0',entryKey:'["r1",0]',items:[{skuId:'cold',quantity:1}],expectedVersion:view.bundleVersion};
  let result=await post('bundle-assign',input);assert.equal(result.status,200,result.data.error);assert.ok(result.data.undo);const withBundle=await fs.readFile(path.join(dir,'tables','c.xlsx'));
  assert.equal(result.data.view.categories[0].queues[0].columns.find(p=>p.id==='cold').demand,3);
  const settled=(await post('planning-state')).data;assert.equal(settled.summary.ready,true,settled.summary.missing.join('；'));
  assert.equal(settled.summary.people.find(person=>person.cn==='模拟甲').totalCents,9000);
  assert.deepEqual(settled.planning.plan.orders,paid);
  assert.equal((await fetch(app.url+'/api/export?campaignId=c&kind=settlement')).status,200);
  assert.equal((await post('enroll',{revision:0,skuId:'cold2',member:'模拟甲',quantity:1})).status,400);
  assert.equal((await post('bundle-assign',input)).status,400);
  assert.equal((await post('undo',{id:result.data.undo.id})).status,200);
  const undone=(await post('planning-state')).data;assert.equal(undone.summary.ready,true);assert.deepEqual(undone.planning.source,c.orderPlanning.source);
  view=(await post('enrollment-view')).data;result=await post('bundle-assign',{...input,expectedVersion:view.bundleVersion});assert.equal(result.status,200);
  let state=await fetch(app.url+'/api/state').then(r=>r.json());assert.equal(bundleChildren(state.campaigns[0],'r1',0).length,1);assert.ok(withBundle.length>1000);
  const backups=await createWorkspaceBackups(dir),backup=await backups.create(state),preview=await backups.preview(state,backup.id);assert.equal(preview.backup.records,4);
  await app.shutdown();app=await launch();state=await fetch(app.url+'/api/state').then(r=>r.json());assert.equal(state.campaigns[0].bundleRules.b.count,2);assert.equal(bundleChildren(state.campaigns[0],'r1',0).length,1);
  const latest=await backups.preview(state,backup.id),restored=await backups.restore(state,{id:backup.id,hash:latest.hash,currentHash:latest.currentHash});assert.equal(restored.campaigns[0].bundleRules.b.count,2);assert.equal(bundleChildren(restored.campaigns[0],'r1',0).length,1);
 }finally{await app?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
