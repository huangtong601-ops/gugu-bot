import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const normalize=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
export function parseGlossary(markdown){
 const matches=[...markdown.matchAll(/^## ([^\r\n]+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)],entries=[],seen=new Set();
 for(const match of matches){const term=match[1].trim(),body=match[2],aliases=(body.match(/^别名[：:][^\S\r\n]*(.*)$/m)?.[1]||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean),definition=body.match(/^释义[：:]\s*([\s\S]*?)(?=^来源[：:]|$(?![\s\S]))/m)?.[1]?.trim();
  if(!term||term.length>60||!definition||definition.length>1500||/^##?\s/m.test(definition))throw Error('术语格式无效：'+term);
  for(const name of [term,...aliases]){const key=normalize(name);if(seen.has(key))throw Error('术语或别名重复：'+name);seen.add(key);}
  entries.push({term,aliases,definition,source:body.match(/^来源[：:]\s*(.*)$/m)?.[1]||'',start:match.index,end:match.index+match[0].length});
 }
 if(!entries.length||entries.length>300)throw Error('术语文件须包含1至300条术语');return entries;
}
export function explainTerm(entries,query){
 const key=normalize(query);if(!key)return '用法：解释 术语，例如「解释 捆」或「解释 k1」。';
 const found=entries.find(e=>[e.term,...e.aliases].some(n=>normalize(n)===key));
 return found?found.term+'：'+found.definition:'暂未收录「'+String(query).slice(0,60)+'」，可请管理员在设置的“拼谷术语解释”中补充。';
}
export const defaultGlossaryEntries=parseGlossary(readFileSync(new URL('./assets/拼谷术语解释.md',import.meta.url),'utf8'));
export async function createGlossaryStore(root,dataDir){
 const file=path.join(dataDir,'拼谷术语解释.md');try{await fs.access(file);}catch(e){if(e.code!=='ENOENT')throw e;await fs.copyFile(path.join(root,'assets','拼谷术语解释.md'),file,fs.constants.COPYFILE_EXCL).catch(e=>{if(e.code!=='EEXIST')throw e;});}
 let queue=Promise.resolve();
 const read=async()=>{const markdown=await fs.readFile(file,'utf8');return {markdown,entries:parseGlossary(markdown),version:createHash('sha256').update(markdown).digest('hex')};};
 return {file,read,async reply(term){return explainTerm((await read()).entries,term);},update(input){const task=queue.then(async()=>{const current=await read();if(input.version!==current.version)throw Error('术语文件已更新，请重新加载后再保存');const old=current.entries.find(e=>e.term===input.originalTerm);if(input.originalTerm&&!old)throw Error('原术语已不存在，请重新加载');
  const term=String(input.term||'').trim(),aliases=Array.isArray(input.aliases)?input.aliases.map(String).map(x=>x.trim()).filter(Boolean):[],definition=String(input.definition||'').trim();
  if(!term||term.length>60||/[\r\n]/.test(term)||aliases.some(a=>!a||a.length>60||/[\r\n、,，]/.test(a))||!definition||definition.length>1500||/^#{1,2}\s|^来源[：:]|^别名[：:]/m.test(definition))throw Error('请检查术语、别名和解释内容');
  const section='## '+term+'\n别名：'+aliases.join('、')+'\n释义：'+definition+'\n'+(old?.source?'来源：'+old.source+'\n':'')+'\n';
  const markdown=old?current.markdown.slice(0,old.start)+section+current.markdown.slice(old.end):current.markdown.trimEnd()+'\n\n'+section;parseGlossary(markdown);
  await fs.copyFile(file,file+'.bak');await fs.writeFile(file+'.tmp',markdown,'utf8');await fs.rename(file+'.tmp',file);return read();});queue=task.catch(()=>{});return task;}};
}
