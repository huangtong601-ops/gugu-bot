// Conservative font metrics for unattended XLSX and PNG exports. No font service needed.
export function parseTableMerge(ref){
 const column=s=>[...s].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
 const m=String(ref).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
 if(!m)throw Error('排表合并区域无效');
 return {c0:column(m[1]),r0:Number(m[2])-1,c1:column(m[3]),r1:Number(m[4])-1};
}
const glyphWidth=(ch,size)=>/\p{Mark}|\u200d|\ufe0f/u.test(ch)?0:ch==='\t'?size*4:/[WM@%]/u.test(ch)?size*1.1:/[\x20-\x7e]/u.test(ch)?size*.7:/\p{Extended_Pictographic}/u.test(ch)?size*2:size*1.1;
export function tableTextLines(value,width,fontSize=16){
 let count=0;for(const paragraph of String(value??'').split(/\r\n?|\n/u)){let used=0;count++;for(const ch of paragraph){const advance=glyphWidth(ch,fontSize);if(used&&used+advance>width){count++;used=0;}used+=advance;}}
 return count;
}
export function tableCellSpans(rows,merges=[]){
 const covered=new Set(),constraints=[];
 for(const m of merges){
  if(m.r0<0||m.c0<0||m.r1>=rows.length)throw Error('排表合并区域超出范围');
  for(let r=m.r0;r<=m.r1;r++)for(let c=m.c0;c<=m.c1;c++)covered.add(r+':'+c);
  constraints.push({...m,value:rows[m.r0]?.[m.c0]});
 }
 rows.forEach((row,r)=>row?.forEach((value,c)=>{if(!covered.has(r+':'+c))constraints.push({r0:r,r1:r,c0:c,c1:c,value});}));
 return constraints;
}
export function fitTableRows(rows,widths,merges=[],{fontSize=16,lineHeight=20,padding=12,minHeight=32}={}){
 const heights=rows.map((_,i)=>Array.isArray(minHeight)?minHeight[i]:minHeight);
 const constraints=tableCellSpans(rows,merges).sort((a,b)=>(a.r1-a.r0)-(b.r1-b.r0));
 for(const cell of constraints){
  const width=widths.slice(cell.c0,cell.c1+1).reduce((a,b)=>a+b,0)-16;
  const needed=padding+lineHeight*tableTextLines(cell.value,Math.max(fontSize,width),fontSize),current=heights.slice(cell.r0,cell.r1+1).reduce((a,b)=>a+b,0);
  if(needed>current){const extra=Math.ceil((needed-current)/(cell.r1-cell.r0+1));for(let r=cell.r0;r<=cell.r1;r++)heights[r]+=extra;}
 }
 return heights;
}
