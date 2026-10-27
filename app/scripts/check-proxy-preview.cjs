// Isolated synthetic UI fixture: no model calls, no real QQ connection or live workspace changes.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let fixture,backend,win;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await fs.mkdir(path.join(root,'backups'),{recursive:true});fixture=await fs.mkdtemp(path.join(root,'backups','proxy-ui-'));app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();console.log('Fixture prepared');await app.whenReady();console.log('Electron ready');
 const {start}=await import('../server.mjs'),{addComment,defaultCategories}=await import('../workflow.mjs'),{purchasePool,planOrders}=await import('../order-planning.mjs');
 const c={id:'mock',name:'代排预览验证',botId:'zhougu',groupId:'11111',revision:0,categories:defaultCategories(),products:[
  {id:'a',name:'通行证-予愿安洁莉娜',type:'通行证',character:'予愿安洁莉娜',boxId:'55.0',price:10,unit:'对'},
  {id:'b',name:'通行证-克莱门莎',type:'通行证',character:'克莱门莎',boxId:'55.0',price:20,unit:'对'},
  {id:'s',name:'双闪徽章-酒神（真我自扼）',type:'单领',price:5,unit:'件'}],records:[]};
 c.categories.find(x=>x.id==='通行证').sets=3;c.categories.find(x=>x.id==='通行证').boxPrices={'55.0':30};
 const db={campaigns:[c],members:{12345:{cn:'示例用户J'},54321:{cn:'示例用户L'}},qqGroups:[{id:'11111',name:'模拟群'}],onboarding:{completedAt:'2026-10-24T00:00:00Z'},settings:{provider:'custom',baseUrl:'https://example.test/v1',model:''}};
 const comments=[['代群外小明 洁哥通行证2 酒神皮肤吧唧1','12345'],['洁哥通行证1','54321'],['代群外小红 洁哥通行证1','12345'],['洁哥通行证1 酒神皮肤吧唧1','12345'],['代群外小明 洁哥通行证1','12345']];
 for(const [i,[text,qq]] of comments.entries())addComment(db,c,{id:String(i+1),qq,at:`2026-10-24T00:00:0${i+1}Z`,text});
 const pool=purchasePool(c),plan=planOrders(pool,{tiers:[10,20],rule:'once',rewardMode:'both'});for(const o of plan.orders)o.actualPaid=o.subtotal/100;
 c.orderPlanning={version:1,pool,plan};c.settlement={version:1,creditType:'600-620',giftRevenue:0,groupPricing:{}};
 await fs.writeFile(path.join(fixture,'workspace.json'),JSON.stringify(db));backend=await start({port:0,dataDir:fixture});console.log('Synthetic backend ready');
 win=new BrowserWindow({width:1240,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 const js=code=>Promise.race([win.webContents.executeJavaScript(code,true),wait(5000).then(()=>{throw Error('Renderer timeout: '+code);})]);
 await win.loadURL(backend.url);console.log('Preview page loaded');
 for(let i=0;i<100;i++){if(await js("document.querySelectorAll('.settlement-preview tr').length===7"))break;if(i===99)throw Error('Preview unavailable: '+await js("document.getElementById('notice').textContent"));await wait(100);}console.log('Preview rows ready');
 await js("document.querySelector('[data-page=settlement]').click();document.querySelector('.settlement-preview').scrollIntoView({block:'start'})");
 const rows=await js("[...document.querySelectorAll('.settlement-preview tr')].map(r=>[...r.cells].map(c=>({text:c.textContent,span:c.rowSpan})))");
 assert.equal(rows.length,7);
 const identities=rows.slice(1).filter(r=>r.length===3).map(r=>[r[0].text,r[0].span,r[2].text,r[2].span]);
 assert.deepEqual(identities,[['示例用户J',2,'¥14.84',2],['示例用户J 代 小明',2,'¥34.84',2],['示例用户J 代 小红',1,'¥10.00',1],['示例用户L',1,'¥10.00',1]]);
 assert.equal(rows[3][1].text,'通行证-予愿安洁莉娜 ×3对');
 assert.equal(await js("document.querySelector('.settlement-preview button').disabled"),false);
 const alignment=await js("[...document.querySelectorAll('.settlement-product')].map(c=>({align:getComputedStyle(c).textAlign,x:c.getBoundingClientRect().x}))");assert.equal(alignment.length,6);assert.ok(alignment.every(c=>c.align==='left'&&Math.abs(c.x-alignment[0].x)<1));
 console.log('Proxy UI passed: separate recipient labels, amounts, row spans, adjacency and export availability.');
}
async function finish(code,error=''){await fs.writeFile(path.join(root,'backups','proxy-preview-result.json'),JSON.stringify({passed:code===0,error}));win?.destroy();if(backend)await new Promise(r=>backend.server.close(r));try{if(fixture)await fs.rm(fixture,{recursive:true,force:true});}catch{}app.exit(code);}
run().then(()=>finish(0)).catch(e=>{console.error(e.stack);finish(1,e.stack);});
