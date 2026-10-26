import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {readUsage,parseCostCommand,periodStart,priceFor,requestCost,createUsageStore,usageReport,normalizePricing} from './usage.mjs';
import {start} from './server.mjs';import {defaultCategories} from './workflow.mjs';import {processQQEvent} from './qq-commands.mjs';
const clock=()=>new Date('2026-10-24T02:00:00Z'),config={provider:'custom',baseUrl:'https://model.example.test/v1',model:'vision-test'};
const units={input:100,output:10,total:110,cached:20,reasoning:5,cacheWrites:0};
const pricing={mode:'manual',currency:'CNY',input:1,cached:0.5,output:2};

test('usage reads chat and Responses fields without double counting cached or reasoning tokens',()=>{
 assert.deepEqual(readUsage({usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110,prompt_cache_hit_tokens:20,completion_tokens_details:{reasoning_tokens:5}}}),units);
 assert.deepEqual(readUsage({usage:{input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:20},output_tokens_details:{reasoning_tokens:5}}}),units);
 assert.equal(readUsage({usage:{prompt_tokens:-1,completion_tokens:'10'}}),null);assert.equal(readUsage({}),null);
 assert.equal(readUsage({usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}).total,0);
 assert.equal(requestCost({},units,pricing).amount,0.00011);
 assert.equal(requestCost({}, {...units,cached:null},pricing),null);assert.equal(requestCost({}, {...units,cacheWrites:20},pricing),null);
 assert.equal(requestCost({}, {...units,cached:101},pricing),null);
 assert.deepEqual(requestCost({usage:{cost:{value:'0.0123',currency:'USD'}}},null,null),{amount:0.0123,currency:'USD',source:'reported'});
 assert.equal(requestCost({usage:{cost:0.5}},null,null),null);
 assert.throws(()=>normalizePricing({...pricing,input:-1}));assert.throws(()=>normalizePricing({...pricing,cached:''}));
});

test('cost command aliases are anchored and periods use Beijing midnight, Monday and calendar month boundaries',()=>{
 for(const word of ['查询花费','查看费用','查消费','花费'])assert.equal(parseCostCommand(word).period,'all');
 for(const day of ['本日','今日','今天','当天'])assert.equal(parseCostCommand('查询'+day+'花费').period,'day');
 for(const week of ['本周','这周','本星期','这个星期'])assert.equal(parseCostCommand(week+'费用').period,'week');
 for(const month of ['本月','这个月','当月'])assert.equal(parseCostCommand('查询消费 '+month).period,'month');
 for(const text of ['解释 花费','查询花费 群22222','查询本日花费本月','这个谷花费多少'])assert.equal(parseCostCommand(text),null);
 const now=new Date('2026-10-31T16:01:00Z');
 assert.equal(new Date(periodStart('day',now)).toISOString(),'2026-10-31T16:00:00.000Z');
 assert.equal(new Date(periodStart('month',now)).toISOString(),'2026-10-31T16:00:00.000Z');
 assert.equal(new Date(periodStart('week',now)).toISOString(),'2026-10-25T16:00:00.000Z');
 assert.equal(new Date(periodStart('week',new Date('2027-01-01T01:00:00Z'))).toISOString(),'2026-12-27T16:00:00.000Z');
});

test('DeepSeek automatic estimates distinguish provider, model, currency, peak hours, weekends and holidays',()=>{
 const ds={provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash'};
 assert.equal(priceFor(ds,'2026-10-26T01:00:00Z').input,2);assert.equal(priceFor(ds,'2026-10-26T04:00:00Z').input,1);
 assert.equal(priceFor(ds,'2026-10-24T02:00:00Z').input,1);assert.equal(priceFor(ds,'2026-10-01T02:00:00Z').input,1);
 assert.equal(priceFor(ds,'2026-10-26T06:00:00Z',{currency:'USD'}).output,1.2);
 assert.equal(priceFor({...ds,model:'deepseek-v4-pro'},clock()).output,13.5);
 assert.equal(priceFor({...ds,model:'deepseek-v4-flash-vision-exp'},clock()).cached,0.02);
 assert.equal(priceFor({...ds,provider:'custom'},clock()),null);assert.equal(priceFor({...ds,model:'unknown'},clock()),null);
 assert.equal(priceFor(ds,'2027-01-04T02:00:00Z'),null);assert.equal(priceFor(ds,clock(),pricing).source,'manual');
});

test('ledger preserves concurrent requests, interrupted calls and price snapshots across restarts without storing credentials',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-usage-store-'));
 try{
  let store=await createUsageStore(dir,{now:clock});await store.configure(config,pricing);
  const [one,two,pending]=await Promise.all([store.begin(config,{groupId:'11111'}),store.begin(config,{groupId:'22222'}),store.begin(config,{groupId:'11111'})]);
  await store.configure(config,{...pricing,input:999});
  const payload={usage:{prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:20},apiKey:'synthetic-secret',content:'private-image-and-prompt'};
  await Promise.all([store.finish(two,payload,'response'),store.finish(one,payload,'response')]);
  store=await createUsageStore(dir,{now:clock});const report=store.report('11111','day');assert.equal(report.rows[0].requests,2);assert.equal(report.rows[0].totalTokens,110);assert.equal(report.rows[0].unknownUsage,1);assert.equal(report.rows[0].unknownCost,1);assert.equal(report.rows[0].amounts[0].amount,0.00011);
  assert.equal(store.configuration({...config,model:'other'}).rule.mode,'auto');assert.equal(store.configuration(config).rule.input,999);
  const raw=await fs.readFile(path.join(dir,'usage-ledger.json'),'utf8');assert.ok(!raw.includes('synthetic-secret'));assert.ok(!raw.includes('private-image-and-prompt'));assert.equal(JSON.parse(raw).requests.find(r=>r.id===pending).status,'interrupted');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('group reports isolate amounts and time windows, keep currencies separate and mark missing data instead of zero',()=>{
 const r=(at,groupId='11111',extra={})=>({at,groupId,usage:{total:110},cost:{amount:0.1,currency:'CNY',source:'estimate'},...extra});
 const data={startedAt:'2026-10-01T00:00:00Z',requests:[r('2026-10-31T16:00:00Z'),r('2026-10-31T15:59:59Z'),r('2026-10-25T16:00:00Z'),r('2026-10-25T15:59:59Z'),r('2026-11-01T00:00:00Z','22222'),r('2026-11-01T00:00:00Z','11111',{cost:{amount:0.2,currency:'USD',source:'reported'}}),r('2026-11-01T00:00:00Z','11111',{usage:null,cost:null})]};
 const report=usageReport(data,'11111','all',new Date('2026-11-01T01:00:00Z'));
 assert.deepEqual(report.rows.map(r=>r.requests),[3,5,3]);assert.deepEqual(report.rows.map(r=>r.totalTokens),[220,440,220]);assert.equal(report.rows[0].amounts.length,2);
 assert.match(report.reply,/预估 ¥0.100000/);assert.match(report.reply,/接口金额 US\$0.200000/);assert.match(report.reply,/1次用量未确认/);assert.match(report.reply,/1次费用未确认/);
 assert.match(usageReport(data,'33333','day',clock()).reply,/无模型调用/);assert.throws(()=>usageReport(data,'', 'all',clock()),/群内/);
});

test('QQ cost queries need a real mention, use event group and work without campaigns or model calls',()=>{
 const db={campaigns:[],qqGroups:[{id:'11111'}]},before=JSON.stringify(db),seen=[];
 const say=text=>({group_id:11111,self_id:99999,user_id:12345,message:[{type:'at',data:{qq:99999}},{type:'text',data:{text}}]});
 const options={usageReport:(group,period)=>{seen.push([group,period]);return {reply:'本群费用 '+period};}};
 for(const [command,period]of [['查询花费','all'],['查询本日花费','day'],['今日花费','day'],['查询本周消费','week'],['查询本月费用','month']]){const result=processQQEvent(db,say(command),options);assert.equal(result.readOnly,true);assert.equal(result.reply,'本群费用 '+period);}
 assert.ok(seen.every(([g])=>g==='11111'));assert.equal(JSON.stringify(db),before);
 assert.match(processQQEvent(db,{...say('查询花费'),message:[{type:'text',data:{text:'查询花费'}}]},options).reply,/@/);assert.equal(seen.length,5);
});

test('all model attempts are billed to campaign group, including parse failures and HTTP errors; queries and models listing stay free',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-usage-server-'));let mode='success',calls=0;
 const c=id=>({id,name:'模拟'+id,botId:'zhougu',groupId:id==='c'?'11111':'22222',products:[],records:[],categories:defaultCategories()});
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[c('c'),c('d')],qqGroups:[{id:'11111'},{id:'22222'},{id:'33333'}],settings:config}));
 const secret='synthetic-usage-private-key',app=await start({port:0,dataDir:dir,usageClock:clock,credentialStore:{get:async()=>secret},upstreamFetch:async(url,opts)=>{
  if(url.endsWith('/models'))return Response.json({data:[{id:'vision-test',input_modalities:['text','image']}]});
  calls++;assert.equal(opts.headers.authorization,'Bearer '+secret);
  if(mode==='network')throw Error(secret+' network error');
  if(mode==='raw')return new Response('not JSON '+secret,{status:502});
  const usage={prompt_tokens:100,completion_tokens:10,total_tokens:110,prompt_cache_hit_tokens:20};
  if(mode==='http')return Response.json({error:{message:'synthetic error '+secret},usage:{...usage,cost:{value:0.01,currency:'USD'}}},{status:400});
  return Response.json({usage:mode==='missing'?undefined:usage,choices:[{message:{content:mode==='bad-json'?'broken JSON':JSON.stringify({products:[{name:'模拟立牌',type:'单领',price:10}]})}}]});
 }});
 const post=async(route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await post('usage-pricing',{...config,pricing})).status,200);assert.equal((await post('test-connection',{})).status,200);
  const ask=period=>post('qq-event',{post_type:'message',group_id:11111,user_id:12345,self_id:99999,message:[{type:'at',data:{qq:99999}},{type:'text',data:{text:period}}]});
  assert.equal((await ask('查询花费')).status,200);assert.equal(calls,0);
  for(mode of ['success','bad-json','network','missing','raw']){const result=await post('recognize',{campaignId:'c',groupId:'22222',mode:'image',image:'data:image/png;base64,eA=='});if(mode==='raw'){assert.equal(result.status,400);assert.match(result.data.error,/HTTP 502/);assert.ok(!result.data.error.includes('not JSON'));}}
  mode='http';await post('recognize',{campaignId:'d',mode:'image',image:'data:image/png;base64,eA=='});
  const report=await post('usage-report',{groupId:'11111',period:'day'});assert.equal(report.data.rows[0].requests,5);assert.equal(report.data.rows[0].totalTokens,220);assert.equal(report.data.rows[0].unknownUsage,3);assert.equal(report.data.rows[0].unknownCost,3);assert.equal(report.data.rows[0].amounts[0].amount,0.00022);
  const other=await post('usage-report',{groupId:'22222',period:'day'});assert.equal(other.data.rows[0].requests,1);assert.equal(other.data.rows[0].amounts[0].currency,'USD');
  const reply=await ask('今日花费');assert.equal(reply.data.readOnly,true);assert.equal(calls,6);assert.ok(!reply.data.reply.includes(secret));
  assert.equal((await post('usage-report',{groupId:'44444'})).status,400);
  const privateFile=await fetch(app.url+'/usage-ledger.json');assert.equal(privateFile.status,404);
  const raw=await fs.readFile(path.join(dir,'usage-ledger.json'),'utf8');assert.ok(!raw.includes(secret));assert.ok(!raw.includes('data:image'));assert.ok(!raw.includes('模拟立牌'));assert.ok(!raw.includes('network error'));
 }finally{await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('image adjustment review records a separate paid attempt under the same campaign group',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-usage-review-'));let calls=0;
 const c={id:'c',name:'模拟调价',botId:'zhougu',groupId:'11111',products:[],records:[],categories:defaultCategories()};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({settings:config,campaigns:[c],qqGroups:[{id:'11111'}]}));
 const app=await start({port:0,dataDir:dir,usageClock:clock,credentialStore:{get:async()=> 'synthetic-review-key'},upstreamFetch:async()=>{
  calls++;const data={boxIds:['55.0'],products:[{type:'通行证',boxId:'55.0',character:calls===1?'阿米娅':'珊比',adjustment:15,adjustmentText:'+15',adjustmentStatus:'clear'}]};
  return Response.json({usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},choices:[{message:{content:JSON.stringify(data)}}]});
 }});
 try{
  const response=await fetch(app.url+'/api/recognize',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',mode:'image',image:'data:image/png;base64,eA=='})});assert.equal(response.status,200);assert.equal(calls,2);
  const ledger=JSON.parse(await fs.readFile(path.join(dir,'usage-ledger.json'),'utf8'));assert.deepEqual(ledger.requests.map(r=>r.purpose),['image','adjustment-review']);assert.ok(ledger.requests.every(r=>r.groupId==='11111'));assert.equal(ledger.requests.reduce((n,r)=>n+r.usage.total,0),220);
 }finally{await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('automatic album image classification is attributed and cached scopes do not incur duplicate model calls',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-usage-album-'));let calls=0;
 const v=n=>{n=BigInt(n);const a=[];do{let x=Number(n&127n);n>>=7n;if(n)x|=128;a.push(x);}while(n);return Buffer.from(a);};
 const u=(f,n)=>Buffer.concat([v(f*8),v(n)]),b=(f,s)=>{s=Buffer.isBuffer(s)?s:Buffer.from(String(s));return Buffer.concat([v(f*8+2),v(s.length),s]);},msg=(f,...parts)=>b(f,Buffer.concat(parts));
 const feed=msg(4,msg(2,msg(1,msg(1,b(4,'feed')),msg(7,u(1,1),msg(2,b(1,'1'),msg(2,b(13,'12345')),msg(3,u(1,0),b(2,'测试立牌1')),u(4,1792807200)))))).toString('hex');
 const c={id:'c',name:'模拟相册',botId:'zhougu',groupId:'11111',products:[{id:'p',name:'测试立牌',type:'单领',price:10}],records:[],categories:defaultCategories()};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({settings:config,campaigns:[c],qqGroups:[{id:'11111'}],members:{12345:{cn:'测试甲'}},albums:[{campaignId:'c',groupId:'11111',albumId:'album'}],qqSettings:{url:'ws://127.0.0.1:12345'}}));
 const app=await start({port:0,dataDir:dir,usageClock:clock,credentialStore:{get:async()=> 'synthetic-album-key'},referenceFetch:async()=>new Response(Buffer.from('synthetic-image'),{headers:{'content-type':'image/png'}}),qqConnector:()=>({status:()=> '已连接',close(){},async call(action){if(action==='get_group_album_media_list')return {media_list:[{batch_id:'batch',image:{lloc:'photo',default_url:{url:'https://qungz.photo.store.qq.com/synthetic.png'}}}]};if(action==='send_packet')return feed;throw Error('Unexpected QQ operation');}}),upstreamFetch:async()=>{
  calls++;return Response.json({usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},choices:[{message:{content:JSON.stringify({status:'resolved',categoryId:'单领',productIds:['p']})}}]});
 }});
 try{
  for(let i=0;i<2;i++){const r=await fetch(app.url+'/api/qq-album-comments',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);}
  assert.equal(calls,1);const ledger=JSON.parse(await fs.readFile(path.join(dir,'usage-ledger.json'),'utf8'));assert.equal(ledger.requests.length,1);assert.equal(ledger.requests[0].purpose,'album-scope');assert.equal(ledger.requests[0].groupId,'11111');
 }finally{await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
