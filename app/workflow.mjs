import {validateCategoryName,categoryKey} from './public/catalog-utils.js';
import {randomUUID} from 'node:crypto';
import {tierLabel} from './public/gift-tiers.js';
import {createOperatorMatcher} from './operator-aliases.mjs';
import {queueScope,queueEntryKey,orderQueue} from './queue-order.mjs';
export const defaultCategories=()=>[{id:'特典',name:'特典',kind:'single'},{id:'单领',name:'单领',kind:'single'},{id:'通行证',name:'通行证',kind:'group',pricingMode:'adjustment',sets:0}];
export function categories(value){
 if(!Array.isArray(value)||!value.length)throw Error('至少保留一个大类');const names=new Set(),ids=new Set();
 return value.map(c=>{const name=validateCategoryName(c.name,value,c.id),id=String(c.id||randomUUID());if(!name||name.length>31||/[\\/?*\[\]:]/.test(name)||names.has(categoryKey(name))||ids.has(id))throw Error('大类名称须唯一且不超过31字，不能含表格名称特殊字符');names.add(categoryKey(name));ids.add(id);if(!['group','single'].includes(c.kind))throw Error('请选择拼团类或单领类');if(!Number.isInteger(c.sets??0)||(c.sets??0)<0)throw Error('开配数须为非负整数');const setsByBox=c.setsByBox||{};if(Object.values(setsByBox).some(n=>!Number.isInteger(n)||n<0))throw Error('分盒开配数须为非负整数');const boxPrices=c.boxPrices||{};if(Object.values(boxPrices).some(n=>n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>1e-6)))throw Error('整盒原价须为非负金额，最多两位小数');const averageModesByBox=c.averageModesByBox||{};if(Object.values(averageModesByBox).some(mode=>!['auto','manual'].includes(mode)))throw Error('均价填写方式无效');const aliases=Array.isArray(c.aliases)?[...new Set(c.aliases.map(String).map(s=>s.trim()).filter(s=>s&&s.length<=31))].slice(-10):[];return {id,name,...(aliases.length?{aliases}:{}),...(c.role==='gift'?{role:'gift'}:{}),kind:c.kind,setsByBox,boxPrices,averageModesByBox,pricingMode:c.pricingMode==='fixed'?'fixed':'adjustment',sets:c.sets??0};});
}
export function memberName(db,qq,groupId=''){
 const id=String(qq||''),g=String(groupId||'');
 const scoped=g?db.groupMembers?.[g]?.[id]?.cn:'';
 return scoped||db.members?.[id]?.cn||'';
}
export function qqForCN(db,cn,groupId=''){
 const name=String(cn||'').trim();if(!name)return '';
 const ids=new Set([...Object.keys(db.members||{}),...Object.keys(db.groupMembers?.[String(groupId)]||{})]);
 const matches=[...ids].filter(id=>/^\d{5,12}$/.test(id)&&memberName(db,id,groupId)===name);
 if(matches.length>1)throw Error('该CN对应多个QQ，请明确填写QQ号');
 return matches[0]||'';
}
export function recordMember(db,record,groupId=''){
 const cn=recordOwner(db,record,groupId);
 return record.proxyFor?`${cn} 代 ${record.proxyFor}`:cn;
}
export function recordOwner(db,record,groupId=''){
 const saved=String(record.member||''),suffix=record.proxyFor?' 代 '+record.proxyFor:'';
 return memberName(db,record.qq,groupId)||(suffix&&saved.endsWith(suffix)?saved.slice(0,-suffix.length):saved);
}
export function registerCN(db,qq,cn,groupId=''){
 qq=String(qq||'');cn=String(cn||'').trim();
 if(!/^\d{5,12}$/.test(qq)||!cn||cn.length>40)throw Error('QQ号或CN格式无效');
 const g=String(groupId||'');
 if(g){
  db.groupMembers??={};db.groupMembers[g]??={};
  // 本群的有效 CN = 全局兜底 + 本群登记；同名只在本群范围内查重。
  const effective={};
  for(const [id,m] of Object.entries(db.members||{}))effective[id]=m.cn;
  for(const [id,m] of Object.entries(db.groupMembers[g]))effective[id]=m.cn;
  if(Object.entries(effective).some(([id,name])=>id!==qq&&name===cn))throw Error('该CN已绑定本群其他QQ号');
  db.groupMembers[g][qq]={cn};
 }else{
  db.members??={};
  if(Object.entries(db.members).some(([id,m])=>id!==qq&&m.cn===cn))throw Error('该CN已绑定其他QQ号');
  db.members[qq]={cn};
 }
 return `CN已录入：${cn}`;
}
// Identity spelling and merchandise terms normalize independently of potentially ambiguous nicknames.
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/吧唧/g,'徽章').replaceAll('安洁丽娜','安洁莉娜').replace(/皮肤|款|ver\.?|（[^）]*）|\([^)]*\)|[\s\p{P}]/gu,'');
// Merchandise qualifiers, including parenthesized editions, carry product identity.
// The older normalizer remains exclusively compatible with saved entry/exclusion keys.
const productNorm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/吧唧/g,'徽章').replaceAll('安洁丽娜','安洁莉娜').replace(/[\s\p{P}\p{S}]/gu,'');
// Keep exclusions made before the nickname registry migration stable across restarts.
const legacyNorm=s=>norm(String(s).replaceAll('德狗','德克萨斯').replaceAll('阿能','能天使').replaceAll('异德','缄默德克萨斯').replaceAll('洁哥','安洁莉娜'));
const operatorMatcher=createOperatorMatcher(norm);
const productMatcher=createOperatorMatcher(productNorm);
// 制品类型词用于限制「按字匹配」的范围，避免只看角色名就命中别的品类。
const kindWords=['通行证','明信片套组','相卡套组','角色套组','套组','流沙','摆件','立牌','挂件','书签','徽章','打卡棒','毛绒','折页','书立','贴纸','抽巾','收藏卡','明信片'];
const kindOf=s=>kindWords.find(k=>s.includes(k))||'';
export const productFamily=p=>String(p.name||'').split(/[-－—]/u)[0].trim();
const familyKey=p=>JSON.stringify([p.categoryId||p.type||'',p.boxId||'',productNorm(productFamily(p))]);
function variantTerms(p){
 const variant=String(p.name||'').normalize('NFKC').match(/(?:\s|[-－—])?([A-Z])\s*款\s*$/i)?.[1];
 return variant?[productFamily(p),...(p.aliases||[]).filter(a=>!/[a-z]/i.test(a))].map(base=>base+variant):[];
}
function scoreTerm(q,n){
 if(!q||!n)return 0;
 if(n===q)return 1000;
 if(n.includes(q))return 520+q.length*6;
 if(q.includes(n)&&n.length>=3)return 460+n.length*4;
 const qk=kindOf(q),nk=kindOf(n);if(!qk||!nk||qk!==nk)return 0;
 const qs=new Set(q),ns=new Set(n);let hit=0;for(const ch of qs)if(ns.has(ch))hit++;
 const cover=hit/qs.size,precision=hit/Math.max(1,ns.size);
 if(cover<0.8)return 0;
 return Math.round(120*cover+80*precision+qk.length*3);
}
const literalRole=p=>{const name=String(p.name||''),split=name.search(/[-－—]/u);return String(p.character||(split>=0?name.slice(split+1):''));};
const covers=(text,fragment)=>{const chars=new Map();for(const ch of text)chars.set(ch,(chars.get(ch)||0)+1);for(const ch of fragment){const n=chars.get(ch)||0;if(!n)return false;chars.set(ch,n-1);}return true;};
const tierTerms=p=>Number.isInteger(p.giftTier)?[tierLabel(p.giftTier)+'特典',tierLabel(p.giftTier),'第'+p.giftTier+'档特典','第'+p.giftTier+'档']:p.giftTier==='set'?['特典SET','特典套装','SET']:[];
function familyVocabulary(products,arknights){
 const entries=products.map(p=>{
  const identity=arknights?productMatcher.product(p):null,token=identity?.form||productNorm(literalRole(p));
  const strip=t=>token?productNorm(t).replace(token,''):productNorm(t);
  return {p,identity,family:strip(productFamily(p)),descriptors:[p.name,...(p.aliases||[]),...variantTerms(p),...tierTerms(p)].map(strip)};
 });
 return {entries,identities:new Map(entries.map(e=>[e.p,e.identity])),families:[...new Set(entries.map(e=>e.family).filter(Boolean))],roles:[...new Set(products.map(literalRole).map(productNorm).filter(Boolean))].sort((a,b)=>b.length-a.length)};
}
function merchandiseEvidence(query,vocabulary){
 const {entries,families,roles}=vocabulary;
 const exactTier=entries.filter(e=>tierTerms(e.p).some(t=>productNorm(t)===query.phrase));
 if(exactTier.length)return {ids:new Set(exactTier.map(e=>e.p.id))};
 let fragment=query.phrase,role='';
 if(query.identity)fragment=fragment.replace(query.identity.form,'');
 else{
  role=roles.find(r=>fragment.includes(r))||'';
  if(role)fragment=fragment.replace(role,'');
 }
 if(!fragment)return null;
 // All supplied qualifiers must be accounted for. A contained short noun cannot
 // swallow a longer title or an unknown modifier, even when its SKU is in scope.
 const find=part=>entries.filter(e=>(!role||productNorm(literalRole(e.p))===role)&&e.descriptors.some(d=>covers(d,part)));
 let found=find(fragment);
 if(!found.length){const compatibility=fragment.replace(/皮肤|款|ver\.?/gu,'');if(compatibility&&compatibility!==fragment){found=find(compatibility);if(found.length)fragment=compatibility;}}
 const generic=kindWords.includes(fragment)&&!kindWords.some(k=>k!==fragment&&fragment.includes(k));
 const exact=families.includes(fragment)&&!generic;
 if(exact)found=found.filter(e=>e.family===fragment);
 const hinted=found.length||kindOf(fragment)||families.some(f=>f.length>=2&&fragment.includes(f));
 if(!hinted)return null;
 return {ids:new Set(found.map(e=>e.p.id)),exact,role:!!(query.identity||role)};
}
function reorderedTerms(p){const family=productFamily(p),tail=String(p.name||'').slice(family.length).replace(/^[-－—]+/u,'');return tail?[family+tail,tail+family]:[];}
export function matchProduct(text,products,limit=6,{arknights=true,familyProducts=products}={}){
 if(!products?.length)return [];
 return matchWithVocabulary(text,products,limit,arknights,familyVocabulary(familyProducts,arknights));
}
function matchWithVocabulary(text,products,limit,arknights,vocabulary){
 const result=[];
 const literal=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s/gu,'').replace(/[－—]/gu,'-');
 const literalIds=new Set(vocabulary.entries.filter(e=>/[-－—]/u.test(e.p.name)&&literal(e.p.name)===literal(text)).map(e=>e.p.id));
 // Score each meaning separately. Relative word lengths must never erase an alias ambiguity.
 for(const query of arknights?productMatcher.queries(productNorm(text)):[{phrase:productNorm(text),identity:null}]){
  const q=query.phrase;if(!q)continue;
  const evidence=merchandiseEvidence(query,vocabulary),variantQuery=norm(q);
  const explicitVariant=products.some(p=>variantTerms(p).some(term=>norm(term).slice(0,-1)===variantQuery.slice(0,-1)))&&/[a-z]$/.test(variantQuery)?variantQuery.at(-1):'';
  const scored=products.map(p=>{
   const variants=variantTerms(p),identity=arknights?(vocabulary.identities.get(p)||productMatcher.product(p)):null;
   const queryKind=kindOf(q),productKinds=[p.name,p.type,...(p.aliases||[])].flatMap(t=>kindWords.filter(k=>productNorm(t).includes(k)));
   if(literalIds.size&&!literalIds.has(p.id)||evidence&&!evidence.ids.has(p.id)||!productMatcher.compatible(query,identity)||query.identity&&queryKind&&!productKinds.includes(queryKind))return {p,score:0};
   if(explicitVariant&&variants.length&&!variants.some(t=>norm(t).endsWith(explicitVariant)))return {p,score:0};
   const tierAliases=tierTerms(p);
   const identityTerms=productMatcher.terms(p,identity),family=productNorm(productFamily(p));
   const reverseIdentityTerms=identityTerms.filter(t=>family&&t.startsWith(family)&&t!==family).map(t=>t.slice(family.length)+family);
   let best=evidence?1000:0;for(const term of [p.name,...(p.aliases||[]),...tierAliases,...variants,...reorderedTerms(p),...identityTerms,...reverseIdentityTerms])best=Math.max(best,scoreTerm(q,productNorm(term)));
   return {p,score:best};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||String(a.p.name).localeCompare(String(b.p.name)));
  if(!scored.length)continue;
  const top=scored[0].score,floor=top>=1000?1000:top>=520?520:Math.max(1,Math.round(top*0.9));
  for(const {p,score} of scored)if(score>=floor&&!result.some(x=>x.id===p.id))result.push(p);
 }
 return result.slice(0,limit);
}
export function cleanComment(text){
 return String(text??'')
  .replace(/@\{uin:\d+[^}]*\}/gi,' ')
  .replace(/\[CQ:[^\]]*\]/gi,' ')
  .replace(/[\u200b-\u200d\ufeff]/g,'')
  .normalize('NFKC')
  .replace(/\s+/g,' ')
  .trim();
}
const COMMAND=/^(?:撤排|cn(?=[\s:：])|解释|查询|(?:查看|查阅)\s*(?:(?:本群\s*)?排表|排量|余量|肾表)|导出\s*肾表|排量(?:\s|$)|余量(?:\s|$)|我的排表\s*$|肾表\s*$|(?:help|帮助|指令|命令列表)[。.!！?？]?\s*$)/i;
const countValue=s=>/^\d+$/.test(s)?Number(s):({'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}[s]??NaN);
export function parseComment(text,products,cn='',{resolutions={},quantities={},allProducts=[],ignoredItems=[],arknights=true}={}){
 const cleaned=cleanComment(text),empty={items:[],questions:[],lines:[]};
 if(!cleaned)return {status:'skip',reason:'空评论，不计入报名',...empty};
 if(COMMAND.test(cleaned))return {status:'skip',reason:`命令消息「${cleaned.slice(0,16)}」，不计入报名`,...empty};
 let body=cleaned;if(cn&&body.startsWith(cn))body=body.slice(cn.length).replace(/^\s*(?:[（(][^）)]*[）)])?\s*/,'').trim();
 let proxyFor='';
 if(body.startsWith('代群外')){
  const proxy=body.match(/^代群外\s*(\S+)\s+(.+)$/u);
  if(!proxy||proxy[1].length>40||proxy[2].includes('代群外'))return {status:'ambiguous',...empty,questions:[{code:'proxy',phrase:body,quantity:null,message:'代排格式：代群外XXX 制品名称 数量；姓名后请留空格，每条评论只写一位代排对象'}]};
  proxyFor=proxy[1];body=proxy[2];
 }
 // Only annotation-only parentheses are omitted. Edition names remain part of the product phrase.
 body=body.replace(/\(\s*(?:代排|帮排|替排)\s*\)/gu,' ');
 const items=[],questions=[],lines=[],occurrences=new Map(),ignored=new Set(ignoredItems);let start=0,context='';
 const entryKey=phrase=>{const key=legacyNorm(phrase),n=occurrences.get(key)||0;occurrences.set(key,n+1);return JSON.stringify([key,n]);};
 // Parsing must retain all plausible products, even when a character has many kinds.
 const vocabulary=allProducts.length?allProducts:products,prepared=familyVocabulary(vocabulary,arknights);
 const match=(phrase,list)=>matchWithVocabulary(phrase,list,list.length,arknights,prepared);
 const productQueries=phrase=>arknights?productMatcher.queries(productNorm(phrase)):[{phrase:productNorm(phrase),identity:null}];
 const familyHints=new Map();const hasFamily=phrase=>{if(!familyHints.has(phrase))familyHints.set(phrase,productQueries(phrase).some(q=>merchandiseEvidence(q,prepared)));return familyHints.get(phrase);};
 const choose=(phrase,entry='')=>{
  const key=phrase.trim(),override=resolutions?.[entry]||resolutions?.[key]||resolutions?.[norm(key)];
  if(override){const hit=products.find(p=>p.id===override)||allProducts.find(p=>p.id===override);if(hit)return {id:hit.id};}
  const found=match(phrase,products);
  // Context only narrows role-only fragments, never an explicit new merchandise family.
  const scoped=context&&!hasFamily(phrase)?found.filter(p=>familyKey(p)===context):found;
  const candidates=scoped.length?scoped:found;
  if(candidates.length===1)return {id:candidates[0].id};
  if(candidates.length>1)return {candidates,code:'ambiguous'};
  const outside=allProducts.length?match(phrase,allProducts):[];
  if(outside.length)return {candidates:outside,code:'outside'};
  return {candidates:[],code:'unknown'};
 };
 const add=(phrase,quantity,key,picked)=>{
  picked=picked||choose(phrase,key);quantity=quantities[key]??quantities[phrase]??quantity;
  // Update family context even for an excluded entry, so other stable entry keys keep their meaning.
  if(picked.id){const p=products.find(p=>p.id===picked.id);if(p)context=familyKey(p);}
  if(ignored.has(key))return;
  const line={entryKey:key,phrase,quantity,...(picked.id?{skuId:picked.id}:{})};lines.push(line);
  if(!Number.isInteger(quantity)||quantity<1||quantity>999){questions.push({...line,code:'quantity',quantity:null,message:`${phrase}：数量须为1至999的整数`});return;}
  if(picked.id){items.push({skuId:picked.id,quantity});return;}
  const label=picked.code==='outside'?'不在图片范围':picked.code==='ambiguous'?'对应多个商品':'未匹配到本期商品';
  questions.push({...line,code:picked.code||'unknown',candidates:(picked.candidates||[]).map(p=>({id:p.id,name:p.name,boxId:p.boxId||''})),message:`${phrase}：${label}${picked.candidates?.length?'，请选择对应商品':''}`});
 };
 const segments=phrase=>{
  const parts=phrase.split(/[\s,，、;；/]+/u).filter(Boolean),linked=phrase.split(/和|与|及/u).filter(Boolean);
  const exact=products.some(p=>[p.name,...(p.aliases||[]),...variantTerms(p)].some(t=>norm(t)===norm(phrase)));
  if(exact)return [phrase];
  if(linked.length>1&&linked.every(p=>{const r=choose(p);return r.id||r.candidates?.length;}))return linked;
  if(parts.length>1){const sets=parts.map(p=>{const r=choose(p);return new Set(r.id?[r.id]:(r.candidates||[]).map(x=>x.id));});if(sets.every(s=>s.size)&&sets.every((s,i)=>sets.every((t,j)=>i===j||![...s].some(id=>t.has(id)))))return parts;}
  return !choose(phrase).id&&parts.length>1?parts:[phrase];
 };
 const clean=s=>s.replace(/^[\s,，、;；:：]+|[\s,，、;；:：]+$/g,'');
 const roleWords=new Set(vocabulary.map(literalRole).map(productNorm).filter(Boolean));
 const sharedParts=phrase=>{
  const roleOnly=role=>!hasFamily(role)&&(arknights?productQueries(role).some(q=>q.identity):roleWords.has(productNorm(role)));
  // The split is inferred from the actual catalogue rather than a fixed list of
  // short type nouns; whitespace inside a compound title is preserved as well.
  for(let i=1;i<phrase.length;i++){
   const roles=clean(phrase.slice(0,i)).split(/[\s,，、;；/]+|和|与|及/u).filter(Boolean);
   if(roles.length<2||!roles.every(roleOnly))continue;
   const suffix=clean(phrase.slice(i));if(!suffix)continue;
   if(!productQueries(suffix).some(q=>!q.identity&&merchandiseEvidence(q,prepared)?.ids.size))continue;
   const parts=roles.map(role=>role+suffix);
   if(parts.every(part=>{const picked=choose(part);return picked.id||picked.candidates?.length;}))return parts;
  }
  return null;
 };
 const leadingParts=phrase=>{
  if(productQueries(phrase).some(q=>q.identity&&!merchandiseEvidence(q,prepared)))return null;
  for(let i=phrase.length-1;i>0;i--){
   const prefix=clean(phrase.slice(0,i)),tail=clean(phrase.slice(i));if(!prefix||!tail)continue;
   const key=productNorm(prefix);if(key.length<2&&!prepared.families.includes(key)||!prepared.families.some(f=>covers(f,key)))continue;
   const evidence=productQueries(prefix).filter(q=>!q.identity).map(q=>merchandiseEvidence(q,prepared)).find(e=>e?.ids.size);
   if(!evidence)continue;
   const roles=tail.split(/[\s,，、;；/]+|和|与|及/u).filter(Boolean);
   if(!roles.length||roles.some(role=>hasFamily(role)))continue;
   const scoped=vocabulary.filter(p=>evidence.ids.has(p.id));
   // Keep a complete explicit SKU intact, including names with custom delimiters.
   if(roles.length===1&&products.some(p=>productNorm(p.name)===productNorm(phrase)))return null;
   return {prefix,roles,scoped};
  }
  return null;
 };
 const addPhrase=(phrase,quantity)=>{
  const leading=leadingParts(phrase);
  if(!leading){for(const part of segments(phrase))add(part,quantities[part]??quantity,entryKey(part));return;}
  const available=leading.scoped.filter(p=>products.some(s=>s.id===p.id)),keys=new Set(available.map(familyKey));context=keys.size===1?[...keys][0]:'';
  for(const role of leading.roles){
   const full=leading.prefix+role,key=entryKey(full),override=resolutions[key]||resolutions[full]||resolutions[norm(full)];
   if(override){add(full,quantity,key,choose(full,key));continue;}
   const found=match(role,available),outside=found.length?[]:match(role,leading.scoped);
   const picked=found.length===1?{id:found[0].id}:found.length?{candidates:found,code:'ambiguous'}:outside.length?{candidates:outside,code:'outside'}:{candidates:[],code:'unknown'};
   add(full,quantity,key,picked);
  }
 };
 // A group quantity is one token: do not consume the count in “3款各1” as a normal quantity.
 const re=/(?<group>[一二两三四五六七八九十\d]+)\s*款\s*各\s*(?<each>[零一二两三四五六七八九十\d]+)\s*(?:个|对|件|套|枚|张)?|各\s*(?<shared>[零一二两三四五六七八九十\d]+)\s*(?:个|对|件|套|枚|张)?|(?<![.\d])(?<number>-?\d+)\s*(?:个|对|件|套|枚|张)?(?=\D|$)(?!\s*[.．]\d)/gu;let m;
 const scanBody=operatorMatcher.quantityScan(body,allProducts.length?allProducts:products,match,arknights);
 while((m=re.exec(scanBody))){
  const phrase=clean(body.slice(start,m.index));start=re.lastIndex;
  if(m.groups.shared){
   const quantity=countValue(m.groups.shared),parts=sharedParts(phrase);
   if(parts)for(const part of parts)add(part,quantity,entryKey(part));
   else addPhrase(phrase,quantity);
   continue;
  }
  if(m.groups.group){
   const key=entryKey(phrase),count=countValue(m.groups.group),quantity=countValue(m.groups.each);
   const q=productNorm(phrase),families=new Map();
   for(const p of products){const f=productNorm(productFamily(p));if(q===f||f.includes(q)&&q.length>=2){const k=familyKey(p);if(!families.has(k))families.set(k,[]);families.get(k).push(p);}}
   const matches=[...families.values()];
   if(phrase&&matches.length===1&&matches[0].length===count&&Number.isInteger(quantity)&&quantity>=1&&quantity<=999){
    for(const p of matches[0]){if(ignored.has(key))context=familyKey(p);else add(phrase,quantity,key+':'+p.id,{id:p.id});}
   }else if(!ignored.has(key)){
    const line={entryKey:key,phrase:phrase+m[0],quantity:null};lines.push(line);questions.push({...line,code:'group',message:`${phrase}${m[0]}：款数或商品范围不明确，请补充具体款名`});
   }
   continue;
  }
  if(!phrase){const key=entryKey('（未写制品名）');add('（未写制品名）',null,key,{code:'quantity'});continue;}
  addPhrase(phrase,Number(m.groups.number));
 }
 const tail=clean(body.slice(start));
 if(tail)addPhrase(tail,1);
 if(!items.length&&!questions.length)return {status:'skip',reason:ignored.size?'商品条目已全部删除':'未找到制品和数量',items,questions,lines};
 return {status:questions.length?'ambiguous':'resolved',items,questions,lines,...(proxyFor?{proxyFor}:{})};
}
export function compareCommentTime(a,b){return Date.parse(a.sourceAt||a.at||a.createdAt)-Date.parse(b.sourceAt||b.at||b.createdAt)||(a.sourceOrder??a.order??0)-(b.sourceOrder??b.order??0)||String(a.queueOrderId||a.sourceId||a.id).localeCompare(String(b.queueOrderId||b.sourceId||b.id),undefined,{numeric:true});}
export function orderedRecords(c){return [...c.records].sort((a,b)=>String(a.sourceAt||a.createdAt).localeCompare(String(b.sourceAt||b.createdAt))||(a.sourceOrder??0)-(b.sourceOrder??0)||String(a.queueOrderId||a.sourceId||a.requestId||a.id).localeCompare(String(b.queueOrderId||b.sourceId||b.requestId||b.id),undefined,{numeric:true})||(a.itemIndex??0)-(b.itemIndex??0)||(a.queueRecordIndex??0)-(b.queueRecordIndex??0)||(a.queueUnitIndex??0)-(b.queueUnitIndex??0));}
export function groupCapacity(category,boxId=''){
 if(category?.kind!=='group')return null;
 const box=category.setsByBox?.[boxId];if(Number.isSafeInteger(box)&&box>=0)return box;
 // Legacy default sets=0 meant no capacity was entered. Explicit per-box 0 is valid.
 return Number.isSafeInteger(category.sets)&&category.sets>0?category.sets:null;
}
export function summary(c){
 const ordered=orderedRecords(c);return c.products.map(p=>{
  const records=ordered.filter(r=>r.skuId===p.id),cat=c.categories.find(x=>x.id===(p.categoryId||p.type)),sets=groupCapacity(cat,p.boxId||'');
  const entries=records.flatMap(r=>Array.from({length:r.quantity},(_,i)=>({entryKey:queueEntryKey(r,i),cn:r.member})));
  const queue=orderQueue(c,queueScope(cat?.id||p.type,p.boxId||'',p.id),entries).map(e=>e.cn);
  return {id:p.id,name:p.name,category:cat?.name||p.type,categoryId:cat?.id||p.type,kind:cat?.kind||'single',boxId:p.boxId||'',unit:p.unit||'件',sets,queue,demand:queue.length,remaining:sets===null?null:Math.max(0,sets-queue.length),overflow:sets===null?0:Math.max(0,queue.length-sets)};
 });
}
export function addComment(db,c,event,{albumEnrollment=false,replayClosed=false}={}){
 if(!event.id||!event.qq||!event.at||!Number.isFinite(Date.parse(event.at)))throw Error('评论必须有唯一编号、QQ号和原始时间');
 c.commentEvents??=[];
 const existing=c.commentEvents.findIndex(e=>e.id===String(event.id));
 if(existing>=0&&!(albumEnrollment&&replayClosed&&c.commentEvents[existing].closed===true))return {duplicate:true,message:'该评论已处理'};
 const saveLog=entry=>{if(existing>=0)c.commentEvents[existing]=entry;else c.commentEvents.push(entry);};
 if(c.orderLifecycle?.status==='completed'&&!albumEnrollment)throw Error(`「${c.name}」本期已经结束，未录入本次排谷；如需补单，请联系管理员。`);
 const member=memberName(db,event.qq,event.groupId||c.groupId);
 const products=event.productIds?c.products.filter(p=>event.productIds.includes(p.id)):c.products;
 const parsed=parseComment(event.text,products,member,{resolutions:event.resolutions,quantities:event.quantities,allProducts:c.products,ignoredItems:event.ignoredItems,arknights:!c.botId||c.botId==='zhougu'});
 const at=new Date(event.at).toISOString();
 const log={id:String(event.id),qq:String(event.qq),at,text:String(event.text),albumId:event.albumId||'',photoIds:event.photoIds||[],feedId:event.feedId||''};
 // Commands and chatter are recorded as processed so the poller stops retrying them.
 if(parsed.status==='skip'){saveLog({...log,skipped:true});return {skipped:true,message:parsed.reason};}
 if(!member)throw Error('请先 @bot cn 你的CN');
 if(parsed.status!=='resolved'){const error=Error(parsed.questions.map(q=>q.message).join('；'));error.questions=parsed.questions;error.items=parsed.items;error.lines=parsed.lines;throw error;}
 const displayMember=parsed.proxyFor?`${member} 代 ${parsed.proxyFor}`:member;
 if(parsed.proxyFor)log.proxyFor=parsed.proxyFor;
 const rows=parsed.items.map((item,i)=>{const p=c.products.find(p=>p.id===item.skuId);return {...item,id:randomUUID(),requestId:`comment:${event.id}:${i}`,member:displayMember,...(parsed.proxyFor?{proxyFor:parsed.proxyFor}:{}),qq:String(event.qq),name:p.name,unitCents:p.price==null?null:Math.round(p.price*100),status:p.price==null?'待定价':'暂估',source:String(event.text),sourceAt:at,sourceOrder:Number.isSafeInteger(event.order)?event.order:0,sourceId:String(event.id),itemIndex:i,createdAt:new Date().toISOString()};});
 for(const row of rows){row.albumId=event.albumId||'';row.photoIds=event.photoIds||[];row.feedId=event.feedId||'';}
 const active=rows.filter(r=>!c.commentEvents.some(e=>e.withdrawal&&e.success&&e.skuId===r.skuId&&e.qq===r.qq&&!r.proxyFor&&compareCommentTime(e,r)>=0));
 c.records.push(...active);saveLog(log);c.records=orderedRecords(c);return {message:`已录入 ${displayMember}：${rows.map(r=>r.name+' ×'+r.quantity).join('，')}`,count:active.length};
}
export function bindAlbum(db,c,{groupId,albumId}){if(!String(groupId||'').trim()||!String(albumId||'').trim())throw Error('请填写群号和相册ID');if(c?.groupId&&String(c.groupId)!==String(groupId))throw Error('相册所属群与该期次的群不一致');db.albums??=[];if(db.albums.some(x=>(x.groupId===String(groupId)&&x.albumId===String(albumId))||x.campaignId===c.id))throw Error('相册或期次已绑定');db.albums.push({groupId:String(groupId),albumId:String(albumId),campaignId:c.id});}
export function positionMatch(anchors,bounds){
 if(!bounds)return null;const cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
 const matches=anchors.filter(a=>cx>=a.bounds.x&&cx<=a.bounds.x+a.bounds.width&&cy>=a.bounds.y&&cy<=a.bounds.y+a.bounds.height);return matches.length===1?matches[0]:null;
}
