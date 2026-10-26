import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readAdjustment} from './pass-adjustment.mjs';
import {operatorForms,operatorNicknames} from './operator-aliases.mjs';
export const bots=[{id:'zhougu',name:'粥谷Bot',skillId:'arknights-pingu',additionalSkills:['pass-adjustment-import','group-enrollment','order-planning-settlement'],sharedSkills:['pingu-core','pingu-terminology','pingu-usage'],description:'明日方舟商品建档与排表'}];
export function requireBot(id='zhougu'){const bot=bots.find(b=>b.id===id);if(!bot)throw new Error('该 Bot 尚未配置专用技能');return bot;}
export async function loadBotSkills(root){const map=new Map();for(const bot of bots){const ids=[...bot.sharedSkills,bot.skillId,...(bot.additionalSkills||[])];let text=(await Promise.all(ids.map(id=>fs.readFile(path.join(root,'skills',id,'SKILL.md'),'utf8')))).join('\n\n');if(bot.skillId==='arknights-pingu')text+='\n\n本地异格对照（'+operatorForms.checkedAt+'，仅在本期/图片允许范围内采用本体名回退；明确异格名不改为其他形态）：\n'+operatorForms.groups.map(g=>g.base+' → '+g.alters.join('、')).join('\n');if(bot.skillId==='arknights-pingu')text+='\n\n本地干员称呼对照（'+operatorNicknames.checkedAt+'；多目标表示多义，不能任意取第一人）：\n'+operatorNicknames.entries.map(e=>e.alias+' → '+e.targets.join('／')).join('\n');map.set(bot.id,text);}return map;}
export function importedSkillInfo(text,displayName=''){
 if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>256*1024)throw Error('请选择不超过256KB的非空Markdown技能文件');
 const front=text.replace(/^\uFEFF/,'').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]||'';
 const scalar=key=>front.match(new RegExp('^'+key+':\\s*([^\\r\\n]+)','m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'')||'';
 const name=String(displayName||scalar('name')||text.match(/^#\s+(.+)$/m)?.[1]||'').trim();
 if(!name||name.length>60||/[\x00-\x1f]/.test(name))throw Error('请填写1至60字的Bot名称');
 return {name,description:scalar('description').slice(0,300)||'导入的业务技能'};
}
export async function createBotRegistry(root,dataDir){
 const list=bots.map(b=>({...b})),skills=await loadBotSkills(root),folder=path.join(dataDir,'imported-skills');await fs.mkdir(folder,{recursive:true});
 const common=(await Promise.all(['pingu-core','pingu-terminology','pingu-usage','group-enrollment','order-planning-settlement'].map(id=>fs.readFile(path.join(root,'skills',id,'SKILL.md'),'utf8')))).join('\n\n');
 function install(id,info,text){const bot={id,name:info.name,description:info.description,skillId:id,sharedSkills:['pingu-core','pingu-terminology','pingu-usage'],additionalSkills:['group-enrollment','order-planning-settlement'],imported:true};list.push(bot);skills.set(id,common+'\n\n'+text);return bot;}
 for(const entry of await fs.readdir(folder,{withFileTypes:true})){if(!entry.isDirectory()||!/^imported-[a-f0-9-]{36}$/.test(entry.name))continue;const dir=path.join(folder,entry.name),text=await fs.readFile(path.join(dir,'SKILL.md'),'utf8'),meta=JSON.parse(await fs.readFile(path.join(dir,'bot.json'),'utf8'));install(entry.name,importedSkillInfo(text,meta.name),text);}
 let importing=Promise.resolve();
 return {bots:list,skills,requireBot(id='zhougu'){const bot=list.find(b=>b.id===id);if(!bot)throw Error('该 Bot 尚未配置专用技能');return bot;},importSkill(text,name){const run=importing.then(async()=>{const info=importedSkillInfo(text,name);if(list.some(b=>b.name===info.name))throw Error('已有同名Bot，请修改名称');const id='imported-'+randomUUID(),dir=path.join(folder,id+'.tmp');await fs.mkdir(dir);try{await fs.writeFile(path.join(dir,'SKILL.md'),text);await fs.writeFile(path.join(dir,'bot.json'),JSON.stringify(info));await fs.rename(dir,path.join(folder,id));}catch(e){await fs.rm(dir,{recursive:true,force:true});throw e;}return install(id,info,text);});importing=run.catch(()=>{});return run;}};
}
export function importedRecognition(data){
 if(!data||!Array.isArray(data.products))throw Error('模型未返回商品清单');
 return {...data,questions:Array.isArray(data.questions)?data.questions:[],products:data.products.map(p=>{
  const type=['单领','特典','通行证'].includes(p.type)?p.type:'单领',next={...p,type,imageUrl:''};
  if(type==='特典')next.price=null;
  if(type==='通行证'){next.character=String(p.character||p.name||'').replace(/^通行证[-－]/,'');next.name='通行证-'+next.character;next.price=null;next.averagePrice=null;Object.assign(next,readAdjustment(p));}
  return next;
 })};
}
