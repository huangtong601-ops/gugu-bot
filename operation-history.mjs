import {randomUUID} from 'node:crypto';
const clone=value=>value===undefined?undefined:structuredClone(value);
const semantic=(value,key='')=>Array.isArray(value)?value.map(v=>semantic(v)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['revision','version'].includes(k)).map(([k,v])=>[k,semantic(v,k)])):value;
const same=(a,b)=>JSON.stringify(semantic(a))===JSON.stringify(semantic(b));
// Credentials, connection state, usage accounting and model side effects are never undo data.
export function businessState(db){return clone({campaigns:db.campaigns||[],albums:db.albums||[],members:db.members||{},groupMembers:db.groupMembers||{},qqGroups:db.qqGroups||[],qqEnrollmentEnabled:db.qqEnrollmentEnabled===true});}
export function businessDiff(before,after){
 const patches=[];
 const a=new Map(before.campaigns.map(c=>[c.id,c])),b=new Map(after.campaigns.map(c=>[c.id,c]));
 for(const id of new Set([...a.keys(),...b.keys()])){
  const x=a.get(id),y=b.get(id);
  if(!x||!y){if(!same(x,y))patches.push({id,field:null,before:clone(x),after:clone(y)});continue;}
  for(const field of new Set([...Object.keys(x),...Object.keys(y)]))if(field!=='revision'&&!same(x[field],y[field]))patches.push({id,field,before:clone(x[field]),after:clone(y[field])});
  if(!same(x.orderLifecycle,y.orderLifecycle)&&same(x.records,y.records))patches.push({id,field:'records',before:clone(y.records),after:clone(y.records),guardOnly:true});
 }
 for(const field of ['albums','members','groupMembers','qqGroups','qqEnrollmentEnabled'])if(!same(before[field],after[field]))patches.push({field,before:clone(before[field]),after:clone(after[field])});
 return patches;
}
export function applyInverse(db,patches){
 for(const p of patches){const c=p.id?db.campaigns.find(c=>c.id===p.id):db,value=p.id&&p.field===null?c:c?.[p.field];if(!same(value,p.after))throw Error('这一步相关数据已有新的修改或相册评论，不能覆盖；请刷新后核对');}
 for(const p of patches)if(p.id&&p.field==='products'){const ids=new Set((p.before||[]).map(x=>x.id)),recordsPatch=patches.find(q=>q.id===p.id&&q.field==='records'&&!q.guardOnly),records=recordsPatch?recordsPatch.before:db.campaigns.find(c=>c.id===p.id)?.records||[];if(records.some(r=>!ids.has(r.skuId)))throw Error('商品已有新的排谷，不能撤销删除其建档');}
 for(const p of [...patches].reverse()){
  if(p.guardOnly)continue;
  if(p.id&&p.field===null){db.campaigns=db.campaigns.filter(c=>c.id!==p.id);if(p.before)db.campaigns.push(clone(p.before));continue;}
  const object=p.id?db.campaigns.find(c=>c.id===p.id):db,previous=object[p.field];
  if(p.before===undefined)delete object[p.field];else object[p.field]=clone(p.before);
  if(p.id&&['orderPlanning','settlement','orderLifecycle'].includes(p.field)&&object[p.field])object[p.field].version=Math.max(previous?.version||0,object[p.field].version||0)+1;
 }
 for(const id of new Set(patches.map(p=>p.id).filter(Boolean))){const c=db.campaigns.find(c=>c.id===id);if(c)c.revision=(c.revision||0)+1;}
}
export function createOperationHistory(){
 const clients=new Map();
 return {record(client,label,patches){if(!client||!patches.length)return null;if(!clients.has(client)&&clients.size>=16)clients.delete(clients.keys().next().value);const stack=clients.get(client)||[],entry={id:randomUUID(),label,patches};stack.push(entry);while(stack.length>50||stack.length>1&&JSON.stringify(stack).length>16*1024*1024)stack.shift();clients.set(client,stack);return {id:entry.id,label};},
  peek(client){const e=clients.get(client)?.at(-1);return e?{id:e.id,label:e.label}:null;},
  undo(db,client,id){const stack=clients.get(client),entry=stack?.at(-1);if(!entry||entry.id!==id)throw Error('撤销记录已变化，请刷新后重试');if(entry.patches.some(p=>!p.guardOnly&&p.id&&p.field==='records'&&db.campaigns.find(c=>c.id===p.id)?.orderLifecycle?.status==='completed'))throw Error('本期已结束，请先撤销下单完成或开启补单');applyInverse(db,entry.patches);return entry.label;},
  accept(client,id){const stack=clients.get(client);if(stack?.at(-1)?.id===id)stack.pop();},
  clear(){clients.clear();}};
}
