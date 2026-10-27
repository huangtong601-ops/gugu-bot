import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ignored=new Set(['.git','node_modules','dist','backups','.local-profile']);
const forbidden=/^(?:workspace|credentials|napcat-runtime|server-connection|server-config|usage-ledger)\.json$|^(?:access-token\.txt|master-key\.bin)$|\.(?:log|tmp|xlsx|xls|csv|lnk|pem|pfx)$/i;
export async function auditPublic(base=root,{runtime=false}={}){
 const findings=[];let files=0;
 async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name),relative=path.relative(base,file).replaceAll('\\','/');if(e.isSymbolicLink()){findings.push({file:relative,rule:'symbolic-link'});continue;}if(e.isDirectory()){if(ignored.has(e.name)){if(runtime)findings.push({file:relative,rule:'runtime-data-or-dependencies'});continue;}if(['data','media','tables','runtime','logs','workspace-backups'].includes(e.name)){findings.push({file:relative,rule:'business-or-runtime-directory'});continue;}await walk(file);continue;}files++;if(forbidden.test(e.name)||/^\.env(?:\.|$)/.test(e.name)){findings.push({file:relative,rule:'private-data-file'});continue;}if(!/\.(?:mjs|cjs|js|json|md|html|css|svg|yml|yaml|ps1)$/i.test(e.name))continue;const text=await fs.readFile(file,'utf8');if(/[A-Za-z]:[\\/]+Users[\\/]+[^\s"']+/i.test(text))findings.push({file:relative,rule:'personal-profile-path'});if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text))findings.push({file:relative,rule:'private-key-or-token'});const keys=text.match(/\bsk-[A-Za-z0-9_-]{24,}/g)||[];if(keys.some(k=>!/(?:synthetic|fixture|example|canary|test)/i.test(k)))findings.push({file:relative,rule:'api-key-pattern'});}}
 await walk(base);return {ok:findings.length===0,files,findings};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const report=await auditPublic();console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}

