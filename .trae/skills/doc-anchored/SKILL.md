---
name: doc-anchored
description: >-
  Aligns doc/features.md, doc/smoke-tests.md and doc/test-cases.md with the
  football miniprogram code. Use when the user asks for doc-anchored, 对齐文档,
  功能文档, or to update the feature list, smoke-test examples or regression
  test cases after code changes.
disable-model-invocation: true
---

# doc-anchored

代码是事实来源。三份文档只记录代码里已经有的行为和测试断言。

- 功能：`doc/features.md`
- 冒烟例子：`doc/smoke-tests.md`
- 回归用例索引：`doc/test-cases.md`

## 执行

1. 读这三份文档。
2. 从代码提取，不要凭记忆补：
   - `codeBase/cloudfunctions/api/index.js` 里 `action ===` 的全部分支，以及每个 action 的权限和失败条件
   - `codeBase/miniprogram/app.json` 的页面
   - `codeBase/miniprogram/pages/**/*.js` 里的 `call('...')`
   - `codeBase/scripts/smoke-test.js` 里每个 `assertOk`、`assertFail`、`pass` 的名字和紧挨着的断言
   - `codeBase/scripts/regression-test.js` 里每个 `ok`、`no`、`is` 的用例 ID（`R-XXX-NNN`）和紧挨着的操作与预期；`:setup` 后缀的是数据准备，不是独立用例，不进表
3. 对照后只改文档：
   - 代码有、文档没有：补进行，用代码里的条件写通过标准
   - 文档有、代码没有：删掉该行
   - 行为变了：改该行
   - `test-cases.md` 的「smoke」勾选列：smoke 脚本里出现了同名场景就勾上，消失就取消
4. 保留文档里仍成立的前提、标题和「不测」。代码若开始覆盖某条「不测」，把那条移到断言表。
5. 不改业务代码，不改 `smoke-test.js`、`regression-test.js`，不部署，不跑测试。用户明确要求改代码时另说。

## 报告

```markdown
## 文档对齐：无差异 / 已更新

| 文档 | 变更 |
| --- | --- |
| doc/features.md | 无，或具体行 |
| doc/smoke-tests.md | 无，或具体行 |
| doc/test-cases.md | 无，或具体用例 ID |
```

有更新时列出 action、页面调用、检查名或用例 ID，不贴大段文档。
