import {test} from 'node:test';import assert from 'node:assert/strict';
import {connectionSummary} from './public/qq-connection.js';
test('QQ overview distinguishes unconfigured, disconnected, verified online and actually logged out',()=>{
 assert.equal(connectionSummary({}).configured,false);assert.equal(connectionSummary({}).label,'未配置');
 const configured={qqSettings:{url:'ws://127.0.0.1:3019'},qq:{connected:false}};
 assert.equal(connectionSummary(configured,{qq:'123456',online:true}).label,'连接已断开');assert.equal(connectionSummary(configured,{qq:'123456'}).title,'QQ 123456');
 const connected={...configured,qq:{connected:true}};
 assert.equal(connectionSummary(connected,{qq:'123456',online:true}).label,'在线');assert.equal(connectionSummary(connected,{qq:'123456',online:false}).label,'QQ 未登录');
 assert.equal(connectionSummary(connected,{},true).label,'正在确认');assert.equal(connectionSummary(connected,{error:true}).label,'检查失败');
});
test('an open gateway alone never proves QQ online or supplies an arbitrary account label',()=>{
 const s={qq:{connected:true},qqSettings:{url:'ws://127.0.0.1:3019'}};
 assert.notEqual(connectionSummary(s).tone,'online');assert.notEqual(connectionSummary(s,{error:true,qq:'not-a-QQ'}).tone,'online');
 assert.equal(connectionSummary(s,{qq:'not-a-QQ'}).title,'已保存机器人连接');assert.notEqual(connectionSummary(s,{online:true}).tone,'online');assert.notEqual(connectionSummary(s,{qq:'not-a-QQ',online:true}).tone,'online');
});
