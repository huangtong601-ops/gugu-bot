// Isolated UI verification: synthetic API credentials and QQ identity only; no real login or messages.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'backups'),{recursive:true});const fixture=fs.mkdtempSync(path.join(root,'backups','setup-ui-'));
app.setPath('userData',path.join(fixture,'electron'));app.disableHardwareAcceleration();
let backend,proxy,win,loginReady=false,loggedIn=false,key='',runtimeSelected=false,runtimeDownloads=0,runtimeSelections=0,autoConnectCalls=0,autoConnectFail=false;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await app.whenReady();assert.equal(nativeImage.createFromPath(path.join(root,'assets','icon.ico')).isEmpty(),false);assert.equal(nativeImage.createFromPath(path.join(root,'assets','tray.png')).isEmpty(),false);const {start}=await import('../server.mjs');
 await fsp.writeFile(path.join(fixture,'workspace.json'),JSON.stringify({campaigns:[],settings:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:''}}));
 backend=await start({port:0,dataDir:fixture,
  credentialStore:{get:async config=>config.provider==='deepseek'?key:'',set:async(config,value)=>{if(config.provider==='deepseek')key=value;}},
  upstreamFetch:async(url,opts)=>opts.headers.authorization==='Bearer synthetic-ui-key'?Response.json({data:[{id:'vision-test',name:'Vision test',input_modalities:['text','image']}]}):Response.json({error:{message:'Synthetic authentication failure'}},{status:401}),
  qqConnector:()=>({status:()=> '已连接',close(){},async call(action){if(action==='get_login_info')return {user_id:654321};if(action==='get_status')return {online:true};throw Error('Unexpected QQ operation: '+action);}}),
  desktopActions:{async qqRuntimeInfo(){return {supported:true,available:runtimeSelected,root:runtimeSelected?path.join(fixture,'external-node'):''};},async openNapcatDownload(){runtimeDownloads++;},async selectQQRuntime(){runtimeSelections++;if(runtimeSelections===1)return {cancelled:true};if(runtimeSelections===2)throw Error('请选择完整解压的运行包');runtimeSelected=true;return {ok:true,supported:true,available:true,root:path.join(fixture,'external-node')};},async prepareQQ(){assert.ok(runtimeSelected);loginReady=true;return {ready:true,message:'QQ环境已准备'};},async openQQLogin(){}}
 });
 proxy=http.createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  const json=data=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(req.url==='/api/qq-login-state')return json({ready:loginReady,loggedIn});
  if(req.url==='/api/qq-quick-login'){loggedIn=true;return json({submitted:true});}
  if(req.url==='/api/qq-auto-connect'){
   autoConnectCalls++;await wait(150);if(autoConnectFail){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({error:'模拟连接失败，请重新登录'}));}
   assert.ok(loggedIn);const r=await fetch(backend.url+'/api/qq-settings',{method:'POST',headers:{origin:backend.url,'content-type':'application/json'},body:JSON.stringify({url:'ws://127.0.0.1:12345'})});assert.equal(r.status,200);return json({ok:true,qq:'654321'});
  }
  const response=await fetch(backend.url+req.url,{method:req.method,headers:{...(req.method==='POST'?{origin:backend.url,'content-type':'application/json'}:{})},...(body.length?{body}:{})});
  res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'text/plain'});res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+proxy.address().port;
 win=new BrowserWindow({width:1240,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
 const js=code=>win.webContents.executeJavaScript(code,true);
 async function until(code){for(let i=0;i<100;i++){if(await js(code))return;await wait(100);}throw Error('Timed out: '+code);}
 const input=(id,value)=>js(`{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));}`);
 const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
 const screenshot=async name=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await wait(120);await fsp.writeFile(path.join(root,'backups','setup-guide-'+name+'.png'),(await win.webContents.capturePage()).toPNG());};
 await win.loadURL(url);
 await until("document.getElementById('setupGuide').open");
 assert.equal(await js("document.querySelector('#setupModelSlot #settingsForm')!==null"),true);
 await screenshot('api');
 await input('apiKey','synthetic-invalid');await click('loadModels');
 await until("document.getElementById('setupStatus').textContent.includes('鉴权')");
 await input('apiKey','synthetic-ui-key');await click('loadModels');
 await until("document.querySelector('#model option[value=\"vision-test\"]')!==null");
 await js("{const e=document.getElementById('model');e.value='vision-test';e.dispatchEvent(new Event('change'));document.getElementById('settingsForm').requestSubmit();}");
 await until("!document.querySelector('[data-setup-panel=\"1\"]').hidden");
 await click('qqRuntimeDownload');await until("!document.getElementById('qqRuntimeDownload').disabled");assert.equal(runtimeDownloads,1);
 await click('qqRuntimeSelect');await until("!document.getElementById('qqRuntimeSelect').disabled");assert.equal(await js("document.getElementById('qqRuntimePath').value"),'');
 await click('qqRuntimeSelect');await until("document.getElementById('setupStatus').textContent.includes('完整解压')");
 await click('qqRuntimeSelect');await until("document.getElementById('qqRuntimePath').value.includes('external-node')");
 await screenshot('runtime');await click('setupFinish');
 await until("!document.querySelector('[data-setup-panel=\"2\"]').hidden");
 await screenshot('qq');
 await input('qqAccount','654321');await click('qqPrepare');
 await until("!document.getElementById('qqPrepare').disabled");
 await click('qqQuickLogin');await until("!document.getElementById('qqAutoConnect').disabled");
 await click('qqAutoConnect');await until("document.getElementById('qqLoginStatus').textContent.includes('机器人已连接')");
 await input('setupAdmin','bad');await click('setupFinish');
 await until("document.getElementById('setupStatus').textContent.includes('管理员QQ')");
 await input('setupAdmin','123456');await input('qqAccount','999999');await click('setupFinish');
 await until("document.getElementById('setupStatus').textContent.includes('不一致')");
 await input('qqAccount','654321');await click('setupFinish');
 await until("!document.querySelector('[data-setup-panel=\"3\"]').hidden");
 await screenshot('done');await click('setupFinish');
 await until("!document.getElementById('setupGuide').open");
 await until("document.querySelector('#settings #settingsForm')!==null&&document.querySelector('#settings #qqConnectionPanel')!==null");
 assert.equal(await js("document.getElementById('qqAccountPassword').value"),'');
 await js("document.querySelector('[data-page=workspace]').click()");
 const beforeReconnect=autoConnectCalls;await click('reconnectBot');
 assert.equal(await js("document.getElementById('reconnectBot').disabled&&document.getElementById('qqAutoConnect').disabled&&document.getElementById('reconnectBot').getAttribute('aria-busy')==='true'"),true);
 await js("document.getElementById('qqAutoConnect').onclick()");await until("document.getElementById('reconnectBot').dataset.state==='connected'&&!document.getElementById('reconnectBot').disabled");assert.equal(autoConnectCalls,beforeReconnect+1);
 assert.equal(await js("document.getElementById('title').textContent"),'商品建档');
 assert.ok(await js("{const b=document.getElementById('reconnectBot').getBoundingClientRect(),label=document.querySelector('.bot-heading label').getBoundingClientRect();Math.abs((b.y+b.height/2)-(label.y+label.height/2))<2&&b.width<=30&&b.x>label.x;}"));
 autoConnectFail=true;await click('reconnectBot');await until("document.getElementById('reconnectBot').dataset.state==='error'&&!document.getElementById('reconnectBot').disabled&&document.getElementById('notice').textContent.includes('模拟连接失败')");
 autoConnectFail=false;await click('reconnectBot');await until("document.getElementById('reconnectBot').dataset.state==='connected'&&!document.getElementById('reconnectBot').disabled");await screenshot('sidebar-reconnect');
 await win.loadURL(url);await until("document.querySelectorAll('#provider option').length>0");
 assert.equal(await js("document.getElementById('setupGuide').open"),false);
 await click('openSetupGuide');assert.equal(await js("document.getElementById('setupGuide').open"),true);await click('setupClose');
 await until("document.querySelector('#settings #settingsForm')!==null");
 assert.equal(await js("document.getElementById('qqEnrollmentEnabled').checked"),false);
 await click('qqEnrollmentEnabled');await until("!document.getElementById('qqEnrollmentEnabled').disabled&&document.getElementById('notice').textContent==='已开启@排表'");
 await win.loadURL(url);await until("document.querySelectorAll('#provider option').length>0");assert.equal(await js("document.getElementById('qqEnrollmentEnabled').checked"),true);
 await js("document.querySelector('[data-page=settings]').click()");await click('qqEnrollmentEnabled');await until("!document.getElementById('qqEnrollmentEnabled').disabled&&document.getElementById('notice').textContent==='已关闭@排表'");
 await until("document.querySelector('#usageSettingsPanel form')!==null");
 await js("{const root=document.getElementById('usageSettingsPanel'),selectors=root.querySelectorAll('select');selectors[0].value='manual';selectors[0].dispatchEvent(new Event('change'));selectors[1].value='USD';const fields=root.querySelectorAll('input');['2','0.5','5'].forEach((v,i)=>fields[i].value=v);root.querySelector('form').requestSubmit();}");
 await until("document.getElementById('notice').textContent==='计费设置已保存'");
 await win.loadURL(url);await until("document.querySelector('#usageSettingsPanel select')?.value==='manual'");
 assert.deepEqual(await js("[...document.querySelectorAll('#usageSettingsPanel input')].map(x=>x.value)"),['2','0.5','5']);
 assert.equal(await js("document.querySelectorAll('#usageSettingsPanel select')[1].value"),'USD');
 const ledger=JSON.parse(await fsp.readFile(path.join(fixture,'usage-ledger.json'),'utf8'));assert.equal(ledger.requests.length,0);assert.equal(Object.values(ledger.pricing)[0].input,2);assert.ok(!JSON.stringify(ledger).includes('synthetic-ui-key'));
 const saved=await fsp.readFile(path.join(fixture,'workspace.json'),'utf8');assert.ok(!saved.includes('synthetic-ui-key'));assert.equal(JSON.parse(saved).qqAdmin,'123456');
 console.log('Setup UI passed: first launch, API retry, runtime selection, QQ identity checks, completion, enrollment toggle and manual usage pricing persistence.');
}
run().then(()=>finish(0)).catch(e=>{console.error(e.stack);finish(1,e.stack);});
async function finish(code,error=''){try{fs.writeFileSync(path.join(root,'backups','setup-guide-result.json'),JSON.stringify({passed:code===0,error}));win?.destroy();if(proxy)await new Promise(r=>proxy.close(r));if(backend)await new Promise(r=>backend.server.close(r));try{await fsp.rm(fixture,{recursive:true,force:true});}catch{ /* Electron may retain its temporary profile until exit. */ }}finally{app.exit(code);}}
