const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
export function selectedAlbumCategories(scope,products=[]){
 const entries=scope?.categoryScopes||[scope||{}],selected=new Map();
 for(const entry of entries){if(entry.productIds?.length){for(const p of products.filter(p=>entry.productIds.includes(p.id)))selected.set(p.categoryId||p.type,{categoryId:p.categoryId||p.type,boxId:''});}else if(entry.categoryId){const boxId=entry.boxId||'',previous=selected.get(entry.categoryId);selected.set(entry.categoryId,{categoryId:entry.categoryId,boxId:previous&&previous.boxId!==boxId?'':boxId});}}
 return [...selected.values()];
}
export const albumSelectionKey=value=>JSON.stringify(value?.ignored?{ignored:true}:{categoryScopes:[...(value?.categoryScopes||[])].map(x=>({categoryId:x.categoryId,boxId:x.boxId||''})).sort((a,b)=>a.categoryId.localeCompare(b.categoryId))});
export function createAlbumScopePicker({categories,products,scope,draft,onChange}){
 let busy=false;let ignored=draft?.ignored??scope?.ignored??false;const selected=new Map((draft?.categoryScopes||selectedAlbumCategories(scope,products)).filter(e=>categories.some(c=>c.id===e.categoryId)).map(e=>[e.categoryId,e.boxId||'']));
 const root=el('details','album-category-picker'),summary=el('summary'),text=el('span'),arrow=el('span',null,'⌄'),options=el('div','album-category-options');summary.setAttribute('aria-label','这次上传对应的商品大类');summary.append(text,arrow);root.append(summary,options);root.open=!!draft?.open;
 const value=()=>({ignored,categoryScopes:[...selected].map(([categoryId,boxId])=>({categoryId,boxId})),open:root.open});
 function notify(){onChange(value());}
 function draw(){text.textContent=ignored?'可忽略（不参与排表）':selected.size?categories.filter(c=>selected.has(c.id)).map(c=>c.name).join('、'):'选择商品大类（可多选）';text.title=text.textContent;options.replaceChildren();for(const cat of categories){const row=el('div','album-category-option'),label=el('label'),check=el('input');check.type='checkbox';check.dataset.categoryId=cat.id;check.checked=selected.has(cat.id);check.disabled=ignored||busy;label.append(check,el('span',null,cat.name));row.append(label);check.onchange=()=>{if(check.checked)selected.set(cat.id,'');else selected.delete(cat.id);draw();notify();};
  const boxes=[...new Set(products.filter(p=>(p.categoryId||p.type)===cat.id&&p.boxId).map(p=>p.boxId))];if(selected.has(cat.id)&&boxes.length){const box=el('select');box.setAttribute('aria-label',cat.name+'分盒');box.dataset.categoryId=cat.id;box.add(new Option('全部分盒',''));for(const id of boxes)box.add(new Option(id,id));box.value=selected.get(cat.id);box.disabled=ignored||busy;box.onchange=()=>{selected.set(cat.id,box.value);notify();};row.append(box);}options.append(row);
 }const label=el('label','album-ignore-choice'),check=el('input');check.type='checkbox';check.checked=ignored;check.disabled=busy;check.setAttribute('aria-label','可忽略，不参与排表');check.onchange=()=>{ignored=check.checked;draw();notify();};label.append(check,el('span',null,'可忽略（不参与排表）'));options.append(label);}
 root.ontoggle=notify;draw();return {root,value,setDisabled(value){busy=value;draw();}};
}
