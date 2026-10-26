import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {catalog,imageLink} from './domain.mjs';import {loadReferences,expandBox,enrichRecognition,characterReference,verifyPrts,findBox} from './pass-reference.mjs';import {start} from './server.mjs';import {loadBotSkills,requireBot} from './bots.mjs';
import {readAdjustment} from './pass-adjustment.mjs';
import {boxRosterHint,adjustmentRetryBoxes,replaceBoxObservations} from './pass-reference.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
test('image box prices require explicit whole-box labels, retain non-350 prices and reject conflicts',async()=>{
 const ref=await loadReferences(root),entry=(boxId,price,priceText,status='clear')=>({boxId,price,priceText,status});
 const result=enrichRecognition(ref,{boxIds:['55.0'],products:[],boxPrices:[entry('通行证55.0',350,'350元/整盒'),entry('56.0',420,'整盒原价：420元'),entry('57.0',25,'25元/单抽 350元/整盒'),entry('58.0',350,'350元/整盒','uncertain'),entry('59.0',300,'300元/整盒'),entry('59.0',320,'320元/整盒')]});
 assert.deepEqual(result.boxPrices.map(x=>[x.boxId,x.price]),[['55.0',350],['56.0',420]]);assert.ok(result.questions.some(x=>x.includes('冲突')));assert.equal(result.products[0].averagePrice,null);
 assert.deepEqual(enrichRecognition(ref,{boxIds:['55.0'],products:[]}).boxPrices,[]);
});
test('wrong familiar roles trigger box-specific review without losing other merchandise',async()=>{
  const refs=await loadReferences(root),first={boxIds:['55.0'],products:[{name:'徽章',type:'单领',price:20},{type:'通行证',boxId:'55.0',character:'阿米娅',adjustment:15,adjustmentText:'+15',adjustmentStatus:'clear'}]};
  assert.equal(characterReference(refs,'Homebound').name,'旅骨');assert.match(boxRosterHint(refs,['55.0']),/Thumpy/);
  assert.deepEqual(adjustmentRetryBoxes(refs,first),['55.0']);assert.match(boxRosterHint(refs,['55.0']),/珊比/);
  const retry={products:[{type:'通行证',boxId:'55.0',character:'珊比',adjustment:15,adjustmentText:'+15',adjustmentStatus:'clear'},{type:'单领',name:'不应混入'}]};
  const combined=replaceBoxObservations(refs,first,retry,['55.0']);assert.equal(combined.products.length,2);assert.equal(combined.products[0].name,'徽章');assert.deepEqual(adjustmentRetryBoxes(refs,combined),[]);
  assert.equal(enrichRecognition(refs,combined).products.find(p=>p.character==='珊比').adjustment,15);
});
test('signed adjustment observations survive known-box expansion without importing retail prices',async()=>{
  const refs=await loadReferences(root),values=[40,15,20,-20,-20,-16,-20],box=expandBox(refs,'55.0');
  const observed=box.products.map((p,i)=>({type:'通行证',boxId:'55.0',character:p.character,adjustment:values[i],adjustmentText:(values[i]>0?'+':'')+values[i],adjustmentStatus:'clear'}));
  const result=enrichRecognition(refs,{boxIds:['55.0'],products:observed,questions:[]});
  assert.equal(result.products.length,7);assert.deepEqual(result.products.map(p=>p.adjustment),values);assert.ok(result.products.every(p=>p.adjustmentSource==='recognized'&&p.price===null&&p.averagePrice===null));
  const rows=catalog(result.products.map(p=>({...p,averagePrice:30})));assert.deepEqual(rows.map(p=>p.price),values.map(v=>30+v));assert.equal(rows[0].adjustmentText,'+40');
});
test('uncertain handwriting, mismatched signs and conflicting observations require review',async()=>{
  for(const p of [{adjustment:-16,adjustmentText:'-1?',adjustmentStatus:'uncertain'},{adjustment:20,adjustmentText:'-20',adjustmentStatus:'clear'},{adjustment:25,adjustmentText:'25元/单抽',adjustmentStatus:'clear'}]){const r=readAdjustment(p);assert.equal(r.adjustment,0);assert.equal(r.adjustmentReview,true);}
  assert.equal(readAdjustment({adjustment:-20,adjustmentText:'－20元/对',adjustmentStatus:'clear'}).adjustment,-20);
  const refs=await loadReferences(root);const one={type:'通行证',boxId:'55.0',character:'旅骨',adjustment:-16,adjustmentText:'-16',adjustmentStatus:'clear'};
  const result=enrichRecognition(refs,{boxIds:['55.0'],products:[one,{...one,adjustment:-15,adjustmentText:'-15'}]});const role=result.products.find(p=>p.character==='旅骨');assert.equal(role.adjustmentReview,true);assert.equal(role.adjustment,0);assert.ok(result.questions.some(q=>q.includes('冲突')));
});
test('three product types preserve user prices and pass pair pricing is deterministic',()=>{
  const rows=catalog([{id:'gift',name:'特典卡',type:'特典',price:12.5},{id:'stand',name:'立牌',type:'单领',price:45},{id:'pass',name:'任意旧称',character:'阿米娅',type:'通行证',price:999,averagePrice:17.44,adjustment:-8,unit:'对'}]);
  assert.equal(rows[0].price,12.5);assert.equal(rows[1].price,45);assert.equal(rows[2].name,'通行证-阿米娅');assert.equal(rows[2].price,9.44);
  assert.equal(catalog([{name:'特典',type:'特典',price:null}])[0].price,null);assert.equal(catalog([{name:'改名特典',type:'单领',categoryId:'gift',price:null}],[{id:'gift',name:'赠品',kind:'single',role:'gift'}])[0].price,null);assert.equal(catalog([{name:'通行证-阿米娅',type:'通行证',averagePrice:null,adjustment:-5}])[0].price,null);assert.throws(()=>catalog([{name:'通行证-阿米娅',type:'通行证',averagePrice:10,adjustment:-11}]));
  assert.throws(()=>imageLink('javascript:alert(1)'));assert.throws(()=>imageLink('/media/../../workspace.json'));
  const text=catalog([{name:'文字徽章',recognitionName:'初次识别名称',type:'单领',price:20,textOnly:true,imageUrl:'https://example.com/image.jpg',portraitUrl:'https://example.com/portrait.jpg'}])[0];assert.equal(text.recognitionName,'初次识别名称');assert.equal(text.textOnly,true);assert.equal(text.imageUrl,'');assert.equal(text.portraitUrl,'');
});
test('released box reference expands exact IDs; market prices and predictions are not imported',async()=>{
  const ref=await loadReferences(root);assert.equal(ref.boxes.length,94);assert.equal(findBox(ref,'通行证55.0').id,'55.0');assert.equal(findBox(ref,'通行证1.0').id,'1.0');assert.equal(findBox(ref,'通行证10.0').id,'10.0');
  const box=expandBox(ref,'55.0');assert.equal(box.products.length,7);assert.equal(box.products[0].character,'予愿安洁莉娜');assert.equal(box.products[0].averagePrice,null);assert.equal(box.products[0].price,null);assert.ok(box.products[0].imageUrl.startsWith('https://'));
  assert.equal(JSON.stringify(ref).includes('market_price'),false);assert.throws(()=>expandBox(ref,'99.0'));
  assert.equal(characterReference(ref,'兔兔').name,'阿米娅');assert.notEqual(characterReference(ref,'神秘角色').status,'PRTS 页面存在');
});
test('image enrichment keeps gifts with a shared box ID and expands known passes without invented prices',async()=>{
  const ref=await loadReferences(root);const data=enrichRecognition(ref,{boxIds:['55.0'],products:[{name:'特典',type:'特典',boxId:'55.0',price:25},{name:'整盒',type:'通行证',boxId:'55.0'},{name:'毛绒延展扣',type:'单领',price:45},{name:'徽章组',type:'单领',boxId:'55.0',price:30}]});
  assert.equal(data.products.length,10);assert.equal(data.products[0].price,null);assert.equal(data.products.filter(p=>p.type==='通行证').length,7);
  assert.deepEqual(data.products.filter(p=>p.type==='单领').map(p=>[p.name,p.price]),[['毛绒延展扣',45],['徽章组',30]]);
  const unknown=enrichRecognition(ref,{boxIds:['99.0'],products:[]});assert.equal(unknown.products.length,0);assert.ok(unknown.questions.length);
});
test('PRTS errors remain errors and wiki page existence is not asserted on missing names',async()=>{
  await assert.rejects(verifyPrts(['阿米娅'],async()=>new Response('',{status:403})),/403/);
  const result=await verifyPrts(['阿米娅','不存在'],async()=>Response.json({query:{pages:{1:{title:'阿米娅',pageid:1},'-1':{title:'不存在',missing:''}}}}));
  assert.match(result[0].status,/页面存在/);assert.match(result[1].status,/未找到/);
});
test('passes can be saved and enrolled before pricing, then existing records follow later prices',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-pending-price-')),s=await start({port:0,dataDir:dir});
  const post=async(route,b)=>{const r=await fetch(s.url+'/api/'+route,{method:'POST',headers:{origin:s.url,'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json()};};
  try{
    const c=(await post('campaign',{name:'待定价测试'})).body;
    const products=[{id:'a',type:'通行证',name:'通行证-阿米娅',boxId:'1.0',averagePrice:null,adjustment:-2},{id:'b',type:'通行证',name:'通行证-能天使',boxId:'1.0',averagePrice:null,adjustment:3}];
    assert.equal((await post('catalog',{campaignId:c.id,revision:0,products})).status,200);
    await post('enroll',{campaignId:c.id,revision:1,skuId:'a',quantity:2,member:'甲',requestId:'pending'});
    let state=await (await fetch(s.url+'/api/state')).json();assert.equal(state.campaigns[0].records[0].unitCents,null);assert.equal(state.campaigns[0].records[0].status,'待定价');
    for(const p of products)p.averagePrice=17.44;
    const priced=await post('catalog',{campaignId:c.id,revision:1,products});assert.equal(priced.body.updatedRecords,1);
    state=await (await fetch(s.url+'/api/state')).json();assert.equal(state.campaigns[0].products[0].price,15.44);assert.equal(state.campaigns[0].products[1].price,20.44);assert.equal(state.campaigns[0].records[0].unitCents,1544);assert.equal(state.campaigns[0].records[0].status,'暂估');
    for(const p of products)p.averagePrice=null;
    await post('catalog',{campaignId:c.id,revision:2,products});state=await (await fetch(s.url+'/api/state')).json();assert.equal(state.campaigns[0].records[0].unitCents,null);
    const saved=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(saved.campaigns[0].products[0].price,null);assert.equal(saved.campaigns[0].records[0].history.length,2);
  }finally{await new Promise(r=>s.server.close(r));await fs.rm(dir,{recursive:true});}
});
test('Bot-specific skill composition and references are actually supplied to image inference',async()=>{
  const skills=await loadBotSkills(root);assert.match(skills.get('zhougu'),/三种类型/);assert.match(skills.get('zhougu'),/共用拼谷规则/);assert.throws(()=>requireBot('other'));
  let prompt='',taskPrompt='';const upstreamFetch=async(url,opts)=>{if(url.endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',input_modalities:['text','image']}]});const body=JSON.parse(opts.body);prompt=body.messages[0].content;taskPrompt=body.messages[1].content[0].text;return Response.json({choices:[{message:{content:JSON.stringify({boxIds:['55.0'],boxPrices:[{boxId:'55.0',price:350,priceText:'350元/整盒',status:'clear'}],products:[{name:'亚克力挂件',type:'单领',price:35,imageIndex:0,cropBounds:null},{type:'通行证',boxId:'55.0',character:'予愿安洁莉娜',adjustment:40,adjustmentText:'+40',adjustmentStatus:'clear'}]})}}]});};
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-bot-test-')),s=await start({port:0,dataDir:dir,upstreamFetch});
  const post=async(route,b)=>{const r=await fetch(s.url+'/api/'+route,{method:'POST',headers:{origin:s.url,'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json()};};
  try{
    const c=(await post('campaign',{name:'一期',botId:'zhougu'})).body;assert.equal(c.botId,'zhougu');assert.equal((await post('campaign',{name:'错误',botId:'unknown'})).status,400);
    await post('settings',{provider:'deepseek',model:'deepseek-flash',apiKey:'test-key'});
    const result=await post('recognize',{campaignId:c.id,botId:'zhougu',mode:'image',image:'data:image/png;base64,eA=='});assert.equal(result.body.data.products.length,8);assert.equal(result.body.data.boxPrices[0].price,350);assert.match(taskPrompt,/boxPrices/);assert.equal(result.body.data.products[0].name,'亚克力挂件');assert.match(prompt,/粥谷 Bot/);assert.match(prompt,/共用拼谷规则/);assert.match(taskPrompt,/不得因为找到通行证就提前结束/);assert.equal(taskPrompt.includes('如识别到老盒，只返回boxIds即可'),false);
    assert.equal((await post('recognize',{campaignId:c.id,botId:'other',mode:'image'})).status,400);
    const products=[{id:'s',name:'徽章',type:'单领',price:20}];await post('catalog',{campaignId:c.id,products,revision:0});
    await post('enroll',{campaignId:c.id,skuId:'s',member:'甲',quantity:2,revision:1,requestId:'r'});
    products[0].price=25;const updated=await post('catalog',{campaignId:c.id,products,revision:1});assert.equal(updated.body.updatedRecords,1);
    const state=await (await fetch(s.url+'/api/state')).json();assert.equal(state.campaigns[0].lastRecognition.modelResult.products.length,2);assert.equal(state.campaigns[0].lastRecognition.result.products.find(p=>p.character==='予愿安洁莉娜').adjustment,40);assert.equal(state.campaigns[0].lastRecognition.result.products.length,8);assert.equal(state.campaigns[0].records[0].unitCents,2500);assert.equal(state.campaigns[0].records[0].history[0].unitCents,2000);
    assert.equal((await post('catalog',{campaignId:c.id,products,revision:1})).status,400);
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    const uploaded=await post('upload',{image:png});assert.equal(uploaded.status,200);assert.equal((await fetch(s.url+uploaded.body.url)).status,200);assert.equal((await post('upload',{image:'data:image/png;base64,eA=='})).status,400);
  }finally{await new Promise(r=>s.server.close(r));await fs.rm(dir,{recursive:true});}
});


test('blank gift prices and review confirmations persist across an actual backend restart',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-gift-save-'));let app=await start({port:0,dataDir:dir,credentialStore:{get:async()=>'',set:async()=>{}}});
 const post=async(route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{const {data:c}=await post('campaign',{name:'模拟空价保存',botId:'zhougu'});const products=[{id:'p',name:'模拟单领',type:'单领',price:20},{id:'gift',name:'模拟特典',type:'特典',giftTier:1,price:null}];const review={sourceAt:'2026-10-26T00:00:00Z',items:[{message:'请核对模拟名称',done:true}]};const saved=await post('catalog',{campaignId:c.id,revision:0,products,catalogReview:review});assert.equal(saved.status,200,JSON.stringify(saved.data));await app.shutdown();app=await start({port:0,dataDir:dir,credentialStore:{get:async()=>'',set:async()=>{}}});const state=await(await fetch(app.url+'/api/state')).json();assert.equal(state.campaigns[0].products.length,2);assert.equal(state.campaigns[0].products.find(p=>p.id==='gift').price,null);assert.deepEqual(state.campaigns[0].catalogReview,review);assert.equal((await post('catalog',{campaignId:c.id,revision:1,products,catalogReview:{sourceAt:'',items:[null]}})).status,400);const after=await(await fetch(app.url+'/api/state')).json();assert.deepEqual(after.campaigns[0].catalogReview,review);}finally{await app.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
