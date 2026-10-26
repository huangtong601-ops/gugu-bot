// Synthetic end-to-end settlement and catalog checks; no real QQ, API or business data.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let fixture,backend,win;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await fs.mkdir(path.join(root,'backups'),{recursive:true});fixture=await fs.mkdtemp(path.join(root,'backups','average-ui-'));app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();await app.whenReady();
 const {start}=await import('../server.mjs'),{purchasePool,planOrders}=await import('../order-planning.mjs');
 const c={id:'c',name:'均价模拟',botId:'zhougu',groupId:'11111',revision:0,categories:[{id:'g',name:'通行证',kind:'group',pricingMode:'adjustment',setsByBox:{'55.0':1},boxPrices:{'55.0':350},averageModesByBox:{'55.0':'auto'}}],products:Array.from({length:7},(_,i)=>({id:'p'+i,name:'通行证-角色'+i,character:'角色'+i,type:'通行证',categoryId:'g',boxId:'55.0',unit:'对',price:null,averagePrice:null,adjustment:i===0?5:0})),records:[{id:'r0',skuId:'p0',member:'模拟用户',quantity:1},{id:'r1',skuId:'p1',member:'模拟用户',quantity:1}]};
 const pool=purchasePool(c),plan=planOrders(pool,{tiers:[100,300],rewardMode:'both',rule:'once'});plan.orders[0].actualPaid=350;c.orderPlanning={version:1,pool,settings:plan.settings,plan};c.settlement={version:1,creditType:'600-620',giftRevenue:0,groupPricing:{'g|55.0':'auto'}};
 await fs.writeFile(path.join(fixture,'workspace.json'),JSON.stringify({campaigns:[c],qqGroups:[{id:'11111',name:'模拟群'}],onboarding:{completedAt:'2026-10-24T00:00:00Z'},settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''}}));
 backend=await start({port:0,dataDir:fixture,upstreamFetch:async()=>{throw Error('No model calls allowed');}});win=new BrowserWindow({width:1400,height:1000,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await pause(50);}throw Error('Timed out: '+code+'; '+await js("document.getElementById('notice').textContent"));};
 await win.loadURL(backend.url);await until("document.querySelector('.settlement-config>button')");
 let state=await (await fetch(backend.url+'/api/state')).json();assert.equal(state.campaigns[0].products[0].averagePrice,null);
 await js("document.querySelector('[data-page=settlement]').click();document.querySelector('.settlement-config>button').click();");await until("document.getElementById('notice').textContent==='已完成'");
 state=await (await fetch(backend.url+'/api/state')).json();assert.ok(state.campaigns[0].products.every(p=>p.averagePrice===48.39));assert.equal(state.campaigns[0].products[0].price,53.39);
 await js("document.querySelector('[data-page=workspace]').click();document.querySelector('[data-type=g]').click();");await until("document.querySelector('#passPricing select[aria-label*=填写方式]')?.value==='later'");
 assert.equal(await js("document.querySelector('#passPricing input[aria-label*=统一均价]').value"),'48.39');assert.equal(await js("document.querySelector('#passPricing input[aria-label*=统一均价]').disabled"),true);
 await js("document.getElementById('publish').click()");await until("document.getElementById('notice').textContent.startsWith('商品已保存')");await win.reload();await until("document.querySelector('[data-type=g]')");
 await js("document.querySelector('[data-type=g]').click()");assert.equal(await js("document.querySelector('#passPricing select[aria-label*=填写方式]').value"),'later');
 const edit=await fetch(backend.url+'/api/order-payment',{method:'POST',headers:{origin:backend.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',version:1,orderId:plan.orders[0].id,actualPaid:200})});assert.equal(edit.status,200);
 await js("document.querySelector('[data-page=settlement]').click();document.querySelector('.settlement-config>button').click()");await until("document.getElementById('notice').textContent==='已完成'");
 state=await (await fetch(backend.url+'/api/state')).json();assert.equal(state.campaigns[0].products[0].averagePrice,27.65);
 console.log('Automatic average UI passed: calculation-stage import, pair price, catalog refresh, saved automatic mode, reload and recalculation.');
}
async function finish(code,error){await fs.writeFile(path.join(root,'backups','average-ui-result.json'),JSON.stringify({passed:code===0,error:error?.stack||''}));win?.destroy();if(backend)await new Promise(r=>backend.server.close(r));if(fixture&&path.resolve(fixture).startsWith(path.join(root,'backups')+path.sep))await fs.rm(fixture,{recursive:true,force:true});app.exit(code);}
run().then(()=>finish(0)).catch(e=>finish(1,e));
