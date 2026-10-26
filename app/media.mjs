import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function mediaFilename(url){
  const match=String(url||'').match(/^\/media\/([a-f0-9-]+\.(?:png|jpg|webp))$/);if(!match)throw new Error('图片地址不正确');return match[1];
}
export function mimeFor(file){return file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'image/jpeg';}
export async function saveImage(dataDir,dataUrl){
  const m=String(dataUrl||'').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);if(!m)throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  const bytes=Buffer.from(m[2],'base64');if(bytes.length>7*1024*1024)throw new Error('图片不能超过 7MB');
  const valid=m[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):m[1]==='jpeg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)throw new Error('图片内容与文件格式不一致');
  const file=randomUUID()+'.'+(m[1]==='jpeg'?'jpg':m[1]);await fs.mkdir(path.join(dataDir,'media'),{recursive:true});await fs.writeFile(path.join(dataDir,'media',file),bytes);return '/media/'+file;
}
export async function readImage(dataDir,url){const file=mediaFilename(url);const bytes=await fs.readFile(path.join(dataDir,'media',file));return `data:${mimeFor(file)};base64,${bytes.toString('base64')}`;}
