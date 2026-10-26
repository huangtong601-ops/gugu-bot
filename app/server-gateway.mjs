import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {SERVER_PROTOCOL,serverToken,resourcePath,limitedBody,MAX_REQUEST,MAX_RESPONSE,connectionRoute} from './server-connection.mjs';
const blocked=new Set(['/api/qq-event','/api/qq-test-group-message','/api/qq-test-admin']);
export async function startServerGateway({backendUrl,token,serverId,name='谷谷bot服务器',port=3220,fetcher=fetch}){
 serverToken(token);const expected=Buffer.from(token),origin=new URL(backendUrl).origin;
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('后台必须使用本机服务');
 const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('x-pingu-server-id',serverId);
  try{
   // This is a desktop-to-service API. Browser origins/cookies are never trusted.
   const auth=String(req.headers.authorization||''),received=Buffer.from(auth.slice(7));
   if(!auth.startsWith('Bearer ')||req.headers.origin||received.length!==expected.length||!timingSafeEqual(received,expected))return json(401,{error:'服务器鉴权失败'});
   const route=resourcePath(req.url),pathname=route?.split('?')[0];
   if(!route||connectionRoute(pathname)||blocked.has(pathname))return json(404,{error:'接口不存在'});
   if(req.method==='GET'&&pathname==='/api/server-info')return json(200,{protocol:SERVER_PROTOCOL,serverId,name,version:'0.2.0',capabilities:['workspace','albums','exports']});
   if(!['GET','POST'].includes(req.method))return json(405,{error:'不支持此操作'});
   const body=req.method==='POST'?await limitedBody(req,MAX_REQUEST):undefined;
   const r=await fetcher(origin+route,{method:req.method,headers:{origin,...(req.method==='POST'?{'content-type':'application/json'}:{})},...(body?{body}:{}),redirect:'error',signal:AbortSignal.timeout(240000)});
   const bytes=await limitedBody(r.body,MAX_RESPONSE),headers={'content-type':r.headers.get('content-type')||'application/octet-stream'};
   if(r.headers.get('content-disposition'))headers['content-disposition']=r.headers.get('content-disposition');
   res.writeHead(r.status,headers);res.end(bytes);
  }catch{if(!res.headersSent)json(502,{error:'服务器后台暂时不可用，请检查服务状态'});else res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,url:'http://127.0.0.1:'+server.address().port};
}
