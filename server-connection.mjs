import fs from 'node:fs/promises';
import path from 'node:path';
export const SERVER_PROTOCOL='pingu-server/1';
export const MAX_REQUEST=12*1024*1024,MAX_RESPONSE=64*1024*1024;
export function serverAddress(value){
 let u;try{u=new URL(String(value||'').trim());}catch{throw Error('请填写有效的服务器地址');}
 const loopback=['127.0.0.1','localhost','[::1]'].includes(u.hostname);
 if((u.protocol!=='https:'&&!(loopback&&u.protocol==='http:'))||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('请填写HTTPS服务器根地址；本机转发可使用HTTP地址');
 return u.origin;
}
export function serverToken(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(value))throw Error('请填写服务器生成的访问令牌');return value;}
export function resourcePath(raw){
 if(typeof raw!=='string'||raw.length>4096||!raw.startsWith('/')||raw.startsWith('//')||/[\\\r\n]/.test(raw))return null;
 const u=new URL(raw,'http://pingu.local');
 if(u.origin!=='http://pingu.local'||u.hash||!(/^\/api\/[a-z][a-z0-9-]*$/.test(u.pathname)||/^\/media\/[a-zA-Z0-9_.-]+$/.test(u.pathname)))return null;
 if(raw.split('?')[0]!==u.pathname)return null;
 return u.pathname+u.search;
}
export async function limitedBody(stream,limit){const chunks=[];let size=0;for await(const chunk of stream){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>limit)throw Error('传输内容超过大小限制');chunks.push(bytes);}return Buffer.concat(chunks);}
export const connectionRoute=p=>['/api/server-connection','/api/server-test'].includes(p);
export async function createServerConnection({dataDir,credentialStore,privacy,fetcher=fetch,beforeChange=async()=>{},afterChange=async()=>{}}){
 const file=path.join(dataDir,'server-connection.json');let config={mode:'local',url:'',serverId:'',name:''},busy=false,inFlight=0,lastSuccess='',lastError='';
 try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(!['local','remote'].includes(saved.mode))throw Error();config={mode:saved.mode,url:saved.url?serverAddress(saved.url):'',serverId:String(saved.serverId||''),name:String(saved.name||'').slice(0,80)};if(config.mode==='remote'&&(!config.url||!config.serverId))throw Error();}catch(e){if(e.code!=='ENOENT')throw Error('服务器连接配置无法读取，请先修复本机连接配置');}
 const keyFor=url=>({provider:'pingu-server',baseUrl:url});
 async function secret(url,value){const key=String(value||'').trim()||await credentialStore.get(keyFor(url));privacy.remember(key);return serverToken(key);}
 async function request(url,token,route,options={}){try{return await fetcher(url+route,{...options,headers:{...(options.headers||{}),authorization:'Bearer '+token},redirect:'error',signal:options.signal||AbortSignal.timeout(240000)});}catch{throw Error('无法连接服务器，请检查地址、证书和网络');}}
 function failure(status){return Error(status===401?'服务器访问令牌无效或已失效':status===403?'服务器拒绝访问':`服务器请求失败（HTTP ${status}）`);}
 async function probe(url,value){
  url=serverAddress(url);const token=await secret(url,value),r=await request(url,token,'/api/server-info',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw failure(r.status);
  let info;try{info=JSON.parse((await limitedBody(r.body,16384)).toString('utf8'));}catch{throw Error('服务器返回的连接信息无效');}
  if(info.protocol!==SERVER_PROTOCOL||typeof info.serverId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(info.serverId)||!['workspace','albums','exports'].every(x=>info.capabilities?.includes(x)))throw Error('服务器版本不兼容，请更新服务器端程序');
  return {url,token,info:{protocol:SERVER_PROTOCOL,serverId:info.serverId,name:privacy.text(String(info.name||'谷谷bot服务器')).slice(0,80),version:String(info.version||'').slice(0,32)}};
 }
 async function view(){return {...config,hasToken:!!(config.url&&await credentialStore.get(keyFor(config.url))),busy,lastSuccess,lastError};}
 return {
  get remote(){return config.mode==='remote';},get busy(){return busy;},view,
  async test(body){const r=await probe(body.url,body.token);return {ok:true,...r.info};},
  async configure(body){
   if(busy||inFlight)throw Error('服务器仍有操作正在处理，请完成后再切换');if(!['local','remote'].includes(body.mode))throw Error('请选择运行方式');busy=true;let prepared=false;
   try{
    let next={...config,mode:body.mode},candidate;
    if(body.mode==='remote'){candidate=await probe(body.url,body.token);next={mode:'remote',url:candidate.url,serverId:candidate.info.serverId,name:candidate.info.name};}
    await beforeChange(next);prepared=true;
    if(candidate)await credentialStore.set(keyFor(next.url),candidate.token);
    await fs.writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await fs.rename(file+'.tmp',file);config=next;lastError='';lastSuccess=candidate?new Date().toISOString():'';
    await afterChange(config);return {ok:true,...await view()};
   }catch(e){lastError=privacy.error(e);if(prepared)await afterChange(config);throw Error(lastError);}finally{busy=false;}
  },
  async forward(req,res){
   const route=resourcePath(req.url);if(!route||connectionRoute(route.split('?')[0])||!['GET','POST'].includes(req.method))throw Error('服务器请求路径无效');
   if(req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw Error('请使用JSON请求');
   inFlight++;
   try{
    const token=await secret(config.url),body=req.method==='POST'?await limitedBody(req,MAX_REQUEST):undefined;
    const r=await request(config.url,token,route,{method:req.method,headers:req.method==='POST'?{'content-type':'application/json'}:{},...(body?{body}:{})});
    if(r.headers.get('x-pingu-server-id')!==config.serverId)throw Error('服务器身份发生变化，请在设置中重新验证连接');
    if(r.status===401||r.status===403)throw failure(r.status);
    let bytes=await limitedBody(r.body,MAX_RESPONSE);const type=r.headers.get('content-type')||'application/octet-stream';
    if(/json|^text\//i.test(type))bytes=Buffer.from(privacy.text(bytes.toString('utf8')));
    const headers={'content-type':type,'cache-control':'no-store'};const disposition=r.headers.get('content-disposition');if(disposition)headers['content-disposition']=disposition;
    lastSuccess=new Date().toISOString();lastError='';res.writeHead(r.status,headers);res.end(bytes);
   }catch(e){lastError=privacy.error(e);throw Error(lastError);}finally{inFlight--;}
  }
 };
}
