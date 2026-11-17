// Synthetic pending comments only. No real QQ/model connections or user data.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));let backend,win;
const watchdog=setTimeout(()=>{console.error('Pending-review UI timeout');app.exit(2);},30000);
async function run(){
 const fixture=await fs.mkdtemp(path.join(root,'backups','pending-review-ui-'));app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();await app.whenReady();
 const {start}=await import('../server.mjs'),{applyAlbumComments}=await import('../album-sync.mjs');
 const products=[...Array.from({length:20},(_,i)=>({id:i===19?'stand':'k'+i,name:(i===19?'亚克力立牌':'制品'+i)+'-凯尔希',character:'凯尔希',type:'单领',categoryId:'s',price:10,unit:'件'})),{id:'paper',name:'亚克力色纸',type:'单领',categoryId:'s',price:15,unit:'张'}];
 const c={id:'c',name:'待核对隔离验证',botId:'zhougu',groupId:'11111',revision:0,categories:[{id:'s',name:'单领',kind:'single'}],products,records:[]},binding={groupId:'11111',albumId:'a',campaignId:'c',photoScopes:{p:{categoryId:'s'}}},db={settings:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:''},onboarding:{completedAt:'2026-10-28T00:00:00Z'},members:{12345:{cn:'模拟甲'}},qqGroups:[{id:'11111',name:'模拟群'}],campaigns:[c],albums:[binding]};
 const event=(id,text)=>({id,commentId:id,qq:'12345',groupId:'11111',albumId:'a',photoIds:['p'],at:'2026-10-28T01:00:00Z',text});
 applyAlbumComments(db,binding,{photos:[{id:'p'}],comments:[event('one','未知甲1 凯尔希1 色纸2 未知乙1'),event('two','凯尔希1 凯尔希1')]});
 await fs.writeFile(path.join(fixture,'workspace.json'),JSON.stringify(db));backend=await start({port:0,dataDir:fixture,credentialStore:{get:async()=>''}});
 win=new BrowserWindow({width:1450,height:1100,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{for(const end=Date.now()+12000;Date.now()<end;){if(await js(code))return;await pause(50);}throw Error('Timed out: '+code);},snapshot=async()=>await(await fetch(backend.url+'/api/state')).json();
 await win.loadURL(backend.url);await until("document.getElementById('campaign').value==='c'");await js("document.querySelector('[data-page=enrollment]').click()");await until("document.querySelectorAll('.pending-card').length===2");
 await js("window.first=()=>document.querySelector('.pending-card');window.rowFor=phrase=>[...first().querySelectorAll('.pending-issue')].find(r=>r.querySelector('.issue-phrase').textContent===phrase);window.editQty=(row,value)=>{const e=row.querySelector('.issue-qty');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};window.pick=(row,id)=>{const e=row.querySelector('.issue-select');e.value=id;e.dispatchEvent(new Event('change',{bubbles:true}));};void 0;");
 assert.equal(await js("rowFor('凯尔希').querySelector('select').querySelector('option[value=stand]').parentElement.tagName"),'SELECT');
 await js("pick(rowFor('凯尔希'),'stand');editQty(rowFor('凯尔希'),'0');pick(rowFor('未知乙'),'k0');editQty(rowFor('未知乙'),'4');editQty(first().querySelector('.pending-preview-entry'),'5');rowFor('未知甲').querySelector('summary').click();rowFor('未知甲').querySelector('.recognized-delete').click();");
 await until("document.querySelectorAll('.pending-card:first-child .pending-issue').length===2");
 assert.equal(await js("rowFor('凯尔希').querySelector('select').value"),'stand');assert.equal(await js("rowFor('凯尔希').querySelector('.issue-qty').value"),'0');assert.equal(await js("rowFor('未知乙').querySelector('select').value"),'k0');assert.equal(await js("rowFor('未知乙').querySelector('.issue-qty').value"),'4');assert.equal(await js("first().querySelector('.pending-preview-entry .issue-qty').value"),'5');
 await js("[...first().querySelectorAll('button')].find(b=>b.textContent==='保存并重试').click()");await until("document.getElementById('notice').textContent.includes('1至999')");assert.equal((await snapshot()).campaigns[0].records.length,0);
 await js("editQty(rowFor('凯尔希'),'3');[...first().querySelectorAll('button')].find(b=>b.textContent==='保存并重试').click()");await until("document.querySelectorAll('.pending-card').length===1");
 let saved=(await snapshot()).campaigns[0].records;assert.deepEqual(saved.map(r=>[r.skuId,r.quantity]),[['stand',3],['paper',5],['k0',4]]);
 await js("{const rows=first().querySelectorAll('.pending-issue');pick(rows[0],'stand');editQty(rows[0],'7');pick(rows[1],'k0');editQty(rows[1],'2');}[...first().querySelectorAll('button')].find(b=>b.textContent==='保存并重试').click()");await until("document.querySelectorAll('.pending-card').length===0");saved=(await snapshot()).campaigns[0].records;assert.deepEqual(saved.slice(3).map(r=>[r.skuId,r.quantity]),[['stand',7],['k0',2]]);
 console.log('PASS: complete preferred candidates, deletion preserves selections/raw quantities, editable previews, invalid-quantity guard, repeated phrase edits');
}
async function finish(code,error){clearTimeout(watchdog);if(error)console.error(error.stack||error);win?.destroy();try{await backend?.shutdown();}finally{app.exit(code);}}
run().then(()=>finish(0)).catch(e=>finish(1,e));
