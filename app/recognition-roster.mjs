import {operatorForms,operatorNicknames} from './operator-aliases.mjs';

const key=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s·•・]/gu,'');
const unique=values=>[...new Map(values.map(value=>[key(value),value])).values()];

// Only an explicit roster declaration is authoritative; a casual mention is not a roster.
export function characterRosterFromNote(note){
 const match=String(note||'').match(/(?:本期(?:商品)?(?:的)?角色(?:名单|范围)?|(?:本期)?角色名单)\s*(?:为|是|有|包括|包含|[:：])\s*[:：]?\s*([^\n\r。！？!?]+)/u);
 if(!match)return null;
 const names=unique(match[1].split(/[、,，;；/|]/u).map(x=>x.trim().replace(/^[“"「『]|[”"」』]$/gu,'')).filter(Boolean));
 if(!names.length||names.length>100||names.some(x=>x.length>80))throw Error('本期角色名单格式不正确，请用顿号分隔角色名');
 return names;
}

export function characterRosterHint(roster){
 return roster?.length?'\n管理员明确的本期商品角色范围：'+roster.join('、')+'。所有角色商品只能属于此名单；完整名称按此名单书写，名单优先于通用角色/分盒资料及视觉猜测。单领、拼团及角色特典均适用；非角色商品照常识别。无法在名单内唯一确认的条目放入questions，不替换成名单外的熟悉角色，不按名单顺序分配角色，不凭剩余人数补齐。每个有角色的商品必须返回character字段。':'';
}

export function constrainRecognitionCharacters(data,roster,{characters=[],arknights=true}={}){
 if(!roster?.length||!Array.isArray(data?.products))return data;
 const allowed=unique(roster),known=unique([...allowed,...characters.flatMap(c=>[c.name,...(c.aliases||[])])]).sort((a,b)=>b.length-a.length);
 function resolve(name){
  const exact=allowed.filter(n=>key(n)===key(name));if(exact.length)return exact;
  if(!arknights)return [];
  const targets=operatorNicknames.entries.find(e=>key(e.alias)===key(name))?.targets||[name];
  return allowed.filter(n=>targets.some(t=>{
   if(key(t)===key(n))return true;
   // A base name can denote the only listed form; explicit alter names never jump forms.
   const family=operatorForms.groups.find(g=>key(g.base)===key(t));
   if(family?.alters.some(a=>key(a)===key(n)))return true;
   return key(n).startsWith(key(t))&&/[·•・]/u.test(n)&&key(n.split(/[·•・]/u)[0])===key(t);
  }));
 }
 const questions=[...(data.questions||[])],products=[];
 for(const p of data.products){
  const name=String(p.name||''),explicit=String(p.character||'').trim();
  const observed=known.find(n=>key(n).length>1?key(name).includes(key(n)):key(name.split(/[-－—]/u).at(-1))===key(n));
  const role=explicit||observed;
  if(!role){products.push(p);continue;}
  const candidates=resolve(role);
  // An allowed character field must not conceal a conflicting role in the visible name.
  const nameCandidates=observed?resolve(observed):candidates;
  if(candidates.length!==1||nameCandidates.length!==1||key(candidates[0])!==key(nameCandidates[0])){
   questions.push(`商品“${name||role}”的角色“${role}”不在本期名单内或无法唯一对应，请在${allowed.join('、')}中复核`);continue;
  }
  const target=candidates[0];let nextName=name;
  for(const token of [observed||explicit].filter(Boolean)){
   const escaped=token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   nextName=nextName.replace(new RegExp(escaped,'giu'),target);
  }
  const aliases=(p.aliases||[]).filter(a=>!known.some(n=>key(n).length>1&&key(a).includes(key(n))&&resolve(n).length!==1));
  products.push({...p,name:nextName,character:target,aliases});
 }
 const result={...data,products,questions:[...new Set(questions)]};
 // Empty generated groups must not survive as phantom categories after rejecting every role.
 if(Array.isArray(result.groups))result.groups=result.groups.filter(g=>products.some(p=>p.groupId===g.id));
 if(Array.isArray(result.categories))result.categories=result.categories.filter(c=>products.some(p=>p.categoryId===c.id));
 return result;
}
