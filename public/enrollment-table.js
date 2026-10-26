const $=id=>document.getElementById(id);
const node=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const amount=n=>n==null?'待定价':(n/100).toFixed(2);
const signed=n=>(n>0?'+':'')+(n/100).toFixed(2);
const PAGE_SIZE=50;
export function createEnrollmentTable({api,current,onChanged=async()=>{}}){
 let data=null,generation=0,requestedKey='',loadedKey='',campaignId='',editing=false,saving=false,orderNotice='';
 const selections=new Map(),pages=new Map();
 const selector=$('recordCategory'),host=$('records'),status=$('recordStatus');
 const edit=node('button','调整顺序','secondary queue-order-toggle');edit.type='button';edit.setAttribute('aria-pressed','false');selector.closest('.enrollment-category-bar').append(edit);
 edit.onclick=()=>{editing=!editing;edit.textContent=editing?'完成调整':'调整顺序';edit.setAttribute('aria-pressed',String(editing));orderNotice='';draw();};
 selector.onchange=()=>{selections.set(campaignId,selector.value);orderNotice='';draw();};
 async function move(block,column,entryKey,direction){
  if(saving)return;const id=campaignId,categoryId=selector.value;saving=true;edit.disabled=true;
  for(const b of host.querySelectorAll('.queue-move,.queue-reset'))b.disabled=true;
  try{
   const result=await api('queue-reorder',{campaignId:id,categoryId,blockId:block.id,columnId:column.id,entryKey,direction,expectedVersion:column.orderVersion});
   if(current()?.id!==id)return;
   generation++;requestedKey='';loadedKey='';data=result.view;orderNotice=selector.value===categoryId?result.message:'';draw();await onChanged();
  }catch(e){if(current()?.id===id){orderNotice='调整失败：'+e.message;await onChanged();}}
  finally{saving=false;edit.disabled=false;if(data?.campaignId===current()?.id)draw();}
 }
 function entryCell(value,index,column,block){
  const cell=node('td');if(!value)return cell;
  cell.append(node('span',value.cn,'queue-cn'));
  if(value.fromSet){cell.append(node('small','SET','set-origin'));cell.title='来自特典SET';}
  if(column.sets!==null&&index>=column.sets)cell.className='queue-overflow';
  if(editing){const tools=node('span','','queue-entry-actions');
   for(const [direction,icon,label,disabled]of [['up','↑','上移',index===0],['down','↓','下移',index===column.queue.length-1]]){
    const b=node('button',icon,'queue-move');b.type='button';b.disabled=saving||disabled;b.title=label+'一位';b.setAttribute('aria-label',label+' '+value.cn+' · '+column.label+' · 第'+(index+1)+'位');b.dataset.entryKey=value.entryKey;b.dataset.direction=direction;b.dataset.scope=column.scope;b.onclick=()=>move(block,column,value.entryKey,direction);tools.append(b);
   }cell.append(tools);
  }return cell;
 }

 function table(headers,className){const wrap=node('div','','enrollment-table-wrap'),t=node('table','',className);const head=node('thead'),row=node('tr');for(const h of headers)row.append(node('th',h));head.append(row);t.append(head);wrap.append(t);return {wrap,t,body:node('tbody')};}
 function drawQueue(block){
  const section=node('section','','queue-block'),heading=node('div','','queue-block-heading');heading.append(node('h3',block.label));
  const capacities=[...new Set(block.columns.map(c=>c.sets).filter(n=>n!==null))];
  if(capacities.length===1&&!block.gift)heading.append(node('span','已开 '+capacities[0]+' 配','queue-capacity'));section.append(heading);
  if(!block.columns.length){section.append(node('p','本大类还没有商品。','empty'));return section;}
  const key=campaignId+'/'+selector.value+'/'+block.id,maxPage=Math.max(0,Math.ceil(block.positions/PAGE_SIZE)-1),page=Math.min(pages.get(key)||0,maxPage);pages.set(key,page);
  const start=page*PAGE_SIZE,end=Math.min(start+PAGE_SIZE,block.positions),{wrap,t,body}=table(['序号',...block.columns.map(c=>c.label)],'queue-grid');wrap.dataset.queueBlock=JSON.stringify([selector.value,block.id]);
  if(editing)block.columns.forEach((column,i)=>{const reset=node('button','↺','queue-reset');reset.type='button';reset.title='恢复本列评论时间顺序';reset.setAttribute('aria-label','恢复 '+column.label+' 的评论时间顺序');reset.disabled=saving||!column.manualOrder;reset.onclick=()=>move(block,column,'','reset');t.tHead.rows[0].cells[i+1].append(reset);});
  {
   const price=node('tr','','queue-prices');price.append(node('th',!block.gift&&block.pricingMode!=='fixed'?'调价':'实际价格'));
   for(const c of block.columns)price.append(node('td',!block.gift&&block.pricingMode!=='fixed'?signed(c.adjustmentCents||0):amount(c.priceCents)));body.append(price);
  }
  for(let i=start;i<end;i++){
   const row=node('tr');row.append(node('th',String(i+1)));
   for(const c of block.columns)row.append(entryCell(c.queue[i],i,c,block));body.append(row);
  }
  t.append(body);const foot=node('tfoot');
  for(const [label,field]of [['排量','demand'],['余量','remaining']]){
   if(field==='remaining'&&(block.gift||!block.columns.some(c=>c.sets!==null)))continue;
   const row=node('tr');row.append(node('th',label));for(const c of block.columns){const cell=node('td',c[field]===null?'—':String(c[field]));if(field==='remaining'&&c.overflow)cell.append(node('span','（超排'+c.overflow+'）','queue-overflow-note'));row.append(cell);}foot.append(row);
  }t.append(foot);section.append(wrap);
  if(block.setPrices?.length){const prices=node('p','','gift-set-prices');prices.textContent=block.setPrices.map(p=>p.name+'：'+amount(p.priceCents)+(p.priceCents===null?'':'元 / '+p.unit)).join('；');section.append(prices);}
  if(maxPage){const paging=node('div','','queue-pagination');const previous=node('button','上一页','secondary'),next=node('button','下一页','secondary');previous.disabled=page===0;next.disabled=page===maxPage;previous.onclick=()=>{pages.set(key,page-1);draw();};next.onclick=()=>{pages.set(key,page+1);draw();};paging.append(node('span',`${start+1}–${end} / ${block.positions}`),previous,next);section.append(paging);}
  return section;
 }
 function drawDetails(cat){
  const headers=['cn','制品','原价'];
  const section=node('section','','enrollment-details');
  const {wrap,t,body}=table(headers,'enrollment-detail-grid');
  for(const person of cat.people)person.items.forEach((item,i)=>{
   const row=node('tr');if(i===0){const cn=node('td',person.cn,'person-cell');cn.rowSpan=person.items.length;row.append(cn);}
   row.append(node('td',item.name,'product-cell'));
   row.append(node('td',amount(item.originalCents),item.originalCents===null?'unknown-price':'money-cell'));body.append(row);
  });
  if(!cat.people.length){const row=node('tr'),cell=node('td','本大类还没有排表记录。','empty');cell.colSpan=headers.length;row.append(cell);body.append(row);}t.append(body);section.append(wrap);return section;
 }
 function draw(){
  const scroll=new Map([...host.querySelectorAll('[data-queue-block]')].map(w=>[w.dataset.queueBlock,{top:w.scrollTop,left:w.scrollLeft}]));
  const focus=document.activeElement?.dataset?.entryKey,direction=document.activeElement?.dataset?.direction,focusScope=document.activeElement?.dataset?.scope;
  host.replaceChildren();const cat=data?.categories.find(c=>c.id===selector.value);edit.hidden=!cat?.queues.length;

  if(!cat){host.append(node('p','请先在商品建档中创建大类和商品。','empty'));return;}
  status.textContent=cat.productCount+' 种制品'+(orderNotice?' · '+orderNotice:'');
  for(const block of cat.queues)host.append(drawQueue(block));if(!cat.queues.length)host.append(drawDetails(cat));
  for(const w of host.querySelectorAll('[data-queue-block]')){const previous=scroll.get(w.dataset.queueBlock);if(previous){w.scrollTop=previous.top;w.scrollLeft=previous.left;}}
  if(focus){const button=[...host.querySelectorAll('.queue-move')].find(b=>b.dataset.entryKey===focus&&b.dataset.direction===direction&&b.dataset.scope===focusScope&&!b.disabled);button?.focus({preventScroll:true});}

 }
 return {async render(c,active=true,{force=false}={}){
  if(!active)return;
  if(!c){edit.hidden=true;generation++;data=null;campaignId='';requestedKey='';loadedKey='';selector.replaceChildren();selector.disabled=true;status.textContent='';draw();return;}
  const key=JSON.stringify([c.id,c.revision,c.categories,c.products.map(p=>[p.id,p.name,p.character,p.type,p.categoryId,p.boxId,p.price,p.averagePrice,p.adjustment,p.giftTier,p.giftComponents]),c.records,c.queueOrder,c.orderPlanning?.plan?.giftCounts,c.orderPlanning?.plan?.tier1,c.orderPlanning?.plan?.tier2]);
  if(!force&&(key===loadedKey||key===requestedKey))return;
  const ticket=++generation;requestedKey=key;
  if(campaignId!==c.id){orderNotice='';editing=false;edit.textContent='调整顺序';edit.setAttribute('aria-pressed','false');campaignId=c.id;data=null;host.replaceChildren(node('p','正在读取排表…','empty'));selector.disabled=true;}status.textContent='正在更新…';
  try{
   const result=await api('enrollment-view',{campaignId:c.id});
   if(ticket!==generation||current()?.id!==c.id)return false;
   data=result;loadedKey=key;selector.replaceChildren(...result.categories.map(cat=>new Option(cat.name,cat.id)));
   selector.value=result.categories.some(cat=>cat.id===selections.get(c.id))?selections.get(c.id):result.categories[0]?.id||'';selector.disabled=!result.categories.length;draw();return true;
  }catch(e){if(ticket===generation)status.textContent='读取排表失败：'+e.message;return false;}
  finally{if(ticket===generation)requestedKey='';}
 }};
}
