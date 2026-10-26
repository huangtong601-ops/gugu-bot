import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {start} from './server.mjs';
import {serverAddress,serverToken,resourcePath,SERVER_PROTOCOL} from './server-connection.mjs';
import {startServerGateway} from './server-gateway.mjs';
import {serverCodec} from './server-vault.mjs';
import {initializeServer,runServer} from './server-entry.mjs';
const token='synthetic-server-access-token-1234567890';
const vault=()=>{const data=new Map();return {data,get:async c=>data.get(c.provider+'|'+c.baseUrl)||'',set:async(c,v)=>{data.set(c.provider+'|'+c.baseUrl,v);}};};
const close=app=>app?new Promise(r=>app.server.close(r)):Promise.resolve();
const post=async(app,route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify(body)});return {code:r.status,data:await r.json()};};
const state=async app=>{const r=await fetch(app.url+'/api/state');return r.json();};
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'pingu-server-test-'));

test('server URL, token and resource validation rejects insecure credentials, redirects and path escapes',()=>{
 assert.equal(serverAddress(' https://example.test/ '),'https://example.test');assert.equal(serverAddress('http://127.0.0.1:3220'),'http://127.0.0.1:3220');
 for(const value of ['http://example.test','https://user:password@example.test','https://example.test/api','https://example.test/?token=secret','https://example.test/#part','file:///x'])assert.throws(()=>serverAddress(value));
 assert.equal(serverToken(token),token);for(const value of ['short',token+'\n',null])assert.throws(()=>serverToken(value));
 assert.equal(resourcePath('/api/export?campaignId=abc'),'/api/export?campaignId=abc');assert.equal(resourcePath('/media/abc.png'),'/media/abc.png');
 for(const value of ['https://evil.test/api/state','//evil.test/api/state','/api/x/../state','/media/../../credentials.json','/api/state#x','/api/state\\x','/api/state\n'])assert.equal(resourcePath(value),null);
});

test('server vault encrypts with authenticated envelopes and refuses tampering or the wrong master key',()=>{
 const codec=serverCodec(randomBytes(32)),bytes=Buffer.from('synthetic-private-key');const encrypted=codec.encrypt(bytes);
 assert.notDeepEqual(encrypted,codec.encrypt(bytes));assert.equal(encrypted.includes(bytes),false);assert.deepEqual(codec.decrypt(encrypted),bytes);
 const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;assert.throws(()=>codec.decrypt(damaged),/无法解密/);assert.throws(()=>serverCodec(randomBytes(32)).decrypt(encrypted),/无法解密/);assert.throws(()=>serverCodec(Buffer.alloc(4)));
});

test('authenticated gateway rejects unauthorized browsers and blocks local connection controls and event injection',async()=>{
 const dir=await temp();let backend,gateway;
 try{backend=await start({port:0,dataDir:dir,credentialStore:vault(),allowServerConnection:false});gateway=await startServerGateway({port:0,backendUrl:backend.url,token,serverId:randomUUID()});
  assert.equal((await fetch(gateway.url+'/api/server-info')).status,401);
  assert.equal((await fetch(gateway.url+'/api/server-info',{headers:{authorization:token}})).status,401);
  assert.equal((await fetch(gateway.url+'/api/server-info',{headers:{authorization:'Bearer '+token,origin:'https://evil.test'}})).status,401);
  const auth={authorization:'Bearer '+token};assert.equal((await (await fetch(gateway.url+'/api/server-info',{headers:auth})).json()).protocol,SERVER_PROTOCOL);
  for(const route of ['server-connection','server-test','qq-event','qq-test-admin'])assert.equal((await fetch(gateway.url+'/api/'+route,{headers:auth})).status,404);
  assert.equal((await fetch(gateway.url+'/credentials.json',{headers:auth})).status,404);assert.equal((await state(backend)).campaigns.length,0);
 }finally{await close(gateway);await close(backend);await fs.rm(dir,{recursive:true,force:true});}
});

test('optional server mode routes workspace, model credentials, media and exports without mixing local data; restart and return retain local state',async()=>{
 const base=await temp(),localDir=path.join(base,'local'),remoteDir=path.join(base,'remote'),localVault=vault(),remoteVault=vault();let remote,gateway,local;let opened=0,closed=0;
 const localOptions={port:0,dataDir:localDir,credentialStore:localVault,qqConnector:()=>{opened++;return {status:()=> '已连接',close(){closed++;},call:async()=>({online:true,user_id:123456})};}};
 try{
  remote=await start({port:0,dataDir:remoteDir,credentialStore:remoteVault,allowServerConnection:false});gateway=await startServerGateway({port:0,backendUrl:remote.url,token,serverId:randomUUID(),name:'隔离服务器'});local=await start(localOptions);
  assert.equal((await (await fetch(local.url+'/api/server-connection')).json()).mode,'local');
  await post(local,'campaign',{name:'本机期次',botId:'zhougu'});await post(local,'qq-settings',{url:'ws://127.0.0.1:12345'});const before=await fs.readFile(path.join(localDir,'workspace.json'),'utf8');
  assert.equal((await post(local,'server-test',{url:gateway.url,token})).code,200);assert.equal((await state(local)).campaigns[0].name,'本机期次');
  const activated=await post(local,'server-connection',{mode:'remote',url:gateway.url,token});assert.equal(activated.code,200);assert.equal(activated.data.hasToken,true);assert.equal(JSON.stringify(activated.data).includes(token),false);assert.ok(closed>0);
  assert.deepEqual((await state(local)).campaigns,[]);const created=await post(local,'campaign',{name:'服务器期次',botId:'zhougu'});assert.equal(created.code,200);const id=created.data.id;
  assert.equal((await post(local,'settings',{provider:'custom',baseUrl:'https://example.test/v1',model:'vision',apiKey:'synthetic-remote-api-key'})).code,200);
  assert.equal([...localVault.data.values()].includes('synthetic-remote-api-key'),false);assert.equal([...remoteVault.data.values()].includes('synthetic-remote-api-key'),true);
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
  const upload=await post(local,'upload',{image:'data:image/png;base64,'+image.toString('base64')});assert.equal(upload.code,200);assert.deepEqual(Buffer.from(await (await fetch(local.url+upload.data.url)).arrayBuffer()),image);
  const exported=await fetch(local.url+'/api/export?campaignId='+id);assert.equal(exported.status,200);assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0,2).toString(),'PK');
  assert.equal(await fs.readFile(path.join(localDir,'workspace.json'),'utf8'),before);assert.equal((await fs.readFile(path.join(localDir,'server-connection.json'),'utf8')).includes(token),false);
  const opens=opened;await close(local);local=await start(localOptions);assert.equal(opened,opens);assert.equal((await state(local)).campaigns[0].name,'服务器期次');
  assert.equal((await post(local,'server-connection',{mode:'local'})).code,200);assert.equal((await state(local)).campaigns[0].name,'本机期次');assert.equal(opened,opens+1);assert.equal((await state(remote)).campaigns[0].name,'服务器期次');
 }finally{await close(local);await close(gateway);await close(remote);await fs.rm(base,{recursive:true,force:true});}
});

test('failed authentication, incompatible server and redirected endpoints never save a new mode or disclose the token',async()=>{
 const dir=await temp();let app;const calls=[];
 try{app=await start({port:0,dataDir:dir,credentialStore:vault(),remoteFetch:async(url,options)=>{calls.push(options);if(url.startsWith('https://invalid.test'))return Response.json({},{status:401});if(url.startsWith('https://redirect.test'))throw Error('Redirect');return Response.json({protocol:'wrong',token});}});
  for(const url of ['https://invalid.test','https://redirect.test','https://old.test']){const r=await post(app,'server-connection',{mode:'remote',url,token});assert.equal(r.code,400);assert.equal(JSON.stringify(r.data).includes(token),false);}
  assert.equal((await (await fetch(app.url+'/api/server-connection')).json()).mode,'local');assert.ok(calls.every(c=>c.redirect==='error'));
  await assert.rejects(fs.stat(path.join(dir,'server-connection.json')),{code:'ENOENT'});
  const cross=await fetch(app.url+'/api/server-connection',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'});assert.equal(cross.status,403);
 }finally{await close(app);await fs.rm(dir,{recursive:true,force:true});}
});

test('offline server fails closed for reads and writes, without retrying mutations or falling back to the local workspace',async()=>{
 const dir=await temp();let app,offline=false,mutations=0;const serverId=randomUUID();
 try{app=await start({port:0,dataDir:dir,credentialStore:vault(),remoteFetch:async(url)=>{
  if(url.endsWith('/api/server-info'))return Response.json({protocol:SERVER_PROTOCOL,serverId,capabilities:['workspace','albums','exports']});
  if(url.endsWith('/api/campaign'))mutations++;if(offline)throw Error('synthetic secret '+token);
  return Response.json({campaigns:[],bots:[]},{headers:{'x-pingu-server-id':serverId}});
 }});
  await post(app,'campaign',{name:'本机保留',botId:'zhougu'});const before=await fs.readFile(path.join(dir,'workspace.json'),'utf8');
  assert.equal((await post(app,'server-connection',{mode:'remote',url:'https://test.example',token})).code,200);offline=true;
  assert.equal((await fetch(app.url+'/api/state')).status,400);const write=await post(app,'campaign',{name:'不可落本地',botId:'zhougu'});assert.equal(write.code,400);assert.equal(mutations,1);assert.equal(JSON.stringify(write).includes(token),false);
  assert.equal(await fs.readFile(path.join(dir,'workspace.json'),'utf8'),before);assert.equal((await (await fetch(app.url+'/api/server-connection')).json()).mode,'remote');
  await post(app,'server-connection',{mode:'local'});assert.equal((await state(app)).campaigns.length,1);
 }finally{await close(app);await fs.rm(dir,{recursive:true,force:true});}
});

test('pinned server identity is checked on every forwarded response',async()=>{
 const dir=await temp();let app;const serverId=randomUUID();
 try{app=await start({port:0,dataDir:dir,credentialStore:vault(),remoteFetch:async(url)=>url.endsWith('server-info')?Response.json({protocol:SERVER_PROTOCOL,serverId,capabilities:['workspace','albums','exports']}):Response.json({campaigns:[]},{headers:{'x-pingu-server-id':randomUUID()}})});
  await post(app,'server-connection',{mode:'remote',url:'https://test.example',token});const response=await fetch(app.url+'/api/state');assert.equal(response.status,400);assert.match((await response.json()).error,/身份发生变化/);
 }finally{await close(app);await fs.rm(dir,{recursive:true,force:true});}
});

test('switching refuses an active local operation and retains the original QQ connection',async()=>{
 const dir=await temp();let app,release,called;const entered=new Promise(r=>called=r),hold=new Promise(r=>release=r);let closed=0;const serverId=randomUUID();
 try{app=await start({port:0,dataDir:dir,credentialStore:vault(),remoteFetch:async()=>Response.json({protocol:SERVER_PROTOCOL,serverId,capabilities:['workspace','albums','exports']}),qqConnector:()=>({status:()=> '已连接',close(){closed++;},async call(action){if(action==='get_login_info'){called();await hold;return {user_id:123456};}return action==='get_group_list'?[]:{online:true};}})});
  await post(app,'qq-settings',{url:'ws://127.0.0.1:12345'});const task=post(app,'qq-diagnostics',{});await entered;
  const switching=await post(app,'server-connection',{mode:'remote',url:'https://test.example',token});assert.equal(switching.code,400);assert.match(switching.data.error,/操作正在处理/);assert.equal(closed,0);release();await task;
 }finally{release?.();await close(app);await fs.rm(dir,{recursive:true,force:true});}
});

test('headless server initializes private keys, keeps one writer, encrypts model settings and persists across service restart',async()=>{
 const dir=await temp();let service,portServer;
 try{
  await initializeServer(dir);await assert.rejects(initializeServer(dir),/空的数据目录/);
  portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));portServer=null;
  const file=path.join(dir,'server-config.json'),config=JSON.parse(await fs.readFile(file,'utf8'));config.port=port;await fs.writeFile(file,JSON.stringify(config));
  service=await runServer({dataDir:dir,env:{}});await assert.rejects(runServer({dataDir:dir,env:{}}),/不能重复启动/);
  const access=(await fs.readFile(path.join(dir,'access-token.txt'),'utf8')).trim(),headers={authorization:'Bearer '+access,'content-type':'application/json'};
  const request=async(route,body)=>{const r=await fetch(service.url+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  await request('settings',{provider:'custom',baseUrl:'https://example.test/v1',model:'vision',apiKey:'synthetic-headless-api-key'});await request('campaign',{name:'独立服务器',botId:'zhougu'});
  assert.equal((await fs.readFile(path.join(dir,'credentials.json'),'utf8')).includes('synthetic-headless-api-key'),false);assert.equal((await fs.readFile(path.join(dir,'workspace.json'),'utf8')).includes('synthetic-headless-api-key'),false);
  await service.close();service=await runServer({dataDir:dir,env:{}});const restored=await (await fetch(service.url+'/api/state',{headers})).json();assert.equal(restored.hasKey,true);assert.equal(restored.campaigns[0].name,'独立服务器');
 }finally{await service?.close();if(portServer)await new Promise(r=>portServer.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('administrator can be configured without a desktop wizard and remote QQ reconnect uses the saved gateway',async()=>{
 const dir=await temp();let app,opens=0;
 try{app=await start({port:0,dataDir:dir,credentialStore:vault(),allowServerConnection:false,qqConnector:()=>{opens++;return {status:()=> '已连接',close(){},call:async action=>action==='get_login_info'?{user_id:654321}:{online:true}};}});
  assert.equal((await post(app,'qq-admin',{qqAdmin:'bad'})).code,400);assert.equal((await post(app,'qq-admin',{qqAdmin:'123456'})).code,200);assert.equal((await state(app)).qqAdmin,'123456');
  assert.equal((await post(app,'qq-settings',{url:'ws://127.0.0.1:12345'})).code,200);assert.equal((await post(app,'qq-admin',{qqAdmin:'654321'})).code,400);
  assert.equal((await post(app,'qq-auto-connect',{})).data.qq,'654321');assert.equal(opens,2);assert.equal((await post(app,'qq-login-state',{})).data.loggedIn,true);assert.equal((await state(app)).qqAdmin,'123456');
 }finally{await close(app);await fs.rm(dir,{recursive:true,force:true});}
});
