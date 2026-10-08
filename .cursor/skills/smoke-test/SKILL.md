---
name: smoke-test
description: >-
  Runs the football miniprogram API smoke test through WeChat DevTools and
  reports pass or fail. Use when the user asks to run smoke-test, 冒烟测试,
  or check whether the miniprogram basically works.
disable-model-invocation: true
---

# smoke-test

对「周三快乐足球联队」小程序跑一遍云函数冒烟，判断基本路径是否通过。检查项以 `codeBase/scripts/smoke-test.js` 为准，例子说明见 `doc/smoke-tests.md`。

## 执行

在 `codeBase/` 下做。不要部署云函数，不要改 `.env` 或密钥，不要调用 `setAdmin`。

1. 若 `node -e "require('miniprogram-automator')"` 失败，在 `codeBase/` 执行 `npm install --save-dev miniprogram-automator`。只装项目依赖，不装全局包。
2. 确认 `9421` 在监听。没有的话后台启动自动化端口，再等它起来（最多约 30 秒）：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
  --project "$(pwd)" --auto-port 9421
```

开发者工具里要登录一个**已经是管理员**的微信号。端口换了就设 `AUTO_WS`。
3. 跑 `npm run smoke`。脚本连上 `ws://127.0.0.1:9421`，用当前登录身份调云函数 `api`。
4. 失败时看第一条 `FAIL`。端口、依赖、工具没开，修好再跑一次。云函数报「未部署」或身份错误，停下来说明原因，不要改业务代码。
5. 按下面的格式回复。`PASS` 行抄脚本输出，不要手写没跑过的通过。

## 报告

```markdown
## 冒烟结果：通过 / 失败

登录身份：（脚本里 admin 那一行的姓名）

| 检查 | 结果 |
| --- | --- |
| me | PASS |

未覆盖：第二个微信号报名、满员拒绝、授权或取消管理员。
通过后脚本会删掉这场冒烟活动。中途失败时，活动可能还在，报名会在收尾时取消。
```

失败时把 `FAIL` 原文放在表后面，并写最可能的原因（端口、不是管理员、云函数未部署、统计增量对不上）。

## 边界

- 统计用跑前跑后的增量，同一月可以重复跑。
- 每次会新建活动，全部通过后删掉。不要为了冒烟去清数据库。
- 页面点击不在这次范围内。
