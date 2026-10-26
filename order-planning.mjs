import {isGiftCategory} from './public/catalog-utils.js';
import {createHash} from 'node:crypto';
import {groupCapacity} from './workflow.mjs';
import {MAX_GIFT_TIERS,tierLabel} from './public/gift-tiers.js';
export const cents=(v,label='金额')=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||Math.abs(v*100-Math.round(v*100))>1e-6)throw Error(label+'须为非负金额，最多两位小数');return Math.round(v*100);};
export const isGift=(p,c)=>p.type==='特典'||isGiftCategory(c.categories.find(x=>x.id===(p.categoryId||p.type)));
export function purchasePool(c){
 const rows=[],groups=new Map();
 for(const p of c.products){if(isGift(p,c))continue;const cat=c.categories.find(x=>x.id===(p.categoryId||p.type)),demand=c.records.filter(r=>r.skuId===p.id).reduce((n,r)=>n+r.quantity,0);
  if(cat?.kind==='group'){const key=cat.id+'|'+(p.boxId||'');let g=groups.get(key);if(!g){g={id:'box:'+key,name:cat.name+(p.boxId?' '+p.boxId:'')+'（整盒）',categoryId:cat.id,boxId:p.boxId||'',kind:'group',unit:'盒',quantity:groupCapacity(cat,p.boxId||'')??0,price:cat.boxPrices?.[p.boxId||'']??null,demand:0};groups.set(key,g);rows.push(g);}g.demand=Math.max(g.demand,demand);}
  else rows.push({id:'sku:'+p.id,skuId:p.id,name:p.name,categoryId:cat?.id||p.type,kind:'single',unit:p.unit||'件',quantity:demand,price:p.price,demand});
 }
 return rows.map(r=>{const saved=c.orderPlanning?.pool?.find(x=>x.id===r.id);return {...r,quantity:saved?.quantity??r.quantity,price:saved?.price??r.price};});
}
export function planningSettings(b){
 const raw=Array.isArray(b.tiers)?b.tiers:[b.tier1,...(b.tier2==null?[]:[b.tier2])];
 if(!raw.length||raw.length>MAX_GIFT_TIERS)throw Error('特典档位数量须为1至5档');
 const tiers=raw.map((v,i)=>cents(v,tierLabel(i+1)+'门槛'));
 if(tiers.some((v,i)=>v<=0||i>0&&v<=tiers[i-1]))throw Error('特典门槛须大于0，且高档门槛须高于前一档');
 const leftoverStrategy=b.leftoverStrategy??'moreGifts',objective=b.objective??'tier2';
 if(!['moreGifts','fewerOrders'].includes(leftoverStrategy)||!['total','tier2'].includes(objective)||!['both','highest'].includes(b.rewardMode)||!['once','stack'].includes(b.rule))throw Error('请选择特典规则和剩余商品处理方式');
 return {tiers,tier1:tiers[0],tier2:tiers[1]??null,objective,rewardMode:b.rewardMode,rule:b.rule,leftoverStrategy};
}
export function normalizePool(c,input){
 const available=purchasePool(c);if(!Array.isArray(input)||input.length!==available.length||new Set(input.map(x=>x.id)).size!==input.length)throw Error('购买清单已变化，请刷新后重试');
 return available.map(row=>{const item=input.find(x=>x.id===row.id);if(!item)throw Error('购买商品已变化');if(!Number.isSafeInteger(item.quantity)||item.quantity<0||item.quantity>999)throw Error('数量须为0到999的整数');const price=item.price==null?null:cents(item.price,row.name+'原价')/100;if(item.quantity&&price===null)throw Error('请填写'+row.name+'原价');return {...row,quantity:item.quantity,price};});
}
export function rewards(sum,s){
 const tiers=s.tiers||[s.tier1,...(s.tier2==null?[]:[s.tier2])];
 let giftCounts=tiers.map(t=>s.rule==='stack'?Math.floor(sum/t):Number(sum>=t));
 if(s.rule!=='stack'&&s.rewardMode==='highest'){const highest=giftCounts.lastIndexOf(1);giftCounts=giftCounts.map((v,i)=>i===highest?v:0);}
 return {giftCounts,tier1:giftCounts[0]??0,tier2:giftCounts[1]??0};
}
function better(a,b,s){
 const av=a.giftCounts,bv=b.giftCounts,last=s.tiers.length-1;
 if(s.leftoverStrategy==='fewerOrders')return av[last]-bv[last];
 if(s.objective==='total'){const delta=av.reduce((n,v)=>n+v,0)-bv.reduce((n,v)=>n+v,0);if(delta)return delta;}
 for(let i=last;i>=0;i--)if(av[i]!==bv[i])return av[i]-bv[i];
 return 0;
}
export function planOrders(pool,settings,{budgetMs=1800}={}){
 const s=planningSettings(settings),items=[];
 for(const row of pool){if(!Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>999)throw Error('购买数量须为0到999的整数');if(!row.quantity)continue;const value=cents(row.price,row.name+'原价');if(!value)throw Error('下单商品原价须大于0');for(let i=0;i<row.quantity;i++)items.push({id:row.id,name:row.name,unit:row.unit||'件',cents:value});}
 if(!items.length)throw Error('请先填写购买商品和数量');if(items.length>1000)throw Error('单次规划最多1000件商品，请分批规划');
 let bins=[],proven=true;const deadline=Date.now()+budgetMs;
 if(s.rule==='stack')bins=[items];
 else{
  const top=s.tiers.at(-1),minimum=s.leftoverStrategy==='fewerOrders'?top:s.tiers[0],small=items.filter(x=>x.cents<top);bins=items.filter(x=>x.cents>=top).map(x=>[x]);
  const prices=[...new Set(small.map(x=>x.cents))].sort((a,b)=>b-a),counts=prices.map(p=>small.filter(x=>x.cents===p).length),patterns=[];
  function enumerate(i,used,sum,min,target){
   if(Date.now()>deadline||patterns.length>=16000){proven=false;return;}
   if(sum>=target){if(sum-min<target)patterns.push({counts:[...used,...Array(prices.length-used.length).fill(0)],sum,...rewards(sum,s)});return;}
   if(i>=prices.length)return;
   const max=Math.min(counts[i],Math.ceil((target-sum)/prices[i]));
   for(let n=0;n<=max;n++){used.push(n);enumerate(i+1,used,sum+n*prices[i],n?Math.min(min,prices[i]):min,target);used.pop();if(!proven)return;}
  }
  const targets=s.leftoverStrategy==='fewerOrders'?[top]:[...s.tiers].reverse();
  for(const t of targets)enumerate(0,[],0,Infinity,t);
  const distinct=[...new Map(patterns.map(p=>[p.counts.join(','),p])).values()];
  // Prefer higher-tier bundles, then less spend per bundle to leave room for others.
  distinct.sort((a,b)=>better(b,a,s)||a.sum-b.sum);
  const fits=(p,left)=>p.counts.every((n,i)=>n<=left[i]);
  const zero=()=>({giftCounts:s.tiers.map(()=>0),chosen:[]});
  const greedy=left=>{left=[...left];const out=zero();while(true){const p=distinct.find(p=>fits(p,left));if(!p)break;p.counts.forEach((n,i)=>left[i]-=n);out.chosen.push(p);out.giftCounts=out.giftCounts.map((v,i)=>v+p.giftCounts[i]);}return out;};
  const memo=new Map();let visited=0;
  function search(left){
   if(Date.now()>deadline||visited++>120000){proven=false;return greedy(left);}
   const key=left.join(',');if(memo.has(key))return memo.get(key);
   const anchor=left.findIndex(n=>n>0),total=left.reduce((n,v,i)=>n+v*prices[i],0);if(anchor<0||total<minimum)return zero();
   let best=greedy(left);const upper=Math.floor(total/minimum);
   if(s.tiers.length===1&&best.giftCounts[0]===upper){memo.set(key,best);return best;}
   for(const p of distinct){if(!p.counts[anchor]||!fits(p,left))continue;if(Date.now()>deadline){proven=false;break;}
    const tail=search(left.map((n,i)=>n-p.counts[i])),candidate={giftCounts:tail.giftCounts.map((v,i)=>v+p.giftCounts[i]),chosen:[p,...tail.chosen]};
    if(better(candidate,best,s)>0)best=candidate;
    if(s.tiers.length===1&&best.giftCounts[0]===upper){memo.set(key,best);return best;}
   }
   if(Date.now()<=deadline){const skipped=[...left];skipped[anchor]--;const tail=search(skipped);if(better(tail,best,s)>0)best=tail;}
   memo.set(key,best);return best;
  }
  const best=search(counts),available=prices.map(p=>small.filter(x=>x.cents===p));
  for(const pattern of best.chosen){const bin=[];pattern.counts.forEach((n,i)=>bin.push(...available[i].splice(0,n)));bins.push(bin);}
  const leftovers=available.flat();
  if(leftovers.length){
   if(s.leftoverStrategy==='fewerOrders'||!bins.length)bins.push(leftovers);
   else bins[0].push(...leftovers);
  }
 }
 const orders=bins.map((bin,index)=>{const lines=[...new Set(bin.map(x=>x.id))].map(id=>{const matching=bin.filter(x=>x.id===id);return {id,name:matching[0].name,unit:matching[0].unit,quantity:matching.length,unitCents:matching[0].cents};}),subtotal=bin.reduce((n,x)=>n+x.cents,0),fingerprint=createHash('sha256').update(JSON.stringify(lines.map(x=>[x.id,x.quantity,x.unitCents]).sort())).digest('hex').slice(0,20);return {id:fingerprint+'-'+(index+1),number:index+1,lines,subtotal,...rewards(subtotal,s),actualPaid:null,creditUsed:0};});
 const totalCents=orders.reduce((n,o)=>n+o.subtotal,0),giftCounts=s.tiers.map((_,i)=>orders.reduce((n,o)=>n+o.giftCounts[i],0));
 if(s.tiers.length===1&&giftCounts[0]===Math.floor(totalCents/s.tiers[0]))proven=true;
 return {settings:{...settings,tiers:s.tiers.map(v=>v/100),leftoverStrategy:s.leftoverStrategy},pool:structuredClone(pool),orders,totalCents,giftCounts,tier1:giftCounts[0]??0,tier2:giftCounts[1]??0,proven,createdAt:new Date().toISOString()};
}
