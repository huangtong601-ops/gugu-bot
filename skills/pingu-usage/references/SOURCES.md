# 用量和费用数据依据

核对日期：2026-10-24。程序实现：`usage.mjs` 与 `server.mjs` 的 `modelResult`，查询路由在 `qq-commands.mjs`。账本在用户数据目录 `usage-ledger.json`，不是工作区导出的一部分。

- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)：usage 包含 prompt/completion/total、缓存命中/未命中及 reasoning token。标准响应没有单次实扣金额字段。
- [DeepSeek 余额](https://api-docs.deepseek.com/api/get-user-balance/)：返回账户总余额及余额币种，不能据其差额区分共享同一密钥的不同QQ群或其他程序。
- [DeepSeek 人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 与 [美元价格](https://api-docs.deepseek.com/quick_start/pricing/)：内置2026-10-24价格快照，支持deepseek-flash、两个官方兼容旧别名及deepseek-v4-pro。空闲时段人民币百万token单价依次为非缓存输入/缓存输入/输出：Flash 1/0.02/4，Pro 4.5/0.15/13.5；美元分别0.15/0.003/0.6与0.66/0.022/1.98。高峰费率为两倍。
- [2026年国务院假期安排](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)：2026年的DeepSeek峰谷判定采用北京时间周一至周五9:00–12:00、14:00–18:00，排除该日历的假期；周末不视为高峰。未覆盖年份的工作日高峰需要维护假期表，不能假定已核实。
- [OpenAI Responses](https://developers.openai.com/api/reference/typescript/resources/responses)：usage含input_tokens、output_tokens、total_tokens及细分。支持读取这些真实字段，单价由管理员配置；暂不自动推断复杂服务等级、上下文档位或缓存写入费率。
- [OpenAI Costs API](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/usage/methods/costs)：按组织的项目等维度提供账单数据，不包含应用的QQ群标识。本轮不额外索取管理密钥或按群分摊账户账单。

兼容接口若在usage中明确返回cost数值和currency，或cost={value,currency}，程序记录为“接口金额”；该扩展不是对DeepSeek/OpenAI标准响应字段的承诺。没有明确币种的cost不作为金额。人民币与美元分别展示，不做汇率换算。

价格设置按provider+基础地址+model分开保存。手动单价是每百万token的非缓存输入、缓存输入和输出价格。自动DeepSeek默认人民币，可在设置中改为美元；应选择服务商账户实际结算币种。未返回缓存细分且两项输入单价不同、含未支持的缓存写入费用时，不生成可能错误的估算。

账本仅保留本地随机编号、时间、群/期次、服务商、模型、任务种类、状态、数值用量和费用及价格快照；不保存鉴权头、密钥、提示词、图片、原始响应及错误正文。先落盘请求再调用模型，异常退出留下的请求重启后标为interrupted，避免默认为零；所有持久化串行并原子替换。启用前没有记录的历史不追溯编造；费用查询、页面刷新和模型列表查询不产生推理记录。
