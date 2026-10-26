// Synthetic QQ gateway state only; never uses the user's QQ environment.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),fixture=fs.mkdtempSync(path.join(root,'backups','qq-overview-ui-'));
app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();let backend,win,online=true,transport=true,checks=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await app.whenReady();const {start}=await import('../server.mjs');
 await fsp.writeFile(path.join(fixture,'workspace.json'),JSON.stringify({qqAdmin:'123456',qqSettings:{url:'ws://127.0.0.1:12345'},campaigns:[],settings:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:''},onboarding:{completedAt:'2026-10-25T00:00:00Z'}}));
 backend=await start({port:49152+Math.floor(Math.random()*16000),dataDir:fixture,credentialStore:{get:async()=>'',set:async()=>{}},qqConnector:()=>({status:()=>transport?'已连接':'已断开',close(){},async call(action){if(action==='get_login_info'){checks++;return {user_id:654321,nickname:'隔离测试机器人'};}if(action==='get_status')return {online};if(action==='get_group_list')return [];throw Error('Unexpected QQ action '+action);}})});
 win=new BrowserWindow({width:1240,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{for(let i=0;i<110;i++){if(await js(code))return;await pause(100);}throw Error('Timed out: '+code);},click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
 const visible=id=>js(`{const e=document.getElementById(${JSON.stringify(id)});e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true});}`);
 const showQQ=async()=>{await js("document.querySelector('[data-page=settings]').click();document.querySelector('[data-settings-tab=qq]').click();");};
 const shot=async name=>{await pause(80);await fsp.writeFile(path.join(root,'backups','qq-overview-'+name+'.png'),(await win.webContents.capturePage()).toPNG());};
 await win.loadURL(backend.url);await until("document.querySelector('.admin-qq')?.textContent==='123456'");await showQQ();await until("document.getElementById('qqConnectionBadge').textContent==='在线'");
 assert.equal(await js("document.getElementById('qqConnectedAccount').textContent"),'QQ 654321');assert.equal(await js("document.getElementById('qqConnectedNickname').textContent"),'隔离测试机器人');assert.equal(await js("document.getElementById('qqConnectionDetails').open"),false);
 for(const id of ['qqPrepare','qqLoginWindow','qqAccount','qqAccountPassword','qqQuickLogin','qqCheckLogin','qqAutoConnect','qqRuntimePicker'])assert.equal(await visible(id),false,id+' should be collapsed');await shot('connected');
 await click('qqConnectionToggle');await until("document.getElementById('qqConnectionDetails').open");assert.equal(await visible('qqQuickLogin'),true);assert.equal(await visible('qqAccountPassword'),true);await shot('expanded');
 // Automatic state refresh must not close an explicitly expanded editor or reset input.
 await js("{const e=document.getElementById('qqAccount');e.value='234567';e.dispatchEvent(new Event('input'));}");await pause(5200);assert.equal(await js("document.getElementById('qqConnectionDetails').open"),true);assert.equal(await js("document.getElementById('qqAccount').value"),'234567');
 await click('qqConnectionToggle');assert.equal(await js("document.getElementById('qqConnectionDetails').open"),false);
 online=false;await js("document.querySelector('[data-settings-tab=model]').click();document.querySelector('[data-settings-tab=qq]').click();");await until("document.getElementById('qqConnectionBadge').textContent==='QQ 未登录'");assert.equal(await js("document.getElementById('qqConnectionDetails').open"),false);await shot('logged-out');
 transport=false;await win.reload();await until("document.querySelector('.admin-qq')?.textContent==='123456'");await showQQ();await until("document.getElementById('qqConnectionBadge').textContent==='连接已断开'");assert.equal(await js("document.getElementById('qqConnectionDetails').open"),false);await shot('disconnected');
 // Reopening the setup guide must expose the original forms even for a configured bot.
 await click('openSetupGuide');await until("document.getElementById('setupGuide').open");assert.equal(await js("document.getElementById('qqConnectionDetails').open"),true);assert.equal(await js("document.getElementById('qqConnectionOverview').hidden"),true);await click('setupClose');await until("!document.getElementById('setupGuide').open&&!document.getElementById('qqConnectionDetails').open");
 assert.ok(checks>=2);await fsp.writeFile(path.join(root,'backups','qq-overview-ui-result.json'),JSON.stringify({passed:true,error:''}));
}
run().catch(async e=>{process.exitCode=1;await fsp.writeFile(path.join(root,'backups','qq-overview-ui-result.json'),JSON.stringify({passed:false,error:e.stack||e.message}));}).finally(async()=>{win?.destroy();if(backend)await new Promise(r=>backend.server.close(r));app.exit(process.exitCode||0);});
