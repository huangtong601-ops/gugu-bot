import {createHash,randomUUID} from 'node:crypto';
import {findQueueEntry} from './queue-order.mjs';
import {recordOwner,recordMember,memberName,qqForCN} from './workflow.mjs';
import {bundleVersion} from './bundles.mjs';
import {rewriteEnrollmentUnits} from './enrollment-units.mjs';

const physical=(id,unit)=>JSON.stringify([id,unit]);
const identity=(db,c,r)=>JSON.stringify([r.identityMode==='cn'?'cn:'+recordOwner(db,r,c.groupId):String(r.qq||recordOwner(db,r,c.groupId)),r.proxyFor||'']);
const source=r=>r.sourceId?'comment:'+r.sourceId:r.requestId?'request:'+r.requestId:'record:'+r.id;
export const transferVersion=(c,db)=>createHash('sha256').update(JSON.stringify([bundleVersion(c),db.members,db.groupMembers?.[c.groupId]])).digest('hex');
function selection(c,db,b){
 const entry=findQueueEntry(c,b.entryKey);if(!entry)throw Error('排位已变化，请刷新排表');
 if(!['unit','order'].includes(b.scope||'unit'))throw Error('请选择当前这一份或原评论整单');
 const ids=new Map(c.records.map(r=>[r.id,r])),selected=new Set(),edges=new Map(),owner=identity(db,c,entry.record);
 const add=(id,unit)=>{const r=ids.get(id);if(!r||!Number.isInteger(unit)||unit<0||unit>=r.quantity)throw Error('关联排位已变化，请先核对选捆');selected.add(physical(id,unit));if(selected.size>10000)throw Error('本次转让数量过多，请分批操作');};
 const edge=(a,z)=>{for(const [from,to]of [[a,z],[z,a]]){if(!edges.has(from))edges.set(from,[]);edges.get(from).push(to);}};
 for(const r of c.records)if(r.bundleParent)for(let i=0;i<r.quantity;i++)edge(physical(r.bundleParent.recordId,r.bundleParent.unit),physical(r.id,i));
 for(const link of c.bundleLinks||[])edge(physical(link.parent.recordId,link.parent.unit),physical(link.target.recordId,link.target.unit));
 if(b.scope==='order'){
  const key=source(entry.record);for(const r of c.records)if(source(r)===key&&identity(db,c,r)===owner)for(let i=0;i<r.quantity;i++)add(r.id,i);
 }else add(entry.record.id,entry.unit);
 const original=selected.size,queue=[...selected];for(let i=0;i<queue.length;i++)for(const key of edges.get(queue[i])||[])if(!selected.has(key)){const [id,unit]=JSON.parse(key);add(id,unit);queue.push(key);}
 for(const key of selected){const [id]=JSON.parse(key);if(identity(db,c,ids.get(id))!==owner)throw Error('关联捆的收款对象不一致，请先核对后再转让');}
 return {entry,selected,includesBundle:selected.size>original};
}
export function transferPreview(c,db,b){
 const {entry,selected,includesBundle}=selection(c,db,b),rows=new Map();
 for(const key of selected){const [id]=JSON.parse(key),r=c.records.find(r=>r.id===id),p=c.products.find(p=>p.id===r.skuId);if(!p)throw Error('报名商品不存在，请先核对');const cat=c.categories.find(cat=>cat.id===(p.categoryId||p.type)),k=JSON.stringify([p.id,recordMember(db,r,c.groupId)]);if(!rows.has(k))rows.set(k,{name:p.name,category:cat?.name||p.type,boxId:p.boxId||'',cn:recordMember(db,r,c.groupId),quantity:0,unit:p.unit||'件'});rows.get(k).quantity++;}
 return {version:transferVersion(c,db),fromCN:recordMember(db,entry.record,c.groupId),rows:[...rows.values()],quantity:selected.size,includesBundle};
}
function recipient(db,c,b){
 const cn=String(b.cn||'').trim(),proxyFor=String(b.proxyFor||'').trim();let qq=String(b.qq||'').trim();
 if(!cn||cn.length>40||proxyFor.length>40||/[\r\n\x00-\x1f]/u.test(cn+proxyFor))throw Error('请填写不超过40字的接收人CN，不能含换行或控制字符');
 if(qq&&!/^\d{5,12}$/u.test(qq))throw Error('QQ号格式不正确');if(b.cnOnly===true&&qq)throw Error('仅按CN录入时请清空QQ');
 if(!qq&&b.cnOnly!==true)qq=qqForCN(db,cn,c.groupId);
 const saved=qq?memberName(db,qq,c.groupId):'';if(saved&&saved!==cn)throw Error('该QQ在本群登记的CN为“'+saved+'”，请核对接收人');
 return {member:proxyFor?cn+' 代 '+proxyFor:cn,...(qq?{qq}:{}),identityMode:qq?'qq':'cn',...(proxyFor?{proxyFor}:{})};
}
export function transferEnrollment(c,db,b){
 if(b.expectedVersion!==transferVersion(c,db))throw Error('排表、选捆或CN登记已变化，请重新打开后核对');
 const {entry,selected}=selection(c,db,b),to=recipient(db,c,b),preview=transferPreview(c,db,b);
 if(identity(db,c,entry.record)===identity(db,c,to))throw Error('接收人与当前收款对象相同，无需转让');
 const at=new Date().toISOString(),before=structuredClone(c.records);
 const apply=r=>{const result={...r,...to};if(!to.qq)delete result.qq;if(!to.proxyFor)delete result.proxyFor;return result;};
 const {records:remapped,bundleLinks:afterLinks}=rewriteEnrollmentUnits(c,selected,apply),beforeLinks=structuredClone(c.bundleLinks);
 c.records=remapped;if(afterLinks)c.bundleLinks=afterLinks;
 c.transferEvents??=[];c.transferEvents.push({id:randomUUID(),at,scope:b.scope||'unit',entryKey:b.entryKey,fromCN:preview.fromCN,to:structuredClone(to),quantity:preview.quantity,before,after:structuredClone(remapped),beforeLinks,afterLinks:structuredClone(afterLinks)});
 return {message:'已将 '+preview.quantity+' 份排量转给 '+to.member+(to.qq?'（QQ：'+to.qq+'）':'（仅按CN）'),quantity:preview.quantity};
}
