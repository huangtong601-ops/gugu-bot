import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from './server.mjs';
import {purchasePool,planOrders} from './order-planning.mjs';
import {settlementSummary} from './settlement.mjs';
import {purchaseSource,sourceHash,completeCampaign,openSupplement,mergeOrderPlan,supplementaryPool,validatePurchasedCatalog} from './campaign-lifecycle.mjs';
import {applyAlbumComments,dismissPending,retryPending} from './album-sync.mjs';
import {addComment} from './workflow.mjs';
import {processQQEvent} from './qq-commands.mjs';
import {businessState,businessDiff,createOperationHistory} from './operation-history.mjs';
import {createWorkspaceBackups,backupFingerprint} from './workspace-backups.mjs';
const settings={tiers:[10,20],rule:'once',rewardMode:'both'};
function fixture(){const c={id:'c',name:'模拟期次',botId:'zhougu',groupId:'11111',revision:0,categories:[{id:'single',name:'单领',kind:'single'}],products:[{id:'p',name:'测试徽章',type:'单领',categoryId:'single',price:10,unit:'件'}],records:[{id:'r',skuId:'p',member:'模拟甲',qq:'123456',quantity:1,createdAt:'2026-01-01T00:00:00Z'}],settlement:{creditType:'600-620',giftRevenue:0,groupPricing:{}}};const pool=purchasePool(c),plan=planOrders(pool,settings);plan.orders.forEach(o=>o.actualPaid=10);c.orderPlanning={version:1,pool,plan,source:purchaseSource(c)};return {campaigns:[c],members:{'123456':{cn:'模拟甲'}},groupMembers:{},qqGroups:[{id:'11111',name:'模拟群'}],albums:[],settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''}};}
const finish=c=>completeCampaign(c,{version:c.orderLifecycle?.version||0,expectedSource:sourceHash(c)});
async function service(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-maintenance-')),db=fixture();await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(db));const app=await start({port:0,dataDir:dir,credentialStore:{get:async()=>'',set:async()=>{}},allowServerConnection:false});const client=randomUUID();const post=async(route,body={})=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',undoClient:client,...body})});return {status:r.status,data:await r.json()};};try{await fn({dir,app,post,client,state:async()=>fetch(app.url+'/api/state').then(r=>r.json())});}finally{await app.shutdown();await fs.rm(dir,{recursive:true,force:true});}}

test('completion requires every saved payment, a current source and a verified legacy plan',()=>{
 const {campaigns:[c]}=fixture();c.orderPlanning.plan.orders[0].actualPaid=null;assert.throws(()=>finish(c),/全部订单/);c.orderPlanning.plan.orders[0].actualPaid=0;assert.equal(finish(c).lifecycle.status,'completed');assert.equal(c.orderLifecycle.purchasedOrderIds.length,1);
 const d=fixture().campaigns[0];delete d.orderPlanning.source;assert.throws(()=>finish(d),/历史方案/);const e=fixture().campaigns[0];assert.throws(()=>completeCampaign(e,{version:0,expectedSource:'old'}),/排量或商品/);e.records[0].quantity=2;assert.throws(()=>finish(e),/排量/);
});
test('stale demand and price changes stop settlement instead of silently using an outdated plan',()=>{
 const {campaigns:[c]}=fixture();assert.equal(settlementSummary(c).ready,true);c.products[0].price=20;assert.equal(settlementSummary(c).ready,false);assert.match(settlementSummary(c).missing.join(),/已变化/);assert.equal(settlementSummary(c).items[0].originalCents,1000);
 c.products[0].price=10;c.records[0].quantity=2;assert.equal(settlementSummary(c).ready,false);
});
test('supplemental orders preserve paid orders, use only extra demand and can be completed repeatedly',()=>{
 const {campaigns:[c]}=fixture();finish(c);const old=structuredClone(c.orderPlanning.plan.orders);openSupplement(c,{version:1});assert.equal(supplementaryPool(c)[0].quantity,0);finish(c);assert.equal(c.orderLifecycle.status,'completed');openSupplement(c,{version:3});c.records.push({...c.records[0],id:'r2'});c.products[0].price=20;
 const pool=supplementaryPool(c);assert.equal(pool[0].quantity,1);const extra=planOrders(pool,settings);mergeOrderPlan(c,extra);assert.deepEqual(c.orderPlanning.plan.orders[0],old[0]);assert.notEqual(c.orderPlanning.plan.orders[0].id,c.orderPlanning.plan.orders[1].id);assert.equal(c.orderPlanning.plan.totalCents,3000);assert.equal(c.orderPlanning.plan.giftCounts[0],2);assert.throws(()=>finish(c),/全部订单/);c.orderPlanning.plan.orders[1].actualPaid=20;finish(c);assert.equal(settlementSummary(c).originalCents,3000);assert.equal(settlementSummary(c).receivableCents,2904);openSupplement(c,{version:5});assert.equal(c.orderLifecycle.purchasedOrderIds.length,2);
});
test('closed albums import new comments once while keeping purchases locked and excess demand visible',()=>{
 const db=fixture(),c=db.campaigns[0];finish(c);const binding={groupId:'11111',albumId:'album',campaignId:'c',photoScopes:{photo:{categoryId:'single'}},pending:[]};db.albums=[binding];const event={id:'e',commentId:'e',groupId:'11111',albumId:'album',qq:'123456',text:'测试徽章2',at:new Date(Date.now()+1000).toISOString(),photoIds:['photo']},result={photos:[{id:'photo'}],comments:[event]};
 const orders=structuredClone(c.orderPlanning.plan.orders);
 assert.throws(()=>addComment(db,c,{...event,id:'direct'}),/已经结束/);
 assert.equal(applyAlbumComments(db,binding,result).imported,1);
 assert.equal(applyAlbumComments(db,binding,result).duplicates,1);
 assert.equal(c.records.length,2);assert.equal(c.records[1].quantity,2);
 assert.equal(c.orderLifecycle.status,'completed');assert.deepEqual(c.orderPlanning.plan.orders,orders);
 assert.match(settlementSummary(c).missing.join('；'),/超过已规划购买数量/);
 assert.equal(binding.closedNotices,undefined);
});
test('previously rejected comments can be reviewed or dismissed while @ enrollment remains closed',()=>{
 const db=fixture(),c=db.campaigns[0];finish(c);db.qqEnrollmentEnabled=true;const event={post_type:'message',self_id:99999,group_id:11111,user_id:123456,message_id:1,time:Date.now()/1000,message:[{type:'at',data:{qq:'99999'}},{type:'text',data:{text:'排谷 测试徽章1'}}]};assert.match(processQQEvent(db,event).reply,/已经结束/);assert.equal(c.records.length,1);event.message[1].data.text='查询排量 测试徽章';assert.match(processQQEvent(db,event).reply,/测试徽章/);
 const old={id:'11111/a/old/123456/1',commentId:'old',qq:'123456',groupId:'11111',albumId:'a',text:'测试徽章1',at:'2026-01-01T01:00:00Z',photoIds:['photo']};
 const ignored={...old,id:'11111/a/ignore/123456/1',commentId:'ignore'};
 c.commentEvents=[old,ignored].map(({id,qq,at,text})=>({id,qq,at,text,closed:true}));
 const binding={groupId:'11111',albumId:'a',campaignId:'c',photoScopes:{photo:{categoryId:'single'}},pending:[old,ignored]};
 dismissPending(db,binding,'ignore');
 assert.equal(retryPending(db,binding,'old').count,1);assert.equal(binding.pending.length,0);
 assert.equal(applyAlbumComments(db,binding,{photos:[{id:'photo'}],comments:[old,ignored]}).duplicates,2);
 assert.equal(c.records.length,2);
});
test('recovered comments use the original scope and time, and covered purchases remain settled',()=>{
 const db=fixture(),c=db.campaigns[0];
 const pool=purchasePool(c).map(row=>({...row,quantity:2})),plan=planOrders(pool,settings);
 for(const order of plan.orders)order.actualPaid=order.subtotal/100;
 c.orderPlanning={pool,plan,version:1,source:purchaseSource(c)};finish(c);
 const old={id:'11111/a/old/123456/1',qq:'123456',groupId:'11111',albumId:'a',at:'2026-10-25T12:00:00Z',text:'测试徽章1',photoIds:['photo']};
 const {id,qq,at,text}=old;c.commentEvents=[{id,qq,at,text,closed:true}];
 const binding={campaignId:'c',groupId:'11111',albumId:'a',photoScopes:{photo:{categoryId:'single'}}};
 const photos=[{id:'photo'}];
 assert.equal(applyAlbumComments(db,binding,{photos,comments:[{...old,albumId:'wrong'}]}).duplicates,1);
 const result=applyAlbumComments(db,binding,{photos,comments:[old,old]});
 assert.equal(result.duplicates,1);assert.equal(result.imported,1);assert.equal(c.records.length,2);
 assert.equal(Date.parse(c.records[1].sourceAt),Date.parse(old.at));assert.equal(c.commentEvents.length,1);assert.equal(c.commentEvents[0].closed,undefined);
 assert.deepEqual(c.orderPlanning.source,purchaseSource(c));assert.equal(settlementSummary(c).ready,true);
});
test('undo restores only changed business fields, keeps new unrelated data and rejects a conflicting comment',()=>{
 const db=fixture(),history=createOperationHistory(),before=businessState(db);db.campaigns[0].products[0].name='新名字';db.campaigns[0].revision++;const entry=history.record('client','保存商品',businessDiff(before,businessState(db)));db.groupMembers.other={};const revision=db.campaigns[0].revision;history.undo(db,'client',entry.id);history.accept('client',entry.id);assert.equal(db.campaigns[0].products[0].name,'测试徽章');assert.ok(db.campaigns[0].revision>revision);assert.deepEqual(db.groupMembers.other,{});
 const b=businessState(db);db.campaigns[0].records.push({...db.campaigns[0].records[0],id:'r2'});const e=history.record('client','手动排表',businessDiff(b,businessState(db)));db.campaigns[0].records.push({...db.campaigns[0].records[0],id:'qq-new'});assert.throws(()=>history.undo(db,'client',e.id),/新的修改或相册评论/);assert.equal(db.campaigns[0].records.length,3);
});
test('backup manifests exclude credentials, deduplicate images and validate before replacing business data',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-backups-'));try{const db=fixture();db.settings.apiKey='synthetic-private-api';db.qqSettings={token:'synthetic-private-token'};await fs.mkdir(path.join(dir,'media'));const image='aabbccdd.jpg';await fs.writeFile(path.join(dir,'media',image),'synthetic image bytes');db.campaigns[0].products[0].imageUrl='/media/'+image;let clock=1900000000000;const store=await createWorkspaceBackups(dir,{now:()=>clock++,retain:3});const one=await store.create(db,'手动备份'),two=await store.create(db,'手动备份');assert.equal((await fs.readdir(path.join(dir,'workspace-backups','media'))).length,1);const raw=await fs.readFile(path.join(dir,'workspace-backups',one.id+'.json'),'utf8');assert.ok(!raw.includes('synthetic-private'));assert.ok(!raw.includes('qqSettings'));
  const preview=await store.preview(db,one.id);db.campaigns[0].records[0].quantity=2;await assert.rejects(store.restore(db,preview),/工作区已变化/);const fresh=await store.preview(db,one.id),restored=await store.restore(db,fresh);assert.equal(restored.campaigns[0].records[0].quantity,1);assert.equal(db.settings.apiKey,'synthetic-private-api');assert.ok((await store.list()).some(x=>x.reason==='恢复前备份'));
  const envelope=JSON.parse(raw);envelope.data.campaigns[0].records[0].quantity=999;await fs.writeFile(path.join(dir,'workspace-backups',one.id+'.json'),JSON.stringify(envelope));await assert.rejects(store.preview(db,one.id),/校验失败/);assert.equal((await store.list()).find(x=>x.id===one.id).invalid,true);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('table generation errors are reported separately from successful durable saves and can retry',()=>service(async({dir,post,state})=>{
 const blocked=path.join(dir,'tables','c.xlsx.tmp');await fs.mkdir(path.dirname(blocked),{recursive:true});await fs.mkdir(blocked);const r=await post('enroll-batch',{revision:0,requestId:'manual-1',source:'测试徽章1',member:'模拟乙',qq:'',items:[{skuId:'p',quantity:1}]});assert.equal(r.status,200);assert.equal(r.data.maintenance.tables.pending,true);assert.ok(r.data.undo);assert.equal((await state()).campaigns[0].records.length,2);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8')).campaigns[0].records.length,2);
 await fs.rmdir(blocked);assert.equal((await post('tables-retry')).data.ok,true);assert.equal((await fs.stat(path.join(dir,'tables','c.xlsx'))).isFile(),true);const undone=await post('undo',{id:r.data.undo.id});assert.equal(undone.status,200);assert.equal((await state()).campaigns[0].records.length,1);
}));
test('failed workspace writes roll back the operation and do not create a misleading undo entry',()=>service(async({dir,post,state})=>{
 await fs.mkdir(path.join(dir,'workspace.json.tmp'));const r=await post('enroll-batch',{revision:0,requestId:'fail-1',source:'测试徽章1',member:'模拟乙',items:[{skuId:'p',quantity:1}]});assert.equal(r.status,400);assert.equal((await state()).campaigns[0].records.length,1);assert.equal((await post('undo-state')).data.entry,null);await fs.rmdir(path.join(dir,'workspace.json.tmp'));
}));
test('completion and supplements are enforced by all write APIs and preserve prior payments',()=>service(async({post,state})=>{
 const plan=(await post('planning-state')).data;const completed=await post('campaign-complete',{version:0,expectedSource:plan.sourceHash});assert.equal(completed.status,200);for(const route of ['enroll-batch','enroll','comment']){const result=await post(route,{revision:0,requestId:'blocked',member:'模拟乙',quantity:1,skuId:'p',items:[{skuId:'p',quantity:1}],id:'event',qq:'123456',at:new Date().toISOString()});assert.equal(result.status,400);assert.match(result.data.error,/已经结束|未绑定/);}
 let c=(await state()).campaigns[0];assert.equal((await post('order-payment',{version:c.orderPlanning.version,orderId:c.orderPlanning.plan.orders[0].id,actualPaid:1})).status,400);assert.equal((await post('campaign-supplement',{version:1})).status,200);c=(await state()).campaigns[0];assert.equal((await post('order-payment',{version:c.orderPlanning.version,orderId:c.orderPlanning.plan.orders[0].id,actualPaid:1})).status,400);assert.equal(c.orderPlanning.plan.orders[0].actualPaid,10);
}));
test('restore previews refuse stale data and restoration keeps account configuration while incrementing versions',()=>service(async({post,state,dir})=>{
 const before=await state(),backup=(await post('backup-create')).data.backup,preview=(await post('backup-preview',{id:backup.id})).data;const added=await post('enroll-batch',{revision:0,requestId:'after-backup',source:'测试徽章1',member:'模拟乙',items:[{skuId:'p',quantity:1}]});assert.equal(added.status,200);assert.equal((await post('backup-restore',preview)).status,400);const fresh=(await post('backup-preview',{id:backup.id})).data;assert.equal((await post('backup-restore',fresh)).status,200);const after=await state();assert.equal(after.campaigns[0].records.length,1);assert.ok(after.campaigns[0].revision>before.campaigns[0].revision);assert.deepEqual(after.settings,before.settings);assert.equal((await post('undo-state')).data.entry,null);assert.ok((await post('backups')).data.backups.some(b=>b.reason==='恢复前备份'));
}));

test('undo cannot remove a newly referenced SKU or close a supplement over newer comments',()=>{
 const db=fixture(),history=createOperationHistory(),before=businessState(db);db.campaigns[0].products.push({...db.campaigns[0].products[0],id:'p2'});const created=history.record('client','新增商品',businessDiff(before,businessState(db)));db.campaigns[0].records.push({...db.campaigns[0].records[0],id:'new',skuId:'p2'});assert.throws(()=>history.undo(db,'client',created.id),/新的排谷/);
 const d=fixture(),c=d.campaigns[0];finish(c);const closed=businessState(d);openSupplement(c,{version:1});const opened=history.record('other','开启补单',businessDiff(closed,businessState(d)));c.records.push({...c.records[0],id:'new-comment'});assert.throws(()=>history.undo(d,'other',opened.id),/新的修改或相册评论/);assert.equal(c.orderLifecycle.status,'supplement');
});
test('backup restoration never overwrites a different existing image and works when retention prunes the selected manifest',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-backup-media-'));try{const db=fixture();await fs.mkdir(path.join(dir,'media'));const file='aabbccdd.jpg';await fs.writeFile(path.join(dir,'media',file),'old picture');db.campaigns[0].products[0].imageUrl='/media/'+file;let clock=1900000000000;const store=await createWorkspaceBackups(dir,{now:()=>clock++,retain:1});const b=await store.create(db);await fs.writeFile(path.join(dir,'media',file),'new picture');const preview=await store.preview(db,b.id),restored=await store.restore(db,preview);assert.equal(await fs.readFile(path.join(dir,'media',file),'utf8'),'new picture');const restoredName=restored.campaigns[0].products[0].imageUrl.slice('/media/'.length);assert.notEqual(restoredName,file);assert.equal(await fs.readFile(path.join(dir,'media',restoredName),'utf8'),'old picture');assert.equal((await store.list()).length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('automatic backups are hourly and restore pauses album synchronization until explicitly resumed',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-backup-hourly-'));try{let clock=1900000000000;const store=await createWorkspaceBackups(dir,{now:()=>clock}),db=fixture();assert.ok(await store.automatic(db));assert.equal(await store.automatic(db),null);clock+=3600000;assert.ok(await store.automatic(db));assert.equal((await store.list()).length,2);}finally{await fs.rm(dir,{recursive:true,force:true});}
 await service(async({post,state})=>{const b=(await post('backup-create')).data.backup,p=(await post('backup-preview',{id:b.id})).data;assert.equal((await post('backup-restore',p)).status,200);assert.equal((await state()).albumSyncPaused,true);assert.equal((await post('qq-album-comments')).status,400);await post('album-sync-resume');assert.equal((await state()).albumSyncPaused,false);});
});
test('purchased box contents are frozen and supplemental automatic pair prices use exact original order costs',()=>{
 const db=fixture(),c=db.campaigns[0];c.categories=[{id:'g',name:'通行证',kind:'group',setsByBox:{box:1},boxPrices:{box:350}}];c.products=Array.from({length:7},(_,i)=>({id:'r'+i,name:'通行证-角色'+i,type:'通行证',categoryId:'g',boxId:'box',averagePrice:null,price:null,adjustment:0,unit:'对'}));c.records=[{id:'a',member:'模拟甲',skuId:'r0',quantity:1,createdAt:'2026-01-01T00:00:00Z'}];let pool=purchasePool(c);c.orderPlanning={version:1,pool,source:purchaseSource(c),plan:planOrders(pool,settings)};c.orderPlanning.plan.orders.forEach(o=>o.actualPaid=o.subtotal/100);c.settlement.groupPricing={'g|box':'auto'};finish(c);openSupplement(c,{version:1});c.categories[0].setsByBox.box=2;c.categories[0].boxPrices.box=420;c.records[0].quantity=2;pool=supplementaryPool(c);mergeOrderPlan(c,planOrders(pool,settings));c.orderPlanning.plan.orders.filter(o=>o.supplement).forEach(o=>o.actualPaid=o.subtotal/100);assert.equal(c.orderPlanning.plan.totalCents,77000);const result=settlementSummary(c);assert.equal(result.ready,true);assert.equal(result.items[0].originalCents,5500);assert.equal(result.items[0].averageCents,5323);assert.throws(()=>validatePurchasedCatalog(c,{...c,products:c.products.slice(1)}),/款式不能更换/);
});
