import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..', '..', '..', '插件');
let entries = [];
try {
  entries = fs.readdirSync(pluginRoot, { withFileTypes: true });
} catch {
  console.log('没有插件目录，跳过插件测试。');
  process.exit(0);
}
const files = entries
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(pluginRoot, entry.name, 'plugin.test.mjs'))
  .filter(file => fs.existsSync(file));
if (!files.length) {
  console.log('没有插件测试文件，跳过。');
  process.exit(0);
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
