import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 插件目录位于应用文件夹（谷谷bot.exe 所在目录）下的“插件”子目录。
// 目录不存在、为空或某个插件损坏时都只是跳过，不影响核心功能。
export function pluginDirectory(root) {
  return path.resolve(root, '..', '..', '插件');
}

export async function loadLocalPlugins(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const plugins = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(dir, entry.name);
    const file = path.join(folder, 'plugin.mjs');
    try {
      await fs.access(file);
      const module = await import(pathToFileURL(file).href);
      const plugin = module.default;
      if (!plugin || typeof plugin !== 'object') throw Error('缺少 default 导出');
      if (!plugin.command || typeof plugin.command.pattern?.test !== 'function') throw Error('command.pattern 必须是正则');
      if (typeof plugin.reply !== 'function') throw Error('reply 必须是函数');
      if (!plugin.command.usage || !plugin.command.description) throw Error('command 需要 usage 和 description');
      plugins.push({ ...plugin, id: String(plugin.id || entry.name), dir: folder });
    } catch (error) {
      console.warn(`[插件] 已跳过 ${entry.name}：${error.message}`);
    }
  }
  return plugins;
}
