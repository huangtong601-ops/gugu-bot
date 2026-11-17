import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {tableImageCommand,selectTableImages,tableImagePages,personalBillPages,groupBillPages} from './table-images.mjs';
import {processQQEvent,QQ_COMMANDS} from './qq-commands.mjs';import {start} from './server.mjs';
import {tableData,workbook} from './tables.mjs';import {inflateRawSync} from 'node:zlib';
import {fitTableRows,parseTableMerge,tableTextLines} from './table-layout.mjs';
import {parseQueueCommand} from './queue-query.mjs';import {parseComment} from './workflow.mjs';
import {purchasePool,planOrders} from './order-planning.mjs';
import {completeCampaign,purchaseSource,sourceHash} from './campaign-lifecycle.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const campaign=(id='c',name='模拟联动春季',groupId='11111')=>({id,name,groupId,botId:'zhougu',revision:0,categories:[{id:'s',name:'单领',kind:'single'},{id:'g',name:'通行证',kind:'group',sets:2},{id:'gift',name:'特典',kind:'single'}],products:[{id:'a',name:'立牌-艾雅法拉',type:'单领',categoryId:'s',price:20,unit:'件'},{id:'b',name:'通行证-德克萨斯',character:'德克萨斯',type:'通行证',categoryId:'g',price:30,averagePrice:30,adjustment:0,unit:'对'},{id:'bonus',name:'明信片',type:'特典',categoryId:'gift',giftTier:1,price:5,unit:'张'}],records:[{id:'r',skuId:'a',qq:'54321',member:'模拟甲',quantity:2,unitCents:2000,status:'暂估',createdAt:'2026-01-01T00:00:00Z'}]});
const event=(content,id=1,extra={})=>({post_type:'message',group_id:11111,user_id:12345,self_id:99999,message_id:id,message:[{type:'at',data:{qq:'99999'}},{type:'text',data:{text:content}}],...extra});
function billCampaign(){
 const c=campaign('bill','模拟个人结算期'),sku=(id,name,price)=>({id,name,price,categoryId:'s',type:'单领',unit:'件'});
 c.categories=c.categories.slice(0,1);
 c.products=[sku('own','本人立牌',20),sku('proxy','代排徽章',10),sku('other','同名他人商品',55),sku('manual','无QQ手填商品',55)];
 const record=(id,qq,extra={})=>({id,skuId:id,member:'模拟甲',qq,quantity:1,createdAt:'2026-01-01T00:00:00Z',...extra});
 c.records=[record('own','54321',{quantity:2}),record('proxy','54321',{proxyFor:'模拟代排'}),record('other','77777'),record('manual',undefined,{identityMode:'cn'})];
 const pool=purchasePool(c),plan=planOrders(pool,{tiers:[500],rule:'once',rewardMode:'both'});
 plan.orders[0].actualPaid=120;
 c.orderPlanning={version:1,pool,plan,source:purchaseSource(c)};
 c.settlement={creditType:'none',giftRevenue:0};
 return c;
}
test('personal bill resolves within the source group and renders only sender-owned and separate proxy amounts',()=>{
 const c=billCampaign(),foreign=campaign('foreign','其他群账单','22222'),db={campaigns:[c,foreign],qqEnrollmentEnabled:true,qqAdmins:['12345']};
 const mention=event('查看肾表 模拟个人',1,{user_id:54321});
 mention.message.splice(1,0,{type:'at',data:{qq:'77777'}});
 assert.deepEqual(processQQEvent(db,mention),{readOnly:true,personalBillCampaignId:'bill'});
 assert.equal(processQQEvent(db,event('查阅肾表 模拟个人')).personalBillCampaignId,'bill');
 assert.deepEqual(processQQEvent(db,event('查询肾表',1,{user_id:54321})),{readOnly:true,personalBillCampaignId:'bill'});
 assert.throws(()=>processQQEvent(db,event('查询肾表 其他群账单',1,{user_id:54321})),/未匹配到本群期次/);
 assert.throws(()=>processQQEvent({...db,campaigns:[c,campaign('another','模拟个人结算期二')]},mention),/期次全名/);
 assert.throws(()=>processQQEvent(db,{...mention,user_id:undefined}),/发送者QQ/);
 assert.equal(processQQEvent(db,{...mention,message:[mention.message.at(-1)]}).ignored,true);
 assert.match(processQQEvent(db,event('help',1,{user_id:54321})).reply,/查询肾表/);
 assert.throws(()=>processQQEvent(db,event('模拟个人结算期 肾表',1,{user_id:54321})),/管理员/);
 assert.equal(parseComment('查看肾表 模拟个人',c.products).status,'skip');
 const before=JSON.stringify(c),pages=personalBillPages(c,db,'54321');
 assert.equal(pages.length,1);
 assert.deepEqual(pages[0].rows.slice(1).map(r=>r.cells.map(x=>x.text)),[
  ['模拟甲','本人立牌','2件','15.00','30.00'],
  ['模拟甲 代 模拟代排','代排徽章','1件','7.50','7.50']
 ]);
 assert.equal(JSON.stringify(c),before);
 assert.throws(()=>personalBillPages(c,db,'12345'),/没有可查询/);
 c.orderPlanning.plan.orders[0].actualPaid=null;
 assert.throws(()=>personalBillPages(c,db,'54321'),/尚未完成结算/);
});
test('administrator bill export renders only the final settlement sheet using the same rows as Excel',()=>{
 const c=billCampaign(),foreign=campaign('foreign','其他群账单','22222'),db={campaigns:[c,foreign],qqAdmins:['12345']};
 assert.deepEqual(processQQEvent(db,event('导出肾表 模拟个人')),{readOnly:true,groupBillCampaignId:'bill'});
 assert.throws(()=>processQQEvent(db,event('导出肾表 模拟个人',1,{user_id:54321})),/管理员/);
 assert.throws(()=>processQQEvent(db,event('导出肾表 其他群账单')),/未匹配到本群期次/);
 assert.equal(processQQEvent(db,event('模拟个人结算期 肾表')).exportCampaignId,'bill');
 assert.equal(parseComment('导出肾表 模拟个人',c.products).status,'skip');
 const final=tableData(c,db,{kind:'settlement'}).at(-1),pages=groupBillPages(c,db);
 assert.deepEqual(pages.map(page=>page.category),['全团肾表']);
 assert.deepEqual(pages[0].rows.map(row=>row.cells.map(cell=>cell.text)),final.rows.map(row=>row.map(value=>typeof value==='number'?value.toFixed(2):value)));
 c.orderPlanning.plan.orders[0].actualPaid=null;
 assert.throws(()=>groupBillPages(c,db),/尚未完成结算/);
});
test('table command synonyms resolve only an unambiguous current-group campaign and optional category',()=>{
 const c=campaign();for(const verb of ['查看','查询'])for(const scope of ['','本群']){const arg=tableImageCommand(verb+scope+'排表 模拟联动 单领');assert.deepEqual(selectTableImages([c],arg),{campaignId:'c',categoryIds:['s']});}
 assert.deepEqual(selectTableImages([c],'模拟联动'),{campaignId:'c',categoryIds:['s','g','gift']});assert.deepEqual(selectTableImages([c],''),{campaignId:'c',categoryIds:['s','g','gift']});
 assert.throws(()=>selectTableImages([c,campaign('d','模拟联动冬季')],'模拟联动 单领'),/多个/);
 assert.throws(()=>selectTableImages([c],'模拟联动 不存在的大类'),/未匹配/);
 assert.deepEqual(selectTableImages([c,campaign('d','模拟联动春季特别版')],'模拟联动春季'),{campaignId:'c',categoryIds:['s','g','gift']});
 const db={qqAdmins:['12345'],campaigns:[c,campaign('foreign','外群测试','22222')]},before=JSON.stringify(db);
 const r=processQQEvent(db,event('查看本群排表 模拟联动 单领'));assert.equal(r.readOnly,true);assert.equal(r.tableCampaignId,'c');assert.deepEqual(r.tableCategoryIds,['s']);assert.equal(JSON.stringify(db),before);
 assert.throws(()=>processQQEvent(db,event('查询本群排表 外群测试')),/未匹配/);
 assert.throws(()=>processQQEvent(db,event('查看本群排表 模拟联动',1,{user_id:54321})),/管理员/);
 assert.throws(()=>processQQEvent(db,event('查看本群排表 模拟联动',1,{group_id:undefined})),/群内/);
 assert.equal(processQQEvent(db,event('查看本群排表 模拟联动',1,{message:[{type:'text',data:{text:'查看本群排表 模拟联动'}}]})).ignored,true);
 assert.ok(processQQEvent(db,event('help')).reply.includes(QQ_COMMANDS.tables.usage));assert.ok(!processQQEvent(db,event('help',1,{user_id:54321})).reply.includes(QQ_COMMANDS.tables.usage));
});

test('demand verbs return text and table verbs return image requests without enrolling or crossing permissions',()=>{
 const c=campaign(),db={qqAdmins:['12345'],qqEnrollmentEnabled:true,campaigns:[c,campaign('other','其他群期次','22222')]},before=JSON.stringify(db);
 for(const verb of ['查询','查看']){
  for(const target of ['单领','立牌']){const command=verb+'排量 '+target,r=processQQEvent(db,event(command));assert.equal(r.readOnly,true);assert.match(r.reply,/：2件/);assert.equal(r.tableCampaignId,undefined);assert.equal(parseComment(command,c.products).status,'skip');}
  const personal=processQQEvent(db,event(verb+'排量',20,{user_id:54321}));assert.match(personal.reply,/你已排的制品/);assert.match(personal.reply,/：2件/);
  for(const scope of ['','本群'])for(const target of ['','模拟联动','模拟联动 单领']){
   const command=verb+scope+'排表'+(target?' '+target:''),r=processQQEvent(db,event(command));assert.equal(r.tableCampaignId,'c');assert.deepEqual(r.tableCategoryIds,target.endsWith('单领')?['s']:['s','g','gift']);assert.equal(r.reply,undefined);assert.equal(r.readOnly,true);assert.equal(parseComment(command,c.products).status,'skip');
   assert.throws(()=>processQQEvent(db,event(command,21,{user_id:54321})),/管理员/);
   assert.equal(processQQEvent(db,event(command,21,{message:[{type:'text',data:{text:command}}]})).ignored,true);
  }
  assert.equal(processQQEvent(db,event(verb+'排量 单领',22,{message:[{type:'text',data:{text:verb+'排量 单领'}}]})).ignored,true);
  assert.equal(tableImageCommand(verb+'排量 单领'),undefined);assert.equal(parseQueueCommand(verb+'排表 单领'),null);
 }
 const help=processQQEvent(db,event('help')).reply;for(const name of ['查询排量','查询排表'])assert.ok(help.includes(name));assert.doesNotMatch(help,/查看排量|查看排表/);assert.match(help,/文字排量/);assert.match(help,/排表图片/);
 assert.equal(JSON.stringify(db),before);
});
test('image pages use workbook rows, separate categories, preserve merged names and paginate without truncation',()=>{
 const c=campaign(),before=JSON.stringify(c),pages=tableImagePages(c,{},['s','g','gift']);assert.deepEqual(new Set(pages.map(p=>p.category)),new Set(['单领','通行证','特典']));
 assert.ok(pages.find(p=>p.category==='单领').rows.some(r=>r.cells.some(c=>c.text==='模拟甲')));assert.ok(pages.find(p=>p.category==='单领').rows.some(r=>r.cells.some(c=>c.rowSpan===2)));assert.equal(JSON.stringify(c),before);
 c.records=Array.from({length:180},(_,i)=>({...c.records[0],id:'row'+i,member:'序号'+i,qq:undefined,identityMode:'cn',quantity:1}));
 const many=tableImagePages(c,{},['s']);assert.ok(many.length>1);assert.ok(many.every(p=>p.width<=1700&&p.height<=2400));
 for(let i=0;i<180;i++)assert.ok(many.some(p=>p.rows.some(r=>r.cells.some(c=>c.text==='序号'+i))),String(i));
 assert.throws(()=>tableImagePages(c,{},['absent']),/大类/);
});

test('group images send the queue and recipient totals as separate sections',()=>{
 const c=campaign(),group=c.categories[1],product=c.products[1];
 group.name='立体冰箱贴';
 const roles=Array.from({length:7},(_,i)=>({...product,id:'role'+i,name:group.name+'-角色'+i,character:'角色'+i,boxId:'55.0'}));
 c.products.splice(1,1,...roles);
 c.records.push(...roles.map((p,i)=>({...c.records[0],id:'group'+i,skuId:p.id,member:'排队成员'+i,qq:undefined,identityMode:'cn',quantity:i===0?2:1})));
 const pages=tableImagePages(c,{},[group.id]),[queue,bills]=pages;
 assert.deepEqual(pages.map(p=>[p.section,p.columns.length,p.parts]),[['排表',7,1],['肾表',6,1]]);
 const cells=queue.rows.flatMap(r=>r.cells).map(cell=>cell.text);
 assert.ok(cells.includes('立体冰箱贴 55.0'));
 for(const [i,role]of roles.entries()){assert.ok(cells.includes(role.character));assert.ok(cells.includes('排队成员'+i));}
 assert.equal(cells.filter(value=>value==='排量 1').length,6);
 assert.ok(cells.includes('排量 2'));assert.ok(!cells.includes('总计'));
 assert.deepEqual(bills.rows[0].cells.map(cell=>cell.text),['cn',group.name,'均价','调价','单价','总计']);
 assert.equal(bills.rows.length,9);
 assert.ok(bills.rows.some(row=>row.cells[0].text==='排队成员0'&&row.cells[0].rowSpan===2));
 const sheet=tableData(c,{}, {kind:'enrollment'}).find(s=>s.name===group.name);
 assert.deepEqual(sheet.rows[0].slice(sheet.detailStart),['cn',group.name,'均价','调价','单价','总计']);
 assert.match(unzip(workbook(c,{}, {kind:'enrollment'})).get('xl/worksheets/sheet2.xml'),/>总计</);
 const empty=tableImagePages(campaign(),{},['g']);
 assert.ok(empty[0].rows.some(row=>row.cells.some(cell=>cell.text==='排量 0')));
 assert.ok(empty[1].rows.some(row=>row.cells.some(cell=>cell.text==='暂无报名')));
 c.products=c.products.filter(p=>p.categoryId!==group.id);c.records=c.records.slice(0,1);
 assert.equal(tableImagePages(c,{},[group.id])[0].rows[1].cells[0].text,'暂无商品');
});

function unzip(bytes){const files=new Map();let offset=0;while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+nameLength+extra;files.set(bytes.subarray(offset+30,offset+30+nameLength).toString(),inflateRawSync(bytes.subarray(start,start+size)).toString());offset=start+size;}return files;}
test('closed single-category XLSX and QQ images use finalized prices and totals',()=>{
 const c=campaign();
 c.categories=c.categories.slice(0,1);c.products=c.products.slice(0,1);
 const pool=purchasePool(c),plan=planOrders(pool,{tiers:[60],rule:'once',rewardMode:'both'});
 plan.orders[0].actualPaid=30;
 c.orderPlanning={version:1,pool,plan,source:purchaseSource(c)};
 c.settlement={creditType:'none',giftRevenue:0};
 const enrollment=()=>tableData(c,{}, {kind:'enrollment'})[0];
 assert.deepEqual(enrollment().rows[1].slice(2),[20,20,40]);
 completeCampaign(c,{version:0,expectedSource:sourceHash(c)});
 assert.deepEqual(enrollment().rows[1].slice(2),[20,15,30]);
 assert.equal(enrollment().formulas.D2,undefined);
 const xml=unzip(workbook(c,{}, {kind:'enrollment'})).get('xl/worksheets/sheet1.xml');
 assert.match(xml,/<c r="D2"[^>]*><v>15<\/v>/);
 const [page]=tableImagePages(c,{},['s']);
 assert.deepEqual(page.rows[1].cells.slice(2).map(cell=>cell.text),['20.00','15.00','30.00']);
 c.settlement.creditType='';
 assert.deepEqual(enrollment().rows[1].slice(2),[20,20,40]);
 assert.throws(()=>workbook(c,{}, {kind:'settlement'}),/请选择购物金类型/);
});
test('gift headings wrap at existing column widths while single sheets retain their original dimensions',()=>{
 const c=campaign();c.products[2].name='特典第二档全角色纪念镭射明信片套组（限定联动特别款）';c.categories[2].name='联动赠品';c.categories[2].role='gift';
 const sheets=tableData(c,{}, {kind:'enrollment'}),files=unzip(workbook(c,{}, {kind:'enrollment'}));
 const single=files.get('xl/worksheets/sheet1.xml'),gift=files.get('xl/worksheets/sheet3.xml');
 for(const [i,width]of sheets[0].widths.entries())assert.ok(single.includes(`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`));
 for(const [r,row]of sheets[0].rows.entries())assert.ok(single.includes(`<row r="${r+1}" ht="${row?.some(x=>typeof x==='string'&&x.length>25)?32:22}"`));
 assert.ok(gift.includes('width="18"'));assert.ok(Number(gift.match(/<row r="2" ht="([\d.]+)"/)[1])>32);
 const pages=tableImagePages(c,{},['gift']);const heading=pages[0].rows.find(r=>r.cells.some(cell=>cell.text.includes(c.products[2].name)));assert.ok(heading.height>32);
 assert.ok(files.get('xl/styles.xml').includes('wrapText="1"'));
 const widths=[130,130],long='带有很长名称的合并标签需要完整显示'.repeat(3),rows=[[long,''],['',''],['','']];
 const heights=fitTableRows(rows,widths,[parseTableMerge('A1:B3')]);assert.ok(heights.reduce((a,b)=>a+b,0)>=12+20*tableTextLines(long,244));
});
test('real gateway handler sends selected images only to the source group, avoids duplicates and uses no model',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-table-image-'));let app,onEvent,sent=[],rendered=[],renderFailure=false,invalidImage=false;
 try{
  const c=campaign();await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({campaigns:[c,billCampaign()],qqAdmins:['12345'],qqGroups:[{id:'11111'}],qqSettings:{url:'ws://127.0.0.1:12345'},settings:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:''}}));
  app=await start({port:0,dataDir:dir,credentialStore:{get:async()=>'',set:async()=>{}},upstreamFetch:async()=>{throw Error('No model calls');},desktopActions:{renderTableImages:async pages=>{rendered=pages;if(renderFailure)throw Error('模拟渲染失败');return pages.map(()=>invalidImage?Buffer.from('invalid!'):png);}},qqConnector:opts=>{onEvent=opts.onEvent;return {status:()=> '已连接',close(){},call:async(action,params)=>{assert.equal(action,'send_group_msg');sent.push(params);return {};}};}});
  await onEvent(event('查询本群排表 模拟联动 单领'));assert.equal(sent.length,1);assert.equal(String(sent[0].group_id),'11111');assert.ok(sent[0].message.some(m=>m.type==='image'&&m.data.file.startsWith('base64://')));assert.ok(rendered.every(p=>p.category==='单领'));
  await onEvent(event('查询本群排表 模拟联动 单领'));assert.equal(sent.length,1);
  sent=[];await onEvent(event('查看本群排表 模拟联动',2));assert.equal(sent.length,4);assert.deepEqual(new Set(rendered.map(p=>p.category)),new Set(['单领','通行证','特典']));
  sent=[];await onEvent(event('查看本群排表 模拟联动 通行证',6));assert.equal(sent.length,2);
  assert.deepEqual(sent.map(m=>m.message[0].data.text.split(' · ').at(-1)),['排表','肾表']);
  sent=[];await onEvent(event('查询肾表 模拟个人',7,{user_id:54321}));
  assert.equal(sent.length,1);assert.equal(String(sent[0].group_id),'11111');
  assert.ok(sent[0].message.some(m=>m.type==='image'));assert.match(sent[0].message[0].data.text,/个人肾表/);
  assert.doesNotMatch(JSON.stringify(rendered),/同名他人商品|无QQ手填商品/);
  sent=[];await onEvent(event('导出肾表 模拟个人',8));
  assert.equal(sent.length,1);assert.equal(String(sent[0].group_id),'11111');assert.ok(sent[0].message.some(m=>m.type==='image'));
  assert.deepEqual(rendered.map(p=>p.category),['全团肾表']);
  const billProducts=rendered[0].rows.map(row=>row.cells[1].text);
  assert.ok(billProducts.includes('同名他人商品'));assert.ok(billProducts.includes('无QQ手填商品'));
  sent=[];await onEvent(event('导出肾表 模拟个人',9,{user_id:54321}));
  assert.equal(sent.length,1);assert.ok(sent[0].message.every(m=>m.type==='text'));assert.match(sent[0].message[0].data.text,/管理员/);
  sent=[];await onEvent(event('查看本群排表 模拟联动',3,{user_id:54321}));assert.equal(sent.length,1);assert.ok(sent[0].message.every(m=>m.type==='text'));assert.match(sent[0].message[0].data.text,/管理员/);
  sent=[];renderFailure=true;await onEvent(event('查看本群排表 模拟联动 单领',4));assert.equal(sent.length,1);assert.match(sent[0].message[0].data.text,/模拟渲染失败/);
  sent=[];renderFailure=false;invalidImage=true;await onEvent(event('查看本群排表 模拟联动 单领',5));assert.equal(sent.length,1);assert.match(sent[0].message[0].data.text,/结果无效/);
  sent=[];invalidImage=false;await onEvent(event('查看本群排表 模拟联动 单领',4));assert.equal(sent.length,1);assert.ok(sent[0].message.some(m=>m.type==='image'));
  for(const [i,verb]of ['查询','查看','查阅'].entries()){
   sent=[];await onEvent(event(c.name+' '+verb+'排量 单领',10+i));assert.equal(sent.length,1);assert.ok(sent[0].message.every(m=>m.type==='text'));assert.match(sent[0].message[0].data.text,/：2件/);
   sent=[];await onEvent(event(verb+'排表 模拟联动 单领',20+i));assert.equal(sent.length,1);assert.ok(sent[0].message.some(m=>m.type==='image'));assert.ok(rendered.every(p=>p.category==='单领'));
  }
  const state=await(await fetch(app.url+'/api/state')).json();assert.deepEqual(state.campaigns[0].records,c.records);assert.deepEqual(state.campaigns[0].categories,c.categories);
 }finally{await app?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
