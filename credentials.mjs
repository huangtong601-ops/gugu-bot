import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

// Windows web mode uses the same current-user DPAPI protection as the desktop.
function dpapi(value,decrypt=false){
  if(process.platform!=='win32')throw Error('当前系统无法安全保存密钥');
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let output='';child.stdout.on('data',b=>output+=b);child.on('error',()=>reject(Error('无法访问本机密钥保护服务')));child.on('close',code=>code===0?resolve(Buffer.from(output.trim(),'base64')):reject(Error('无法读取或保存本机密钥')));child.stdin.on('error',()=>{});child.stdin.end(value.toString('base64'));
  });
}
export function createCredentialStore(dataDir,codec={encrypt:b=>dpapi(b),decrypt:b=>dpapi(b,true)}){
  let writes=Promise.resolve();
  const file=path.join(dataDir,'credentials.json');
  const id=config=>createHash('sha256').update(JSON.stringify([config.provider,config.baseUrl])).digest('hex');
  async function read(){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw Error('本机密钥文件无法读取');}}
  return {
    async get(config){await writes;const values=await read(),entry=values[id(config)];return entry?(await codec.decrypt(Buffer.from(entry,'base64'))).toString('utf8'):'';},
    set(config,key){const task=writes.then(async()=>{const values=await read();values[id(config)]=(await codec.encrypt(Buffer.from(key,'utf8'))).toString('base64');await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(values),{mode:0o600});await fs.rename(file+'.tmp',file);});writes=task.catch(()=>{});return task;}
  };
}
