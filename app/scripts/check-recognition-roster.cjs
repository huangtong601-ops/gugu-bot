// Synthetic two-campaign catalogue only; no live data, QQ or model calls.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let backend,win;
const watchdog=setTimeout(()=>app.exit(2),30000),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const fixture=await fs.mkdtemp(path.join(root,'backups','recognition-roster-ui-'));app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();await app.whenReady();
 const campaign=id=>({id,name:'模拟'+id,botId:'zhougu',groupId:'',revision:0,categories:[{id:'s',name:'单领',kind:'single'}],products:[{id:id+'p',name:'明信片',type:'单领',categoryId:'s',price:10,unit:'件'}],records:[]});
 await fs.writeFile(path.join(fixture,'workspace.json'),JSON.stringify({campaigns:[campaign('a'),campaign('b')],onboarding:{completedAt:'2026-10-29T00:00:00Z'},settings:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:''}}));
 backend=await(await import('../server.mjs')).start({port:0,dataDir:fixture,credentialStore:{get:async()=>'',set:async()=>{}},upstreamFetch:async()=>{throw Error('No model calls');}});
 win=new BrowserWindow({show:false,width:1250,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{const end=Date.now()+12000;while(Date.now()<end){if(await js(code))return;await pause(60);}throw Error('Timed out: '+code);};
 const choose=id=>js(`{const e=document.getElementById('campaign');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}));}`);
 await win.loadURL(backend.url);await until("document.querySelectorAll('#campaign option').length===2");await choose('a');
 await js("document.getElementById('recognitionNote').value='本期角色为Mon3tr、黑键'");await choose('b');assert.equal(await js("document.getElementById('recognitionNote').value"),'');
 await js("document.getElementById('recognitionNote').value='本期角色为遥'");await choose('a');assert.equal(await js("document.getElementById('recognitionNote').value"),'本期角色为Mon3tr、黑键');
 await js("document.getElementById('publish').click()");await until("document.getElementById('catalogSaveStatus').dataset.state==='saved'");
 let state=await(await fetch(backend.url+'/api/state')).json();assert.deepEqual(state.campaigns.find(c=>c.id==='a').recognitionCharacters,['Mon3tr','黑键']);assert.equal(state.campaigns.find(c=>c.id==='b').recognitionCharacters,undefined);
 await win.reload();await until("document.querySelectorAll('#campaign option').length===2");await choose('a');assert.equal(await js("document.getElementById('recognitionNote').value"),'本期角色为Mon3tr、黑键');
 await choose('b');assert.equal(await js("document.getElementById('recognitionNote').value"),'');
 console.log('PASS: campaign note isolation, draft restoration, save and reload');
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);win?.destroy();await backend?.shutdown();app.exit(process.exitCode||0);});
