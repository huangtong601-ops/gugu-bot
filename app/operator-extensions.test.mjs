import {test} from 'node:test';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {endfieldCharacters} from './operator-aliases.mjs';import {matchProduct,parseComment} from './workflow.mjs';import {loadBotSkills} from './bots.mjs';import {loadReferences,characterReference} from './pass-reference.mjs';import {constrainRecognitionCharacters} from './recognition-roster.mjs';import {queryQueue} from './queue-query.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const product=character=>({id:character,name:'双闪徽章-'+character,character,type:'单领',price:20});
test('all official Endfield character names and English labels resolve within the current merchandise scope',()=>{
 assert.equal(endfieldCharacters.characters.length,35);
 for(const c of endfieldCharacters.characters){
  const p=[product(c.name)];assert.deepEqual(matchProduct(c.name,p).map(x=>x.id),[c.name],c.name);
  assert.deepEqual(parseComment(c.appellation+'吧唧2',p).items,[{skuId:c.name,quantity:2}],c.appellation);
 }
});
test('confirmed new operator abbreviations resolve, but explicit other characters and out-of-photo goods do not fall back',()=>{
 const p=['塔露拉','国度','冻河','安塔尔'].map(product);
 for(const [alias,target]of [['塔','塔露拉'],['内卫','国度'],['皇帝','冻河'],['小皇帝','冻河']]){
  assert.deepEqual(parseComment(alias+'吧唧1',p).items,[{skuId:target,quantity:1}],alias);
  const outside=parseComment(alias+'吧唧1',p.filter(p=>p.id!==target),'',{allProducts:p});assert.equal(outside.items.length,0,alias);assert.equal(outside.status,'ambiguous');
 }
 assert.deepEqual(matchProduct('安塔尔吧唧',p).map(p=>p.id),['安塔尔']);
 assert.equal(matchProduct('内卫吧唧',p.filter(p=>p.id==='安塔尔')).length,0);
});
test('vvan resolves only to the matching Viviana merchandise',()=>{
 const products=[
  {id:'acrylic',name:'亚克力挂件-薇薇安娜（还愿礼VER.）',type:'单领'},
  {id:'other',name:'亚克力挂件-安塔尔',type:'单领'},
  product('薇薇安娜')
 ];
 assert.deepEqual(parseComment('vvan亚克力挂件',products).items,[{skuId:'acrylic',quantity:1}]);
 assert.deepEqual(parseComment('VVAN亚克力挂件2',products).items,[{skuId:'acrylic',quantity:2}]);
 assert.equal(parseComment('vvan亚克力挂件',products.slice(1),'',{allProducts:products}).items.length,0);
});
test('shared Endfield nicknames preserve cross-game ambiguity, protect numeric names and never infer alter relationships',()=>{
 const p=['艾尔黛拉','艾雅法拉','莱万汀','史尔特尔','洁尔佩塔','安洁莉娜'].map(product);
 for(const [alias,wanted]of [['小羊',['艾尔黛拉','艾雅法拉']],['42',['莱万汀','史尔特尔']],['洁哥',['洁尔佩塔','安洁莉娜']]]){
  assert.deepEqual(new Set(matchProduct(alias+'吧唧',p).map(p=>p.id)),new Set(wanted),alias);
  assert.equal(parseComment(alias+'吧唧1',p).status,'ambiguous');
  const scoped=p.filter(p=>p.id===wanted[0]);assert.deepEqual(parseComment(alias+'吧唧2',scoped,'',{allProducts:p}).items,[{skuId:wanted[0],quantity:2}]);
 }
 assert.deepEqual(parseComment('421',[product('莱万汀')]).items,[{skuId:'莱万汀',quantity:1}]);
 assert.deepEqual(parseComment('小羊42',[product('艾尔黛拉')]).items,[{skuId:'艾尔黛拉',quantity:42}]);
 assert.equal(matchProduct('史尔特尔吧唧',[product('莱万汀')]).length,0);assert.equal(matchProduct('艾雅法拉吧唧',[product('艾尔黛拉')]).length,0);
});
test('gendered administrators stay distinct and short Latin or Chinese labels cannot steal longer names',()=>{
 const p=['管理员（男）','管理员（女）'].map(product);
 for(const alias of ['男管','管男','男管理员','管理员男'])assert.deepEqual(matchProduct(alias+'吧唧',p).map(p=>p.id),['管理员（男）']);
 for(const alias of ['女管','管女','女管理员','管理员女'])assert.deepEqual(matchProduct(alias+'吧唧',p).map(p=>p.id),['管理员（女）']);
 for(const alias of ['管理员','Endministrator'])assert.equal(parseComment(alias+'吧唧1',p).status,'ambiguous');
 assert.deepEqual(matchProduct('Si吧唧',[product('祀')]).map(p=>p.id),['祀']);
 assert.equal(matchProduct('Miss.Christine',[product('祀')]).length,0);
 const other={id:'cat',name:'毛绒延展扣-Miss.Christine A款',type:'单领'};assert.deepEqual(parseComment('毛绒延展扣A1',[other,product('祀')]).items,[{skuId:'cat',quantity:1}]);
});
test('image rosters and loaded skills use the same Endfield and user-confirmed names without relaxing explicit rosters',async()=>{
 const refs=await loadReferences(root),skills=await loadBotSkills(root),text=skills.get('zhougu');
 for(const c of endfieldCharacters.characters){assert.equal(characterReference(refs,c.name).name,c.name);assert.equal(characterReference(refs,c.name).game,'endfield');assert.ok(text.includes(c.appellation+' → '));}
 assert.equal(characterReference(refs,'Perlica').name,'佩丽卡');assert.equal(characterReference(refs,'Perlica').url,'https://endfield.hypergryph.com/operator');
 const input={products:[{name:'双闪徽章-小羊',character:'小羊'},{name:'双闪徽章-皇帝',character:'皇帝'},{name:'双闪徽章-佩丽卡',character:'佩丽卡'}]};
 const result=constrainRecognitionCharacters(input,['艾尔黛拉','冻河'],{characters:refs.characters});assert.deepEqual(result.products.map(p=>p.character),['艾尔黛拉','冻河']);assert.equal(result.questions.length,1);
 const conflict=constrainRecognitionCharacters({products:[{name:'徽章-小羊',character:'小羊'}]},['艾雅法拉','艾尔黛拉'],{characters:refs.characters});assert.equal(conflict.products.length,0);assert.equal(conflict.questions.length,1);
});
test('queue queries share new aliases, remain catalogue-scoped and imported Bots keep their own naming rules',()=>{
 const p=['塔露拉','国度','冻河','佩丽卡'].map(product),c={botId:'zhougu',categories:[{id:'单领',name:'单领',kind:'single'}],products:p,records:[{id:'r',skuId:'冻河',member:'合成CN',quantity:2}]};
 assert.match(queryQueue(c,'排量','皇帝吧唧').reply,/双闪徽章-冻河：2/);
 assert.equal(matchProduct('内卫',p,6,{arknights:false}).length,0);assert.equal(matchProduct('Perlica',p,6,{arknights:false}).length,0);
 assert.deepEqual(matchProduct('佩丽卡',p,6,{arknights:false}).map(p=>p.id),['佩丽卡']);
});
