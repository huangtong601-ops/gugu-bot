// Runs against an isolated synthetic workspace; never connects QQ or a model.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'backups'),{recursive:true});const fixture=fs.mkdtempSync(path.join(root,'backups','enrollment-ui-'));
app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();
let backend,win;const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await app.whenReady();const {start}=await import('../server.mjs');
 const roles=['予愿安洁莉娜','珊比','克莱门莎','嘉辛塔','时隙','旅骨','德·托莱多'];
 const c={id:'c',name:'示例期次',botId:'zhougu',groupId:'11111',revision:0,categories:[{id:'pass',name:'通行证',kind:'group',setsByBox:{'55.0':5}},{id:'solo',name:'单领',kind:'single'},{id:'gift',name:'特典',kind:'single'},{id:'custom',name:'自建人事部',kind:'group',pricingMode:'fixed',setsByBox:{'1.0':52}},{id:'empty',name:'自建空类',kind:'single'}],products:[
  ...roles.map((name,i)=>({id:'p'+i,name:'通行证-'+name,character:name,type:'通行证',categoryId:'pass',boxId:'55.0',averagePrice:20,adjustment:[40,15,20,-20,-20,-15,-20][i],price:[60,35,40,0,0,5,0][i],unit:'对'})),
  {id:'solo',name:'角色亚克力立牌-克莱门莎',type:'单领',categoryId:'solo',price:50,unit:'件'},
  {id:'gift1',name:'特典明信片',type:'特典',categoryId:'gift',giftTier:1,price:5},
  {id:'gift2',name:'特典CG明信片组',type:'特典',categoryId:'gift',giftTier:2,price:8},
  {id:'set',name:'特典SET',type:'特典',categoryId:'gift',giftTier:'set',giftComponents:['gift1','gift2'],price:10,unit:'套'},
  {id:'custom',name:'人事部简历-阿米娅',type:'单领',categoryId:'custom',boxId:'1.0',price:8}
 ],records:[]};
 const row=(id,skuId,member,qq,quantity,time)=>({id,skuId,member,qq,quantity,sourceAt:'2026-10-24T0'+time+':00:00Z'});
 c.records=[row('a','p0','示例用户I','12345',3,1),row('b','p0','示例用户K','54321',2,2),row('c','p1','示例用户K','54321',1,2),row('d','p2','示例用户I','12345',1,3),row('s','solo','示例用户I','12345',2,1),row('s2','solo','示例用户K','54321',1,3),row('g','gift1','示例用户I','12345',1,1),row('set','set','示例用户K','54321',2,2),row('g2','gift2','示例用户I','12345',1,3),row('custom','custom','示例用户I','12345',1,1)];
 const second={id:'second',name:'第二期',botId:'zhougu',groupId:'11111',categories:[{id:'second-only',name:'第二期专属',kind:'single'}],products:[],records:[]};
 await fsp.writeFile(path.join(fixture,'workspace.json'),JSON.stringify({settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:''},onboarding:{completedAt:'2026-10-24T00:00:00Z'},qqGroups:[{id:'11111',name:'测试群'}],campaigns:[c,second]}));
 backend=await start({port:0,dataDir:fixture,credentialStore:{get:async()=>''},upstreamFetch:async()=>{throw Error('UI view must not call a model');}});
 win=new BrowserWindow({width:1500,height:1040,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
 win.webContents.on('console-message',(_event,...details)=>console.log('Browser console:',...details));
 const js=code=>win.webContents.executeJavaScript(code,true);
 const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await pause(100);}console.log('Page status:',await js("({notice:document.getElementById('notice')?.textContent,campaigns:document.getElementById('campaign')?.innerText})"));throw Error('Timed out: '+code);};
 const choose=(id,value)=>js(`{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`);
 const capture=async name=>{await pause(150);await fsp.writeFile(path.join(root,'backups',name+'.png'),(await win.webContents.capturePage()).toPNG());};
 await win.loadURL(backend.url);await until("document.querySelector('#campaign option')?.value==='c'");await js("document.querySelector('[data-page=enrollment]').click()");
 await until("document.querySelectorAll('#recordCategory option').length===5&&document.querySelectorAll('.queue-grid').length===1");
 assert.deepEqual(await js("[...document.querySelectorAll('#recordCategory option')].map(o=>o.textContent)"),['通行证','单领','特典','自建人事部','自建空类']);
 assert.ok(await js("document.querySelector('#records').textContent.includes('+40.00')"));assert.ok(!(await js("document.querySelector('#records').textContent.includes('总计')")));await capture('enrollment-pass');
 assert.ok(await js("Boolean(document.querySelector('#refreshRecords').compareDocumentPosition(document.querySelector('#export'))&Node.DOCUMENT_POSITION_FOLLOWING)"));
 const savedState=await (await fetch(backend.url+'/api/state')).json(),saved=savedState.campaigns.find(c=>c.id==='c');saved.categories.find(c=>c.id==='pass').setsByBox['55.0']=7;
 const saveResponse=await fetch(backend.url+'/api/catalog',{method:'POST',headers:{origin:backend.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',botId:'zhougu',revision:saved.revision||0,products:saved.products,categories:saved.categories})});assert.equal(saveResponse.status,200,(await saveResponse.json()).error);
 await js("document.getElementById('refreshRecords').click()");await until("document.querySelector('.queue-capacity').textContent==='已开 7 配'&&document.getElementById('notice').textContent==='排表已刷新'");assert.equal(await js("document.querySelector('#recordCategory').value"),'pass');
 await js("document.querySelector('[data-page=workspace]').click();document.querySelector('#typeFilters [data-type=pass]').click();{const e=document.querySelector('input[aria-label=\"55.0开配数\"]');e.value='9';e.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('[data-page=enrollment]').click();document.getElementById('refreshRecords').click();");
 await until("document.getElementById('notice').textContent.includes('建档修改尚未保存')");assert.equal(await js("document.querySelector('.queue-capacity').textContent"),'已开 7 配');
 const unchanged=await (await fetch(backend.url+'/api/state')).json();assert.equal(unchanged.campaigns.find(c=>c.id==='c').categories.find(c=>c.id==='pass').setsByBox['55.0'],7);
 await js("document.querySelector('[data-page=workspace]').click()");assert.equal(await js("document.querySelector('input[aria-label=\"55.0开配数\"]').value"),'9');await js("document.getElementById('publish').click()");await until("document.getElementById('publish').textContent==='保存商品'");await js("document.querySelector('[data-page=enrollment]').click();document.getElementById('refreshRecords').click()");await until("document.querySelector('.queue-capacity').textContent==='已开 9 配'&&document.getElementById('notice').textContent==='排表已刷新'");
 await js("window.__viewRefreshCalls=0;{const original=window.fetch.bind(window);window.fetch=(input,options)=>{if(String(input).includes('/api/enrollment-view'))window.__viewRefreshCalls++;return original(input,options);};}document.getElementById('refreshRecords').click()");await until("document.getElementById('refreshRecords').disabled===false&&window.__viewRefreshCalls>0");
 const overState=await (await fetch(backend.url+'/api/state')).json(),over=overState.campaigns.find(c=>c.id==='c');over.categories.find(c=>c.id==='pass').setsByBox['55.0']=1;
 const overSave=await fetch(backend.url+'/api/catalog',{method:'POST',headers:{origin:backend.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',revision:over.revision,products:over.products,categories:over.categories})});assert.equal(overSave.status,200);
 await js("document.getElementById('refreshRecords').click()");await until("document.querySelector('.queue-overflow-note')?.textContent==='（超排4）'");assert.equal(await js("getComputedStyle(document.querySelector('.queue-overflow-note')).display"),'block');await capture('enrollment-overflow');
 await choose('recordCategory','gift');assert.equal(await js("document.querySelectorAll('.queue-grid thead th').length"),3);assert.equal(await js("document.querySelectorAll('.set-origin').length"),4);assert.ok(await js("document.querySelector('.gift-set-prices').textContent.includes('10.00')"));assert.equal(await js("document.querySelectorAll('.enrollment-details').length"),0);await capture('enrollment-gift');
 await choose('recordCategory','solo');assert.deepEqual(await js("[...document.querySelectorAll('.enrollment-detail-grid thead th')].map(t=>t.textContent)"),['cn','制品','原价']);assert.equal(await js("document.querySelectorAll('.enrollment-detail-grid tbody tr').length"),3);assert.equal(await js("document.querySelector('.person-cell').rowSpan"),2);await capture('enrollment-single');
 await choose('recordCategory','custom');assert.ok(await js("document.querySelector('.queue-prices').textContent.includes('实际价格')"));assert.equal(await js("document.querySelector('.queue-pagination span').textContent"),'1–50 / 52');await js("document.querySelector('.queue-pagination button:last-child').click()");assert.equal(await js("document.querySelector('.queue-pagination span').textContent"),'51–52 / 52');
 await pause(5300);assert.equal(await js("document.querySelector('#recordCategory').value"),'custom');assert.equal(await js("document.querySelector('.queue-pagination span').textContent"),'51–52 / 52');
 await choose('recordCategory','empty');assert.ok(await js("document.querySelector('#records').textContent.includes('还没有排表记录')"));
 await choose('campaign','second');await until("document.querySelector('#recordCategory')?.value==='second-only'");assert.ok(!(await js("document.querySelector('#records').textContent.includes('克莱门莎')")));await choose('campaign','c');await until("document.querySelectorAll('#recordCategory option').length===5");assert.equal(await js("document.querySelector('#recordCategory').value"),'empty');
 assert.ok(await js("document.documentElement.scrollWidth<=window.innerWidth"));
 await js("document.querySelector('#memberQQ').closest('details').open=true;document.getElementById('member').value='群外测试来宾';document.getElementById('member').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('message').value='克莱门莎立牌2';document.getElementById('message').dispatchEvent(new Event('input',{bubbles:true}));");
 assert.equal(await js("document.getElementById('memberQQ').value"),'');assert.equal(await js("document.getElementById('bindCN').disabled"),true);
 await js("document.getElementById('parse').click()");await until("document.getElementById('confirm').disabled===false");await js("document.getElementById('confirm').click()");await until("document.getElementById('notice').textContent==='报名已入表。'");
 const manualState=await(await fetch(backend.url+'/api/state')).json(),manualRecord=manualState.campaigns.find(c=>c.id==='c').records.find(r=>r.member==='群外测试来宾');assert.equal(manualRecord.quantity,2);assert.equal(manualRecord.qq,undefined);assert.equal(manualRecord.identityMode,'cn');assert.ok(!manualState.groupMembers||!Object.values(manualState.groupMembers).some(g=>Object.values(g).some(m=>m.cn==='群外测试来宾')));
 console.log('Enrollment UI passed: explicit refresh, saved capacity, preserved unpublished drafts, custom categories, SET positions, pagination and campaign isolation.');
}
run().then(()=>finish(0)).catch(e=>{console.error(e.stack);finish(1,e.stack);});
async function finish(code,error=''){try{fs.writeFileSync(path.join(root,'backups','enrollment-ui-result.json'),JSON.stringify({passed:code===0,error}));win?.destroy();if(backend)await new Promise(r=>backend.server.close(r));try{await fsp.rm(fixture,{recursive:true,force:true});}catch{}}finally{app.exit(code);}}
