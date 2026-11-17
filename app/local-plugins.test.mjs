import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadLocalPlugins, pluginDirectory } from './local-plugins.mjs';
import { processQQEvent } from './qq-commands.mjs';

const at = { type: 'at', data: { qq: '99999' } };
const say = text => ({ group_id: 11111, user_id: 12345, self_id: 99999, message: [at, { type: 'text', data: { text } }] });

test('missing plugin directory is harmless', async () => {
  const dir = path.join(os.tmpdir(), `pingu-no-plugins-${Date.now()}`);
  assert.deepEqual(await loadLocalPlugins(dir), []);
});

test('plugin directory resolves beside the application folder', () => {
  const root = 'E:\\app\\resources\\app';
  assert.equal(pluginDirectory(root), path.resolve('E:\\app\\插件'));
});

test('valid plugins load and broken folders are skipped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pingu-plugins-'));
  try {
    await fs.mkdir(path.join(dir, 'demo'));
    await fs.writeFile(path.join(dir, 'demo', 'plugin.mjs'), "export default {id:'demo',command:{pattern:/^demo$/,usage:'demo',description:'演示插件'},async reply(){return 'demo ok'}};\n");
    await fs.mkdir(path.join(dir, 'broken'));
    await fs.writeFile(path.join(dir, 'broken', 'plugin.mjs'), "export default {id:'broken'};\n");
    const plugins = await loadLocalPlugins(dir);
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].id, 'demo');
    assert.equal(plugins[0].command.usage, 'demo');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('plugin commands are routed and listed in help without touching campaign data', () => {
  const plugin = {
    id: 'demo',
    command: { pattern: /^demo$/, usage: 'demo', description: '演示插件' },
    reply: async () => 'demo ok'
  };
  const db = { qqGroups: [{ id: '11111', enabled: true }], campaigns: [{ id: 'c', name: '模拟期次', groupId: '11111', records: [] }] };
  const before = JSON.stringify(db);
  const result = processQQEvent(db, say('demo'), { plugins: [plugin] });
  assert.equal(result.pluginRequest, 'demo');
  assert.equal(result.readOnly, true);
  assert.equal(JSON.stringify(db), before);
  const help = processQQEvent(db, say('help'), { plugins: [plugin] }).reply;
  assert.match(help, /demo：演示插件/);
  assert.equal(processQQEvent(db, say('demo')).pluginRequest, undefined);
  const unaddressed = processQQEvent(db, { ...say('demo'), message: [{ type: 'text', data: { text: 'demo' } }] }, { plugins: [plugin] });
  assert.equal(unaddressed.ignored, true);
  assert.equal(unaddressed.reply, undefined);
  assert.equal(unaddressed.pluginRequest, undefined);
});
