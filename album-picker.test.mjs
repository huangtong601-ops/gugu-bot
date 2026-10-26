import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {start} from './server.mjs';
import {createAlbumPicker} from './public/album-picker.js';
test('album APIs use campaign group, validate real selection, and preserve an existing binding on repeated bind',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pingu-album-picker-')),calls=[];
 await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({settings:{baseUrl:'https://example.test/v1',model:''},qqSettings:{url:'ws://127.0.0.1:12345'},qqGroups:[{id:'11111',name:'测试群'}],campaigns:[{id:'c',name:'一期',groupId:'11111',products:[],records:[],revision:0},{id:'other',name:'二期',groupId:'11111',products:[],records:[],revision:0}]}));
 const qqConnector=()=>({close(){},status:()=> '已连接',call:async(action,params)=>{assert.equal(action,'get_qun_album_list');calls.push(params);return {album_list:[{album_id:'V-actual',name:'真实相册名'}],has_more:false};}});
 const service=await start({port:0,dataDir:dir,qqConnector});
 const post=async(route,body)=>{const r=await fetch(service.url+'/api/'+route,{method:'POST',headers:{origin:service.url,'content-type':'application/json'},body:JSON.stringify(body)});return {code:r.status,data:await r.json()};};
 try{
  const list=await post('qq-albums',{campaignId:'c'});assert.equal(list.code,200);assert.equal(list.data.albums[0].name,'真实相册名');assert.equal(calls[0].group_id,'11111');
  assert.equal((await post('qq-albums',{campaignId:'c',groupId:'22222'})).code,400);
  assert.equal((await post('album-bind',{campaignId:'c',albumId:'手填错误ID'})).code,400);
  assert.equal((await post('album-bind',{campaignId:'c',albumId:'V-actual',albumName:'伪造名称'})).code,200);
  assert.equal((await post('album-bind',{campaignId:'c',albumId:'V-actual'})).code,200);
  assert.equal((await post('album-bind',{campaignId:'other',albumId:'V-actual'})).code,400);
  const stored=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(stored.albums.length,1);assert.equal(stored.albums[0].albumName,'真实相册名');
  const bound=await post('qq-albums',{campaignId:'c'});assert.equal(bound.data.albums[0].boundCampaignId,'c');
 }finally{await new Promise(r=>service.server.close(r));await fs.rm(dir,{recursive:true});}
});
test('picker ignores stale responses after group change and binds by ID while displaying album names',async()=>{
 const priorDocument=globalThis.document,priorOption=globalThis.Option;
 const elements=Object.fromEntries(['albumSelect','listAlbums','bindAlbum','albumResult'].map(id=>[id,{value:'',options:[],replaceChildren(){this.options=[];this.value='';},add(o){this.options.push(o);}}]));
 globalThis.document={getElementById:id=>elements[id]};globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
 const first={id:'one',name:'一期'},second={id:'two',name:'二期'};let selected=first,gid='11111',resolveOld;const bindings=[],requests=[];
 const api=async(route,b)=>{requests.push([route,b]);if(route==='album-bind'){bindings.push({campaignId:b.campaignId,groupId:b.groupId,albumId:b.albumId,albumName:'同名'});return {albumName:'同名'};}if(b.groupId==='11111')return new Promise(r=>resolveOld=r);return {albums:[{id:'new-a',name:'同名'},{id:'new-b',name:'同名'}]};};
 const picker=createAlbumPicker({api,action:fn=>fn(),notice(){},current:()=>selected,activeGroup:()=>gid,bindings:()=>bindings,refresh:async()=>picker.render()});
 try{
  picker.render();const old=elements.listAlbums.onclick();gid='22222';selected=second;picker.render();await elements.listAlbums.onclick();
  resolveOld({albums:[{id:'wrong-group',name:'旧群相册'}]});await old;
  assert.deepEqual(elements.albumSelect.options.map(o=>o.value),['','new-a','new-b']);assert.ok(elements.albumSelect.options[1].text.includes('同名1'));
  elements.albumSelect.value='new-b';elements.albumSelect.onchange();await elements.bindAlbum.onclick();
  assert.deepEqual(requests.at(-1),['album-bind',{campaignId:'two',groupId:'22222',albumId:'new-b'}]);assert.match(elements.albumResult.textContent,/同名/);
 }finally{globalThis.document=priorDocument;globalThis.Option=priorOption;}
});


test('refresh albums also refreshes media for the bound album before updating the page',async()=>{
 const priorDocument=globalThis.document,priorOption=globalThis.Option,elements=Object.fromEntries(['albumSelect','listAlbums','bindAlbum','albumResult'].map(id=>[id,{value:'',options:[],replaceChildren(){this.options=[];this.value='';},add(o){this.options.push(o);}}]));globalThis.document={getElementById:id=>elements[id]};globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};const calls=[];
 try{const picker=createAlbumPicker({api:async(route,body)=>{calls.push(route);if(route==='qq-albums')return {albums:[{id:'album',name:'模拟相册',boundCampaignId:'c'}]};assert.deepEqual(body,{groupId:'11111',albumId:'album'});return {photos:[]};},action:fn=>fn(),notice(){},current:()=>({id:'c'}),activeGroup:()=> '11111',bindings:()=>[{campaignId:'c',groupId:'11111',albumId:'album'}],refresh:async()=>calls.push('refresh')});picker.render();await elements.listAlbums.onclick();assert.deepEqual(calls,['qq-albums','qq-album-photos','refresh']);}finally{globalThis.document=priorDocument;globalThis.Option=priorOption;}
});
