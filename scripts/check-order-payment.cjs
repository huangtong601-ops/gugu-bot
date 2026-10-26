// Isolated synthetic workspace; never touches real payments, QQ or model APIs.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let fixture,backend,win;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await fs.mkdir(path.join(root,'backups'),{recursive:true});fixture=await fs.mkdtemp(path.join(root,'backups','payment-ui-'));app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();await app.whenReady();
 const {start}=await import('../server.mjs'),{defaultCategories}=await import('../workflow.mjs'),{purchasePool,planOrders}=await import('../order-planning.mjs');
 const c={id:'payment-fixture',name:'实付交互验证',botId:'zhougu',groupId:'11111',revision:0,categories:defaultCategories(),products:[{id:'p',name:'测试立牌',type:'单领',categoryId:'单领',price:100,unit:'件'}],records:[{id:'r',skuId:'p',member:'测试用户',quantity:8}]};
 const pool=purchasePool(c),plan=planOrders(pool,{tiers:[50,100],rule:'once',rewardMode:'both'});c.orderPlanning={version:1,pool,settings:plan.settings,plan};
 await fs.writeFile(path.join(fixture,'workspace.json'),JSON.stringify({campaigns:[c],qqGroups:[{id:'11111',name:'模拟群'}],onboarding:{completedAt:'2026-10-24T00:00:00Z'},settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''}}));
 backend=await start({port:0,dataDir:fixture,upstreamFetch:async()=>{throw Error('No model calls allowed');}});
 win=new BrowserWindow({width:1400,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await pause(50);}throw Error('Timed out: '+code+' '+JSON.stringify(await js("({notice:document.getElementById('notice')?.textContent,button:window.payButton?.textContent,connected:window.payButton?.isConnected,buttons:[...document.querySelectorAll('.order-payment button')].map(b=>b.textContent)})")));};
 await win.loadURL(backend.url);await until("document.querySelectorAll('.order-payment').length===8");
 await js(`document.querySelector('[data-page=planning]').click();window.pay=document.querySelectorAll('.order-payment')[6];window.payInput=pay.querySelector('input');window.payButton=pay.querySelector('button');window.grid=document.querySelector('.order-grid');pay.scrollIntoView({block:'center'});`);
 await pause(150);
 assert.equal(await js('payInput.type'),'text');assert.equal(await js('payInput.inputMode'),'decimal');
 await js(`window.edit=value=>{payInput.value=value;payInput.dispatchEvent(new Event('input',{bubbles:true}));};edit('90.25');window.before={y:scrollY,top:pay.getBoundingClientRect().top,width:payButton.getBoundingClientRect().width};window.positions=[];window.track=true;requestAnimationFrame(function frame(){positions.push([scrollY,pay.getBoundingClientRect().top]);if(track)requestAnimationFrame(frame);});payButton.click();`);
 await until("payButton.textContent==='已保存'");await pause(100);
 assert.ok(await js('grid===document.querySelector(".order-grid")&&pay.isConnected&&payInput===pay.querySelector("input")'));
 assert.ok(await js('positions.every(([y,top])=>Math.abs(y-before.y)<1&&Math.abs(top-before.top)<1)'));
 assert.equal(await js('payButton.getBoundingClientRect().width-before.width'),0);
 assert.equal(await js('payButton.disabled'),true);
 // The periodic state refresh must keep the same cards and saved marker.
 await pause(5300);assert.ok(await js('pay.isConnected&&grid===document.querySelector(".order-grid")&&payButton.textContent==="已保存"'));
 await js(`edit('91.50');window.realFetch=fetch;window.failOnce=true;window.fetch=async(...args)=>{if(failOnce&&String(args[0]).includes('/api/order-payment')){failOnce=false;return new Response(JSON.stringify({error:'模拟保存失败'}),{status:400,headers:{'content-type':'application/json'}});}return realFetch(...args);};payButton.click();`);
 await until("document.getElementById('notice').textContent==='模拟保存失败'&&!payButton.disabled");assert.equal(await js('payInput.value'),'91.50');assert.equal(await js('payButton.textContent'),'保存实付');
 await js('payButton.click()');await until("payButton.textContent==='已保存'");
 // Edits made while a save is in flight remain unsaved instead of being erased.
 await js(`window.fetch=async(...args)=>{if(String(args[0]).includes('/api/order-payment'))await new Promise(r=>setTimeout(r,200));return realFetch(...args);};edit('92');payButton.click();edit('93');`);
 await until("payButton.textContent==='保存实付'&&!payButton.disabled");assert.equal(await js('payInput.value'),'93');
 await js('payButton.click()');await until("payButton.textContent==='已保存'");
 await js('window.track=false;window.fetch=realFetch;void 0;');
 const db=JSON.parse(await fs.readFile(path.join(fixture,'workspace.json'),'utf8'));assert.equal(db.campaigns[0].orderPlanning.plan.orders[6].actualPaid,93);
 // The unchanged configuration controls must still edit the active backing data.
 await js(`window.fetch=async(...args)=>{if(String(args[0]).includes('/api/order-plan')){window.proposedPlan=JSON.parse(args[1].body);return new Response(JSON.stringify({error:'模拟拦截规划'}),{status:400,headers:{'content-type':'application/json'}});}return realFetch(...args);};for(const [selector,value]of [['.purchase-pool input','2'],['.tier-fields input','40']]){const field=document.querySelector(selector);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('.order-config .actions button').click();`);
 await until('!!window.proposedPlan');assert.equal(await js('proposedPlan.pool[0].quantity'),2);assert.equal(await js('proposedPlan.settings.tiers[0]'),40);
 await win.reload();await until("document.querySelectorAll('.order-payment')[6]?.querySelector('button').textContent==='已保存'");
 assert.equal(await js("document.querySelectorAll('.order-payment')[6].querySelector('input').value"),'93');
 console.log('Payment UI passed: saved marker, fixed button width, unchanged card/scroll positions, polling, retry, in-flight edit preservation and reload persistence.');
}
async function finish(code,error){await fs.writeFile(path.join(root,'backups','payment-ui-result.json'),JSON.stringify({passed:code===0,at:new Date().toISOString(),error:error?.stack||''}));if(error)console.error(error.stack||error);win?.destroy();if(backend)await new Promise(r=>backend.server.close(r));if(fixture&&path.resolve(fixture).startsWith(path.join(root,'backups')+path.sep))await fs.rm(fixture,{recursive:true,force:true});app.exit(code);}
run().then(()=>finish(0)).catch(e=>finish(1,e));
