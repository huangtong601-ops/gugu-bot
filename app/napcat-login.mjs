import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createPrivacyGuard} from './security.mjs';
export function createNapcatLogin({runtimeDir,fetcher=fetch}){
 const privacy=createPrivacyGuard();
 let credential='',base='',lastToken='',lastStatus=null;
 async function localConfig(){
   const directory=typeof runtimeDir==='function'?runtimeDir():runtimeDir;
   const file=path.join(directory,'config','webui.json');let cfg;try{cfg=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw Error('QQ登录服务尚未准备好，请先准备并启动QQ环境');}
   if(!Number.isInteger(cfg.port)||cfg.port<1||cfg.port>65535||!cfg.token)throw Error('QQ登录服务配置无效');
   privacy.remember(cfg.token);return {base:'http://127.0.0.1:'+cfg.port,token:cfg.token};
 }
 async function request(route,body,auth=true,retried=false){
   privacy.remember(body?.passwordMd5);privacy.remember(body?.hash);
   const cfg=await localConfig();if(cfg.base!==base||cfg.token!==lastToken){credential='';base=cfg.base;lastToken=cfg.token;}
   if(auth&&!credential){const login=await request('/auth/login',{hash:createHash('sha256').update(cfg.token+'.napcat').digest('hex')},false);if(login.require2FA)throw Error('QQ管理服务需要二次验证，请打开QQ登录窗口完成');credential=login.Credential;privacy.remember(credential);if(!credential)throw Error('QQ登录服务鉴权失败');}
   let r;try{r=await fetcher(base+'/api'+route,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+credential}:{})},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(25000)});}catch{throw Error('QQ登录服务未启动或响应超时');}
   if(r.status===401||r.status===403){credential='';if(auth&&!retried)return request(route,body,true,true);throw Error('QQ管理会话重新鉴权失败，请检查QQ运行环境');}if(!r.ok)throw Error('QQ登录服务请求失败（HTTP '+r.status+'）');
   const result=await r.json();
   // NapCat also reports expired WebUI sessions as HTTP 200 + code:-1 Unauthorized.
   // Only retry an explicit authentication rejection, once; never retry login/business failures.
   if(result.code!==0&&(Number(result.code)===401||Number(result.code)===403||/^(?:Unauthorized|Forbidden)$/i.test(String(result.message||'').trim()))){credential='';if(auth&&!retried)return request(route,body,true,true);throw Error('QQ管理会话重新鉴权失败，请检查QQ运行环境');}
   if(result.code!==0)throw Error(privacy.error(result.message||'QQ登录服务返回错误'));return result.data;
 }
 return {
   async windowUrl(){const c=await localConfig();return c.base+'/webui/?token='+encodeURIComponent(c.token);},
   async state(){try{const s=await request('/QQLogin/CheckLoginStatus');lastStatus={ready:true,loggedIn:s.isLogin===true,phase:privacy.text(s.loginPhase||''),error:privacy.text(s.loginError||''),needsConfirmation:s.qrLoginAccepted===true};return lastStatus;}catch(e){return {ready:false,loggedIn:false,error:privacy.error(e)};}},
   async password(qq,password){if(!/^\d{5,12}$/.test(String(qq))||typeof password!=='string'||!password||password.length>128)throw Error('请填写QQ号和密码');privacy.remember(password);const passwordMd5=createHash('md5').update(password).digest('hex');const r=await request('/QQLogin/PasswordLogin',{uin:String(qq),passwordMd5});return {submitted:true,needCaptcha:r?.needCaptcha===true,needNewDevice:r?.needNewDevice===true};},
   async quick(qq){if(!/^\d{5,12}$/.test(String(qq)))throw Error('请填写QQ号');await request('/QQLogin/SetQuickLogin',{uin:String(qq)});return {submitted:true};},
   async remember(qq){if(!/^\d{5,12}$/.test(String(qq)))throw Error('QQ账号身份无效');await request('/QQLogin/SetQuickLoginQQ',{uin:String(qq)});},
   async configure(){const s=await this.state();if(!s.loggedIn)throw Error('请先完成QQ登录');const cfg=await request('/OB11Config/GetConfig');cfg.network??={};cfg.network.websocketServers??=[];let server=cfg.network.websocketServers.find(s=>s.name==='谷谷bot')||cfg.network.websocketServers.find(s=>s.name==='拼谷工作台');if(!server){server={name:'谷谷bot',enable:true,host:'127.0.0.1',port:3019,messagePostFormat:'array',reportSelfMessage:false,enableForcePushEvent:true,token:randomBytes(24).toString('hex'),debug:false,heartInterval:30000};cfg.network.websocketServers.push(server);}server.name='谷谷bot';server.host='127.0.0.1';server.enable=true;server.messagePostFormat='array';if(typeof server.token!=='string'||server.token.length<32)server.token=randomBytes(24).toString('hex');await request('/OB11Config/SetConfig',{config:JSON.stringify(cfg)});return {url:'ws://127.0.0.1:'+server.port,token:server.token};},
 };
}
