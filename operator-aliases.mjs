import {readFileSync} from 'node:fs';

const reference=file=>JSON.parse(readFileSync(new URL('./skills/arknights-pingu/references/'+file,import.meta.url),'utf8'));
export const operatorForms=reference('operator-forms.json');
export const operatorNicknames=reference('operator-nicknames.json');
const roster=reference('characters.json').characters;
const merchandise=/^(?:通行证|通行认证|徽章|双闪|亚克力|角色|挂件|立牌|书签|相卡|藏书票|套组|金属|毛绒|明信片|文件夹)*$/u;
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function createOperatorMatcher(normalize){
 const byName=new Map();
 for(const name of new Set([...roster.map(c=>c.name),...operatorNicknames.entries.flatMap(e=>e.targets)])){const form=normalize(name);byName.set(form,{base:form,form,name,baseName:name});}
 for(const group of operatorForms.groups)for(const form of [group.base,...group.alters])byName.set(normalize(form),{base:normalize(group.base),form:normalize(form),name:form,baseName:group.base});
 const entries=[...byName.values()].sort((a,b)=>b.form.length-a.form.length);
 const aliasMap=new Map(operatorNicknames.entries.map(e=>[normalize(e.alias),e.targets]));
 const tokens=[...new Set([...byName.keys(),...aliasMap.keys()])].sort((a,b)=>b.length-a.length);
 const tokenPattern=new RegExp(tokens.map(escape).join('|'),'gu');
 const identify=text=>entries.find(e=>e.form.length>1?text.includes(e.form):text===e.form||text.startsWith(e.form)&&merchandise.test(text.slice(e.form.length))||text.endsWith(e.form)&&merchandise.test(text.slice(0,-e.form.length)))||null;
 function queries(text){
  const hint=/本体|原版/.test(text)?'base':/异格/.test(text)?'alter':'';const clean=text.replace(/本体|原版|异格/gu,'');
  let alternatives=[''],last=0;
  // Longest token wins: 小能天使 is 克洛丝; full formal names protect embedded short nicknames.
  for(const m of clean.matchAll(tokenPattern)){
   const targets=byName.has(m[0])?[m[0]]:aliasMap.get(m[0]).map(normalize);
   alternatives=alternatives.flatMap(prefix=>targets.map(target=>prefix+clean.slice(last,m.index)+target));
   if(alternatives.length>32)return [];
   last=m.index+m[0].length;
  }
  return [...new Set(alternatives.map(prefix=>prefix+clean.slice(last)))].map(phrase=>({phrase,hint,identity:identify(phrase)}));
 }
 return {
  queries,
  product(p){const name=normalize(p.character||String(p.name||'').replace(/^.*?[-－—]/u,'')),found=queries(name).map(q=>q.identity).filter(Boolean);return found.length===1?found[0]:null;},
  compatible(query,identity){
   if(!query.identity||!identity)return true;
   if(query.identity.base!==identity.base)return false;
   if(query.identity.form!==query.identity.base)return query.identity.form===identity.form;
   if(query.hint==='base')return identity.form===identity.base;
   if(query.hint==='alter')return identity.form!==identity.base;
   return true;
  },
  terms(p,identity){
   if(!identity)return [];
   const terms=[identity.base,identity.form];
   for(const name of [p.name,...(p.aliases||[])]){const key=normalize(name);if(key.includes(identity.form))terms.push(key.replace(identity.form,identity.base));}
   return terms;
  },
  quantityScan(text,products,match,includeAliases=true){
   const names=[...(includeAliases?operatorNicknames.entries.map(e=>e.alias):[]),...products.flatMap(p=>[p.name,...(p.aliases||[])])].map(s=>String(s).normalize('NFKC').toLowerCase()).filter(s=>/\d/.test(s));
   const available=[...new Set(names)].filter(name=>match(name,products).length).sort((a,b)=>b.length-a.length);
   if(!available.length)return text;
   const pattern=new RegExp(available.map(escape).join('|'),'gu'),lower=text.toLowerCase(),chars=text.split('');
   for(const m of lower.matchAll(pattern)){
    const before=lower.slice(0,m.index).split(/[\s,，、;；:：/]/u).at(-1),after=lower.slice(m.index+m[0].length);
    // “小羊42” means 42 pieces; “42徽章1” and “通行证421” mention the numeric nickname.
    if(before&&!merchandise.test(normalize(before))||/^(?:个|对|件|套|枚|张|款\s*各)/u.test(after))continue;
    for(let i=m.index;i<m.index+m[0].length;i++)if(/\d/.test(chars[i]))chars[i]='¤';
   }
   return chars.join('');
  }
 };
}
