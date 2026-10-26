import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enrollmentView,reorderQueue} from './enrollment-view.mjs';
import {tableData,workbook} from './tables.mjs';
import {inflateRawSync} from 'node:zlib';
export function viewFixture(){
 const c={id:'view',name:'排表展示测试',botId:'zhougu',groupId:'11111',revision:0,categories:[{id:'pass',name:'通行证',kind:'group',setsByBox:{'55.0':3,'56.0':1}},{id:'solo',name:'单领',kind:'single'},{id:'gift',name:'特典',kind:'single'},{id:'custom',name:'自建简历',kind:'group',setsByBox:{'1.0':2}},{id:'empty',name:'自建空类',kind:'single'}],products:[
  {id:'a',categoryId:'pass',type:'通行证',boxId:'55.0',character:'予愿安洁莉娜',name:'通行证-予愿安洁莉娜',averagePrice:20,adjustment:10,price:30},
  {id:'b',categoryId:'pass',type:'通行证',boxId:'55.0',character:'克莱门莎',name:'通行证-克莱门莎',averagePrice:null,adjustment:0,price:null},
  {id:'c',categoryId:'pass',type:'通行证',boxId:'56.0',character:'予愿安洁莉娜',name:'通行证-予愿安洁莉娜',price:20},
  {id:'solo',categoryId:'solo',type:'单领',name:'角色亚克力立牌-克莱门莎',price:50},
  {id:'tier1',categoryId:'gift',type:'特典',name:'特典明信片',giftTier:1,price:5},
  {id:'tier2',categoryId:'gift',type:'特典',name:'特典CG明信片组',giftTier:2,price:8},
  {id:'set',categoryId:'gift',type:'特典',name:'特典SET',giftTier:'set',giftComponents:['tier1','tier2'],price:10},
  {id:'custom',categoryId:'custom',type:'单领',name:'人事部简历-阿米娅',boxId:'1.0',price:8}
 ],records:[]};
 const add=(id,skuId,qq,member,quantity,time,extra={})=>c.records.push({id,skuId,qq,member,quantity,sourceAt:`2026-10-24T0${time}:00:00Z`,createdAt:`2026-10-24T0${time}:00:00Z`,...extra});
 add('later','a','54321','示例用户K',1,2);add('first','a','12345','旧CN',2,1);add('unknown','b','12345','示例用户I',1,3);
 add('solo','solo','12345','示例用户I',2,4);add('gift1','tier1','12345','示例用户I',1,1);add('gift-set','set','54321','示例用户K',2,2);add('gift2','tier2','12345','示例用户I',1,3);
 add('proxy','solo','12345','示例用户I 代 小明',1,5,{proxyFor:'小明'});add('custom','custom','54321','示例用户K',1,1);
 return c;
}
const db={groupMembers:{'11111':{'12345':{cn:'示例用户I'},'54321':{cn:'示例用户K'}}}};
test('XLSX freezes only header rows and never splits merged CN or total cells',()=>{
 const c=viewFixture(),data=tableData(c,db,{kind:'enrollment'}),bytes=workbook(c,db,{kind:'enrollment'}),files=new Map();
 let offset=0;while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+nameLength+extra,name=bytes.subarray(offset+30,offset+30+nameLength).toString();files.set(name,inflateRawSync(bytes.subarray(start,start+size)).toString());offset=start+size;}
 for(let i=0;i<data.length;i++){
  const sheet=data[i],xml=files.get(`xl/worksheets/sheet${i+1}.xml`),frozen=Number(xml.match(/ySplit="(\d+)"/)?.[1]||0);
  for(const ref of sheet.merges){const [first,last]=ref.split(':').map(c=>Number(c.match(/\d+$/)[0]));assert.ok(!(first<=frozen&&last>frozen),sheet.name+' '+ref+' crosses freeze');}
  if(['通行证','单领','特典'].includes(sheet.name))assert.equal(frozen,1,sheet.name+' must not split its first recipient');
  if(sheet.name==='单领'){assert.equal(frozen,1);assert.match(xml,/topLeftCell="A2"/);assert.match(xml,/<mergeCell ref="A2:A3"/);assert.match(xml,/<c r="A2"[^>]*>.*?示例用户I<\/t>/);}
 }
 const safeIndex=data.findIndex(s=>s.name==='自建简历');assert.match(files.get(`xl/worksheets/sheet${safeIndex+1}.xml`),/ySplit="2" topLeftCell="A3"/);
});
test('category views preserve comment order, repeat each quantity, and isolate custom groups and boxes',()=>{
 const c=viewFixture(),view=enrollmentView(c,db);assert.deepEqual(view.categories.map(c=>c.name),['通行证','单领','特典','自建简历','自建空类']);
 const pass=view.categories[0];assert.equal(pass.queues.length,2);assert.deepEqual(pass.queues[0].columns[0].queue.map(v=>v.cn),['示例用户I','示例用户I','示例用户K']);assert.equal(pass.queues[1].columns[0].demand,0);assert.equal(pass.queues[0].columns[0].remaining,0);assert.equal(pass.queues[0].columns[1].remaining,2);
 const exported=tableData(c,db,{kind:'enrollment'}).find(s=>s.name==='通行证'),names=exported.rows.slice(1).map(r=>r[exported.detailStart+1]).filter(Boolean);assert.ok(names.includes('通行证-予愿安洁莉娜'));assert.ok(names.every(name=>!name.includes('[55.0]')&&!name.includes('[56.0]')));
 assert.equal(pass.people.find(p=>p.cn==='示例用户I').totalCents,null);assert.equal(view.categories[3].queues[0].columns[0].demand,1);assert.equal(view.categories[3].kind,'group');assert.equal(view.categories[4].productCount,0);
});
test('single views expand units, merge recipients independently and preserve original and unknown prices',()=>{
 const c=viewFixture(),single=enrollmentView(c,db).categories[1];assert.equal(single.queues.length,0);assert.deepEqual(single.people.map(p=>[p.cn,p.items.length,p.totalCents]),[['示例用户I',2,10000],['示例用户I 代 小明',1,5000]]);assert.equal(single.people[0].items[0].originalCents,5000);
 c.products.find(p=>p.id==='solo').price=null;assert.ok(enrollmentView(c,db).categories[1].people.every(p=>p.totalCents===null));
});
test('SET expands into one position per component and unit, in chronological order, but is billed once',()=>{
 const c=viewFixture(),view=enrollmentView(c,db),gift=view.categories[2];assert.equal(gift.queues[0].columns.length,2);assert.deepEqual(gift.queues[0].columns.map(c=>c.demand),[3,3]);assert.deepEqual(gift.queues[0].columns[0].queue.map(v=>[v.cn,v.fromSet]),[['示例用户I',false],['示例用户K',true],['示例用户K',true]]);assert.deepEqual(gift.queues[0].columns[1].queue.map(v=>v.cn),['示例用户K','示例用户K','示例用户I']);
 const person=gift.people.find(p=>p.cn==='示例用户K');assert.equal(person.items.length,2);assert.equal(person.totalCents,2000);assert.ok(person.items.every(i=>i.name==='特典SET'));
 const sheet=tableData(c,db,{kind:'enrollment'}).find(s=>s.name==='特典');assert.equal(sheet.detailStart,3);assert.equal(sheet.rows[2][0],'示例用户I');assert.equal(sheet.rows[2][1],'示例用户K');
 c.products.find(p=>p.id==='set').giftComponents=['gone'];assert.ok(enrollmentView(c,db).categories[2].queues[0].columns.some(col=>col.label.includes('组成待核对')&&col.demand===2));
});
test('SET supports all five explicit tiers and gift supply without confusing demand with charged units',()=>{
 const c=viewFixture();for(let i=3;i<=5;i++)c.products.push({id:'tier'+i,categoryId:'gift',type:'特典',name:'第'+i+'档特典',giftTier:i,price:i});c.products.find(p=>p.id==='set').giftComponents=['tier1','tier2','tier3','tier4','tier5'];c.orderPlanning={plan:{giftCounts:[4,3,2,1,0]}};
 const gift=enrollmentView(c,db).categories[2];assert.deepEqual(gift.queues[0].columns.map(c=>c.demand),[3,3,2,2,2]);assert.equal(gift.queues[0].columns[4].overflow,2);assert.equal(gift.people.find(p=>p.cn==='示例用户K').totalCents,2000);
});
test('enrollment view endpoint is read-only, rejects unknown campaigns and does not call models',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{start}=await import('./server.mjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-enrollment-view-'));let app;
 try{
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({...db,campaigns:[viewFixture()],settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:''}}));
  app=await start({port:0,dataDir:dir,credentialStore:{get:async()=>''},upstreamFetch:async()=>{throw Error('view must not call model');}});const before=await fs.readFile(path.join(dir,'workspace.json'),'utf8');
  const post=id=>fetch(app.url+'/api/enrollment-view',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({campaignId:id})});
  const result=await post('view');assert.equal(result.status,200);assert.equal((await result.json()).categories.length,5);assert.equal((await post('missing')).status,400);assert.equal(await fs.readFile(path.join(dir,'workspace.json'),'utf8'),before);
  for(const [file,mime]of [['enrollment-table.js','text/javascript'],['enrollment-table.css','text/css']]){const r=await fetch(app.url+'/'+file);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').startsWith(mime));}
  assert.equal((await fetch(app.url+'/enrollment-view.mjs')).status,404);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

function moveColumn(c,db,categoryId,columnId,index,direction='up',blockId){
 const category=enrollmentView(c,db).categories.find(cat=>cat.id===categoryId),block=category.queues.find(b=>!blockId||b.id===blockId),column=block.columns.find(col=>col.id===columnId);
 return reorderQueue(c,db,{categoryId,blockId:block.id,columnId,entryKey:column.queue[index]?.entryKey,direction,expectedVersion:column.orderVersion});
}
test('manual queue moves persist per category, box and product without changing records, quantities or financial data',()=>{
 const c=viewFixture(),original=structuredClone(c),before=enrollmentView(c,db);moveColumn(c,db,'pass','a',2);
 const after=enrollmentView(c,db);assert.deepEqual(after.categories[0].queues[0].columns[0].queue.map(e=>e.cn),['示例用户I','示例用户K','示例用户I']);
 assert.deepEqual(after.categories.slice(1),before.categories.slice(1));assert.deepEqual(after.categories[0].queues[1],before.categories[0].queues[1]);assert.deepEqual(after.categories[0].queues[0].columns[1],before.categories[0].queues[0].columns[1]);
 assert.deepEqual(after.categories.map(c=>c.people),before.categories.map(c=>c.people));assert.deepEqual(c.records,original.records);assert.deepEqual(c.products,original.products);assert.deepEqual(c.categories,original.categories);
 assert.deepEqual(enrollmentView(JSON.parse(JSON.stringify(c)),db),after);
 const sheet=tableData(c,db,{kind:'enrollment'}).find(s=>s.name==='通行证');assert.deepEqual(sheet.rows.slice(2,5).map(r=>r[0]),['示例用户I','示例用户K','示例用户I']);
 moveColumn(c,db,'pass','a',0,'reset');assert.deepEqual(enrollmentView(c,db).categories,before.categories);assert.deepEqual(c.records,original.records);
});
test('gift SET positions can move in one column without moving another tier, splitting charges or touching other categories',()=>{
 const c=viewFixture(),before=enrollmentView(c,db),gift=before.categories[2];moveColumn(c,db,'gift','tier1',1);
 const after=enrollmentView(c,db);assert.deepEqual(after.categories[2].queues[0].columns[0].queue.map(e=>[e.cn,e.fromSet]),[['示例用户K',true],['示例用户I',false],['示例用户K',true]]);
 assert.deepEqual(after.categories[2].queues[0].columns[1],gift.queues[0].columns[1]);assert.deepEqual(after.categories.filter(cat=>cat.id!=='gift'),before.categories.filter(cat=>cat.id!=='gift'));
 assert.deepEqual(after.categories[2].people,gift.people);const sheet=tableData(c,db,{kind:'enrollment'}).find(s=>s.name==='特典');assert.deepEqual(sheet.rows.slice(2,5).map(r=>r[0]),['示例用户K','示例用户I','示例用户K']);
});
test('queue changes reject stale requests, wrong scopes, missing entries, invalid directions and boundary moves without mutation',()=>{
 const c=viewFixture(),view=enrollmentView(c,db),col=view.categories[0].queues[0].columns[0],base={categoryId:'pass',blockId:'55.0',columnId:'a',entryKey:col.queue[0].entryKey,direction:'up',expectedVersion:col.orderVersion};
 const before=JSON.stringify(c);for(const patch of [{},{expectedVersion:'old'},{categoryId:'solo'},{columnId:'custom'},{blockId:'56.0'},{entryKey:'missing'},{direction:'sideways'}]){assert.throws(()=>reorderQueue(c,db,{...base,...patch}));assert.equal(JSON.stringify(c),before);}
 const move={...base,entryKey:col.queue[2].entryKey};reorderQueue(c,db,move);const changed=JSON.stringify(c);assert.throws(()=>reorderQueue(c,db,move),/已变化/);assert.equal(JSON.stringify(c),changed);
});
test('new and late records preserve manual relative positions, and deleted records do not leave empty ghost queue slots',()=>{
 const c=viewFixture();moveColumn(c,db,'pass','a',2);
 c.records.push({id:'late',skuId:'a',qq:'99999',member:'新来',quantity:1,sourceAt:'2026-10-24T01:30:00Z'},{id:'new',skuId:'a',qq:'88888',member:'后来',quantity:1,sourceAt:'2026-10-24T04:00:00Z'});
 const queue=()=>enrollmentView(c,db).categories[0].queues[0].columns[0].queue;
 assert.deepEqual(queue().map(e=>e.cn),['示例用户I','新来','示例用户K','示例用户I','后来']);
 c.records=c.records.filter(r=>r.id!=='later');assert.deepEqual(queue().map(e=>e.cn),['示例用户I','示例用户I','新来','后来']);assert.equal(new Set(queue().map(e=>e.entryKey)).size,4);
});
test('queue API saves only the selected column, refreshes XLSX and restores the order after backend restart',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{start}=await import('./server.mjs'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-queue-order-'));let app;
 const startApp=()=>start({port:0,dataDir:dir,credentialStore:{get:async()=>''},upstreamFetch:async()=>{throw Error('Queue editing never calls models');}});
 try{
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({...db,campaigns:[viewFixture()],settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:''}}));app=await startApp();
  const post=async(route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const before=(await post('enrollment-view',{campaignId:'view'})).data,col=before.categories[0].queues[0].columns[0];
  const request={campaignId:'view',categoryId:'pass',blockId:'55.0',columnId:'a',entryKey:col.queue[2].entryKey,direction:'up',expectedVersion:col.orderVersion};
  assert.equal((await post('queue-reorder',{...request,campaignId:'missing'})).status,400);
  const response=await post('queue-reorder',request);assert.equal(response.status,200);assert.equal(response.data.changed,true);assert.deepEqual(response.data.view.categories.slice(1),before.categories.slice(1));
  assert.equal((await post('queue-reorder',request)).status,400);const disk=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(disk.campaigns[0].queueOrder.revision,1);assert.equal(disk.campaigns[0].records.length,viewFixture().records.length);
  const bytes=await fs.readFile(path.join(dir,'tables','view.xlsx'));assert.equal(bytes.readUInt32LE(0),0x04034b50);
  await new Promise(r=>app.server.close(r));app=await startApp();const after=(await post('enrollment-view',{campaignId:'view'})).data;assert.deepEqual(after.categories[0].queues[0].columns[0].queue.map(e=>e.cn),['示例用户I','示例用户K','示例用户I']);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
