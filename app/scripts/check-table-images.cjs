// Isolated Chromium canvas render using synthetic orders; no QQ or model calls.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let output;
app.on('window-all-closed',()=>{});
const watchdog=setTimeout(()=>{console.error('Table images timed out');app.exit(2);},60000);
async function run(){
 output=await fs.mkdtemp(path.join(root,'backups','table-images-'));app.setPath('userData',path.join(output,'electron'));app.disableHardwareAcceleration();await app.whenReady();
 const {tableImagePages,personalBillPages,groupBillPages}=await import('../table-images.mjs');
 const {purchasePool,planOrders}=await import('../order-planning.mjs'),{purchaseSource}=await import('../campaign-lifecycle.mjs');
 const c={id:'c',name:'模拟联动排表',botId:'zhougu',categories:[{id:'s',name:'单领',kind:'single'},{id:'g',name:'通行证',kind:'group',sets:100},{id:'gift',name:'特典',kind:'single'}],products:[{id:'s',name:'海星体毛绒挂件-模拟角色（限定服饰VER.）',categoryId:'s',type:'单领',price:39},{id:'g',name:'通行证-模拟角色',character:'模拟角色',categoryId:'g',type:'通行证',price:50,averagePrice:30,adjustment:20,unit:'对'},{id:'gift',name:'特典第二档全角色纪念镭射明信片套组（限定联动特别款）',categoryId:'gift',type:'特典',giftTier:2,price:8}],records:[]};
 for(const [i,id]of ['s','g','gift'].entries())c.records.push({id:'r'+i,skuId:id,member:'模拟甲',qq:'12345',quantity:id==='g'?100:2,createdAt:'2026-01-01T00:00:00Z'});
 c.products.push({id:'unsafe',name:'明信片-<script>window.injected=true</script>',categoryId:'s',type:'单领',price:10});c.records.push({id:'unsafe',skuId:'unsafe',member:'模拟乙',quantity:1,identityMode:'cn'});
 c.bundleRules={g:{mode:'required',count:2}};
 const bill={...c,categories:[c.categories[0]],products:[c.products[0]],records:[c.records[0],{...c.records[0],id:'proxy',quantity:1,proxyFor:'模拟群外代排'}]};
 const pool=purchasePool(bill),plan=planOrders(pool,{tiers:[300],rule:'once',rewardMode:'both'});
 plan.orders[0].actualPaid=90;
 bill.orderPlanning={pool,plan,source:purchaseSource(bill)};
 bill.settlement={creditType:'none',giftRevenue:0};
 const finalPages=groupBillPages(bill,{});assert.ok(finalPages.every(page=>page.category==='全团肾表'));
 const pages=[...tableImagePages(c,{},['s','g','gift']),...personalBillPages(bill,{},'12345'),...finalPages],render=require('../table-image-renderer.cjs')({BrowserWindow});
 const images=await render(pages);assert.equal(images.length,pages.length);assert.ok(images.length>3);assert.equal(BrowserWindow.getAllWindows().length,0);
 for(let i=0;i<images.length;i++){const b=images[i];assert.equal(b.readUInt32BE(0),0x89504e47);assert.equal(b.readUInt32BE(16),pages[i].width);assert.equal(b.readUInt32BE(20),pages[i].height);await fs.writeFile(path.join(output,'page-'+(i+1)+'.png'),b);}
 const single=pages.findIndex(p=>p.category==='单领'),gift=pages.findIndex(p=>p.category==='特典'),group=pages.findIndex(p=>p.category==='通行证');
 const personal=pages.findIndex(p=>p.category==='个人肾表'),final=pages.findIndex(p=>p.category==='全团肾表');
 const report={passed:true,count:images.length,output,previews:{single:path.join(output,'page-'+(single+1)+'.png'),gift:path.join(output,'page-'+(gift+1)+'.png'),group:path.join(output,'page-'+(group+1)+'.png'),personal:path.join(output,'page-'+(personal+1)+'.png'),final:path.join(output,'page-'+(final+1)+'.png')}};
 await fs.writeFile(path.join(root,'backups','table-images-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
run().then(()=>{clearTimeout(watchdog);app.exit(0);}).catch(e=>{clearTimeout(watchdog);console.error(e.stack||e);app.exit(1);});
