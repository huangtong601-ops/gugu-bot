import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {root,auditPublic} from './audit-public.mjs';
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows Release请在Windows x64构建。');
const require=createRequire(import.meta.url),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('无效发布版本');
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!=='v'+pkg.version)throw Error('版本标签与package.json不一致');
const audit=await auditPublic();if(!audit.ok)throw Error('发布前隐私检查失败：'+JSON.stringify(audit.findings));
const changelog=await fs.readFile(path.join(root,'CHANGELOG.md'),'utf8');
const marker='## '+pkg.version+' ';if(!changelog.includes(marker))throw Error('缺少本版本CHANGELOG');
const notes=changelog.slice(changelog.indexOf(marker)).split(/\n## /)[0].trim();
const dist=path.join(root,'dist');await fs.mkdir(dist,{recursive:true});
const name=`gugu-bot-v${pkg.version}-win32-x64`,output=path.join(dist,name),windowsZip=path.join(dist,name+'.zip'),sourceZip=path.join(dist,`gugu-bot-source-v${pkg.version}.zip`);
for(const f of [output,windowsZip,sourceZip])if(await fs.stat(f).catch(()=>null))throw Error('构建目标已存在；请保留旧产物并使用新版本或新的干净目录。');
const electronDir=process.env.GUGU_ELECTRON_DIST?path.resolve(process.env.GUGU_ELECTRON_DIST):path.join(path.dirname(require.resolve('electron/package.json')),'dist');
await fs.access(path.join(electronDir,'electron.exe'));await fs.mkdir(output);
const runtimeFiles=['electron.exe','LICENSE','LICENSES.chromium.html','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','libEGL.dll','libGLESv2.dll','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','vk_swiftshader_icd.json','vk_swiftshader.dll','vulkan-1.dll'];
for(const file of runtimeFiles)await fs.copyFile(path.join(electronDir,file),path.join(output,file));await fs.mkdir(path.join(output,'locales'));for(const name of await fs.readdir(path.join(electronDir,'locales')))if(name.endsWith('.pak'))await fs.copyFile(path.join(electronDir,'locales',name),path.join(output,'locales',name));await fs.mkdir(path.join(output,'resources'));
await fs.rename(path.join(output,'electron.exe'),path.join(output,'谷谷bot.exe'));
await fs.rm(path.join(output,'resources/default_app.asar'),{force:true});
const appRoot=path.join(output,'resources/app');await fs.mkdir(appRoot,{recursive:true});
const sourceStage=path.join(await fs.mkdtemp(path.join(dist,'.source-')),'gugu-bot');await fs.mkdir(sourceStage);
for(const e of await fs.readdir(root,{withFileTypes:true})){
 if(e.isFile()&&/\.(?:mjs|cjs)$/.test(e.name)){await fs.copyFile(path.join(root,e.name),path.join(sourceStage,e.name));if(!e.name.endsWith('.test.mjs')&&e.name!=='test.mjs')await fs.copyFile(path.join(root,e.name),path.join(appRoot,e.name));}
}
for(const dir of ['assets','public','skills']){await fs.cp(path.join(root,dir),path.join(appRoot,dir),{recursive:true});await fs.cp(path.join(root,dir),path.join(sourceStage,dir),{recursive:true});}
for(const dir of ['scripts','release-tools','docs','.github'])await fs.cp(path.join(root,dir),path.join(sourceStage,dir),{recursive:true});
for(const file of ['package.json','package-lock.json','README.md','CHANGELOG.md','AGENTS.md','THIRD_PARTY_NOTICES.md','服务器接入.md','.gitignore','.gitattributes'])await fs.copyFile(path.join(root,file),path.join(sourceStage,file));
const releasePackage={name:pkg.name,version:pkg.version,productName:pkg.productName,type:pkg.type,main:pkg.main,private:true,description:pkg.description};await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify(releasePackage,null,2));
for(const file of ['README.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','服务器接入.md'])await fs.copyFile(path.join(root,file),path.join(output,file));
const runtimeAudit=await auditPublic(appRoot,{runtime:true});if(!runtimeAudit.ok)throw Error('运行包隐私检查失败');
const R=require('resedit'),exeFile=path.join(output,'谷谷bot.exe'),exe=R.NtExecutable.from(await fs.readFile(exeFile),{ignoreCert:true}),resources=R.NtExecutableResource.from(exe),icons=R.Data.IconFile.from(await fs.readFile(path.join(appRoot,'assets/icon.ico')));
const groups=R.Resource.IconGroupEntry.fromEntries(resources.entries);if(!groups.length)throw Error('EXE没有可替换图标资源');for(const group of groups)R.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icons.icons.map(i=>i.data));
for(const version of R.Resource.VersionInfo.fromEntries(resources.entries)){version.setFileVersion(...pkg.version.split('.').map(Number),0,1033);version.setProductVersion(...pkg.version.split('.').map(Number),0,1033);version.setStringValues({lang:1033,codepage:1200},{ProductName:'谷谷bot',FileDescription:'谷谷bot',OriginalFilename:'谷谷bot.exe',InternalName:'gugu-bot'});version.outputToResourceEntries(resources.entries);}
resources.outputResource(exe);await fs.writeFile(exeFile,Buffer.from(exe.generate()));
const hash=data=>createHash('sha256').update(data).digest('hex');
const manifest={product:'谷谷bot',version:pkg.version,platform:'win32',arch:'x64',emptyUserData:true,napcatBundled:false,sourceFiles:runtimeAudit.files};await fs.writeFile(path.join(output,'release-manifest.json'),JSON.stringify(manifest,null,2));
for(const [src,dest]of [[output,windowsZip],[sourceStage,sourceZip]]){const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'release-tools/zip.ps1'),'-Source',src,'-Destination',dest],{stdio:'inherit',windowsHide:true});if(result.status!==0)throw Error('ZIP生成失败');}
await fs.rm(path.dirname(sourceStage),{recursive:true,force:true});
await fs.writeFile(path.join(dist,'SHA256SUMS.txt'),await Promise.all([windowsZip,sourceZip].map(async f=>`${hash(await fs.readFile(f))}  ${path.basename(f)}`)).then(a=>a.join('\n')+'\n'));
await fs.writeFile(path.join(dist,'release-notes.md'),notes+'\n');
console.log(JSON.stringify({ok:true,version:pkg.version,windows:path.basename(windowsZip),source:path.basename(sourceZip),files:runtimeAudit.files}));

