export function normalizeEndpoint(value) {
  const u=new URL(String(value||'').trim());
  if(u.username||u.password||u.search||u.hash)throw new Error('API 基础地址不能包含账号、密钥、查询参数或锚点');
  if(u.protocol!=='https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('API 地址须使用 HTTPS；本机服务可使用 HTTP');
  u.pathname=u.pathname.replace(/\/chat\/completions\/?$/,'').replace(/\/$/,'');
  return u.href.replace(/\/$/,'');
}
export function normalizeKey(value) {
  const key=String(value).trim().replace(/^Bearer\s+/i,'').trim();
  if(!key||/\s/.test(key))throw new Error('API 密钥不能为空或含有空白字符，请重新复制完整密钥');
  return key;
}
export function modelHttpError(status) {
  const hints={401:'鉴权失败：请确认 API 基础地址属于密钥对应的服务商，重新复制有效密钥并保存。修改模型名称不能解决密钥鉴权失败。',402:'账户余额不足，请检查服务商账户余额。',403:'服务拒绝访问，请检查密钥权限及模型访问权限。',404:'接口或模型不存在，请检查 API 基础地址和模型名称。',400:'请求格式或模型参数不受支持；图片任务还需确认模型支持图片。',422:'模型参数不正确，请检查模型名称与图片支持。',429:'服务限流或配额超限，请稍后重试。'};
  return `模型服务返回 HTTP ${status}。${hints[status]||'服务暂时不可用，请稍后重试。'}`;
}
export async function upstreamError(response,apiKey='') {
  let reason='';
  try{const data=await response.json();reason=typeof data.error?.message==='string'?data.error.message:typeof data.message==='string'?data.message:'';}catch{}
  if(apiKey)reason=reason.split(apiKey).join('[密钥]');
  reason=reason.replace(/data:image\/[^;,]+;base64,[A-Za-z0-9+/=]+/gi,'[图片]').replace(/Bearer\s+[^\s"',]+/gi,'Bearer [密钥]').replace(/sk-[A-Za-z0-9_-]+/g,'[密钥]').slice(0,600);
  return modelHttpError(response.status)+(reason?' 服务详情：'+reason:'');
}
