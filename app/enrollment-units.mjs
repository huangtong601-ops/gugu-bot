import {randomUUID} from 'node:crypto';
import {queueEntryKey} from './queue-order.mjs';
import {orderedRecords} from './workflow.mjs';
export const physicalUnit=(id,unit)=>JSON.stringify([id,unit]);

// Return a new record set. Canonical queue keys survive a physical record split.
export function rewriteEnrollmentUnits(c,selected,apply){
 const mapping=new Map(),next=[],splitCohorts=new Set(),rank=new Map(orderedRecords(c).map((r,i)=>[r.id,i]));let extra=0;
 const cohort=r=>JSON.stringify([r.sourceAt||r.createdAt,r.sourceOrder??0,r.queueOrderId||r.sourceId||r.requestId||r.id,r.itemIndex??0]);
 for(const r of c.records){let n=0;for(let i=0;i<r.quantity;i++)if(selected.has(physicalUnit(r.id,i)))n++;
  if(n&&n<r.quantity){extra+=r.quantity-1;splitCohorts.add(cohort(r));}
 }if(extra>10000)throw Error('本次拆分数量过多，请分批操作');
 for(const raw of c.records){
  const r=splitCohorts.has(cohort(raw))?{...raw,queueRecordIndex:raw.queueRecordIndex??rank.get(raw.id)}:raw;
  const chosen=Array.from({length:r.quantity},(_,i)=>selected.has(physicalUnit(r.id,i))),count=chosen.filter(Boolean).length;
  if(!count){next.push(r);continue;}if(count===r.quantity){next.push(apply(r));continue;}
  for(let i=0;i<r.quantity;i++){
   const split={...r,id:i===0?r.id:randomUUID(),quantity:1,unitKeys:[queueEntryKey(r,i)],queueOrderId:r.queueOrderId||r.sourceId||r.requestId||r.id,queueUnitIndex:(r.queueUnitIndex||0)+i};
   mapping.set(physicalUnit(r.id,i),{recordId:split.id,unit:0,skuId:r.skuId});next.push(chosen[i]?apply(split):split);
  }
 }
 const remap=ref=>mapping.get(physicalUnit(ref.recordId,ref.unit))||ref;
 return {records:next.map(r=>r.bundleParent?{...r,bundleParent:remap(r.bundleParent)}:r),bundleLinks:c.bundleLinks?.map(link=>({...link,parent:remap(link.parent),target:remap(link.target)}))};
}
