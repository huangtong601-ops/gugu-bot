const node=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const price=p=>p?.priceCents==null?'待定价':'¥'+(p.priceCents/100).toFixed(2)+' / '+p.unit;
export function createTransferEditor({api,current,onSaved}){
 let dialog=null,busy=false,ticket=0;
 const close=()=>{if(busy)return;ticket++;dialog?.close();dialog?.remove();dialog=null;};
 return {close,async open(context){
  if(busy)return;close();const id=++ticket,d=node('dialog','','bundle-dialog transfer-dialog'),head=node('div','','bundle-dialog-head'),dismiss=node('button','×','secondary'),body=node('form','','bundle-dialog-body'),notice=node('p','','bundle-notice');dismiss.type='button';dismiss.setAttribute('aria-label','关闭排表编辑');dismiss.onclick=close;head.append(node('h3','编辑排表'),dismiss);notice.setAttribute('role','status');
  const tabs=node('div','','enrollment-edit-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','排表编辑方式');const tabButtons=[];
  for(const [value,label]of [['product','更改商品'],['transfer','商品转单']]){const button=node('button',label);button.type='button';button.dataset.mode=value;button.id='enrollment-edit-'+value;button.setAttribute('role','tab');button.setAttribute('aria-controls','enrollment-edit-panel');button.onclick=()=>{if(!busy)activate(value);};tabButtons.push(button);tabs.append(button);}
  tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||busy)return;e.preventDefault();const i=tabButtons.findIndex(b=>b.dataset.mode===mode),next=e.key==='Home'?0:e.key==='End'?1:1-i;activate(tabButtons[next].dataset.mode);tabButtons[next].focus();};
  body.id='enrollment-edit-panel';body.setAttribute('role','tabpanel');
  const original=node('p','','bundle-product-name'),rangeLabel=node('label','转让范围'),range=node('select');range.setAttribute('aria-label','转让范围');range.append(new Option('当前这一份','unit'),new Option('原评论整单（当前收款对象）','order'));rangeLabel.append(range);
  const list=node('div','','transfer-preview'),summary=node('p','','bundle-preview'),cnLabel=node('label','接收人 CN'),cn=node('input');cn.type='text';cn.maxLength=40;cn.required=true;cn.setAttribute('aria-label','接收人CN');cnLabel.append(cn);
  const qqLabel=node('label','QQ（选填，已登记 CN 可自动关联）'),qq=node('input');qq.type='text';qq.inputMode='numeric';qq.maxLength=12;qq.setAttribute('aria-label','接收人QQ');qqLabel.append(qq);
  const more=node('details','','transfer-more'),cnOnlyLabel=node('label','','transfer-check'),cnOnly=node('input'),proxyLabel=node('label','代群外（选填）'),proxy=node('input');more.append(node('summary','其他身份选项'));cnOnly.type='checkbox';cnOnlyLabel.append(cnOnly,node('span','群外用户，仅按CN录入'));proxy.type='text';proxy.maxLength=40;proxy.setAttribute('aria-label','接收人代群外对象');proxyLabel.append(proxy);more.append(cnOnlyLabel,proxyLabel);cnOnly.onchange=()=>{qq.disabled=cnOnly.checked;if(cnOnly.checked)qq.value='';};
  const productLabel=node('label','更改为'),product=node('select'),productPrice=node('p','','bundle-preview');product.required=true;product.setAttribute('aria-label','替换商品');productLabel.append(product);
  const actions=node('div','','bundle-dialog-actions'),submit=node('button','确认转让');submit.type='submit';submit.disabled=true;actions.append(submit);d.append(head,tabs,body,notice);d.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.append(d);dialog=d;d.showModal();let preview=null,request=0,mode='transfer';
  function productChanged(){const target=preview?.products?.find(p=>p.id===product.value),before=preview?.products?.find(p=>p.id===preview.skuId);productPrice.textContent=target?'商品价格：'+price(before)+' → '+price(target):'';submit.disabled=busy||!preview||!!preview.blockedReason||!target||target.id===preview.skuId;}
  product.onchange=productChanged;
  function activate(value){mode=value;preview=null;submit.disabled=true;for(const b of tabButtons){b.setAttribute('aria-selected',String(b.dataset.mode===mode));b.tabIndex=b.dataset.mode===mode?0:-1;}body.setAttribute('aria-labelledby','enrollment-edit-'+mode);if(mode==='product'){body.replaceChildren(original,productLabel,productPrice,summary,actions);product.disabled=true;submit.textContent='保存更改';summary.textContent='仅更改当前这一份';}else{body.replaceChildren(original,rangeLabel,list,summary,cnLabel,qqLabel,more,actions);submit.textContent='确认转让';}void load();}
  async function load(){const serial=++request,loadingMode=mode;preview=null;submit.disabled=true;notice.textContent='正在读取…';try{
   const result=await api(mode==='product'?'enrollment-product-options':'transfer-preview',{...context,scope:range.value});if(dialog!==d||id!==ticket||serial!==request||mode!==loadingMode)return;preview=result;
   if(mode==='product'){
    original.textContent=result.cn+' · '+result.name;const previous=product.value;product.replaceChildren();const groups=new Map();for(const p of result.products){const key=p.category+(p.boxId?' ['+p.boxId+']':'');if(!groups.has(key)){const group=node('optgroup');group.label=key;groups.set(key,group);product.append(group);}groups.get(key).append(new Option(p.name+' · '+price(p),p.id));}product.value=result.products.some(p=>p.id===previous)?previous:result.skuId;product.disabled=!!result.blockedReason;notice.textContent=result.blockedReason||'';productChanged();
   }else{original.textContent='原 CN：'+result.fromCN;list.replaceChildren(...result.rows.map(row=>{const line=node('div','','transfer-preview-row');line.append(node('span',row.category+' · '+row.name+(row.boxId?' ['+row.boxId+']':'')),node('b','×'+row.quantity+row.unit));return line;}));summary.textContent='共转让 '+result.quantity+' 份'+(result.includesBundle?'（含关联捆）':'');notice.textContent='';submit.disabled=false;}
  }catch(e){if(dialog===d&&serial===request)notice.textContent=e.message;}}
  range.onchange=load;
  body.onsubmit=async e=>{e.preventDefault();if(!preview||busy||current()?.id!==context.campaignId)return;busy=true;submit.disabled=true;dismiss.disabled=true;range.disabled=true;product.disabled=true;tabButtons.forEach(b=>b.disabled=true);notice.textContent='正在保存…';try{
   const payload=mode==='product'?{skuId:product.value}:{scope:range.value,cn:cn.value,qq:qq.value,cnOnly:cnOnly.checked,proxyFor:proxy.value};
   const result=await api(mode==='product'?'enrollment-product-change':'enrollment-transfer',{...context,...payload,expectedVersion:preview.version});busy=false;close();await onSaved(result);
  }catch(error){notice.textContent=error.message;}finally{busy=false;dismiss.disabled=false;range.disabled=false;product.disabled=!!preview?.blockedReason;tabButtons.forEach(b=>b.disabled=false);if(mode==='product')productChanged();else submit.disabled=false;}};
  activate('transfer');
 }};
}
