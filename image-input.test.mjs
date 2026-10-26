import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {planImageTiles,originalBounds,paddedCropBounds} from './public/image-geometry.js';import {upstreamError} from './api-config.mjs';import {start} from './server.mjs';
import {validateImageSelection,runImageBatch} from './public/image-batch.js';
import {mergeProducts} from './public/product-merge.js';

test('batch selection accepts ten images and rejects oversized originals',()=>{
  validateImageSelection(Array.from({length:10},(_,i)=>({name:`${i}.jpg`,size:7*1024*1024})));
  assert.throws(()=>validateImageSelection(Array(11).fill({size:1})),/10/);
  assert.throws(()=>validateImageSelection([{name:'large.png',size:7*1024*1024+1}]),/large.png/);
});
test('multi-original batches keep successful results and first prices without duplicate cards',async()=>{
  const outputs=[],progress=[];
  const result=await runImageBatch([{name:'a'},{name:'b'},{name:'c'}],{
    onProgress:(i,n)=>progress.push([i,n]),
    process:async(source,i)=>{if(i===1)throw Error('test failure');return {products:[{name:'徽章',type:'单领',unit:'件',price:20,imageUrl:source.name},{name:'立牌',type:'单领',price:i===0?45:50,imageUrl:source.name}]};},
    onResult:r=>mergeProducts(outputs,r.products,()=>String(outputs.length))
  });
  assert.equal(result.completed,2);assert.equal(result.added,2);assert.equal(result.duplicates,2);assert.equal(result.failures[0].name,'b');
  assert.deepEqual(outputs.map(p=>p.imageUrl),['a','a']);assert.equal(outputs[1].price,45);assert.deepEqual(progress,[[1,3],[2,3],[3,3]]);
});
test('repeat imports supplement text-only images without overwriting first content or IDs',()=>{
  const products=[];let id=0;const key=()=>String(++id);
  mergeProducts(products,[{name:'徽章-阿米娅',type:'单领',textOnly:true,imageUrl:'',price:20,unit:'件'}],key);
  products[0].name='我修改过的名称';products[0].price=25;
  const result=mergeProducts(products,[{name:'徽章-阿米娅',type:'单领',price:30,unit:'套',imageUrl:'/media/new.png'},{name:'徽章-阿米娅',type:'单领',price:40,imageUrl:'/media/later.png'}],key);
  assert.deepEqual(result,{added:0,updated:1,duplicates:1,adjusted:0});assert.equal(products.length,1);assert.equal(products[0].id,'1');assert.equal(products[0].price,25);assert.equal(products[0].unit,'件');assert.equal(products[0].name,'我修改过的名称');assert.equal(products[0].imageUrl,'/media/new.png');assert.equal(products[0].textOnly,false);
  mergeProducts(products,[{name:'徽章-阿米娅B款',type:'单领',price:20},{name:'通行证-阿米娅',type:'通行证',boxId:'1.0'},{name:'通行证-阿米娅',type:'通行证',boxId:'2.0'}],key);assert.equal(products.length,4);
});
test('repeat import fills only previously unrecognized adjustments and preserves manual zero',()=>{
  const products=[{id:'a',name:'通行证-阿米娅',type:'通行证',adjustment:0},{id:'b',name:'通行证-能天使',type:'通行证',adjustment:0,adjustmentSource:'manual'}];
  const observations=products.map(p=>({...p,adjustment:40,adjustmentSource:'recognized',adjustmentText:'+40'}));
  const result=mergeProducts(products,observations,()=>{throw Error('must not add duplicates');});assert.equal(result.adjusted,1);assert.equal(result.duplicates,1);assert.equal(products[0].adjustment,40);assert.equal(products[1].adjustment,0);
  mergeProducts(products,[{...observations[0],adjustment:50,adjustmentText:'+50'}],()=>{});assert.equal(products[0].adjustment,40);
});
test('changing campaign during batch prevents results being appended to another campaign',async()=>{
  let current=true,appended=0;
  await assert.rejects(runImageBatch([{name:'a'}],{isCurrent:()=>current,process:async()=>{current=false;return {products:[]};},onResult:()=>appended++}),/更换/);
  assert.equal(appended,0);
});
test('15000px product poster is fully covered by overlapping model-safe slices',()=>{
  const width=1452,height=15000,tiles=planImageTiles(width,height);assert.equal(tiles.length,14);assert.equal(tiles[0].y,0);assert.equal(tiles.at(-1).y+tiles.at(-1).height,height);
  for(let i=0;i<tiles.length;i++){const t=tiles[i];assert.ok(t.width<=2048&&t.height<=2048);assert.ok(t.x+t.width<=width&&t.y+t.height<=height);if(i)assert.ok(t.y<tiles[i-1].y+tiles[i-1].height);}
  assert.equal(planImageTiles(15000,1452).length,14);assert.equal(planImageTiles(1500,6997).length,6);assert.equal(planImageTiles(1000,1000).length,1);
  assert.throws(()=>planImageTiles(100000,100000));
});
test('products and labels spanning former seams have a complete view in another tile',()=>{
  for(const horizontal of [false,true]){
    const tiles=planImageTiles(horizontal?15000:1452,horizontal?1452:15000);
    for(let start=0;start<=15000-1024;start++)assert.ok(tiles.some(t=>{
      const edge=horizontal?t.x:t.y,size=horizontal?t.width:t.height;
      return edge<=start&&edge+size>=start+1024;
    }),`missing complete view at ${start}`);
  }
});
test('crop padding preserves names and outlines across slice edges, clamped to original image',()=>{
  const mapped=originalBounds({x:.2,y:.8,width:.4,height:.2},{x:0,y:0,width:1,height:2048/15000});
  const padded=paddedCropBounds(mapped,1452,15000);
  assert.ok(padded.y+padded.height>2048/15000);assert.ok(padded.x<mapped.x);assert.ok(padded.y<mapped.y);
  const edge=paddedCropBounds({x:0,y:.8,width:1,height:.2},1452,15000);
  assert.equal(edge.x,0);assert.equal(edge.width,1);assert.equal(edge.y+edge.height,1);
  assert.equal(paddedCropBounds({x:0,y:0,width:2,height:1},100,100),null);
});
test('tile crop locations convert back to the original poster',()=>{
  assert.deepEqual(originalBounds({x:.1,y:.2,width:.5,height:.4},{x:0,y:.5,width:1,height:.25}),{x:.1,y:.55,width:.5,height:.1});
  assert.equal(originalBounds({x:0,y:0,width:2,height:1},{x:0,y:0,width:1,height:1}),null);assert.equal(originalBounds(null,{}),null);
});
test('upstream errors include the real rejection reason but redact credentials and images',async()=>{
  const message=await upstreamError(Response.json({error:{message:'image height 15000 exceeds 8192; Bearer private-value sk-test-secret data:image/png;base64,YQ=='}},{status:400}),'private-value');
  assert.match(message,/15000 exceeds 8192/);assert.equal(message.includes('private-value'),false);assert.equal(message.includes('sk-test-secret'),false);assert.equal(message.includes('base64,YQ'),false);
});
test('multi-image inference maps crops and stores sanitized failures without replacing successful results',async()=>{
  let fail=false,captured;
  const upstreamFetch=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[{id:'deepseek-flash',input_modalities:['text','image']}]});
    captured=JSON.parse(options.body);
    if(fail)return Response.json({error:{message:'image height exceeds 8192, test-private-key'}},{status:400});
    return Response.json({choices:[{message:{content:JSON.stringify({products:[{name:'徽章-阿米娅',type:'单领',price:20,imageIndex:1,cropBounds:{x:.1,y:.2,width:.5,height:.4}}],boxIds:[],questions:[]})}}]});
  };
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-image-test-')),s=await start({port:0,dataDir:dir,upstreamFetch});
  const post=async(route,b)=>{const r=await fetch(s.url+'/api/'+route,{method:'POST',headers:{origin:s.url,'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json()};};
  try{
    await post('settings',{provider:'deepseek',model:'deepseek-flash',apiKey:'test-private-key'});
    const c=(await post('campaign',{name:'长图'})).body;
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    const uploaded=(await post('upload',{image:png})).body.url;
    const body={campaignId:c.id,mode:'image',imageUrl:uploaded,images:[{imageUrl:uploaded,region:{x:0,y:0,width:1,height:.6}},{imageUrl:uploaded,region:{x:0,y:.5,width:1,height:.25}}]};
    const result=await post('recognize',body);assert.equal(result.status,200);assert.equal(captured.messages[1].content.filter(p=>p.type==='image_url').length,2);assert.equal(result.body.data.products[0].cropBounds.y,.55);
    const textResult=await post('recognize',{...body,textOnly:true});assert.equal(textResult.status,200);assert.match(captured.messages[1].content[0].text,/仅识别文字模式/);assert.equal(textResult.body.data.products[0].textOnly,true);assert.equal(textResult.body.data.products[0].imageUrl,'');assert.equal(textResult.body.data.products[0].cropBounds,null);
    fail=true;const rejected=await post('recognize',body);assert.match(rejected.body.error,/8192/);assert.equal(rejected.body.error.includes('test-private-key'),false);
    const state=await (await fetch(s.url+'/api/state')).json();assert.equal(state.campaigns[0].lastRecognition.imageCount,2);assert.equal(state.campaigns[0].lastRecognitionFailure.status,400);assert.equal(JSON.stringify(state).includes('test-private-key'),false);
    assert.equal((await post('recognize',{...body,images:[{imageUrl:uploaded,region:{x:0,y:0,width:2,height:1}}]})).status,400);
  }finally{await new Promise(r=>s.server.close(r));await fs.rm(dir,{recursive:true});}
});
