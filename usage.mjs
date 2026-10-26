import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const offset=8*3600000;
const token=n=>Number.isSafeInteger(n)&&n>=0?n:null;
export function readUsage(payload){
 const u=payload?.usage;if(!u||typeof u!=='object')return null;
 const input=token(u.input_tokens??u.prompt_tokens),output=token(u.output_tokens??u.completion_tokens),total=token(u.total_tokens)??(input!==null&&output!==null?input+output:null);
 if(input===null&&output===null&&total===null)return null;
 const cached=token(u.input_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens);
 const miss=token(u.prompt_cache_miss_tokens);
 return {input,output,total,cached:cached??(input!==null&&miss!==null&&miss<=input?input-miss:null),reasoning:token(u.output_tokens_details?.reasoning_tokens??u.completion_tokens_details?.reasoning_tokens),cacheWrites:token(u.input_tokens_details?.cache_write_tokens)??0};
}
export function parseCostCommand(text){
 const periods={'本日':'day','今日':'day','今天':'day','当天':'day','本周':'week','这周':'week','本星期':'week','这个星期':'week','本月':'month','这个月':'month','当月':'month'};
 const normalized=String(text||'').normalize('NFKC').replace(/\s+/g,'').replace(/[：:。！!？?]+$/,'');
 const m=normalized.match(/^(?:(?:查询|查看|查)(?:一下|下)?)?(本日|今日|今天|当天|本周|这周|本星期|这个星期|本月|这个月|当月)?的?(?:花费|费用|消费|开销)(本日|今日|今天|当天|本周|这周|本星期|这个星期|本月|这个月|当月)?$/);
 return m&&!(m[1]&&m[2])?{period:periods[m[1]||m[2]]||'all'}:null;
}
export function periodStart(period,now=new Date()){
 const d=new Date(+new Date(now)+offset),year=d.getUTCFullYear(),month=d.getUTCMonth(),day=d.getUTCDate();
 if(period==='day')return Date.UTC(year,month,day)-offset;
 if(period==='week')return Date.UTC(year,month,day-(d.getUTCDay()+6)%7)-offset;
 if(period==='month')return Date.UTC(year,month,1)-offset;
 throw Error('请选择今日、本周或本月');
}
const holidayRanges2026=[['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']];
function deepseekPeak(at){
 const d=new Date(+new Date(at)+offset),day=d.getUTCDay(),hour=d.getUTCHours()+d.getUTCMinutes()/60;
 if(day===0||day===6||!(hour>=9&&hour<12||hour>=14&&hour<18))return false;
 if(d.getUTCFullYear()!==2026)return null;
 const date=d.toISOString().slice(5,10);return !holidayRanges2026.some(([a,b])=>date>=a&&date<=b);
}
export function normalizePricing(value={}){
 const mode=value.mode??'auto',currency=value.currency??'CNY';
 if(!['auto','manual'].includes(mode)||!['CNY','USD'].includes(currency))throw Error('计费方式或币种不正确');
 const result={mode,currency};
 if(mode==='manual')for(const key of ['input','cached','output']){const n=value[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1000000)throw Error('请输入非负的百万token单价');result[key]=n;}
 return result;
}
export function priceFor(config,at,override={}){
 const rule=normalizePricing(override);if(rule.mode==='manual')return {...rule,source:'manual'};
 if(config.provider!=='deepseek'||!/^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(config.baseUrl))return null;
 const flash=['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(config.model),pro=config.model==='deepseek-v4-pro';
 if(!flash&&!pro)return null;const peak=deepseekPeak(at);if(peak===null)return null;
 const values=rule.currency==='CNY'?(flash?[1,0.02,4]:[4.5,0.15,13.5]):(flash?[0.15,0.003,0.6]:[0.66,0.022,1.98]),factor=peak?2:1;
 return {mode:'auto',currency:rule.currency,input:values[0]*factor,cached:values[1]*factor,output:values[2]*factor,source:'deepseek-2026-10-24',peak};
}
function reportedCost(payload){
 const cost=payload?.usage?.cost,currency=cost?.currency??payload?.usage?.currency,value=cost&&typeof cost==='object'?cost.value:cost;
 if(!['CNY','USD'].includes(currency)||!['number','string'].includes(typeof value)||String(value).trim()==='')return null;
 const n=Number(value);return Number.isFinite(n)&&n>=0?{amount:n,currency,source:'reported'}:null;
}
export function requestCost(payload,usage,price){
 const reported=reportedCost(payload);if(reported)return reported;
 if(!usage||!price||usage.input===null||usage.output===null||usage.cacheWrites>0)return null;
 // Without a cache breakdown, equal manual input rates remain calculable.
 const cached=usage.cached??(price.input===price.cached?0:null);
 if(cached===null||cached>usage.input)return null;
 return {amount:((usage.input-cached)*price.input+cached*price.cached+usage.output*price.output)/1e6,currency:price.currency,source:'estimate'};
}
const priceKey=config=>createHash('sha256').update(JSON.stringify([config.provider,config.baseUrl,config.model])).digest('hex');
export async function createUsageStore(dataDir,{now=()=>new Date()}={}){
 const file=path.join(dataDir,'usage-ledger.json');let data;
 try{data=JSON.parse(await fs.readFile(file,'utf8'));if(data.version!==1||!Array.isArray(data.requests)||!data.startedAt)throw Error('用量记录格式不正确');}catch(e){if(e.code!=='ENOENT')throw e;data={version:1,startedAt:new Date(now()).toISOString(),pricing:{},requests:[]};}
 data.pricing??={};let writes=Promise.resolve();
 const save=()=>{const snapshot=JSON.stringify(data);const task=writes.then(async()=>{await fs.writeFile(file+'.tmp',snapshot);await fs.rename(file+'.tmp',file);});writes=task.catch(()=>{});return task;};
 for(const r of data.requests)if(r.status==='pending')r.status='interrupted';await save();
 return {
  startedAt:data.startedAt,
  configuration(config){const rule=data.pricing[priceKey(config)]||{mode:'auto',currency:'CNY'};return {rule,price:priceFor(config,now(),rule),startedAt:data.startedAt,model:config.model,provider:config.provider};},
  async configure(config,value){const rule=normalizePricing(value);data.pricing[priceKey(config)]=rule;await save();return this.configuration(config);},
  async begin(config,{groupId='',campaignId='',purpose='image'}={}){
   const at=new Date(now()).toISOString(),r={id:randomUUID(),at,groupId:String(groupId),campaignId:String(campaignId),provider:String(config.provider),model:String(config.model),purpose:['image','adjustment-review','album-scope','text'].includes(purpose)?purpose:'image',status:'pending',usage:null,cost:null,price:priceFor(config,at,data.pricing[priceKey(config)]||{})};
   data.requests.push(r);await save();return r.id;
  },
  async finish(id,payload,status){const r=data.requests.find(r=>r.id===id);if(!r)throw Error('用量记录不存在');r.usage=readUsage(payload);r.cost=requestCost(payload,r.usage,r.price);r.status=status;await save();},
  report(groupId,period='all'){return usageReport(data,String(groupId),period,now());}
 };
}
export function usageReport(data,groupId,period='all',now=new Date()){
 if(!/^\d{5,12}$/.test(String(groupId)))throw Error('请在群内查询本群花费');
 const periods=period==='all'?['day','week','month']:[period],labels={day:'今日',week:'本周',month:'本月'},rows=[];
 for(const scope of periods){
  const start=periodStart(scope,now),requests=data.requests.filter(r=>String(r.groupId)===String(groupId)&&Date.parse(r.at)>=start&&Date.parse(r.at)<=+new Date(now));
  const row={period:scope,requests:requests.length,totalTokens:0,unknownUsage:0,unknownCost:0,amounts:[]},money=new Map();
  for(const r of requests){if(r.usage?.total!=null)row.totalTokens+=r.usage.total;else row.unknownUsage++;
   if(r.cost){const key=r.cost.currency+'|'+r.cost.source;if(!money.has(key))money.set(key,{currency:r.cost.currency,source:r.cost.source,amount:0});money.get(key).amount+=r.cost.amount;}else row.unknownCost++;
  }
  row.amounts=[...money.values()];rows.push(row);
 }
 const lines=rows.map(row=>{
  const tokens=(row.unknownUsage?'已确认 ':'')+row.totalTokens.toLocaleString('en-US')+' token'+(row.unknownUsage?`（${row.unknownUsage}次用量未确认）`:''),money=row.amounts.map(x=>(x.source==='estimate'?'预估':'接口金额')+' '+(x.amount>0&&x.amount<1e-6?'<':'')+(x.currency==='CNY'?'¥':'US$')+(x.amount>0&&x.amount<1e-6?'0.000001':x.amount.toFixed(6)));
  if(row.unknownCost)money.push(`${row.unknownCost}次费用未确认`);if(!row.requests)money.push('0（无模型调用）');
  return `${labels[row.period]}：${tokens}｜${money.join(' + ')}`;
 });
 const since=new Date(Date.parse(data.startedAt)+offset).toISOString().slice(0,16).replace('T',' ');
 return {startedAt:data.startedAt,rows,reply:[`本群API花费（自${since}起记录，北京时间）`,...lines].join('\n')};
}
