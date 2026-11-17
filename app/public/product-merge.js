const normalized=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s/gu,'').replace(/[－—–]/g,'-');
export function mergeBoxPrices(categories,products,observations=[]){
  let updated=0;
  for(const value of observations){
    const ids=new Set(products.filter(p=>p.type==='通行证'&&p.boxId===value.boxId).map(p=>p.categoryId||p.type));
    if(ids.size!==1)continue;
    const category=categories.find(c=>c.id===[...ids][0]&&c.kind==='group');
    if(!category||!Number.isFinite(value.price)||value.price<=0)continue;
    category.boxPrices??={};
    if(category.boxPrices[value.boxId]==null){category.boxPrices[value.boxId]=value.price;updated++;}
  }
  return updated;
}
export function ensureGiftSet(products,newId){
 const gifts=products.filter(p=>p.type==='特典'&&p.giftTier!=='set'&&!/特典\s*set/i.test(p.name));
 const tiered=gifts
  .filter(p=>Number.isInteger(p.giftTier)&&p.giftTier>0&&p.giftTier<=5)
  .sort((a,b)=>a.giftTier-b.giftTier);
 const selection=tiered.length>=2?tiered:gifts.length===2&&gifts.every(p=>!p.giftTier)?gifts:null;
 if(!selection)return 0;
 const ids=selection.map(p=>p.id).sort();
 const existing=products.find(p=>p.giftTier==='set'||/特典\s*set/i.test(p.name||''));
 if(existing){
  if((existing.giftComponents||[]).slice().sort().join('|')===ids.join('|'))return 0;
  existing.giftComponents=ids;
  existing.aliases=[...new Set([...(existing.aliases||[]),'特典set','特典套装','全档特典SET'])];
  existing.categoryId??=selection[0].categoryId||'特典';
  return 1;
 }
 products.push({id:newId(),name:'特典SET',recognitionName:'特典SET',type:'特典',categoryId:selection[0].categoryId||'特典',giftTier:'set',giftComponents:ids,price:null,unit:'套',textOnly:true,imageUrl:'',aliases:['特典set','特典套装','全档特典SET']});return 1;
}
function sameProduct(a,b){
  if((a.type||'单领')!==(b.type||'单领'))return false;
  if(b.recognitionGroup&&(a.categoryId||a.type)!==(b.categoryId||b.type))return false;
  if(b.recognitionGroup&&String(a.boxId||'')!==String(b.boxId||''))return false;
  if(a.type==='通行证'&&a.boxId&&b.boxId&&a.boxId!==b.boxId)return false;
  const nameB=normalized(b.name);
  return !!nameB&&[a.name,a.recognitionName].some(n=>normalized(n)===nameB);
}
// Fill missing images and previously unrecognized adjustments; confirmed edits stay first-wins.
export function mergeProducts(products,incoming,newId){
  let added=0,updated=0,duplicates=0,adjusted=0;
  for(const value of incoming){
    const existing=products.find(p=>sameProduct(p,value));
    if(existing){
      if(!existing.positionAnchor&&value.positionAnchor)existing.positionAnchor=value.positionAnchor;
      let supplemented=false;
      if(!existing.giftTier&&value.giftTier){existing.giftTier=value.giftTier;updated++;supplemented=true;}
      if(!existing.imageUrl&&value.imageUrl&&!value.textOnly){
        existing.imageUrl=value.imageUrl;existing.imageKind=value.imageKind||'商品图';existing.textOnly=false;
        if(value.portraitUrl)existing.portraitUrl=value.portraitUrl;
        updated++;supplemented=true;
      }
      if(existing.type==='通行证'&&value.adjustmentSource==='recognized'&&(!existing.adjustmentSource||existing.adjustmentSource==='default')&&(existing.adjustment??0)===0){
        Object.assign(existing,{adjustment:value.adjustment,adjustmentSource:'recognized',adjustmentText:value.adjustmentText||'',adjustmentReview:false});adjusted++;supplemented=true;
      }
      if(!supplemented)duplicates++;
      continue;
    }
    products.push({...value,recognitionName:value.recognitionName||value.name,id:newId(),type:value.type||'单领',unit:value.unit||(value.type==='通行证'?'对':'件'),aliases:value.aliases||[]});added++;
  }
  return {added,updated,duplicates,adjusted};
}
