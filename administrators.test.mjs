import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {administratorList,isAdministrator,updateAdministrator} from './administrators.mjs';
import {processQQEvent} from './qq-commands.mjs';import {start} from './server.mjs';
const post=async(app,route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {code:r.status,data:await r.json()};};
const state=async app=>(await (await fetch(app.url+'/api/state')).json());
const close=app=>app?new Promise(r=>app.server.close(r)):Promise.resolve();
const store={get:async()=>'',set:async()=>{}};

test('administrator list preserves legacy identity, uses an explicit empty list and rejects invalid, duplicate and stale changes',()=>{
 const db={qqAdmin:'123456'};assert.deepEqual(administratorList(db),['123456']);assert.equal(isAdministrator(db,'123456'),true);
 assert.deepEqual(updateAdministrator(db,{qqAdmin:'234567'}).qqAdmins,['123456','234567']);const before=structuredClone(db);
 for(const body of [{qqAdmin:'123456'},{qqAdmin:'bad'},{qqAdmin:'345678',action:'replace'},{qqAdmin:'345678',version:0}]){assert.throws(()=>updateAdministrator(db,body));assert.deepEqual(db,before);}
 assert.throws(()=>updateAdministrator(db,{qqAdmin:'345678'},{botQQ:'345678'}),/机器人QQ相同/);
 updateAdministrator(db,{qqAdmin:'123456',action:'remove',version:1});assert.equal(db.qqAdmin,'234567');assert.equal(isAdministrator(db,'123456'),false);
 updateAdministrator(db,{qqAdmin:'234567',action:'remove',version:2});assert.deepEqual(db.qqAdmins,[]);assert.equal(db.qqAdmin,'');assert.equal(isAdministrator({...db,qqAdmin:'123456'},'123456'),false);
 const empty=structuredClone(db);assert.throws(()=>updateAdministrator(db,{qqAdmin:'234567',action:'remove'}),/已被删除/);assert.deepEqual(db,empty);
});

test('every configured administrator sees export help and can export; removal immediately revokes the real sender',()=>{
 const db={qqAdmin:'123456',qqAdmins:['123456','234567'],campaigns:[{id:'c',name:'测试期次',groupId:'11111',products:[],records:[]}]};
 const say=(qq,text)=>({group_id:11111,user_id:qq,self_id:99999,message:[{type:'at',data:{qq:'99999'}},{type:'text',data:{text}}]});
 for(const qq of [123456,234567]){assert.match(processQQEvent(db,say(qq,'help')).reply,/导出指定期次肾表/);assert.equal(processQQEvent(db,say(qq,'肾表')).exportCampaignId,'c');}
 assert.throws(()=>processQQEvent(db,say(345678,'肾表')),/仅已配置的管理员/);
 updateAdministrator(db,{qqAdmin:'123456',action:'remove'});assert.doesNotMatch(processQQEvent(db,say(123456,'help')).reply,/导出指定期次肾表/);assert.throws(()=>processQQEvent(db,say(123456,'肾表')),/仅已配置的管理员/);assert.equal(processQQEvent(db,say(234567,'肾表')).exportCampaignId,'c');
 updateAdministrator(db,{qqAdmin:'234567',action:'remove'});assert.throws(()=>processQQEvent(db,say(234567,'肾表')),/仅已配置的管理员/);
});

test('administrator add/remove APIs retain old settings, persist all removals across restart and reject cross-origin or stale edits',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-admins-'));let app;
 const options={port:0,dataDir:dir,credentialStore:store,qqConnector:()=>({status:()=> '已连接',close(){},call:async()=>({user_id:654321})})};
 try{
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({qqAdmin:'123456',campaigns:[],settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:''}}));app=await start(options);assert.deepEqual((await state(app)).qqAdmins,['123456']);
  const added=await post(app,'qq-admin',{action:'add',qqAdmin:'234567',version:0});assert.equal(added.code,200);assert.deepEqual(added.data.qqAdmins,['123456','234567']);
  assert.equal((await post(app,'qq-admin',{action:'add',qqAdmin:'234567',version:1})).code,400);
  assert.equal((await post(app,'qq-admin',{action:'remove',qqAdmin:'123456',version:0})).code,400);
  const evil=await fetch(app.url+'/api/qq-admin',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:JSON.stringify({action:'remove',qqAdmin:'123456',version:1})});assert.equal(evil.status,403);
  await post(app,'qq-settings',{url:'ws://127.0.0.1:12345'});assert.equal((await post(app,'qq-admin',{qqAdmin:'654321',version:1})).code,400);
  await post(app,'qq-admin',{action:'remove',qqAdmin:'123456',version:1});await close(app);app=await start(options);assert.deepEqual((await state(app)).qqAdmins,['234567']);assert.equal((await state(app)).qqAdmin,'234567');
  await post(app,'qq-admin',{action:'remove',qqAdmin:'234567',version:2});await close(app);app=await start(options);assert.deepEqual((await state(app)).qqAdmins,[]);assert.equal((await state(app)).qqAdmin,'');
  await post(app,'qq-admin',{qqAdmin:'345678',version:3});assert.deepEqual((await state(app)).qqAdmins,['345678']);
 }finally{await close(app);await fs.rm(dir,{recursive:true,force:true});}
});

test('reopening onboarding adds or confirms an administrator without erasing other configured administrators',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-admin-guide-'));let app;const key='synthetic-administrator-api-key';
 try{
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({qqAdmins:['123456','234567'],qqAdmin:'123456',campaigns:[],settings:{provider:'custom',baseUrl:'https://example.test/v1',model:'vision'}}));
  app=await start({port:0,dataDir:dir,credentialStore:{get:async c=>c.provider==='custom'?key:'',set:async()=>{}},qqConnector:()=>({status:()=> '已连接',close(){},call:async a=>a==='get_login_info'?{user_id:654321}:{online:true}})});
  await post(app,'qq-settings',{url:'ws://127.0.0.1:12345'});
  assert.equal((await post(app,'onboarding-complete',{adminQQ:'123456',qq:'654321'})).code,200);assert.deepEqual((await state(app)).qqAdmins,['123456','234567']);
  assert.equal((await post(app,'onboarding-complete',{adminQQ:'345678',qq:'654321'})).code,200);assert.deepEqual((await state(app)).qqAdmins,['123456','234567','345678']);
 }finally{await close(app);await fs.rm(dir,{recursive:true,force:true});}
});
