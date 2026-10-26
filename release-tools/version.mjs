import fs from 'node:fs/promises';
import path from 'node:path';
import {root} from './audit-public.mjs';
const version=process.argv[2];if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('需要三段版本号X.Y.Z');const file=path.join(root,'package.json'),pkg=JSON.parse(await fs.readFile(file,'utf8'));const a=version.split('.').map(Number),b=pkg.version.split('.').map(Number);const different=a.findIndex((n,i)=>n!==b[i]);if(different<0||a[different]<b[different])throw Error('新版本须递增');pkg.version=version;await fs.writeFile(file,JSON.stringify(pkg,null,2)+'\n');const lockFile=path.join(root,'package-lock.json'),lock=JSON.parse(await fs.readFile(lockFile,'utf8'));lock.version=version;lock.packages[''].version=version;await fs.writeFile(lockFile,JSON.stringify(lock,null,2)+'\n');console.log('版本已更新，请补写CHANGELOG后测试并发布v'+version);

