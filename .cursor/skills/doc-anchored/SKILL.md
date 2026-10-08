---
name: doc-anchored
description: >-
  Aligns doc/features.md and doc/smoke-tests.md with the football miniprogram
  code. Use when the user asks for doc-anchored, 对齐文档, 功能文档, or to
  update the feature list or smoke-test examples after code changes.
disable-model-invocation: true
---

# doc-anchored

代码是事实来源。两份文档只记录代码里已经有的行为和冒烟断言。

- 功能：`doc/features.md`
- 冒烟例子：`doc/smoke-tests.md`

## 执行

1. 读这两份文档。
2. 从代码提取，不要凭记忆补：
   - `codeBase/cloudfunctions/api/index.js` 里 `action ===` 的全部分支，以及每个 action 的权限和失败条件
   - `codeBase/miniprogram/app.json` 的页面
   - `codeBase/miniprogram/pages/**/*.js` 里的 `call('...')`
   - `codeBase/scripts/smoke-test.js` 里每个 `assertOk`、`assertFail`、`pass` 的名字和紧挨着的断言
3. 对照后只改文档：
   - 代码有、文档没有：补进行，用代码里的条件写通过标准
   - 文档有、代码没有：删掉该行
   - 行为变了：改该行
4. 保留文档里仍成立的前提、标题和「不测」。代码若开始覆盖某条「不测」，把那条移到断言表。
5. 不改业务代码，不改 `smoke-test.js`，不部署，不跑冒烟。用户明确要求改代码时另说。

## 报告

```markdown
## 文档对齐：无差异 / 已更新

| 文档 | 变更 |
| --- | --- |
| doc/features.md | 无，或具体行 |
| doc/smoke-tests.md | 无，或具体行 |
```

有更新时列出 action、页面调用或检查名，不贴大段文档。
