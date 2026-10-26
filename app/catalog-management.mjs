import {matchProduct} from './workflow.mjs';
import {isGiftCategory} from './public/catalog-utils.js';
const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/吧唧/g,'徽章').replace(/安洁丽娜/g,'安洁莉娜').replace(/[\s\p{P}\p{S}]/gu,'');
export function searchProducts(c,query,{products=c.products,categoryId='',productIds}={}){
 query=String(query||'').trim();if(query.length>120)throw Error('搜索内容最多120字');
 let available=products.filter(p=>(!categoryId||(p.categoryId||p.type)===categoryId)&&(!productIds||productIds.includes(p.id)));
 if(!query)return available;
 const tokens=query.split(/\s+/u).map(normalized).filter(Boolean),fuzzy=new Set(matchProduct(query,available,500,{arknights:!c.botId||c.botId==='zhougu'}).map(p=>p.id)),q=normalized(query);
 return available.map((p,index)=>{const cat=c.categories.find(cat=>cat.id===(p.categoryId||p.type)),fields=[p.name,p.character,...(p.aliases||[]),cat?.name,...(cat?.aliases||[]),p.boxId].map(normalized),text=fields.join('');const direct=tokens.every(t=>text.includes(t));return {p,index,score:fields[0]===q?1000:direct?600:fuzzy.has(p.id)?400:0};}).filter(row=>row.score).sort((a,b)=>b.score-a.score||a.index-b.index).map(row=>row.p);
}
export function productDeletionReason(c,id,products=c.products){
 const product=products.find(p=>p.id===id)||c.products.find(p=>p.id===id);if(!product)return '';
 const records=c.records.filter(r=>r.skuId===id);if(records.length)return '已有'+records.reduce((n,r)=>n+r.quantity,0)+'份排谷，不能删除';
 if(products.some(p=>p.id!==id&&p.giftComponents?.includes(id)))return '已被特典SET引用，请先调整SET组成';
 const lineIds=new Set((c.orderPlanning?.plan?.orders||[]).flatMap(o=>o.lines||[]).map(l=>l.id));
 if(lineIds.has('sku:'+id)||lineIds.has('box:'+(product.categoryId||product.type)+'|'+(product.boxId||'')))return '已在下单方案中，请先处理对应方案';
 if(c.orderLifecycle?.status==='completed')return '本期已结束，请先开启补单';
 return '';
}
function categoryScopeReferenced(value,id){if(!value||typeof value!=='object')return false;if(value.categoryId===id)return true;return Object.values(value).some(v=>typeof v==='object'&&categoryScopeReferenced(v,id));}
export function categoryDeletionReason(c,db,id,products=c.products,remainingCount=c.categories.length-1){
 if(remainingCount<1)return '至少保留一个大类';
 if(products.some(p=>(p.categoryId||p.type)===id))return '大类内还有商品，请先迁移或删除商品';
 if((db.albums||[]).filter(b=>b.campaignId===c.id).some(b=>categoryScopeReferenced(b.photoScopes,id)||categoryScopeReferenced(b.batchScopes,id)||categoryScopeReferenced(b.imageScopes,id)))return '仍有相册图片绑定此大类，请先调整图片大类';
 if((c.orderPlanning?.plan?.pool||[]).some(p=>p.categoryId===id&&p.quantity>0))return '下单方案仍引用此大类';
 return '';
}
export function validateCatalogChanges(c,db,products,categories){
 const ids=new Set(products.map(p=>p.id));
 for(const old of c.products)if(!ids.has(old.id)){const reason=productDeletionReason(c,old.id,products);if(reason)throw Error(old.name+'：'+reason);}
 for(const p of products)for(const id of p.giftComponents||[])if(!ids.has(id))throw Error(p.name+'的SET组成商品不存在');
 for(const old of c.categories)if(!categories.some(cat=>cat.id===old.id)){const reason=categoryDeletionReason(c,db,old.id,products,categories.length);if(reason)throw Error(old.name+'：'+reason);}
 // Renaming cannot erase the semantic identity of an existing gift category.
 for(const cat of categories){const before=c.categories.find(x=>x.id===cat.id);if(isGiftCategory(before))cat.role='gift';if(before&&before.name!==cat.name)cat.aliases=[...new Set([...(before.aliases||[]),...(cat.aliases||[]),before.name])].filter(name=>name!==cat.name).slice(-10);}
}
