---
name: unit-test
description: >-
  Runs the football miniprogram pure-rule unit tests with Node's built-in
  test runner. Use when the user asks for unit-test, 单元测试, npm test, or
  to check score, quota, period, or ranking rules before smoke.
disable-model-invocation: true
---

# unit-test

对云函数里不碰数据库的规则跑 `node --test`。不部署，不开开发者工具，不连云。

规则在 `codeBase/cloudfunctions/api/rules.js`，用例在 `codeBase/test/rules.test.js`。`rules.js` 会被云函数 `index.js` 引用，会跟着部署走；测试文件不要放进 `cloudfunctions/api/`。

## 执行

在 `codeBase/` 下跑 `npm test`。

失败时看第一条 `not ok`。断言或规则写错就改对应文件再跑，直到通过。不要为了变绿去放宽断言。不要 mock `wx-server-sdk`。

通过后按下面的格式回复。数字抄脚本输出。

## 报告

```markdown
## 单元测试：通过 / 失败

| 项 | 结果 |
| --- | --- |
| 用例 | 12 pass / 0 fail |
| 命令 | npm test |

未覆盖：报名事务、满员、管理员权限、云数据库、页面点击。这些走 `/smoke-test` 和 `/regression-test`。
```

失败时把第一条断言差异放在表后面。

## 改规则时

行为变了，规则和用例一起改。新增纯函数时导出它，并在 `rules.test.js` 加断言。时间用固定的 `+08:00` 时刻，不要用 `Date.now()`。

仍交给冒烟或回归的：云数据库读写、事务、身份、页面。
