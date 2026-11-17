import {randomUUID} from 'node:crypto';
import {findQueueEntry} from './queue-order.mjs';
import {recordMember} from './workflow.mjs';
import {transferVersion} from './enrollment-transfer.mjs';
import {physicalUnit,rewriteEnrollmentUnits} from './enrollment-units.mjs';
import {isCompleted,requireEnrollmentOpen} from './campaign-lifecycle.mjs';

function entry(c,key){const e=findQueueEntry(c,key);if(!e||!c.products.some(p=>p.id===e.record.skuId))throw Error('排位或商品已变化，请刷新排表');return e;}
function blocked(c,{record:r,unit}){
 if(isCompleted(c))return '本期已结束，请先开启补单再更改商品';
 if(r.bundleParent||c.records.some(x=>x.bundleParent?.recordId===r.id&&x.bundleParent.unit===unit)||(c.bundleLinks||[]).some(link=>[link.parent,link.target].some(ref=>ref.recordId===r.id&&ref.unit===unit)))return '这一份商品有关联选捆，请先解除选捆再更改商品';
 return '';
}
export function productChangeOptions(c,db,b){
 const selected=entry(c,b.entryKey),p=c.products.find(p=>p.id===selected.record.skuId);
 return {version:transferVersion(c,db),cn:recordMember(db,selected.record,c.groupId),skuId:p.id,name:p.name,blockedReason:blocked(c,selected),products:c.products.map(p=>({id:p.id,name:p.name,boxId:p.boxId||'',category:c.categories.find(cat=>cat.id===(p.categoryId||p.type))?.name||p.type,unit:p.unit||'件',priceCents:p.price==null?null:Math.round(p.price*100)}))};
}
export function changeEnrollmentProduct(c,db,b){
 requireEnrollmentOpen(c);if(b.expectedVersion!==transferVersion(c,db))throw Error('排表、商品或选捆已变化，请重新打开后核对');
 const selected=entry(c,b.entryKey),reason=blocked(c,selected);if(reason)throw Error(reason);
 const target=c.products.find(p=>p.id===b.skuId);if(!target)throw Error('请选择本期已建档的商品');if(target.id===selected.record.skuId)throw Error('请选择与当前不同的商品');
 const at=new Date().toISOString(),before=structuredClone(c.records),beforeLinks=structuredClone(c.bundleLinks),price=target.price==null?null:Math.round(target.price*100);
 const next=rewriteEnrollmentUnits(c,new Set([physicalUnit(selected.record.id,selected.unit)]),r=>({...r,skuId:target.id,name:target.name,unitCents:price,status:price===null?'待定价':'暂估',history:[...(r.history||[]),{skuId:r.skuId,name:r.name,unitCents:r.unitCents,at,reason:'更改商品'}]}));
 c.records=next.records;if(next.bundleLinks)c.bundleLinks=next.bundleLinks;
 c.productChangeEvents??=[];c.productChangeEvents.push({id:randomUUID(),at,entryKey:b.entryKey,fromSkuId:selected.record.skuId,toSkuId:target.id,quantity:1,before,after:structuredClone(next.records),beforeLinks,afterLinks:structuredClone(next.bundleLinks)});
 return {message:'已将 '+recordMember(db,selected.record,c.groupId)+' 的这一份更改为 '+target.name,quantity:1};
}
