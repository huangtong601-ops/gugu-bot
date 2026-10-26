import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {start} from './server.mjs';
import {firstSetupStep,validateSetup} from './public/setup-state.js';

test('first setup resumes at missing API or QQ step and does not interrupt existing or completed users',()=>{
 assert.equal(firstSetupStep({}),0);
 assert.equal(firstSetupStep({hasKey:true,settings:{model:''}}),0);
 assert.equal(firstSetupStep({hasKey:true,settings:{model:'vision-test'}}),1);
 assert.equal(firstSetupStep({hasKey:true,settings:{model:'vision-test'},qqSettings:{url:'ws://127.0.0.1:3019'},qq:{connected:false}}),null);
 assert.equal(firstSetupStep({hasKey:true,settings:{model:'vision-test'},qqSettings:{url:'ws://127.0.0.1:3019'},onboarding:{startedAt:'2026-10-24T00:00:00Z'}}),1);
 assert.equal(firstSetupStep({onboarding:{completedAt:'2026-10-24T00:00:00Z'}}),null);
});
test('setup refuses offline QQ, wrong bot identity and invalid administrator before granting access',()=>{
 const valid={hasKey:true,settings:{model:'vision-test'},adminQQ:'123456',expectedQQ:'654321',identity:{user_id:654321},online:true,connected:true};
 assert.deepEqual(validateSetup(valid),{admin:'123456',qq:'654321'});
 assert.throws(()=>validateSetup({...valid,hasKey:false}),/API/);
 assert.throws(()=>validateSetup({...valid,adminQQ:'abc'}),/管理员QQ/);
 assert.throws(()=>validateSetup({...valid,online:false}),/登录并连接/);
 assert.throws(()=>validateSetup({...valid,expectedQQ:'999999'}),/不一致/);
 assert.throws(()=>validateSetup({...valid,adminQQ:'654321'}),/不能与机器人QQ相同/);
});
test('setup completion verifies live identity, persists administrator and completion, and keeps passwords and keys out of workspace',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-setup-'));let key='',online=true,app;
 const store={get:async config=>config.provider==='custom'?key:'',set:async(config,value)=>{if(config.provider==='custom')key=value;}};
 const options={port:0,dataDir:dir,credentialStore:store,qqConnector:()=>({status:()=> '已连接',close(){},async call(action){if(action==='get_login_info')return {user_id:654321};if(action==='get_status')return {online};throw Error('Unexpected QQ operation: '+action);}})};
 const post=async(route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {code:r.status,data:await r.json()};};
 const state=async()=>(await fetch(app.url+'/api/state')).json();
 try{
  app=await start(options);
  assert.equal(firstSetupStep(await state()),0);
  assert.equal((await post('onboarding-start',{})).code,200);
  assert.equal((await post('onboarding-complete',{adminQQ:'123456'})).code,400);
  await post('settings',{provider:'custom',baseUrl:'https://example.test/v1',model:'vision-test',apiKey:'synthetic-setup-key'});
  assert.equal(firstSetupStep(await state()),1);
  await post('qq-settings',{url:'ws://127.0.0.1:12345'});
  assert.equal(firstSetupStep(await state()),1);
  const before=await fs.readFile(path.join(dir,'workspace.json'),'utf8');
  online=false;assert.equal((await post('onboarding-complete',{adminQQ:'123456',qq:'654321'})).code,400);
  online=true;assert.equal((await post('onboarding-complete',{adminQQ:'123456',qq:'999999'})).code,400);
  assert.equal((await post('onboarding-complete',{adminQQ:'bad',qq:'654321'})).code,400);
  assert.equal(await fs.readFile(path.join(dir,'workspace.json'),'utf8'),before);
  const done=await post('onboarding-complete',{adminQQ:'123456',qq:'654321',password:'synthetic-not-to-store'});
  assert.equal(done.code,200);assert.equal(done.data.qq,'654321');
  const saved=await fs.readFile(path.join(dir,'workspace.json'),'utf8');assert.ok(!saved.includes('synthetic-setup-key'));assert.ok(!saved.includes('synthetic-not-to-store'));
  await new Promise(r=>app.server.close(r));app=await start(options);
  const restored=await state();assert.equal(restored.qqAdmin,'123456');assert.ok(restored.onboarding.completedAt);assert.equal(firstSetupStep(restored),null);assert.deepEqual(restored.campaigns,[]);
  for(const file of ['/setup-guide.js','/setup-state.js'])assert.equal((await fetch(app.url+file)).status,200);
 }finally{if(app)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
