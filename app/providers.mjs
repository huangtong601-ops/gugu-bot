import {normalizeEndpoint} from './api-config.mjs';
export const providers=[
  {id:'deepseek',name:'DeepSeek',baseUrl:'https://api.deepseek.com'},
  {id:'openai',name:'OpenAI（ChatGPT）',baseUrl:'https://api.openai.com/v1'},
  {id:'custom',name:'自定义兼容服务',baseUrl:''}
];
export function providerConfig(input) {
  const provider=input.provider||inferProvider(input.baseUrl);
  const definition=providers.find(p=>p.id===provider);
  if(!definition)throw new Error('请选择支持的服务商');
  return {provider,baseUrl:definition.baseUrl||normalizeEndpoint(input.baseUrl)};
}
export function inferProvider(baseUrl) {
  try {const u=new URL(baseUrl);if(u.origin==='https://api.deepseek.com' && /^\/(v1)?\/?$/.test(u.pathname))return 'deepseek';if(u.origin==='https://api.openai.com' && /^\/v1\/?$/.test(u.pathname))return 'openai';}catch{}
  return 'custom';
}
export function modelOptions(provider,items) {
  const seen=new Set();return items.filter(m=>typeof m.id==='string' && m.id && !seen.has(m.id) && seen.add(m.id)).filter(m=>provider!=='openai'||(/^(gpt-|chatgpt-|o[134](?:-|$))/.test(m.id) && !/(audio|realtime|transcrib|tts|image|search|research|computer|codex)/i.test(m.id))).map(m=>({id:m.id,name:typeof m.name==='string'?m.name:m.id,vision:Array.isArray(m.input_modalities)?m.input_modalities.includes('image'):null})).sort((a,b)=>a.id.localeCompare(b.id));
}
export function inferenceRequest(config,skill,content) {
  const legacyChat=/^(chatgpt-|gpt-3\.5|gpt-4(?:$|-))/.test(config.model);
  if(config.provider==='openai'&&!legacyChat) {
    const parts=typeof content==='string'?[{type:'input_text',text:content}]:content.map(p=>p.type==='text'?{type:'input_text',text:p.text}:{type:'input_image',image_url:p.image_url.url});
    return {url:config.baseUrl+'/responses',body:{model:config.model,instructions:skill,input:[{role:'user',content:parts}],store:false}};
  }
  return {url:config.baseUrl+'/chat/completions',body:{model:config.model,messages:[{role:'system',content:skill},{role:'user',content}],stream:false}};
}
export function responseText(result) {
  if(typeof result.choices?.[0]?.message?.content==='string')return result.choices[0].message.content;
  return result.output?.filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join('')||null;
}
