import {blindBoxRecognition} from './public/recognition-categories.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readAdjustment} from './pass-adjustment.mjs';
export async function loadReferences(root){
  const dir=path.join(root,'skills/arknights-pingu/references');
  const boxes=JSON.parse(await fs.readFile(path.join(dir,'pass-boxes.json'),'utf8'));
  const roster=JSON.parse(await fs.readFile(path.join(dir,'characters.json'),'utf8'));
  const labels=JSON.parse(await fs.readFile(path.join(dir,'character-labels.json'),'utf8'));
  for(const c of roster.characters){const label=labels.characters.find(x=>x.name===c.name)?.appellation;if(label)c.aliases=[...new Set([...c.aliases,label])];}
  return {boxes:boxes.boxes,characters:roster.characters,meta:{checkedAt:boxes.checkedAt,source:boxes.source,license:boxes.license,scope:boxes.scope}};
}
export function findBox(ref,text){
  let id=String(text||'').trim().replace(/^盲盒/,'').replace(/^通行(?:证|认证)[-－\s]*/,'');
  if(/^\d+$/.test(id))id+='.0';
  return ref.boxes.find(b=>b.id===id)||null;
}
export function characterReference(ref,name){
  const key=String(name||'').trim().toLocaleLowerCase();
  const exact=ref.characters.filter(c=>c.name.toLocaleLowerCase()===key);
  const matches=exact.length?exact:ref.characters.filter(c=>c.aliases.some(a=>a.toLocaleLowerCase()===key));
  if(matches.length!==1)return {name,portraitUrl:'',status:matches.length?'别名有歧义，待人工核对':'待人工核对',candidates:matches.map(m=>m.name),url:'https://prts.wiki/w/'+encodeURIComponent(name)};
  const c=matches[0];return {...c,status:'本地名称对照，未在线验证',url:'https://prts.wiki/w/'+encodeURIComponent(c.name)};
}
export function expandBox(ref,text){
  const box=findBox(ref,text);if(!box)throw new Error('未收录该分盒，请识别图片中的角色');
  return {box,products:box.characters.map((c,i)=>({id:`pass-${encodeURIComponent(box.id)}-${i+1}`,name:'通行证-'+c.name,type:'通行证',character:c.name,boxId:box.id,price:null,averagePrice:null,adjustment:0,unit:'对',imageUrl:c.portraitUrl||box.imageUrl,imageKind:c.portraitUrl?'角色参考':'分盒总览',portraitUrl:c.portraitUrl,aliases:[],prts:{title:c.name,status:'本地分盒对照，未在线验证',url:'https://prts.wiki/w/'+encodeURIComponent(c.name)}}))};
}
export function boxRosterHint(ref,ids=ref.boxes.map(b=>b.id)){
  return '\n分盒角色对照（先读盒号，再限定在该盒名单内核对；括号内是可核对的商品印字/别名，不得用熟悉的其他角色替代，不得按名单顺序分配调价）：\n'+[...new Set(ids)].map(id=>findBox(ref,id)).filter(Boolean).map(b=>`${b.id}：${b.characters.map(c=>{const aliases=ref.characters.find(r=>r.name===c.name)?.aliases||[];return c.name+(aliases.length?'（'+aliases.join('/')+'）':'');}).join('、')}`).join('\n');
}
export function adjustmentRetryBoxes(ref,data){
  const incomplete=(data.boxIds||[]).map(id=>findBox(ref,id)).filter(Boolean).filter(box=>{
    const entries=(data.products||[]).filter(p=>p.type==='通行证'&&findBox(ref,p.boxId)?.id===box.id);
    return /[+＋−－-]\s*\d/.test((data.questions||[]).join(' '))&&entries.length<box.characters.length;
  }).map(b=>b.id);
  return [...new Set([...incomplete,...(data.products||[]).filter(p=>p.type==='通行证').filter(p=>{
    const box=findBox(ref,p.boxId),reading=readAdjustment(p);
    const role=characterReference(ref,p.character||p.name?.replace(/^通行证[-－]/,'')||'').name;
    return box&&(reading.adjustmentSource==='recognized'||reading.adjustmentReview)&&(!box.characters.some(c=>c.name===role)||reading.adjustmentReview);
  }).map(p=>findBox(ref,p.boxId).id)])];
}
export function replaceBoxObservations(ref,first,retry,ids){
  // Only replace requested pass observations. Other merchandise always survives.
  const wanted=new Set(ids);
  const complete=ids.filter(id=>findBox(ref,id)?.characters.every(c=>(retry.products||[]).some(p=>findBox(ref,p.boxId)?.id===id&&characterReference(ref,p.character).name===c.name&&readAdjustment(p).adjustmentSource==='recognized')));
  const questions=(first.questions||[]).filter(q=>!(complete.some(id=>String(q).includes(id))&&/角色|调价/.test(q)&&/无法|复核|核对|不清|不能|未能|指定/.test(q)));
  return {...first,products:[...first.products.filter(p=>!(p.type==='通行证'&&wanted.has(findBox(ref,p.boxId)?.id))),...(retry.products||[]).filter(p=>p.type==='通行证'&&wanted.has(findBox(ref,p.boxId)?.id))],questions:[...questions,...(retry.questions||[])]};
}
export function enrichRecognition(ref,data){
  if(!data||!Array.isArray(data.products))throw new Error('模型未返回商品清单');
  const questions=Array.isArray(data.questions)?data.questions.map(String):[];
  const boxIds=[...new Set([...(Array.isArray(data.boxIds)?data.boxIds:[]),...data.products.filter(p=>p.type==='通行证'&&p.boxId).map(p=>p.boxId)])];
  const expansions=[],expandedIds=new Set();
  for(const id of boxIds){const box=findBox(ref,id);if(box&&!expandedIds.has(box.id)){expandedIds.add(box.id);expansions.push(...expandBox(ref,box.id).products);}else if(!box)questions.push(`请核对新分盒 ${id} 的角色。`);}
  const applied=new Map();
  for(const p of data.products.filter(p=>p.type==='通行证')){
    const role=characterReference(ref,p.character||p.name?.replace(/^通行证[-－]/,'')||'').name;
    const known=findBox(ref,p.boxId)?.id;
    if(p.boxId&&!known)continue;
    const targets=expansions.filter(x=>x.character===role&&(!known||x.boxId===known));
    const reading=readAdjustment(p);
    if(!targets.length){if(known&&(reading.adjustmentSource==='recognized'||reading.adjustmentReview))questions.push(`调价标注 ${reading.adjustmentText} 未能匹配 ${known} 的角色 ${role}，请复核`);continue;}
    if(targets.length!==1){if(reading.adjustmentSource==='recognized'||reading.adjustmentReview)questions.push(`角色 ${role} 的调价对应分盒不明确，请复核`);continue;}
    const target=targets[0],key=target.id,previous=applied.get(key);
    if(p.cropBounds){target.cropBounds=p.cropBounds;target.positionAnchor=p.positionAnchor||null;}
    if(!p.boxId)p.boxId=target.boxId;
    if(previous&&previous.adjustmentSource==='recognized'&&reading.adjustmentSource==='recognized'&&previous.adjustment!==reading.adjustment){Object.assign(target,{adjustment:0,adjustmentSource:'default',adjustmentReview:true,adjustmentText:`${previous.adjustmentText} / ${reading.adjustmentText}`});applied.set(key,{...target,conflict:true});questions.push(`角色 ${role} 的调价标注冲突，请复核`);continue;}
    if(previous?.conflict)continue;
    if(reading.adjustmentSource==='recognized'||!previous){Object.assign(target,reading);applied.set(key,reading);}
    if(reading.adjustmentReview)questions.push(`角色 ${role} 的调价 ${reading.adjustmentText||'标注'} 请复核`);
  }
  const products=data.products.filter(p=>!(p.type==='通行证'&&expandedIds.has(findBox(ref,p.boxId)?.id))).map((p,i)=>{
    const type=['特典','单领','通行证'].includes(p.type)?p.type:'单领';
    const next={...p,id:String(p.id||`sku-${i+1}`),type,imageUrl:'',imageKind:'商品图'};
    if(type==='特典')next.price=null;
    if(type==='通行证'){
      const observed=String(p.character||p.name?.replace(/^通行证[-－]/,'')||'');
      const match=characterReference(ref,observed);next.character=match.name;next.name='通行证-'+match.name;next.price=null;next.averagePrice=null;Object.assign(next,readAdjustment(p));next.unit='对';next.portraitUrl=match.portraitUrl;next.prts={title:match.name,status:match.status,url:match.url};
      if(next.adjustmentReview)questions.push(`角色 ${observed} 的调价 ${next.adjustmentText||'标注'} 请复核`);
      if(match.status==='待人工核对'||match.candidates)questions.push(`角色 ${observed} 请核对${match.candidates?.length?'：'+match.candidates.join('、'):''}`);
    }
    return next;
  });
  const boxPrices=[],conflicts=new Set();
  for(const observation of Array.isArray(data.boxPrices)?data.boxPrices:[]){
    const boxId=findBox(ref,observation.boxId)?.id||String(observation.boxId||'').trim(),price=observation.price,text=String(observation.priceText||'').normalize('NFKC');
    // Require a clear printed whole-box label, never infer from per-draw price.
    const labels=[...text.matchAll(/(\d+(?:\.\d+)?)\s*元?\s*\/?\s*(?:整盒|盒|box)/gi)].map(x=>Number(x[1]));
    labels.push(...[...text.matchAll(/(?:整盒|每盒|一盒|全盒)(?:原价|价格|价)?\s*[:：]?\s*[¥￥]?\s*(\d+(?:\.\d+)?)/g)].map(x=>Number(x[1])));
    if(!boxId||observation.status!=='clear'||!Number.isFinite(price)||price<=0||Math.abs(price*100-Math.round(price*100))>1e-6||!labels.includes(price)){
      questions.push(`请核对 ${boxId||'未标盒号'} 的整盒原价`);continue;
    }
    const previous=boxPrices.find(x=>x.boxId===boxId);
    if(previous&&previous.price!==price){conflicts.add(boxId);questions.push(`分盒 ${boxId} 的整盒原价标注冲突，请复核`);}
    else if(!previous)boxPrices.push({boxId,price,priceText:String(observation.priceText).slice(0,100)});
  }
  return blindBoxRecognition({...data,boxPrices:boxPrices.filter(x=>!conflicts.has(x.boxId)),products:[...products,...expansions],questions,expandedBoxes:[...expandedIds]});
}
export async function verifyPrts(names,fetcher=fetch){
  if(!Array.isArray(names)||!names.length||names.length>30||names.some(n=>typeof n!=='string'||!n.trim()||n.length>80))throw new Error('请提供 1～30 个角色名称');
  const u=new URL('https://prts.wiki/api.php');
  const params={action:'query',format:'json',prop:'info|pageimages',inprop:'url',piprop:'thumbnail',pithumbsize:'200',redirects:'1',titles:names.join('|')};
  for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
  const response=await fetcher(u,{signal:AbortSignal.timeout(12000),headers:{'user-agent':'PinguDesk/0.1 (character reference lookup)'}});
  if(!response.ok)throw new Error(`PRTS 查询失败（HTTP ${response.status}），可打开角色资料页核对`);
  const data=await response.json();if(!data.query?.pages)throw new Error('PRTS 未返回角色资料');
  const pages=Object.values(data.query.pages);return names.map(name=>{
    const normal=data.query.normalized?.find(n=>n.from===name)?.to||name;
    const target=data.query.redirects?.find(r=>r.from===normal)?.to||normal;
    const p=pages.find(p=>p.title===target);return {name,title:p?.title||name,status:p&&p.missing===undefined&&p.pageid>0?'PRTS 页面存在，图像身份仍需人工核对':'PRTS 未找到该名称',url:'https://prts.wiki/w/'+encodeURIComponent(p?.title||name)};
  });
}
