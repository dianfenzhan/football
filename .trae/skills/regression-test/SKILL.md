---
name: regression-test
description: >-
  Runs the football miniprogram full regression test (all identities x all API
  actions) through WeChat DevTools and reports pass or fail. Use when the user
  asks to run regression-test, 回归测试, 全量测试, or verify everything is OK
  before a release.
disable-model-invocation: true
---

# regression-test

对「周三快乐足球联队」小程序跑全量回归：未注册 / 普通用户 / 管理员 / 授权人四种身份 × 全部云函数 action × 关键页面显隐。用例以 `codeBase/scripts/regression-test.js` 为准，含义索引见 `doc/test-cases.md`（每条断言带用例 ID）。

只在上传体验版前跑；日常改功能后跑的是 `/smoke-test`。

## 前置（一次性，缺了会预检失败）

1. 云函数 `api` 已部署含 `testSetup` 的版本（`npm run deploy:cloud -- --envId=xxx`）。
2. 云开发控制台 → 云函数 `api` → 环境变量，配置 `REGRESSION_KEY`，值与 `doc/project/secrets.local.json` 的 `regressionKey` 相同。不要把密钥写进代码或文档。
3. 开发者工具里登录**授权人**微信号（回归中途会切换这个号的身份，跑完自动恢复）。

## 执行

在 `codeBase/` 下做。不要改业务代码，不要手动调 `setAdmin`（脚本会用假 openid 覆盖授权链路）。

1. 确认 `9421` 在监听。没有的话后台启动自动化端口，再等它起来（最多约 30 秒）：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
  --project "$(pwd)" --auto-port 9421
```

端口换了就设 `AUTO_WS`。
2. 跑 `npm run regression`。脚本先快照自己的档案到 `scripts/.regression-snapshot.json`，然后按 授权人 → 管理员 → 普通用户 → 未注册 → 恢复 的顺序跑，全部通过打印 `ALL N CHECKS PASSED`。
3. 失败时看第一条 `FAIL <用例ID>`，到 `doc/test-cases.md` 查该 ID 的含义。端口、依赖、密钥未配、登录身份不对，修好再跑；云函数断言失败说明业务有 bug，停下来报告，不要改业务代码来让测试过。
4. 脚本被 kill 或异常中断导致身份没恢复（自己变成未注册/普通用户），跑 `npm run regression:restore` 从快照强制还原。

## 报告

```markdown
## 回归结果：通过 / 失败

登录身份：（预检 me 的姓名）　通过数：N

| 阶段 | 结果 |
| --- | --- |
| 授权人 / 管理员 / 普通用户 / 未注册 / 恢复清理 | PASS |

手工用例（doc/test-cases.md 的 M-01~M-05）不在脚本内，上线前人工过。
```

失败时把 `FAIL` 原文放在表后面，写最可能的原因（端口、非授权人、REGRESSION_KEY 未配或不一致、云函数未部署、业务 bug）。

## 边界

- 自建活动标题以「回归」开头，收尾删除并级联清理；统计用跑前跑后增量断言，同月可重跑。
- 假 openid `regression_fake_openid` 的数据每次跑前自清，不为回归去手动清数据库。
- 页面断言只覆盖身份显隐（5 条），不做完整 UI 遍历；真二号微信体验见手工用例 M-02。
