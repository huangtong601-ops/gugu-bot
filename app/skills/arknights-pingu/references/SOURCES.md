# 分盒与角色资料来源

商品中英文印字对照：`character-labels.json` 提取自 [ArknightsGameData character_table.json](https://github.com/Kengxxiao/ArknightsGameData/blob/master/zh_CN/gamedata/excel/character_table.json)，核对日期2026-10-23，仅保留游戏数据的name与appellation字段，用于角色名称匹配，不含调价或图片位置规则。游戏资料版权属于各自权利人。

快照日期：2026-10-23。数据来源：[awadwd/ArknightsAuthorization_Series-mirror](https://github.com/awadwd/ArknightsAuthorization_Series-mirror)，commit `0611d6d26aa3630e79b03b9c1d21af2aafa17a6a`（2026-10-19）。该库 README 的统计尚写93盒，实际 Box_Id.json 有94盒，常规1.0–55.0；本项目按数据文件记录，不把README旧统计当作完整性证明。

本地转换仅保留盒号、系列、日期、角色名及公开图片链接和别名；未导入 market_price、热门标记或 guessNew_Box_Id.json 预测数据。它覆盖常规、音律、联动、特别及白名单记录，不保证囊括来源尚未收录的商品。盒图大多是分盒海报，不是每个角色的独立商品裁图。

依来源声明，整理数据适用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)，本地转换数据仍依该许可保留署名与非商业约束；商品图、游戏图版权属于各自权利人。公开分发需要带上本说明；商业使用需另行取得相应授权。本说明不改变应用自有代码的许可。

角色参考：[PRTS 干员一览](https://prts.wiki/w/干员一览)。本轮实测公开 MediaWiki API 返回 HTTP 403，故在线验证应报告不可用，不能报告已验证；用户可打开对应 PRTS 角色页人工核对。PRTS 可验证角色身份资料，不是通行证分盒的官方完整资料源。


异格与本体名称对照：`operator-forms.json`，核对日期2026-10-25。依据 [PRTS异格干员分类](https://prts.wiki/w/分类:异格干员) 的38种异格页面及其原型/档案名称，按37个本体角色分组；陈包含假日威龙陈与赤刃明霄陈。改名形态另核对 [酒神](https://prts.wiki/w/酒神)（代号傀影）、[维娜·维多利亚](https://prts.wiki/w/维娜·维多利亚)（推进之王）、[维什戴尔](https://prts.wiki/w/维什戴尔)（W）及 [凯尔希·思衡托](https://prts.wiki/w/凯尔希·思衡托)。每组保留来源页面地址。仅整理名称关系，不复制档案正文、图像或游戏数值；形态列表不代表本期在售清单。不自动更新网络，不在每次评论解析时请求外部服务。


干员外号与称呼：`operator-nicknames.json`，整理日期2026-10-25。合并既有characters.json的中文别名与本轮查阅的社区称呼记录，242个称呼、148个角色目标、9个多义称呼（含历史角色/NPC的既有对照；并非声称全为已实装干员）。逐条保留来源编号，编号到链接的映射在文件头。来源包括：[萌娘百科·干员外号](https://moegirl.icu/zh/明日方舟/梗)、[石中火·干员们的昵称](https://www.taptap.cn/moment/464732177255366709)、[2033cl·游戏常见术语及解释](https://www.taptap.cn/moment/201296186496255596)、[雅致玉泉·整理一下各个干员的外号](https://www.taptap.cn/moment/26962781244754400)、[明日方舟吧·黑话科普](https://tieba.baidu.com/p/9703032064)。TapTap资料分别发布/修改于2020–2023年，旧外号不能证明目前唯一含义；新旧多义信息合并，未复制正文梗源说明或图片，不导入角色强度、市场价、攻击性回复话术。原资料快照别名继续保留原CC BY-NC 4.0署名约束，外号按事实关系重整，不将任何社区列表宣称为官方或完备标准。
