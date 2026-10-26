import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
if(process.env.ELECTRON_SKIP_BINARY_DOWNLOAD==='1')process.exit(0);
const require=createRequire(import.meta.url),script=path.join(path.dirname(require.resolve('electron/package.json')),'install.js');
const result=spawnSync(process.execPath,[script],{stdio:'inherit',windowsHide:true});
if(result.status!==0)throw Error('Electron运行文件准备失败');
