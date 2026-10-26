import {createHash} from 'node:crypto';

export const queueScope=(categoryId,boxId,columnId)=>JSON.stringify([categoryId,boxId||'',columnId]);
export const queueEntryKey=(record,unit)=>JSON.stringify([String(record.id||record.requestId||record.sourceId||''),unit]);
export const queueVersion=entries=>createHash('sha256').update(JSON.stringify(entries.map(e=>[e.entryKey,e.cn]))).digest('hex');

// Existing manual relative order stays intact. New/late comments enter before their
// next chronological neighbour, rather than acquiring an artificial comment time.
export function orderQueue(c,scope,entries){
 const saved=c.queueOrder?.columns?.[scope];if(!Array.isArray(saved)||!saved.length)return entries;
 const live=new Map(entries.map(e=>[e.entryKey,e])),seen=new Set(),result=[];
 for(const key of saved)if(live.has(key)&&!seen.has(key)){result.push(live.get(key));seen.add(key);}
 const anchors=new Map();let next=null;
 for(let i=entries.length-1;i>=0;i--){const e=entries[i];if(seen.has(e.entryKey))next=e.entryKey;else anchors.set(e.entryKey,next);}
 for(const e of entries)if(!seen.has(e.entryKey)){const anchor=anchors.get(e.entryKey),index=anchor===null?-1:result.findIndex(x=>x.entryKey===anchor);if(index<0)result.push(e);else result.splice(index,0,e);}
 return result;
}
