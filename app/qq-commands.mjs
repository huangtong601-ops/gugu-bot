import {registerCN,addComment,memberName,recordMember} from './workflow.mjs';
import {parseQueueCommand,queryQueue,selectQueueProducts,queryPersonalQueue} from './queue-query.mjs';
import {explainTerm,defaultGlossaryEntries} from './glossary.mjs';
import {parseCostCommand} from './usage.mjs';
import {isAdministrator} from './administrators.mjs';
import {isCompleted,endedMessage} from './campaign-lifecycle.mjs';
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
export function isMentioned(e){return messageSegments(e.message).some(s=>s.type==='at'&&String(s.data?.qq||'')===String(e.self_id||''));}
const CN_COMMAND=/^cn(?:\s*[:：]\s*|\s+)(.+)$/i;
// Keep command recognition and help in one catalogue. New commands must also add a help test.
export const QQ_COMMANDS=Object.freeze({
 help:{pattern:/^(?:help|帮助|指令|命令列表)[。.!！?？]?$/i,usage:'help / 帮助',description:'查看可用指令',private:true},
 cn:{pattern:CN_COMMAND,usage:'cn 你的CN',description:'录入或修改自己的CN',private:true},
 explain:{pattern:/^解释\s*[:：]?\s*/,usage:'解释 捆 / 解释 k1',description:'查询拼谷术语'},
 cost:{parse:parseCostCommand,lines:['查询花费：查看本群今日、本周、本月用量与费用','今日花费 / 本周花费 / 本月花费：单独查询']},
 queue:{parse:parseQueueCommand,lines:['查询排量：查看自己已排的制品及数量','查询排量 商品名：查看该商品全团数量','查询排量 大类名或大类+盒号（如通行证55.0）：逐项查看','查询余量 商品名或大类：仅限已设置总配数的拼团类']},
 mine:{pattern:/^我的排表$/,usage:'我的排表',description:'查看自己的逐条排表明细'},
 export:{pattern:/^肾表$/,usage:'肾表',description:'导出指定期次肾表（管理员）',admin:true},
 enroll:{pattern:/^(?:报名|排表|排谷)\s*[:：]?\s*/,usage:'排谷 制品名 数量',description:'群内直接录入排表',enrollment:true}
});
const matchCommand=(id,text)=>{const c=QQ_COMMANDS[id];return c.parse?c.parse(text):text.match(c.pattern);};
export function commandHelp(db,{qq,group}={}){
 const lines=[group?'可用指令（先 @机器人）':'私聊可用指令'];
 for(const c of Object.values(QQ_COMMANDS)){
  if(!group&&!c.private)continue;
  if(c.admin&&!isAdministrator(db,qq))continue;
  if(c.enrollment&&db.qqEnrollmentEnabled!==true)continue;
  lines.push(...(c.lines||[`${c.usage}：${c.description}`]));
 }
 if(group)lines.push('多期同名商品时，请加上期次名，例如「示例期次 查询排量 通行证」。',
  '相册排谷：在对应商品图下评论「制品名 数量」，不用 @。',
  '代排：评论「代群外XXX 制品名 数量」，单独列肾表。',
  '本期下单完成后停止入表；需要补单请联系管理员在工作台开启。',
  db.qqEnrollmentEnabled===true?'群内@排表已开启；相册评论同样可用。':'群内@排表未开启，请通过相册评论排谷。');
 return lines.join('\n');
}
const LOOKS_LIKE_COMMAND=/^(?:cn(?=[\s:：]|$)|解释|查询|排量(?:\s|$)|余量(?:\s|$)|我的排表\s*$|肾表\s*$)/i;
const MENTION_HINT='请先用 @ 选择机器人，再发送指令，例如「@机器人 cn 你的CN」。';
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
export function processQQEvent(db,e,{terms=defaultGlossaryEntries,usageReport}={}){
 // Raw legacy comment events bypass photo scope; album comments must use album-sync.
 if(e.kind==='album_comment')return {ignored:true,readOnly:true,reason:'相册评论仅通过相册同步入表'};
 const qq=String(e.user_id||e.qq||''),group=String(e.group_id||e.groupId||'');
 const text=messageText(e.message);
 // Private chat has no @ to send; a group message must really mention the bot or it stays quiet.
 const mentioned=isMentioned(e)||!group;
 if(!mentioned)return LOOKS_LIKE_COMMAND.test(text)||matchCommand('help',text)?{reply:MENTION_HINT}:{ignored:true,reason:'普通群消息未 @ 机器人'};
 if(matchCommand('help',text))return {reply:commandHelp(db,{qq,group}),readOnly:true};
 const cn=matchCommand('cn',text);
 if(cn){const reply=registerCN(db,qq,cn[1],group);for(const c of db.campaigns){if(group&&String(c.groupId||'')!==group)continue;for(const r of c.records)if(r.qq===qq)r.member=recordMember(db,r,c.groupId);}return {reply};}
 if(/^cn\b/i.test(text))return {reply:'CN 指令格式：cn 你的CN，例如「cn 示例用户I」。'};
 if(!group)throw Error('私聊仅支持「cn 你的CN」；查询请在群内 @机器人，报名请在群相册商品图片下评论。');
 if(matchCommand('explain',text))return {reply:explainTerm(terms,text.replace(QQ_COMMANDS.explain.pattern,'')),readOnly:true};
 const costCommand=matchCommand('cost',text);if(costCommand)return {reply:usageReport?usageReport(group,costCommand.period).reply:'费用统计尚未启用',readOnly:true};
 const bindings=db.albums?.filter(a=>String(a.groupId)===group)||[];
 // 期次属于群，或期次的相册属于该群；两者互斥于其他群，避免串期。
 const allowed=db.campaigns.filter(c=>(c.groupId?String(c.groupId)===group:bindings.some(a=>a.campaignId===c.id)));
 const foreign=db.campaigns.find(c=>c.groupId&&String(c.groupId)!==group&&text.includes(c.name));
 if(foreign&&!allowed.some(c=>text.includes(c.name)))throw Error(`「${foreign.name}」不属于本群`);
 const personalCommand=matchCommand('queue',text);
 if(personalCommand?.kind==='排量'&&!personalCommand.target)return queryPersonalQueue(allowed,qq,memberName(db,qq,group));
 let c=allowed.find(c=>text.includes(c.name));if(!c&&allowed.length===1)c=allowed[0];
 if(!c&&allowed.length>1){
  const command=matchCommand('queue',text);
  if(command){
   const matches=allowed.filter(candidate=>{try{return selectQueueProducts(candidate,command.target).products.length>0;}catch(error){if(error.code==='AMBIGUOUS_QUEUE_PRODUCT')return true;throw error;}});
   if(matches.length===1)c=matches[0];
   else if(matches.length>1)throw Error('多个期次有匹配商品，请注明期次名称：'+matches.map(candidate=>candidate.name).join('、'));
   else throw Error('本群各期均未匹配到商品：'+(command.target||'全部商品')+'；请核对名称，或注明期次名称');
  }
 }
 if(!c)throw Error(allowed.length?'请注明期次名称：'+allowed.map(candidate=>candidate.name).join('、'):'本群尚无可查询期次，请先创建本群期次或绑定群相册');
 const query=text.replace(c.name,'').trim();
 const queueCommand=matchCommand('queue',query);if(queueCommand){if(queueCommand.kind==='排量'&&!queueCommand.target)return queryPersonalQueue([c],qq,memberName(db,qq,group));return {reply:queryQueue(c,queueCommand.kind,queueCommand.target).reply,readOnly:true};}
 if(matchCommand('mine',query)){const cn=memberName(db,qq,group);if(!cn)throw Error('请先在本群录入CN');return {reply:c.records.filter(r=>r.qq===qq).map(r=>(r.proxyFor?'代 '+r.proxyFor+'：':'')+r.name+' ×'+r.quantity).join('\n')||'当前没有排表'};}
 if(matchCommand('export',query)){if(!isAdministrator(db,qq))throw Error('仅已配置的管理员可导出肾表');return {reply:'肾表已生成',exportCampaignId:c.id};}
 if(terms.some(t=>t.term===query))return {reply:explainTerm(terms,query),readOnly:true};
 if(isCompleted(c))return {reply:endedMessage(c),readOnly:true};
 if(db.qqEnrollmentEnabled===true){
  const messageId=String(e.message_id??''),time=Number(e.time);
  if(!/^-?\d+$/.test(messageId)||!Number.isFinite(time)||time<=0)throw Error('消息缺少编号或时间，无法安全入表，请重新发送');
  return {reply:addComment(db,c,{id:`qq-message:${group}:${messageId}`,qq,groupId:group,at:new Date(time*1000).toISOString(),order:Number.isSafeInteger(Number(messageId))?Number(messageId):0,text:query.replace(QQ_COMMANDS.enroll.pattern,'' )}).message};
 }
 return {reply:'@排表未开启，请在本期群相册的商品图片下评论，机器人会自动读取入表；@我可录入CN、查询排量、余量或我的排表。',readOnly:true};
}
