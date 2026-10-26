import {isGiftCategory} from './public/catalog-utils.js';
import {MAX_GIFT_TIERS} from './public/gift-tiers.js';
export const productTypes=['特典','单领','通行证'];
export function money(value,label) {
  if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value*100-Math.round(value*100))>1e-6)throw new Error(`${label}须为数字，最多两位小数`);
  return Math.round(value*100);
}
export function imageLink(value='') {
  if(!value)return '';
  if(typeof value!=='string')throw new Error('图片地址格式不正确');
  if(/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(value))return value;
  try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password)return u.href;}catch{}
  throw new Error('图片须为上传的图片或 HTTPS 地址');
}
export function catalog(value,categories=[]) {
  if(!Array.isArray(value)||!value.length||value.length>500)throw new Error('商品目录须包含 1～500 条商品');
  const ids=new Set();
  return value.map((s,i)=>{
    const id=String(s.id||`sku-${i+1}`).trim();if(!id||ids.has(id))throw new Error('商品编号重复或为空');ids.add(id);
    const type=s.type||'单领';if(!productTypes.includes(type))throw new Error('类型只能是特典、单领或通行证');
    let name=String(s.name||'').trim(),character=String(s.character||'').trim();
    let price=s.price,averagePrice=null,adjustment=0;
    const category=categories.find(c=>c.id===(s.categoryId||type));if(categories.length&&!category)throw Error('商品大类不存在');
    const gift=type==='特典'||isGiftCategory(category);if(gift&&price==null)price=null;
    const grouped=category?category.kind==='group':type==='通行证',fixed=grouped&&(category?.pricingMode==='fixed'||s.pricingMode==='fixed');
    if(grouped&&!fixed){
      character=character||(type!=='通行证'?name:'')||(/^通行证[-－]/.test(name)?name.replace(/^通行证[-－]/,''):'');if(!character)throw new Error('请填写通行证的角色名');
      if(type==='通行证')name='通行证-'+character;
      const avg=s.averagePrice==null?null:money(s.averagePrice,'通行证均价'),delta=money(s.adjustment??0,'通行证调价');
      if(avg!==null&&(avg<0||avg+delta<0))throw new Error('通行证均价与调价后价格不能为负数');
      averagePrice=avg===null?null:avg/100;adjustment=delta/100;price=avg===null?null:(avg+delta)/100;
    }else {if(!name)throw new Error('谷名不能为空');if(price!==null||!grouped&&!gift){if(money(price,gift?'特典自定价':'单领原价')<0)throw new Error('价格不能为负数');}if(grouped){averagePrice=s.averagePrice??null;adjustment=s.adjustment??0;}}
    return {id,name,giftTier:s.giftTier==='set'||Number.isInteger(s.giftTier)&&s.giftTier>=1&&s.giftTier<=MAX_GIFT_TIERS?s.giftTier:null,giftComponents:Array.isArray(s.giftComponents)?s.giftComponents.map(String):[],categoryId:category?.id||s.categoryId||type,pricingMode:fixed?'fixed':'adjustment',positionAnchor:s.positionAnchor||null,pendingFixedPrice:s.pendingFixedPrice??null,recognitionName:String(s.recognitionName||''),type,character:grouped?character:'',boxId:String(s.boxId||''),price,averagePrice,adjustment,adjustmentSource:['recognized','manual','default'].includes(s.adjustmentSource)?s.adjustmentSource:(adjustment!==0?'manual':'default'),adjustmentText:String(s.adjustmentText||'').slice(0,100),adjustmentReview:s.adjustmentReview===true,unit:String(s.unit||(type==='通行证'?'对':'件')),textOnly:s.textOnly===true,imageUrl:s.textOnly===true?'':imageLink(s.imageUrl),imageKind:['商品图','分盒总览','角色参考'].includes(s.imageKind)?s.imageKind:'商品图',portraitUrl:s.textOnly===true?'':imageLink(s.portraitUrl),aliases:Array.isArray(s.aliases)?s.aliases.map(String):[],prts:typeof s.prts==='object'&&s.prts?{status:String(s.prts.status||''),title:String(s.prts.title||''),url:typeof s.prts.url==='string'&&s.prts.url.startsWith('https://prts.wiki/w/')?s.prts.url:''}:null};
  });
}
export function enrollment(input, products) {
  const p = products.find(x => x.id === input.skuId);
  if (!p) throw new Error('未找到对应商品，请重新选择');
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) throw new Error('数量须为 1～999 的整数');
  if (typeof input.member !== 'string' || !input.member.trim()) throw new Error('请填写报名人');
  return {skuId:p.id,name:p.name,member:input.member.trim(),quantity:input.quantity,unitCents:p.price==null?null:Math.round(p.price*100),status:p.price==null?'待定价':'暂估'};
}
