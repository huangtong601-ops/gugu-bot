import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {start} from './server.mjs';
import {createCredentialStore} from './credentials.mjs';
import {serverCodec} from './server-vault.mjs';
import {serverToken} from './server-connection.mjs';
import {startServerGateway} from './server-gateway.mjs';

export async function initializeServer(dataDir){
 dataDir=path.resolve(dataDir);await fs.mkdir(dataDir,{recursive:true,mode:0o700});
 // Never overwrite an existing instance or its keys.
 const existing=await fs.readdir(dataDir);if(existing.length)throw Error('初始化需要空的数据目录，已有数据请使用start');
 const config={serverId:randomUUID(),name:'谷谷bot服务器',port:3220,napcatDir:''};
 await fs.writeFile(path.join(dataDir,'master-key.bin'),randomBytes(32),{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dataDir,'access-token.txt'),randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dataDir,'server-config.json'),JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
 return {initialized:true};
}
async function privateFile(file){const stat=await fs.stat(file);if(process.platform!=='win32'&&(stat.mode&0o077))throw Error('服务器密钥文件权限须为600');return fs.readFile(file);}
export async function runServer({dataDir,env=process.env,backendOptions={}}){
 dataDir=path.resolve(dataDir);const config=JSON.parse(await fs.readFile(path.join(dataDir,'server-config.json'),'utf8'));
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(config.serverId)||!Number.isInteger(config.port)||config.port<1||config.port>65535)throw Error('服务器配置无效');
 const token=serverToken((await privateFile(path.join(dataDir,'access-token.txt'))).toString('utf8').trim());
 const credentialStore=createCredentialStore(dataDir,serverCodec(await privateFile(path.join(dataDir,'master-key.bin'))));
 const lockFile=path.join(dataDir,'.server.lock');let lock;
 try{lock=await fs.open(lockFile,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;const old=JSON.parse(await fs.readFile(lockFile,'utf8'));let alive=true;try{process.kill(old.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}if(alive)throw Error('此工作区已有服务器运行，不能重复启动');await fs.unlink(lockFile);lock=await fs.open(lockFile,'wx',0o600);}
 await lock.writeFile(JSON.stringify({pid:process.pid}));await lock.close();
 let backend,gateway,closed=false;
 const close=async()=>{if(closed)return;closed=true;if(gateway)await new Promise(r=>gateway.server.close(r));if(backend)await backend.shutdown();await fs.unlink(lockFile).catch(()=>{});};
 try{
  let qqConfig=null;if(env.PINGU_ONEBOT_URL){if(!env.PINGU_ONEBOT_TOKEN_FILE)throw Error('请配置PINGU_ONEBOT_TOKEN_FILE');qqConfig={url:env.PINGU_ONEBOT_URL,token:(await privateFile(env.PINGU_ONEBOT_TOKEN_FILE)).toString('utf8').trim()};}
  backend=await start({...backendOptions,port:0,dataDir,credentialStore,allowServerConnection:false,napcatRuntimeDir:config.napcatDir||'',qqConfig,desktopActions:{qqRuntimeInfo:async()=>({supported:false,available:!!config.napcatDir,remote:true})}});
  gateway=await startServerGateway({backendUrl:backend.url,token,serverId:config.serverId,name:String(config.name||'谷谷bot服务器').slice(0,80),port:config.port});
  return {url:gateway.url,close,backend};
 }catch(e){await close();throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),command=args.shift(),dataArg=args.find(x=>x.startsWith('--data-dir='));
 if(!['init','start'].includes(command)||!dataArg||args.some(x=>x!==dataArg)){
  console.error('用法：node server-entry.mjs init|start --data-dir=<独立数据目录>');process.exitCode=1;
 }else{
  try{
   const dataDir=dataArg.slice('--data-dir='.length);if(!dataDir)throw Error('请指定独立数据目录');
   if(command==='init'){await initializeServer(dataDir);console.log('服务器初始化完成。请在本机安全读取access-token.txt用于桌面连接；不要分享密钥文件。');}
   else{const service=await runServer({dataDir});console.log('谷谷bot服务器已启动：'+service.url);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void service.close().then(()=>process.exit(0));});}
  }catch{console.error('服务器启动或初始化失败。请核对目录、配置、密钥权限及端口占用；不自动覆盖已有数据。');process.exitCode=1;}
 }
}
