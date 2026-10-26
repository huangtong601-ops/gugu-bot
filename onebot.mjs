import {createPrivacyGuard,textMessage} from './security.mjs';
// OneBot v11 forward WebSocket. Album-comment event support is gateway-specific.
export function connectOneBot({url,token,onEvent,WebSocketClass=WebSocket}){
 const privacy=createPrivacyGuard();privacy.remember(token);
 const u=new URL(url);if(!['ws:','wss:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('QQ网关请选择不含凭据的本机 ws:// 地址');if(token)u.searchParams.set('access_token',token);
 const pending=new Map();let ws,state='连接中',closed=false,retryTimer,retries=0,lastError='';
 function rejectPending(){for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('QQ网关已断开'));}pending.clear();}
 function connect(){if(closed)return;state='连接中';const current=new WebSocketClass(u.href);ws=current;
   current.addEventListener('open',()=>{if(ws!==current)return;state='已连接';retries=0;});
   current.addEventListener('close',()=>{if(ws!==current)return;rejectPending();state=closed?'已断开':'重连中';if(!closed)retryTimer=setTimeout(connect,Math.min(30000,1500*2**Math.min(retries++,4)));});
   current.addEventListener('error',()=>{lastError='QQ网关连接失败';});
   current.addEventListener('message',async event=>{if(ws!==current)return;try{const e=JSON.parse(String(event.data));if(e.echo&&pending.has(e.echo)){const p=pending.get(e.echo);pending.delete(e.echo);clearTimeout(p.timer);if(e.status==='failed'||e.retcode)p.reject(Error(privacy.error(e.message||e.wording||'QQ接口调用失败')));else p.resolve(e.data);return;}await onEvent(e);}catch(e){lastError=privacy.error(e);}});
 }
 connect();
 return {status:()=>state,lastError:()=>lastError,close(){closed=true;clearTimeout(retryTimer);rejectPending();ws?.close();},call(action,params){if(['send_group_msg','send_private_msg'].includes(action)&&typeof params?.message==='string')params={...params,message:textMessage(privacy.text(params.message)),auto_escape:true};return new Promise((resolve,reject)=>{if(ws?.readyState!==1)return reject(Error('QQ网关未连接'));const echo=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(echo);reject(Error('QQ接口超时'));},15000);pending.set(echo,{resolve,reject,timer});try{ws.send(JSON.stringify({action,params,echo}));}catch{pending.delete(echo);clearTimeout(timer);reject(Error('QQ接口发送失败'));}});}};
}
