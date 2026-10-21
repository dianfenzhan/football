# 全量回归测试用例

> 自动化实现以 `codeBase/scripts/regression-test.js` 为准（`npm run regression`），本表是用例含义的索引。
> 每条用例有唯一 ID，脚本断言通过时打印 `PASS <ID>`，失败时第一条 `FAIL <ID>` 即停。
> 身份列：U = 未注册，R = 普通用户，A = 管理员（非授权人），O = 授权人，任何 = 与身份无关。
> 「smoke」列 = 该场景已被 `npm run smoke` 覆盖（见 `doc/smoke-tests.md`），回归里保留是为了矩阵完整。

## 身份怎么造

- 单微信号（开发者工具登录的授权人账号）+ 云函数 `testSetup` action 切换自己的身份状态（删档 → U、降级 → R/A、恢复快照 → O）。
- 「第二个人」用固定假 openid `regression_fake_openid` 造数据（队员、报名），不依赖第二个微信号。
- `testSetup` 仅当云函数配置了 `REGRESSION_KEY` 环境变量且入参匹配才执行；密钥在 `doc/project/secrets.local.json` 的 `regressionKey`。
- 跑前快照自己的 `users` 记录到 `codeBase/scripts/.regression-snapshot.json`，结束恢复；中断后跑 `npm run regression:restore`。

## 注册与身份（R-REG）

| ID | 身份 | 操作 | 预期 | smoke |
| --- | --- | --- | --- | --- |
| R-REG-001 | U | `me` | `user` 为 `null` | |
| R-REG-002 | U | `saveProfile` 空名 | 拒绝「请填写姓名」 | ✓ |
| R-REG-003 | U | `saveProfile` 正常注册（已有其他管理员在库） | 成功，`isAdmin=false`、`canGrantAdmin=false` | |
| R-REG-004 | R | `saveProfile` 改名 | 回读姓名已更新 | |
| R-REG-005 | R | `me` | `isAdmin=false` | |
| R-REG-006 | A | `me` | `isAdmin=true` 且 `canGrantAdmin=false` | |
| R-REG-007 | O | `me` | `canGrantAdmin=true` | |
| R-REG-008 | O | 恢复快照后 `me` | 姓名/球队/isAdmin/canGrantAdmin/头像与快照一致 | |
| R-REG-009 | 任何 | `listPlayers` | 按 `createdAt` 倒序、含自己、带头像字段 | ✓ |

不自动化：首个注册用户自动成为管理员+授权人（R-REG-003 的镜像场景）需清空 `users` 集合，破坏性太强，见手工 M-01。

## 授权（R-AUTH）

| ID | 身份 | 操作 | 预期 | smoke |
| --- | --- | --- | --- | --- |
| R-AUTH-001 | O | `listMembers` | 成功返回队员列表 | ✓ |
| R-AUTH-002 | A | `listMembers` | 拒绝「只有授权人」 | ✓ |
| R-AUTH-003 | R | `listMembers` | 拒绝 | |
| R-AUTH-004 | O | `setAdmin` 授权假队员 | 成功 | |
| R-AUTH-005 | O | `setAdmin` 取消假队员 | 成功 | |
| R-AUTH-006 | O | `setAdmin` 改自己 | 拒绝 | |
| R-AUTH-007 | A | `setAdmin` | 拒绝「只有授权人」 | |
| R-AUTH-008 | U | `listMembers` | 拒绝 | |
| R-AUTH-009 | A | 库中无授权人时调 `me` | 最早注册的管理员被自动补为授权人 | |
| R-AUTH-010 | O | `setAdmin` 目标 userId 不存在 | 拒绝 | |
| R-AUTH-011 | O | `setAdmin` 目标是授权人 | 拒绝「不能修改授权人」 | |
| R-AUTH-012 | U | `setAdmin` | 拒绝 | |

## 活动（R-ACT）

| ID | 身份 | 操作 | 预期 | smoke |
| --- | --- | --- | --- | --- |
| R-ACT-001 | A | `createActivity` 正常 | 成功，返回 `activityId` | ✓ |
| R-ACT-002 | R | `createActivity` | 拒绝「只有管理员」 | |
| R-ACT-003 | U | `createActivity` | 拒绝（需先注册） | |
| R-ACT-004 | A | `createActivity` 无标题 | 拒绝 | |
| R-ACT-005 | A | `createActivity` 无地点 | 拒绝 | |
| R-ACT-006 | A | `createActivity` 无时间 | 拒绝 | |
| R-ACT-007 | A | `createActivity` 名额 0 | 拒绝（1~30） | |
| R-ACT-008 | A | `createActivity` 名额 31 | 拒绝（1~30） | |
| R-ACT-009 | A | `updateQuota` 扩到 2 | 成功 | ✓ |
| R-ACT-010 | A | `updateQuota` 低于已报人数 | 拒绝 | |
| R-ACT-011 | A | 已开始活动 `updateQuota` | 拒绝「活动已开始」 | |
| R-ACT-012 | A | `updateQuota` 名额 0 | 拒绝 | ✓ |
| R-ACT-013 | A | `updateQuota` 非法球队 | 拒绝「参数不完整」 | |
| R-ACT-014 | R | `updateQuota` | 拒绝 | |
| R-ACT-015 | R | `deleteActivity` | 拒绝 | |
| R-ACT-016 | A | `deleteActivity` 后查详情 | 删除成功，详情拒绝 | ✓ |
| R-ACT-017 | A | `activityDetail` | 含 `members` 简表；报名列表带布尔 `isAdmin` | ✓ |
| R-ACT-018 | R | `activityDetail` | `members` 为空数组 | |
| R-ACT-019 | U | `listActivities` | 游客可查列表 | |

## 报名（R-SIGN）

| ID | 身份 | 操作 | 预期 | smoke |
| --- | --- | --- | --- | --- |
| R-SIGN-001 | A | `signup` | 成功 | ✓ |
| R-SIGN-002 | A | 重复 `signup` | 拒绝「你已经报名了」 | ✓ |
| R-SIGN-003 | U | `signup` | 拒绝（需先注册） | |
| R-SIGN-004 | A | 假人占满本队名额后 `signup` | 拒绝「这个队已经满员」 | |
| R-SIGN-010 | A | 本队满员后带另一队 `teamId` 报名 | 成功；`me.user.teamId` 仍为主队；报名行 `teamId` 为另一队 | ✓ |
| R-SIGN-011 | A | `signup` 传非法 `teamId` | 拒绝「请选择球队」 | ✓ |
| R-SIGN-012 | A | 改报后 `saveProfile`（姓名球队不变） | 该场报名行的 `teamId` 仍为改报的队 | ✓ |
| R-SIGN-005 | R | `cancelSignup` | 成功 | ✓ |
| R-SIGN-006 | R | 再次 `cancelSignup` | 拒绝「你还没有报名」 | ✓ |
| R-SIGN-007 | U | `cancelSignup` | 拒绝 | |
| R-SIGN-008 | 任何 | 已开始活动 `signup` | 拒绝「活动已开始」 | |
| R-SIGN-009 | 任何 | 已开始活动 `cancelSignup` | 拒绝「活动已开始」 | |

## 轮次（R-RND）

| ID | 身份 | 操作 | 预期 | smoke |
| --- | --- | --- | --- | --- |
| R-RND-001 | A | `saveRound` 2:1 | 成功，返回 `roundId` | ✓ |
| R-RND-002 | R | `saveRound` | 拒绝 | |
| R-RND-003 | A | `deleteRound` | 成功 | ✓ |
| R-RND-004 | A | `saveRound` 比分 -1 | 拒绝（0~99） | |
| R-RND-005 | A | `saveRound` 比分 100 | 拒绝（0~99） | |
| R-RND-006 | R | `deleteRound` | 拒绝 | |

## 贡献与出勤（R-CONT）

| ID | 身份 | 操作 | 预期 | smoke |
| --- | --- | --- | --- | --- |
| R-CONT-001 | A | `setContribution` 1 球 1 助攻 | 成功 | ✓ |
| R-CONT-002 | A | `setContribution` 未建档 openid | 拒绝「找不到这个队员」 | ✓ |
| R-CONT-003 | A | `setContribution` 进球 100 | 拒绝（0~99） | |
| R-CONT-004 | R | `setContribution` | 拒绝 | |
| R-CONT-005 | A | 清零后 `setAbsent` 鸽子 | 成功 | ✓ |
| R-CONT-006 | A | 有进/助攻时 `setAbsent` 鸽子 | 拒绝「鸽子的情况下，进球和助攻得是 0」 | ✓ |
| R-CONT-007 | A | `setAbsent` 未建档 openid | 拒绝 | ✓ |
| R-CONT-008 | R | `setAbsent` | 拒绝 | |
| R-CONT-009 | A | `setAbsent` 取消鸽子 | 成功 | |
| R-CONT-010 | A | `deleteContribution` | 成功，详情里该记录消失 | |
| R-CONT-011 | A | `setContribution` 清零 | 成功 | ✓ |

## 统计（R-STAT）

| ID | 身份 | 操作 | 预期 | smoke |
| --- | --- | --- | --- | --- |
| R-STAT-001 | 任何 | `stats` 月/季/年 | 结构正确：`list` 数组、两支球队 | ✓ |
| R-STAT-002 | 任何 | 记 2 球后 `stats` 按球队过滤 | 本队 +2，他队不变 | ✓ |
| R-STAT-003 | 任何 | `stats` 季度 5 / 月份 13 / 缺年份 | 均拒绝 | |
| R-STAT-004 | 任何 | `homeSummary` span=`6m` / 非法值 | 合法回显；非法回落 `3m` | |
| R-STAT-007 | 任何 | `homeSummary` 传本队 `teamId` | 回显该 `teamId`；榜单按该队过滤 | ✓ |
| R-STAT-008 | 任何 | 报名后 `homeSummary` | `nextActivity.signedTeamId` 为本场报名队 | ✓ |
| R-STAT-005 | U | `stats` | 游客可查 | |
| R-STAT-006 | A | 删除有贡献的活动后 `stats` | 进球数回到基线（级联删贡献） | |

## 页面显隐（R-UI，automator 翻页断言）

| ID | 身份 | 页面 | 预期 |
| --- | --- | --- | --- |
| R-UI-001 | U | 活动详情 | 显示「一键微信注册即报名」引导 |
| R-UI-002 | R | 活动详情 | 无「记录数据」卡，有「立即报名」按钮 |
| R-UI-003 | A | 活动详情（已开赛） | 有「记录数据」卡（未开赛活动不显示） |
| R-UI-004 | O | 我的 | 有「授权管理员」卡 |
| R-UI-005 | A | 我的 | 显示「你是管理员。」，无授权卡 |

## 手工用例（上线前人工过，不在脚本里）

| ID | 场景 | 步骤 | 预期 | 不自动化的原因 |
| --- | --- | --- | --- | --- |
| M-01 | 首个注册用户 | 空库（或测试环境）注册第一个用户 | 自动成为管理员+授权人 | 需清空 `users` 集合，破坏真实数据 |
| M-02 | 真二号微信 | 队友微信扫体验版码 → 打开分享卡片 → 一键注册并报名 → 取消报名 | 全流程顺畅；取消时状态条内嵌按钮触发确认弹窗，确认后回到未报名 | automator 控制不了第二个微信号 |
| M-03 | 首页榜单 | 首页切换 3m/6m/1y/2y/3y | 三榜（进球/助攻/鸽子）随区间变化 | 纯 UI 切换，API 已被 R-STAT-004 覆盖 |
| M-04 | 头像上传 | 注册/资料页选微信头像 → 保存 | 头像传到云存储并回显在名单/统计里 | `chooseAvatar` 需真人授权操作 |
| M-05 | 授权开关 UI | 我的页对队员拨 switch | 开关生效、toast 提示、失败回滚 | 已被 R-AUTH-004/005 覆盖 API，UI 点击抽验即可 |

## 与 smoke 的分工

- `npm test`：纯规则（比分、名额、鸽子、东八区时间窗、榜单汇总），不连云、不开开发者工具。代码在 `codeBase/cloudfunctions/api/rules.js`，用例在 `codeBase/test/rules.test.js`。跑法用 skill `unit-test`。
- `npm run smoke`：每次改功能后跑，快，验证主路径没坏。检查项见 `doc/smoke-tests.md`。
- `npm run regression`：上线体验版前跑，全量身份矩阵 + 页面显隐。中途会切换自己的身份，**必须用授权人账号登录开发者工具**，跑完自动恢复；异常中断跑 `npm run regression:restore`。
- 新增云函数接口时：smoke 加一条检查（项目规则），regression 按身份矩阵补用例并更新本表。
