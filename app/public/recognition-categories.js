import {categoryKey,validateCategoryName} from './catalog-utils.js';

// Model observations are drafts. A grouping needs an explicit printed blind-box title.
export function blindBoxRecognition(data){
 const questions=[...(data.questions||[])],categories=[],mapping=new Map(),conflicts=new Set();
 for(const raw of Array.isArray(data.groups)?data.groups.slice(0,50):[]){
  const title=String(raw.title||'').normalize('NFKC').trim();
  if(!title.includes('盲盒')||/通行(?:证|认证)/.test(title))continue;
  const name=title.replace(/盲盒/g,'').replace(/[（(]\s*[）)]/g,'').trim();
  try{validateCategoryName(name,[]);}catch{questions.push('请核对盲盒大类名称：'+title.slice(0,80));continue;}
  const id='blindbox-'+encodeURIComponent(categoryKey(name)),boxId=String(raw.boxId||'').trim().slice(0,80);
  let cat=categories.find(c=>c.id===id);
  if(!cat){cat={id,name,kind:'group',pricingMode:'adjustment',sets:0,boxPrices:{},averageModesByBox:{}};categories.push(cat);}
  mapping.set(String(raw.id||name),{id,boxId,name});
  const text=String(raw.priceText||'').normalize('NFKC'),price=raw.boxPrice;
  const amounts=[...text.matchAll(/(\d+(?:\.\d+)?)\s*元?\s*\/?\s*(?:端盒|整盒|盒|box)/gi)].map(m=>Number(m[1]));
  amounts.push(...[...text.matchAll(/(?:端盒|整盒|每盒|一盒|全盒)(?:原价|价格|价)?\s*[:：]?\s*[¥￥]?\s*(\d+(?:\.\d+)?)/g)].map(m=>Number(m[1])));
  const key=id+'|'+boxId;
  if(raw.priceStatus==='clear'&&Number.isFinite(price)&&price>0&&Math.abs(price*100-Math.round(price*100))<1e-6&&amounts.includes(price)){
   if(cat.boxPrices[boxId]!=null&&cat.boxPrices[boxId]!==price){delete cat.boxPrices[boxId];conflicts.add(key);questions.push(name+'整盒原价标注冲突，请复核');}
   else if(!conflicts.has(key))cat.boxPrices[boxId]=price;
  }else if(price!=null)questions.push(name+'整盒原价请复核');
 }
 const used=new Set();
 const products=(data.products||[]).map(p=>{
  const group=mapping.get(String(p.groupId||''));if(!group||p.type==='通行证'||p.type==='特典')return p;
  const role=String(p.character||'').trim();
  if(!role){questions.push(group.name+'款式/角色未识别，请复核');return null;}
  used.add(group.id);const cat=categories.find(c=>c.id===group.id);cat.averageModesByBox[group.boxId]='auto';
  return {...p,type:'单领',categoryId:group.id,recognitionGroup:true,name:group.name+'-'+role,character:role,boxId:group.boxId,price:null,averagePrice:null,adjustment:0,unit:p.unit&&p.unit!=='对'?p.unit:'件'};
 }).filter(Boolean);
 return {...data,products,categories:categories.filter(c=>used.has(c.id)),questions};
}

// Reuse existing names/aliases; never overwrite user prices, box counts or pricing mode.
export function mergeRecognitionCategories(categories,products,definitions=[],newId){
 let changed=false;
 for(const def of definitions){
  if(def.kind!=='group')continue;
  const referenced=products.filter(p=>p.categoryId===def.id);if(!referenced.length)continue;
  const matches=categories.filter(c=>categoryKey(c.name)===categoryKey(def.name));
  const aliases=matches.length?matches:categories.filter(c=>(c.aliases||[]).some(a=>categoryKey(a)===categoryKey(def.name)));
  if(aliases.length>1)throw Error('盲盒大类名称有歧义：'+def.name);
  let cat=aliases[0];if(cat&&cat.kind!=='group')throw Error('已有同名单领大类，请先更名或将其改为拼团类：'+def.name);
  if(!cat){validateCategoryName(def.name,categories);cat={...structuredClone(def),id:newId()};categories.push(cat);changed=true;}
  cat.boxPrices??={};cat.averageModesByBox??={};
  for(const [box,price]of Object.entries(def.boxPrices||{}))if(cat.boxPrices[box]==null){cat.boxPrices[box]=price;changed=true;}
  for(const [box,mode]of Object.entries(def.averageModesByBox||{}))if(cat.averageModesByBox[box]==null){cat.averageModesByBox[box]=mode;changed=true;}
  for(const p of referenced){p.categoryId=cat.id;p.pricingMode=cat.pricingMode||'adjustment';}
 }
 return changed;
}
