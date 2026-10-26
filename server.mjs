import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash,randomInt} from 'node:crypto';
import {createCredentialStore} from './credentials.mjs';
import {catalog,enrollment} from './domain.mjs';
import {normalizeKey,upstreamError,modelHttpError} from './api-config.mjs';
import {originalBounds} from './public/image-geometry.js';
import {providers,providerConfig,modelOptions,inferenceRequest,responseText} from './providers.mjs';
import {createBotRegistry,importedRecognition} from './bots.mjs';
import {createGlossaryStore} from './glossary.mjs';
import {loadReferences,expandBox,enrichRecognition,verifyPrts,boxRosterHint,adjustmentRetryBoxes,replaceBoxObservations} from './pass-reference.mjs';
import {saveImage,readImage,mediaFilename,mimeFor} from './media.mjs';
import {defaultCategories,categories,registerCN,memberName,recordMember,parseComment,addComment,bindAlbum,summary,orderedRecords,positionMatch} from './workflow.mjs';
import {workbook} from './tables.mjs';
import {enrollmentView,reorderQueue} from './enrollment-view.mjs';
import {processQQEvent,canHandleQQEvent,isMentioned,messageText,SCOPE_HINT} from './qq-commands.mjs';
import {connectOneBot} from './onebot.mjs';
import {createNapcatLogin} from './napcat-login.mjs';
import qqRuntime from './qq-runtime.cjs';
import {readAlbumFeeds,readGroupAlbums} from './album-reader.mjs';
import {queryQueue} from './queue-query.mjs';
import {createUsageStore} from './usage.mjs';
import {validateSetup} from './public/setup-state.js';
import {createPrivacyGuard,trustedLocalRequest,textMessage} from './security.mjs';
import {createServerConnection,connectionRoute} from './server-connection.mjs';
import {administratorList,updateAdministrator} from './administrators.mjs';
import {purchasePool,normalizePool,planOrders,cents} from './order-planning.mjs';
import {settlementSettings,settlementSummary,creditTypes,applyAutomaticGroupPrices} from './settlement.mjs';
import {ensureGiftSet} from './public/product-merge.js';
import {isCompleted,requireEnrollmentOpen,planningIssues,purchaseSource,sourceHash,completeCampaign,openSupplement,supplementaryPool,appendSupplement,validatePurchasedCatalog} from './campaign-lifecycle.mjs';
import {businessState,businessDiff,createOperationHistory,applyInverse} from './operation-history.mjs';
import {createWorkspaceBackups} from './workspace-backups.mjs';
import {searchProducts,productDeletionReason,categoryDeletionReason,validateCatalogChanges} from './catalog-management.mjs';
import {createQQHealthProbe,runtimeSummary} from './runtime-status.mjs';
import {applyAlbumComments,remindCompletedComments,createAlbumPoller,scopedProducts,scopeFromCaption,retryPending,dismissPending,deletePendingItem,deriveBatchScopes,batchPhotos,IGNORE_SCOPE,albumScope,reconcileAlbumPhotos} from './album-sync.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
async function listenLocal(server,port){
  const bind=value=>new Promise((resolve,reject)=>{const fail=e=>{server.removeListener('listening',ready);reject(e);},ready=()=>{server.removeListener('error',fail);resolve();};server.once('error',fail);server.once('listening',ready);server.listen(value,'127.0.0.1');});
  if(port!==0)return bind(port);
  // Windows may allocate low ephemeral service ports blocked by Fetch/Chromium.
  for(let attempt=0;attempt<32;attempt++)try{return await bind(randomInt(49152,65536));}catch(e){if(!['EADDRINUSE','EACCES'].includes(e.code)||attempt===31)throw e;}
}
export async function start({port=3218,dataDir=path.join(root,'data'),upstreamFetch=fetch,referenceFetch=fetch,credentialStore=createCredentialStore(dataDir),desktopActions={},qqConnector=connectOneBot,usageClock=()=>new Date(),remoteFetch=fetch,allowServerConnection=true,napcatRuntimeDir='',qqConfig=null}={}) {
  const privacy=createPrivacyGuard(),vault=credentialStore;
  credentialStore={async get(config){const value=await vault.get(config);privacy.remember(value);return value;},async set(config,value){privacy.remember(value);return vault.set(config,value);}};
  await fs.mkdir(dataDir,{recursive:true});
  let localRequests=0,backendSuspended=false;const localEvents=new Set();
  const connection=allowServerConnection?await createServerConnection({dataDir,credentialStore,privacy,fetcher:remoteFetch,
    beforeChange:async()=>{if(localRequests)throw Error('本机仍有操作正在处理，请完成后再切换');backendSuspended=true;qqConnection?.close();await albumPoller.idle();await Promise.allSettled([...localEvents]);await queue.catch(()=>{});},
    afterChange:async next=>{backendSuspended=false;if(next.mode==='local'&&db.qqSettings?.url)try{await openQQ();}catch{}}
  }):null;
  const dbFile=path.join(dataDir,'workspace.json');
  let db; try {db=JSON.parse(await fs.readFile(dbFile,'utf8'));} catch(e) {if(e.code!=='ENOENT')throw e;db={campaigns:[],settings:{baseUrl:'https://api.openai.com/v1',model:''}};}
  db.qqAdmins=administratorList(db);db.qqAdmin=db.qqAdmins[0]||'';db.qqAdminVersion=Number.isSafeInteger(db.qqAdminVersion)?db.qqAdminVersion:0;
  if(qqConfig){const u=new URL(qqConfig.url);if(!['ws:','wss:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('服务器QQ网关必须是本机WebSocket地址');privacy.remember(qqConfig.token);await credentialStore.set({provider:'qq',baseUrl:u.href},qqConfig.token||'');db.qqSettings={url:u.href};}
  const legacyAPI=db.settings?.apiKey||db.apiKey,legacyQQ=db.qqSettings?.token;
  db.qqEnrollmentEnabled=db.qqEnrollmentEnabled===true;
  privacy.remember(legacyAPI);privacy.remember(legacyQQ);
  db.settings={...providerConfig(db.settings||{}),model:String(db.settings?.model||'')};
  for(const c of db.campaigns)c.categories??=defaultCategories();
  for(const c of db.campaigns){c.botId=c.botId||'zhougu';c.products=c.products.map(p=>({...p,type:p.type||'单领',imageUrl:p.imageUrl||''}));}
  for(const c of db.campaigns)if(ensureGiftSet(c.products,randomUUID))c.revision=(c.revision||0)+1;
  db.qqGroups??=[];if(!Array.isArray(db.qqGroups))db.qqGroups=[];
  const seedGroup=(id,name)=>{id=String(id||'');if(!id||db.qqGroups.some(g=>String(g.id)===id))return;db.qqGroups.push({id,name:String(name||('群 '+id)),enabled:true});};
  if(db.qqTestGroup?.id)seedGroup(db.qqTestGroup.id,db.qqTestGroup.name);
  for(const album of db.albums||[])seedGroup(album.groupId,album.groupName);
  for(const c of db.campaigns){
    if(c.groupId!==undefined)continue;
    const binding=(db.albums||[]).find(a=>a.campaignId===c.id);
    c.groupId=binding?String(binding.groupId):(db.qqGroups.length===1?db.qqGroups[0].id:'');
  }
  for(const binding of db.albums||[])try{deriveBatchScopes(binding);}catch{}
  let apiKey=await credentialStore.get(db.settings), queue=Promise.resolve();
  if(!apiKey&&typeof legacyAPI==='string'&&legacyAPI.trim()){apiKey=normalizeKey(legacyAPI);await credentialStore.set(db.settings,apiKey);}
  if(typeof legacyQQ==='string'&&legacyQQ&&db.qqSettings?.url){const u=new URL(db.qqSettings.url);if(['ws:','wss:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash)await credentialStore.set({provider:'qq',baseUrl:u.href},legacyQQ);}
  const beforePrivacy=JSON.stringify(db);db=privacy.clean(db);const needsPrivacyMigration=!!legacyAPI||!!legacyQQ||beforePrivacy!==JSON.stringify(db);
  let knownModels=[];
  async function getModels(config,key) {
    if(!key)throw new Error('请先填写该服务商的 API 密钥');
    privacy.remember(key);
    const response=await upstreamFetch(config.baseUrl+'/models',{headers:{authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(await upstreamError(response,key));
    const result=privacy.clean(await response.json());if(!Array.isArray(result.data))throw new Error('服务未返回兼容的模型列表');
    const models=modelOptions(config.provider,result.data);if(!models.length)throw new Error('该密钥未返回适合当前应用的模型，请确认模型权限或使用自定义兼容服务');
    return models;
  }
  const history=createOperationHistory(),backups=await createWorkspaceBackups(dataDir,{clean:privacy.clean});
  let durable=structuredClone(db),tableState={pending:false,error:''},backupError='';
  const save=(operation={})=>{
    const snapshot=JSON.stringify(privacy.clean(db),null,2),snapshotDb=JSON.parse(snapshot),patches=operation.before?businessDiff(operation.before,businessState(snapshotDb)):[];
    const task=queue.then(async()=>{
      try{await backups.automatic(durable);backupError='';}catch(error){backupError='自动备份失败：'+privacy.error(error);}
      try{await fs.writeFile(dbFile+'.tmp',snapshot);await fs.rename(dbFile+'.tmp',dbFile);}catch(error){if(patches.length)try{applyInverse(db,patches);}catch{}throw error;}
      durable=snapshotDb;
      const undo=history.record(operation.client,operation.label,patches);
      const failures=[];
      try{await fs.mkdir(path.join(dataDir,'tables'),{recursive:true});}catch(error){failures.push(privacy.error(error));}
      if(!failures.length)for(const campaign of snapshotDb.campaigns){try{campaign.categories??=defaultCategories();const target=path.join(dataDir,'tables',campaign.id+'.xlsx');await fs.writeFile(target+'.tmp',workbook(campaign,snapshotDb,{kind:'enrollment'}));await fs.rename(target+'.tmp',target);}catch(error){failures.push(privacy.error(error));}}
      tableState={pending:!!failures.length,error:failures.length?'业务数据已保存，排表文件更新失败；关闭占用的 Excel 后重试。'+failures[0]:''};
      return {undo,workspaceSaved:true};
    });queue=task.catch(()=>{});return task;
  };
  if(needsPrivacyMigration)await save();
  const usage=await createUsageStore(dataDir,{now:usageClock});
  async function modelResult(request,c,purpose){
    const config={...db.settings},key=apiKey,ticket=await usage.begin(privacy.clean(config),{groupId:c.groupId,campaignId:c.id,purpose});let response,recorded=false;
    try{
      response=await upstreamFetch(request.url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify(privacy.clean(request.body)),redirect:'error',signal:AbortSignal.timeout(90000)});
      let payload;try{payload=await response.json();}catch{await usage.finish(ticket,null,'invalid-response');recorded=true;const error=Error(response.ok?'模型接口未返回有效JSON':modelHttpError(response.status));if(!response.ok)error.httpStatus=response.status;throw error;}
      await usage.finish(ticket,payload,response.ok?'response':'http-error');recorded=true;
      if(!response.ok){const error=Error(await upstreamError({status:response.status,json:async()=>payload},key));error.httpStatus=response.status;throw error;}
      return payload;
    }catch(error){if(!recorded)await usage.finish(ticket,null,response?'invalid-response':'network-error');throw error;}
  }
  const registry=await createBotRegistry(root,dataDir),skills=registry.skills,refs=await loadReferences(root),glossary=await createGlossaryStore(root,dataDir);
  const commandOptions=async text=>({...(text.startsWith('解释')?{terms:(await glossary.read()).entries}:{}),usageReport:(groupId,period)=>usage.report(groupId,period)});
  let qqConnection=null;
  let qqLastInbound=null;
  const qqActivity=new Map(),qqHealth=createQQHealthProbe();
  // Last 20 inbound events with the outcome, so "the bot ignored me" can be answered from data.
  const qqEvents=[];
  const albumReads=new WeakMap();
  async function readBoundAlbum(binding){
    const ticket={mediaRefreshed:false};albumReads.set(binding,ticket);
    try{const result=await readAlbumFeeds((action,params)=>qqConnection.call(action,params),binding.groupId,binding.albumId,{onPhotos:async photos=>{if(albumReads.get(binding)!==ticket||backendSuspended||connection?.remote)return;const before=JSON.stringify(binding);reconcileAlbumPhotos(binding,photos);if(JSON.stringify(binding)!==before)await save();ticket.mediaRefreshed=true;}});return albumReads.get(binding)===ticket?result:null;}
    catch(error){if(albumReads.get(binding)!==ticket)return null;error.albumPhotosRefreshed=ticket.mediaRefreshed;throw error;}
  }
  async function identifyAlbumPhotos(binding,result){
    const c=db.campaigns.find(c=>c.id===binding.campaignId);binding.photoScopes??={};binding.photoErrors??={};
    // 先落盘图片清单：后续识别/范围确认失败也不能把整批图片藏掉。
    binding.photos=result.photos||[];binding.captions=result.captions||[];
    if(!c?.products?.length){for(const photo of binding.photos)binding.photoErrors[photo.id]='本期还没有保存商品，请先在商品建档保存商品';return;}
    for(const [id,scope]of Object.entries(binding.photoScopes))if(scope.source==='图片识别'&&scope.recognizerVersion!==2)delete binding.photoScopes[id];
    for(const [digest,scope]of Object.entries(binding.imageScopes||{}))if(scope.source==='图片识别'&&scope.recognizerVersion!==2)delete binding.imageScopes[digest];
    // A per-photo caption takes precedence over an upload-batch caption.
    for(const photo of result.photos){if(binding.photoScopes[photo.id]?.source==='人工确认')continue;const candidates=(result.captions||[]).filter(x=>x.photoIds.includes(photo.id)).sort((a,b)=>a.photoIds.length-b.photoIds.length);if(candidates.length){const scope=scopeFromCaption(candidates[0].text,c);if(scope){try{scopedProducts(c,scope);binding.photoScopes[photo.id]={...scope,feedId:candidates[0].feedId};delete binding.photoErrors[photo.id];}catch(e){binding.photoErrors[photo.id]=privacy.error(e);}}}}
    const ids=new Set(result.comments.filter(e=>!c.commentEvents?.some(x=>x.id===e.id)).flatMap(e=>e.photoIds));
    binding.photoAttempts??={};
    for(const photo of result.photos.filter(p=>ids.has(p.id)&&!binding.photoScopes[p.id]&&(binding.photoAttempts[p.id]?.recognizerVersion!==2||binding.photoAttempts[p.id]?.revision!==c.revision||Date.now()>(binding.photoAttempts[p.id]?.retryAt||0)))){
      try{
        const u=new URL(photo.url);if(u.protocol!=='https:'||u.hostname!=='qungz.photo.store.qq.com')throw Error('图片地址无效');
        const response=await referenceFetch(u.href,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('相册图片读取失败');
        const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>7*1024*1024)throw Error('相册图片超过7MB');chunks.push(chunk);}const bytes=Buffer.concat(chunks);
        const mime=response.headers.get('content-type')?.split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(mime))throw Error('相册图片格式不受支持');
        const digest=createHash('sha256').update(bytes).digest('hex');
        let scope=binding.imageScopes?.[digest];
        // Reuse a previously recognized source only when the original bytes match.
        if(!scope&&c.lastRecognition?.imageUrl){try{const local=await readImage(dataDir,c.lastRecognition.imageUrl),body=Buffer.from(local.split(',')[1],'base64');if(createHash('sha256').update(body).digest('hex')===digest){const names=c.lastRecognition.result?.products?.map(p=>p.name)||[];const ps=c.products.filter(p=>names.includes(p.name));if(ps.length)scope={productIds:ps.map(p=>p.id),source:'已识别原图'};}}catch{}}
        if(!scope){
          if(!apiKey)throw Error('请先连接图片模型，或手动确认图片商品范围');
          const catalog=c.products.map(p=>({id:p.id,name:p.name,categoryId:p.categoryId||p.type,boxId:p.boxId||''}));
          const prompt=`判断这张群相册商品图片对应的商品范围，用于限定其下所有评论的报名检索。你将看到同一原图的完整重叠切片，必须检查全部切片，不能看到特典或通行证后省略其他商品。只依据图片，不根据评论猜商品种类。当前大类：${JSON.stringify(c.categories.map(x=>({id:x.id,name:x.name,kind:x.kind})))}。本期商品：${JSON.stringify(catalog)}。如果明确是某个拼团类的一整盒/调价表，返回该categoryId和图中明确写出的boxId，productIds为空；不能省略盒号。如果是单领/混合商品图，返回图上实际包含的所有目录商品id列表，不要把同角色其他商品算入。混合多个大类时categoryId留空，不能只取其中一类。无法确定返回status=uncertain。只返回JSON：{"status":"resolved或uncertain","categoryId":"目录id或空","boxId":"明确盒号或空","productIds":[]}。`;
          const images=desktopActions.prepareAlbumImages?await desktopActions.prepareAlbumImages(bytes):[`data:${mime};base64,${bytes.toString('base64')}`];
          if(images.reduce((n,s)=>n+s.length,0)>45*1024*1024)throw Error('相册图片分片过大，请填写上传说明');
          const request=inferenceRequest(db.settings,skills.get(c.botId),[{type:'text',text:prompt},...images.map(url=>({type:'image_url',image_url:{url}}))]);
          const result=await modelResult(request,c,'album-scope');
          const inferred=privacy.clean(JSON.parse(responseText(result).replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));
          if(inferred.status!=='resolved')throw Error('图片商品范围不明确，请手动确认');
          const category=c.categories.find(x=>x.id===inferred.categoryId);
          if(inferred.productIds?.length){if(!Array.isArray(inferred.productIds)||inferred.productIds.some(id=>!c.products.some(p=>p.id===id)))throw Error('图片识别含目录外商品');scope={productIds:inferred.productIds,categoryId:category?.id||'',boxId:inferred.boxId||'',source:'图片识别'};}
          else{if(category?.kind!=='group'||!inferred.boxId)throw Error('图片未能确定具体商品或分盒');scope={categoryId:category.id,boxId:String(inferred.boxId),source:'图片识别'};}
        }
        scope={...scope,recognizerVersion:2};scopedProducts(c,scope);if(binding.photoScopes[photo.id]?.source!=='人工确认')binding.photoScopes[photo.id]={...scope,digest};binding.imageScopes??={};binding.imageScopes[digest]=scope;delete binding.photoErrors[photo.id];
      }catch(e){binding.photoErrors[photo.id]=privacy.error(e);binding.photoAttempts[photo.id]={recognizerVersion:2,revision:c.revision,retryAt:Date.now()+300000};}
    }
  }
  const albumPoller=createAlbumPoller({read:async()=>{
    if(backendSuspended||connection?.remote||db.albumSyncPaused||qqConnection?.status()!=='已连接')return [];
    const results=[];for(const binding of db.albums||[]){if(!canHandleQQEvent(db,{group_id:binding.groupId}))continue;
      try{const result=await readBoundAlbum(binding);if(!result)continue;const ticket=albumReads.get(binding);
        // 2026-10-25 用户要求：后台读相册不得主动@人；缺CN的评论只保留在待核对里，等本人来登记CN后再自动补录。
        if(backendSuspended||connection?.remote)continue;
        if(!isCompleted(db.campaigns.find(c=>c.id===binding.campaignId)))await identifyAlbumPhotos(binding,result);
        if(backendSuspended||connection?.remote)continue;if(albumReads.get(binding)!==ticket){reconcileAlbumPhotos(binding,binding.photos);continue;}
        results.push({albumId:binding.albumId,...applyAlbumComments(db,binding,result)});
        await remindCompletedComments(db,binding,{send:params=>qqConnection.call('send_group_msg',params),persist:save,allowed:()=>!backendSuspended&&!connection?.remote&&qqConnection?.status()==='已连接'&&canHandleQQEvent(db,{group_id:binding.groupId})});}
      catch(e){binding.sync={...binding.sync,at:new Date().toISOString(),error:privacy.error(e)};results.push({albumId:binding.albumId,error:privacy.error(e)});}
    }
    if(results.length)await save();return results;
  }});
  const napcat=createNapcatLogin({runtimeDir:()=>napcatRuntimeDir||qqRuntime.runtimePaths(root,dataDir).configRoot});
  async function openQQ(){
    if(backendSuspended||connection?.remote)return;
    qqConnection?.close();const token=await credentialStore.get({provider:'qq',baseUrl:db.qqSettings.url});
    qqConnection=qqConnector({url:db.qqSettings.url,token,onEvent:async e=>{
      if(backendSuspended||connection?.remote)return;
      let endEvent;const eventTask=new Promise(resolve=>endEvent=resolve);localEvents.add(eventTask);try{
      const entry={at:new Date().toISOString(),type:String(e.post_type||e.kind||''),userId:String(e.user_id||''),groupId:String(e.group_id||''),messageId:String(e.message_id||''),text:privacy.text(messageText(e.message)).slice(0,120),outcome:'未处理'};
      if(e.post_type==='message'){qqLastInbound=entry;const previous=qqActivity.get(entry.groupId)||{};qqActivity.set(entry.groupId,{...previous,inbound:entry});if(qqActivity.size>100)qqActivity.delete(qqActivity.keys().next().value);}
      const done=outcome=>{entry.outcome=privacy.text(outcome);qqEvents.unshift(entry);if(qqEvents.length>20)qqEvents.pop();qqActivity.set(entry.groupId,{...qqActivity.get(entry.groupId),outcome:entry});};
      if(e.post_type!=='message'&&e.kind!=='album_comment')return;
      if(!canHandleQQEvent(db,e)){
        // Staying silent outside the bound scope looked like a broken bot; answer an addressed group once.
        if(e.post_type==='message'&&e.group_id&&isMentioned(e)){try{await qqConnection.call('send_group_msg',{group_id:e.group_id,message:textMessage(SCOPE_HINT)});return done('群不在处理范围，已回复提示');}catch(error){entry.error=privacy.error(error);return done('群不在处理范围，提示发送失败');}}
        return done('群不在处理范围');
      }
      let result;try{result=processQQEvent(db,e,await commandOptions(messageText(e.message)));if(result.ignored)return done('已忽略：'+(result.reason||'无需处理'));if(!result.readOnly)await save();}catch(error){result={reply:'操作失败：'+privacy.error(error)};entry.error=privacy.error(error);}
      if(result.exportCampaignId){try{const campaign=db.campaigns.find(c=>c.id===result.exportCampaignId);const target=path.join(dataDir,'tables',campaign.id+'-肾表.xlsx');await fs.writeFile(target,workbook(privacy.clean(campaign),privacy.clean(db),{kind:'settlement'}));await qqConnection.call('upload_group_file',{group_id:e.group_id,file:target,name:'肾表.xlsx'});}catch(error){entry.error=privacy.error(error);result.reply='肾表暂无法导出：'+privacy.error(error);}}
      if(!result.reply)return done('无需回复');
      result.reply=privacy.text(result.reply);
      try{await qqConnection.call(e.group_id?'send_group_msg':'send_private_msg',e.group_id?{group_id:e.group_id,message:textMessage(result.reply)}:{user_id:e.user_id,message:textMessage(result.reply)});done('已回复：'+result.reply.slice(0,80));}
      catch(error){entry.error=privacy.error(error);done('回复发送失败');}
      }finally{localEvents.delete(eventTask);endEvent();}
    }});
  }
  if(db.qqSettings?.url)try{await openQQ();}catch{}
  async function settleLocalOperations(){
    const deadline=Date.now()+5000;
    while(localRequests>1){if(Date.now()>deadline)throw Error('还有操作正在处理，请稍后重试');await new Promise(resolve=>setTimeout(resolve,20));}
    let timer;try{await Promise.race([Promise.all([albumPoller.idle(),...localEvents]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('相册或机器人仍在处理操作，请稍后重试')),10000);})]);}finally{clearTimeout(timer);}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('cross-origin-resource-policy','same-origin');res.setHeader('x-frame-options','DENY');
    let operationResult=null;
    const reply=(code,data)=>{const output=JSON.stringify(privacy.clean(code===200&&data&&typeof data==='object'&&!Array.isArray(data)?{...data,...(operationResult?.undo?{undo:operationResult.undo}:{}),maintenance:{tables:tableState,backupError,albumSyncPaused:db.albumSyncPaused===true}}:data));res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(output);};
    let localWork=false;
    try {
      if(!trustedLocalRequest(req,server.address().port))return reply(403,{error:'请求来源不允许'});
      const url=new URL(req.url,'http://localhost');
      if(connectionRoute(url.pathname)){
        if(!connection)return reply(404,{error:'服务器端不提供本机连接设置'});
        if(req.method==='GET'&&url.pathname==='/api/server-connection')return reply(200,await connection.view());
        if(req.method!=='POST')return reply(405,{error:'不支持此操作'});
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'请使用JSON请求'});
        let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>16384)throw Error('连接配置过大');}
        let b;try{b=JSON.parse(text||'{}');}catch{throw Error('连接配置不是有效JSON');}if(!b||typeof b!=='object'||Array.isArray(b))throw Error('连接配置无效');
        privacy.remember(b.token);
        return reply(200,url.pathname==='/api/server-test'?await connection.test(b):await connection.configure(b));
      }
      if(connection?.busy||backendSuspended)return reply(503,{error:'正在切换工作区，请稍候'});
      if(connection?.remote&&(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')))return await connection.forward(req,res);
      if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')){localRequests++;localWork=true;}
      if(req.method==='GET'&&url.pathname==='/api/export'){const c=db.campaigns.find(c=>c.id===url.searchParams.get('campaignId'));if(!c)throw Error('期次不存在');if(url.searchParams.get('kind')==='settlement'){const calculated=applyAutomaticGroupPrices(c,db);if(calculated.updated)await save();}const output=workbook(privacy.clean(c),privacy.clean(db),{kind:url.searchParams.get('kind')==='settlement'?'settlement':'enrollment'});res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(c.name+(url.searchParams.get('kind')==='settlement'?'-肾表.xlsx':'-排表.xlsx'))});return res.end(output);}
      if(req.method==='GET' && url.pathname==='/api/state')return reply(200,{...db,bots:registry.bots,providers,models:knownModels,hasKey:!!apiKey,skill:{name:'arknights-pingu',version:'0.2.0'},references:{...refs.meta,boxes:refs.boxes.map(b=>({id:b.id,count:b.characters.length}))},qq:{connected:qqConnection?.status()==='已连接',status:qqConnection?.status()||'未连接'}});
      if(req.method==='GET'&&url.pathname==='/api/usage-config')return reply(200,usage.configuration(db.settings));
      if(req.method==='GET'&&url.pathname==='/api/qq-runtime')return reply(200,desktopActions.qqRuntimeInfo?await desktopActions.qqRuntimeInfo():{supported:false,available:false});
      if(req.method==='GET'&&url.pathname==='/api/glossary')return reply(200,{...(await glossary.read()),file:glossary.file});
      if(req.method==='GET'&&url.pathname==='/api/glossary-file'){const data=await glossary.read();res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('拼谷术语解释.md')});return res.end(data.markdown);}
      if(req.method==='GET'&&url.pathname.startsWith('/media/')){
        const file=mediaFilename(url.pathname);const bytes=await fs.readFile(path.join(dataDir,'media',file));res.writeHead(200,{'content-type':mimeFor(file),'x-content-type-options':'nosniff'});return res.end(bytes);
      }
      // Album images are hotlink-protected on QQ's CDN; serve them through the app and cache on disk.
      if(req.method==='GET'&&url.pathname==='/api/album-photo'){
        const group=String(url.searchParams.get('groupId')||''),album=String(url.searchParams.get('albumId')||''),photoId=String(url.searchParams.get('photoId')||''),full=url.searchParams.get('size')==='full';
        const binding=db.albums?.find(a=>a.groupId===group&&a.albumId===album);if(!binding)throw Error('相册未绑定');
        const photo=binding.photos?.find(p=>p.id===photoId);if(!photo)throw Error('图片不存在');
        const remote=full?photo.url:(photo.thumbnail||photo.url);if(!remote)throw Error('图片地址为空');
        const key=createHash('sha1').update([group,album,photoId,full?'full':'thumb'].join('/')).digest('hex');
        const cacheDir=path.join(dataDir,'album-cache');await fs.mkdir(cacheDir,{recursive:true});
        let name=null;try{name=(await fs.readdir(cacheDir)).find(n=>n.startsWith(key));}catch{}
        if(!name){
          const u=new URL(remote);if(u.protocol!=='https:'||u.hostname!=='qungz.photo.store.qq.com')throw Error('相册图片地址无效');
          const image=await referenceFetch(u.href,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!image.ok)throw Error('相册图片读取失败');
          const type=(image.headers.get('content-type')||'').split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(type))throw Error('相册图片格式不受支持');
          const chunks=[];let length=0;for await(const chunk of image.body){length+=chunk.length;if(length>8*1024*1024)throw Error('相册图片过大');chunks.push(chunk);}
          name=key+(type==='image/png'?'.png':type==='image/webp'?'.webp':'.jpg');await fs.writeFile(path.join(cacheDir,name),Buffer.concat(chunks));
        }
        const type=name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':'image/jpeg';
        res.writeHead(200,{'content-type':type,'cache-control':'private, max-age=604800','x-content-type-options':'nosniff'});return res.end(await fs.readFile(path.join(cacheDir,name)));
      }
      if(req.method==='POST' && url.pathname.startsWith('/api/')) {
        if(req.headers.origin!==`http://127.0.0.1:${server.address().port}`)return reply(403,{error:'请求来源不允许'});
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'请使用JSON请求'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>12*1024*1024)throw new Error('请求过大，请使用较小图片');}
        let b;try{b=JSON.parse(body||'{}');}catch{throw Error('请求不是有效JSON');}if(!b||typeof b!=='object'||Array.isArray(b))throw Error('请求须为JSON对象');
        for(const field of ['apiKey','token','password'])privacy.remember(b[field]);
        if(url.pathname==='/api/runtime-status'){
          const group=String(b.groupId||'');if(group&&!db.qqGroups.some(g=>String(g.id)===group))throw Error('当前群不在管理列表');
          return reply(200,runtimeSummary(db,{groupId:group,health:await qqHealth.read(qqConnection),...qqActivity.get(group)}));
        }
        let undoBefore=businessState(db);const op=(label)=>({before:undoBefore,client:typeof b.undoClient==='string'&&/^[a-f0-9-]{36}$/.test(b.undoClient)?b.undoClient:'',label});
        if(url.pathname==='/api/undo-state')return reply(200,{entry:history.peek(b.undoClient)});
        if(url.pathname==='/api/undo'){
          backendSuspended=true;try{await settleLocalOperations();const before=businessState(db),label=history.undo(db,b.undoClient,b.id);await save({before});history.accept(b.undoClient,b.id);return reply(200,{ok:true,label});}finally{backendSuspended=false;}
        }
        if(url.pathname==='/api/backups')return reply(200,{backups:await backups.list()});
        if(url.pathname==='/api/backup-create')return reply(200,{backup:await backups.create(db,'手动备份')});
        if(url.pathname==='/api/backup-preview')return reply(200,await backups.preview(db,b.id));
        if(url.pathname==='/api/backup-restore'){
          backendSuspended=true;try{await settleLocalOperations();const before=businessState(db),restored=await backups.restore(db,b);for(const c of restored.campaigns){const previous=db.campaigns.find(x=>x.id===c.id);c.revision=Math.max(c.revision||0,previous?.revision||0)+1;for(const field of ['orderPlanning','settlement','orderLifecycle'])if(c[field])c[field].version=Math.max(c[field].version||0,previous?.[field]?.version||0)+1;}Object.assign(db,restored);db.albumSyncPaused=true;await save({before});history.clear();return reply(200,{ok:true});}finally{backendSuspended=false;}
        }
        if(url.pathname==='/api/album-sync-resume'){db.albumSyncPaused=false;await save();return reply(200,{ok:true});}
        if(url.pathname==='/api/tables-retry'){await save();return reply(200,{ok:!tableState.pending});}
        if(url.pathname==='/api/qq-admin'){
          let botQQ='';if((b.action||'add')==='add'&&qqConnection?.status()==='已连接')botQQ=String((await qqConnection.call('get_login_info',{})).user_id||'');
          const result=updateAdministrator(db,b,{botQQ});await save();return reply(200,result);
        }
        if(url.pathname==='/api/enrollment-view'){const c=db.campaigns.find(c=>c.id===b.campaignId);if(!c)throw Error('期次不存在');return reply(200,enrollmentView(c,db));}
        if(url.pathname==='/api/usage-pricing'){
          if(b.provider!==db.settings.provider||b.baseUrl!==db.settings.baseUrl||b.model!==db.settings.model)throw Error('当前模型已变化，请重新读取单价设置');
          return reply(200,await usage.configure(db.settings,b.pricing));
        }
        if(url.pathname==='/api/usage-report'){const group=String(b.groupId||'');if(!db.qqGroups.some(g=>String(g.id)===group&&g.enabled!==false))throw Error('群不在管理范围');return reply(200,usage.report(group,b.period||'all'));}
        if(url.pathname==='/api/onboarding-start'){
          if(!db.onboarding?.completedAt&&!db.onboarding?.startedAt){db.onboarding={version:1,startedAt:new Date().toISOString()};await save();}
          return reply(200,{ok:true});
        }
        if(url.pathname==='/api/onboarding-complete'){
          if(!apiKey||!db.settings.model)throw Error('请先保存并验证 API 和模型');
          if(qqConnection?.status()!=='已连接')throw Error('请先完成QQ登录并连接机器人');
          const [identity,status]=await Promise.all([qqConnection.call('get_login_info',{}),qqConnection.call('get_status',{})]);
          const result=validateSetup({hasKey:!!apiKey,settings:db.settings,adminQQ:b.adminQQ,expectedQQ:b.qq,identity,online:status.online,connected:true});
          updateAdministrator(db,{qqAdmin:result.admin},{botQQ:result.qq,allowExisting:true});db.onboarding={version:1,completedAt:new Date().toISOString()};await save();return reply(200,{ok:true,qq:result.qq});
        }
        if(url.pathname==='/api/skill-import'){const bot=await registry.importSkill(b.text,b.name);return reply(200,{bot});}
        if(url.pathname==='/api/glossary-entry'){const data=await glossary.update(b);return reply(200,{...data,file:glossary.file});}
        if(url.pathname==='/api/qq-album-comments'){if(db.albumSyncPaused)throw Error('备份已恢复，相册自动同步暂已暂停；请先点击“恢复相册同步”');if(qqConnection?.status()!=='已连接')throw Error('QQ尚未连接');return reply(200,{results:await albumPoller.run()});}
        if(url.pathname==='/api/qq-album-photos'){if(qqConnection?.status()!=='已连接')throw Error('QQ尚未连接');const binding=db.albums?.find(a=>a.groupId===String(b.groupId)&&a.albumId===b.albumId);if(!binding||!canHandleQQEvent(db,{group_id:binding.groupId}))throw Error('相册不在当前绑定范围');let result;try{result=await readBoundAlbum(binding);}catch(error){if(!error.albumPhotosRefreshed)throw error;binding.sync={...binding.sync,error:'图片已刷新，评论读取失败：'+privacy.error(error)};await save();return reply(200,{photos:binding.photos,comments:[],warning:binding.sync.error});}if(result){reconcileAlbumPhotos(binding,result.photos,result.captions);await save();}return reply(200,{photos:binding.photos,comments:result?.comments||[]});}
        if(url.pathname==='/api/album-photo-scope'){
          const binding=db.albums?.find(a=>a.groupId===String(b.groupId)&&a.albumId===b.albumId);if(!binding||!canHandleQQEvent(db,{group_id:binding.groupId}))throw Error('相册不在当前绑定范围');
          const c=db.campaigns.find(c=>c.id===binding.campaignId);if(!binding.photos?.some(p=>p.id===b.photoId))throw Error('请先读取相册图片');
          const scope=b.categoryScopes!==undefined?albumScope(c,b):{categoryId:String(b.categoryId||''),boxId:String(b.boxId||''),productIds:Array.isArray(b.productIds)?b.productIds:[],source:'人工确认'};scopedProducts(c,scope);binding.photoScopes??={};binding.photoScopes[b.photoId]=scope;delete binding.photoErrors?.[b.photoId];operationResult=await save(op('确认图片范围'));return reply(200,{ok:true});
        }
        if(url.pathname==='/api/album-comment-resolve'){
          const binding=db.albums?.find(a=>a.campaignId===b.campaignId);if(!binding)throw Error('该期次还没有绑定相册');
          const resolutions={},quantities={};for(const r of Array.isArray(b.resolutions)?b.resolutions:[]){if(!r?.phrase)continue;if(r.skuId)resolutions[String(r.phrase)]=String(r.skuId);const q=Number(r.quantity);if(Number.isInteger(q)&&q>=1&&q<=999)quantities[String(r.phrase)]=q;}
          const result=retryPending(db,binding,b.commentId,resolutions,quantities);operationResult=await save(op('核对评论入表'));return reply(200,{ok:true,message:result.message,count:result.count});
        }
        if(url.pathname==='/api/album-comment-item-delete'){
          const binding=db.albums?.find(a=>a.campaignId===b.campaignId);if(!binding)throw Error('该期次还没有绑定相册');
          const result=deletePendingItem(db,binding,b.commentId,b.entryKey);operationResult=await save(op('删除待核对条目'));return reply(200,result);
        }
        if(url.pathname==='/api/album-comment-dismiss'){
          const binding=db.albums?.find(a=>a.campaignId===b.campaignId);if(!binding)throw Error('该期次还没有绑定相册');
          dismissPending(db,binding,b.commentId);operationResult=await save(op('忽略待核对评论'));return reply(200,{ok:true});
        }
        if(url.pathname==='/api/album-batch-scope'){
          const binding=db.albums?.find(a=>a.groupId===String(b.groupId)&&a.albumId===String(b.albumId));if(!binding||!canHandleQQEvent(db,{group_id:binding.groupId}))throw Error('相册不在当前绑定范围');
          const photos=batchPhotos(binding,b.batchId);if(!photos.length)throw Error('没有找到这次上传的图片');
          const c=db.campaigns.find(c=>c.id===binding.campaignId);
          requireEnrollmentOpen(c);
          if(b.ignored===true||String(b.categoryId)===IGNORE_SCOPE){
            const ignored={ignored:true,boxId:'',source:'人工确认'};
            binding.batchScopes??={};binding.batchScopes[String(b.batchId)]={...ignored};
            binding.photoScopes??={};for(const photo of photos)binding.photoScopes[photo.id]={...ignored};
            const photoIds=new Set(photos.map(p=>p.id)),commentIds=new Set();
            for(const e of c.commentEvents||[])if((e.photoIds||[]).some(id=>photoIds.has(id)))commentIds.add(String(e.id));
            for(const p of binding.pending||[])if((p.photoIds||[]).some(id=>photoIds.has(id)))commentIds.add(String(p.id));
            binding.pending=(binding.pending||[]).filter(p=>!(p.photoIds||[]).some(id=>photoIds.has(id)));
            if(commentIds.size){c.records=(c.records||[]).filter(r=>![...commentIds].some(id=>String(r.requestId||'').startsWith('comment:'+id+':')));c.commentEvents=(c.commentEvents||[]).filter(e=>!commentIds.has(String(e.id)));}
            operationResult=await save(op('确认图片大类'));return reply(200,{ok:true,scope:binding.batchScopes[String(b.batchId)]});
          }
          const scope=albumScope(c,b);
          binding.batchScopes??={};binding.batchScopes[String(b.batchId)]={...scope};
          binding.photoScopes??={};for(const photo of photos)binding.photoScopes[photo.id]={...scope};
          operationResult=await save(op('确认图片大类'));return reply(200,{ok:true,scope:binding.batchScopes[String(b.batchId)]});
        }
        if(url.pathname==='/api/qq-groups-refresh'){if(qqConnection?.status()!=='已连接')throw Error('QQ尚未连接');const groups=await qqConnection.call('get_group_list',{});const list=groups.map(g=>({id:String(g.group_id),name:g.group_name}));for(const item of list){const managed=db.qqGroups.find(g=>String(g.id)===item.id);if(managed)managed.name=item.name;}await save();return reply(200,{groups:list,managed:db.qqGroups});}
        if(url.pathname==='/api/qq-group-add'){const id=String(b.groupId||'');if(!/^\d{5,12}$/.test(id))throw Error('群号格式不正确');if(db.qqGroups.some(g=>String(g.id)===id))throw Error('该群已在管理列表');db.qqGroups.push({id,name:String(b.name||('群 '+id)),enabled:true});await save();return reply(200,{ok:true});}
        if(url.pathname==='/api/qq-group-remove'){const id=String(b.groupId||'');const used=db.campaigns.filter(c=>String(c.groupId)===id);if(used.length)throw Error('还有期次属于该群：'+used.map(c=>c.name).join('、'));db.qqGroups=db.qqGroups.filter(g=>String(g.id)!==id);await save();return reply(200,{ok:true});}
        if(url.pathname==='/api/qq-test-group'){if(!qqConnection)throw Error('QQ尚未连接');const groups=await qqConnection.call('get_group_list',{}),group=groups.find(g=>String(g.group_id)===String(b.groupId)&&g.group_name===b.name);if(!group)throw Error('未找到指定测试群，请确认机器人已入群');db.qqTestGroup={id:String(group.group_id),name:group.group_name};await save();return reply(200,{ok:true,group:db.qqTestGroup});}
        if(url.pathname==='/api/qq-test-group-message'){if(!qqConnection||!db.qqTestGroup)throw Error('尚未指定测试群');const r=await qqConnection.call('send_group_msg',{group_id:Number(db.qqTestGroup.id),message:'【谷谷bot连接测试】机器人已接入此测试群。可 @机器人 发送“cn 你的CN”验证昵称录入；商品排表将在绑定测试相册后验证。'});return reply(200,{ok:true,messageId:r.message_id});}
        if(url.pathname==='/api/qq-enrollment-settings'){if(typeof b.enabled!=='boolean')throw Error('请选择开启或关闭@排表');db.qqEnrollmentEnabled=b.enabled;operationResult=await save(op('修改群内排表开关'));return reply(200,{ok:true,enabled:db.qqEnrollmentEnabled});}
    if(url.pathname==='/api/ui-prefs'){const prefs=db.uiPrefs??={};for(const key of ['botId','groupId','campaignId'])if(typeof b[key]==='string'&&b[key].length<=120)prefs[key]=b[key];if([2,3].includes(Number(b.columns)))prefs.columns=Number(b.columns);if(typeof b.showImages==='boolean')prefs.showImages=b.showImages;await save();return reply(200,{prefs});}
        if(url.pathname==='/api/qq-status'){if(!qqConnection)throw Error('QQ尚未连接');return reply(200,{identity:await qqConnection.call('get_login_info',{}),status:await qqConnection.call('get_status',{}),lastInbound:qqLastInbound,recentEvents:qqEvents});}
        if(url.pathname==='/api/qq-diagnostics'){if(!qqConnection)throw Error('QQ尚未连接');const identity=await qqConnection.call('get_login_info',{}),status=await qqConnection.call('get_status',{}),version=await qqConnection.call('get_version_info',{}),groups=await qqConnection.call('get_group_list',{});return reply(200,{identity,status,version,groups,lastInbound:qqLastInbound,recentEvents:qqEvents});}
        if(url.pathname==='/api/qq-test-admin'){if(!db.qqAdmin)throw Error('请先在设置引导中配置管理员QQ');if(!qqConnection)throw Error('QQ尚未连接');const result=await qqConnection.call('send_private_msg',{user_id:Number(db.qqAdmin),message:'[谷谷bot连接测试] 机器人已连接。请回复“接入测试”，用于确认消息接收。'});return reply(200,{ok:true,messageId:result.message_id});}
        if(url.pathname==='/api/qq-login-state'){if(!allowServerConnection&&qqConnection?.status()==='已连接'){const s=await qqConnection.call('get_status',{});return reply(200,{ready:true,loggedIn:s.online===true});}return reply(200,await napcat.state());}
        if(url.pathname==='/api/qq-runtime-download'){if(!desktopActions.openNapcatDownload)throw Error('请在桌面程序中打开官方下载页面');await desktopActions.openNapcatDownload();return reply(200,{ok:true});}
        if(url.pathname==='/api/qq-runtime-select'){if(!desktopActions.selectQQRuntime)throw Error('请在桌面程序中选择NapCat文件夹');return reply(200,await desktopActions.selectQQRuntime({connected:qqConnection?.status()==='已连接'}));}
        if(url.pathname==='/api/qq-password-login')return reply(200,await napcat.password(b.qq,b.password));
        if(url.pathname==='/api/qq-quick-login')return reply(200,await napcat.quick(b.qq));
        if(url.pathname==='/api/qq-login-window'){if(!desktopActions.openQQLogin)throw Error('请在桌面程序中打开QQ登录窗口');await desktopActions.openQQLogin(await napcat.windowUrl());return reply(200,{ok:true});}
        if(url.pathname==='/api/qq-prepare'){if(!desktopActions.prepareQQ)throw Error('请在桌面程序中准备QQ环境');return reply(200,await desktopActions.prepareQQ());}
        if(url.pathname==='/api/qq-auto-connect'){if(!allowServerConnection&&db.qqSettings?.url){await openQQ();for(let i=0;i<40&&qqConnection.status()!=='已连接';i++)await new Promise(r=>setTimeout(r,250));const s=await qqConnection.call('get_status',{}),identity=await qqConnection.call('get_login_info',{});if(s.online!==true||!identity.user_id)throw Error('服务器QQ尚未在线，请在服务器NapCat完成登录');return reply(200,{ok:true,qq:String(identity.user_id)});}const config=await napcat.configure();await credentialStore.set({provider:'qq',baseUrl:new URL(config.url).href},config.token);db.qqSettings={url:new URL(config.url).href};await save();await openQQ();for(let i=0;i<40&&qqConnection.status()!=='已连接';i++)await new Promise(r=>setTimeout(r,250));const status=await qqConnection.call('get_status',{}),identity=await qqConnection.call('get_login_info',{});if(status.online!==true||!identity.user_id)throw Error('QQ连接已配置，但尚未确认账号在线，请检查QQ登录状态');await napcat.remember(identity.user_id);return reply(200,{ok:true,qq:String(identity.user_id)});}
        if(url.pathname==='/api/qq-settings'){const u=new URL(b.url);if(!['ws:','wss:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('请填写不含令牌的本机WebSocket地址');if(b.token)await credentialStore.set({provider:'qq',baseUrl:u.href},String(b.token));db.qqSettings={url:u.href};await save();await openQQ();return reply(200,{ok:true});}
        if(url.pathname==='/api/qq-albums'){
          if(qqConnection?.status()!=='已连接')throw Error('请先连接QQ网关');
          const campaign=b.campaignId?db.campaigns.find(c=>c.id===b.campaignId):null;if(b.campaignId&&!campaign)throw Error('期次不存在');
          const group=String(b.groupId||campaign?.groupId||'');if(!db.qqGroups.some(g=>String(g.id)===group&&g.enabled!==false))throw Error('请先选择已启用的QQ群');
          if(campaign&&String(campaign.groupId||'')!==group)throw Error('当前群与期次所属群不一致');
          const albums=await readGroupAlbums((action,params)=>qqConnection.call(action,params),group);let changed=false;
          for(const album of albums){const binding=db.albums?.find(a=>a.groupId===group&&a.albumId===album.id);if(binding){if(binding.albumName!==album.name){binding.albumName=album.name;changed=true;}album.boundCampaignId=binding.campaignId;album.boundCampaignName=db.campaigns.find(c=>c.id===binding.campaignId)?.name||'';}}
          if(changed)await save();return reply(200,{groupId:group,albums});
        }
        if(url.pathname==='/api/qq-album-media'){if(!qqConnection)throw Error('请先连接QQ网关');return reply(200,{data:await qqConnection.call('get_group_album_media_list',{group_id:String(b.groupId),album_id:String(b.albumId),attach_info:String(b.attachInfo||'')})});}
        if(url.pathname==='/api/qq-event'){try{if(!canHandleQQEvent(db,b))throw Error('该群不在当前处理范围');const result=processQQEvent(db,b,await commandOptions(messageText(b.message)));if(!result.readOnly)await save();return reply(200,result);}catch(e){return reply(400,{error:privacy.error(e),reply:'操作失败：'+privacy.error(e)});}}
        if(url.pathname==='/api/upload')return reply(200,{url:await saveImage(dataDir,b.image)});
        if(url.pathname==='/api/prts')return reply(200,{characters:await verifyPrts(b.names,referenceFetch)});
        if(url.pathname==='/api/box')return reply(200,expandBox(refs,b.boxId));
        if(url.pathname==='/api/models'){
          const config=providerConfig(b);
          const key=typeof b.apiKey==='string'&&b.apiKey!==''?normalizeKey(b.apiKey):await credentialStore.get(config);
          const models=await getModels(config,key);
          return reply(200,{...config,models});
        }
        if(url.pathname==='/api/settings'){
          const {provider,baseUrl}=providerConfig(b), model=String(b.model||'').trim();
          if(!model)throw new Error('请填写服务商实际提供的模型名称，不能随意命名');
          const supplied=typeof b.apiKey==='string' && b.apiKey!=='';
          const nextKey=supplied?normalizeKey(b.apiKey):await credentialStore.get({provider,baseUrl});
          let models=[];
          if(provider!=='custom'){
            models=await getModels({provider,baseUrl},nextKey);
            if(!models.some(m=>m.id===model))throw new Error('该服务商的可用模型中未找到所选版本，请重新获取模型列表');
          }
          if(nextKey)await credentialStore.set({provider,baseUrl},nextKey);
          db.settings={provider,baseUrl,model};apiKey=nextKey;knownModels=models;await save();return reply(200,{ok:true});
        }
        if(url.pathname==='/api/test-connection'){
          if(!apiKey)throw new Error('尚未设置本次运行的 API 密钥，请填写并保存');
          knownModels=await getModels(db.settings,apiKey);
          if(!knownModels.some(m=>m.id===db.settings.model))throw new Error('密钥鉴权通过，但未找到所填模型。可用模型：'+knownModels.slice(0,30).map(m=>m.id).join('、'));
          return reply(200,{ok:true,message:'连接成功，当前模型：'+db.settings.model});
        }
        if(url.pathname==='/api/campaign') {if(!String(b.name||'').trim())throw new Error('请填写期次名称');const groupId=String(b.groupId||'');if(db.qqGroups.length&&!db.qqGroups.some(g=>String(g.id)===groupId))throw new Error('请先选择所属QQ群');const bot=registry.requireBot(b.botId);const c={id:randomUUID(),botId:bot.id,name:String(b.name).trim(),groupId,products:[],records:[],categories:defaultCategories(),revision:0};db.campaigns.push(c);operationResult=await save(op('新建期次'));return reply(200,c);}
        if(url.pathname==='/api/campaign-group'){const c=db.campaigns.find(x=>x.id===b.campaignId);if(!c)throw new Error('期次不存在');const groupId=String(b.groupId||'');if(!db.qqGroups.some(g=>String(g.id)===groupId))throw new Error('群不在管理列表');if((db.albums||[]).some(a=>a.campaignId===c.id&&String(a.groupId)!==groupId))throw new Error('该期次已绑定其他群的相册，请先解绑');c.groupId=groupId;operationResult=await save(op('修改期次所属群'));return reply(200,{ok:true});}
        const c=db.campaigns.find(c=>c.id===b.campaignId);if(!c)throw new Error('请先选择期次');
        if(url.pathname==='/api/product-search'){
          let products=c.products;
          if(b.products!==undefined){if(!Array.isArray(b.products)||b.products.length>500)throw Error('搜索商品清单无效');products=b.products.map(p=>{if(!p||typeof p.id!=='string'||typeof p.name!=='string')throw Error('搜索商品清单无效');return {id:p.id,name:p.name.slice(0,300),categoryId:String(p.categoryId||''),type:String(p.type||''),character:String(p.character||''),boxId:String(p.boxId||''),giftTier:p.giftTier,aliases:Array.isArray(p.aliases)?p.aliases.filter(a=>typeof a==='string').slice(0,30):[]};});}
          const searchCatalog=b.categories===undefined?c:{...c,categories:categories(b.categories.map(cat=>({...cat,kind:'single'})))};
          const found=searchProducts(searchCatalog,b.query,{products,categoryId:String(b.categoryId||''),productIds:Array.isArray(b.productIds)?b.productIds:undefined});return reply(200,{ids:found.map(p=>p.id),revision:c.revision});
        }
        if(url.pathname==='/api/product-delete-check'){const reason=productDeletionReason(c,String(b.skuId||''),Array.isArray(b.products)?b.products:c.products);return reply(200,{allowed:!reason,reason,revision:c.revision});}
        if(url.pathname==='/api/category-delete-check'){const reason=categoryDeletionReason(c,db,String(b.categoryId||''),Array.isArray(b.products)?b.products:c.products,Number.isInteger(b.remainingCount)?b.remainingCount:c.categories.length-1);return reply(200,{allowed:!reason,reason,revision:c.revision});}
        const bot=registry.requireBot(c.botId);if(b.botId&&b.botId!==bot.id)throw new Error('Bot 与期次不一致');
        c.categories??=defaultCategories();
        if(url.pathname==='/api/cn'){const gid=String(b.groupId||c?.groupId||'');const message=registerCN(db,b.qq,b.cn,gid);for(const campaign of db.campaigns){if(gid&&String(campaign.groupId||'')!==gid)continue;for(const r of campaign.records)if(r.qq===String(b.qq))r.member=recordMember(db,r,campaign.groupId);}operationResult=await save(op('绑定CN'));return reply(200,{message});}
        if(url.pathname==='/api/album-bind'){
          if(qqConnection?.status()!=='已连接')throw Error('请先连接QQ网关');
          const group=String(c.groupId||'');if(b.groupId&&String(b.groupId)!==group)throw Error('当前群与期次所属群不一致');
          if(!db.qqGroups.some(g=>String(g.id)===group&&g.enabled!==false))throw Error('请先选择已启用的QQ群');
          const albums=await readGroupAlbums((action,params)=>qqConnection.call(action,params),group),album=albums.find(a=>a.id===String(b.albumId||''));if(!album)throw Error('所选相册已不存在，请重新读取群相册');
          const existing=db.albums?.find(a=>a.groupId===group&&a.albumId===album.id&&a.campaignId===c.id);
          undoBefore=businessState(db);if(existing)existing.albumName=album.name;else {bindAlbum(db,c,{groupId:group,albumId:album.id});db.albums.at(-1).albumName=album.name;}
          operationResult=await save(op('绑定相册'));return reply(200,{ok:true,albumName:album.name});
        }
        if(url.pathname==='/api/comment'){
          const binding=db.albums?.find(x=>x.groupId===String(b.groupId)&&x.albumId===String(b.albumId));if(!binding||binding.campaignId!==c.id)throw Error('该相册未绑定当前期次');
          const result=addComment(db,c,b);operationResult=await save(op('录入评论'));return reply(200,result);
        }
        if(url.pathname==='/api/queue-reorder'){
          const result=reorderQueue(c,db,b);if(result.changed)operationResult=await save(op('调整排表顺序'));return reply(200,{...result,view:enrollmentView(c,db)});
        }
        if(url.pathname==='/api/summary')return reply(200,{products:summary(c),records:orderedRecords(c)});
        if(url.pathname==='/api/planning-state')return reply(200,{pool:c.orderPlanning?.supplementOpen?supplementaryPool(c):purchasePool(c),planning:c.orderPlanning||{},settlement:c.settlement||{},summary:settlementSummary(c,db),creditTypes,lifecycle:c.orderLifecycle||{status:'open',version:0},sourceHash:sourceHash(c),issues:planningIssues(c)});
        if(url.pathname==='/api/campaign-complete'){
          await backups.create(db,'下单完成前备份');
          const before=businessState(db),result=completeCampaign(c,b);operationResult=await save({...op('下单完成'),before});return reply(200,result);
        }
        if(url.pathname==='/api/campaign-supplement'){
          const result=openSupplement(c,b);operationResult=await save(op('开启补单'));return reply(200,result);
        }
        if(url.pathname==='/api/order-reconcile'){
          if(isCompleted(c))throw Error('本期已结束，请先开启补单再核对');
          if(b.expectedSource!==sourceHash(c)||b.version!==(c.orderPlanning?.version||0))throw Error('数据已变化，请刷新后重新核对');
          if(!c.orderPlanning?.plan?.orders?.length||c.orderPlanning.plan.orders.some(o=>o.actualPaid==null))throw Error('请先保存全部订单实付');
          if(supplementaryPool(c).some(r=>r.quantity>0||r.kind==='group'&&r.demand>r.purchased))throw Error('存在未下单排量，请通过补单增加订单');
          c.orderPlanning.source=purchaseSource(c);c.orderPlanning.supplementOpen=false;c.orderPlanning.version++;operationResult=await save(op('核对已下单商品'));return reply(200,{ok:true});
        }
        if(url.pathname==='/api/order-plan'){
          if(isCompleted(c))throw Error('本期已结束，请先点击“开启补单”');
          if(b.catalogRevision!==c.revision)throw Error('商品已更新，请刷新购买清单');
          if(b.version!==(c.orderPlanning?.version||0))throw Error('下单规划已更新，请刷新后重试');
          if(!c.orderPlanning?.supplementOpen&&c.orderPlanning?.plan?.orders.some(o=>o.actualPaid!==null))throw Error('当前方案已有实付记录，不可直接重新拆单；请保留原订单');
          let pool;
          if(c.orderPlanning?.supplementOpen){const available=supplementaryPool(c);if(!Array.isArray(b.pool)||b.pool.length!==available.length||new Set(b.pool.map(x=>x.id)).size!==available.length)throw Error('补单清单已变化，请刷新后重试');pool=available.map(row=>{const item=b.pool.find(x=>x.id===row.id);if(!item||!Number.isInteger(item.quantity)||item.quantity<0||item.quantity>999)throw Error('补单数量须为0到999的整数');return {...row,quantity:item.quantity,price:item.price==null?null:cents(item.price)/100};});}
          else pool=normalizePool(c,b.pool);
          const plan=planOrders(pool,b.settings);
          if(c.orderPlanning?.supplementOpen)appendSupplement(c,plan,pool);
          else c.orderPlanning={version:(c.orderPlanning?.version||0)+1,pool,settings:plan.settings,plan,source:purchaseSource(c)};
          operationResult=await save(op('生成下单方案'));return reply(200,{ok:true,planning:c.orderPlanning});
        }
        if(url.pathname==='/api/order-payment'){
          if(isCompleted(c))throw Error('本期已结束，请先开启补单再修改实付');
          const planning=c.orderPlanning;if(!planning?.plan||b.version!==planning.version)throw Error('下单规划已变化，请刷新后重试');const order=planning.plan.orders.find(o=>o.id===b.orderId);if(!order)throw Error('订单不存在');
          if(c.orderLifecycle?.purchasedOrderIds?.includes(order.id))throw Error('原订单已完成，补单只修改新增订单实付');
          order.actualPaid=b.actualPaid==null?null:cents(b.actualPaid,'订单实付金额')/100;planning.version++;operationResult=await save(op('保存订单实付'));return reply(200,{ok:true,version:planning.version,actualPaid:order.actualPaid});
        }
        if(url.pathname==='/api/settlement-settings'){
          if(b.version!==(c.settlement?.version||0))throw Error('折算设置已更新，请刷新后重试');
          const settings=settlementSettings(b);for(const [key,mode]of Object.entries(settings.groupPricing))if(!['current','auto'].includes(mode)||!c.products.some(p=>(p.categoryId||p.type)+'|'+(p.boxId||'')===key))throw Error('拼团计价设置无效');
          for(const cat of c.categories)if(cat.kind==='group')for(const box of new Set(c.products.filter(p=>(p.categoryId||p.type)===cat.id).map(p=>p.boxId||''))){const mode=settings.groupPricing[cat.id+'|'+box];if(mode){cat.averageModesByBox??={};cat.averageModesByBox[box]=mode==='auto'?'auto':'manual';}}
          c.settlement={...settings,version:(c.settlement?.version||0)+1};const calculated=applyAutomaticGroupPrices(c,db);operationResult=await save(op('保存折算设置'));return reply(200,{ok:true,...calculated});
        }
        if(url.pathname==='/api/queue-query')return reply(200,queryQueue(c,String(b.kind),String(b.target||'')));
        if(url.pathname==='/api/enroll-batch'){
          requireEnrollmentOpen(c);
          if(b.revision!==c.revision)throw Error('商品目录已变化，请重新识别');
          if(c.records.some(r=>r.requestId===b.requestId))return reply(200,{duplicate:true});
          if(!Array.isArray(b.items)||!b.items.length||!b.requestId)throw Error('缺少报名明细');
          const qq=String(b.qq||'').trim();if(qq&&!/^\d{5,12}$/.test(qq))throw Error('QQ号格式不正确');
          const owner=memberName(db,qq,c.groupId)||String(b.member||'').trim(),parsed=parseComment(b.source,c.products,owner,{arknights:!c.botId||c.botId==='zhougu'}),proxyFor=parsed.proxyFor||'';
          if(!owner||owner.length>40)throw Error('请填写1至40字的cn，或填写已绑定cn的QQ');
          if((b.proxyFor||'')!==proxyFor||parsed.questions.some(q=>q.code==='proxy'))throw Error('代排信息已变化，请重新识别');
          const member=proxyFor?`${owner} 代 ${proxyFor}`:owner;
          const createdAt=new Date().toISOString();const records=b.items.map((item,itemIndex)=>({...enrollment({...item,member},c.products),...(qq?{qq}:{}),...(proxyFor?{proxyFor}:{}),identityMode:qq?'qq':'cn',sourceType:'manual',id:randomUUID(),requestId:b.requestId,itemIndex,source:String(b.source||''),createdAt}));
          c.records.push(...records);operationResult=await save(op('手动录入排表'));return reply(200,{ok:true});
        }
        if(url.pathname==='/api/position-map'){
          if(!b.imageUrl||!Array.isArray(b.anchors)||!b.anchors.length)throw Error('请选择参照图片和商品位置');
          for(const a of b.anchors){if(!c.products.some(p=>p.id===a.skuId)||!a.bounds||!['x','y','width','height'].every(k=>Number.isFinite(a.bounds[k]))||a.bounds.x<0||a.bounds.y<0||a.bounds.width<=0||a.bounds.height<=0||a.bounds.x+a.bounds.width>1.001||a.bounds.y+a.bounds.height>1.001)throw Error('商品位置无效');}
          c.positionMaps??=[];c.positionMaps.push({id:randomUUID(),imageUrl:b.imageUrl,anchors:b.anchors});operationResult=await save(op('保存图片位置'));return reply(200,{ok:true});
        }
        if(url.pathname==='/api/catalog'){
          if(b.revision!==undefined&&b.revision!==c.revision)throw new Error('商品目录已更新，请重新加载后修改');
          const nextCategories=categories(b.categories||c.categories||defaultCategories());
          let catalogReview;if(b.catalogReview!==undefined){const review=b.catalogReview;if(!review||typeof review.sourceAt!=='string'||!Array.isArray(review.items)||review.items.length>1000||review.items.some(x=>!x||typeof x.message!=='string'||x.message.length>4000||typeof x.done!=='boolean'))throw Error('识别复核信息无效');catalogReview={sourceAt:review.sourceAt.slice(0,40),items:review.items.map(x=>({message:x.message,done:x.done}))};}
          const products=catalog(b.products,nextCategories);if(c.records.some(r=>!products.some(p=>p.id===r.skuId)))throw new Error('已有报名的商品不能删除');
          validateCatalogChanges(c,db,products,nextCategories);
          validatePurchasedCatalog(c,{...c,products,categories:nextCategories});
          if(isCompleted(c)&&JSON.stringify(purchaseSource({...c,products,categories:nextCategories}))!==JSON.stringify(purchaseSource(c)))throw Error('本期已下单完成，请先开启补单再更改购买商品、原价或配数');
          let updatedRecords=0;
          for(const r of c.records){const next=products.find(p=>p.id===r.skuId);const cents=next?.price==null?null:Math.round(next.price*100);if(['暂估','待定价'].includes(r.status)&&next&&(r.name!==next.name||r.unitCents!==cents)){r.history=[...(r.history||[]),{name:r.name,unitCents:r.unitCents,at:new Date().toISOString()}];r.name=next.name;r.unitCents=cents;r.status=cents===null?'待定价':'暂估';updatedRecords++;}}
          if(catalogReview)c.catalogReview=catalogReview;
          c.categories=nextCategories;c.products=products;
          for(const map of c.positionMaps||[])map.anchors=(map.anchors||[]).filter(a=>products.some(p=>p.id===a.skuId));c.positionMaps=(c.positionMaps||[]).filter(map=>map.anchors.length);
          c.settlement??={};c.settlement.groupPricing??={};for(const cat of nextCategories)if(cat.kind==='group')for(const [box,mode]of Object.entries(cat.averageModesByBox||{}))c.settlement.groupPricing[cat.id+'|'+box]=mode==='auto'?'auto':'current';
          for(const imageUrl of new Set(products.map(p=>p.positionAnchor?.imageUrl).filter(Boolean))){const anchors=products.filter(p=>p.positionAnchor?.imageUrl===imageUrl).map(p=>({skuId:p.id,bounds:p.positionAnchor.bounds}));c.positionMaps??=[];const previous=c.positionMaps.find(m=>m.imageUrl===imageUrl);if(previous)previous.anchors=anchors;else c.positionMaps.push({id:randomUUID(),imageUrl,anchors});}
          c.revision++;operationResult=await save(op('保存商品'));return reply(200,{ok:true,updatedRecords});
        }
        if(url.pathname==='/api/enroll'){requireEnrollmentOpen(c);if(c.revision!==b.revision)throw new Error('商品目录已变化，请重新识别');if(c.records.some(x=>x.requestId===b.requestId))return reply(200,{ok:true,duplicate:true});if(!b.requestId)throw new Error('缺少请求编号');const record=enrollment(b,c.products);c.records.push({...record,id:randomUUID(),requestId:b.requestId,source:String(b.source||''),createdAt:new Date().toISOString()});operationResult=await save(op('录入排表'));return reply(200,{ok:true});}
        if(url.pathname==='/api/recognize'){
          if(b.mode==='term')return reply(200,{data:{answer:await glossary.reply(String(b.text||'').replace(/^解释\s*[:：]?\s*/,''))}});
          if(b.mode==='enrollment'){
            let products=c.products;
            if(b.productIds!==undefined){if(!Array.isArray(b.productIds)||!b.productIds.length||b.productIds.some(id=>!c.products.some(p=>p.id===id)))throw Error('商品范围已变化，请重新选择');products=c.products.filter(p=>b.productIds.includes(p.id));}
            const resolutions=Object.create(null);if(b.manualSelections!==undefined){if(!Array.isArray(b.manualSelections)||b.manualSelections.length>500)throw Error('选品信息无效');for(const choice of b.manualSelections){const p=products.find(p=>p.id===choice.skuId);if(!p||choice.phrase!==p.name)throw Error('所选商品已变化或不在当前范围，请重新选择');if(resolutions[p.name]&&resolutions[p.name]!==p.id)throw Error('同名商品请分别选择范围后录入');resolutions[p.name]=p.id;}}
            return reply(200,{data:parseComment(b.text,products,b.member,{resolutions,allProducts:c.products,arknights:!c.botId||c.botId==='zhougu'}),revision:c.revision});
          }
          if(!apiKey || !db.settings.model)throw new Error('请先设置 API 密钥和模型');
          const selected=knownModels.find(m=>m.id===db.settings.model);
          if(b.mode==='image'&&selected?.vision===false)throw new Error('所选模型不支持图片，请在连接设置中选择支持图片的模型版本');
          if(!['image','enrollment','term'].includes(b.mode))throw new Error('未知识别任务');
          let content,imageParts=[];
          if(b.mode==='image') {
            if(b.images!==undefined){
              if(!Array.isArray(b.images)||!b.images.length||b.images.length>32)throw Error('图片分片数量不正确');
              for(const part of b.images){const r=part.region;if(!r||!['x','y','width','height'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1.001||r.y+r.height>1.001)throw Error('图片分片坐标不正确');imageParts.push({image:await readImage(dataDir,part.imageUrl),region:r});}
            }else imageParts=[{image:b.imageUrl?await readImage(dataDir,b.imageUrl):b.image,region:{x:0,y:0,width:1,height:1}}];
            if(imageParts.some(p=>!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.image||'')))throw new Error('请选择 PNG、JPEG 或 WebP 图片');
            if(imageParts.reduce((n,p)=>n+p.image.length,0)>45*1024*1024)throw Error('图片内容过大，请分成几次识别');
            const guide=bot.imported?`任务：${bot.name}图片建档，请遵守其导入技能。逐片检查所有商品，重叠分片不要重复。只返回JSON：{"products":[{"name":"谷名","type":"单领或特典或通行证","character":"拼团角色名或空","boxId":"分盒标识或空","price":数字或null,"giftTier":正整数或null,"averagePrice":null,"adjustment":数字或null,"unit":"件或套或对","imageIndex":0,"cropBounds":{"x":0.1,"y":0.1,"width":0.2,"height":0.2}}],"questions":[]}。cropBounds为商品所在分片的0到1相对坐标，无法定位填null；特典售价留待管理员填写，未知金额保留null。用户补充：${String(b.text||'').slice(0,1500)}`:`任务：粥谷图片建档。你将看到同一张商品图的${imageParts.length}个分片，按序阅读，注意边缘重叠部分不要重复生成商品。只返回JSON：{"boxIds":["图中明确出现的分盒号或系列名，没有则空数组"],"boxPrices":[{"boxId":"对应分盒号","price":数字或null,"priceText":"图上原始整盒价标注如350元/整盒","status":"clear或uncertain"}],"products":[{"name":"谷名","type":"特典或单领或通行证","character":"通行证角色名","boxId":"分盒号","price":数字或null,"averagePrice":null,"adjustment":数字或null,"adjustmentText":"原始加减价标注或空字符串","adjustmentStatus":"clear或uncertain或none","unit":"件或对或套","aliases":[],"imageIndex":0,"cropBounds":{"x":0.1,"y":0.2,"width":0.3,"height":0.3}}],"questions":[]}。imageIndex为商品所在分片的从0开始编号，cropBounds是相对该分片的0到1坐标，无法定位填null，不要给整图坐标。用户补充：${String(b.text||'').slice(0,1500)}。可查老盒号：${refs.boxes.map(x=>x.id).join('、')}。识别到老盒时，仅该盒没有调价标注的通行证角色明细可省略，由boxIds展开；有加减价标注的每个角色必须单独返回products条目，包括原始标注、符号、数值和明确程度；这绝不代表可以省略其他商品。必须逐一检查全部分片，将所有单领与特典完整放入products，包括徽章、挂件、摆件、毛绒等。同一海报可同时含三种类型，不得因为找到通行证就提前结束；只有整张图确实没有其他商品时products才可为空。特典自定价不从图片猜；通行证一对均价由用户填，不使用每抽原价。`;
            content=[{type:'text',text:guide},...imageParts.flatMap((p,i)=>[{type:'text',text:`分片 ${i}`},{type:'image_url',image_url:{url:p.image}}])];
          }
          else content=`任务：${b.mode}。当前期次：${c.name}。商品目录：${JSON.stringify(c.products)}。用户原文：${String(b.text||'').slice(0,8000)}。报名任务返回 JSON：{"status":"resolved或ambiguous或unknown","skuId":"目录中的编号或null","quantity":整数或null,"candidates":[],"question":"需要追问的内容"}。只处理单商品新增，修改撤销或多商品请返回 ambiguous 并说明。术语任务返回 {"answer":"解释"}。`;
          if(b.mode==='image'&&!bot.imported)content[0].text+=' 必须读取每个分盒明确标注的整盒原价并返回boxPrices，与盒号一一关联；350只是可能的价格，不能固定使用。无清楚整盒标注时不返回价格；不把25元/单抽、一对均价或角色调价当整盒价，不乘单抽数量推算。即使只返回boxIds展开角色，也必须单独返回boxPrices；仅识别文字模式同样读取。 特典请读取档次并在商品上额外返回giftTier正整数（1为一档、2为二档、3为三档，以此类推），无法确定留null。特典售价由用户填写，不要用门槛代替售价。已有一、二档时应用会另建特典SET供用户单独定价，不要把SET价格猜成一、二档售价之和。';
          if(b.mode==='image'&&!bot.imported)content[0].text+=' 另返回groups数组，每项为{"id":"组内关联标识","title":"图上含盲盒的原始商品标题","boxId":"明确系列/盒号，无则空字符串","boxPrice":数字或null,"priceText":"原始整盒/端盒价标注","priceStatus":"clear或uncertain"}。含盲盒的非通行证商品独立建拼团大类：例如立体冰箱贴盲盒，groups.title为立体冰箱贴盲盒，products为每一角色/款式各一条，附groupId对应groups.id、character真实名称、type单领、unit件、averagePrice:null、price:null。同图甜品碟共5款但无盲盒字样仍是单领，不加入groups。不要返回整组占位商品，也不凭款数推算整盒价；195元/端盒可导入195，39元/抽不是整盒价。未能确认的角色/款式在questions说明，不编造。';
          if(b.mode==='image'&&b.textOnly===true)content[0].text+=' 当前为仅识别文字模式：只依据图片中可读文字提取商品名、类型、价格和单位，不根据商品外观猜测名称或角色，不定位商品图片，所有cropBounds返回null，不返回任何图片地址。看不清的文字列入questions待复核。';
          const positionMap=b.positionMapId?c.positionMaps?.find(m=>m.id===b.positionMapId):null;
          if(b.positionMapId&&!positionMap)throw Error('参照位置图不存在，请重新选择');
          if(positionMap&&b.mode==='image')content[0].text+='\n当前是同版式调价导入。逐个读取加减价并返回标注中心周围的小区域cropBounds及imageIndex，角色可以留空，由系统根据已确认参照位置关联。不要把多个位置合成一个框。';
          const rosterHint=b.mode==='image'&&!bot.imported?boxRosterHint(refs):'';
          const infer=async(task,purpose=b.mode==='image'?'image':'text')=>{
          const request=inferenceRequest(db.settings,skills.get(bot.id)+rosterHint,task);
          let result;try{result=await modelResult(request,c,purpose);}catch(e){if(e.httpStatus){c.lastRecognitionFailure={at:new Date().toISOString(),mode:b.mode,imageUrl:b.imageUrl||'',model:db.settings.model,status:e.httpStatus,imageCount:imageParts.length,error:privacy.error(e)};await save();}throw e;}
          let raw=responseText(result);if(typeof raw!=='string')throw new Error('模型未返回可读取文本');raw=raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');try{const data=privacy.clean(JSON.parse(raw));for(const p of Array.isArray(data.products)?data.products:[]){delete p.imageUrl;delete p.portraitUrl;delete p.prts;delete p.positionAnchor;}return data;}catch{throw new Error('模型结果不是 JSON，请调整模型后重试');}};
          let data=await infer(content);const modelAttempts=[structuredClone(data)];if(b.mode==='image'){
            const retryBoxes=positionMap||bot.imported?[]:adjustmentRetryBoxes(refs,data);
            if(retryBoxes.length){
              const retryContent=structuredClone(content);
              retryContent[0].text+='\n复核任务：只重新读取以下分盒的所有调价角色。上次存在角色不属于该盒或标注不清的问题，请重新观察原图，不沿用上次猜测。'+boxRosterHint(refs,retryBoxes)+'\n逐对查看商品上的文字、角色形象和覆盖的加减价。只返回名单内能确认身份的角色；不能确认时将原始标注及位置写入questions，不猜名字。数字逐字读取，特别检查5/6、1/7，不因总和或常见价位改数字。';
              try{const retry=await infer(retryContent,'adjustment-review');if(!Array.isArray(retry.products))throw Error('复核未返回商品清单');modelAttempts.push(structuredClone(retry));data=replaceBoxObservations(refs,data,retry,retryBoxes);}catch(e){data.questions=[...(data.questions||[]),'调价复核未完成：'+privacy.error(e)];}
            }
            if(Array.isArray(data.products))for(const p of data.products){const index=Number.isInteger(p.imageIndex)?p.imageIndex:imageParts.length===1?0:-1;p.cropBounds=originalBounds(p.cropBounds,imageParts[index]?.region);delete p.imageIndex;}
            if(positionMap){for(const p of data.products||[]){const anchor=positionMatch(positionMap.anchors,p.cropBounds);const target=anchor&&c.products.find(x=>x.id===anchor.skuId);if(target){p.type='通行证';p.character=target.character;p.boxId=target.boxId;p.name=target.name;}else if(p.adjustmentText){p.adjustmentStatus='uncertain';data.questions??=[];data.questions.push('调价标注未能唯一匹配参照位置，请复核');}}}
            else for(const p of data.products||[])if(p.cropBounds)p.positionAnchor={imageUrl:b.imageUrl,bounds:p.cropBounds};
            const modelResult=structuredClone(data);data=bot.imported?importedRecognition(data):enrichRecognition(refs,data);if(b.textOnly===true)for(const p of data.products){p.textOnly=true;p.imageUrl='';p.portraitUrl='';p.cropBounds=null;}c.lastRecognition={at:new Date().toISOString(),imageUrl:b.imageUrl||'',textOnly:b.textOnly===true,model:db.settings.model,imageCount:imageParts.length,modelAttempts,modelResult,result:data};c.recognitionReviews=[...(c.recognitionReviews||[]).filter(x=>x.imageUrl!==b.imageUrl),{at:c.lastRecognition.at,imageUrl:b.imageUrl||'',questions:(data.questions||[]).map(String)}].slice(-10);await save();
          }return reply(200,{data,revision:c.revision});
        }
        return reply(404,{error:'接口不存在'});
      }
      if(req.method!=='GET')return reply(405,{error:'不支持此操作'});
      const brandingFiles={'/app-logo.svg':['app-logo.svg','image/svg+xml'],'/favicon.ico':['favicon.ico','image/x-icon']};const branding=brandingFiles[url.pathname];if(branding){res.writeHead(200,{'content-type':branding[1],'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"});return res.end(await fs.readFile(path.join(root,'public',branding[0])));}
      const files={'/album-scope-picker.js':'album-scope-picker.js','/catalog-feedback.js':'catalog-feedback.js','/recognition-categories.js':'recognition-categories.js','/product-finder.js':'product-finder.js','/category-manager.js':'category-manager.js','/catalog-utils.js':'catalog-utils.js','/runtime-status.js':'runtime-status.js','/catalog-management.css':'catalog-management.css','/workspace-tools.js':'workspace-tools.js','/qq-connection.js':'qq-connection.js','/settings-page.js':'settings-page.js','/settings.css':'settings.css','/':'index.html','/app.js':'app.js','/album-picker.js':'album-picker.js','/model-picker.js':'model-picker.js','/skill-settings.js':'skill-settings.js','/setup-guide.js':'setup-guide.js','/runtime-picker.js':'runtime-picker.js','/usage-settings.js':'usage-settings.js','/setup-state.js':'setup-state.js','/product-editor.js':'product-editor.js','/image-geometry.js':'image-geometry.js','/image-input.js':'image-input.js','/image-batch.js':'image-batch.js','/product-merge.js':'product-merge.js','/style.css':'style.css','/gift-tiers.js':'gift-tiers.js','/enrollment-people.js':'enrollment-people.js','/enrollment-table.js':'enrollment-table.js','/enrollment-table.css':'enrollment-table.css','/order-workspaces.js':'order-workspaces.js','/order-workspaces.css':'order-workspaces.css'};const file=files[url.pathname];if(!file)return reply(404,{error:'页面不存在'});
      res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'"});res.end(await fs.readFile(path.join(root,'public',file)));
    }catch(e){reply(400,{error:privacy.error(e)});}finally{if(localWork)localRequests--;}
  });
  server.once('close',()=>{albumPoller.close();qqConnection?.close();});
  await listenLocal(server,port);const backupTimer=setInterval(()=>{backups.automatic(durable).catch(error=>{backupError='自动备份失败：'+privacy.error(error);});},60000);backupTimer.unref?.();server.once('close',()=>clearInterval(backupTimer));return {server,url:`http://127.0.0.1:${server.address().port}`,status:()=>({qq:connection?.remote?'服务器模式':qqConnection?.status()||'未连接',campaigns:db.campaigns.length,events:qqEvents.length}),isRemote:()=>connection?.remote===true,async shutdown(){backendSuspended=true;albumPoller.close();qqConnection?.close();await albumPoller.idle();await Promise.allSettled([...localEvents]);await queue.catch(()=>{});await backups.idle();if(server.listening)await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const s=await start();console.log('谷谷bot '+s.url);}
