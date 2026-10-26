import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseComment,addComment,summary,defaultCategories} from './workflow.mjs';
import {applyAlbumComments} from './album-sync.mjs';
import {financialItems,settlementSummary} from './settlement.mjs';
import {tableData,workbook} from './tables.mjs';
import {processQQEvent} from './qq-commands.mjs';
import {start} from './server.mjs';
import {billLines} from './public/enrollment-people.js';
import {queryPersonalQueue} from './queue-query.mjs';

function fixture(){
 const c={id:'c',name:'模拟期次',groupId:'11111',botId:'zhougu',revision:0,categories:defaultCategories(),products:[
  {id:'a',name:'通行证-予愿安洁莉娜',character:'予愿安洁莉娜',type:'通行证',boxId:'55.0',price:10,unit:'对'},
  {id:'b',name:'通行证-克莱门莎',character:'克莱门莎',type:'通行证',boxId:'55.0',price:20,unit:'对'},
  {id:'s',name:'双闪徽章-酒神（真我自扼）',type:'单领',price:5,unit:'件'}],records:[]};
 const db={campaigns:[c],qqGroups:[{id:'11111',name:'模拟群'}],members:{12345:{cn:'示例用户I'},54321:{cn:'示例用户K'}}};
 return {c,db};
}
const event=(id,text,qq='12345')=>({id,qq,at:`2026-10-24T00:00:0${id}Z`,text,albumId:'album',photoIds:['photo'],order:Number(id)});
test('manual enrollment permits CN only or unbound QQ without creating a binding, and separates external names from QQ identities',async()=>{
 const {c,db}=fixture(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-manual-cn-'));db.settings={provider:'custom',baseUrl:'https://example.test/v1',model:''};await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(db));let app=await start({port:0,dataDir:dir});
 const post=async(route,body)=>{const response=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',...body})});return {status:response.status,data:await response.json()};};
 const enroll=(requestId,member,qq='',quantity=1)=>post('enroll-batch',{revision:0,requestId,member,qq,source:'洁哥通行证'+quantity,items:[{skuId:'a',quantity}]});
 try{
  assert.equal((await enroll('external','示例用户I','',15)).status,200);assert.equal((await enroll('external','示例用户I','',15)).data.duplicate,true);
  assert.equal((await enroll('with-qq','群外来宾',' 77777 ')).status,200);assert.equal((await enroll('known-qq','','12345')).status,200);
  assert.equal((await enroll('missing-cn','','88888')).status,400);assert.equal((await enroll('invalid-qq','来宾','abc')).status,400);
  const saved=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8')),campaign=saved.campaigns[0];assert.equal(campaign.records.length,3);assert.equal(campaign.records[0].qq,undefined);assert.equal(campaign.records[0].identityMode,'cn');assert.equal(campaign.records[1].qq,'77777');assert.equal(campaign.records[2].member,'示例用户I');assert.deepEqual(saved.members,db.members);assert.equal(saved.groupMembers,undefined);
  assert.match(queryPersonalQueue([campaign],'12345','示例用户I').reply,/：1对/);assert.doesNotMatch(queryPersonalQueue([campaign],'12345','示例用户I').reply,/15对|16对/);
  const bills=tableData(campaign,saved).find(s=>s.name==='肾表').rows.filter(r=>r[0]==='示例用户I');assert.equal(bills.length,2);assert.deepEqual(bills.map(r=>r[2]),[150,10]);assert.equal(bills[0][1],'通行证-予愿安洁莉娜 ×15对');
  await new Promise(r=>app.server.close(r));app=await start({port:0,dataDir:dir});const restored=(await (await fetch(app.url+'/api/state')).json()).campaigns[0];assert.equal(restored.records[0].identityMode,'cn');assert.equal(restored.records[0].qq,undefined);
  assert.equal((await post('cn',{groupId:'11111',qq:'77777',cn:'群外来宾'})).status,200);const bound=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(bound.groupMembers['11111']['77777'].cn,'群外来宾');
 }finally{await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true});}
});
function populated(){const f=fixture();for(const e of [event('1','代群外小明 洁哥通行证2 酒神皮肤吧唧1'),event('2','洁哥通行证1','54321'),event('3','代群外小红 洁哥通行证1'),event('4','洁哥通行证1 酒神皮肤吧唧1'),event('5','代群外小明 洁哥通行证1')])addComment(f.db,f.c,e);return f;}

test('proxy prefix preserves recipient names including digits and parses aliases and quantities independently',()=>{
 const {c}=fixture();
 const parsed=parseComment('示例用户I 代群外小明2 洁哥通行证2 酒神皮肤吧唧1',c.products,'示例用户I');
 assert.equal(parsed.status,'resolved');assert.equal(parsed.proxyFor,'小明2');assert.deepEqual(parsed.items,[{skuId:'a',quantity:2},{skuId:'s',quantity:1}]);
 for(const text of ['代群外小明洁哥通行证1','代群外 小明','代群外小明 洁哥通行证1 代群外小红 洁哥通行证1','代群外'+'长'.repeat(41)+' 洁哥通行证1']){
  const result=parseComment(text,c.products);assert.equal(result.status,'ambiguous');assert.equal(result.items.length,0);assert.match(result.questions[0].message,/代排格式/);
 }
 assert.deepEqual(parseComment('代群外小明 洁哥通行证',c.products).items,[{skuId:'a',quantity:1}]);
});

test('album proxy enrollment keeps sender QQ, scopes products, remains pending on errors and deduplicates retries',()=>{
 const {c,db}=fixture(),binding={campaignId:'c',batchScopes:{batch:{categoryId:'通行证',source:'人工确认'}}};
 const photos=[{id:'photo',batchId:'batch'}],comments=[event('1','代群外小明 洁哥通行证2'),event('2','代群外小红 酒神皮肤吧唧1'),event('3','代群外小张 洁哥通行证1','77777')];
 assert.equal(applyAlbumComments(db,binding,{photos,comments}).imported,1);
 assert.equal(c.records[0].member,'示例用户I 代 小明');assert.equal(c.records[0].qq,'12345');assert.equal(c.records[0].proxyFor,'小明');assert.equal(c.records[0].quantity,2);
 assert.equal(binding.pending.length,2);assert.match(binding.pending.find(e=>e.id==='2').reason,/图片范围/);assert.match(binding.pending.find(e=>e.id==='3').reason,/CN/);
 assert.equal(applyAlbumComments(db,binding,{photos,comments}).imported,0);assert.equal(c.records.length,1);assert.equal(db.members['小明'],undefined);
});

test('proxy recipients have distinct bills adjacent to their agent, without changing chronological product queues',()=>{
 const {c,db}=populated();
 assert.deepEqual(summary(c).find(p=>p.id==='a').queue,['示例用户I 代 小明','示例用户I 代 小明','示例用户K','示例用户I 代 小红','示例用户I','示例用户I 代 小明']);
 const items=financialItems(c,db);assert.equal(new Set(items.filter(i=>i.ownerKey==='12345').map(i=>i.personKey)).size,3);
 const sheets=tableData(c,db),kidney=sheets.find(s=>s.name==='肾表');
 assert.deepEqual(kidney.rows.map((r,i)=>[i+1,r[0],r[2]]).filter(([,cn])=>cn),[[1,'cn','总价'],[2,'示例用户I',15],[4,'示例用户I 代 小明',35],[6,'示例用户I 代 小红',10],[7,'示例用户K',10]]);
 assert.deepEqual(kidney.merges,['A2:A3','C2:C3','A4:A5','C4:C5']);assert.deepEqual(Object.keys(kidney.formulas),['C2','C4','C6','C7']);assert.equal(kidney.rows[3][1],'通行证-予愿安洁莉娜 ×3对');
 for(const cat of ['通行证','单领']){
  const sheet=sheets.find(s=>s.name===cat),offset=sheet.detailStart;
  const labels=sheet.rows.slice(1).map(r=>r[offset]).filter(Boolean);
  assert.deepEqual(labels,cat==='通行证'?['示例用户I','示例用户I 代 小明','示例用户I 代 小红','示例用户K']:['示例用户I','示例用户I 代 小明']);
 }
 assert.equal(workbook(c,db).readUInt32LE(0),0x04034b50);
});
test('large bill quantities compact without losing queue slots, money or separate proxy bills',()=>{
 const {c,db}=fixture();addComment(db,c,event('1','洁哥通行证15 酒神皮肤吧唧3'));addComment(db,c,event('2','代群外小明 洁哥通行证15'));
 const before=JSON.stringify(c.records),kidney=tableData(c,db).find(s=>s.name==='肾表');
 assert.deepEqual(kidney.rows,[['cn','制品','总价'],['示例用户I','通行证-予愿安洁莉娜 ×15对',165],['','双闪徽章-酒神（真我自扼） ×3件',''],['示例用户I 代 小明','通行证-予愿安洁莉娜 ×15对',150]]);
 assert.deepEqual(kidney.merges,['A2:A3','C2:C3']);assert.equal(summary(c).find(p=>p.id==='a').demand,30);assert.equal(JSON.stringify(c.records),before);
 const units=financialItems(c,db).filter(i=>i.cn==='示例用户I'&&i.skuId==='a');units[1].finalCents=1200;assert.deepEqual(billLines(units).map(l=>[l.quantity,l.finalCents]),[[14,1000],[1,1200]]);
});

test('final shopping-credit settlement keeps proxy totals independent, including an agent with only proxy orders',()=>{
 const {c,db}=populated();
 c.orderPlanning={plan:{totalCents:7000,orders:[{number:1,actualPaid:70}],giftCounts:[0,0],pool:[{kind:'group',categoryId:'通行证',boxId:'55.0',price:30}]}};
 c.settlement={creditType:'600-620',giftRevenue:0,groupPricing:{}};
 const result=settlementSummary(c,db);assert.equal(result.ready,true);
 assert.deepEqual(result.people.map(p=>p.cn),['示例用户I','示例用户I 代 小明','示例用户I 代 小红','示例用户K']);
 assert.equal(result.people[0].totalCents,1484);assert.equal(result.people[1].totalCents,3484);assert.equal(result.receivableCents,6968);
 const sheets=tableData(c,db,{kind:'settlement'}),kidney=sheets.find(s=>s.name==='肾表');assert.equal(kidney.rows[1][2],14.84);assert.equal(kidney.rows[3][2],34.84);
 c.records=c.records.filter(r=>r.proxyFor);assert.deepEqual(settlementSummary(c,{}).people.map(p=>p.cn),['示例用户I 代 小明','示例用户I 代 小红']);
});

test('same external name under different agents and an unpriced proxy never merge or contaminate other bills',()=>{
 const {c,db}=fixture();c.products.find(p=>p.id==='b').price=null;
 for(const e of [event('1','洁哥通行证1'),event('2','代群外小明 克莱门莎通行证1'),event('3','代群外小明 洁哥通行证2','54321')])addComment(db,c,e);
 const kidney=tableData(c,db).find(s=>s.name==='肾表');
 assert.deepEqual(kidney.rows.slice(1).filter(r=>r[0]).map(r=>[r[0],r[2]]),[['示例用户I',10],['示例用户I 代 小明','待定价'],['示例用户K 代 小明',20]]);
 assert.equal(new Set(financialItems(c,db).map(x=>x.personKey)).size,3);
});

test('enabled mentions support proxy orders, query includes recipient and CN changes preserve proxy names',()=>{
 const {c,db}=fixture();db.qqEnrollmentEnabled=true;
 const say=(text,id=1)=>({group_id:11111,user_id:12345,self_id:99999,message_id:id,time:100+id,message:[{type:'at',data:{qq:99999}},{type:'text',data:{text}}]});
 assert.match(processQQEvent(db,say('代群外小明 洁哥通行证2')).reply,/示例用户I 代 小明/);
 processQQEvent(db,say('代群外小明 洁哥通行证2'));assert.equal(c.records.length,1);
 assert.match(processQQEvent(db,say('我的排表',2)).reply,/代 小明：.*×2/);
 processQQEvent(db,say('cn 新CN',3));assert.equal(c.records[0].member,'新CN 代 小明');assert.equal(c.records[0].proxyFor,'小明');assert.equal(c.records[0].qq,'12345');
 db.qqEnrollmentEnabled=false;assert.match(processQQEvent(db,say('代群外小红 洁哥通行证1',4)).reply,/未开启/);assert.equal(c.records.length,1);
});

test('proxy metadata and independent bills survive local persistence and administrator CN edits',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-proxy-')),{c,db}=populated();let app;
 db.settings={provider:'custom',baseUrl:'https://example.test/v1',model:''};
 try{
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(db));app=await start({port:0,dataDir:dir});
  const post=async(route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  const source='代群外小张 洁哥通行证1',recognized=await post('recognize',{campaignId:c.id,mode:'enrollment',text:source,member:'示例用户I'});
  assert.equal(recognized.data.proxyFor,'小张');const manual={campaignId:c.id,revision:c.revision,requestId:'manual-proxy',items:recognized.data.items,proxyFor:recognized.data.proxyFor,source,qq:'12345',member:'示例用户I'};
  await post('enroll-batch',manual);assert.equal((await post('enroll-batch',manual)).duplicate,true);
  await post('cn',{campaignId:c.id,qq:'12345',cn:'新示例用户I',groupId:'11111'});
  await new Promise(r=>app.server.close(r));app=await start({port:0,dataDir:dir});
  const saved=(await (await fetch(app.url+'/api/state')).json()).campaigns.find(x=>x.id===c.id);
  assert.equal(saved.records.find(r=>r.proxyFor==='小明').member,'新示例用户I 代 小明');assert.equal(saved.records.find(r=>r.qq==='54321').member,'示例用户K');
  assert.equal(saved.records.find(r=>r.proxyFor==='小张').member,'新示例用户I 代 小张');assert.equal(saved.records.filter(r=>r.requestId==='manual-proxy').length,1);
  const exported=await fetch(app.url+'/api/export?campaignId=c');assert.equal(exported.status,200);assert.equal(Buffer.from(await exported.arrayBuffer()).readUInt32LE(0),0x04034b50);
  assert.equal((await fetch(app.url+'/enrollment-people.js')).status,200);assert.ok((await fs.stat(path.join(dir,'tables','c.xlsx'))).size>0);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
