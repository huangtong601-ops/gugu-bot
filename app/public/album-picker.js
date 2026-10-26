export function createAlbumPicker({api,action,notice,current,activeGroup,bindings,refresh}){
 const select=document.getElementById('albumSelect'),list=document.getElementById('listAlbums'),bind=document.getElementById('bindAlbum'),status=document.getElementById('albumResult');
 const cache=new Map();let context='',generation=0,loading=false,error='';
 const group=()=>String(activeGroup()||'');
 const binding=()=>bindings().find(a=>a.campaignId===current()?.id&&String(a.groupId)===group());
 function draw(){
  const saved=binding(),items=cache.get(group()),previous=select.value;select.replaceChildren();
  if(!group())select.add(new Option('请先选择群聊',''));
  else if(loading&&!items)select.add(new Option('正在读取相册…',''));
  else if(!items)select.add(new Option(saved?'已绑定相册，待读取名称':'请先读取群相册',''));
  else if(!items.length)select.add(new Option('这个群还没有相册',''));
  else{
   select.add(new Option('请选择相册',''));const duplicateNames=new Map();
   for(const album of items){const count=items.filter(a=>a.name===album.name).length,index=(duplicateNames.get(album.name)||0)+1;duplicateNames.set(album.name,index);const own=album.boundCampaignId===current()?.id,other=album.boundCampaignId&&!own;const text=album.name+(count>1?'（同名'+index+'）':'')+(own?'（已绑定本期）':other?'（已绑定 '+album.boundCampaignName+'）':'');const option=new Option(text,album.id);option.disabled=!!other;select.add(option);}
   const desired=items.some(a=>a.id===previous)?previous:saved&&items.some(a=>a.id===saved.albumId)?saved.albumId:items.length===1&&!items[0].boundCampaignId?items[0].id:'';select.value=desired;
  }
  select.disabled=loading||!items?.length;list.disabled=loading||!group()||!current();
  const selected=items?.find(a=>a.id===select.value),own=selected?.boundCampaignId===current()?.id;
  bind.disabled=loading||!current()||!selected||!!selected.boundCampaignId;bind.textContent=own?'已绑定本期':'绑定相册到本期';
  status.textContent=error||(loading?'正在读取当前群的相册…':saved?(saved.albumName?'当前绑定：'+saved.albumName:'当前期次已有相册绑定')+(items&&!items.some(a=>a.id===saved.albumId)?'；本次列表未找到该相册，请核对。':''):items?'读取到 '+items.length+' 个相册':'');
 }
 async function read(){
  const c=current(),gid=group();if(!c||!gid)throw Error('请先选择群聊和期次');
  const token=++generation;loading=true;error='';draw();
  try{const result=await api('qq-albums',{campaignId:c.id,groupId:gid});if(token!==generation)return;cache.set(gid,result.albums);const saved=binding();if(saved&&result.albums.some(a=>a.id===saved.albumId)){const photos=await api('qq-album-photos',{groupId:gid,albumId:saved.albumId});if(token!==generation)return;if(photos.warning)error=photos.warning;}if(token!==generation)return;await refresh();}
  catch(e){if(token!==generation)return;error=e.message;throw e;}
  finally{if(token===generation){loading=false;draw();}}
 }
 function render(load=false){
  const next=group()+'|'+(current()?.id||'');if(context!==next){context=next;generation++;loading=false;error='';select.value='';}
  draw();if(load&&group()&&current()&&!cache.has(group())&&!loading&&!error)void action(read);
 }
 list.onclick=()=>action(read);
 select.onchange=()=>draw();
 bind.onclick=()=>action(async()=>{
  const c=current(),gid=group(),id=select.value;if(!c||!id)throw Error('请选择相册');
  bind.disabled=true;
  try{const result=await api('album-bind',{campaignId:c.id,groupId:gid,albumId:id});const item=cache.get(gid)?.find(a=>a.id===id);if(item){item.boundCampaignId=c.id;item.boundCampaignName=c.name;}await refresh();if(current()?.id===c.id&&group()===gid)notice('已绑定相册：'+result.albumName);}
  finally{draw();}
 });
 return {render};
}
