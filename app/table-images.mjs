import {tableData,settlementBillSheet} from './tables.mjs';
import {fitTableRows,parseTableMerge} from './table-layout.mjs';
import {settlementSummary} from './settlement.mjs';
import {billLines,groupRecipients} from './public/enrollment-people.js';

const key=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export const tableImageCommand=text=>String(text||'').trim().match(/^(?:查看|查询|查阅)\s*(?:本群\s*)?排表\s*[:：]?\s*(.*)$/us)?.[1];
export function matchTableNames(items,text,{exactOnly=false}={}){const q=key(text);if(!q)return [];const exact=items.filter(x=>key(x.name)===q);return exact.length||exactOnly?exact:q.length>=2?items.filter(x=>key(x.name).includes(q)):[];}
export function selectPersonalBillCampaign(campaigns,argument){
 if(!campaigns.length)throw Error('本群尚无可查询的期次');
 const name=argument.trim();
 if(name.length>200)throw Error('期次名称过长');
 const matches=name?matchTableNames(campaigns,name):campaigns;
 if(matches.length===1)return matches[0].id;
 if(!matches.length)throw Error('未匹配到本群期次，请核对期次名称');
 throw Error('请注明期次全名：'+matches.map(c=>c.name).join('、'));
}
export function selectTableImages(campaigns,argument){
 const text=String(argument||'').trim();if(text.length>200)throw Error('期次和大类名称过长');
 if(!campaigns.length)throw Error('本群尚无可查看的期次');
 const all=c=>({campaignId:c.id,categoryIds:c.categories.map(cat=>cat.id)});
 if(!text){if(campaigns.length===1)return all(campaigns[0]);throw Error('请注明本群期次名称：'+campaigns.map(c=>c.name).join('、'));}
 const whole=matchTableNames(campaigns,text);if(whole.length===1)return all(whole[0]);if(whole.length>1)throw Error('期次简称对应多个本群期次：'+whole.map(c=>c.name).join('、'));
 const tokens=text.split(/\s+/u),matches=[];
 for(let i=1;i<tokens.length;i++)for(const c of matchTableNames(campaigns,tokens.slice(0,i).join(' ')))for(const cat of matchTableNames(c.categories,tokens.slice(i).join(' ')))matches.push({c,cat});
 if(!matches.length&&campaigns.length===1)for(const cat of matchTableNames(campaigns[0].categories,text))matches.push({c:campaigns[0],cat});
 const distinct=[...new Map(matches.map(m=>[m.c.id+'|'+m.cat.id,m])).values()];
 if(distinct.length===1)return {campaignId:distinct[0].c.id,categoryIds:[distinct[0].cat.id]};
 if(distinct.length>1)throw Error('匹配到多个期次或大类，请补充名称：'+distinct.map(m=>m.c.name+' / '+m.cat.name).join('、'));
 throw Error('未匹配到本群期次或大类。格式：查询排表 期次名 [大类名]（也可用查看排表）；本群期次：'+campaigns.map(c=>c.name).join('、'));
}
const text=value=>value==null?'':typeof value==='number'?value.toFixed(2):String(value);
const MAX_PAGES=40,MAX_WIDTH=1700,MAX_HEIGHT=2400;
function groupImageSections(sheet){
 const split=sheet.detailStart;
 return [
  {section:'排表',from:0,to:split-1,headerRows:sheet.headerRows,fallback:[[sheet.name],['暂无商品']]},
  {section:'肾表',from:split,to:sheet.widths.length,headerRows:[0]}
 ].map(({section,from,to,headerRows,fallback})=>{
  const rows=sheet.rows.map(row=>row.slice(from,to));
  const end=rows.findLastIndex(row=>row?.some(value=>value!==undefined))+1;
  const merges=sheet.merges.filter(m=>m.c0>=from&&m.c1<to)
   .map(m=>({...m,c0:m.c0-from,c1:m.c1-from}));
  return {name:sheet.name,section,widths:sheet.widths.slice(from,to),rows:end?rows.slice(0,end):fallback,headerRows,merges};
 });
}
export function tableImagePages(c,db,categoryIds){
 if(!Array.isArray(categoryIds)||!categoryIds.length||new Set(categoryIds).size!==categoryIds.length||categoryIds.some(id=>!c.categories.some(cat=>cat.id===id)))throw Error('排表大类不存在或已变化');
 const categories=new Map(c.categories.filter(cat=>categoryIds.includes(cat.id)).map(cat=>[cat.name,cat]));
 const sheets=tableData(c,db,{kind:'enrollment'}).flatMap(sheet=>{
  const cat=categories.get(sheet.name);if(!cat)return [];
  const imageSheet={...sheet,merges:sheet.merges.map(parseTableMerge)};
  return cat.kind==='group'?groupImageSections(imageSheet):[imageSheet];
 });
 return paginateImageSheets(c.name,sheets);
}
export function personalBillPages(c,db,qq){
 if(!/^\d{5,12}$/.test(qq))throw Error('无法确认发送者QQ，请重新发送查询');
 const owned=new Set(c.records.filter(r=>r.identityMode!=='cn'&&String(r.qq||'')===qq).map(r=>r.id));
 if(!owned.size)throw Error('你在本期没有可查询的肾表记录');
 const settlement=settlementSummary(c,db);
 if(!settlement.ready)throw Error('本期肾表尚未完成结算，请联系管理员');
 const sheet={name:'个人肾表',widths:[22,42,10,18,18],headerRows:[0],rows:[['CN','制品','数量','应付单价（元）','应付合计（元）']],merges:[]};
 for(const person of groupRecipients(settlement.items.filter(item=>owned.has(item.recordId)))){
  const start=sheet.rows.length,total=person.items.reduce((sum,item)=>sum+item.finalCents,0)/100;
  billLines(person.items).forEach((line,i)=>{
   sheet.rows.push([i?'':person.cn,line.name,line.quantity+line.unit,line.finalCents/100,i?'':total]);
  });
  const end=sheet.rows.length-1;
  if(end>start)for(const column of [0,4])sheet.merges.push({r0:start,r1:end,c0:column,c1:column});
 }
 return paginateImageSheets(c.name,[sheet]);
}
export function groupBillPages(c,db){
 const settlement=settlementSummary(c,db);
 if(!settlement.ready)throw Error('本期肾表尚未完成结算：'+settlement.missing.join('；'));
 const sheet=settlementBillSheet(settlement.items,'全团肾表');
 return paginateImageSheets(c.name,[{...sheet,merges:sheet.merges.map(parseTableMerge)}]);
}
function paginateImageSheets(title,sheets){
 const pages=[];
 for(const sheet of sheets){
  const {merges}=sheet,columns=sheet.widths.map(w=>Math.max(36,Math.min(360,Math.round(w*8))));
  if(sheet.rows.length>5000||sheet.rows.length*columns.length>60000)throw Error('排表过大，请指定大类或减少单次导出范围');
  const bands=[];let start=0,width=0;for(let i=0;i<columns.length;i++){if(width+columns[i]>MAX_WIDTH-48&&i>start){bands.push([start,i]);start=i;width=0;}width+=columns[i];}bands.push([start,columns.length]);
  const firstPage=pages.length;
  for(const [c0,c1]of bands){
   const widths=columns.slice(c0,c1);
   const buildRows=(ids,repeat)=>{
    const rows=ids.map((r,i)=>({cells:widths.map((w,j)=>({text:text(i<repeat.length&&r>0&&sheet.detailStart&&c0+j>=sheet.detailStart?'':sheet.rows[r]?.[c0+j]),blank:sheet.rows[r]?.[c0+j]===undefined,header:(sheet.detailStart&&c0+j>=sheet.detailStart)?r===0:sheet.headerRows?.includes(r),rowSpan:1,colSpan:1}))}));
    const spans=[];
    for(const m of merges){
     const left=Math.max(c0,m.c0),right=Math.min(c1-1,m.c1);if(left>right)continue;
     let run=[];const apply=()=>{if(!run.length)return;const top=run[0],anchor=rows[top].cells[left-c0];Object.assign(anchor,{text:text(sheet.rows[m.r0]?.[m.c0]),blank:false,rowSpan:run.length,colSpan:right-left+1});spans.push({r0:top,r1:run.at(-1),c0:left-c0,c1:right-c0});for(const i of run)for(let j=left;j<=right;j++)if(i!==top||j!==left)rows[i].cells[j-c0].skip=true;run=[];};
     ids.forEach((r,i)=>{const allowed=r>=m.r0&&r<=m.r1&&!(i<repeat.length&&r>0&&sheet.detailStart&&left>=sheet.detailStart);if(!allowed){apply();return;}if(run.length&&ids[run.at(-1)]+1!==r)apply();run.push(i);});apply();
    }
    const heights=fitTableRows(rows.map(r=>r.cells.map(c=>c.skip?'':c.text)),widths,spans);rows.forEach((r,i)=>r.height=heights[i]);return rows;
   };
   let r0=0;while(r0<sheet.rows.length){
    const lastHeader=[...(sheet.headerRows||[])].filter(r=>r<r0).sort((a,b)=>b-a)[0];
    const repeat=r0?[0,...(lastHeader>0?[lastHeader]:[])]:[],ids=[...repeat];let rows=[],height=100,r1=r0;
    while(r1<sheet.rows.length){const candidate=buildRows([...ids,r1],repeat),nextHeight=100+candidate.reduce((n,r)=>n+r.height,0);if(nextHeight>MAX_HEIGHT){if(r1===r0)throw Error('排表单格文字超过单张图片容量，请缩短该商品名或CN后重试');break;}ids.push(r1);rows=candidate;height=nextHeight;r1++;}
    pages.push({title,category:sheet.name,section:sheet.section,width:widths.reduce((n,w)=>n+w,48),height,columns:widths,rows,part:0,parts:0});if(pages.length>MAX_PAGES)throw Error('表格超过40张，请联系管理员或缩小查询范围');r0=r1;
   }
  }
  const total=pages.length-firstPage;for(let i=firstPage;i<pages.length;i++){pages[i].part=i-firstPage+1;pages[i].parts=total;}
 }
 return pages;
}
