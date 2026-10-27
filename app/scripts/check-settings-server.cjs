// Isolated desktop/server verification. Synthetic data only, no QQ or model service.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),fixture=fs.mkdtempSync(path.join(root,'backups','settings-server-ui-'));
app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();
let local,remote,gateway,win;const token='synthetic-settings-ui-token-1234567890';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const vault=()=>{const values=new Map();return {get:async c=>values.get(c.provider+'|'+c.baseUrl)||'',set:async(c,v)=>values.set(c.provider+'|'+c.baseUrl,v)};};
async function run(){
 await app.whenReady();const {start}=await import('../server.mjs'),{startServerGateway}=await import('../server-gateway.mjs');
 for(const [name,campaignName]of [['local','本机测试期次'],['remote','服务器测试期次']]){const dir=path.join(fixture,name);await fsp.mkdir(dir);await fsp.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[{id:name,name:campaignName,botId:'zhougu',products:[],records:[]}],settings:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:''},onboarding:{completedAt:'2026-10-25T00:00:00Z'}}));}
 remote=await start({port:0,dataDir:path.join(fixture,'remote'),credentialStore:vault(),allowServerConnection:false});
 gateway=await startServerGateway({port:0,backendUrl:remote.url,token,serverId:randomUUID(),name:'隔离测试服务器'});
 // Keep this fixture outside Chromium's blocked service-port list.
 local=await start({port:49152+Math.floor(Math.random()*16000),dataDir:path.join(fixture,'local'),credentialStore:vault()});
 win=new BrowserWindow({width:1320,height:1000,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
 const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{for(let i=0;i<140;i++){try{if(await js(code))return;}catch{}await pause(80);}throw Error('Timed out: '+code);};
 const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`),input=(id,value)=>js(`{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));}`),tab=id=>js(`document.querySelector('[data-settings-tab=${id}]').click()`);
 const shot=async name=>{await pause(100);await fsp.writeFile(path.join(root,'backups','settings-'+name+'.png'),(await win.webContents.capturePage()).toPNG());};
 await win.loadURL(local.url);await until("document.getElementById('campaign').value==='local'");await js("document.querySelector('[data-page=settings]').click()");
 assert.equal(await js("document.querySelectorAll('[data-settings-tab]').length"),6);
 assert.equal(await js("!document.getElementById('settings-pane-model').hidden&&document.getElementById('settings-pane-qq').hidden"),true);await shot('model');
 await tab('business');assert.equal(await js("document.getElementById('albumWithdrawalEnabled').checked"),false);await click('albumWithdrawalEnabled');await until("!document.getElementById('albumWithdrawalEnabled').disabled&&document.getElementById('albumWithdrawalEnabled').checked");assert.equal(JSON.parse(await fsp.readFile(path.join(fixture,'local','workspace.json'),'utf8')).albumWithdrawalEnabled,true);await shot('withdrawal');await click('albumWithdrawalEnabled');await until("!document.getElementById('albumWithdrawalEnabled').disabled&&!document.getElementById('albumWithdrawalEnabled').checked");
 await tab('qq');assert.equal(await js("document.getElementById('qqRuntimePicker').hidden"),false);assert.equal(await js("document.getElementById('qqAccountPassword').type"),'password');
 await tab('skills');assert.equal(await js("document.getElementById('glossaryReview').hidden"),true);
 await tab('server');assert.equal(await js("document.getElementById('serverMode').value"),'local');assert.equal(await js("document.getElementById('serverRemoteFields').hidden"),true);assert.equal(await js("document.getElementById('workspaceLocation').closest('button').id"),'runtimeStatus');await shot('server-local');
 const localFile=path.join(fixture,'local','workspace.json'),digest=()=>createHash('sha256').update(fs.readFileSync(localFile)).digest('hex');const before=digest();
 await js("{const e=document.getElementById('serverMode');e.value='remote';e.dispatchEvent(new Event('change'));}");
 await input('serverAddress',gateway.url);await input('serverAccessToken','invalid');await click('serverTest');await until("document.getElementById('serverConnectionStatus').textContent.includes('访问令牌')&&!document.getElementById('serverTest').disabled");
 assert.equal(await js("document.getElementById('workspaceLocation').textContent.trim()"),'本地工作区');
 await input('serverAccessToken',token);await click('serverTest');await until("document.getElementById('serverConnectionStatus').textContent.includes('连接成功')&&!document.getElementById('serverTest').disabled");await shot('server-tested');
 assert.equal(await js("document.getElementById('campaign').value"),'local');assert.equal(digest(),before);
 await js("document.querySelector('[data-page=workspace]').click();document.getElementById('addProduct').click();");await until("document.getElementById('publish').textContent.includes('*')");await js("document.querySelector('[data-page=settings]').click()");await tab('server');await js("document.getElementById('serverConnectionForm').requestSubmit()");await until("document.getElementById('serverConnectionStatus').textContent.includes('请先保存')&&!document.getElementById('serverSave').disabled");assert.equal(await js("document.getElementById('workspaceLocation').textContent.trim()"),'本地工作区');
 // Discard only this synthetic unsaved card to continue the integration scenario.
 await win.reload();await until("document.getElementById('campaign').value==='local'");await js("document.querySelector('[data-page=settings]').click()");await tab('server');await js("{const e=document.getElementById('serverMode');e.value='remote';e.dispatchEvent(new Event('change'));}");await input('serverAddress',gateway.url);await input('serverAccessToken',token);
 await js("document.getElementById('serverConnectionForm').requestSubmit()");await until("document.getElementById('workspaceLocation')?.textContent.includes('服务器')&&document.getElementById('campaign').value==='remote'");
 assert.equal(await js("document.getElementById('setupGuide').open"),false);assert.equal(await js("document.getElementById('serverAccessToken').value"),'');assert.equal(await js(`document.body.textContent.includes(${JSON.stringify(token)})`),false);assert.equal(digest(),before);
 await js("document.querySelector('[data-page=settings]').click()");await tab('qq');assert.equal(await js("document.getElementById('qqRuntimePicker').hidden&&document.getElementById('qqAccountForm').hidden&&document.getElementById('qqPrepare').hidden"),true);await click('qqAdminAdd');await input('qqAdminAccount','123456');await js("document.getElementById('qqAdminForm').requestSubmit()");await until("document.getElementById('qqAdminStatus').textContent==='已保存'");assert.equal(JSON.parse(await fsp.readFile(path.join(fixture,'remote','workspace.json'),'utf8')).qqAdmin,'123456');assert.equal(digest(),before);await shot('server-qq');
 await tab('server');await shot('server-connected');
 await new Promise(r=>gateway.server.close(r));gateway=null;await win.reload();await until("document.getElementById('settings')?.hidden===false&&document.getElementById('settings-pane-server')?.hidden===false&&document.getElementById('notice').textContent.includes('无法连接')");assert.equal(await js("document.getElementById('serverMode').value"),'remote');assert.equal(digest(),before);
 await js("{const e=document.getElementById('serverMode');e.value='local';e.dispatchEvent(new Event('change'));document.getElementById('serverConnectionForm').requestSubmit();}");await until("document.getElementById('workspaceLocation')?.textContent.includes('本地')&&document.getElementById('campaign').value==='local'");assert.equal(digest(),before);
 await js("document.querySelector('[data-page=settings]').click()");await tab('qq');assert.equal(await js("document.getElementById('qqRuntimePicker').hidden||document.getElementById('qqAccountForm').hidden"),false);
 await tab('server');await win.setSize(960,800);await pause(200);await shot('server-compact');
 assert.equal(await js("document.getElementById('settings').scrollWidth<=document.getElementById('settings').clientWidth+1"),true);
 await fsp.writeFile(path.join(root,'backups','settings-server-ui-result.json'),JSON.stringify({passed:true,error:''}));
}
run().catch(async e=>{await fsp.writeFile(path.join(root,'backups','settings-server-ui-result.json'),JSON.stringify({passed:false,error:e.message}));process.exitCode=1;}).finally(async()=>{if(win&&!win.isDestroyed())win.destroy();for(const service of [local,gateway,remote])if(service)await new Promise(r=>service.server.close(r));app.exit(process.exitCode||0);});
