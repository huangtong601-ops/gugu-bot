import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {blindBoxRecognition,mergeRecognitionCategories} from './public/recognition-categories.js';
import {mergeProducts} from './public/product-merge.js';
import {catalog} from './domain.mjs';
import {categories,defaultCategories} from './workflow.mjs';
import {purchasePool} from './order-planning.mjs';
import {enrichRecognition} from './pass-reference.mjs';
import {start} from './server.mjs';

const fixture=()=>({groups:[{id:'fridge',title:'立体冰箱贴盲盒',boxPrice:195,priceText:'39元/抽 195元/端盒',priceStatus:'clear'}],products:[...['Mon3tr','重岳','琳琅诗怀雅','黑键','模拟款'].map(character=>({groupId:'fridge',character,name:'冰箱贴-'+character,type:'单领',price:39,unit:'件'})),{name:'甜品碟-重岳',type:'单领',price:35,unit:'件'}]});
test('explicit blind-box title creates one group with five separate roles and preserves single items',()=>{
 const data=enrichRecognition({boxes:[],characters:[]},fixture());assert.equal(data.categories.length,1);assert.equal(data.categories[0].name,'立体冰箱贴');assert.equal(data.categories[0].kind,'group');assert.equal(data.categories[0].boxPrices[''],195);assert.equal(data.products.length,6);assert.ok(data.products.slice(0,5).every(p=>p.categoryId===data.categories[0].id&&p.price===null&&p.averagePrice===null&&p.unit==='件'));assert.equal(data.products[5].price,35);assert.equal(data.products[5].categoryId,undefined);
 const cats=defaultCategories();let id=0;mergeRecognitionCategories(cats,data.products,data.categories,()=> 'cat-'+ ++id);const normalized=catalog(data.products,categories(cats)),c={categories:cats,products:normalized,records:[]};assert.equal(normalized[0].character,'Mon3tr');const pool=purchasePool(c);assert.equal(pool.filter(p=>p.kind==='group').length,1);assert.equal(pool.find(p=>p.kind==='group').price,195);assert.equal(pool.find(p=>p.kind==='group').quantity,0);assert.equal(pool.find(p=>p.kind==='single').price,35);
});
test('variant counts without blind-box text do not create group categories; pass expansion stays separate',()=>{
 const raw=fixture();raw.groups[0].title='甜品碟（共5款）';const data=blindBoxRecognition(raw);assert.equal(data.categories.length,0);assert.ok(data.products.every(p=>!p.categoryId));raw.groups[0].title='通行认证盲盒55.0';assert.equal(blindBoxRecognition(raw).categories.length,0);
});
test('whole-box price must be explicit and unambiguous; unknown roles are not invented',()=>{
 for(const change of [{priceText:'39元/抽',boxPrice:195},{priceStatus:'uncertain'},{boxPrice:39}]){const raw=fixture();Object.assign(raw.groups[0],change);assert.deepEqual(blindBoxRecognition(raw).categories[0].boxPrices,{});}
 const raw=fixture();raw.groups.push({...raw.groups[0],id:'again',boxPrice:200,priceText:'200元/端盒'});assert.deepEqual(blindBoxRecognition(raw).categories[0].boxPrices,{});raw.products[0].character='';const data=blindBoxRecognition(raw);assert.equal(data.products.length,5);assert.ok(data.questions.some(q=>q.includes('角色未识别')));
});
test('reimports reuse renamed groups, preserve manual values, and separate box variants',()=>{
 const cats=[{id:'existing',name:'冰箱贴专区',aliases:['立体冰箱贴'],kind:'group',pricingMode:'fixed',sets:4,boxPrices:{'':190},averageModesByBox:{'':'manual'}}],data=blindBoxRecognition(fixture());mergeRecognitionCategories(cats,data.products,data.categories,()=>assert.fail('must reuse'));assert.equal(cats.length,1);assert.equal(cats[0].boxPrices[''],190);assert.equal(cats[0].sets,4);assert.equal(data.products[0].pricingMode,'fixed');const products=[{...data.products[0],id:'old',price:42,imageUrl:'',adjustment:5}];let id=0;mergeProducts(products,data.products,()=>String(++id));assert.equal(products.length,6);assert.equal(products[0].price,42);assert.equal(products[0].adjustment,5);const other={...data.products[0],boxId:'新系列'};mergeProducts(products,[other],()=>String(++id));assert.equal(products.length,7);
 const blocked=blindBoxRecognition(fixture());assert.throws(()=>mergeRecognitionCategories([{id:'single',name:'立体冰箱贴',kind:'single'}],blocked.products,blocked.categories,()=> 'new'),/同名单领/);
});
test('image API returns usable grouping drafts in text-only mode without mutating catalogue',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-blindbox-'));let task='';const app=await start({port:0,dataDir:dir,upstreamFetch:async(url,opts)=>{if(url.endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',input_modalities:['text','image']}]});const body=JSON.parse(opts.body);task=body.messages[1].content[0].text;assert.match(body.messages[0].content,/非通行证盲盒自动建档/);return Response.json({choices:[{message:{content:JSON.stringify(fixture())}}]});}});
 const post=async(route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
 try{const c=await post('campaign',{name:'模拟盲盒期',botId:'zhougu'});await post('settings',{provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-test-only'});const {data}=await post('recognize',{campaignId:c.id,botId:'zhougu',mode:'image',textOnly:true,image:'data:image/png;base64,eA=='});assert.match(task,/groupId/);assert.equal(data.categories[0].boxPrices[''],195);assert.ok(data.products.every(p=>p.textOnly&&p.imageUrl===''&&p.cropBounds===null));let state=await (await fetch(app.url+'/api/state')).json();assert.equal(state.campaigns[0].products.length,0);const cats=state.campaigns[0].categories;mergeRecognitionCategories(cats,data.products,data.categories,()=> 'new-group');await post('catalog',{campaignId:c.id,revision:0,categories:cats,products:data.products});state=await (await fetch(app.url+'/api/state')).json();assert.equal(state.campaigns[0].products.length,6);assert.equal(state.campaigns[0].categories.find(c=>c.id==='new-group').boxPrices[''],195);}finally{await app.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
