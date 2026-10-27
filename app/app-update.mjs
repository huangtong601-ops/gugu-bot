import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const updateRepository='huangtong601-ops/gugu-bot';
const feed=`https://api.github.com/repos/${updateRepository}/releases/latest`;
const maxZip=512*1024*1024;
export function versionParts(value){const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value));if(!m)throw Error('发布版本号无效');const parts=m.slice(1).map(Number);if(parts.some(n=>!Number.isSafeInteger(n)))throw Error('发布版本号无效');return parts;}
export function newerVersion(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
export function releaseAsset(value,version,name){
 const expected=`https://github.com/${updateRepository}/releases/download/v${version}/${name}`;
 if(!value||value.name!==name||value.browser_download_url!==expected||!Number.isSafeInteger(value.size)||value.size<=0||value.size>maxZip)throw Error('发布附件不完整或地址无效');
 return {name,url:expected,size:value.size};
}
export function releaseInfo(data,currentVersion){
 if(!data||data.draft||data.prerelease)throw Error('未找到正式发布版本');
 const version=versionParts(data.tag_name).join('.');if(data.tag_name!=='v'+version||!Array.isArray(data.assets))throw Error('发布信息无效');
 const available=newerVersion(version,currentVersion),name=`gugu-bot-v${version}-win32-x64.zip`;
 return {version,available,notes:String(data.body||'').slice(0,12000),page:`https://github.com/${updateRepository}/releases/tag/v${version}`,...(available?{zip:releaseAsset(data.assets.find(a=>a.name===name),version,name),sums:releaseAsset(data.assets.find(a=>a.name==='SHA256SUMS.txt'),version,'SHA256SUMS.txt')}:{})};
}
export function checksumFor(text,name){
 const matches=String(text).split(/\r?\n/).map(l=>/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i.exec(l)).filter(m=>m&&m[2]===name);
 if(matches.length!==1)throw Error('校验清单缺少唯一的Windows包校验值');return matches[0][1].toLowerCase();
}
// GitHub release assets redirect to these hosts; no user-supplied feeds or credentials.
async function downloadResponse(fetcher,url,signal){
 for(let hop=0;hop<5;hop++){
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('更新下载地址不受信任');
  const r=await fetcher(u.href,{redirect:'manual',signal,headers:{'user-agent':'gugu-bot-updater','accept':'application/octet-stream'}});
  if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw Error('更新下载重定向无效');url=new URL(next,u).href;continue;}
  if(!r.ok)throw Error(`下载更新失败（HTTP ${r.status}）`);return r;
 }throw Error('更新下载重定向过多');
}
async function bytes(response,limit){const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('更新响应超过大小限制');chunks.push(chunk);}return Buffer.concat(chunks);}
export function createAppUpdater({currentVersion,cacheDir,fetcher=fetch,prepare,install,supported=true,lastResult=null}){
 versionParts(currentVersion);let state={phase:'idle',currentVersion,version:null,transferred:0,total:null,error:'',notes:'',supported,lastResult},release=null,job=null,busy=false;
 const snapshot=()=>structuredClone({...state,canInstall:!!job&&!busy,canDownload:!!release?.available&&!job&&!busy});
 async function operation(fn){if(busy)return snapshot();busy=true;try{await fn();state.error='';}catch(e){state.phase='error';state.error=e.message?.includes('HTTP')||/^(发布|更新|校验|未找到|下载|只支持|安装)/.test(e.message)?e.message:'更新操作失败，请检查网络、磁盘空间和目录权限';}finally{busy=false;}return snapshot();}
 return {snapshot,
  check:()=>operation(async()=>{if(!supported)throw Error('只支持Windows x64桌面版更新');state.phase='checking';state.error='';job=null;release=null;
   const r=await fetcher(feed,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/vnd.github+json','user-agent':'gugu-bot-updater'}});if(!r.ok)throw Error(`检查更新失败（HTTP ${r.status}）`);
   release=releaseInfo(JSON.parse((await bytes(r,1024*1024)).toString('utf8')),currentVersion);state={...state,version:release.version,notes:release.notes,page:release.page,checkedAt:new Date().toISOString(),phase:release.available?'available':'up-to-date',transferred:0,total:release.zip?.size??null};
  }),
  download:()=>operation(async()=>{if(!release?.available||!['available','error'].includes(state.phase))throw Error('更新包尚未就绪，请先检查更新');state.phase='downloading';state.transferred=0;state.error='';
   const signal=AbortSignal.timeout(15*60*1000),sumResponse=await downloadResponse(fetcher,release.sums.url,signal),sumBytes=await bytes(sumResponse,65536);if(sumBytes.length!==release.sums.size)throw Error('校验清单长度不一致');const expected=checksumFor(sumBytes.toString('utf8'),release.zip.name);
   const dir=path.join(cacheDir,randomUUID());await fs.mkdir(dir,{recursive:true});const zip=path.join(dir,'release.zip'),handle=await fs.open(zip,'wx'),hash=createHash('sha256');
   try{const r=await downloadResponse(fetcher,release.zip.url,signal);for await(const chunk of r.body){state.transferred+=chunk.length;if(state.transferred>release.zip.size||state.transferred>maxZip)throw Error('更新包超过声明大小');hash.update(chunk);await handle.writeFile(chunk);}if(state.transferred!==release.zip.size||hash.digest('hex')!==expected)throw Error('校验失败，更新包已拒绝');}finally{await handle.close();}
   job=await prepare({dir,zip,version:release.version});state.phase='ready';
  }),
  install:()=>operation(async()=>{if(!job||!['ready','error'].includes(state.phase))throw Error('更新尚未下载校验完成');const accepted=await install(job);state.phase=accepted?'installing':'ready';})
 };
}
