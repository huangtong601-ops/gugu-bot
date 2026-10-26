import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {businessState} from './operation-history.mjs';
const digest=data=>createHash('sha256').update(data).digest('hex');
const mediaPattern=/^\/media\/([a-f0-9-]+\.(?:png|jpg|webp))$/;
export const backupFingerprint=db=>digest(JSON.stringify(businessState(db)));
export function backupCounts(data){return {campaigns:data.campaigns.length,products:data.campaigns.reduce((n,c)=>n+(c.products?.length||0),0),records:data.campaigns.reduce((n,c)=>n+(c.records?.length||0),0)};}
function validateData(data){
 if(!data||!Array.isArray(data.campaigns)||!Array.isArray(data.albums)||!Array.isArray(data.qqGroups)||!data.members||typeof data.members!=='object'||!data.groupMembers||typeof data.groupMembers!=='object')throw Error('备份数据结构不正确');
 const ids=new Set();for(const c of data.campaigns){if(!c.id||ids.has(c.id)||!Array.isArray(c.products)||!Array.isArray(c.records)||!Array.isArray(c.categories))throw Error('备份期次数据不完整');ids.add(c.id);const products=new Set(c.products.map(p=>p.id));if(products.size!==c.products.length||c.records.some(r=>!products.has(r.skuId)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>999))throw Error('备份商品或排量数据无效');}
 return data;
}
const mediaNames=data=>{const found=new Set();const visit=v=>{if(typeof v==='string'){const m=v.match(mediaPattern);if(m)found.add(m[1]);}else if(v&&typeof v==='object')for(const item of Object.values(v))visit(item);};visit(data);return [...found];};
export async function createWorkspaceBackups(dataDir,{clean=v=>v,now=()=>Date.now(),retain=30}={}){
 const dir=path.join(dataDir,'workspace-backups'),objects=path.join(dir,'media');await fs.mkdir(objects,{recursive:true});let lastAutomatic=0,queue=Promise.resolve();
 const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 const file=id=>{if(typeof id!=='string'||!/^\d{13}-[a-f0-9-]{36}$/.test(id))throw Error('备份编号无效');return path.join(dir,id+'.json');};
 async function read(id){const target=file(id),info=await fs.lstat(target);if(!info.isFile()||info.size>64*1024*1024)throw Error('备份文件无效');const envelope=JSON.parse(await fs.readFile(target,'utf8'));if(envelope.format!=='pingu-business-backup/1'||envelope.hash!==digest(JSON.stringify(envelope.data)))throw Error('备份校验失败');validateData(envelope.data);if(!Array.isArray(envelope.media))throw Error('备份图片清单无效');return envelope;}
 async function list(){const rows=[];for(const name of await fs.readdir(dir)){if(!/^\d{13}-[a-f0-9-]{36}\.json$/.test(name))continue;const id=name.slice(0,-5);try{const e=await read(id);rows.push({id,at:e.at,reason:e.reason,...backupCounts(e.data),images:e.media.length});}catch{rows.push({id,invalid:true,at:new Date(Number(id.slice(0,13))).toISOString(),reason:'备份校验失败'});}}return rows.sort((a,b)=>b.id.localeCompare(a.id));}
 async function make(db,reason='手动备份'){
  const data=validateData(clean(businessState(db))),media=[];
  for(const name of mediaNames(data)){
   const source=path.join(dataDir,'media',name);let bytes;try{const stat=await fs.lstat(source);if(!stat.isFile()||stat.size>8*1024*1024)throw Error('图片文件无效');bytes=await fs.readFile(source);}catch(e){throw Error('备份图片不完整，请先检查本地商品图片');}
   const hash=digest(bytes),object=hash+path.extname(name);try{await fs.writeFile(path.join(objects,object),bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
   media.push({name,object,hash});
  }
  const id=String(now())+'-'+randomUUID(),envelope={format:'pingu-business-backup/1',at:new Date(now()).toISOString(),reason,data,media,hash:digest(JSON.stringify(data))};
  const target=file(id);await fs.writeFile(target+'.tmp',JSON.stringify(envelope));await fs.rename(target+'.tmp',target);
  const rows=await list();for(const row of rows.slice(retain))await fs.unlink(file(row.id));
  // Content-addressed image objects are shared by snapshots and are only pruned after manifests.
  const referenced=new Set();for(const row of rows.slice(0,retain))try{for(const m of (await read(row.id)).media)referenced.add(m.object);}catch{}
  for(const object of await fs.readdir(objects))if(/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(object)&&!referenced.has(object))await fs.unlink(path.join(objects,object));
  return {id,at:envelope.at,reason,...backupCounts(data),images:media.length};
 }
 async function verified(id){const envelope=await read(id);for(const m of envelope.media){if(!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(m.name)||!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(m.object)||!m.object.startsWith(m.hash+'.'))throw Error('备份图片清单无效');const target=path.join(objects,m.object),stat=await fs.lstat(target);if(!stat.isFile()||stat.size>8*1024*1024||digest(await fs.readFile(target))!==m.hash)throw Error('备份图片校验失败');}if(mediaNames(envelope.data).some(name=>!envelope.media.some(m=>m.name===name)))throw Error('备份缺少商品图片');return envelope;}
 return {list,create:(db,reason)=>serial(()=>make(db,reason)),
  async automatic(db){if(now()-lastAutomatic<3600000)return null;const result=await serial(async()=>{if(now()-lastAutomatic<3600000)return null;const rows=await list(),last=rows.find(r=>r.reason==='自动备份'&&!r.invalid);if(last&&now()-Date.parse(last.at)<3600000){lastAutomatic=Date.parse(last.at);return null;}const item=await make(db,'自动备份');lastAutomatic=now();return item;});return result;},
  async preview(db,id){const e=await verified(id);return {id,at:e.at,reason:e.reason,hash:e.hash,currentHash:backupFingerprint(db),current:backupCounts(businessState(db)),backup:backupCounts(e.data),campaignNames:e.data.campaigns.map(c=>c.name),images:e.media.length};},
  async restore(db,{id,hash,currentHash}){return serial(async()=>{
   if(currentHash!==backupFingerprint(db))throw Error('工作区已变化，请重新预览后恢复');
   const e=await verified(id);if(hash!==e.hash)throw Error('备份已变化，请重新预览');
   const imageBytes=new Map();for(const m of e.media)imageBytes.set(m.name,await fs.readFile(path.join(objects,m.object)));
   await make(db,'恢复前备份');await fs.mkdir(path.join(dataDir,'media'),{recursive:true});
   const remap=new Map();
   for(const m of e.media){
    let name=m.name,exists=false;const destination=path.join(dataDir,'media',name);
    try{const stat=await fs.lstat(destination);if(!stat.isFile())throw Error('图片目标无效');exists=true;if(digest(await fs.readFile(destination))!==m.hash)name=randomUUID()+path.extname(m.name);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(!exists||name!==m.name)await fs.writeFile(path.join(dataDir,'media',name),imageBytes.get(m.name),{flag:'wx'});
    if(name!==m.name)remap.set('/media/'+m.name,'/media/'+name);
   }
   const replace=value=>typeof value==='string'?(remap.get(value)||value):Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item)])):value;
   return replace(e.data);
  });},
  idle:()=>queue};
}
