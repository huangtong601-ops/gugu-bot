const secretField=/^(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|authorization|password(?:md5)?|qq[_-]?password|qq[_-]?token|gateway[_-]?token|passwd|credential|token|secret(?:key)?|client[_-]?secret)$/i;
const unsafeField=new Set(['__proto__','prototype','constructor']);
export function createPrivacyGuard(){
 const secrets=new Set();
 function remember(value){
  if(typeof value!=='string'||value.length<4)return;
  secrets.add(value);secrets.add(encodeURIComponent(value));secrets.add(Buffer.from(value).toString('base64'));secrets.add(JSON.stringify(value).slice(1,-1));
 }
 function text(value){
  let out=String(value??'');for(const secret of [...secrets].sort((a,b)=>b.length-a.length))out=out.split(secret).join('[已隐藏]');
  return out.replace(/Bearer\s+[^\s"',]+/gi,'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]{8,}/g,'[已隐藏]').replace(/([?&](?:access_token|api_key|apikey|token|password)=)[^&#\s"<>]*/gi,'$1[已隐藏]');
 }
 function clean(value,depth=0){
  if(depth>60)throw Error('数据嵌套过深');
  if(typeof value==='string')return text(value);
  if(Array.isArray(value))return value.map(item=>clean(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!secretField.test(key)&&!unsafeField.has(key)).map(([key,item])=>[key,clean(item,depth+1)]));
  return value;
 }
 function error(e){
  if(/^E(?:NOENT|ACCES|PERM|NOSPC|IO|ROFS|BUSY)$/.test(String(e?.code||'')))return '本地数据操作失败，请管理员在程序内检查';
  return text(e?.message||e||'操作失败').replace(/'([A-Za-z]:[\\/][^']*)'/g,"'[本地路径]'").replace(/(?:[A-Za-z]:[\\/]|file:\/\/\/)[^\s"'\r\n]+/g,'[本地路径]');
 }
 return {remember,text,clean,error};
}
export function trustedLocalRequest(req,port){
 const origin=`http://127.0.0.1:${port}`;
 if(req.headers.host!==`127.0.0.1:${port}`)return false;
 if(req.headers.origin&&req.headers.origin!==origin)return false;
 const site=req.headers['sec-fetch-site'];if(site&&site!=='same-origin'&&site!=='none')return false;
 return req.method!=='POST'||req.headers.origin===origin;
}
export function textMessage(value){return [{type:'text',data:{text:String(value??'')}}];}
