import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGlossaryStore,defaultGlossaryEntries,explainTerm} from './glossary.mjs';
import {createBotRegistry,importedSkillInfo,importedRecognition} from './bots.mjs';
import {processQQEvent,canHandleQQEvent} from './qq-commands.mjs';
import {start} from './server.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),skill='---\nname: plush-bot\ndescription: 毛绒制品识别\n---\n# 毛绒技能\n测试专用识别规则PLUSH_RULE';
const event=text=>({group_id:11111,self_id:99999,user_id:12345,message:[{type:'at',data:{qq:'99999'}},{type:'text',data:{text}}]});
test('glossary commands require mention, work without campaign or CN, normalize aliases, and never write enrollments',()=>{
 const db={qqGroups:[{id:'11111'}],campaigns:[]},snapshot=JSON.stringify(db);
 assert.ok(defaultGlossaryEntries.length>=50);assert.match(processQQEvent(db,event('解释 捆')).reply,/带走/);assert.match(processQQEvent(db,event('解释 Ｋ１')).reply,/1件或1单位/);
 assert.deepEqual(defaultGlossaryEntries.find(e=>e.term==='均价').aliases,[]);
 assert.match(processQQEvent(db,event('解释')).reply,/用法/);assert.match(processQQEvent(db,event('解释 未收录词')).reply,/暂未收录/);assert.equal(processQQEvent(db,event('解释 捆')).readOnly,true);
 assert.match(processQQEvent(db,{...event('解释 捆'),message:'解释 捆'}).reply,/@/);assert.equal(canHandleQQEvent(db,{...event('解释 捆'),group_id:22222}),false);assert.equal(JSON.stringify(db),snapshot);
});
test('partial glossary edits preserve other entries and sources, persist across restarts and reject stale saves',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-glossary-'));
 try{let store=await createGlossaryStore(root,dir),before=await store.read();const original=before.entries.find(e=>e.term==='k1');
  const updated=await store.update({version:before.version,originalTerm:'捆',term:'捆',aliases:['k','捆绑','本群捆'],definition:'本群修改后的捆解释'});assert.equal(updated.entries.find(e=>e.term==='k1').definition,original.definition);assert.equal(updated.entries.find(e=>e.term==='捆').source,before.entries.find(e=>e.term==='捆').source);
  await assert.rejects(store.update({version:before.version,originalTerm:'捆',term:'捆',aliases:[],definition:'过期写入'}),/已更新/);
  store=await createGlossaryStore(root,dir);assert.match(await store.reply('本群捆'),/本群修改/);assert.equal((await store.read()).entries.length,before.entries.length);
  await assert.rejects(store.update({version:updated.version,term:'重复',aliases:['k1'],definition:'重复别名'}),/重复/);
  await assert.rejects(store.update({version:updated.version,term:'注入',aliases:[],definition:'## 隐藏标题'}),/检查/);
  assert.equal((await fs.readFile(store.file+'.bak','utf8')),before.markdown);
 }finally{await fs.rm(dir,{recursive:true});}
});
test('imported Markdown creates a persistent independent Bot with common skills and no executable installation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-skills-'));
 try{let registry=await createBotRegistry(root,dir);const bot=await registry.importSkill(skill,'毛绒Bot');assert.equal(registry.requireBot(bot.id).name,'毛绒Bot');assert.match(registry.skills.get(bot.id),/PLUSH_RULE/);assert.match(registry.skills.get(bot.id),/共用拼谷规则/);assert.ok(!registry.skills.get(bot.id).includes('# 粥谷 Bot'));
  await assert.rejects(registry.importSkill(skill,'毛绒Bot'),/同名/);assert.throws(()=>importedSkillInfo('x'.repeat(262145),'名称'),/256KB/);assert.throws(()=>importedSkillInfo(''),/非空/);
  registry=await createBotRegistry(root,dir);assert.equal(registry.requireBot(bot.id).id,bot.id);assert.match(registry.skills.get(bot.id),/PLUSH_RULE/);
  assert.equal(importedRecognition({products:[{name:'其他IP玩偶',type:'单领',price:30}]}).products[0].name,'其他IP玩偶');
 }finally{await fs.rm(dir,{recursive:true});}
});
test('settings API imports usable Bot, updates QQ explanations immediately and persists both across restart',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-skill-api-'));let prompt='';
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[],settings:{baseUrl:'https://example.test/v1',model:''},qqSettings:{url:'ws://127.0.0.1:12345'},qqGroups:[{id:'11111',name:'测试群'}]}));
 const upstreamFetch=async(url,opts)=>url.endsWith('/models')?Response.json({data:[{id:'vision-test',input_modalities:['text','image']}]}):(prompt=JSON.stringify(JSON.parse(opts.body).messages),Response.json({choices:[{message:{content:JSON.stringify({products:[{name:'其他IP玩偶',type:'单领',price:30}],questions:[]})}}]}));
 const options={port:0,dataDir:dir,upstreamFetch,qqConnector:()=>({close(){},status:()=> '已连接',call:async()=>{throw Error('本测试不应发送QQ消息');}})};let app=await start(options);
 const post=async(route,body)=>{const response=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {code:response.status,data:await response.json()};};
 try{const imported=await post('skill-import',{text:skill,name:'毛绒Bot'});assert.equal(imported.code,200);const bot=imported.data.bot;
  const campaign=await post('campaign',{name:'毛绒一期',groupId:'11111',botId:bot.id});assert.equal(campaign.code,200);
  const glossary=await(await fetch(app.url+'/api/glossary')).json();assert.equal((await post('glossary-entry',{version:glossary.version,originalTerm:'k1',term:'k1',aliases:['捆1'],definition:'本群约定的k1解释'})).code,200);
  assert.match((await post('qq-event',event('解释 k1'))).data.reply,/本群约定/);
  assert.equal((await post('settings',{provider:'custom',baseUrl:'https://example.test/v1',model:'vision-test',apiKey:'synthetic-test-key'})).code,200);
  const recognized=await post('recognize',{campaignId:campaign.data.id,botId:bot.id,mode:'image',image:'data:image/png;base64,eA=='});assert.equal(recognized.code,200);assert.equal(recognized.data.data.products[0].name,'其他IP玩偶');assert.match(prompt,/PLUSH_RULE/);assert.ok(!prompt.includes('可查老盒号'));
  await new Promise(r=>app.server.close(r));app=await start(options);const state=await(await fetch(app.url+'/api/state')).json();assert.ok(state.bots.some(b=>b.id===bot.id));assert.equal(state.campaigns[0].botId,bot.id);assert.match((await post('qq-event',event('解释 k1'))).data.reply,/本群约定/);
  assert.equal((await fetch(app.url+'/api/glossary-file')).status,200);
 }finally{await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true});}
});
