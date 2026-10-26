export function createQQHealthProbe({now=()=>Date.now(),ttl=15000,timeout=8000}={}){
 const states=new WeakMap();
 return {async read(connection){
  if(!connection||connection.status()!=='已连接')return {connected:false,online:null,checkedAt:null,error:''};
  let state=states.get(connection);if(!state){state={};states.set(connection,state);}if(state.active)return state.active;
  if(state.result&&now()-state.at<ttl)return state.result;
  state.active=(async()=>{let timer;try{const status=await Promise.race([Promise.resolve().then(()=>connection.call('get_status',{})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeout);})]);state.result={connected:true,online:status?.online===true,checkedAt:new Date(now()).toISOString(),error:''};}
   catch{state.result={connected:true,online:null,checkedAt:new Date(now()).toISOString(),error:'QQ在线状态核对失败'};}
   finally{clearTimeout(timer);state.at=now();state.active=null;}return state.result;
  })();return state.active;
 }};
}
export function runtimeSummary(db,{groupId='',health={},inbound,outcome}={}){
 groupId=String(groupId);const group=db.qqGroups?.find(g=>String(g.id)===groupId);
 if(groupId&&!group)throw Error('当前群不在管理列表');
 const albums=(db.albums||[]).filter(b=>String(b.groupId)===groupId).map(b=>{const c=db.campaigns.find(c=>c.id===b.campaignId);if(!c||String(c.groupId)!==groupId)return null;return {campaignId:c.id,name:c.name,albumName:b.albumName||'群相册',at:b.sync?.at||null,error:b.sync?.error||'',pending:b.pending?.length||0,imported:b.sync?.imported||0};}).filter(Boolean);
 const own=e=>e&&String(e.groupId)===groupId;
 return {groupId,groupName:group?.name||'',enabled:group?.enabled!==false,health,
  inbound:own(inbound)?{at:inbound.at}:null,
  outcome:own(outcome)?{at:outcome.at,status:String(outcome.outcome||'').split('：')[0],error:outcome.error||''}:null,
  albums,pending:albums.reduce((n,a)=>n+a.pending,0),syncPaused:db.albumSyncPaused===true};
}
