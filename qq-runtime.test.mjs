import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import runtime from './qq-runtime.cjs';import {start} from './server.mjs';

test('selected Node runtime validates required files, survives restart and never falls back after being removed',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-runtime-')),dataDir=path.join(dir,'profile'),appRoot=path.join(dir,'app'),root=path.join(dir,'download','NapCat.Shell.Windows.Node');
 try{
  await fs.mkdir(path.join(root,'napcat'),{recursive:true});
  for(const file of ['node.exe','index.js','wrapper.node'])await fs.writeFile(path.join(root,file),'synthetic placeholder; never executed');
  assert.equal(runtime.findNodeRuntime(path.dirname(root)),null);
  await fs.writeFile(path.join(root,'napcat','napcat.mjs'),'synthetic placeholder; never executed');
  const found=runtime.findNodeRuntime(path.dirname(root));assert.equal(found.root,root);assert.equal(found.configRoot,path.join(root,'napcat'));
  runtime.saveRuntimePath(dataDir,found);assert.equal(runtime.runtimePaths(appRoot,dataDir).root,root);assert.equal(runtime.runtimePaths(appRoot,dataDir).source,'selected');
  const selected=await fs.readFile(path.join(dataDir,'napcat-runtime.json'),'utf8');assert.deepEqual(JSON.parse(selected),{root});
  await fs.unlink(path.join(root,'wrapper.node'));assert.equal(runtime.findNodeRuntime(root),null);assert.throws(()=>runtime.runtimePaths(appRoot,dataDir),/重新选择位置/);
  const qq=path.join(dir,'old-qq');await fs.mkdir(qq);await fs.writeFile(path.join(qq,'QQ.exe'),'not a Node runtime');assert.equal(runtime.findNodeRuntime(qq),null);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('runtime APIs open only desktop download/selection actions and preserve cancellation and selection errors',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-runtime-api-'));let downloads=0,selections=0,connectedArgument,choice='cancel',chosen=false;
 const info=()=>({supported:true,available:chosen,root:chosen?'C:\\Synthetic NapCat':''});
 const app=await start({port:0,dataDir:dir,qqConnector:()=>({status:()=> '已连接',close(){},call:async()=>{throw Error('No QQ message or login operation expected');}}),desktopActions:{qqRuntimeInfo:info,async openNapcatDownload(){downloads++;},async selectQQRuntime(options){selections++;connectedArgument=options.connected;if(choice==='cancel')return {cancelled:true};if(choice==='invalid')throw Error('请选择完整解压的运行包');chosen=true;return {...info(),ok:true};}}});
 const post=async(route,body={})=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {code:r.status,data:await r.json()};};
 try{
  assert.equal((await(await fetch(app.url+'/api/qq-runtime')).json()).available,false);
  assert.equal((await post('qq-runtime-download')).code,200);assert.equal(downloads,1);
  assert.equal((await post('qq-runtime-select')).data.cancelled,true);assert.equal(connectedArgument,false);
  choice='invalid';assert.equal((await post('qq-runtime-select')).code,400);assert.equal((await(await fetch(app.url+'/api/qq-runtime')).json()).available,false);
  await post('qq-settings',{url:'ws://127.0.0.1:12345'});choice='valid';const selected=await post('qq-runtime-select');assert.equal(selected.code,200);assert.equal(selected.data.available,true);assert.equal(connectedArgument,true);assert.equal(selections,3);
  assert.equal((await fetch(app.url+'/runtime-picker.js')).status,200);
 }finally{await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
