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
// Keep exclusions made before the nickname registry migration stable across restarts.
const legacyNorm=s=>norm(String(s).replaceAll('德狗','德克萨斯').replaceAll('阿能','能天使').replaceAll('异德','缄默德克萨斯').replaceAll('洁哥','安洁莉娜'));
const operatorMatcher=createOperatorMatcher(norm);
// 制品类型词用于限制「按字匹配」的范围，避免只看角色名就命中别的品类。
const kindWords=['通行证','明信片套组','相卡套组','角色套组','套组','流沙','摆件','立牌','挂件','书签','徽章','打卡棒','毛绒','折页','书立','贴纸','抽巾','收藏卡','明信片'];
const kindOf=s=>kindWords.find(k=>s.includes(k))||'';
export const productFamily=p=>String(p.name||'').split(/[-－—]/u)[0].trim();
const familyKey=p=>JSON.stringify([p.categoryId||p.type||'',p.boxId||'',norm(productFamily(p))]);
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
export function matchProduct(text,products,limit=6,{arknights=true}={}){
 if(!products?.length)return [];
 const result=[];
 // Score each meaning separately. Relative word lengths must never erase an alias ambiguity.
 for(const query of arknights?operatorMatcher.queries(norm(text)):[{phrase:norm(text),identity:null}]){
  const q=query.phrase;if(!q)continue;
  const explicitVariant=products.some(p=>variantTerms(p).some(term=>norm(term).slice(0,-1)===q.slice(0,-1)))&&/[a-z]$/.test(q)?q.at(-1):'';
  const scored=products.map(p=>{
   const variants=variantTerms(p),identity=arknights?operatorMatcher.product(p):null;
   if(!operatorMatcher.compatible(query,identity)||query.identity&&kindOf(q)&&kindOf(norm(p.name))&&kindOf(q)!==kindOf(norm(p.name)))return {p,score:0};
   if(explicitVariant&&variants.length&&!variants.some(t=>norm(t).endsWith(explicitVariant)))return {p,score:0};
   const tierAliases=Number.isInteger(p.giftTier)?[tierLabel(p.giftTier)+'特典',tierLabel(p.giftTier),'第'+p.giftTier+'档特典','第'+p.giftTier+'档']:p.giftTier==='set'?['特典SET','特典套装','SET']:[];
   let best=0;for(const term of [p.name,...(p.aliases||[]),...tierAliases,...variants,...operatorMatcher.terms(p,identity)])best=Math.max(best,scoreTerm(q,norm(term)));
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
const COMMAND=/^(?:撤排|cn(?=[\s:：])|解释|查询|排量(?:\s|$)|余量(?:\s|$)|我的排表\s*$|肾表\s*$|(?:help|帮助|指令|命令列表)[。.!！?？]?\s*$)/i;
const countValue=s=>/^\d+$/.test(s)?Number(s):({'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}[s]??NaN);
export function parseComment(text,products,cn='',{resolutions={},quantities={},allProducts=[],ignoredItems=[],arknights=true}={}){
 const cleaned=cleanComment(text),empty={items:[],questions:[],lines:[]};
 if(!cleaned)return {status:'skip',reason:'空评论，不计入报名',...empty};
 if(COMMAND.test(cleaned))return {status:'skip',reason:`命令消息「${cleaned.slice(0,16)}」，不计入报名`,...empty};
 let body=cleaned;if(cn&&body.startsWith(cn))body=body.slice(cn.length).replace(/^[\s（(][^）)]*[）)]/,'').trim();
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
 const match=(phrase,list)=>matchProduct(phrase,list,6,{arknights});
 const choose=phrase=>{
  const key=phrase.trim(),override=resolutions?.[key]||resolutions?.[norm(key)];
  if(override){const hit=products.find(p=>p.id===override)||allProducts.find(p=>p.id===override);if(hit)return {id:hit.id};}
  const found=match(phrase,products);
  // Context only narrows role-only fragments, never an explicit new merchandise family.
  const scoped=context&&!kindOf(norm(phrase))?found.filter(p=>familyKey(p)===context):found;
  const candidates=scoped.length?scoped:found;
  if(candidates.length===1)return {id:candidates[0].id};
  if(candidates.length>1)return {candidates,code:'ambiguous'};
  const outside=allProducts.length?match(phrase,allProducts):[];
  if(outside.length)return {candidates:outside,code:'outside'};
  return {candidates:[],code:'unknown'};
 };
 const add=(phrase,quantity,key,picked=choose(phrase))=>{
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
 // A group quantity is one token: do not consume the count in “3款各1” as a normal quantity.
 const re=/(?<group>[一二两三四五六七八九十\d]+)\s*款\s*各\s*(?<each>[零一二两三四五六七八九十\d]+)\s*(?:个|对|件|套|枚|张)?|(?<![.\d])(?<number>-?\d+)\s*(?:个|对|件|套|枚|张)?(?=\D|$)(?!\s*[.．]\d)/gu;let m;
 const scanBody=operatorMatcher.quantityScan(body,allProducts.length?allProducts:products,match,arknights);
 while((m=re.exec(scanBody))){
  const phrase=clean(body.slice(start,m.index));start=re.lastIndex;
  if(m.groups.group){
   const key=entryKey(phrase),count=countValue(m.groups.group),quantity=countValue(m.groups.each);
   const q=norm(phrase),families=new Map();
   for(const p of products){const f=norm(productFamily(p));if(q===f||f.includes(q)&&q.length>=2){const k=familyKey(p);if(!families.has(k))families.set(k,[]);families.get(k).push(p);}}
   const matches=[...families.values()];
   if(phrase&&matches.length===1&&matches[0].length===count&&Number.isInteger(quantity)&&quantity>=1&&quantity<=999){
    for(const p of matches[0]){if(ignored.has(key))context=familyKey(p);else add(phrase,quantity,key+':'+p.id,{id:p.id});}
   }else if(!ignored.has(key)){
    const line={entryKey:key,phrase:phrase+m[0],quantity:null};lines.push(line);questions.push({...line,code:'group',message:`${phrase}${m[0]}：款数或商品范围不明确，请补充具体款名`});
   }
   continue;
  }
  if(!phrase){const key=entryKey('（未写制品名）');add('（未写制品名）',null,key,{code:'quantity'});continue;}
  for(const part of segments(phrase))add(part,quantities[part]??Number(m.groups.number),entryKey(part));
 }
 const tail=clean(body.slice(start));
 if(tail)for(const phrase of segments(tail))add(phrase,quantities[phrase]??1,entryKey(phrase));
 if(!items.length&&!questions.length)return {status:'skip',reason:ignored.size?'商品条目已全部删除':'未找到制品和数量',items,questions,lines};
 return {status:questions.length?'ambiguous':'resolved',items,questions,lines,...(proxyFor?{proxyFor}:{})};
}
export function compareCommentTime(a,b){return Date.parse(a.sourceAt||a.at||a.createdAt)-Date.parse(b.sourceAt||b.at||b.createdAt)||(a.sourceOrder??a.order??0)-(b.sourceOrder??b.order??0)||String(a.sourceId||a.id).localeCompare(String(b.sourceId||b.id),undefined,{numeric:true});}
export function orderedRecords(c){return [...c.records].sort((a,b)=>String(a.sourceAt||a.createdAt).localeCompare(String(b.sourceAt||b.createdAt))||(a.sourceOrder??0)-(b.sourceOrder??0)||String(a.sourceId||a.requestId||a.id).localeCompare(String(b.sourceId||b.requestId||b.id),undefined,{numeric:true})||(a.itemIndex??0)-(b.itemIndex??0));}
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
export function addComment(db,c,event){
 if(!event.id||!event.qq||!event.at||!Number.isFinite(Date.parse(event.at)))throw Error('评论必须有唯一编号、QQ号和原始时间');
 c.commentEvents??=[];if(c.commentEvents.some(e=>e.id===String(event.id)))return {duplicate:true,message:'该评论已处理'};
 if(c.orderLifecycle?.status==='completed')throw Error(`「${c.name}」本期已经结束，未录入本次排谷；如需补单，请联系管理员。`);
 const member=memberName(db,event.qq,event.groupId||c.groupId);
 const products=event.productIds?c.products.filter(p=>event.productIds.includes(p.id)):c.products;
 const parsed=parseComment(event.text,products,member,{resolutions:event.resolutions,quantities:event.quantities,allProducts:c.products,ignoredItems:event.ignoredItems,arknights:!c.botId||c.botId==='zhougu'});
 const at=new Date(event.at).toISOString();
 const log={id:String(event.id),qq:String(event.qq),at,text:String(event.text),albumId:event.albumId||'',photoIds:event.photoIds||[],feedId:event.feedId||''};
 // Commands and chatter are recorded as processed so the poller stops retrying them.
 if(parsed.status==='skip'){c.commentEvents.push({...log,skipped:true});return {skipped:true,message:parsed.reason};}
 if(!member)throw Error('请先 @bot cn 你的CN');
 if(parsed.status!=='resolved'){const error=Error(parsed.questions.map(q=>q.message).join('；'));error.questions=parsed.questions;error.items=parsed.items;error.lines=parsed.lines;throw error;}
 const displayMember=parsed.proxyFor?`${member} 代 ${parsed.proxyFor}`:member;
 if(parsed.proxyFor)log.proxyFor=parsed.proxyFor;
 const rows=parsed.items.map((item,i)=>{const p=c.products.find(p=>p.id===item.skuId);return {...item,id:randomUUID(),requestId:`comment:${event.id}:${i}`,member:displayMember,...(parsed.proxyFor?{proxyFor:parsed.proxyFor}:{}),qq:String(event.qq),name:p.name,unitCents:p.price==null?null:Math.round(p.price*100),status:p.price==null?'待定价':'暂估',source:String(event.text),sourceAt:at,sourceOrder:Number.isSafeInteger(event.order)?event.order:0,sourceId:String(event.id),itemIndex:i,createdAt:new Date().toISOString()};});
 for(const row of rows){row.albumId=event.albumId||'';row.photoIds=event.photoIds||[];row.feedId=event.feedId||'';}
 const active=rows.filter(r=>!c.commentEvents.some(e=>e.withdrawal&&e.success&&e.skuId===r.skuId&&e.qq===r.qq&&!r.proxyFor&&compareCommentTime(e,r)>=0));
 c.records.push(...active);c.commentEvents.push(log);c.records=orderedRecords(c);return {message:`已录入 ${displayMember}：${rows.map(r=>r.name+' ×'+r.quantity).join('，')}`,count:active.length};
}
export function bindAlbum(db,c,{groupId,albumId}){if(!String(groupId||'').trim()||!String(albumId||'').trim())throw Error('请填写群号和相册ID');if(c?.groupId&&String(c.groupId)!==String(groupId))throw Error('相册所属群与该期次的群不一致');db.albums??=[];if(db.albums.some(x=>(x.groupId===String(groupId)&&x.albumId===String(albumId))||x.campaignId===c.id))throw Error('相册或期次已绑定');db.albums.push({groupId:String(groupId),albumId:String(albumId),campaignId:c.id});}
export function positionMatch(anchors,bounds){
 if(!bounds)return null;const cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
 const matches=anchors.filter(a=>cx>=a.bounds.x&&cx<=a.bounds.x+a.bounds.width&&cy>=a.bounds.y&&cy<=a.bounds.y+a.bounds.height);return matches.length===1?matches[0]:null;
}
