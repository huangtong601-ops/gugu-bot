const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),fixture=fs.mkdtempSync(path.join(root,'backups','queue-order-ui-'));
app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();let backend,win;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await app.whenReady();const {start}=await import('../server.mjs');
 const c={id:'c',botId:'zhougu',groupId:'11111',name:'排序测试',revision:0,categories:[{id:'pass',name:'通行证',kind:'group',setsByBox:{'55.0':3}},{id:'gift',name:'特典',kind:'single'},{id:'solo',name:'单领',kind:'single'}],products:[
 {id:'a',name:'通行证-阿米娅',character:'阿米娅',type:'通行证',categoryId:'pass',boxId:'55.0',averagePrice:20,adjustment:0,price:20},
 {id:'b',name:'通行证-克莱门莎',character:'克莱门莎',type:'通行证',categoryId:'pass',boxId:'55.0',averagePrice:20,adjustment:0,price:20},
 {id:'g1',name:'一档特典',type:'特典',categoryId:'gift',giftTier:1,price:3},
 {id:'g2',name:'二档特典',type:'特典',categoryId:'gift',giftTier:2,price:5},
 {id:'set',name:'特典SET',type:'特典',categoryId:'gift',giftTier:'set',giftComponents:['g1','g2'],price:7},
 {id:'solo',name:'徽章-阿米娅',type:'单领',categoryId:'solo',price:20}
 ],records:[]};
 const add=(id,skuId,member,quantity,hour)=>c.records.push({id,skuId,member,quantity,createdAt:`2026-10-25T0${hour}:00:00Z`});
 add('a1','a','测试甲',2,1);add('a2','a','测试乙',1,2);add('b1','b','测试乙',1,1);add('b2','b','测试甲',1,2);add('g','g1','测试甲',1,1);add('set','set','测试乙',1,2);add('solo1','solo','测试甲',2,1);add('solo2','solo','测试乙',1,2);
 await fsp.writeFile(path.join(fixture,'workspace.json'),JSON.stringify({settings:{provider:'openai',baseUrl:'https://api.openai.com/v1',model:''},onboarding:{completedAt:'2026-10-24T00:00:00Z'},qqGroups:[{id:'11111',name:'隔离测试群'}],campaigns:[c]}));
 backend=await start({port:0,dataDir:fixture,credentialStore:{get:async()=>''},upstreamFetch:async()=>{throw Error('No model calls in queue editor');}});
 win=new BrowserWindow({width:1500,height:1100,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
 const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await pause(100);}throw Error('Timed out '+code+' '+await js("document.getElementById('recordStatus').textContent"));};
 const choose=(id,value)=>js(`{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'));}`);
 const view=async()=>{const r=await fetch(backend.url+'/api/enrollment-view',{method:'POST',headers:{origin:backend.url,'content-type':'application/json'},body:JSON.stringify({campaignId:'c'})});return r.json();};
 await win.loadURL(backend.url);await until("document.querySelector('#campaign option')?.value==='c'");await js("document.querySelector('[data-page=enrollment]').click()");await until("document.querySelector('.queue-grid')&&document.querySelector('.queue-order-toggle')");
 const before=await view();assert.equal(await js("document.querySelectorAll('.queue-move').length"),0);
 await js("document.querySelector('.queue-order-toggle').click()");assert.equal(await js("document.querySelector('.queue-order-toggle').textContent"),'完成调整');assert.equal(await js("document.querySelector('button[aria-label=\"上移 测试甲 · 阿米娅 · 第1位\"]').disabled"),true);
 await js("document.querySelector('button[aria-label=\"上移 测试乙 · 阿米娅 · 第3位\"]').click()");await until("document.getElementById('recordStatus').textContent.includes('已上移并保存')&&document.querySelector('button[aria-label=\"上移 测试乙 · 阿米娅 · 第2位\"]')?.disabled===false");
 let after=await view();assert.deepEqual(after.categories[0].queues[0].columns[0].queue.map(e=>e.cn),['测试甲','测试乙','测试甲']);assert.deepEqual(after.categories.slice(1),before.categories.slice(1));assert.deepEqual(after.categories[0].queues[0].columns[1],before.categories[0].queues[0].columns[1]);
 await js("document.getElementById('refreshRecords').click()");await until("document.querySelector('button[aria-label=\"上移 测试乙 · 阿米娅 · 第2位\"]')");assert.equal(await js("document.querySelector('.queue-order-toggle').getAttribute('aria-pressed')"),'true');
 await choose('recordCategory','gift');await js("document.querySelector('button[aria-label=\"上移 测试乙 · 一档 · 一档特典 · 第2位\"]').click()");await until("document.getElementById('recordStatus').textContent.includes('已上移并保存')&&document.querySelector('button[aria-label=\"下移 测试乙 · 一档 · 一档特典 · 第1位\"]')?.disabled===false");
 after=await view();assert.deepEqual(after.categories[1].queues[0].columns[0].queue.map(e=>e.cn),['测试乙','测试甲']);assert.deepEqual(after.categories[1].queues[0].columns[1],before.categories[1].queues[0].columns[1]);assert.deepEqual(after.categories[0].queues[0].columns[0].queue.map(e=>e.cn),['测试甲','测试乙','测试甲']);
 await choose('recordCategory','solo');assert.equal(await js("document.querySelector('.queue-order-toggle').hidden"),true);assert.equal(await js("document.querySelectorAll('.queue-move').length"),0);assert.equal(await js("document.querySelector('.person-cell').textContent"),'测试甲');
 await choose('recordCategory','pass');await js("document.querySelector('button[aria-label=\"恢复 阿米娅 的评论时间顺序\"]').click()");await until("document.getElementById('recordStatus').textContent.includes('已恢复评论时间顺序')&&document.querySelector('button[aria-label=\"恢复 阿米娅 的评论时间顺序\"]')?.disabled===true");after=await view();assert.deepEqual(after.categories[0].queues[0].columns[0].queue.map(e=>e.cn),['测试甲','测试甲','测试乙']);assert.deepEqual(after.categories[1].queues[0].columns[0].queue.map(e=>e.cn),['测试乙','测试甲']);
 await choose('recordCategory','gift');await fsp.writeFile(path.join(root,'backups','queue-order-editor.png'),(await win.webContents.capturePage()).toPNG());
 await js("document.querySelector('.queue-order-toggle').click()");assert.equal(await js("document.querySelectorAll('.queue-move').length"),0);
 const state=await(await fetch(backend.url+'/api/state')).json();assert.deepEqual(state.campaigns[0].records,c.records);assert.equal(state.campaigns[0].revision,0);
 console.log('Queue order UI passed: per-category/per-column moves, immediate persistence, reset, SET isolation, refresh retention and unchanged single orders.');
}
run().then(()=>finish(0)).catch(e=>{console.error(e.stack);finish(1,e.stack);});
async function finish(code,error=''){try{fs.writeFileSync(path.join(root,'backups','queue-order-ui-result.json'),JSON.stringify({passed:code===0,error}));win?.destroy();if(backend)await new Promise(r=>backend.server.close(r));await fsp.rm(fixture,{recursive:true,force:true});}finally{app.exit(code);}}
