# 版本与Release同步

每次正式版本更新必须同时发布对应源码标签和Windows Release。

1. 完成功能修改，运行`npm test`与相关隔离界面验证。
2. 执行`npm run version:sync -- X.Y.Z`，仅接受递增的三段版本号。
3. 补写CHANGELOG中该版本的功能和修复；不记录真实用户、群或本机路径。
4. 运行`npm run audit:public`，检查待提交文件，确认没有用户数据和秘密。
5. 运行`npm run release:build`、`npm run release:verify`。首次使用`npm ci`安装开发依赖。
6. 提交修改，创建`vX.Y.Z`标签并推送分支及标签。标签版本须和package.json相同。
7. 检查Actions的Release任务成功，Release包含Windows ZIP、源码ZIP及SHA256SUMS.txt。

```powershell
git add .
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

GitHub Actions使用仓库提供的短期GITHUB_TOKEN，不要求把个人令牌写入文件。权限仅在Release任务授予contents:write。手动重跑已有标签时保留原Release及同名已上传资产，只补缺失项；需要改变功能或修复时发布新版本，不用同名标签覆盖旧代码。

本机构建输出位于dist/，不能提交Git。自测数据使用独立用户目录，不要把自己日常配置复制到包内。发布验证报告只记录状态/计数/摘要，不写真实业务内容。

相关Action说明：[checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)。

