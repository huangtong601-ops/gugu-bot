// Uses the application's bundled Chromium, with an isolated blank canvas page.
// No external fonts, pages, model calls or worksheet formulas are executed.
function paint(page){
 const canvas=document.createElement('canvas');canvas.width=page.width;canvas.height=page.height;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.textBaseline='middle';
 const wrap=(value,width)=>{const result=[];for(const paragraph of String(value).split(/\r\n?|\n/u)){let line='';for(const ch of paragraph){if(line&&ctx.measureText(line+ch).width>width){result.push(line);line='';}line+=ch;}result.push(line);}return result;};
 ctx.fillStyle='#202734';ctx.font='bold 22px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';ctx.fillText(page.title,24,25,page.width-48);ctx.font='16px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';ctx.fillStyle='#555d6b';ctx.fillText([page.category,page.section,page.parts>1?page.part+'/'+page.parts:''].filter(Boolean).join(' · '),24,54,page.width-48);
 const xs=[24],ys=[76];for(const w of page.columns)xs.push(xs.at(-1)+w);for(const row of page.rows)ys.push(ys.at(-1)+row.height);
 page.rows.forEach((row,r)=>row.cells.forEach((cell,c)=>{
  if(cell.skip||cell.blank)return;const x=xs[c],y=ys[r],width=xs[c+cell.colSpan]-x,height=ys[r+cell.rowSpan]-y;
  ctx.fillStyle=cell.header?'#f2f3f5':'#ffffff';ctx.fillRect(x,y,width,height);ctx.strokeStyle='#808080';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,width,height);
  ctx.save();ctx.beginPath();ctx.rect(x+6,y+2,width-12,height-4);ctx.clip();ctx.fillStyle='#202020';ctx.font=(cell.header?'bold ':'')+'16px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';ctx.textAlign='center';const words=wrap(cell.text,width-16);if(words.length*20>height-4)throw Error('排表图片文字布局不足，请重试或缩短过长名称');words.forEach((s,i)=>ctx.fillText(s,x+width/2,y+height/2+(i-(words.length-1)/2)*20));ctx.restore();
 }));
 return canvas.toDataURL('image/png');
}
module.exports=function createRenderer({BrowserWindow}){
 let queue=Promise.resolve();
 return pages=>{const task=queue.then(async()=>{
  let window,timer;const work=async()=>{
   window=new BrowserWindow({show:false,width:800,height:600,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'table-images'}});window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
   await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'none\'"><title>排表图片</title>'));
   const images=[];for(const page of pages){const url=await window.webContents.executeJavaScript('('+paint.toString()+')('+JSON.stringify(page)+')');if(typeof url!=='string'||!url.startsWith('data:image/png;base64,'))throw Error('排表图片生成失败');const bytes=Buffer.from(url.slice(22),'base64');if(bytes.length>8*1024*1024||bytes.readUInt32BE(0)!==0x89504e47)throw Error('排表图片大小或格式无效');images.push(bytes);}return images;
  };
  try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('排表图片生成超时，请缩小大类范围')),60000);})]);}finally{clearTimeout(timer);window?.destroy();}
 });queue=task.catch(()=>{});return task;};
};
