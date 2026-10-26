# 维护约定

- 先读README、CHANGELOG和docs/RELEASING.md。
- 不提交任何用户工作区、账号、密钥、订单、排量、截图、日志、备份或第三方运行环境。测试只使用合成数据。
- 业务代码修改后运行npm test；发布前还需npm run audit:public、npm run release:build及npm run release:verify。
- 正式版本更新须同步package.json、CHANGELOG、版本标签和GitHub Release的Windows发布包及校验文件；不能只更新源码而遗漏Release。
- 标签版本必须等于package.json版本。已发布版本不覆盖，新版本递增。
- 默认不结束或重启使用者正在运行的程序。需要时先取得同意，并核对可见窗口。
- 保留数据目录和身份标识的兼容性。应用数据属于使用者，不应成为发布材料。
- 保留skills内公开资料的来源及许可说明。不要将项目代码许可扩张到游戏、商品图片或第三方资料。

