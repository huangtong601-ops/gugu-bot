import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createAppUpdater,releaseInfo,newerVersion,checksumFor} from './app-update.mjs';
import appMetadata from './app-metadata.cjs';
test('version discovery works in flat packages and source repos with app subdirectory',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gugu-metadata-test-'));const sub=path.join(dir,'app');await fs.mkdir(sub);
 try{await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:'pingu-desk',version:'0.3.3'}));assert.equal(appMetadata(sub).version,'0.3.3');await fs.writeFile(path.join(sub,'package.json'),JSON.stringify({name:'pingu-desk',version:'0.4.0'}));assert.equal(appMetadata(sub).version,'0.4.0');}finally{await fs.rm(dir,{recursive:true,force:true});}
});
const repo='https://github.com/huangtong601-ops/gugu-bot/releases/download/v0.4.0/',name='gugu-bot-v0.4.0-win32-x64.zip',payload=Buffer.from('synthetic release fixture'),hash=createHash('sha256').update(payload).digest('hex'),sums=Buffer.from(`${hash}  ${name}\n`);
const asset=(name,size)=>({name,size,browser_download_url:repo+name});
const release=()=>({tag_name:'v0.4.0',draft:false,prerelease:false,body:'测试更新说明',assets:[asset(name,payload.length),asset('SHA256SUMS.txt',sums.length)]});
test('update feed rejects downgrade, prerelease, foreign assets, absent checksums and ambiguous checksum rows',()=>{
 assert.ok(newerVersion('0.10.0','0.9.9'));assert.equal(newerVersion('0.3.2','0.3.3'),false);assert.throws(()=>newerVersion('0.4.0-beta','0.3.3'));
 assert.equal(releaseInfo({...release(),tag_name:'v0.3.2',assets:[]},'0.3.3').available,false);
 for(const data of [{...release(),draft:true},{...release(),prerelease:true},{...release(),assets:[]},{...release(),assets:[{...asset(name,10),browser_download_url:'https://evil.test/a.zip'},asset('SHA256SUMS.txt',10)]}])assert.throws(()=>releaseInfo(data,'0.3.3'));
 assert.equal(checksumFor(sums,name),hash);assert.throws(()=>checksumFor(sums.toString().repeat(2),name));
});
test('download verifies checksum, exposes progress, serializes actions and installs only prepared files with explicit callback',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gugu-update-test-'));let installs=0,prepared=0,calls=0,allow=false;
 const fetcher=async(url,options)=>{calls++;assert.equal(options.redirect==='manual'||options.redirect==='error',true);if(String(url).includes('api.github.com'))return Response.json(release());return new Response(String(url).endsWith('SHA256SUMS.txt')?sums:payload);};
 try{const updater=createAppUpdater({currentVersion:'0.3.3',cacheDir:dir,fetcher,prepare:async job=>{assert.deepEqual(await fs.readFile(job.zip),payload);prepared++;return job;},install:async()=>{installs++;return allow;}});
  assert.equal((await updater.install()).phase,'error');assert.equal(installs,0);
  assert.equal((await updater.check()).phase,'available');assert.equal((await updater.download()).phase,'ready');assert.equal(prepared,1);assert.equal(updater.snapshot().transferred,payload.length);
  assert.equal((await updater.install()).phase,'ready');allow=true;assert.equal((await updater.install()).phase,'installing');assert.equal(installs,2);assert.equal(calls,3);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('damaged payload and off-domain redirects never reach preparation/install; repeated check cannot race download',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gugu-update-reject-'));let prepared=0;
 try{for(const redirect of [false,true]){const updater=createAppUpdater({currentVersion:'0.3.3',cacheDir:dir,fetcher:async url=>String(url).includes('api.github.com')?Response.json(release()):String(url).endsWith('SHA256SUMS.txt')?new Response(sums):redirect?new Response(null,{status:302,headers:{location:'https://evil.test/steal'}}):new Response('damaged payload'),prepare:async()=>{prepared++;},install:async()=>{throw Error('must not install');}});
   await updater.check();assert.equal((await updater.download()).phase,'error');assert.equal(updater.snapshot().canInstall,false);
  }assert.equal(prepared,0);
  let unblock;const gate=new Promise(r=>unblock=r);let fetches=0;
  const updater=createAppUpdater({currentVersion:'0.3.3',cacheDir:dir,fetcher:async()=>{fetches++;await gate;return Response.json(release());},prepare:async()=>{},install:async()=>true});const checking=updater.check();await updater.check();assert.equal(fetches,1);unblock();await checking;
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
