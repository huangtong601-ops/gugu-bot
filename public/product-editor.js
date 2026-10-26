import {mergeRecognitionCategories} from './recognition-categories.js';
import {MAX_GIFT_TIERS,tierLabel} from './gift-tiers.js';
import {paddedCropBounds} from './image-geometry.js';
import {mergeProducts,ensureGiftSet,mergeBoxPrices} from './product-merge.js';
import {createProductFinder} from './product-finder.js';
import {createCategoryManager} from './category-manager.js';
import {isGiftCategory} from './catalog-utils.js';
const types=['特典','单领','通行证'];
const numberOrNull=value=>value.trim()===''?null:Number(value);
export function createProductEditor({api,notice,onChange,prefs={},onPrefs,getCampaign=()=>null}){
  let products=[],filter='全部',generation=0,showImages=true,categories=[],lastEdit={products:[],categories:[]};
  const category=p=>categories.find(c=>c.id===(p.categoryId||p.type));
  const grouped=p=>category(p)?.kind==='group';
  const fixed=p=>category(p)?.pricingMode==='fixed';
  const manager=createCategoryManager({getSnapshot:()=>({products,categories}),getCampaign,checkDelete:async(id,remaining)=>{if(!getCampaign()?.categories.some(cat=>cat.id===id))return {allowed:true};return api('category-delete-check',{campaignId:getCampaign().id,categoryId:id,remainingCount:remaining,products:products.map(p=>({id:p.id,categoryId:p.categoryId||p.type}))});},apply:value=>{if(JSON.stringify(categories)===JSON.stringify(value))return;categories=structuredClone(value);if(filter!=='全部'&&!categories.some(c=>c.id===filter))filter='全部';changed();render();}});
  function move(s,id){const c=categories.find(c=>c.id===id);if(!c)return;s.categoryId=id;s.pricingMode=c.pricingMode||'adjustment';if(c.kind==='group'){s.character||=s.name.replace(/^通行证[-－]/,'');s.averagePrice??=null;s.adjustment??=0;}changed();render();}

let moveDialog=null,moveTarget=null;
function openMoveDialog(s){
 if(!moveDialog){
  moveDialog=el('dialog','app-dialog');moveDialog.id='moveDialog';
  const head=el('header','dialog-head'),box=el('div'),h=el('h2',null,'移动商品');h.id='moveDialogTitle';box.append(h,el('p','dialog-sub','选择要移动到的大类。'));
  const x=el('button','dialog-close','✕');x.type='button';x.setAttribute('aria-label','关闭');head.append(box,x);
  const body=el('div','dialog-body'),lab=el('label',null,'目标大类'),sel=el('select');sel.id='moveTarget';lab.append(sel);body.append(lab);
  const foot=el('footer','dialog-actions'),cancel=el('button','secondary','取消'),ok=el('button',null,'移动');cancel.type='button';ok.type='button';foot.append(cancel,ok);
  moveDialog.append(head,body,foot);document.body.append(moveDialog);
  x.onclick=cancel.onclick=()=>moveDialog.close();
  ok.onclick=()=>{const id=sel.value;moveDialog.close();if(id&&moveTarget)move(moveTarget,id);};
  moveDialog.addEventListener('click',e=>{if(e.target===moveDialog)moveDialog.close();});
 }
 moveTarget=s;const sel=moveDialog.querySelector('#moveTarget');sel.replaceChildren(...categories.filter(c=>c.id!==(s.categoryId||s.type)).map(c=>new Option(c.name,c.id)));
 if(!sel.options.length){notice('没有其他大类可以移动');return;}
 moveDialog.showModal();sel.focus();
}
  function renderFilters(){
    const host=document.getElementById('typeFilters');host.querySelectorAll('[data-type]').forEach(n=>n.remove());
    for(const c of [{id:'全部',name:'全部'},...categories]){const b=el('button',filter===c.id?'selected':'',c.name);b.dataset.type=c.id;b.onclick=()=>{filter=c.id;render();};host.insertBefore(b,document.getElementById('toggleImages'));}
    let manage=document.getElementById('manageCategories');if(!manage){manage=el('button','secondary category-manage-button','管理大类');manage.id='manageCategories';manage.type='button';manage.onclick=()=>{if(!getCampaign()){notice('请先新建期次');return;}manager.open();};host.append(manage);}
  }
  const host=document.getElementById('products');
  const pricingHost=document.getElementById('passPricing');
  const finder=createProductFinder({id:'catalogSearch',mode:'cards',api,getCampaign,getProducts:()=>products,getCategories:()=>categories,getScope:()=>filter==='全部'?{}:{categoryId:filter},onResults:()=>render(),onError:notice});document.getElementById('typeFilters').after(finder.root);
  const groupKey=p=>String(p.boxId||'').trim();
  function updatePassGroup(key,average){
    for(const p of products)if(grouped(p)&&!fixed(p)&&(p.categoryId||p.type)===filter&&groupKey(p)===key){if(p.pendingFixedPrice!=null&&average!==null){p.adjustment=Math.round((p.pendingFixedPrice-average)*100)/100;delete p.pendingFixedPrice;}p.averagePrice=average;p.price=average===null?null:(Math.round(average*100)+Math.round((p.adjustment??0)*100))/100;}
    // Rebuild the cards without disturbing focus in the shared price input.
    render(false);changed();
  }
  function renderPricing(){
    pricingHost.replaceChildren();const groups=new Map();
    for(const p of products)if(grouped(p)&&(p.categoryId||p.type)===filter){const key=groupKey(p);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
    pricingHost.hidden=!groups.size;if(pricingHost.hidden)return;
    const c=categories.find(c=>c.id===filter),switcher=el('select');switcher.add(new Option('均价＋调价','adjustment'));switcher.add(new Option('固定价','fixed'));switcher.value=c.pricingMode||'adjustment';switcher.onchange=()=>{for(const p of products.filter(p=>(p.categoryId||p.type)===filter)){if(switcher.value==='fixed')p.price=p.averagePrice==null?null:Math.round((p.averagePrice+(p.adjustment||0))*100)/100;else if(p.price!=null){if(p.averagePrice!=null)p.adjustment=Math.round((p.price-p.averagePrice)*100)/100;else p.pendingFixedPrice=p.price;}p.pricingMode=switcher.value;}c.pricingMode=switcher.value;changed();render();};
    const boxKeys=[...groups.keys()],single=boxKeys.length===1?boxKeys[0]:'';
    const head=el('div','pass-head'),modeLabel=el('label','pass-mode');
    modeLabel.append(el('span',null,'计价方式'),switcher);
    head.append(modeLabel,el('span','pass-scope',c.name+(single?' '+single:'')));
    pricingHost.append(head);
    const wrap=el('div','pass-fields');
    for(const [key,items] of groups){
      const line=el('div','pass-line');
      const setField=el('label','pass-field');
      setField.append(el('span','pass-caption',boxKeys.length>1?(key||c.name)+' 开配数':'开配数'));
      const setInput=el('input');setInput.type='number';setInput.min='0';setInput.step='1';setInput.value=c.setsByBox?.[key]??c.sets??0;setInput.setAttribute('aria-label',(key||c.name)+'开配数');
      setInput.oninput=()=>{c.setsByBox??={};c.setsByBox[key]=Number(setInput.value);changed();};
      setField.append(setInput);line.append(setField);
      const originalField=el('label','pass-field');originalField.append(el('span','pass-caption','整盒原价'));
      const original=el('input');original.type='number';original.min='0';original.step='0.01';original.placeholder='从商品图导入';original.value=c.boxPrices?.[key]??'';original.setAttribute('aria-label',(key||c.name)+'整盒原价');
      original.oninput=()=>{c.boxPrices??={};c.boxPrices[key]=numberOrNull(original.value);changed();};originalField.append(original);line.append(originalField);
      if(c.pricingMode!=='fixed'){
        const averages=[...new Set(items.map(p=>p.averagePrice??null))],average=averages.length===1?averages[0]:null;
        const priceField=el('label','pass-field');
        priceField.append(el('span','pass-caption',boxKeys.length>1?(key||c.name)+' 均价':c.name+'均价'));
        const controls=el('div','pass-price-controls'),mode=el('select'),amount=el('input');
        mode.add(new Option('自动导入','later'));mode.add(new Option('手动填写','manual'));
        mode.setAttribute('aria-label',`${c.name}${key||''}均价填写方式`);mode.value=c.averageModesByBox?.[key]==='auto'?'later':c.averageModesByBox?.[key]==='manual'?'manual':average===null?'later':'manual';
        amount.type='number';amount.min='0';amount.step='0.01';amount.value=average??'';amount.placeholder=averages.length>1?'请统一均价':'元 / '+(items[0]?.unit||'件');amount.disabled=mode.value==='later';amount.setAttribute('aria-label',`${c.name}${key||''}统一均价`);
        mode.onchange=()=>{c.averageModesByBox??={};c.averageModesByBox[key]=mode.value==='later'?'auto':'manual';amount.disabled=mode.value==='later';if(mode.value==='later')amount.value='';updatePassGroup(key,mode.value==='later'?null:numberOrNull(amount.value));};
        amount.oninput=()=>updatePassGroup(key,numberOrNull(amount.value));
        controls.append(mode,amount);priceField.append(controls);line.append(priceField);
      }
      wrap.append(line);
    }
    pricingHost.append(wrap);
  }
  const imageToggle=document.getElementById('toggleImages');
  const viewPicker=document.getElementById('viewPicker'),viewButton=document.getElementById('viewOptions'),viewMenu=document.getElementById('viewMenu');
  let columns=[2,3].includes(Number(prefs.columns))?Number(prefs.columns):2;
  function closeView(){viewMenu.hidden=true;viewButton.setAttribute('aria-expanded','false');}
  function fitCards(){const scale=parseFloat(getComputedStyle(host).getPropertyValue('--card-scale'))||1;for(const card of host.querySelectorAll('.product-card')){const content=card.querySelector('.product-content'),media=card.querySelector('.product-media');if(!content)continue;const noImage=!!media&&media.hidden;card.classList.toggle('no-image',noImage);if(noImage){content.style.height='auto';card.style.height=Math.ceil(content.offsetHeight*scale)+'px';}else{content.style.height='';card.style.height='';}}}
  function scaleCards(){const gap=parseFloat(getComputedStyle(host).columnGap)||0;const width=(host.clientWidth-gap*(columns-1))/columns-2;host.style.setProperty('--card-scale',String(Math.max(0,width)/320));fitCards();}
  let observedWidth=-1,scaleFrame=0;
  new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width??0;if(Math.abs(width-observedWidth)<.5)return;observedWidth=width;cancelAnimationFrame(scaleFrame);scaleFrame=requestAnimationFrame(scaleCards);}).observe(host);
  function applyView(){host.style.setProperty('--product-columns',String(columns));host.dataset.columns=String(columns);scaleCards();viewMenu.querySelectorAll('[data-columns]').forEach(b=>b.setAttribute('aria-checked',String(Number(b.dataset.columns)===columns)));}
  applyView();
  viewButton.onclick=()=>{const opening=viewMenu.hidden;viewMenu.hidden=!opening;viewButton.setAttribute('aria-expanded',String(opening));};
  viewMenu.querySelectorAll('[data-columns]').forEach(b=>b.onclick=()=>{columns=Number(b.dataset.columns);applyView();onPrefs?.({columns});closeView();viewButton.focus();});
  viewPicker.onkeydown=e=>{if(e.key==='Escape'){closeView();viewButton.focus();}};
  viewPicker.onfocusout=e=>{if(!viewPicker.contains(e.relatedTarget))closeView();};
  document.addEventListener('click',e=>{if(!viewPicker.contains(e.target))closeView();});
  function syncImageToggle(){
    imageToggle.disabled=!products.some(p=>!p.textOnly&&p.imageUrl&&(filter==='全部'||(p.categoryId||p.type)===filter));
    const active=showImages&&!imageToggle.disabled;imageToggle.classList.toggle('enabled',active);imageToggle.setAttribute('aria-pressed',String(active));imageToggle.title=active?'隐藏商品图片':'显示商品图片';
    host.querySelectorAll('.product-media').forEach(media=>{media.hidden=!active||media.dataset.textOnly==='true';});fitCards();
  }
  imageToggle.onclick=()=>{showImages=!showImages;onPrefs?.({showImages});syncImageToggle();};
  function changed(){document.getElementById('productCount').textContent=String(products.length);const after=structuredClone({products,categories}),before=lastEdit;lastEdit=after;if(JSON.stringify(before)!==JSON.stringify(after))onChange?.({before,after});}
  function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
  function input(label,value,handler,{type='text',placeholder=''}={}){const l=el('label','field-label',label),i=el('input');i.type=type;i.value=value??'';i.placeholder=placeholder;if(type==='number')i.step='0.01';i.oninput=()=>{handler(type==='number'?numberOrNull(i.value):i.value);changed();};l.append(i);return l;}
  function render(pricing=true){
    if(pricing)renderPricing();
    host.replaceChildren();document.getElementById('productCount').textContent=String(products.length);
    renderFilters();finder.refresh();const visible=finder.filter(products.filter(p=>filter==='全部'||(p.categoryId||p.type)===filter));
    syncImageToggle();
    if(!visible.length){host.append(el('div','catalog-empty',finder.searching()?'正在搜索…':finder.query()?'没有匹配商品，可更换关键词或切换到“全部”。':products.length?'该类型还没有商品。':'上传商品图，或手动添加第一件谷子。'));return;}
    for(const s of visible){
      const card=el('div','product-card'),content=el('div','product-content');card.dataset.id=s.id;
      const media=el('div','product-media'),img=el('img');img.alt=s.name||'商品图片';img.loading='lazy';
      const placeholder=el('span','image-placeholder','添加图片');img.hidden=!s.imageUrl;if(s.imageUrl)img.src=s.imageUrl;
      placeholder.hidden=!!s.imageUrl;img.onerror=()=>{img.hidden=true;placeholder.hidden=false;placeholder.textContent='替换图片';};
      const upload=el('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';upload.setAttribute('aria-label','替换商品图片');
      upload.onchange=async()=>{const token=generation;try{const f=upload.files[0];if(!f)return;const data=await fileData(f);const r=await api('upload',{image:data});if(token!==generation)return;s.imageUrl=r.url;s.imageKind='商品图';img.src=r.url;img.hidden=false;placeholder.hidden=true;changed();}catch(e){notice(e.message);}};
      media.dataset.textOnly=String(s.textOnly===true);media.hidden=!showImages||imageToggle.disabled||s.textOnly===true;media.append(img,placeholder,upload);content.append(media);
      const body=el('div','product-body');
      const heading=el('div','card-actions'),label=el('span','kind-badge',category(s)?.name||s.type),menu=el('div','product-menu'),trigger=el('button','menu-trigger','⋯'),dropdown=el('div','product-dropdown'),remove=el('button',null,'删除');
      trigger.type='button';trigger.setAttribute('aria-label','商品操作 '+s.name);trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-haspopup','menu');dropdown.hidden=true;dropdown.setAttribute('role','menu');remove.type='button';remove.setAttribute('role','menuitem');
      trigger.onclick=()=>{const opening=dropdown.hidden;host.querySelectorAll('.product-dropdown').forEach(n=>n.hidden=true);host.querySelectorAll('.menu-trigger').forEach(n=>n.setAttribute('aria-expanded','false'));dropdown.hidden=!opening;trigger.setAttribute('aria-expanded',String(opening));};
      menu.onkeydown=e=>{if(e.key==='Escape'){dropdown.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}};
      menu.onfocusout=e=>{if(!menu.contains(e.relatedTarget)){dropdown.hidden=true;trigger.setAttribute('aria-expanded','false');}};
      const deleteReason=()=>{const c=getCampaign();if(c?.records?.some(r=>r.skuId===s.id))return '已有排谷，不能删除';if(products.some(p=>p.id!==s.id&&p.giftComponents?.includes(s.id)))return '已被特典SET引用，请先调整SET组成';return '';};
      const reason=deleteReason();remove.disabled=!!reason;remove.title=reason;
      remove.onclick=async()=>{if(remove.disabled)return;remove.disabled=true;try{const c=getCampaign();if(!c)throw Error('请先选择期次');const token=generation,result=await api('product-delete-check',{campaignId:c.id,skuId:s.id,products:products.map(p=>({id:p.id,name:p.name,categoryId:p.categoryId||p.type,type:p.type,boxId:p.boxId,giftComponents:p.giftComponents}))});if(token!==generation)return;if(!result.allowed)throw Error(result.reason);products=products.filter(p=>p.id!==s.id);changed();render();}catch(error){notice(error.message);remove.disabled=!!deleteReason();}};const moveItem=el('button','menu-move','移动到…');moveItem.type='button';moveItem.setAttribute('role','menuitem');moveItem.onclick=()=>{dropdown.hidden=true;trigger.setAttribute('aria-expanded','false');openMoveDialog(s);};dropdown.append(moveItem,remove);if(reason)dropdown.append(el('small','delete-reason',reason));menu.append(trigger,dropdown);heading.append(label,menu);body.append(heading);
      body.append(input('谷名',s.name,v=>{s.name=v;if(s.type==='通行证')s.character=v.replace(/^通行证[-－]/,'');},{placeholder:s.type==='通行证'?'通行证-角色名':'填写谷名'}));
      const typeRow=el('div','field-row'),typeLabel=el('label','field-label','大类'),select=el('select');for(const c of categories)select.add(new Option(c.name,c.id));select.value=s.categoryId||s.type;select.onchange=()=>move(s,select.value);typeLabel.append(select);typeRow.append(typeLabel,input('单位',s.unit,v=>s.unit=v));body.append(typeRow);
      if(grouped(s)&&!fixed(s)){
        const sum=el('div','pass-total');
        function total(){s.price=typeof s.averagePrice==='number'&&Number.isFinite(s.averagePrice)&&typeof s.adjustment==='number'&&Number.isFinite(s.adjustment)?(Math.round(s.averagePrice*100)+Math.round(s.adjustment*100))/100:null;sum.hidden=s.price===null;sum.textContent=s.price===null?'':`价格 ¥${s.price.toFixed(2)} / ${s.unit||'对'}`;}
        const adjustmentField=input(s.adjustmentReview?'本团调价（待复核）':'本团调价',s.adjustment??0,v=>{s.adjustment=v;s.adjustmentSource='manual';s.adjustmentReview=false;adjustmentField.firstChild.textContent='本团调价';total();},{type:'number'});adjustmentField.title=s.adjustmentText?'原标注：'+s.adjustmentText:'';body.append(adjustmentField,sum);total();
      }else body.append(input(fixed(s)?'固定价':s.type==='特典'?'自定价格':'原价',s.price,v=>s.price=v,{type:'number'}));
      if(s.type==='特典'){const label=el('label','field-label','特典档次'),tier=el('select');for(const [value,name]of [['','未标档次'],...Array.from({length:MAX_GIFT_TIERS},(_,i)=>[String(i+1),tierLabel(i+1)]),['set','特典SET']])tier.add(new Option(name,value));tier.value=String(s.giftTier||'');tier.onchange=()=>{s.giftTier=tier.value==='set'?'set':tier.value?Number(tier.value):null;changed();};label.append(tier);body.append(label);}
      content.append(body);card.append(content);host.append(card);
    }
    fitCards();
  }
  document.querySelectorAll('#typeFilters button[data-type]').forEach(button=>button.onclick=()=>{filter=button.dataset.type;document.querySelectorAll('#typeFilters button[data-type]').forEach(b=>b.classList.toggle('selected',b===button));render();});
  return {
    restore(value,dirty=true){products=structuredClone(value.products);categories=structuredClone(value.categories);lastEdit=structuredClone(value);generation++;render();onChange?.({restored:true,dirty});},
    load(value,groups){generation++;if([2,3].includes(Number(prefs.columns))&&Number(prefs.columns)!==columns){columns=Number(prefs.columns);applyView();}categories=structuredClone(groups||[{id:'特典',name:'特典',kind:'single'},{id:'单领',name:'单领',kind:'single'},{id:'通行证',name:'通行证',kind:'group',pricingMode:'adjustment',sets:0}]);if(filter!=='全部'&&!categories.some(c=>c.id===filter))filter='全部';products=structuredClone(value||[]).map(s=>({...s,type:s.type||'单领',imageUrl:s.textOnly?'':s.imageUrl||'',unit:s.unit||'件'}));showImages=prefs.showImages===undefined?products.some(p=>!p.textOnly&&p.imageUrl):prefs.showImages!==false;render();lastEdit=structuredClone({products,categories});},
    categories(){return structuredClone(categories);},
    snapshot(){return structuredClone(products);},
    append(value,boxPrices=[],definitions=[]){value=structuredClone(value);const categoryBefore=JSON.stringify(categories),nextCategories=structuredClone(categories);mergeRecognitionCategories(nextCategories,value,definitions,()=>crypto.randomUUID());categories=nextCategories;for(const p of value){if(categories.some(cat=>cat.id===(p.categoryId||p.type)))continue;let cat=categories.find(cat=>cat.name===p.type||p.type==='特典'&&isGiftCategory(cat));if(!cat){cat={id:p.type||'单领',name:p.type||'单领',kind:p.type==='通行证'?'group':'single',pricingMode:'adjustment',sets:0};categories.push(cat);}p.categoryId=cat.id;}const hadImages=products.some(p=>!p.textOnly&&p.imageUrl),existingIds=new Set(products.map(p=>p.id)),averages=new Map();for(const p of products)if(grouped(p))averages.set((p.categoryId||p.type)+'|'+groupKey(p),p.averagePrice??null);const result=mergeProducts(products,value,()=>crypto.randomUUID());result.added+=ensureGiftSet(products,()=>crypto.randomUUID());result.updated+=mergeBoxPrices(categories,products,boxPrices);for(const p of products)if(grouped(p)&&!existingIds.has(p.id)&&averages.has((p.categoryId||p.type)+'|'+groupKey(p)))p.averagePrice=averages.get((p.categoryId||p.type)+'|'+groupKey(p));if(prefs.showImages===undefined&&!hadImages&&products.some(p=>!p.textOnly&&p.imageUrl))showImages=true;if(result.added||result.updated||result.adjusted||JSON.stringify(categories)!==categoryBefore)changed();render();return result;},
    add(){const c=categories.find(c=>c.id===filter)||categories.find(c=>c.id==='单领')||categories[0];products.push({id:crypto.randomUUID(),name:'',type:isGiftCategory(c)?'特典':c.id==='通行证'?'通行证':'单领',categoryId:c.id,price:null,averagePrice:null,adjustment:0,unit:c.id==='通行证'?'对':'件',imageUrl:'',aliases:[]});changed();render();}
  };
}
export async function fileData(file){if(file.size>7*1024*1024)throw Error('请选择小于 7MB 的图片');return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});}
export async function cropProduct(dataUrl,bounds){
  if(!bounds||!['x','y','width','height'].every(k=>typeof bounds[k]==='number'&&Number.isFinite(bounds[k])))return null;
  const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=dataUrl;});
  const padded=paddedCropBounds(bounds,image.naturalWidth,image.naturalHeight);if(!padded)return null;
  const {x,y,width,height}=padded;
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*image.naturalWidth));canvas.height=Math.max(1,Math.round(height*image.naturalHeight));
  const ctx=canvas.getContext('2d');if(!ctx)return null;ctx.drawImage(image,x*image.naturalWidth,y*image.naturalHeight,width*image.naturalWidth,height*image.naturalHeight,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');
}
