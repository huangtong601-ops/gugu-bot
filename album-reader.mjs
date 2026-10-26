// Read-only QQ group-album feed protocol, verified against public request schema.
export async function readGroupAlbums(call,groupId){
 const group=String(groupId||'').trim();if(!/^\d{5,12}$/.test(group))throw Error('请先选择有效的QQ群');
 const albums=new Map(),cursors=new Set();let attach='';
 for(let page=0;page<100;page++){
  const data=await call('get_qun_album_list',{group_id:group,attach_info:attach});
  if(!data||data.result&&String(data.result)!=='0')throw Error('群相册读取失败：'+(data?.errMs||data?.error||'返回数据异常'));
  if(!Array.isArray(data.album_list))throw Error('QQ未返回有效的群相册列表，请稍后重试');
  for(const item of data.album_list){const id=String(item.album_id||'').trim();if(!id)throw Error('群相册缺少编号，请重新读取');const name=String(item.name||item.album_name||'').trim()||'未命名相册';albums.set(id,{id,name,photoCount:Number.isSafeInteger(Number(item.upload_number))?Number(item.upload_number):null});}
  if(!data.has_more)return [...albums.values()];
  const next=data.attach_info;if(typeof next!=='string'||!next||cursors.has(next))throw Error('群相册分页未完整读取，请重新读取');cursors.add(next);attach=next;
 }
 throw Error('群相册分页过多，请稍后重试');
}
const varint=n=>{n=BigInt(n);const b=[];do{let v=Number(n&127n);n>>=7n;if(n)v|=128;b.push(v);}while(n);return Buffer.from(b);};
const uint=(f,n)=>Buffer.concat([varint(f*8),varint(n)]);
const bytes=(f,s)=>{const b=Buffer.isBuffer(s)?s:Buffer.from(String(s));return Buffer.concat([varint(f*8+2),varint(b.length),b]);};
export function feedRequest(group,album,media,options={}){const data=Buffer.concat([bytes(2,group),bytes(3,options.feedId||''),uint(4,20),bytes(5,options.attachInfo||''),bytes(6,album),bytes(7,options.batchId??media.batch_id??''),bytes(8,options.lloc??media.image?.lloc??media.video?.lloc??'')]);return Buffer.concat([uint(1,0),bytes(2,''),bytes(3,''),bytes(4,data),bytes(5,'_'+Date.now()),bytes(10,Buffer.concat([bytes(1,'fc-appid'),bytes(2,'100')]))]);}
export function decodeProto(buffer,depth=0){if(depth>14)throw Error('响应层级过深');let pos=0;const out=[];function read(){let n=0n,s=0n;for(let i=0;i<10;i++){if(pos>=buffer.length)throw Error('响应截断');const b=buffer[pos++];n|=BigInt(b&127)<<s;if(!(b&128))return n;s+=7n;}throw Error('响应整数无效');}
 while(pos<buffer.length){const tag=Number(read()),field=tag>>>3,wire=tag&7;if(!field)throw Error('响应字段无效');let value;if(wire===0)value=read().toString();else if(wire===2){const len=Number(read());if(len>buffer.length-pos)throw Error('响应长度无效');const b=buffer.subarray(pos,pos+len);pos+=len;const text=b.toString('utf8');if(!b.length)value='';else if(!text.includes('\ufffd')&&!/[\x00-\x08\x0b-\x1f]/.test(text))value=text;else{try{value=decodeProto(b,depth+1);}catch{value={hex:b.toString('hex')};}}}else if(wire===5){if(pos+4>buffer.length)throw Error('响应截断');value=buffer.readUInt32LE(pos);pos+=4;}else if(wire===1){if(pos+8>buffer.length)throw Error('响应截断');value=buffer.readBigUInt64LE(pos).toString();pos+=8;}else throw Error('响应类型无效');out.push({field,wire,value});if(out.length>20000)throw Error('响应字段过多');}return out;}
// Keep bytes as bytes until the schema says text. Numeric-only comments are text too.
function fields(buffer){
 let pos=0;const out=[];const read=()=>{let n=0n;for(let i=0;i<10;i++){if(pos>=buffer.length)throw Error('相册响应截断');const b=buffer[pos++];n|=BigInt(b&127)<<BigInt(i*7);if(!(b&128))return n;}throw Error('相册响应整数无效');};
 while(pos<buffer.length){const tag=Number(read()),field=tag>>>3,wire=tag&7;if(!field)throw Error('相册响应字段无效');let value;if(wire===0)value=read().toString();else if(wire===2){const len=Number(read());if(len>buffer.length-pos)throw Error('相册响应长度无效');value=buffer.subarray(pos,pos+len);pos+=len;}else if(wire===1||wire===5){const len=wire===1?8:4;if(pos+len>buffer.length)throw Error('相册响应截断');value=buffer.subarray(pos,pos+len);pos+=len;}else throw Error('相册响应类型无效');out.push({field,wire,value});if(out.length>20000)throw Error('相册响应字段过多');}return out;
}
const one=(a,f)=>a.find(x=>x.field===f)?.value;
const message=(a,f)=>{const b=one(a,f);return Buffer.isBuffer(b)?fields(b):[];};
const string=(a,f)=>{const b=one(a,f);return b==null?'':Buffer.isBuffer(b)?b.toString('utf8'):String(b);};
export function parseFeedResponse(hex,{groupId,albumId,photoIds=[],batchId=''}){
 if(typeof hex!=='string'||!hex.length||hex.length%2||!/^[a-f0-9]+$/i.test(hex))throw Error('相册详情未返回有效数据');
 const root=fields(Buffer.from(hex,'hex'));if(string(root,2)&&string(root,2)!=='0')throw Error('相册详情读取失败：'+string(root,3));
 const data=message(root,4),feed=message(message(data,2),1);if(!feed.length)throw Error('相册响应缺少动态详情');
 const feedId=string(message(feed,1),4),wrapper=message(feed,7),comments=[];
 for(const entry of wrapper.filter(x=>x.field===2)){
  const row=fields(entry.value),user=message(row,2),id=string(row,1),qq=string(user,13)||string(user,14),seconds=Number(string(row,4));
  const text=row.filter(x=>x.field===3).map(x=>{const part=fields(x.value);if(Number(string(part,1)||0)!==0)throw Error('评论含非文字内容，需人工核对');return string(part,2);}).join('');
  if(!id||!/^\d{5,12}$/.test(qq)||!Number.isSafeInteger(seconds)||seconds<=0)throw Error('相册评论缺少编号、QQ号或原始时间');
  comments.push({id:`${groupId}/${albumId}/${id}/${qq}/${seconds}`,commentId:id,qq,at:new Date(seconds*1000).toISOString(),text,groupId,albumId,feedId,batchId,photoIds});
 }
 const caption=message(feed,4).filter(x=>x.field===1).map(x=>{const p=fields(x.value);return Number(string(p,1)||0)===0?string(p,2):'';}).join('');
 return {comments,caption,total:Number(string(wrapper,1)||0),hasMore:string(data,3)==='1',attachInfo:string(data,4),feedId};
}
export async function readAlbumFeeds(call,group,album,{onPhotos}={}){
 const media=[],batches=new Set();let attach='',pages=0;const seen=new Set();do{
  const data=await call('get_group_album_media_list',{group_id:group,album_id:album,attach_info:attach});if(!data||data.result&&String(data.result)!=='0')throw Error('相册读取失败：'+(data?.errMs||'返回数据异常'));if(!Array.isArray(data.media_list))throw Error('QQ未返回完整的相册图片清单');
  media.push(...(data.media_list||[]));for(const b of data.batch_list||[])if(b.link_id)batches.add(String(b.link_id));
  if(!data.next_has_more)break;const next=data.next_attach_info;if(!next||seen.has(next)||++pages>=100)throw Error('相册分页未完整读取');seen.add(next);attach=next;
 }while(true);
 const photos=[...new Map(media.filter(m=>m.image?.lloc).map(m=>[m.image.lloc,{id:m.image.lloc,batchId:String(m.batch_id||''),url:(m.image.photo_url?.find(p=>p.spec===6)||m.image.photo_url?.[0])?.url?.url||m.image.default_url?.url||'',thumbnail:m.image.default_url?.url||''}])).values()];
 await onPhotos?.(photos);
 for(const p of photos)if(p.batchId)batches.add(p.batchId);
 const targets=[...batches].map(batchId=>({batchId,lloc:'',photoIds:photos.filter(p=>p.batchId===batchId).map(p=>p.id)})).filter(target=>target.photoIds.length);
 targets.push(...photos.map(p=>({batchId:p.batchId,lloc:p.id,photoIds:[p.id]})));
 const unique=new Map(),captions=new Map();for(const target of targets){let cursor='',feedId='',count=0;const cursors=new Set();for(let page=0;page<100;page++){
  const response=await call('send_packet',{cmd:'QunAlbum.trpc.qzone.webapp_qun_feeds.FeedsReader.GetQunFeedDetail',data:feedRequest(group,album,{}, {...target,feedId,attachInfo:cursor}).toString('hex'),rsp:true});
  const parsed=parseFeedResponse(response,{groupId:group,albumId:album,...target});count+=parsed.comments.length;
  if(parsed.caption.trim())captions.set(parsed.feedId,{text:parsed.caption,feedId:parsed.feedId,photoIds:target.photoIds});
  for(const comment of parsed.comments){const prior=unique.get(comment.id);if(prior&&prior.text!==comment.text)throw Error('同一评论返回不同内容，请稍后重试');if(!prior||comment.photoIds.length<prior.photoIds.length)unique.set(comment.id,comment);}
  if(!parsed.hasMore&&count>=parsed.total)break;
  if(!parsed.comments.length||!parsed.attachInfo||cursors.has(parsed.attachInfo)||page===99)throw Error('相册评论分页未完整读取');
  cursors.add(parsed.attachInfo);cursor=parsed.attachInfo;feedId=parsed.feedId;
 }}
 return {photos,captions:[...captions.values()],comments:[...unique.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.commentId.localeCompare(b.commentId,undefined,{numeric:true}))};
}
