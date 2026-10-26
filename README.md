# 谷谷bot

<img src="app/public/app-logo.svg" alt="谷谷bot" width="112">

面向拼谷团长的Windows桌面工具：商品图片建档、QQ群相册评论排表、下单规划与肾表导出。

## 下载使用

1. 打开本仓库 [Releases](https://github.com/huangtong601-ops/gugu-bot/releases/latest)，下载 `gugu-bot-v版本号-win32-x64.zip`。
2. 完整解压，双击文件夹内的 **谷谷bot.exe**。EXE旁边的文件必须一起保留。
3. 按首次引导配置自己的模型API，选择模型版本。图片识别需要支持图片输入的模型。
4. 前往 [NapCat 官方仓库发布页](https://github.com/NapNeko/NapCatQQ/releases/latest)，下载 [NapCat.Shell.Windows.Node.zip](https://github.com/NapNeko/NapCatQQ/releases/latest)，完整解压，在程序中选择它的文件夹，再完成QQ登录与连接。
5. 选择需要管理的群，新建期次，识别并核对商品、保存商品，绑定群相册，并确认图片对应的大类。

发布包不含任何账号、登录态、API密钥、群聊、商品建档、订单或排表数据。首次运行从空白工作区开始。NapCat和QQ运行环境由使用者自行下载并登录。

## 主要功能

- 一次导入最多10张商品图，核对后保存；支持仅识别文字。
- 自建单领或拼团大类，按分盒管理；通行证支持调价/固定价。
- 读取QQ群相册评论，按图片关联的大类范围匹配制品，按评论原时间入表。
- CN登记、常见角色外号和制品别名、数量、“各一”及群外代排解析；有歧义时人工核对。
- 群内查询排量、余量、个人排表及术语；余量需先设置拼团总配数。
- 特典门槛支持1至5档，生成逐单规划并记录实际付款。
- 按确认的实付、购物金和特典抵扣计算，导出分类排表和个人肾表。
- 支持业务撤销、自动备份恢复，以及可选的自建服务器模式。

## 从源码启动

需要Node.js 24+、npm和Windows x64。

```powershell
npm ci
npm test
npm run start:isolated
```

`start:isolated`将数据放在本仓库下被Git忽略的`.local-profile/`，适合从零试用。`npm start`使用Windows用户目录中的既有`pingu-desk`配置；该名称为兼容历史版本而保留。不要将这个目录上传。

## 项目结构

- `app/`：应用代码与测试，集中放置业务、数据、安全和桌面入口。
- `app/public/`：界面和本地静态资源。
- `app/skills/`：业务规则与公开角色/分盒参考资料。
- `app/assets/`：应用图标与术语初始文件。
- `app/scripts/`：只使用合成数据的隔离界面验证脚本，可通过`npx electron app/scripts/check-setup-guide.cjs`运行。
- `docs/`：服务器接入和版本发布说明。
- `release-tools/`：隐私检查、Windows打包、校验及版本维护。
- `.github/workflows/release.yml`：推送版本标签后创建或补齐GitHub Release。

## 版本发布

按[发布流程](docs/RELEASING.md)更新版本和[更新说明](CHANGELOG.md)，然后推送对应`vX.Y.Z`标签。工作流运行测试、构建干净Windows包并附上SHA256校验文件。仓库源码和Release必须保持对应。

## 数据与反馈

应用凭据和业务数据保存在使用者本机，模型识别会将主动提交的图片/文字发送给所选API服务。提交Issue时请使用复现步骤及合成数据，不附密钥、二维码、真实群聊截图或工作区JSON。

通用群指令以机器人`help`回复为准。正式删评撤排、交肾到账登记等尚未实现的流程不在功能承诺中。服务器说明见[服务器接入](docs/服务器接入.md)。

第三方资料及图标说明见[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。项目整体源码许可尚待维护者指定；公开可见不代表对全部内容授予统一许可。

