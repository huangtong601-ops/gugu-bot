export function readAdjustment(product){
  const text=String(product.adjustmentText||'').slice(0,100);
  const base={adjustment:0,adjustmentSource:'default',adjustmentText:text,adjustmentReview:false};
  if(!text&&(!product.adjustmentStatus||product.adjustmentStatus==='none')&&!product.adjustment)return base;
  const normalized=text.normalize('NFKC').replace(/[−－—–]/g,'-').replace(/^加/,'+').replace(/^减/,'-').replace(/\s/g,'');
  const match=normalized.match(/^([+-]\d+(?:\.\d{1,2})?)(?:元)?(?:\/对)?$/);
  const value=product.adjustment;
  if(product.adjustmentStatus==='clear'&&match&&typeof value==='number'&&Number.isFinite(value)&&Math.abs(value*100-Math.round(value*100))<1e-6&&Number(match[1])===value)return {...base,adjustment:value,adjustmentSource:'recognized'};
  return {...base,adjustmentReview:true};
}
