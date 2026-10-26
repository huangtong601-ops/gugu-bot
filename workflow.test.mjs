import {test} from 'node:test';import assert from 'node:assert/strict';
import {defaultCategories,registerCN,memberName,parseComment,addComment,summary,positionMatch,bindAlbum,matchProduct} from './workflow.mjs';import {catalog} from './domain.mjs';import {tableData,workbook} from './tables.mjs';import {processQQEvent} from './qq-commands.mjs';
import {orderedRecords} from './workflow.mjs';
import {canHandleQQEvent} from './qq-commands.mjs';
test('unbound groups cannot enter business processing; binding affects only that group',()=>{assert.equal(canHandleQQEvent({}, {group_id:123}),false);assert.equal(canHandleQQEvent({}, {user_id:123}),true);const db={albums:[{groupId:'456'}]};assert.equal(canHandleQQEvent(db,{group_id:123}),false);assert.equal(canHandleQQEvent(db,{group_id:456}),true);});
test('explicit test group confines group operations even when other albums are bound',()=>{const db={qqTestGroup:{id:'90000003'},albums:[{groupId:'456'}]};assert.equal(canHandleQQEvent(db,{group_id:90000003}),true);assert.equal(canHandleQQEvent(db,{group_id:456}),false);assert.equal(canHandleQQEvent(db,{user_id:123}),true);});
test('one manual multi-item submission retains its textual order',()=>{const records=[{id:'z',requestId:'batch',itemIndex:0,createdAt:'2026-10-23T01:00:00Z'},{id:'a',requestId:'batch',itemIndex:1,createdAt:'2026-10-23T01:00:00Z'}];assert.deepEqual(orderedRecords({records}).map(r=>r.id),['z','a']);});
const products=()=>catalog([{id:'a',name:'通行证-予愿安洁莉娜',type:'通行证',boxId:'55.0',averagePrice:30,adjustment:40},{id:'b',name:'通行证-克莱门莎',type:'通行证',boxId:'55.0',averagePrice:30,adjustment:20},{id:'s',name:'双闪徽章-酒神（真我自扼）',type:'单领',price:20}]);
test('multi-item aliases resolve only within campaign; duplicate CN is rejected',()=>{const db={};registerCN(db,'12345','示例用户I');assert.throws(()=>registerCN(db,'54321','示例用户I'));assert.deepEqual(parseComment('洁哥通行证2克莱门莎通行证1',products()).items,[{skuId:'a',quantity:2},{skuId:'b',quantity:1}]);assert.equal(parseComment('酒神皮肤吧唧1',products()).items[0].skuId,'s');assert.deepEqual(parseComment('吧唧',products()).items,[{skuId:'s',quantity:1}]);});
test('late comments retain source order, quantities expand and duplicate events are idempotent',()=>{const db={};registerCN(db,'12345','示例用户I');registerCN(db,'54321','示例用户K');const c={products:products(),categories:defaultCategories(),records:[]};c.categories[2].sets=5;addComment(db,c,{id:'2',qq:'54321',at:'2026-10-23T02:00:00Z',text:'洁哥通行证2克莱门莎通行证1'});addComment(db,c,{id:'1',qq:'12345',at:'2026-10-23T01:00:00Z',text:'洁哥通行证3'});assert.deepEqual(summary(c)[0].queue,['示例用户I','示例用户I','示例用户I','示例用户K','示例用户K']);assert.equal(summary(c)[1].remaining,4);assert.equal(addComment(db,c,{id:'1',qq:'12345',at:'2026-10-23T01:00:00Z',text:'洁哥通行证3'}).duplicate,true);const sheets=tableData(c,db),kidney=sheets.find(s=>s.name==='肾表');assert.equal(kidney.rows.length,4);assert.equal(kidney.rows[1][2],210);assert.equal(kidney.rows[2][2],190);assert.deepEqual(kidney.merges,['A3:A4','C3:C4']);assert.equal(kidney.rows[1][1],'通行证-予愿安洁莉娜 ×3对');assert.equal(workbook(c,db).readUInt32LE(0),0x04034b50);});
test('fixed group prices and custom single categories survive catalog validation',()=>{const cats=[{id:'g',name:'人事部简历',kind:'group',pricingMode:'fixed'},{id:'x',name:'其他',kind:'single'}];const p=catalog([{id:'a',categoryId:'g',name:'简历-阿米娅',type:'单领',price:12},{id:'b',categoryId:'x',name:'立牌',type:'单领',price:30}],cats);assert.equal(p[0].price,12);assert.equal(p[0].pricingMode,'fixed');assert.equal(p[1].categoryId,'x');});
test('position matching refuses overlapping and missing anchors',()=>{const a={skuId:'a',bounds:{x:0,y:0,width:.5,height:.5}},b={x:.1,y:.1,width:.1,height:.1};assert.equal(positionMatch([a],b).skuId,'a');assert.equal(positionMatch([a,a],b),null);assert.equal(positionMatch([a],null),null);});
test('QQ command requires actual mention and uses sender identity',()=>{const db={campaigns:[]};assert.equal(processQQEvent(db,{group_id:1,message:[{type:'text',data:{text:'今天吃啥'}}]}).ignored,true);assert.match(processQQEvent(db,{group_id:1,message:[{type:'text',data:{text:'cn 示例用户I'}}]}).reply,/@/);const result=processQQEvent(db,{group_id:1,user_id:12345,self_id:99999,message:[{type:'at',data:{qq:'99999'}},{type:'text',data:{text:' cn 示例用户I'}}]});assert.match(result.reply,/已录入/);assert.equal(memberName(db,'12345','1'),'示例用户I');});

test('album-style parsing drops @ mentions, skips commands and keeps structured questions',()=>{
 const db={};registerCN(db,'12345','示例用户I');
 assert.equal(parseComment('@{uin:1,nick:小谷} 查询余量',products()).status,'skip');
 assert.equal(parseComment('@{uin:1,nick:小谷} 洁哥通行证1',products()).items.length,1);
 const ambiguous=parseComment('通行证1',products());
 assert.equal(ambiguous.status,'ambiguous');
 assert.equal(typeof ambiguous.questions[0],'object');
 assert.ok(Array.isArray(ambiguous.questions[0].candidates)&&ambiguous.questions[0].candidates.length>1);
});

test('albums cannot be bound to a campaign that belongs to another group',()=>{
 const db={albums:[]},c={id:'c',groupId:'111111'};
 assert.throws(()=>bindAlbum(db,c,{groupId:'222222',albumId:'album'}),/不一致/);
 bindAlbum(db,c,{groupId:'111111',albumId:'album'});
 assert.equal(db.albums.length,1);
});
test('CN is scoped per group with a global fallback',()=>{
 const db={};
 registerCN(db,'12345','示例用户I','111111');
 assert.equal(memberName(db,'12345','111111'),'示例用户I');
 assert.equal(memberName(db,'12345','222222'),'');
 registerCN(db,'54321','示例用户I','222222');
 assert.equal(memberName(db,'54321','222222'),'示例用户I');
 assert.throws(()=>registerCN(db,'99999','示例用户I','111111'),/本群/);
 registerCN(db,'77777','全局名');
 assert.equal(memberName(db,'77777','333333'),'全局名');
});
test('missing quantity defaults to one per mentioned product',()=>{
 const p=products();
 assert.deepEqual(parseComment('洁哥',p).items,[{skuId:'a',quantity:1}]);
 assert.deepEqual(parseComment('洁哥 克莱门莎',p).items,[{skuId:'a',quantity:1},{skuId:'b',quantity:1}]);
 assert.deepEqual(parseComment('洁哥2',p).items,[{skuId:'a',quantity:2}]);
 assert.equal(parseComment('洁哥0',p).status,'ambiguous');
});
test('quantity overrides from pending resolution replace parsed and default values',()=>{
 const p=products();
 assert.deepEqual(parseComment('洁哥',p,'',{quantities:{'洁哥':3}}).items,[{skuId:'a',quantity:3}]);
 assert.deepEqual(parseComment('洁哥2',p,'',{quantities:{'洁哥':4}}).items,[{skuId:'a',quantity:4}]);
 const db={};registerCN(db,'12345','示例用户I');
 const c={products:p,categories:defaultCategories(),records:[]};
 addComment(db,c,{id:'q1',qq:'12345',at:'2026-10-25T01:00:00Z',text:'洁哥',quantities:{'洁哥':2}});
 assert.equal(c.records[0].quantity,2);
});
const merchandise=()=>[
 {id:'a',name:'毛绒延展扣-Miss.Christine A款',aliases:['毛绒延展扣','延展扣','Miss.Christine A款'],type:'单领'},
 {id:'b',name:'毛绒延展扣-Miss.Christine B款',aliases:['毛绒延展扣','延展扣','Miss.Christine B款'],type:'单领'},
 ...['黍','琳琅诗怀雅','烛煌'].map((role,i)=>({id:'card'+i,name:'藏书票相卡套组-'+role,type:'单领'})),
 {id:'badge',name:'双闪徽章-烛煌',type:'单领'},
 {id:'fold',name:'屏风折页-恒远津梁',type:'单领'}
];
test('explicit variant shorthand selects A without B; unspecified variant stays ambiguous',()=>{
 const p=merchandise();for(const name of ['毛绒延展扣A','毛绒延展扣Ａ款','延展扣a'])assert.deepEqual(matchProduct(name,p).map(x=>x.id),['a']);
 assert.deepEqual(matchProduct('毛绒延展扣B',p).map(x=>x.id),['b']);assert.equal(matchProduct('毛绒延展扣',p).length,2);
 assert.equal(matchProduct('毛绒延展扣C',p).length,0);
});
test('each-of-a-family expands only the exact number of scoped variants in textual order',()=>{
 const p=merchandise();for(const count of ['三款各一','三款各1','3款各1']){
  const parsed=parseComment('毛绒延展扣A1 屏风折页1 藏书票相卡套组'+count,p);
  assert.equal(parsed.status,'resolved');assert.deepEqual(parsed.items,[{skuId:'a',quantity:1},{skuId:'fold',quantity:1},...p.filter(x=>x.id.startsWith('card')).map(x=>({skuId:x.id,quantity:1}))]);
 }
 assert.deepEqual(parseComment('藏书票相卡套组三款各2',p).items.map(x=>x.quantity),[2,2,2]);
 for(const scoped of [p.filter(x=>x.id!=='card2'),[...p,{id:'extra',name:'藏书票相卡套组-阿米娅',type:'单领'}]]){const r=parseComment('藏书票相卡套组三款各一',scoped,'',{allProducts:p});assert.equal(r.status,'ambiguous');assert.equal(r.items.length,0);assert.equal(r.questions[0].code,'group');}
});
test('partial roles resolve inside family scope and context but remain ambiguous across kinds',()=>{
 const p=merchandise(),cards=p.filter(x=>x.id.startsWith('card'));
 assert.deepEqual(parseComment('诗怀雅和煌',cards).items,[{skuId:'card1',quantity:1},{skuId:'card2',quantity:1}]);
 assert.deepEqual(parseComment('藏书票相卡套组诗怀雅1 煌1',p).items,[{skuId:'card1',quantity:1},{skuId:'card2',quantity:1}]);
 assert.equal(parseComment('煌',p).status,'ambiguous');
});
test('proxy-only annotations never become goods, preserve edition text and never invent beneficiary',()=>{
 const r=parseComment('男人1（代排）',merchandise());assert.equal(r.questions.length,1);assert.equal(r.questions[0].phrase,'男人');assert.equal(r.proxyFor,undefined);
 assert.deepEqual(parseComment('毛绒延展扣A1（代排）',merchandise()).items,[{skuId:'a',quantity:1}]);
 assert.deepEqual(parseComment('酒神（真我自扼）吧唧1',products()).items,[{skuId:'s',quantity:1}]);
 assert.equal(parseComment('毛绒延展扣A-1',merchandise()).questions[0].code,'quantity');
});
test('entry identities allow independent removal of repeats and expanded variants without changing source',()=>{
 const p=merchandise(),text='毛绒延展扣A1 毛绒延展扣A2 藏书票相卡套组三款各一 男人1（代排）';
 const r=parseComment(text,p),keys=[r.lines[1].entryKey,r.lines.find(l=>l.skuId==='card1').entryKey,r.questions[0].entryKey];
 const after=parseComment(text,p,'',{ignoredItems:keys});assert.equal(after.status,'resolved');assert.deepEqual(after.items,[{skuId:'a',quantity:1},{skuId:'card0',quantity:1},{skuId:'card2',quantity:1}]);
 assert.deepEqual(after.lines.map(l=>l.entryKey),r.lines.filter(l=>!keys.includes(l.entryKey)).map(l=>l.entryKey));
 assert.equal(parseComment(text,p,'',{ignoredItems:r.lines.map(l=>l.entryKey)}).status,'skip');
});

import {operatorForms,operatorNicknames} from './operator-aliases.mjs';
import {loadBotSkills} from './bots.mjs';
import {fileURLToPath} from 'node:url';
test('every verified alter accepts its base name only within the current catalog',()=>{
 for(const group of operatorForms.groups)for(const form of group.alters){
  const p=[{id:'target',name:'通行证-'+form,type:'通行证',character:form}];
  assert.deepEqual(matchProduct(group.base,p).map(x=>x.id),['target'],group.base+' → '+form);
  assert.deepEqual(parseComment(group.base+'通行证1',p).items,[{skuId:'target',quantity:1}],group.base+' 通行证');
 }
});
test('base shorthand remains ambiguous when original and alter or two alters are sold together',()=>{
 const p=[{id:'base',name:'通行证-德克萨斯',type:'通行证'},{id:'alter',name:'通行证-缄默德克萨斯',type:'通行证'}];
 assert.equal(parseComment('德克萨斯1',p).status,'ambiguous');assert.equal(parseComment('德狗通行证1',p).status,'ambiguous');
 for(const name of ['异德','缄默德克萨斯','缄默德克萨斯通行证'])assert.deepEqual(matchProduct(name,p).map(x=>x.id),['alter']);
 assert.deepEqual(matchProduct('本体德克萨斯',p).map(x=>x.id),['base']);assert.deepEqual(matchProduct('原版德狗通行证',p).map(x=>x.id),['base']);
 const chen=[{id:'one',name:'通行证-假日威龙陈',type:'通行证'},{id:'two',name:'通行证-赤刃明霄陈',type:'通行证'}];
 assert.equal(matchProduct('陈',chen).length,2);assert.equal(matchProduct('异格陈',chen).length,2);assert.deepEqual(matchProduct('赤刃明霄陈',chen).map(x=>x.id),['two']);
 assert.equal(matchProduct('缄默德克萨斯',p.slice(0,1)).length,0);
});
test('base fallback preserves merchandise and photo scopes, editions, boxes and explicit names',()=>{
 const p=[{id:'a',name:'藏书票相卡套组-琳琅诗怀雅',type:'单领'},{id:'b',name:'双闪徽章-琳琅诗怀雅',type:'单领'},{id:'c',name:'通行证-酒神',type:'通行证',boxId:'55.0'},{id:'d',name:'通行证-酒神',type:'通行证',boxId:'56.0'}];
 assert.equal(matchProduct('诗怀雅',p).length,2);assert.deepEqual(matchProduct('诗怀雅吧唧',p).map(x=>x.id),['b']);assert.equal(matchProduct('傀影通行证',p).length,2);
 assert.deepEqual(parseComment('诗怀雅1',p.slice(0,1),'',{allProducts:p}).items,[{skuId:'a',quantity:1}]);
 const outside=parseComment('傀影1',p.slice(0,1),'',{allProducts:p});assert.equal(outside.questions[0].code,'outside');assert.equal(outside.items.length,0);
 assert.equal(matchProduct('W',p.slice(0,1)).length,0);assert.equal(matchProduct('芬',merchandise()).length,0);
});
test('base nicknames select sole alter and the same verified table is loaded into the zhougu skill',async()=>{
 const p=[{id:'exu',name:'通行证-新约能天使',type:'通行证'},{id:'tex',name:'通行证-缄默德克萨斯',type:'通行证'}];
 assert.deepEqual(parseComment('阿能1 德狗1',p).items,[{skuId:'exu',quantity:1},{skuId:'tex',quantity:1}]);
 const skills=await loadBotSkills(fileURLToPath(new URL('.',import.meta.url))),zhougu=skills.get('zhougu');
 for(const group of operatorForms.groups)assert.ok(zhougu.includes(group.base+' → '+group.alters.join('、')));
});

test('every maintained nickname resolves to its listed role in a unique merchandise scope',()=>{
 for(const entry of operatorNicknames.entries)for(const name of entry.targets){
  const p=[{id:'target',name:'通行证-'+name,character:name,type:'通行证'}];
  assert.deepEqual(matchProduct(entry.alias,p).map(x=>x.id),['target'],entry.alias+' → '+name);
 }
});
test('ambiguous nicknames retain every meaning and resolve only after product scope narrows',()=>{
 const p=['诗怀雅','杰西卡','玫兰莎','闪灵','斯卡蒂','温蒂','安洁莉娜','孑'].map(name=>({id:name,name:'徽章-'+name,character:name,type:'单领'}));
 for(const [alias,wanted]of [['富婆',['诗怀雅','杰西卡']],['剑圣',['玫兰莎','闪灵']],['蒂蒂',['斯卡蒂','温蒂']],['杰哥',['安洁莉娜','孑']],['洁哥',['安洁莉娜','孑']]]){
  assert.deepEqual(new Set(matchProduct(alias+'吧唧',p).map(x=>x.id)),new Set(wanted),alias);
  assert.equal(parseComment(alias+'吧唧1',p).status,'ambiguous');
  assert.deepEqual(parseComment(alias+'1',p.filter(x=>x.id===wanted[1])).items,[{skuId:wanted[1],quantity:1}]);
 }
});
test('numeric and alphanumeric nicknames are protected from the quantity scanner without swallowing real quantities',()=>{
 const p=['史尔特尔','艾雅法拉','琴柳','乌尔比安','华法琳','星极','12F','耀骑士临光','塑心'].map(name=>({id:name,name:'徽章-'+name,character:name,type:'单领'}));
 for(const [text,name,quantity]of [['42吧唧1','史尔特尔',1],['42姐2','史尔特尔',2],['421','史尔特尔',1],['42 2','史尔特尔',2],['吧唧421','史尔特尔',1],['761','琴柳',1],['521','乌尔比安',1],['ff01','华法琳',1],['D32钢2','星极',2],['12F2','12F',2],['1741','耀骑士临光',1],['22261','塑心',1],['小羊42','艾雅法拉',42]]){
  assert.deepEqual(parseComment(text,p).items,[{skuId:name,quantity}],text);
 }
 assert.deepEqual(parseComment('42吧唧1 小羊2 ff03',p).items,[{skuId:'史尔特尔',quantity:1},{skuId:'艾雅法拉',quantity:2},{skuId:'华法琳',quantity:3}]);
 assert.equal(parseComment('42个',p).status,'ambiguous');
});
test('explicit alter nicknames cannot select originals or sibling alters; full names protect embedded nicknames',()=>{
 const p=['陈','假日威龙陈','赤刃明霄陈','能天使','克洛丝','夜刀','麒麟R夜刀'].map(name=>({id:name,name:'徽章-'+name,character:name,type:'单领'}));
 assert.deepEqual(matchProduct('水陈',p).map(x=>x.id),['假日威龙陈']);assert.equal(matchProduct('水陈',p.filter(x=>x.id==='陈')).length,0);
 assert.deepEqual(matchProduct('小能天使',p).map(x=>x.id),['克洛丝']);assert.deepEqual(matchProduct('麒麟R夜刀',p).map(x=>x.id),['麒麟R夜刀']);
 assert.equal(parseComment('男人1（代排）',p).questions.length,1);assert.equal(parseComment('老婆1',p).items.length,0);
});
test('nicknames inherit base-to-alter fallback without crossing merchandise or album scope, and preserve old exclusions',async()=>{
 const p=[{id:'sheep',name:'徽章-纯烬艾雅法拉',type:'单领'},{id:'sheepStand',name:'亚克力立牌-纯烬艾雅法拉',type:'单领'},{id:'tex',name:'通行证-缄默德克萨斯',type:'通行证'},{id:'angelina',name:'通行证-予愿安洁莉娜',type:'通行证'}];
 assert.deepEqual(matchProduct('小羊吧唧',p).map(x=>x.id),['sheep']);assert.equal(matchProduct('小羊',p).length,2);
 assert.deepEqual(parseComment('小羊1',p.slice(0,1),'',{allProducts:p}).items,[{skuId:'sheep',quantity:1}]);
 assert.equal(parseComment('小羊1',p.slice(2),'',{allProducts:p}).questions[0].code,'outside');
 assert.equal(parseComment('德狗1',p,'',{ignoredItems:[JSON.stringify(['德克萨斯',0])]}).status,'skip');
 assert.equal(parseComment('洁哥1',p,'',{ignoredItems:[JSON.stringify(['安洁莉娜',0])]}).status,'skip');
 const skills=await loadBotSkills(fileURLToPath(new URL('.',import.meta.url))),text=skills.get('zhougu');
 for(const entry of operatorNicknames.entries)assert.ok(text.includes(entry.alias+' → '+entry.targets.join('／')));
});

test('Arknights community aliases stay off for other imported Bots while explicit product aliases remain usable',()=>{
 const p=[{id:'sheep',name:'徽章-艾雅法拉',character:'艾雅法拉',type:'单领'}];
 assert.equal(matchProduct('小羊',p,6,{arknights:false}).length,0);assert.equal(parseComment('小羊1',p,'',{arknights:false}).items.length,0);
 assert.equal(parseComment('艾雅法拉1',p,'',{arknights:false}).items[0].skuId,'sheep');
 p[0].aliases=['自定义小羊'];assert.equal(matchProduct('自定义小羊',p,6,{arknights:false})[0].id,'sheep');
 const c={botId:'imported-example',products:p,records:[]},db={members:{12345:{cn:'测试甲'}}};
 assert.throws(()=>addComment(db,c,{id:'one',qq:'12345',at:'2026-10-25T01:00:00Z',text:'银老板1'}),/未匹配/);assert.equal(c.records.length,0);
});
