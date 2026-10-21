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

只在上传体验版前跑。日常改功能后跑 `/smoke-test`；纯规则（比分、名额、鸽子、时间窗）跑 `/unit-test`。

## 前置（一次性，缺了会预检失败）

1. 云函数 `api` 已部署含 `testSetup` 的版本（`npm run deploy:cloud -- --envId=xxx`）。这次 skill 本身不部署。
2. 云开发控制台 → 云函数 `api` → 环境变量，配置 `REGRESSION_KEY`，值与 `doc/project/secrets.local.json` 的 `regressionKey` 相同。不要把密钥写进代码、文档或报告。
3. 开发者工具里登录**授权人**微信号。回归中途会把这个号降成管理员、普通用户、未注册，跑完自动恢复。

## 执行

在 `codeBase/` 下做。不要改业务代码，不要改密钥文件，不要手动调 `setAdmin`（脚本用 `testSetup` 和假 openid 覆盖授权链路）。

1. 若 `node -e "require('miniprogram-automator')"` 失败，在 `codeBase/` 执行 `npm install --save-dev miniprogram-automator`。只装项目依赖，不装全局包。
2. 确认 `9421` 在监听。没有的话后台启动自动化端口，再等它起来（最多约 30 秒）：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
  --project "$(pwd)" --auto-port 9421
```

端口换了就设 `AUTO_WS`。
3. 跑 `npm run regression`。脚本连上 `ws://127.0.0.1:9421`，用当前登录身份调云函数 `api`。第一条失败即停，控制台是 `FAIL <用例ID> <原因>`。
4. 阶段顺序（日志里的 `--- 阶段 X ---`）：

| 阶段 | 身份 | 做什么 |
| --- | --- | --- |
| 预检 | 授权人 | `testSetup ping`、`me.canGrantAdmin`、快照写到 `scripts/.regression-snapshot.json` |
| A | 授权人，中途降成纯管理员 | 授权矩阵、`ensureOwner`、我的页无授权卡（R-UI-005） |
| B | 管理员 | 建「回归」活动、满员与改报、轮次、贡献、统计增量、已开赛页「记录数据」 |
| C | 普通用户 | 管理类接口拒绝、取消报名、活动页无「记录数据」 |
| D | 恢复成授权人 | 删轮次、月/季/年统计、`homeSummary` |
| E | 未注册（库里另有管理员，避免变成首个授权人） | 游客可读列表和统计、注册引导、再注册后改名，然后再次注销 |
| F | 快照恢复 | 姓名/球队/isAdmin/canGrantAdmin/头像与快照一致、授权卡、删活动并核对进球回到基线 |

5. 失败时看第一条 `FAIL`。端口、依赖、工具没开、密钥未配或不一致、登录的不是授权人，修好再跑。云函数断言失败说明业务有 bug，停下来报告，不要改业务代码、不要放宽断言来让测试过。
6. 进程正常退出时，`finally` 会尝试从快照恢复身份并删掉还在 `activityIds` 里的回归活动；日志出现「身份已从快照恢复（finally）」时，人已经回到跑前档案，快照文件仍留着。进程被 kill、`finally` 没跑完、自己变成未注册或普通用户时，再跑 `npm run regression:restore`。没有快照文件时这条命令会打印「没有快照文件，无需恢复」并退出。
7. 按下面的格式回复。`PASS` 和通过数抄脚本输出，不要手写没跑过的通过。

## 报告

```markdown
## 回归结果：通过 / 失败

登录身份：（预检 snapshot saved for 后面的姓名）　通过数：N

| 阶段 | 结果 |
| --- | --- |
| 预检 | PASS |
| A 授权人 | PASS |
| B 管理员 | PASS |
| C 普通用户 | PASS |
| D 恢复管理员 | PASS |
| E 未注册 | PASS |
| F 恢复与清理 | PASS |

身份：（已恢复 / finally 已恢复，快照仍在 / 未恢复，需要 regression:restore）

手工用例（doc/test-cases.md 的 M-01~M-05）不在脚本内，上线前人工过。
```

失败时把第一条 `FAIL` 原文放在表后面，写最可能的原因（端口、不是授权人、`REGRESSION_KEY` 未配或不一致、云函数未部署 `testSetup`、业务 bug）。表里失败阶段之后的行写「未跑」。

## 边界

- 自建活动标题以「回归」开头。全部通过后删除并级联清理贡献；中途失败时 `finally` 会再删一遍还留着的活动，删不掉就留在库里，不要为回归去手动清数据库。
- 假 openid `regression_fake_openid` 每次相关用例前会清掉再建，跑完 `removeFake`。
- 统计用跑前跑后增量（R-STAT-002、R-STAT-006），同一月可以重跑。
- 页面断言只覆盖身份显隐（R-UI-001~005），不做完整 UI 遍历。真二号微信、空库首个注册人、首页榜单切换、头像上传、授权开关点击见手工用例 M-01~M-05。
- `scripts/.regression-snapshot.json` 是当次运行状态，含本人档案。不要提交，不要写进报告。
- 新增云函数接口时：smoke 加一条检查；regression 按身份矩阵补用例，用例 ID 同步进 `doc/test-cases.md`。`:setup` 后缀是数据准备，不是独立用例。
