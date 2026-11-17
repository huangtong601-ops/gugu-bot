import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseFeedResponse,readAlbumFeeds,readGroupAlbums,decodeProto} from './album-reader.mjs';
import {applyAlbumComments,scopeFromCaption,createAlbumPoller,retryPending,dismissPending,deletePendingItem,scopedProducts,deriveBatchScopes,commentProducts,remindMissingCN,albumScope,reconcileAlbumPhotos} from './album-sync.mjs';
import {defaultCategories} from './workflow.mjs';import {processQQEvent} from './qq-commands.mjs';
const v=n=>{n=BigInt(n);const a=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;a.push(b);}while(n);return Buffer.from(a);};
const u=(f,n)=>Buffer.concat([v(f*8),v(n)]),b=(f,s)=>{s=Buffer.isBuffer(s)?s:Buffer.from(String(s));return Buffer.concat([v(f*8+2),v(s.length),s]);};
const msg=(f,...parts)=>b(f,Buffer.concat(parts));
function response({id='10',text='洁哥3 克莱门莎1 珊比2',caption='',total=1,more=false,cursor='',commentPage=false}={}){
 const rows=[u(1,total),msg(2,b(1,id),msg(2,b(13,'12345')),msg(3,u(1,0),b(2,text)),u(4,1792756602))];
 const body=commentPage?msg(2,...rows):msg(2,msg(1,msg(1,b(4,'feed')),msg(4,msg(1,u(1,0),b(2,caption))),msg(7,...rows)));
 return msg(4,body,u(3,more?1:0),b(4,cursor)).toString('hex');
}
const info={groupId:'11111',albumId:'album',photoIds:['photo']};
test('album list reads all pages, accepts real and documented name fields, and preserves IDs including duplicate names',async()=>{
 const calls=[];const albums=await readGroupAlbums(async(action,p)=>{calls.push([action,p]);return p.attach_info?{album_list:[{album_id:'id-b',album_name:'同名相册',upload_number:'2'}],has_more:false}:{album_list:[{album_id:'V648abc',name:'同名相册',upload_number:'6'}],has_more:true,attach_info:'next'};},'11111');
 assert.deepEqual(albums,[{id:'V648abc',name:'同名相册',photoCount:6},{id:'id-b',name:'同名相册',photoCount:2}]);assert.equal(calls[1][1].attach_info,'next');assert.equal(calls[0][1].group_id,'11111');
 assert.deepEqual(await readGroupAlbums(async()=>({album_list:[],has_more:false}),'11111'),[]);
 await assert.rejects(readGroupAlbums(async()=>({album_list:[],has_more:true,attach_info:'same'}),'11111'),/分页/);
 await assert.rejects(readGroupAlbums(async()=>({result:1,errMs:'群无权限'}),'11111'),/群无权限/);
 await assert.rejects(readGroupAlbums(async()=>({albums:[]}),'11111'),/有效/);
 await assert.rejects(readGroupAlbums(async()=>{throw Error('不应调用');},''),/选择/);
});
const campaign=()=>({id:'c',categories:defaultCategories(),records:[],products:[{id:'a',name:'通行证-予愿安洁莉娜',type:'通行证',boxId:'55.0',price:40},{id:'b',name:'通行证-克莱门莎',type:'通行证',boxId:'55.0',price:30},{id:'d',name:'通行证-珊比',type:'通行证',boxId:'55.0',price:25},{id:'e',name:'角色亚克力立牌-克莱门莎',type:'单领',price:50}]});

test('missing CN reminders mention the real sender before photo scope is known and survive restart without duplicates',async()=>{
 const db={campaigns:[campaign()],qqEnrollmentEnabled:false},binding={groupId:'11111',albumId:'album',campaignId:'c'};
 const first=parseFeedResponse(response({text:'[CQ:at,qq=all] 洁哥1'}),info).comments[0],second={...first,id:first.id+'-second'};
 const sent=[],snapshots=[];const options={send:async p=>{assert.ok(snapshots.length);sent.push(p);},persist:async()=>snapshots.push(JSON.stringify(binding)),now:()=>1792807200000};
 const stats=await remindMissingCN(db,binding,{comments:[first,second]},options);
 assert.deepEqual(stats,{notified:1,failed:0});assert.equal(sent.length,1);assert.equal(sent[0].group_id,11111);
 assert.deepEqual(sent[0].message[0],{type:'at',data:{qq:'12345'}});assert.equal(sent[0].message.length,2);assert.match(sent[0].message[1].data.text,/cn 你的CN/);assert.doesNotMatch(JSON.stringify(sent),/"qq":"all"/);
 assert.equal(binding.cnReminders.length,2);assert.ok(binding.cnReminders.every(n=>n.sentAt));assert.equal(db.campaigns[0].records.length,0);
 const restored=JSON.parse(JSON.stringify(binding));assert.equal((await remindMissingCN(db,restored,{comments:[first,second]},options)).notified,0);assert.equal(sent.length,1);
 const newer={...first,id:first.id+'-new'};assert.equal((await remindMissingCN(db,restored,{comments:[first,newer]},options)).notified,1);
});

test('CN notices honor group bindings and global fallback, skip commands and processed comments, and reject forged origins',async()=>{
 const db={campaigns:[{...campaign(),groupId:'11111'}],members:{22222:{cn:'全局CN'}},groupMembers:{'22222':{33333:{cn:'仅别群CN'}}}},binding={groupId:'11111',albumId:'album',campaignId:'c'};
 const base=parseFeedResponse(response(),info).comments[0],comment=(qq,text,id)=>({...base,qq,text,id});
 db.campaigns[0].commentEvents=[{id:'processed'}];const sent=[];
 const comments=[comment('22222','洁哥1','global'),comment('33333','洁哥1','other-group-cn'),comment('12345','help','help'),comment('12345','帮助','help2'),comment('12345','查询排量','query'),comment('12345','cn 示例用户O','cn'),comment('12345','  ','empty'),comment('12345','洁哥1','processed'),{...comment('12345','洁哥1','foreign-group'),groupId:'22222'},{...comment('12345','洁哥1','foreign-album'),albumId:'other'},comment('all','洁哥1','invalid-qq')];
 const options={send:async p=>sent.push(p),persist:async()=>{}};
 assert.equal((await remindMissingCN(db,binding,{comments},options)).notified,1);assert.deepEqual(sent.map(p=>p.message[0].data.qq),['33333']);
 assert.equal((await remindMissingCN(db,{...binding,groupId:'22222'},{comments},options)).notified,0);
 assert.equal((await remindMissingCN(db,binding,{comments:[comment('12345','洁哥1','disabled')]},{...options,allowed:()=>false})).notified,0);
 let enabled=true;assert.equal((await remindMissingCN(db,binding,{comments:[comment('12345','洁哥1','disabled-during-save')]},{send:async()=>{throw Error('must not send after disabling group');},persist:async()=>{enabled=false;},allowed:()=>enabled})).notified,0);
 assert.equal((await remindMissingCN(db,binding,{comments:[comment('12345','洁哥1','cn-during-save')]},{send:async()=>{throw Error('must not send after CN was registered');},persist:async()=>{db.members[12345]={cn:'刚登记'};}})).notified,0);
});

test('failed CN notices back off, persist bounded retries, and never persist gateway error secrets',async()=>{
 const db={campaigns:[campaign()]},binding={groupId:'11111',albumId:'album',campaignId:'c'},result={comments:parseFeedResponse(response(),info).comments};let time=1792807200000,calls=0;
 const options={send:async()=>{calls++;throw Error('synthetic-private-gateway-token');},persist:async()=>{},now:()=>time};
 assert.equal((await remindMissingCN(db,binding,result,options)).failed,1);assert.equal(binding.cnReminders[0].sentAt,undefined);
 await remindMissingCN(db,binding,result,options);assert.equal(calls,1);
 time+=30000;await remindMissingCN(db,binding,result,options);assert.equal(calls,2);
 time+=60000;await remindMissingCN(db,binding,result,options);assert.equal(calls,3);
 time+=999999;await remindMissingCN(db,binding,result,options);assert.equal(calls,3);assert.doesNotMatch(JSON.stringify(binding),/synthetic-private/);
 const newComment={...result.comments[0],id:'new-comment'};
 assert.equal((await remindMissingCN(db,binding,{comments:[newComment]},{...options,send:async()=>{calls++;}})).notified,1);
 assert.ok(binding.cnReminders.every(n=>n.sentAt&&!n.error));
});

test('CN registration automatically allows the original pending comment to import at its original time',async()=>{
 const c={...campaign(),groupId:'11111'},db={campaigns:[c]},binding={groupId:'11111',albumId:'album',campaignId:'c',photoScopes:{photo:{categoryId:'通行证',boxId:'55.0'}}};
 const result={photos:[{id:'photo'}],comments:parseFeedResponse(response(),info).comments};let sent=0;
 const options={send:async()=>{sent++;},persist:async()=>{}};
 await remindMissingCN(db,binding,result,options);applyAlbumComments(db,binding,result);assert.equal(binding.pending.length,1);assert.equal(c.records.length,0);
 processQQEvent(db,{group_id:11111,user_id:12345,self_id:99999,message:[{type:'at',data:{qq:'99999'}},{type:'text',data:{text:'cn 示例用户O'}}]});
 await remindMissingCN(db,binding,result,options);assert.equal(applyAlbumComments(db,binding,result).imported,3);assert.equal(sent,1);assert.equal(binding.pending.length,0);assert.ok(c.records.every(r=>r.member==='示例用户O'&&r.sourceAt===result.comments[0].at));
});

test('server keeps closed-album comments pending until CN is bound, then enrolls once without sending reminders',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{start}=await import('./server.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-cn-pending-'));let app;const sent=[];
 const c={...campaign(),name:'模拟团',groupId:'11111',orderLifecycle:{status:'completed',version:1,completedAt:'2026-10-23T11:00:00Z'}};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:''},campaigns:[c],qqGroups:[{id:'11111'},{id:'22222',enabled:false}],albums:[{campaignId:'c',groupId:'11111',albumId:'album'},{campaignId:'c',groupId:'22222',albumId:'disabled'}],qqSettings:{url:'ws://127.0.0.1:12345'}}));
 const options={port:0,dataDir:dir,credentialStore:{get:async()=>''},upstreamFetch:async()=>{throw Error('background album reads must not call a model');},referenceFetch:async()=>new Response('invalid image',{status:404}),qqConnector:()=>({status:()=> '已连接',close(){},async call(action,params){
  if(action==='get_group_album_media_list'){assert.equal(String(params.group_id),'11111');return {media_list:[{batch_id:'batch',image:{lloc:'photo',default_url:{url:'https://qungz.photo.store.qq.com/synthetic.png'}}}]};}
  if(action==='send_packet')return response({text:'洁哥1',caption:'通行证55.0'});
  if(action==='send_group_msg'){sent.push(params);return {message_id:123};}
  throw Error('Unexpected QQ action');
 }})};
 const post=(route='qq-album-comments',body={})=>fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  app=await start(options);assert.equal((await post()).status,200);assert.equal(sent.length,0);
  const db=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(db.albums[0].pending.length,1);assert.equal(db.campaigns[0].records.length,0);assert.equal(db.albums[0].cnReminders,undefined);
  await new Promise(r=>app.server.close(r));app=await start(options);assert.equal((await post()).status,200);assert.equal(sent.length,0);
  const restored=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(restored.albums[0].pending.length,1);
  assert.equal((await post('cn',{campaignId:'c',groupId:'11111',qq:'12345',cn:'模拟甲'})).status,200);
  assert.equal((await post()).status,200);assert.equal((await post()).status,200);
  const enrolled=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));
  assert.equal(enrolled.campaigns[0].orderLifecycle.status,'completed');assert.equal(enrolled.campaigns[0].records.length,1);
  assert.equal(enrolled.albums[0].pending.length,0);assert.equal(sent.length,0);
  const ledger=JSON.parse(await fs.readFile(path.join(dir,'usage-ledger.json'),'utf8'));assert.equal(ledger.requests.length,0);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
test('feed reader retains real comment identity, timestamp, numeric text, upload caption and photo scope',()=>{const r=parseFeedResponse(response({text:'123',caption:'这张是通行证55.0调价图'}),info);assert.equal(r.comments[0].text,'123');assert.equal(r.comments[0].qq,'12345');assert.equal(r.comments[0].at,'2026-10-23T11:56:42.000Z');assert.deepEqual(r.comments[0].photoIds,['photo']);assert.equal(r.caption,'这张是通行证55.0调价图');assert.throws(()=>parseFeedResponse('00',info));});
test('upload caption keywords cover every default and custom category, including longer names',()=>{const c=campaign();c.categories.push({id:'x',name:'人事部简历',kind:'group'},{id:'y',name:'角色单领',kind:'single'});for(const [text,id]of [['这张是通行证55.0调价图','通行证'],['本期特典请在此排','特典'],['示例期次单领区','单领'],['人事部简历的说明','x'],['角色单领请看这里','y']])assert.equal(scopeFromCaption(text,c).categoryId,id);assert.equal(scopeFromCaption('通行证和特典',c),null);assert.equal(scopeFromCaption('通行证99.0',c),null);assert.equal(scopeFromCaption('无分类',c),null);});
test('photo context resolves roles without crossing category and duplicate reads survive restart',()=>{const c=campaign(),db={campaigns:[c],members:{12345:{cn:'示例用户O'}}},binding={campaignId:'c',photoScopes:{photo:{categoryId:'通行证',boxId:'55.0'}}};const result={photos:[{id:'photo'}],comments:parseFeedResponse(response(),info).comments};assert.equal(applyAlbumComments(db,binding,result).imported,3);assert.deepEqual(c.records.map(r=>[r.skuId,r.quantity]),[['a',3],['b',1],['d',2]]);assert.deepEqual(c.records[0].photoIds,['photo']);const restored=JSON.parse(JSON.stringify({db,binding}));assert.equal(applyAlbumComments(restored.db,restored.binding,result).duplicates,1);assert.equal(restored.db.campaigns[0].records.length,3);});
test('unknown image scope and CN failures stay pending and can retry after correction',()=>{const c=campaign(),db={campaigns:[c]},binding={campaignId:'c'},result={photos:[{id:'photo'}],comments:parseFeedResponse(response(),info).comments};applyAlbumComments(db,binding,result);assert.equal(c.records.length,0);assert.equal(binding.pending.length,1);binding.photoScopes={photo:{categoryId:'通行证'}};applyAlbumComments(db,binding,result);assert.match(binding.pending[0].reason,/CN/);db.members={12345:{cn:'示例用户O'}};assert.equal(applyAlbumComments(db,binding,result).imported,3);assert.equal(binding.pending.length,0);});
test('a comment follows its upload batch, not the individual photo list',()=>{const c=campaign(),db={campaigns:[c],members:{12345:{cn:'示例用户O'}}},photos=[{id:'photo',batchId:'b1'},{id:'photo2',batchId:'b1'}],r={photos,comments:parseFeedResponse(response(),info).comments};const scoped={campaignId:'c',photos,batchScopes:{b1:{categoryId:'通行证',source:'人工确认'}}};assert.equal(applyAlbumComments(db,scoped,r).imported,3);const fresh={campaignId:'c',photos};applyAlbumComments({campaigns:[campaign()],members:{12345:{cn:'示例用户O'}}},fresh,r);assert.equal(fresh.pending.length,1);assert.match(fresh.pending[0].reason,/大类/);});
test('album reader uses the comment endpoint for every subsequent page, keeping caption, scope and deduplication',async()=>{
 let calls=0;
 const result=await readAlbumFeeds(async(action,params)=>{
  if(action==='get_group_album_media_list')return {media_list:[{batch_id:'batch',image:{lloc:'photo'}}]};
  calls++;
  const data=decodeProto(Buffer.from(params.data,'hex')).find(x=>x.field===4).value;
  const value=f=>data.find(x=>x.field===f).value,cursor=value(5);
  assert.equal(value(7),'batch');
  if(!cursor){assert.match(params.cmd,/\.GetQunFeedDetail$/);return response({total:3,more:true,cursor:'next',caption:'通行证55.0'});}
  assert.match(params.cmd,/\.GetQunComment$/);
  assert.equal(value(3),'feed');
  if(cursor==='next')return response({id:'11',total:3,more:true,cursor:'last',commentPage:true});
  assert.equal(cursor,'last');
  return response({id:'12',total:3,commentPage:true});
 },'11111','album');
 assert.equal(calls,6);
 assert.deepEqual(result.comments.map(c=>c.commentId),['10','11','12']);
 assert.ok(result.comments.every(c=>c.feedId==='feed'&&c.batchId==='batch'&&c.photoIds[0]==='photo'));
 assert.equal(result.captions[0].text,'通行证55.0');
});
test('partial album pagination rechecks only known closed comments and continues other uploads',async()=>{
 const first=response({id:'10',total:2,more:true,cursor:'repeat'}),second=response({id:'11'}),other=response({id:'12'});
 const repeated=response({id:'10',total:2,more:true,cursor:'repeat',commentPage:true});
 const [a,b]=[first,second].map(hex=>parseFeedResponse(hex,info).comments[0].id);
 let calls=0;
 const call=async(action,params)=>{
  if(action==='get_group_album_media_list')return {media_list:[{batch_id:'one',image:{lloc:'p1'}},{batch_id:'two',image:{lloc:'p2'}}]};
  calls++;const data=decodeProto(Buffer.from(params.data,'hex')).find(x=>x.field===4).value;
  if(data.find(x=>x.field===8).value)return other;
  if(params.cmd.endsWith('.GetQunComment'))return repeated;
  return data.find(x=>x.field===7).value==='one'?first:second;
 };
 await assert.rejects(readAlbumFeeds(call,info.groupId,info.albumId),/分页/);assert.equal(calls,2);
 calls=0;
 const read=await readAlbumFeeds(call,info.groupId,info.albumId,{recoverCommentIds:new Set([a,b])});
 assert.deepEqual(read.comments.map(c=>c.id),[a,b]);assert.match(read.commentReadError,/分页/);assert.equal(calls,5);
});
test('@ signup cannot write album records and concurrent polling shares one read',async()=>{const c=campaign(),db={campaigns:[c],albums:[{groupId:'11111',campaignId:'c'}],members:{12345:{cn:'示例用户O'}}};const r=processQQEvent(db,{group_id:'11111',user_id:'12345',self_id:'99999',message:[{type:'at',data:{qq:'99999'}},{type:'text',data:{text:'洁哥通行证1'}}]});assert.match(r.reply,/相册/);assert.equal(c.records.length,0);let reads=0,release;const poller=createAlbumPoller({read:()=>{reads++;return new Promise(r=>release=r);}});const a=poller.run(),b=poller.run();assert.equal(reads,1);release('ok');assert.equal(await a,'ok');assert.equal(await b,'ok');poller.close();});

test('album commands are skipped and never become pending',()=>{
 const c=campaign(),db={campaigns:[c],members:{12345:{cn:'示例用户O'}}},binding={campaignId:'c',photoScopes:{photo:{categoryId:'通行证'}}};
 const result={photos:[{id:'photo'}],comments:parseFeedResponse(response({text:'@{uin:90000002,nick:客服小谷} 查询余量'}),info).comments};
 const stats=applyAlbumComments(db,binding,result);
 assert.equal(stats.skipped,1);assert.equal(binding.pending.length,0);assert.equal(c.records.length,0);assert.equal(c.commentEvents[0].skipped,true);
});
test('items outside the photo scope surface as selectable issues and resolve on retry',()=>{
 const c=campaign(),db={campaigns:[c],members:{12345:{cn:'示例用户O'}}},binding={campaignId:'c',photoScopes:{photo:{categoryId:'通行证'}}};
 const result={photos:[{id:'photo'}],comments:parseFeedResponse(response({text:'克莱门莎立牌1'}),info).comments};
 applyAlbumComments(db,binding,result);
 assert.equal(binding.pending.length,1);
 const issue=binding.pending[0].issues[0];
 assert.equal(issue.code,'outside');assert.equal(issue.candidates[0].id,'e');
 const commentId=binding.pending[0].commentId;
 assert.equal(retryPending(db,binding,commentId,{[issue.phrase]:'e'}).count,1);
 assert.equal(binding.pending.length,0);assert.equal(c.records[0].skuId,'e');
});
test('dismissed pending comments are remembered so the poller does not bring them back',()=>{
 const c=campaign(),db={campaigns:[c],members:{12345:{cn:'示例用户O'}}},binding={campaignId:'c',photoScopes:{photo:{categoryId:'通行证'}}};
 const result={photos:[{id:'photo'}],comments:parseFeedResponse(response({text:'克莱门莎立牌1'}),info).comments};
 applyAlbumComments(db,binding,result);
 dismissPending(db,binding,binding.pending[0].commentId);
 assert.equal(binding.pending.length,0);assert.equal(c.commentEvents.at(-1).dismissed,true);
 applyAlbumComments(db,binding,result);
 assert.equal(binding.pending.length,0);assert.equal(c.records.length,0);
});

test('recognized product list wins over a conflicting box id',()=>{
 const c=campaign();
 assert.deepEqual(scopedProducts(c,{categoryId:'',boxId:'55.0',productIds:['e']}).map(p=>p.id),['e']);
 assert.equal(scopedProducts(c,{categoryId:'通行证',boxId:'55.0'}).every(p=>p.type==='通行证'),true);
 assert.equal(scopedProducts(c,{categoryId:'单领'}).length,1);
});
test('one upload batch combines categories from its photos without a majority erasing minority goods',()=>{
 const c=campaign();
 const binding={campaignId:'c',photos:[{id:'p1',batchId:'b1'},{id:'p2',batchId:'b1'},{id:'p3',batchId:'b1'},{id:'p4',batchId:'b2'}],photoScopes:{p1:{categoryId:'通行证',boxId:'55.0'},p2:{categoryId:'单领'},p3:{categoryId:'单领'},p4:{categoryId:'特典'}}};
 deriveBatchScopes(binding);
 assert.deepEqual(binding.batchScopes.b1.categoryScopes.map(x=>x.categoryId),['通行证','单领']);
 assert.equal(binding.batchScopes.b1.boxId,'');
 assert.equal(binding.batchScopes.b2.categoryId,'特典');
 assert.deepEqual(commentProducts(c,binding,{batchId:'b1',photoIds:['p1','p2','p3']}),['a','b','d','e']);
});
test('manual batch scope wins over the photo majority',()=>{
 const c=campaign();
 const binding={campaignId:'c',photos:[{id:'p1',batchId:'b1'},{id:'p2',batchId:'b1'}],photoScopes:{p1:{categoryId:'单领'},p2:{categoryId:'通行证',boxId:'55.0',source:'人工确认'}}};
 deriveBatchScopes(binding);
 assert.equal(binding.batchScopes.b1.categoryId,'通行证');
 assert.equal(binding.batchScopes.b1.boxId,'55.0');
 assert.deepEqual(commentProducts(c,binding,{batchId:'b1',photoIds:['p1','p2']}).sort(),['a','b','d']);
});

test('album sync keeps uploaded photos when the campaign has no saved products',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{start}=await import('./server.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-empty-campaign-'));let app;
 const c={...campaign(),name:'空团',groupId:'11111',products:[]};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:''},campaigns:[c],qqGroups:[{id:'11111'}],albums:[{campaignId:'c',groupId:'11111',albumId:'album'}],qqSettings:{url:'ws://127.0.0.1:12345'}}));
 const options={port:0,dataDir:dir,credentialStore:{get:async()=>''},upstreamFetch:async()=>{throw Error('must not call a model without products');},referenceFetch:async()=>new Response('invalid image',{status:404}),qqConnector:()=>({status:()=> '已连接',close(){},async call(action,params){
  if(action==='get_group_album_media_list')return {media_list:[{batch_id:'batch',image:{lloc:'photo',default_url:{url:'https://qungz.photo.store.qq.com/synthetic.png'}}}]};
  if(action==='send_packet')return response({text:'洁哥1',caption:'通行证55.0'});
  if(action==='send_group_msg')throw Error('must not mention anyone');
  throw Error('Unexpected QQ action');
 }})};
 const post=()=>fetch(app.url+'/api/qq-album-comments',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:'{}'});
 try{
  app=await start(options);assert.equal((await post()).status,200);
  const db=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8')),b=db.albums[0];
  assert.equal(b.photos.length,1);assert.match(b.photoErrors[b.photos[0].id],/商品/);assert.ok(!b.sync.error);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
test('ignored upload batch never enters enrollment or pending',()=>{
 const c=campaign(),db={campaigns:[c],members:{12345:{cn:'示例用户O'}}};
 const binding={campaignId:'c',photos:[{id:'photo',batchId:'b1'}],batchScopes:{b1:{ignored:true,source:'人工确认'}},photoScopes:{photo:{ignored:true,source:'人工确认'}}};
 const result={photos:binding.photos,comments:[{id:'x',qq:'12345',at:'2026-10-23T11:56:42.000Z',text:'洁哥1',photoIds:['photo'],groupId:'11111',albumId:'album'}]};
 const stats=applyAlbumComments(db,binding,result);
 assert.equal(stats.skipped,1);assert.equal(binding.pending.length,0);assert.equal(c.records.length,0);
});
test('deriveBatchScopes keeps an ignored manual batch',()=>{
 const binding={photos:[{id:'p1',batchId:'b1'}],photoScopes:{p1:{ignored:true,source:'人工确认'}},batchScopes:{}};
 deriveBatchScopes(binding);assert.equal(binding.batchScopes.b1.ignored,true);
});
test('deleting a pending item persists across polling and restart while retaining other goods and original comment time',()=>{
 const c=campaign(),db={campaigns:[c],members:{12345:{cn:'测试甲'}}},binding={groupId:'11111',albumId:'album',campaignId:'c',photoScopes:{photo:{categoryId:'通行证',boxId:'55.0'}}};
 const result={photos:[{id:'photo'}],comments:parseFeedResponse(response({text:'洁哥2 未知1（代排） 克莱门莎1'}),info).comments};
 applyAlbumComments(db,binding,result);const item=binding.pending[0];assert.equal(item.preview.length,2);assert.equal(item.issues.length,1);
 const saved=JSON.stringify(binding);assert.throws(()=>deletePendingItem(db,binding,item.commentId,'not-an-entry'),/已变化/);assert.equal(JSON.stringify(binding),saved);
 deletePendingItem(db,binding,item.commentId,item.preview[0].entryKey);assert.equal(binding.pending[0].preview.length,1);assert.equal(c.records.length,0);
 applyAlbumComments(db,binding,result);assert.equal(binding.pending[0].preview.length,1);
 const restored=JSON.parse(JSON.stringify(binding));deletePendingItem(db,restored,item.commentId,restored.pending[0].issues[0].entryKey);
 assert.equal(restored.pending[0].issues.length,0);retryPending(db,restored,item.commentId);
 assert.deepEqual(c.records.map(r=>[r.skuId,r.quantity]),[['b',1]]);assert.equal(c.records[0].source,result.comments[0].text);assert.equal(c.records[0].sourceAt,result.comments[0].at);
 assert.equal(applyAlbumComments(db,restored,result).imported,0);assert.equal(c.records.length,1);
});
test('deleting every pending entry dismisses only that comment and never reimports it',()=>{
 const c=campaign(),db={campaigns:[c],members:{12345:{cn:'测试甲'}}},binding={groupId:'11111',albumId:'album',campaignId:'c',photoScopes:{photo:{categoryId:'通行证'}}};
 const result={photos:[{id:'photo'}],comments:parseFeedResponse(response({text:'未能识别1（代排）'}),info).comments};applyAlbumComments(db,binding,result);
 const item=binding.pending[0];deletePendingItem(db,binding,item.commentId,item.issues[0].entryKey);assert.equal(binding.pending.length,0);assert.equal(c.records.length,0);
 assert.equal(c.commentEvents[0].dismissed,true);assert.equal(applyAlbumComments(db,binding,result).duplicates,1);
});


test('manual upload scopes select multiple categories and preserve each category box restriction',()=>{
 const c=campaign();c.products.push({id:'later',name:'通行证-克莱门莎',type:'通行证',boxId:'56.0',price:40});const scope=albumScope(c,{categoryScopes:[{categoryId:'通行证',boxId:'55.0'},{categoryId:'单领'}]});assert.deepEqual(scopedProducts(c,scope).map(p=>p.id),['a','b','d','e']);assert.equal(scope.categoryId,'');for(const categoryScopes of [[],[{categoryId:'missing'}],[{categoryId:'通行证'},{categoryId:'通行证'}],[{categoryId:'通行证',boxId:'99.0'}]])assert.throws(()=>albumScope(c,{categoryScopes}));assert.equal(albumScope(c,{categoryId:'单领'}).categoryId,'单领');
 const binding={photos:[{id:'photo',batchId:'batch'}],batchScopes:{batch:scope}};assert.deepEqual(commentProducts(c,binding,{batchId:'batch',photoIds:['photo']}),['a','b','d','e']);assert.deepEqual(commentProducts(c,binding,{batchId:'batch',photoIds:['deleted']}),[]);
});
test('multi-category comments resolve mixed merchandise in comment order and do not duplicate on reread',()=>{
 const c=campaign(),db={campaigns:[c],members:{12345:{cn:'模拟甲'}}},scope=albumScope(c,{categoryScopes:[{categoryId:'通行证',boxId:'55.0'},{categoryId:'单领'}]}),binding={campaignId:'c',photos:[{id:'photo',batchId:'batch'}],batchScopes:{batch:scope}},comment={...parseFeedResponse(response({text:'洁哥通行证2 克莱门莎立牌1'}),info).comments[0],batchId:'batch'};const result={photos:binding.photos,comments:[comment]};assert.equal(applyAlbumComments(db,binding,result).imported,2);assert.deepEqual(c.records.map(r=>[r.skuId,r.quantity]),[['a',2],['e',1]]);assert.equal(applyAlbumComments(db,binding,result).duplicates,1);assert.equal(c.records.length,2);
});
test('automatic mixed photo scopes preserve product-specific lists alongside category ranges',()=>{
 const c=campaign(),binding={photos:[{id:'p1',batchId:'b'},{id:'p2',batchId:'b'}],photoScopes:{p1:{productIds:['e'],categoryId:'',boxId:'55.0'},p2:{categoryId:'通行证',boxId:'55.0'}}};deriveBatchScopes(binding);assert.deepEqual(scopedProducts(c,binding.batchScopes.b).map(p=>p.id),['e','a','b','d']);
});
test('deleted images clear confirmation caches and archive pending without retracting existing orders',()=>{
 const c=campaign();c.records.push({id:'kept',skuId:'a',member:'模拟甲',quantity:1});const binding={photos:[{id:'old',batchId:'deleted'},{id:'live',batchId:'active'}],photoScopes:{old:{categoryId:'单领'},live:{categoryId:'通行证'}},photoErrors:{old:'old error'},photoAttempts:{old:{}},batchScopes:{deleted:{categoryId:'单领',source:'人工确认'},active:{categoryId:'通行证',source:'人工确认'}},pending:[{id:'old-pending',photoIds:['old']},{id:'mixed',photoIds:['old','live']}],captions:[{text:'old',photoIds:['old']}]};reconcileAlbumPhotos(binding,[{id:'live',batchId:'active'}]);assert.equal(binding.photos.length,1);assert.equal(binding.photoScopes.old,undefined);assert.equal(binding.photoErrors.old,undefined);assert.equal(binding.photoAttempts.old,undefined);assert.equal(binding.batchScopes.deleted,undefined);assert.equal(binding.captions.length,0);assert.deepEqual(binding.pending.map(p=>p.id),['mixed']);assert.equal(binding.unavailablePending[0].id,'old-pending');assert.equal(c.records.length,1);reconcileAlbumPhotos(binding,[]);assert.deepEqual(binding.photos,[]);assert.equal(Object.keys(binding.batchScopes).length,0);assert.deepEqual(binding.pending,[]);
});
test('complete media refresh precedes failed comment reads, excludes empty deleted batches and rejects partial pagination',async()=>{
 let media=null,packets=0;await assert.rejects(readAlbumFeeds(async action=>{if(action==='get_group_album_media_list')return {media_list:[{batch_id:'active',image:{lloc:'live'}}],batch_list:[{link_id:'deleted'}]};packets++;throw Error('comment unavailable');},'11111','album',{onPhotos:photos=>{media=photos;}}),/comment unavailable/);assert.deepEqual(media.map(p=>p.id),['live']);assert.equal(packets,1);
 const empty=await readAlbumFeeds(async action=>{assert.equal(action,'get_group_album_media_list');return {media_list:[],batch_list:[{link_id:'deleted'}]};},'11111','album');assert.deepEqual(empty.photos,[]);assert.deepEqual(empty.comments,[]);
 let committed=0;await assert.rejects(readAlbumFeeds(async()=>({media_list:[],next_has_more:true,next_attach_info:'same'}),'11111','album',{onPhotos:()=>committed++}),/分页/);assert.equal(committed,0);await assert.rejects(readAlbumFeeds(async()=>({}),'11111','album',{onPhotos:()=>committed++}),/完整/);assert.equal(committed,0);
});


test('multi-category scope and deleted-photo reconciliation persist through server refresh and restart without retracting records',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{start}=await import('./server.mjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-multi-album-'));let app,photos=[{id:'photo',batchId:'mixed'},{id:'second',batchId:'mixed'},{id:'removed',batchId:'old'}],failComments=false,malformed=false,hold=null;
 const c={...campaign(),groupId:'11111',botId:'zhougu',revision:0},binding={campaignId:'c',groupId:'11111',albumId:'album',photos,photoScopes:Object.fromEntries(photos.map(p=>[p.id,{categoryId:'通行证',source:'人工确认'}])),batchScopes:{mixed:{categoryId:'通行证',source:'人工确认'},old:{categoryId:'通行证',source:'人工确认'}}};await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[c],albums:[binding],members:{12345:{cn:'模拟甲'}},qqGroups:[{id:'11111'}],qqSettings:{url:'ws://127.0.0.1:12345'},settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''}}));
 const options={port:0,dataDir:dir,credentialStore:{get:async()=>'',set:async()=>{}},upstreamFetch:async()=>{throw Error('No models');},qqConnector:()=>({status:()=> '已连接',close(){},call:async(action,params)=>{if(action==='get_group_album_media_list'){if(malformed)return {};const snapshot={media_list:photos.map(p=>({batch_id:p.batchId,image:{lloc:p.id}})),batch_list:[{link_id:'old'},{link_id:'mixed'}]};if(hold){const gate=hold;hold=null;await gate(snapshot);}return snapshot;}if(action==='send_packet'){if(failComments)throw Error('comment unavailable');const decoded=decodeProto(Buffer.from(params.data,'hex')).find(x=>x.field===4).value,batch=decoded.find(x=>x.field===7).value;return response({id:batch==='old'?'old':'mixed',text:batch==='old'?'未知款1':'洁哥通行证2 克莱门莎立牌1'});}throw Error('Unexpected QQ action '+action);}})};
 const post=async(route,body={})=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},state=async()=>JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));
 try{app=await start(options);const choice={groupId:'11111',albumId:'album',batchId:'mixed',categoryScopes:[{categoryId:'通行证',boxId:'55.0'},{categoryId:'单领'}]};assert.equal((await post('album-batch-scope',choice)).status,200);assert.equal((await post('album-batch-scope',{...choice,categoryScopes:[{categoryId:'missing'}]})).status,400);assert.equal((await post('qq-album-comments')).status,200);let db=await state();assert.deepEqual(db.campaigns[0].records.map(r=>[r.skuId,r.quantity]),[['a',2],['e',1]]);assert.equal(db.albums[0].pending.length,1);
 await app.shutdown();app=await start(options);assert.equal((await state()).albums[0].batchScopes.mixed.categoryScopes.length,2);photos=[{id:'photo',batchId:'mixed'}];assert.equal((await post('qq-album-photos',{groupId:'11111',albumId:'album'})).status,200);db=await state();assert.equal(db.albums[0].photos.length,1);assert.equal(db.albums[0].photoScopes.removed,undefined);assert.equal(db.albums[0].batchScopes.old,undefined);assert.equal(db.albums[0].pending.length,0);assert.equal(db.albums[0].unavailablePending.length,1);assert.equal(db.campaigns[0].records.length,2);assert.equal((await post('album-batch-scope',{...choice,batchId:'old'})).status,400);
 failComments=true;photos=[{id:'new',batchId:'new'}];const partial=await post('qq-album-photos',{groupId:'11111',albumId:'album'});assert.equal(partial.status,200);assert.match(partial.data.warning,/图片已刷新/);assert.equal((await state()).albums[0].photos[0].id,'new');malformed=true;assert.equal((await post('qq-album-photos',{groupId:'11111',albumId:'album'})).status,400);assert.equal((await state()).albums[0].photos[0].id,'new');malformed=false;failComments=false;
 let release,started;const blocked=new Promise(r=>started=r);hold=()=>{started();return new Promise(r=>release=r);};const older=post('qq-album-photos',{groupId:'11111',albumId:'album'});await blocked;photos=[];assert.equal((await post('qq-album-photos',{groupId:'11111',albumId:'album'})).status,200);failComments=true;release();const oldResult=await older;assert.equal(oldResult.status,200);assert.deepEqual(oldResult.data.photos,[]);db=await state();assert.deepEqual(db.albums[0].photos,[]);assert.equal(db.campaigns[0].records.length,2);
 }finally{await app?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});


test('album withdrawal removes only own scoped SKU, preserves proxies, and cannot revive on replay',()=>{
 const c={...campaign(),groupId:'11111'},db={campaigns:[c],albumWithdrawalEnabled:true,members:{12345:{cn:'测试甲'},23456:{cn:'测试乙'}}};
 const binding={campaignId:'c',groupId:'11111',albumId:'album',photoScopes:{photo:{categoryId:'通行证'}}};
 const event=(id,text,qq='12345')=>({id,commentId:id,qq,text,groupId:'11111',albumId:'album',photoIds:['photo'],at:`2026-10-26T12:00:${id.padStart(2,'0')}Z`});
 const original=[event('1','洁哥3'),event('2','洁哥2','23456'),event('3','代群外测试丙 洁哥1')];
 const run=comments=>applyAlbumComments(db,binding,{photos:[{id:'photo'}],comments});
 run(original);assert.equal(c.records.length,3);
 const withdrawal=event('4','撤排洁哥');run([withdrawal]);
 assert.equal(c.records.length,2);assert.ok(c.records.some(r=>r.proxyFor==='测试丙'));assert.equal(binding.withdrawalNotices.length,1);assert.match(binding.withdrawalNotices[0].message,/已撤排.*3/);
 run([...original,withdrawal]);assert.equal(c.records.length,2);assert.equal(binding.withdrawalNotices.length,1);
 run([event('0','洁哥2')]);assert.equal(c.records.length,2);
 run([event('5','洁哥1')]);assert.equal(c.records.length,3);
 const restored=JSON.parse(JSON.stringify({db,binding}));applyAlbumComments(restored.db,restored.binding,{photos:[{id:'photo'}],comments:[...original,withdrawal]});assert.equal(restored.db.campaigns[0].records.length,3);
});

test('withdrawals reject disabled, unknown, ambiguous, foreign identity, quantity, and completed requests without enrollment',()=>{
 const c={...campaign(),groupId:'11111'},db={campaigns:[c],members:{12345:{cn:'测试甲'}}},binding={campaignId:'c',groupId:'11111',albumId:'album',photoScopes:{photo:{categoryId:'通行证'}}};let id=0;
 const run=(text,extra={})=>applyAlbumComments(db,binding,{photos:[{id:'photo'}],comments:[{id:String(++id),qq:'12345',text,groupId:'11111',albumId:'album',photoIds:['photo'],at:'2026-10-26T12:00:00Z',...extra}]});
 run('洁哥3');run('撤排洁哥');assert.match(binding.withdrawalNotices.at(-1).message,/未开启/);assert.equal(c.records.length,1);
 db.albumWithdrawalEnabled=true;
 for(const [text,pattern]of [['撤排克莱门莎',/没有排过/],['撤排不存在的产品',/未找到/],['撤排通行证',/具体制品/],['撤排洁哥1',/不要附数量/],['撤排',/请评论/]]){run(text);assert.match(binding.withdrawalNotices.at(-1).message,pattern);assert.equal(c.records.length,1);}
 const notices=binding.withdrawalNotices.length;run('撤排洁哥',{groupId:'22222'});run('撤排洁哥',{albumId:'other'});run('撤排洁哥',{qq:'all'});assert.equal(binding.withdrawalNotices.length,notices);assert.equal(c.records.length,1);
 run('撤排洁哥',{qq:'34567'});assert.match(binding.withdrawalNotices.at(-1).message,/cn 你的CN/);
 c.orderLifecycle={status:'completed'};run('撤排洁哥');assert.match(binding.withdrawalNotices.at(-1).message,/已经结束/);assert.equal(c.records.length,1);
});

test('album withdrawal processes mixed arrival order by source time and leaves later enrollments',()=>{
 const c={...campaign(),groupId:'11111'},db={campaigns:[c],albumWithdrawalEnabled:true,members:{12345:{cn:'测试甲'}}},binding={campaignId:'c',groupId:'11111',albumId:'album',photoScopes:{photo:{categoryId:'通行证'}}};
 const comments=['洁哥3','撤排洁哥','洁哥1'].map((text,i)=>({id:String(i),qq:'12345',text,groupId:'11111',albumId:'album',photoIds:['photo'],at:`2026-10-26T12:00:0${i}Z`}));
 applyAlbumComments(db,binding,{photos:[{id:'photo'}],comments:comments.reverse()});assert.equal(c.records.length,1);assert.equal(c.records[0].quantity,1);
});

test('withdrawal notices persist before sending, retry safely, and use sender QQ only',async()=>{
 const {sendWithdrawalNotices}=await import('./album-withdrawal.mjs');const c={...campaign(),groupId:'11111'},db={campaigns:[c]},binding={campaignId:'c',groupId:'11111',withdrawalNotices:[{id:'x',qq:'12345',message:'测试撤排',attempts:0}]};let saved=0,sent=0,time=100000;
 const opts={persist:async()=>saved++,send:async p=>{assert.ok(saved);assert.equal(p.group_id,11111);assert.equal(p.message[0].data.qq,'12345');sent++;},now:()=>time};
 await sendWithdrawalNotices(db,binding,opts);await sendWithdrawalNotices(db,binding,opts);assert.equal(sent,1);
 binding.withdrawalNotices=[{id:'y',qq:'12345',message:'失败测试',attempts:0}];const fail={...opts,send:async()=>{sent++;throw Error('private-transport-secret');}};
 for(let i=0;i<5;i++){await sendWithdrawalNotices(db,binding,fail);time+=120000;}assert.equal(sent,4);assert.doesNotMatch(JSON.stringify(binding),/private-transport-secret/);
});


test('withdrawal server sync persists removal, updates XLSX, sends once and survives restart',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{start}=await import('./server.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-withdrawal-integration-'));let app,mode='enroll',sent=[];
 const c={...campaign(),name:'测试期次',groupId:'11111',botId:'zhougu',revision:0},binding={campaignId:'c',groupId:'11111',albumId:'album',photoScopes:{photo:{categoryId:'通行证',source:'人工确认'}}};
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[c],albums:[binding],settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''},albumWithdrawalEnabled:true,members:{12345:{cn:'测试甲'}},qqGroups:[{id:'11111'}],qqSettings:{url:'ws://127.0.0.1:12345'}}));
 const options={port:0,dataDir:dir,credentialStore:{get:async()=>'',set:async()=>{}},upstreamFetch:async()=>{throw Error('No model');},qqConnector:()=>({status:()=> '已连接',close(){},call:async action=>{
  if(action==='get_group_album_media_list')return {media_list:[{image:{lloc:'photo'}}]};
  if(action==='send_packet')return response({id:mode==='enroll'?'10':'20',text:mode==='enroll'?'洁哥3':'撤排洁哥'});
  if(action==='send_group_msg'){const db=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(db.campaigns[0].records.length,0);sent.push(action);return {};}
  throw Error('Unexpected mock action '+action);
 }})};
 const sync=async()=>{const r=await fetch(app.url+'/api/qq-album-comments',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);};
 try{app=await start(options);await sync();const before=await fs.readFile(path.join(dir,'tables','c.xlsx'));mode='withdraw';await sync();assert.equal(sent.length,1);assert.notDeepEqual(await fs.readFile(path.join(dir,'tables','c.xlsx')),before);
  const state=await (await fetch(app.url+'/api/state')).json();assert.equal(state.campaigns[0].records.length,0);assert.ok(state.campaigns[0].commentEvents.some(e=>e.withdrawal&&e.success));
  await app.shutdown();app=await start(options);await sync();assert.equal(sent.length,1);mode='enroll';await sync();assert.equal((await (await fetch(app.url+'/api/state')).json()).campaigns[0].records.length,0);
 }finally{await app?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});

test('same-second withdrawal uses comment sequence and explicit box disambiguation',()=>{
 const c={...campaign(),groupId:'11111'},db={campaigns:[c],albumWithdrawalEnabled:true,members:{12345:{cn:'测试甲'}}},binding={campaignId:'c',groupId:'11111',albumId:'album',photoScopes:{photo:{categoryId:'通行证'}}};
 c.products.push({...c.products[0],id:'another',boxId:'56.0'});
 const base={qq:'12345',groupId:'11111',albumId:'album',photoIds:['photo'],at:'2026-10-26T12:00:00Z'};
 c.records=[{...base,id:'later',sourceId:'30',sourceAt:base.at,skuId:'a',quantity:1},{...base,id:'earlier',sourceId:'10',sourceAt:base.at,skuId:'a',quantity:3}];
 applyAlbumComments(db,binding,{photos:[{id:'photo'}],comments:[{...base,id:'20',text:'撤排洁哥通行证55.0'}]});assert.equal(c.records.length,1);assert.equal(c.records[0].id,'later');
});

test('pending review displays fresh full candidates without enrolling or modifying saved pending rows',async()=>{
 const {pendingReviewView}=await import('./album-sync.mjs');
 const products=Array.from({length:12},(_,i)=>({id:'k'+i,name:(i===11?'亚克力立牌':'制品'+i)+'-凯尔希',type:'单领',categoryId:'s',character:'凯尔希'}));
 const c={id:'review-c',botId:'zhougu',revision:1,products,records:[],categories:[{id:'s',name:'单领',kind:'single'}]},item={id:'review-e',commentId:'1',text:'凯尔希1',qq:'12345',photoIds:['p'],issues:[{phrase:'凯尔希',candidates:products.slice(0,6)}],preview:[]},binding={campaignId:c.id,groupId:'11111',albumId:'a',photoScopes:{p:{categoryId:'s'}},pending:[item]},db={campaigns:[c],members:{12345:{cn:'测试甲'}}};
 const before=JSON.stringify(db);const view=pendingReviewView(db,binding,item);assert.equal(view.issues[0].candidates.length,12);assert.equal(view.issues[0].candidates.at(-1).name.includes('凯尔希'),true);assert.ok(view.issues[0].candidates.some(x=>x.id==='k11'));assert.equal(JSON.stringify(db),before);assert.equal(c.records.length,0);
});

test('album withdrawal cannot cancel a short-named SKU when the explicit long product is outside photo scope',async()=>{
 const {withdrawAlbumComment}=await import('./album-withdrawal.mjs');
 const products=[{id:'long',name:'水晶镭射票根-艾雅法拉',type:'单领',categoryId:'s'},{id:'short',name:'票根-艾雅法拉',type:'单领',categoryId:'s'}];
 const c={id:'c',botId:'zhougu',groupId:'11111',products,categories:[{id:'s',name:'单领',kind:'single'}],records:products.map(p=>({id:p.id+'-record',skuId:p.id,qq:'12345',member:'模拟成员',quantity:2,sourceAt:'2026-01-01T00:00:00Z'}))},db={campaigns:[c],albumWithdrawalEnabled:true,members:{12345:{cn:'模拟成员'}}},binding={campaignId:'c',groupId:'11111',albumId:'a'};
 const event={id:'one',qq:'12345',groupId:'11111',albumId:'a',text:'撤排小羊水晶镭射票根',at:'2026-01-02T00:00:00Z'};
 withdrawAlbumComment(db,c,binding,event,['short']);assert.equal(c.records.length,2);assert.equal(c.commentEvents[0].success,false);
 withdrawAlbumComment(db,c,binding,{...event,id:'two'},['short','long']);assert.deepEqual(c.records.map(r=>r.skuId),['short']);assert.equal(c.commentEvents[1].success,true);
});

test('administrator delegated CN permits pending photo comments to import using original author and time',()=>{
 const c={id:'c',groupId:'11111',botId:'zhougu',products:[{id:'p',name:'透明文件夹-艾雅法拉',type:'单领',categoryId:'s'}],categories:[{id:'s',name:'单领',kind:'single'}],records:[]},db={campaigns:[c],qqAdmins:['12345']},binding={groupId:'11111',albumId:'a',campaignId:'c',photoScopes:{photo:{categoryId:'s'}}};
 const event={id:'comment',qq:'54321',groupId:'11111',albumId:'a',photoIds:['photo'],text:'透明文件夹 小羊',at:'2026-01-01T01:02:03Z'},read={photos:[{id:'photo'}],comments:[event]};
 applyAlbumComments(db,binding,read);assert.equal(c.records.length,0);assert.equal(binding.pending.length,1);
 processQQEvent(db,{group_id:11111,user_id:12345,self_id:99999,message:[{type:'at',data:{qq:'99999'}},{type:'at',data:{qq:'54321'}},{type:'text',data:{text:'cn 模拟成员'}}]});
 applyAlbumComments(db,binding,read);assert.equal(c.records.length,1);assert.equal(c.records[0].qq,'54321');assert.equal(c.records[0].member,'模拟成员');assert.equal(c.records[0].sourceAt,'2026-01-01T01:02:03.000Z');assert.equal(binding.pending.length,0);
 applyAlbumComments(db,binding,read);assert.equal(c.records.length,1);
});
