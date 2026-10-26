// Keep an agent's recipients adjacent, with a separate bill for every recipient.
export function recipientBlocks(items){
 const blocks=new Map();
 for(const item of items){const key=item.proxyFor||'';if(!blocks.has(key))blocks.set(key,{cn:item.cn,proxyFor:key,items:[]});blocks.get(key).items.push(item);}
 return [...(blocks.has('')?[blocks.get('')]:[]),...[...blocks.entries()].filter(([key])=>key!=='').map(([,value])=>value)];
}
export function groupRecipients(items){
 const owners=new Map();
 for(const item of items){const key=item.ownerKey||item.personKey;if(!owners.has(key))owners.set(key,[]);owners.get(key).push(item);}
 return [...owners.values()].flatMap(own=>recipientBlocks(own).map(block=>({key:block.items[0].personKey,cn:block.cn,items:block.items})));
}
// Compact bills only; the underlying per-unit records and queue order stay intact.
export function billLines(items){
 const lines=new Map();
 for(const item of items){const key=JSON.stringify([item.personKey,item.skuId,item.categoryId,item.boxId,item.name,item.unit,item.originalCents,item.averageCents,item.adjustmentCents,item.finalCents]);let line=lines.get(key);if(!line){line={...item,quantity:0};lines.set(key,line);}line.quantity++;}
 return [...lines.values()].map(line=>({...line,displayName:line.name+(line.quantity>1?' ×'+line.quantity+(line.unit||'件'):'')}));
}
