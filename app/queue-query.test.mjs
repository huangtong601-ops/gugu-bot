import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {queryQueue,parseQueueCommand} from './queue-query.mjs';import {summary} from './workflow.mjs';import {processQQEvent} from './qq-commands.mjs';import {start} from './server.mjs';
const campaign=()=>({id:'c',botId:'zhougu',name:'示例期次',categories:[{id:'通行证',name:'通行证',kind:'group',sets:0,setsByBox:{'55.0':5}},{id:'单领',name:'单领',kind:'single'},{id:'特典',name:'特典',kind:'single'},{id:'resume',name:'人事部简历',kind:'group',sets:4}],products:[
 {id:'a',name:'通行证-予愿安洁莉娜',type:'通行证',boxId:'55.0',unit:'对'},
 {id:'b',name:'通行证-克莱门莎',type:'通行证',boxId:'55.0',unit:'对'},
 {id:'c',name:'通行证-珊比',type:'通行证',boxId:'55.0',unit:'对'},
 {id:'other',name:'通行证-予愿安洁莉娜',type:'通行证',boxId:'56.0',unit:'对'},
 {id:'stand',name:'角色亚克力立牌-克莱门莎款',type:'单领',unit:'件'},
 {id:'gift',name:'特典明信片',type:'特典',unit:'张'},
 {id:'r',name:'简历-阿米娅',type:'单领',categoryId:'resume',boxId:'24.0',unit:'份'}
],records:[{id:'1',skuId:'a',quantity:3,member:'示例用户J',createdAt:'2026-10-23T01:00:00Z'},{id:'2',skuId:'b',quantity:2,member:'示例用户L',createdAt:'2026-10-23T02:00:00Z'},{id:'3',skuId:'stand',quantity:1,member:'示例用户J',createdAt:'2026-10-23T03:00:00Z'}]});
test('new and legacy query prefixes accept single targets and whole-box targets',()=>{for(const text of ['查询余量 洁哥通行证','查询 余量：洁哥通行证','余量洁哥通行证'])assert.deepEqual(parseQueueCommand(text),{kind:'余量',target:'洁哥通行证'});assert.equal(parseQueueCommand('查询排量 通行证55.0').target,'通行证55.0');assert.equal(parseQueueCommand('cn 示例用户J'),null);});
test('single-product query matches aliases, uses total quantities and refuses ambiguity',()=>{const c=campaign();assert.match(queryQueue(c,'排量','克莱门莎立牌').reply,/：1件/);assert.equal(queryQueue(c,'排量','洁哥通行证55.0').products[0].demand,3);assert.throws(()=>queryQueue(c,'排量','洁哥通行证'),/多个商品/);assert.throws(()=>queryQueue(c,'排量','克莱门莎'),/多个商品/);});
test('whole box returns all roles including zero, excludes other boxes, and totals quantities',()=>{const c=campaign();for(const target of ['通行证55.0','通行证 55.0','55.0通行证','通行证55盒']){const r=queryQueue(c,'排量',target);assert.deepEqual(r.products.map(p=>p.id),['a','b','c']);assert.equal(r.totalDemand,5);assert.match(r.reply,/珊比：0对/);assert.doesNotMatch(r.reply,/合计/);assert.doesNotMatch(r.reply,/排量/);}assert.throws(()=>queryQueue(c,'排量','通行证99.0'),/未匹配/);});
test('remaining requires a group category and configured capacity per box',()=>{const c=campaign();assert.throws(()=>queryQueue(c,'余量','克莱门莎立牌'),/仅支持拼团/);assert.throws(()=>queryQueue(c,'余量','特典'),/仅支持拼团/);assert.throws(()=>queryQueue(c,'余量','通行证56.0'),/尚未设置总配数/);assert.equal(summary(c).find(p=>p.id==='other').remaining,null);const r=queryQueue(c,'余量','通行证55.0');assert.deepEqual(r.products.map(p=>p.remaining),[2,3,5]);assert.match(r.reply,/已排 3 \/ 总配数 5/);assert.match(queryQueue(c,'余量','通行证').reply,/未设置总配数/);});
test('custom group categories follow group capacity even when legacy product type is single',()=>{const c=campaign();assert.equal(queryQueue(c,'余量','人事部简历24.0').products[0].remaining,4);assert.equal(queryQueue(c,'排量','人事部简历').products.length,1);c.categories[0].setsByBox['55.0']=0;const r=queryQueue(c,'余量','通行证55.0');assert.equal(r.products[0].remaining,0);assert.equal(r.products[0].overflow,3);assert.match(r.reply,/超排 3对/);});
test('QQ queries select only bound campaigns, need no CN, and leave business data unchanged',()=>{const c=campaign(),db={campaigns:[c],albums:[{groupId:'11111',campaignId:'c'}]},before=JSON.stringify(db);const e={group_id:11111,self_id:99999,user_id:12345,message:[{type:'at',data:{qq:99999}},{type:'text',data:{text:'查询排量 克莱门莎立牌'}}]};const r=processQQEvent(db,e);assert.equal(r.readOnly,true);assert.match(r.reply,/：1件/);assert.equal(JSON.stringify(db),before);db.campaigns.push({...campaign(),id:'d',name:'另一团'});db.albums.push({groupId:'11111',campaignId:'d'});assert.throws(()=>processQQEvent(db,e),/注明期次/);e.message[1].data.text='查询排量 示例期次 通行证55.0';assert.match(processQQEvent(db,e).reply,/珊比：0对/);assert.doesNotMatch(processQQEvent(db,e).reply,/合计/);});
test('QQ query resolves the only matching campaign despite empty or unrelated campaigns in the group',()=>{
 const c={...campaign(),groupId:'11111'},empty={...campaign(),id:'empty',name:'空期次',groupId:'11111',products:[],records:[]};
 const unrelated={...campaign(),id:'single',name:'单领期次',groupId:'11111',products:[{id:'badge',name:'徽章-阿米娅',type:'单领',unit:'件'}],records:[]};
 const foreign={...campaign(),id:'foreign',name:'外群期次',groupId:'22222'};
 const db={campaigns:[empty,unrelated,foreign,c],albums:[{groupId:'11111',campaignId:'c'}]},before=JSON.stringify(db);
 const say=t=>({group_id:11111,self_id:99999,user_id:12345,message:[{type:'at',data:{qq:99999}},{type:'text',data:{text:t}}]});
 for(const target of ['通行证','通行证55.0','克莱门莎立牌']){const result=processQQEvent(db,say('查询排量 '+target));assert.equal(result.readOnly,true);assert.match(result.reply,/^示例期次｜/);}
 assert.match(processQQEvent(db,say('查询余量 通行证55.0')).reply,/余量 2对/);
 assert.throws(()=>processQQEvent(db,say('查询余量 通行证56.0')),/尚未设置总配数/);
 assert.throws(()=>processQQEvent(db,say('查询排量 洁哥通行证')),/匹配到多个商品/);
 assert.throws(()=>processQQEvent(db,say('查询排量 未知挂件')),/未匹配到商品/);
 assert.throws(()=>processQQEvent(db,say('外群期次 查询排量 通行证')),/不属于本群/);
 assert.equal(JSON.stringify(db),before);
});
test('QQ queries ask for campaign names when multiple campaigns match and honor explicit choice',()=>{
 const c={...campaign(),groupId:'11111'},other={...campaign(),id:'other',name:'另一团',groupId:'11111'};
 const db={campaigns:[c,other],albums:[]},say=t=>({group_id:11111,self_id:99999,user_id:12345,message:[{type:'at',data:{qq:99999}},{type:'text',data:{text:t}}]});
 for(const target of ['通行证','洁哥通行证'])assert.throws(()=>processQQEvent(db,say('查询排量 '+target)),/多个期次.*示例期次、另一团/);
 assert.match(processQQEvent(db,say('查询排量 另一团 通行证55.0')).reply,/^另一团｜/);
});

test('bare QQ demand query aggregates sender quantities by campaign and keeps proxies separate without crossing groups',()=>{
 const c={...campaign(),groupId:'11111'};c.records[0].qq='12345';c.records[1].qq='54321';c.records[2].qq='12345';
 c.records.push({id:'4',skuId:'a',qq:'12345',member:'示例用户J',quantity:2,createdAt:'2026-10-23T04:00:00Z'},
  {id:'5',skuId:'a',qq:'12345',member:'示例用户J 代 小明',proxyFor:'小明',quantity:2,createdAt:'2026-10-23T05:00:00Z'},
  {id:'6',skuId:'gift',member:'示例用户J',quantity:1,createdAt:'2026-10-23T06:00:00Z'},
  {id:'7',skuId:'gift',qq:'99998',member:'示例用户J',quantity:9,createdAt:'2026-10-23T07:00:00Z'});
 const other={...campaign(),id:'other',name:'本群另一期',groupId:'11111',records:[{id:'8',skuId:'stand',qq:'12345',member:'示例用户J',quantity:4,createdAt:'2026-10-23T08:00:00Z'}]};
 const foreign={...other,id:'foreign',name:'外群期次',groupId:'22222'},empty={...other,id:'empty',name:'空期次',records:[]};
 const db={campaigns:[c,other,foreign,empty],members:{12345:{cn:'示例用户J'}}},before=JSON.stringify(db);
 const say=t=>({group_id:11111,self_id:99999,user_id:12345,message:[{type:'at',data:{qq:99999}},{type:'text',data:{text:t}}]});
 for(const command of ['查询排量','查询 排量：　','排量']){
  const result=processQQEvent(db,say(command));assert.equal(result.readOnly,true);
  assert.match(result.reply,/通行证-予愿安洁莉娜 \[55\.0\]：5对/);assert.match(result.reply,/代 小明｜通行证-予愿安洁莉娜 \[55\.0\]：2对/);
  assert.match(result.reply,/特典明信片：1张/);assert.match(result.reply,/本群另一期｜你已排的制品\n角色亚克力立牌-克莱门莎款：4件/);
  assert.doesNotMatch(result.reply,/外群期次|空期次|：9张|通行证-克莱门莎|合计/);
 }
 assert.equal(JSON.stringify(db),before);
});

test('personal demand query honors explicit campaigns, needs no CN for identified rows and preserves targeted public queries',()=>{
 const c={...campaign(),groupId:'11111'};c.records[0].qq='12345';c.records[1].qq='54321';c.records[2].qq='54321';
 const other={...c,id:'other',name:'另一团',records:[{...c.records[0],quantity:8}]};
 const db={campaigns:[c,other],qqEnrollmentEnabled:true},say=(text,user_id=12345)=>({group_id:11111,self_id:99999,user_id,message:[{type:'at',data:{qq:99999}},{type:'text',data:{text}}]});
 const result=processQQEvent(db,say('查询排量 示例期次'));assert.match(result.reply,/：3对/);assert.doesNotMatch(result.reply,/另一团|克莱门莎/);
 assert.match(processQQEvent(db,say('示例期次 查询排量 通行证55.0')).reply,/克莱门莎：2对/);
 assert.equal(processQQEvent(db,say('查询排量',77777)).reply,'你在本群还没有排表记录');
 assert.match(processQQEvent(db,say('查询排量',0)).reply,/发送者QQ/);
 assert.match(processQQEvent(db,{...say('查询排量'),message:[{type:'text',data:{text:'查询排量'}}]}).reply,/@/);
 assert.throws(()=>processQQEvent(db,{user_id:12345,message:[{type:'text',data:{text:'查询排量'}}]}),/私聊仅支持/);
});
test('desktop API shares query behavior without writing records or capacity',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-query-test-')),c=campaign(),db={campaigns:[c],settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''}};await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(db));const s=await start({port:0,dataDir:dir});try{const post=async body=>{const r=await fetch(s.url+'/api/queue-query',{method:'POST',headers:{origin:s.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',...body})});return {status:r.status,body:await r.json()};};assert.equal((await post({kind:'排量',target:'通行证55.0'})).body.products.length,3);assert.equal((await post({kind:'余量',target:'克莱门莎立牌'})).status,400);assert.match((await post({kind:'余量',target:'通行证56.0'})).body.error,/总配数/);assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8')),db);}finally{await new Promise(r=>s.server.close(r));await fs.rm(dir,{recursive:true});}});
