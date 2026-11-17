import {registerCN,addComment,memberName,recordMember} from './workflow.mjs';
import {parseQueueCommand,queryQueue,selectQueueProducts,queryPersonalQueue} from './queue-query.mjs';
import {explainTerm,defaultGlossaryEntries} from './glossary.mjs';
import {parseCostCommand} from './usage.mjs';
import {isAdministrator} from './administrators.mjs';
import {isCompleted,endedMessage} from './campaign-lifecycle.mjs';
import {tableImageCommand,selectTableImages,selectPersonalBillCampaign,matchTableNames} from './table-images.mjs';
// OneBot array segments are what the app configures; CQ-coded strings are accepted too so a
// gateway with a different post format does not look like "the bot ignored me".
export function messageSegments(message){
 if(Array.isArray(message))return message.map(s=>({type:String(s?.type||''),data:s?.data&&typeof s.data==='object'?s.data:{}}));
 if(typeof message!=='string'||!message)return [];
 const out=[];const re=/\[CQ:([a-zA-Z_]+)((?:,[^\]]*)?)\]/g;let last=0,m;
 while((m=re.exec(message))){const text=message.slice(last,m.index);if(text)out.push({type:'text',data:{text}});const data={};for(const a of m[2].matchAll(/([a-zA-Z_]+)=([^,]*)/g))data[a[1]]=a[2];out.push({type:m[1].toLowerCase(),data});last=re.lastIndex;}
 const tail=message.slice(last);if(tail)out.push({type:'text',data:{text:tail}});return out;
}
// NFKC keeps full-width ＣＮ／：／space from silently missing the command.
export function messageText(message){return messageSegments(message).filter(s=>s.type==='text').map(s=>s.data.text||'').join('').replace(/[\u200b-\u200d\ufeff]/g,'').normalize('NFKC').trim();}
export function isMentioned(e){
 const self=String(e.self_id||'');
 return !!self&&messageSegments(e.message).some(s=>s.type==='at'&&String(s.data.qq||'')===self);
}
export function ignoredGroupMessage(e){
 if(e.kind!=='album_comment'&&(e.group_id||e.groupId)&&!isMentioned(e))return {ignored:true,readOnly:true,reason:'普通群消息未 @ 机器人'};
}
const CN_COMMAND=/^cn(?:\s*[:：]\s*|\s+)(.+)$/i;
// Keep command recognition and help in one catalogue. New commands must also add a help test.
export const QQ_COMMANDS=Object.freeze({
 albumWithdraw:{albumOnly:true,usage:'撤排 制品名称',description:'在商品图下评论，撤掉本人该商品全部数量'},
 help:{pattern:/^(?:help|帮助|指令|命令列表)[。.!！?？]?$/i,usage:'help / 帮助',description:'查看可用指令',private:true},
 cn:{pattern:CN_COMMAND,usage:'cn 你的CN',description:'录入或修改自己的CN',private:true},
 cnForOther:{pattern:CN_COMMAND,usage:'@群友 cn 他的CN',description:'为本群指定成员录入或修改CN（管理员）',admin:true},
 tables:{parse:tableImageCommand,usage:'查询排表 期次名 [大类名]',description:'本期排表图片，省略大类则显示全部（管理员）',admin:true},
 explain:{pattern:/^解释\s*[:：]?\s*/,usage:'解释 捆 / 解释 k1',description:'查询拼谷术语'},
 cost:{parse:parseCostCommand,usage:'查询花费 [今日／本周／本月]',description:'本群用量与费用，省略时显示三个时段'},
 queue:{parse:parseQueueCommand,lines:['查询排量 [期次名]：自己的文字排量，省略期次则按本群各期显示','查询排量 [期次名] 商品名或大类：全团文字排量，可加盒号','查询余量 [期次名] 商品名或大类：已设置总配数的拼团余量']},
 mine:{pattern:/^我的排表$/,hidden:true},
 personalBill:{pattern:/^(?:查询|查看|查阅)\s*肾表\s*[:：]?\s*(.*)$/us,usage:'查询肾表 期次名',description:'本期个人肾表图片，代排对象分开列账'},
 export:{pattern:/^导出\s*肾表\s*[:：]?\s*(.*)$/us,usage:'导出肾表 期次名',description:'本期全团肾表图片（管理员）',admin:true},
 legacyExport:{pattern:/^肾表$/,hidden:true,admin:true},
 enroll:{pattern:/^(?:报名|排表|排谷)\s*[:：]?\s*/,usage:'排谷 制品名 数量',description:'群内直接录入排表',enrollment:true}
});
const matchCommand=(id,text)=>{const c=QQ_COMMANDS[id];return c.parse?c.parse(text):text.match(c.pattern);};
const queryVerb=/^(?:查询|查看|查阅|导出|查(?=\s*(?:排量|余量|排表|肾表)))/u;
const queryHelp='指令格式未识别，请用「查询排量」「查询余量」「查询排表」「查询肾表」「导出肾表」或「查询花费」。发送 help 查看完整写法。';
function matchingQueueCampaigns(campaigns,target){
 return campaigns.filter(c=>{try{return selectQueueProducts(c,target).products.length>0;}catch(error){if(error.code==='AMBIGUOUS_QUEUE_PRODUCT')return true;throw error;}});
}
export function commandHelp(db,{qq,group,plugins=[]}={}){
 const lines=[group?'可用指令（在同一条消息里 @机器人）':'私聊可用指令'];
 for(const c of Object.values(QQ_COMMANDS)){
  if(c.albumOnly||c.hidden)continue;
  if(!group&&!c.private)continue;
  if(c.admin&&!isAdministrator(db,qq))continue;
  if(c.enrollment&&db.qqEnrollmentEnabled!==true)continue;
  lines.push(...(c.lines||[`${c.usage}：${c.description}`]));
 }
 if(group)lines.push('多期同名商品时，请加上期次名，例如「查询排量 示例期次 通行证」。',
  '相册排谷：在对应商品图下评论「制品名 数量」，不用 @。',
  db.albumWithdrawalEnabled===true?`相册撤排：在商品图下评论「${QQ_COMMANDS.albumWithdraw.usage}」，撤掉本人该商品全部数量。`:'相册撤排未开启，请联系管理员。',
  '代排：评论「代群外XXX 制品名 数量」，单独列肾表。',
  '本期下单完成后，群相册评论仍可入表；需要追加采购请联系管理员开启补单。',
  db.qqEnrollmentEnabled===true?'群内@排表已开启；相册评论同样可用。':'群内@排表未开启，请通过相册评论排谷。');
 const visiblePlugins=plugins.filter(p=>(group||p.command.private)&&(!p.command.admin||isAdministrator(db,qq)));
 if(visiblePlugins.length)lines.push('', '插件指令',...visiblePlugins.map(p=>`${p.command.usage}：${p.command.description}`));
 return lines.join('\n');
}
export const SCOPE_HINT='此群尚未绑定期次与相册，暂不处理排表与查询；CN 录入可直接 @我 发送「cn 你的CN」。';
export function canHandleQQEvent(db,e){
 if(!e.group_id)return true;
 // CN is a global identity binding and never writes campaign data, so it is accepted in any group.
 if(matchCommand('cn',messageText(e.message))&&isMentioned(e))return true;
 const id=String(e.group_id);
 const managed=db.qqGroups?.find(g=>String(g.id)===id);if(managed)return managed.enabled!==false;
 if(db.qqTestGroup)return id===String(db.qqTestGroup.id);
 return !!db.albums?.some(a=>String(a.groupId)===id);
}
export function processQQEvent(db,e,{terms=defaultGlossaryEntries,usageReport,plugins=[]}={}){
 // Raw legacy comment events bypass photo scope; album comments must use album-sync.
 if(e.kind==='album_comment')return {ignored:true,readOnly:true,reason:'相册评论仅通过相册同步入表'};
 const ignored=ignoredGroupMessage(e);if(ignored)return ignored;
 const qq=String(e.user_id||e.qq||''),group=String(e.group_id||e.groupId||'');
 const text=messageText(e.message);
 if(matchCommand('help',text))return {reply:commandHelp(db,{qq,group,plugins}),readOnly:true};
 const cn=matchCommand('cn',text);
 if(cn){
  const mentions=messageSegments(e.message).filter(s=>s.type==='at').map(s=>String(s.data.qq||'')).filter(id=>id!==String(e.self_id||''));
  let target=qq;
  if(mentions.length){
   if(!group)throw Error('代录CN请在目标成员所在群内 @机器人 @该成员 后发送「cn 他的CN」。');
   if(!isAdministrator(db,qq))throw Error('仅工作台已配置的管理员可以为其他成员录入CN；录入自己请发送「@机器人 cn 你的CN」。');
   const targets=[...new Set(mentions)];
   if(targets.length!==1||!/^\d{5,12}$/.test(targets[0]))throw Error('请只 @一位需要录入CN的群成员，不能 @全体成员或同时指定多人。');
   target=targets[0];
  }
  const reply=registerCN(db,target,cn[1],group);
  for(const c of db.campaigns||[]){if(group&&String(c.groupId||'')!==group)continue;for(const r of c.records)if(String(r.qq||'')===target)r.member=recordMember(db,r,c.groupId);}
  return {reply:target===qq?reply:`${reply}（QQ：${target}）`};
 }
 if(/^cn\b/i.test(text))return {reply:'CN 指令格式：cn 你的CN，例如「cn 示例用户O」。'};
 const tableArgument=tableImageCommand(text);
 if(tableArgument!==undefined){if(!group)throw Error('查询排表或查看排表请在群内 @机器人 使用');if(!isAdministrator(db,qq))throw Error('仅工作台已配置的管理员可查看本群排表图片');}
 if(!group)throw Error('私聊仅支持「cn 你的CN」；查询请在群内 @机器人，报名请在群相册商品图片下评论。');
 const plugin=plugins.find(p=>{const pattern=p.command.pattern;pattern.lastIndex=0;return pattern.test(text);});
 if(plugin)return {pluginRequest:plugin.id,readOnly:true};
 if(matchCommand('explain',text))return {reply:explainTerm(terms,text.replace(QQ_COMMANDS.explain.pattern,'')),readOnly:true};
 const costCommand=matchCommand('cost',text);if(costCommand)return {reply:usageReport?usageReport(group,costCommand.period).reply:'费用统计尚未启用',readOnly:true};
 const bindings=db.albums?.filter(a=>String(a.groupId)===group)||[];
 // 期次属于群，或期次的相册属于该群；两者互斥于其他群，避免串期。
 const allowed=db.campaigns.filter(c=>(c.groupId?String(c.groupId)===group:bindings.some(a=>a.campaignId===c.id)));
 if(tableArgument!==undefined){const selected=selectTableImages(allowed,tableArgument);return {readOnly:true,tableCampaignId:selected.campaignId,tableCategoryIds:selected.categoryIds};}
 const personalBill=matchCommand('personalBill',text);
 if(personalBill){
  if(!/^\d{5,12}$/.test(String(e.user_id||'')))throw Error('无法确认发送者QQ，请重新发送查询');
  return {readOnly:true,personalBillCampaignId:selectPersonalBillCampaign(allowed,personalBill[1])};
 }
 const groupBill=matchCommand('export',text);
 if(groupBill){
  if(!isAdministrator(db,qq))throw Error('仅已配置的管理员可导出全团肾表图片');
  return {readOnly:true,groupBillCampaignId:selectPersonalBillCampaign(allowed,groupBill[1])};
 }
 const foreign=db.campaigns.find(c=>c.groupId&&String(c.groupId)!==group&&text.includes(c.name));
 if(foreign&&!allowed.some(c=>text.includes(c.name)))throw Error(`「${foreign.name}」不属于本群`);
 const leadingQueue=matchCommand('queue',text);
 if(leadingQueue?.kind==='排量'&&!leadingQueue.target)return queryPersonalQueue(allowed,qq,memberName(db,qq,group));
 let byProduct;
 if(leadingQueue?.target){
  if(leadingQueue.target.length>200)throw Error('期次和商品名称过长');
  const words=leadingQueue.target.split(/\s+/u);
  for(const exactOnly of [true,false])for(let i=words.length;i>0;i--){
   const matches=matchTableNames(allowed,words.slice(0,i).join(' '),{exactOnly});
   if(!matches.length)continue;
   if(!exactOnly&&(byProduct??=matchingQueueCampaigns(allowed,leadingQueue.target)).length)break;
   if(matches.length>1)throw Error('期次简称对应多个本群期次，请写全名：'+matches.map(c=>c.name).join('、'));
   const target=words.slice(i).join(' '),kind=leadingQueue.kind;
   if(!target&&kind==='排量')return queryPersonalQueue(matches,qq,memberName(db,qq,group));
   return {reply:queryQueue(matches[0],kind,target).reply,readOnly:true};
  }
 }
 if(!leadingQueue&&queryVerb.test(text))return {reply:queryHelp,readOnly:true};
 let c=allowed.find(c=>text.includes(c.name));if(!c&&allowed.length===1)c=allowed[0];
 if(!c&&allowed.length>1){
  if(leadingQueue){
   const matches=byProduct??matchingQueueCampaigns(allowed,leadingQueue.target);
   if(matches.length===1)c=matches[0];
   else if(matches.length>1)throw Error('多个期次有匹配商品，请注明期次名称：'+matches.map(candidate=>candidate.name).join('、'));
   else throw Error('本群各期均未匹配到商品：'+(leadingQueue.target||'全部商品')+'；请核对名称，或注明期次名称');
  }
 }
 if(!c)throw Error(allowed.length?'请注明期次名称：'+allowed.map(candidate=>candidate.name).join('、'):'本群尚无可查询期次，请先创建本群期次或绑定群相册');
 const query=text.replace(c.name,'').trim();
 const queueCommand=matchCommand('queue',query);if(queueCommand){if(queueCommand.kind==='排量'&&!queueCommand.target)return queryPersonalQueue([c],qq,memberName(db,qq,group));return {reply:queryQueue(c,queueCommand.kind,queueCommand.target).reply,readOnly:true};}
 if(matchCommand('mine',query)){const cn=memberName(db,qq,group);if(!cn)throw Error('请先在本群录入CN');return {reply:c.records.filter(r=>r.qq===qq).map(r=>(r.proxyFor?'代 '+r.proxyFor+'：':'')+r.name+' ×'+r.quantity).join('\n')||'当前没有排表'};}
 if(matchCommand('legacyExport',query)){if(!isAdministrator(db,qq))throw Error('仅已配置的管理员可导出肾表');return {reply:'肾表已生成',exportCampaignId:c.id};}
 if(queryVerb.test(query))return {reply:queryHelp,readOnly:true};
 if(terms.some(t=>t.term===query))return {reply:explainTerm(terms,query),readOnly:true};
 if(isCompleted(c))return {reply:endedMessage(c),readOnly:true};
 if(db.qqEnrollmentEnabled===true){
  const messageId=String(e.message_id??''),time=Number(e.time);
  if(!/^-?\d+$/.test(messageId)||!Number.isFinite(time)||time<=0)throw Error('消息缺少编号或时间，无法安全入表，请重新发送');
  return {reply:addComment(db,c,{id:`qq-message:${group}:${messageId}`,qq,groupId:group,at:new Date(time*1000).toISOString(),order:Number.isSafeInteger(Number(messageId))?Number(messageId):0,text:query.replace(QQ_COMMANDS.enroll.pattern,'' )}).message};
 }
 return {reply:'@排表未开启，请在本期群相册的商品图片下评论，机器人会自动读取入表；@我可录入CN、查询排量、余量或我的排表。',readOnly:true};
}
