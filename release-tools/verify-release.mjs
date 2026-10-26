import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {root,auditPublic} from './audit-public.mjs';
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')),dist=path.join(root,'dist'),output=path.join(dist,`gugu-bot-v${pkg.version}-win32-x64`),app=path.join(output,'resources/app');
const report=await auditPublic(app,{runtime:true});if(!report.ok)throw Error('Release包含私密或多余文件：'+JSON.stringify(report.findings));
const manifest=JSON.parse(await fs.readFile(path.join(output,'release-manifest.json'),'utf8')),actual=JSON.parse(await fs.readFile(path.join(app,'package.json'),'utf8'));if(manifest.version!==pkg.version||actual.version!==pkg.version||manifest.emptyUserData!==true)throw Error('Release版本或空白数据标记不符');
if(actual.main!=='desktop.cjs')throw Error('Release主入口必须与扁平运行包结构一致');await fs.access(path.join(app,actual.main));
for(const file of ['谷谷bot.exe','LICENSE','LICENSES.chromium.html','resources/app/assets/icon.ico','resources/app/public/app-logo.svg'])await fs.access(path.join(output,file));
const sums=(await fs.readFile(path.join(dist,'SHA256SUMS.txt'),'utf8')).trim().split('\n');if(sums.length!==2)throw Error('发布资产校验文件不完整');for(const line of sums){const m=/^([a-f0-9]{64})  ([^/\\]+\.zip)$/.exec(line);if(!m)throw Error('非法校验行');const hash=createHash('sha256').update(await fs.readFile(path.join(dist,m[2]))).digest('hex');if(hash!==m[1])throw Error('ZIP校验不符');}
console.log(JSON.stringify({ok:true,version:pkg.version,archives:sums.length,userDataFiles:0,files:report.files}));

