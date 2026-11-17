export const MAX_GIFT_TIERS=5;
const digits=['零','一','二','三','四','五','六','七','八','九'];
export const tierLabel=n=>(n<10?digits[n]:n===10?'十':n<20?'十'+digits[n-10]:n===20?'二十':String(n))+'档';
export const giftCounts=plan=>Array.isArray(plan?.giftCounts)?plan.giftCounts:[plan?.tier1??0,plan?.tier2??0];
export function giftTiers(product,products){
 if(Number.isInteger(product.giftTier)&&product.giftTier>0&&product.giftTier<=MAX_GIFT_TIERS)return [product.giftTier];
 if(product.giftTier!=='set')return null;
 const ids=product.giftComponents?.length?product.giftComponents:products
  .filter(p=>p.type==='特典'&&Number.isInteger(p.giftTier)&&p.giftTier>0&&p.giftTier<=MAX_GIFT_TIERS)
  .map(p=>p.id);
 const tiers=ids.map(id=>products.find(p=>p.id===id)?.giftTier);
 return tiers.every(t=>Number.isInteger(t)&&t>0&&t<=MAX_GIFT_TIERS)?tiers.sort((a,b)=>a-b):null;
}
