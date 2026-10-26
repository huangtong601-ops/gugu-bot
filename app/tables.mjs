import {isGiftCategory} from './public/catalog-utils.js';
﻿import {orderedRecords,summary,memberName} from './workflow.mjs';
import {deflateRawSync} from 'node:zlib';
import {financialItems,settlementSummary,groupPricingMode} from './settlement.mjs';
import {groupRecipients,recipientBlocks,billLines} from './public/enrollment-people.js';
import {categoryQueues} from './enrollment-view.mjs';
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function zip(files){const chunks=[],central=[];let offset=0;for(const [name,text]of files){const n=Buffer.from(name),b=Buffer.from(text),z=deflateRawSync(b),h=Buffer.alloc(30),c=crc(b);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(c,14);h.writeUInt32LE(z.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);chunks.push(h,n,z);const d=Buffer.alloc(46);d.writeUInt32LE(0x02014b50);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt16LE(8,10);d.writeUInt32LE(c,16);d.writeUInt32LE(z.length,20);d.writeUInt32LE(b.length,24);d.writeUInt16LE(n.length,28);d.writeUInt32LE(offset,42);central.push(d,n);offset+=h.length+n.length+z.length;}const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,cd,end]);}
function col(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
const cell=(sheet,r,c,value,formula)=>{sheet.rows[r]??=[];sheet.rows[r][c]=value;if(formula)sheet.formulas[col(c)+(r+1)]=formula;};
const quoted=name=>"'"+name.replaceAll("'","''")+"'";
const amount=value=>value==null?'待定价':value/100;
function unique(name,sheets){let n=name,i=1;while(sheets.some(s=>s.name===n))n=name+' '+i++;return n;}
function groupedPeople(items){return groupRecipients(items).map(person=>person.items);}
export function tableData(c,db={},options={}){
 const mode=options.kind||'all',settled=mode==='settlement'?settlementSummary(c,db):null;
 if(mode==='settlement'&&!settled.ready)throw Error(settled.missing.join('；'));
 const items=settled?settled.items:financialItems(c,db),sheets=[],references=new Map();
 const statsName=unique('折算统计',c.categories.map(x=>({name:x.name})));
 for(const cat of c.categories){
  const sheet={name:cat.name,rows:[],merges:[],formulas:{},widths:[],headerRows:[0],detailStart:0};
  const own=items.filter(x=>x.categoryId===cat.id);
  if(cat.kind!=='group'&&isGiftCategory(cat)){
   const blocks=categoryQueues(c,db,cat),width=Math.max(1,...blocks.map(b=>b.columns.length));sheet.detailStart=width+1;
   for(let i=0;i<width;i++)sheet.widths[i]=18;sheet.widths[width]=3;
   let start=0;for(const block of blocks){cell(sheet,start,0,block.label);if(block.columns.length>1)sheet.merges.push(`A${start+1}:${col(block.columns.length-1)}${start+1}`);sheet.headerRows.push(start+1);
    const count=Math.max(1,...block.columns.map(col=>col.demand));
    block.columns.forEach((column,i)=>{cell(sheet,start+1,i,column.label);column.queue.forEach((value,j)=>cell(sheet,start+2+j,i,value.cn));cell(sheet,start+2+count,i,'排量 '+column.demand);});start+=count+5;
   }
  }
  if(cat.kind==='group'){
   const products=c.products.filter(p=>(p.categoryId||p.type)===cat.id),boxes=[...new Set(products.map(p=>p.boxId||''))],width=Math.max(1,...boxes.map(box=>products.filter(p=>(p.boxId||'')===box).length));
   sheet.detailStart=width+1;for(let i=0;i<width;i++)sheet.widths[i]=16;sheet.widths[width]=3;
   let start=0;for(const box of boxes){const ps=products.filter(p=>(p.boxId||'')===box),rows=(categoryQueues(c,db,cat).find(b=>b.id===(box||cat.id))?.columns||[]).map(col=>({...col,queue:col.queue.map(e=>e.cn)}));cell(sheet,start,0,cat.name+(box?' '+box:''));if(ps.length>1)sheet.merges.push(`A${start+1}:${col(ps.length-1)}${start+1}`);sheet.headerRows.push(start+1);
    const count=Math.max(1,...rows.map(p=>Math.max(p.demand,p.sets||0)));for(let i=0;i<ps.length;i++){cell(sheet,start+1,i,ps[i].character||ps[i].name);for(let j=0;j<count;j++)cell(sheet,start+2+j,i,rows.find(x=>x.id===ps[i].id)?.queue[j]||'');cell(sheet,start+2+count,i,'排量 '+(rows.find(x=>x.id===ps[i].id)?.demand||0));}start+=count+5;
   }
  }
  const offset=sheet.detailStart,grouped=cat.kind==='group',gift=cat.id==='特典'||cat.name==='特典',headers=grouped?['cn',cat.name,'均价','调价','单价','总计']:gift?['cn',cat.name,'单价','总计']:['cn',cat.name,'原价','折后','总计'];
  headers.forEach((v,i)=>cell(sheet,0,offset+i,v));const widths=grouped?[16,42,12,12,12,14]:gift?[16,42,12,14]:[16,42,12,12,14];widths.forEach((v,i)=>sheet.widths[offset+i]=v);
  let r=1;for(const people of groupedPeople(own)){const first=r,priceCol=grouped?offset+4:gift?offset+2:offset+3,totalCol=offset+headers.length-1;
   for(const block of recipientBlocks(people)){const labelStart=r;for(const item of block.items){cell(sheet,r,offset,r===labelStart?item.cn:'');cell(sheet,r,offset+1,item.name);
    if(grouped){let formula;if(settled&&groupPricingMode(c,cat,item.boxId)==='auto'&&cat.pricingMode!=='fixed'&&item.originalCents!==null)formula=`ROUND(${item.originalValue}*${quoted(statsName)}!$B$10,2)`;cell(sheet,r,offset+2,amount(item.averageCents),formula);cell(sheet,r,offset+3,item.adjustmentCents/100);cell(sheet,r,priceCol,amount(item.finalCents),item.averageCents!==null&&cat.pricingMode!=='fixed'?`${col(offset+2)}${r+1}+${col(offset+3)}${r+1}`:undefined);}
    else if(gift)cell(sheet,r,priceCol,amount(item.finalCents));
    else{cell(sheet,r,offset+2,amount(item.originalCents));cell(sheet,r,priceCol,amount(item.finalCents),settled&&item.originalCents!==null?`ROUND(${col(offset+2)}${r+1}*${quoted(statsName)}!$B$10,2)`:undefined);}
    r++;
   }if(r-labelStart>1)sheet.merges.push(`${col(offset)}${labelStart+1}:${col(offset)}${r}`);}
   const total=people.some(x=>x.finalCents===null)?null:people.reduce((n,x)=>n+x.finalCents,0);cell(sheet,first,totalCol,amount(total),total===null?undefined:`SUM(${col(priceCol)}${first+1}:${col(priceCol)}${r})`);
   if(r-first>1)sheet.merges.push(`${col(totalCol)}${first+1}:${col(totalCol)}${r}`);
   if(!references.has(people[0].personKey))references.set(people[0].personKey,[]);references.get(people[0].personKey).push(`${quoted(cat.name)}!${col(priceCol)}${first+1}:${col(priceCol)}${r}`);
  }
  if(!own.length)cell(sheet,1,offset+1,'暂无报名');sheets.push(sheet);
 }
 if(mode==='enrollment')return sheets;
 if(settled){
  const values=[['折算项目','金额 / 比例'],['商品原价合计',settled.originalCents/100],['订单实付合计',settled.actualCents/100],...(settled.creditType==='none'?[['购物金类型','无优惠']]:[['购物金购入金额',settled.creditPaidCents/100],['购物金面额',settled.creditFaceCents/100]]),['订单实付折扣',settled.actualCents/settled.originalCents],[settled.creditType==='none'?'无购物金优惠（按实付）':'折合购物金',settled.shoppingCents/100],['特典抵扣收入',settled.giftRevenueCents/100],['扣特典后商品成本',settled.netCents/100],['商品最终折扣',settled.rate],['肾表应收合计',settled.receivableCents/100],['应收与订单成本差额',(settled.receivableCents-settled.shoppingCents)/100]];
  sheets.push({name:statsName,rows:values,merges:[],widths:[30,22],headerRows:[0],formulas:{B6:'B3/B2',B7:'ROUND(B3*B4/B5,2)',B9:'B7-B8',B10:'B9/B2',B12:'B11-B7'},percentCells:['B6','B10']});
 }
 const rows=[['cn','制品','总价']],merges=[],formulas={};
 for(const people of groupedPeople(items)){const start=rows.length+1,total=people.some(x=>x.finalCents===null)?null:people.reduce((n,x)=>n+x.finalCents,0);for(const block of recipientBlocks(people)){const labelStart=rows.length+1,lines=billLines(block.items);lines.forEach((item,i)=>rows.push([i?'':item.cn,item.displayName,rows.length+1===start?amount(total):'']));if(lines.length>1)merges.push(`A${labelStart}:A${rows.length}`,`C${labelStart}:C${rows.length}`);}if(total!==null)formulas['C'+start]=`SUM(${(references.get(people[0].personKey)||[]).join(',')})`;}
 sheets.push({name:unique('肾表',sheets),rows,merges,formulas,widths:[18,48,18],headerRows:[0]});return sheets;
}
const styles=`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.00%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><sz val="11"/><name val="等线"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF808080"/></left><right style="thin"><color rgb="FF808080"/></right><top style="thin"><color rgb="FF808080"/></top><bottom style="thin"><color rgb="FF808080"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf fontId="0" fillId="0" borderId="1" numFmtId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="1" fillId="0" borderId="1" numFmtId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="0" fillId="0" borderId="1" numFmtId="164" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="0" fillId="2" borderId="1" numFmtId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="0" fillId="0" borderId="1" numFmtId="165" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function freezeRows(s){
 let rows=s.headerRows?.includes(1)?2:1;
 const spans=(s.merges||[]).map(ref=>ref.split(':').map(cell=>Number(cell.match(/\d+$/)?.[0]||0)));
 // A merged CN or total cannot straddle the frozen and scrolling regions.
 while(rows>0){const crossing=spans.find(([first,last])=>first<=rows&&last>rows);if(!crossing)break;rows=crossing[0]-1;}
 return rows;
}
function sheetXML(s){
 const frozen=freezeRows(s),pane=frozen?`<pane ySplit="${frozen}" topLeftCell="A${frozen+1}" activePane="bottomLeft" state="frozen"/>`:'';
 const columns=(s.widths||[18,42,14]).map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('');
 return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><cols>${columns}</cols><sheetData>`+s.rows.map((row,r)=>`<row r="${r+1}" ht="${row?.some(x=>typeof x==='string'&&x.length>25)?32:22}" customHeight="1">`+(row||[]).map((v,c)=>{const addr=col(c)+(r+1),formula=s.formulas?.[addr],style=s.percentCells?.includes(addr)?4:(s.detailStart&&c>=s.detailStart?r===0:s.headerRows?.includes(r))?1:v==='待定价'?3:typeof v==='number'?2:0;return `<c r="${addr}" s="${style}" ${typeof v==='number'?'t="n"':'t="inlineStr"'}>`+(formula?`<f>${xml(formula)}</f>`:'')+(typeof v==='number'?`<v>${v}</v>`:`<is><t xml:space="preserve">${xml(v)}</t></is>` )+'</c>';}).join('')+'</row>').join('')+'</sheetData>'+((s.merges||[]).length?`<mergeCells count="${s.merges.length}">`+s.merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')+'</mergeCells>':'')+'<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.3" footer="0.3"/></worksheet>';
}
export function workbook(c,db,options={}){
 const sheets=tableData(c,db,options),files=[['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'],['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets><calcPr fullCalcOnLoad="1"/></workbook>'],['xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],['xl/styles.xml',styles]];sheets.forEach((s,i)=>files.push([`xl/worksheets/sheet${i+1}.xml`,sheetXML(s)]));return zip(files);
}
