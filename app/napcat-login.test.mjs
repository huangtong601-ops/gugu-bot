import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {createNapcatLogin} from './napcat-login.mjs';
test('NapCat login uses documented local auth, never sends plaintext password, and preserves challenges',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-qq-login-'));await fs.mkdir(path.join(dir,'config'));await fs.writeFile(path.join(dir,'config/webui.json'),JSON.stringify({port:6099,token:'local-webui-token'}));let calls=[];
 const adapter=createNapcatLogin({runtimeDir:dir,fetcher:async(url,opts)=>{const body=JSON.parse(opts.body);calls.push({url,body,headers:opts.headers});if(url.endsWith('/auth/login')){assert.equal(body.hash,createHash('sha256').update('local-webui-token.napcat').digest('hex'));return Response.json({code:0,data:{Credential:'session'}});}assert.equal(opts.headers.authorization,'Bearer session');if(url.endsWith('/PasswordLogin'))return Response.json({code:0,data:{needNewDevice:true,jumpUrl:'https://accounts.qq.com/safe/'}});if(url.endsWith('/CheckLoginStatus'))return Response.json({code:0,data:{isLogin:false,loginPhase:'waiting_qrcode'}});throw Error('unexpected');}});
 try{const result=await adapter.password('12345','test-password');assert.equal(result.needNewDevice,true);assert.equal(JSON.stringify(calls).includes('test-password'),false);assert.equal(calls[1].body.passwordMd5,createHash('md5').update('test-password').digest('hex'));assert.equal((await adapter.state()).loggedIn,false);await assert.rejects(adapter.configure(),/先完成QQ登录/);assert.ok(!(await fs.readdir(dir)).includes('workspace.json'));}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('missing QQ service is reported honestly and cannot count as logged in',async()=>{const a=createNapcatLogin({runtimeDir:path.join(os.tmpdir(),'absent-pingu-runtime-'+Date.now())});const state=await a.state();assert.equal(state.ready,false);assert.equal(state.loggedIn,false);assert.match(state.error,/尚未准备/);});

test('expired NapCat management sessions reauthenticate after runtime restart for HTTP and JSON auth failures',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-napcat-reauth-'));await fs.mkdir(path.join(dir,'config'));await fs.writeFile(path.join(dir,'config/webui.json'),JSON.stringify({port:6099,token:'synthetic-local-token'}));
 try{for(const mode of ['http401','http403','bodyUnauthorized','body401']){
  let auths=0,calls=0,restarted=false;
  const a=createNapcatLogin({runtimeDir:dir,fetcher:async(url,opts)=>{
   if(url.endsWith('/auth/login')){auths++;return Response.json({code:0,data:{Credential:'synthetic-session-'+auths}});}
   calls++;
   if(restarted&&opts.headers.authorization==='Bearer synthetic-session-1'){
    if(mode.startsWith('http'))return new Response('',{status:Number(mode.slice(4))});
    return Response.json({code:mode==='body401'?401:-1,message:'Unauthorized'});
   }
   return Response.json({code:0,data:{isLogin:true,loginPhase:'ready'}});
  }});
  assert.equal((await a.state()).loggedIn,true);restarted=true;
  assert.equal((await a.state()).loggedIn,true,mode);assert.equal(auths,2,mode);assert.equal(calls,3,mode);
 }}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('NapCat authentication retries are bounded and expired QQ login is not retried as management auth',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-napcat-auth-bounds-'));await fs.mkdir(path.join(dir,'config'));await fs.writeFile(path.join(dir,'config/webui.json'),JSON.stringify({port:6099,token:'synthetic-local-token'}));
 try{
  let auths=0,calls=0,mode='denied';
  const a=createNapcatLogin({runtimeDir:dir,fetcher:async(url)=>{
   if(url.endsWith('/auth/login')){auths++;return Response.json({code:0,data:{Credential:'synthetic-session-'+auths}});}
   calls++;return Response.json({code:-1,message:mode==='denied'?'Unauthorized':'登录态已失效，请重新登录。'});
  }});
  const failed=await a.state();assert.equal(failed.ready,false);assert.equal(failed.loggedIn,false);assert.match(failed.error,/重新鉴权失败/);assert.equal(auths,2);assert.equal(calls,2);
  mode='qq-expired';await assert.rejects(a.quick('12345'),/登录态已失效/);assert.equal(auths,3);assert.equal(calls,3);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('switching the runtime path reloads login config and invalidates credentials even on the same port',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-runtime-login-'));let selected=path.join(dir,'one'),auths=[];
 for(const name of ['one','two']){await fs.mkdir(path.join(dir,name,'config'),{recursive:true});await fs.writeFile(path.join(dir,name,'config','webui.json'),JSON.stringify({port:6099,token:'synthetic-'+name}));}
 const a=createNapcatLogin({runtimeDir:()=>selected,fetcher:async(url,opts)=>{if(url.endsWith('/auth/login')){auths.push(JSON.parse(opts.body).hash);return Response.json({code:0,data:{Credential:'synthetic-session-'+auths.length}});}assert.equal(opts.headers.authorization,'Bearer synthetic-session-'+auths.length);return Response.json({code:0,data:{isLogin:true}});}});
 try{assert.equal((await a.state()).loggedIn,true);selected=path.join(dir,'two');assert.equal((await a.state()).loggedIn,true);assert.equal(auths.length,2);assert.notEqual(auths[0],auths[1]);assert.ok((await a.windowUrl()).includes('synthetic-two'));}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('auto connection config keeps existing endpoints and binds only loopback',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-qq-auto-'));await fs.mkdir(path.join(dir,'config'));await fs.writeFile(path.join(dir,'config/webui.json'),JSON.stringify({port:6099,token:'token'}));let config;
 const a=createNapcatLogin({runtimeDir:dir,fetcher:async(url,opts)=>{if(url.endsWith('/auth/login'))return Response.json({code:0,data:{Credential:'session'}});if(url.endsWith('/CheckLoginStatus'))return Response.json({code:0,data:{isLogin:true}});if(url.endsWith('/GetConfig'))return Response.json({code:0,data:{network:{websocketServers:[{name:'已有',port:3001}]}}});if(url.endsWith('/SetConfig')){config=JSON.parse(JSON.parse(opts.body).config);return Response.json({code:0,data:null});}throw Error('unexpected');}});
 try{const result=await a.configure();assert.equal(config.network.websocketServers.length,2);assert.equal(config.network.websocketServers[0].name,'已有');assert.equal(config.network.websocketServers[1].name,'谷谷bot');assert.equal(config.network.websocketServers[1].host,'127.0.0.1');assert.equal(result.url,'ws://127.0.0.1:3019');assert.ok(result.token.length>=32);}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('renamed app reuses the legacy NapCat connection without duplicating it or changing its port and token',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-napcat-rename-'));await fs.mkdir(path.join(dir,'config'));await fs.writeFile(path.join(dir,'config/webui.json'),JSON.stringify({port:6099,token:'synthetic-webui-token'}));
 try{for(const hasNew of [false,true]){
  const legacy={name:'拼谷工作台',port:3027,token:'legacy-synthetic-token-'.repeat(2),enable:false},modern={name:'谷谷bot',port:3037,token:'modern-synthetic-token-'.repeat(2),enable:false};let config={network:{websocketServers:[{name:'其他连接',port:3047},legacy,...(hasNew?[modern]:[])]}};
  const a=createNapcatLogin({runtimeDir:dir,fetcher:async(url,opts)=>{
   if(url.endsWith('/auth/login'))return Response.json({code:0,data:{Credential:'synthetic-session'}});
   if(url.endsWith('/CheckLoginStatus'))return Response.json({code:0,data:{isLogin:true}});
   if(url.endsWith('/GetConfig'))return Response.json({code:0,data:structuredClone(config)});
   if(url.endsWith('/SetConfig')){config=JSON.parse(JSON.parse(opts.body).config);return Response.json({code:0,data:null});}
   throw Error('Unexpected action');
  }});
  const expected=hasNew?modern:legacy,result=await a.configure();assert.equal(result.url,'ws://127.0.0.1:'+expected.port);assert.equal(result.token,expected.token);assert.equal(config.network.websocketServers.length,hasNew?3:2);assert.equal(config.network.websocketServers[0].name,'其他连接');assert.equal(config.network.websocketServers.find(s=>s.name==='谷谷bot').enable,true);if(hasNew)assert.equal(config.network.websocketServers[1].name,'拼谷工作台');await a.configure();assert.equal(config.network.websocketServers.length,hasNew?3:2);
 }}finally{await fs.rm(dir,{recursive:true,force:true});}
});
