export const categoryKey=name=>String(name||'').normalize('NFKC').trim().toLowerCase();
export const isGiftCategory=c=>!!c&&(c.role==='gift'||c.id==='特典'||c.name==='特典');
export function validateCategoryName(name,categories=[],id=''){
 name=String(name||'').trim();
 if(!name||name.length>31||/[\\/?*\[\]:\u0000-\u001f]/.test(name)||/^'|'$/.test(name)||categoryKey(name)==='全部')throw Error('大类名称须为1至31字，不能使用“全部”或表格特殊字符');
 if(categories.some(c=>c.id!==id&&categoryKey(c.name)===categoryKey(name)))throw Error('大类名称已存在');
 return name;
}
export function renameCategory(categories,id,name){
 const cat=categories.find(c=>c.id===id);if(!cat)throw Error('大类不存在');name=validateCategoryName(name,categories,id);if(cat.name===name)return false;
 if(isGiftCategory(cat))cat.role='gift';cat.aliases=[...new Set([...(cat.aliases||[]),cat.name])].filter(n=>categoryKey(n)!==categoryKey(name)).slice(-10);cat.name=name;return true;
}
export function moveCategory(categories,id,direction){const index=categories.findIndex(c=>c.id===id),next=index+(direction==='up'?-1:1);if(index<0||next<0||next>=categories.length)return false;[categories[index],categories[next]]=[categories[next],categories[index]];return true;}
