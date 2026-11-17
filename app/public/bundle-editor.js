const node=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const money=value=>value===null?'待定价':(value/100).toFixed(2)+' 元';
export function createBundleEditor({api,current,onSaved}){
 let dialog=null,busy=false,ticket=0;
 function close(){if(busy)return;ticket++;dialog?.close();dialog?.remove();dialog=null;}
 function shell(title){
  close();const d=node('dialog','','bundle-dialog'),head=node('div','','bundle-dialog-head'),heading=node('h3',title),dismiss=node('button','×','secondary');dismiss.type='button';dismiss.setAttribute('aria-label','关闭选捆窗口');dismiss.onclick=close;head.append(heading,dismiss);
  const body=node('div','','bundle-dialog-body'),notice=node('p','','bundle-notice');notice.setAttribute('role','status');d.append(head,body,notice);d.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.append(d);dialog=d;d.showModal();return {d,body,notice,ticket:ticket};
 }
 async function save(ui,route,body){
  if(busy||dialog!==ui.d||current()?.id!==body.campaignId)return;busy=true;const buttons=[...ui.d.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);ui.notice.textContent='正在保存…';
  try{const result=await api(route,body);busy=false;close();await onSaved(result);}
  catch(e){ui.notice.textContent=e.message;}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);}
 }
 return {close,
  rule(context,column,version){
   if(busy)return;const ui=shell('标记角色'),form=node('form'),name=node('p',column.label,'bundle-product-name'),label=node('label','标记'),select=node('select');select.setAttribute('aria-label','选捆标记');
   for(const [id,text]of [['normal','普通'],['required','需要上捆'],['available','可用于选捆']])select.append(new Option(text,id));select.value=column.bundleRule?.mode||'normal';label.append(select);
   const countLabel=node('label','每份需带商品数'),count=node('input');count.type='number';count.min='1';count.max='999';count.step='1';count.value=String(column.bundleRule?.count||1);count.setAttribute('aria-label','每份需带商品数');countLabel.append(count);
   const update=()=>{countLabel.hidden=select.value!=='required';count.disabled=countLabel.hidden;};select.onchange=update;update();const submit=node('button','保存标记');submit.type='submit';form.append(name,label,countLabel,submit);ui.body.append(form);
   form.onsubmit=e=>{e.preventDefault();if(select.value==='required'&&!count.checkValidity())return count.reportValidity();void save(ui,'bundle-rule',{...context,skuId:column.id,mode:select.value,count:Number(count.value),expectedVersion:version});};
  },
  async pick(context){
   if(busy)return;const ui=shell('选捆'),loading=node('p','正在读取可选商品…');ui.body.append(loading);
   let info;try{info=await api('bundle-options',context);}catch(e){if(dialog===ui.d)ui.notice.textContent=e.message;loading.remove();return;}
   if(dialog!==ui.d||current()?.id!==context.campaignId)return;loading.remove();
   const intro=node('p',info.cn+' · '+info.name,'bundle-product-name'),requirement=node('p','本排位需带 '+info.required+' 个商品','bundle-requirement'),list=node('div','','bundle-options'),summary=node('p','','bundle-preview'),actions=node('div','','bundle-dialog-actions'),submit=node('button','确认选捆'),remove=node('button','解除选捆','secondary');submit.type=remove.type='button';remove.hidden=!info.assigned.length&&!info.existingAssigned;
   const controls=[];
   for(const group of [{kind:'existing',name:'使用已排商品',options:info.existingOptions||[]},{kind:'new',name:'从余量新增',options:info.options}]){
    list.append(node('h4',group.name,'bundle-option-heading'));
    if(!group.options.length)list.append(node('p',group.kind==='existing'?'暂无本收款对象可用于选捆的已排商品。':'请先在本大类分盒的列头标记可用于选捆的商品。','bundle-empty'));
    for(const option of group.options){
    const row=node('label','','bundle-option'),check=node('input'),description=node('span','','bundle-option-name'),quantity=node('input');check.type='checkbox';check.checked=option.quantity>0;check.dataset[group.kind==='existing'?'record':'sku']=option.id;check.disabled=!option.quantity&&(option.available===null||option.available===0);
    description.append(node('span',option.name),node('small',group.kind==='existing'?'已排 '+option.ordered+option.unit+' · 可用 '+option.available+option.unit+' · 不重复计费':(option.available===null?'未设置可用数量':'可选 '+option.available+option.unit)+' · '+money(option.priceCents)));
    quantity.type='number';quantity.min='1';quantity.max=String(Math.max(option.quantity,option.available||0,1));quantity.step='1';quantity.value=String(option.quantity||1);quantity.hidden=!check.checked;quantity.setAttribute('aria-label',option.name+'选捆数量');quantity.dataset[group.kind==='existing'?'record':'sku']=option.id;
    row.append(check,description,quantity);list.append(row);controls.push({option,check,quantity,kind:group.kind});
    }
   }
   const items=kind=>controls.filter(x=>x.kind===kind&&x.check.checked).map(x=>({[kind==='existing'?'recordId':'skuId']:x.option.id,quantity:Number(x.quantity.value)}));
   const update=()=>{let total=0,cost=0,used=0,unknown=false,valid=true;for(const x of controls){x.quantity.hidden=!x.check.checked;if(!x.check.checked)continue;const n=Number(x.quantity.value);total+=n;valid=valid&&x.quantity.checkValidity();if(x.kind==='existing'){used+=n;continue;}if(x.option.priceCents===null)unknown=true;else cost+=x.option.priceCents*n;}summary.textContent='已选 '+total+' / '+info.required+' 个 · 新增捆金额 '+money(unknown?null:cost)+(used?'；使用已排 '+used+' 个，不重复计费':'');submit.disabled=!valid||total!==info.required;};
   for(const x of controls){x.check.onchange=update;x.quantity.oninput=update;}
   submit.onclick=()=>void save(ui,'bundle-assign',{...context,items:items('new'),existing:items('existing'),expectedVersion:info.version});remove.onclick=()=>void save(ui,'bundle-assign',{...context,items:[],existing:[],expectedVersion:info.version});actions.append(remove,submit);ui.body.append(intro,requirement,list,summary,actions);update();
  }
 };
}
