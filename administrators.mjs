// qqAdmins is authoritative once present; qqAdmin remains the first-entry legacy mirror.
export function administratorList(db){
 const raw=Object.hasOwn(db,'qqAdmins')?(Array.isArray(db.qqAdmins)?db.qqAdmins:[]):[db.qqAdmin];
 return [...new Set(raw.map(v=>String(v??'').trim()).filter(v=>/^\d{5,12}$/.test(v)))];
}
export function isAdministrator(db,qq){return administratorList(db).includes(String(qq||''));}
export function updateAdministrator(db,{qqAdmin,action='add',version}={}, {botQQ='',allowExisting=false}={}){
 const qq=String(qqAdmin||'').trim();if(!/^\d{5,12}$/.test(qq))throw Error('请填写正确的管理员QQ号');
 if(!['add','remove'].includes(action))throw Error('管理员操作无效');
 const revision=Number.isSafeInteger(db.qqAdminVersion)?db.qqAdminVersion:0;
 if(version!==undefined&&version!==revision)throw Error('管理员列表已变化，请刷新后重试');
 const admins=administratorList(db),exists=admins.includes(qq);
 if(action==='add'){
  if(qq===String(botQQ))throw Error('管理员QQ应填写你的个人QQ，不能与机器人QQ相同');
  if(exists&&!allowExisting)throw Error('该QQ已是管理员');
  if(!exists&&admins.length>=50)throw Error('管理员数量已达上限');
 }else if(!exists)throw Error('该管理员已被删除，请刷新列表');
 const changed=action==='remove'||!exists,next=action==='remove'?admins.filter(x=>x!==qq):exists?admins:[...admins,qq];
 db.qqAdmins=next;db.qqAdmin=next[0]||'';db.qqAdminVersion=revision+(changed?1:0);
 return {ok:true,qqAdmins:[...next],qqAdmin:db.qqAdmin,qqAdminVersion:db.qqAdminVersion};
}
