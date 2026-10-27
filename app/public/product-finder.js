const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const metadata=p=>({id:p.id,name:p.name||'',type:p.type||'单领',categoryId:p.categoryId||p.type,character:p.character||'',boxId:p.boxId||'',aliases:p.aliases||[],giftTier:p.giftTier});
export function createProductFinder({id,mode='cards',api,getCampaign,getProducts,getCategories,getScope=()=>({}),onResults=()=>{},onPick=()=>{},onError=()=>{}}){
 const root=el('div',mode==='cards'?'catalog-search-row':'manual-product-finder'),control=el('div','compact-search'),icon=el('span','search-symbol','⌕'),input=el('input'),count=el('span','search-count'),results=el('div','manual-search-results');
 input.id=id;input.type='search';input.maxLength=120;input.placeholder=mode==='cards'?'搜索谷名、角色或别名':'搜索商品后选用';input.setAttribute('aria-label',mode==='cards'?'搜索本期商品':'检索手动录入商品');icon.setAttribute('aria-hidden','true');count.setAttribute('role','status');control.append(icon,input,count);root.append(control);results.hidden=true;
 let selection=null;
 if(mode==='manual')root.append(results);
 function pickProduct(p){
  selection?.remove();selection=el('div','finder-selection');
  const name=el('strong',null,p.name),field=el('label','finder-quantity','数量'),quantity=el('input'),confirm=el('button','finder-confirm','确认选用'),cancel=el('button','secondary','取消');
  quantity.type='number';quantity.min='1';quantity.max='999';quantity.step='1';quantity.value='1';quantity.setAttribute('aria-label','选品数量');field.append(quantity);confirm.type=cancel.type='button';
  confirm.onclick=()=>{const value=Number(quantity.value);if(!Number.isInteger(value)||value<1||value>999){onError('数量须为1至999的整数');quantity.focus();return;}if(!getProducts().some(x=>x.id===p.id)){onError('商品已变化，请重新搜索');return;}onPick(p,value);selection?.remove();selection=null;};
  cancel.onclick=()=>{selection?.remove();selection=null;};selection.append(name,field,confirm,cancel);results.after(selection);quantity.focus();quantity.select();
 }
 let key='',timer=0,generation=0,ids=null,busy=false,campaignId='';
 function drawRows(){
  results.replaceChildren();const c=getCampaign(),products=getProducts(),cats=getCategories?.()||c?.categories||[];
  if(mode!=='manual'||!input.value.trim()){results.hidden=true;return;}results.hidden=false;
  if(busy){results.append(el('p','finder-empty','正在搜索…'));return;}
  const found=(ids||[]).map(id=>products.find(p=>p.id===id)).filter(Boolean);
  if(!found.length){results.append(el('p','finder-empty','未找到匹配商品'));return;}
  for(const p of found.slice(0,8)){const button=el('button','finder-result'),info=el('span','finder-info'),cat=cats.find(cat=>cat.id===(p.categoryId||p.type));button.type='button';button.dataset.skuId=p.id;info.append(el('strong',null,p.name),el('small',null,[cat?.name,p.boxId,p.price==null?'待定价':'¥'+Number(p.price).toFixed(2)+' / '+(p.unit||'件')].filter(Boolean).join(' · ')));button.append(info,el('span','finder-pick','选用'));button.onclick=()=>pickProduct(p);results.append(button);}
  if(found.length>8)results.append(el('p','finder-empty','共'+found.length+'项，可补充关键词缩小范围'));
 }
 function refresh(force=false){
  const c=getCampaign(),products=getProducts(),query=input.value.trim(),scope=getScope(),cats=getCategories?.()||c?.categories||[];
  if(campaignId!==(c?.id||'')){campaignId=c?.id||'';input.value='';selection?.remove();selection=null;key='';ids=null;generation++;clearTimeout(timer);busy=false;}
  const text=input.value.trim(),next=JSON.stringify([campaignId,text,scope,products.map(metadata),cats.map(c=>[c.id,c.name,c.aliases])]);if(next===key&&!force)return;key=next;const token=++generation;clearTimeout(timer);
  if(!text||!c){ids=null;busy=false;count.textContent='';root.removeAttribute('aria-busy');drawRows();return;}
  busy=true;ids=null;count.textContent='…';root.setAttribute('aria-busy','true');drawRows();
  timer=setTimeout(async()=>{try{const data=await api('product-search',{campaignId:c.id,query:text,...scope,...(mode==='cards'?{products:products.map(metadata),categories:cats.map(cat=>({id:cat.id,name:cat.name,aliases:cat.aliases||[]}))}:{})});if(token!==generation||getCampaign()?.id!==c.id)return;ids=data.ids;count.textContent=ids.length+'项';}
   catch(error){if(token!==generation)return;ids=[];count.textContent='搜索失败';onError(error.message);}
   finally{if(token===generation){busy=false;root.removeAttribute('aria-busy');drawRows();onResults();}}
  },140);
 }
 input.addEventListener('input',()=>{selection?.remove();selection=null;refresh();onResults();});input.addEventListener('search',()=>{refresh();onResults();});input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value='';refresh();onResults();}if(e.key==='ArrowDown'&&mode==='manual'){e.preventDefault();results.querySelector('button')?.focus();}});
 return {root,input,refresh,filter:rows=>input.value.trim()?rows.filter(p=>(ids||[]).includes(p.id)):rows,searching:()=>busy,query:()=>input.value.trim()};
}
