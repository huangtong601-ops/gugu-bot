import {test} from 'node:test';import assert from 'node:assert/strict';
import {processQQEvent,canHandleQQEvent,messageText,QQ_COMMANDS} from './qq-commands.mjs';
import {defaultCategories,memberName} from './workflow.mjs';
const at=(qq='99999')=>({type:'at',data:{qq}});
const text=t=>({type:'text',data:{text:t}});
test('help aliases require the actual bot mention and remain read-only with enrollment enabled',()=>{
 const db={qqGroups:[{id:'11111'}],qqEnrollmentEnabled:true,campaigns:[],members:{}};
 const before=JSON.stringify(db),say=t=>({group_id:11111,user_id:12345,self_id:99999,message:[at(),text(t)]});
 const options={usageReport:()=>{throw Error('help must not query API usage');}};
 for(const alias of ['help','HELP','ｈｅｌｐ','帮助','指令','命令列表','帮助！']){
  const result=processQQEvent(db,say(alias),options);
  assert.equal(result.readOnly,true);assert.match(result.reply,/可用指令/);assert.match(result.reply,/查询花费/);
 }
 assert.equal(processQQEvent(db,{...say('help'),message:'[CQ:at,qq=99999] help'}).readOnly,true);
 for(const message of [[text('help')],[at('88888'),text('help')]])assert.match(processQQEvent(db,{...say('help'),message}).reply,/请先用 @/);
 assert.equal(processQQEvent(db,{...say('help'),message:[text('help me')]}).ignored,true);
 assert.equal(JSON.stringify(db),before);
});
test('help reflects admin, enrollment and private-chat availability without exposing other group data',()=>{
 const db={qqAdmin:'12345',campaigns:[{name:'别群私有期次',groupId:'22222'}]};
 const say=qq=>({group_id:11111,user_id:qq,self_id:99999,message:[at(),text('help')]});
 const regular=processQQEvent(db,say(54321)).reply;
 for(const c of Object.values(QQ_COMMANDS).filter(c=>!c.admin&&!c.enrollment))for(const line of c.lines||[c.usage])assert.ok(regular.includes(line));
 assert.doesNotMatch(regular,/导出指定期次肾表|群内直接录入排表|别群私有期次|22222|12345/);
 assert.match(regular,/@排表未开启/);assert.match(regular,/不用 @/);
 assert.match(processQQEvent(db,say(12345)).reply,/肾表：导出指定期次肾表/);
 db.qqEnrollmentEnabled=true;assert.match(processQQEvent(db,say(54321)).reply,/排谷 制品名 数量：群内直接录入排表/);
 delete db.qqAdmin;assert.doesNotMatch(processQQEvent(db,say(12345)).reply,/导出指定期次肾表/);
 const privateHelp=processQQEvent(db,{user_id:12345,message:[text('help')]});
 assert.equal(privateHelp.readOnly,true);assert.match(privateHelp.reply,/私聊可用指令/);assert.match(privateHelp.reply,/cn 你的CN/);assert.doesNotMatch(privateHelp.reply,/查询排量|查询花费|肾表|排谷/);
 assert.equal(canHandleQQEvent({qqGroups:[{id:'11111',enabled:false}]},say(12345)),false);
 assert.equal(canHandleQQEvent({qqGroups:[{id:'22222'}]},say(12345)),false);
});
test('server help works without campaign binding and rejects help from disabled or unmanaged groups',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{start}=await import('./server.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-help-'));let app;
 try{
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[],qqGroups:[{id:'11111',enabled:true},{id:'22222',enabled:false}],settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:''}}));
  app=await start({port:0,dataDir:dir,credentialStore:{get:async()=>''},upstreamFetch:async()=>{throw Error('help must not call the model');}});
  const workspaceBefore=await fs.readFile(path.join(dir,'workspace.json'),'utf8');
  const post=group_id=>fetch(app.url+'/api/qq-event',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({group_id,user_id:12345,self_id:99999,message:[at(),text('help')]})});
  const ok=await post(11111);assert.equal(ok.status,200);const result=await ok.json();assert.equal(result.readOnly,true);assert.match(result.reply,/可用指令/);
  for(const group of [22222,33333])assert.equal((await post(group)).status,400);
  assert.equal(await fs.readFile(path.join(dir,'workspace.json'),'utf8'),workspaceBefore);
  const ledger=JSON.parse(await fs.readFile(path.join(dir,'usage-ledger.json'),'utf8'));assert.equal(ledger.requests.length,0);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
test('CN accepts full-width input, CQ-coded strings and private chat',()=>{
 const db={campaigns:[]};
 assert.match(processQQEvent(db,{group_id:1,user_id:12345,self_id:99999,message:[at(),text('ｃｎ　小满')]}).reply,/已录入/);assert.equal(memberName(db,'12345','1'),'小满');
 assert.match(processQQEvent(db,{group_id:2,user_id:54321,self_id:99999,message:'[CQ:at,qq=99999] cn：阿澈'}).reply,/已录入/);assert.equal(memberName(db,'54321','2'),'阿澈');
 assert.match(processQQEvent(db,{user_id:77777,message:[text('cn 阿岚')]}).reply,/已录入/);assert.equal(memberName(db,'77777',''),'阿岚');
});
test('unaddressed commands get a hint instead of silence',()=>{
 const db={campaigns:[]};
 assert.match(processQQEvent(db,{group_id:1,message:[text('cn 示例用户I')]}).reply,/@/);
 assert.match(processQQEvent(db,{group_id:1,message:[text('查询排量 洁哥')]}).reply,/@/);
 assert.equal(processQQEvent(db,{group_id:1,message:[text('今天好热')]}).ignored,true);
});
test('malformed CN explains the format while duplicate CN still reports the conflict',()=>{
 const db={campaigns:[]},base={group_id:1,self_id:9,user_id:100001,message:[at('9'),text('cn小满')]};
 assert.match(processQQEvent(db,base).reply,/cn 你的CN/);
 processQQEvent(db,{group_id:1,self_id:9,user_id:100001,message:[at('9'),text('cn 小满')]});
 assert.throws(()=>processQQEvent(db,{group_id:1,self_id:9,user_id:100002,message:[at('9'),text('cn 小满')]}),/已绑定/);
});
test('CN binding is accepted outside the confined test group while queries are not',()=>{
 const db={qqTestGroup:{id:'90000003'},albums:[],campaigns:[]},bot='90000002';
 assert.equal(canHandleQQEvent(db,{group_id:90000004,self_id:bot,message:[at(bot),text('cn 示例用户J')]}),true);
 assert.equal(canHandleQQEvent(db,{group_id:90000004,self_id:bot,message:[at(bot),text('查询排量 洁哥')]}),false);
 assert.equal(canHandleQQEvent(db,{group_id:90000003}),true);
});
test('private chat explains that only CN is supported there',()=>{
 assert.throws(()=>processQQEvent({campaigns:[]},{user_id:5,self_id:9,message:[text('查询排量 洁哥')]}),/私聊仅支持/);
});
test('messageText normalizes full-width text and strips zero-width characters',()=>{
 assert.equal(messageText([text('  ｃｎ　小满\u200b ')]),'cn 小满');
});

test('managed groups are isolated from each other',()=>{
 const campaign=(id,name,groupId)=>({id,name,groupId,categories:defaultCategories(),products:[],records:[]});
 const db={qqGroups:[{id:'111111',name:'A'},{id:'222222',name:'B'}],albums:[],members:{12345:{cn:'示例用户I'}},campaigns:[campaign('a','团A','111111'),campaign('b','团B','222222')]};
 assert.equal(canHandleQQEvent(db,{group_id:111111}),true);
 assert.equal(canHandleQQEvent(db,{group_id:222222}),true);
 assert.equal(canHandleQQEvent(db,{group_id:333333}),false);
 const say=text=>({group_id:111111,user_id:12345,self_id:9,message:[{type:'at',data:{qq:9}},{type:'text',data:{text}}]});
 assert.throws(()=>processQQEvent(db,say('团B 查询排量 通行证')),/不属于本群/);
 assert.match(processQQEvent(db,say('团A 我的排表')).reply,/没有排表/);
});

test('disabled managed groups cannot query even when a legacy test-group or album binding exists',()=>{
 const db={qqGroups:[{id:'11111',enabled:false}],qqTestGroup:{id:'11111'},albums:[{groupId:'11111'}]};
 assert.equal(canHandleQQEvent(db,{group_id:11111,self_id:9,message:[at('9'),text('查询排量 通行证')]}),false);
});

test('mention enrollments default off and legacy comment events cannot bypass album scope',()=>{
 const c={id:'c',name:'示例期次',groupId:'11111',categories:defaultCategories(),products:[{id:'p',name:'通行证-予愿安洁丽娜',type:'通行证',unit:'对',price:20}],records:[],commentEvents:[]};
 const db={campaigns:[c],albums:[{groupId:'11111',albumId:'album',campaignId:'c'}],members:{12345:{cn:'示例用户I'}}};
 const before=JSON.stringify(db);
 for(const content of ['洁哥通行证1','报名 洁哥通行证1','排表 洁哥通行证1','示例期次 洁哥通行证1']){
  const result=processQQEvent(db,{group_id:11111,user_id:12345,self_id:99999,message:[at(),text(content)]});
  assert.match(result.reply,/相册/);assert.equal(JSON.stringify(db),before);
 }
 const legacy=processQQEvent(db,{kind:'album_comment',group_id:11111,user_id:12345,album_id:'album',comment_id:'legacy',at:'2026-10-24T00:00:00Z',text:'洁哥通行证1'});
 assert.equal(legacy.ignored,true);assert.equal(JSON.stringify(db),before);
 assert.match(processQQEvent(db,{group_id:11111,user_id:12345,self_id:99999,message:[at(),text('查询排量 通行证')]}).reply,/0对/);
});

test('enabled mentions enroll by sender, message identity and time; toggling off keeps queries and prevents new rows',()=>{
 const c={id:'c',name:'示例期次',groupId:'11111',categories:defaultCategories(),products:[{id:'p',name:'通行证-予愿安洁丽娜',character:'予愿安洁丽娜',aliases:['洁哥'],type:'通行证',unit:'对',price:20}],records:[],commentEvents:[]};
 const db={qqEnrollmentEnabled:true,campaigns:[c],members:{12345:{cn:'示例用户I'}}};
 const say=(message_id,time,t)=>({group_id:11111,user_id:12345,self_id:99999,message_id,time,message:[at(),text(t)]});
 assert.match(processQQEvent(db,say(2,200,'洁哥通行证2')).reply,/已录入/);
 processQQEvent(db,say(1,100,'洁哥通行证1'));assert.deepEqual(c.records.map(r=>r.quantity),[1,2]);assert.ok(c.records.every(r=>r.qq==='12345'&&r.member==='示例用户I'));
 processQQEvent(db,say(2,200,'洁哥通行证2'));assert.equal(c.records.length,2);
 assert.throws(()=>processQQEvent(db,{...say(3,300,'洁哥通行证1'),message_id:undefined}),/编号或时间/);
 assert.equal(processQQEvent(db,{...say(4,400,'洁哥通行证1'),message:[text('洁哥通行证1')]}).ignored,true);
 db.qqEnrollmentEnabled=false;assert.match(processQQEvent(db,say(5,500,'洁哥通行证3')).reply,/未开启/);assert.equal(c.records.length,2);
 assert.match(processQQEvent(db,say(6,600,'查询排量 通行证')).reply,/3对/);
});

test('mention enrollment setting validates boolean, persists and defaults off for new workspaces',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{start}=await import('./server.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-enrollment-toggle-'));let app;
 try{
  app=await start({port:0,dataDir:dir});
  const state=async()=> (await fetch(app.url+'/api/state')).json();
  const post=enabled=>fetch(app.url+'/api/qq-enrollment-settings',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({enabled})});
  assert.equal((await state()).qqEnrollmentEnabled,false);assert.equal((await post('true')).status,400);assert.equal((await state()).qqEnrollmentEnabled,false);
  assert.equal((await post(true)).status,200);assert.equal((await state()).qqEnrollmentEnabled,true);
  await new Promise(r=>app.server.close(r));app=await start({port:0,dataDir:dir});assert.equal((await state()).qqEnrollmentEnabled,true);
  await post(false);await new Promise(r=>app.server.close(r));app=await start({port:0,dataDir:dir});assert.equal((await state()).qqEnrollmentEnabled,false);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
