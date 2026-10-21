# 冒烟测试例子

以 `codeBase/scripts/smoke-test.js` 为准。跑法用 skill `smoke-test`。文档对齐用 skill `doc-anchored`。
冒烟只管主路径；上线体验版前的全量身份矩阵见 `doc/test-cases.md`（`npm run regression`）。

前提：开发者工具自动化端口已开，登录微信号已经是管理员。每次新建一场标题以「冒烟」开头的活动。收尾时取消报名并删掉这场活动及其名额、报名、比分和进球助攻缺勤；中途失败也尽力删除。

统计按跑前跑后的增量断言，同一个月可以重复跑。

## 脚本会断言的例子

| 检查名 | action | 例子 | 通过标准 |
| --- | --- | --- | --- |
| `me` | `me` | 当前登录身份 | `ok` |
| `saveProfile` | `saveProfile` | 还没有资料时，姓名「冒烟管理员」、球队浦东 | `ok`。已有资料则跳过 |
| `admin <姓名>` | — | 身份检查 | `isAdmin` 为真，且有 openid。不是管理员则整次失败 |
| `saveProfile empty name` | `saveProfile` | 姓名传空 | 失败 |
| `saveProfile avatar` | `saveProfile` | 姓名、球队不变，头像传测试 fileID `cloud://smoke-avatar-check` | 返回的 `user.avatarUrl` 与该值一致 |
| `me avatar` | `me` | 再读当前用户 | `user.avatarUrl` 与刚存的一致 |
| `avatar persisted` | — | 头像落库确认 | 上述两值相同 |
| `avatar draft survives refresh` | 页面 `onShow` | 「我的」页先写入未保存头像 `wxfile://usr/avatar-draft-smoke.png`，再进一次 `onShow` | `me` 返回后 `tempAvatar` 与 `avatarPreview` 仍是该值，不被已保存头像盖掉 |
| `listMembers` 或 `listMembers denied` | `listMembers` | 当前身份拉成员 | 授权人成功；其他人失败 |
| `listPlayers` / `listPlayers sorted desc` | `listPlayers` | 当前身份拉全部队员 | `ok`，数组按注册时间倒序，含当前用户，且用户行带 `avatarUrl` 字段 |
| `stats:month` / `stats:quarter` / `stats:year` / `stats:month:<teamId>` | `stats` | 记进球前先读月、季、年，以及自己球队的月统计 | `ok`，作为增量基线 |
| `createActivity` | `createActivity` | 标题 `冒烟 <时间>`，地点「冒烟球场」，约 10 分钟后开始，两队名额 12 | 返回 `activityId` |
| `signup` | `signup` | 用自己的球队报这场 | `ok` |
| `signup duplicate` | `signup` | 同一场再报 | 失败 |
| `activityDetail` | `activityDetail` | 打开刚建的活动 | `ok`，报名行的 `avatarUrl` 已同步为测试 fileID |
| `one signup` | — | 报名人数 | 已报名 1 人，且每条报名带布尔 `isAdmin` |
| `saveRound` | `saveRound` | jiong 2 : 浦东 1 | 返回 `roundId` |
| `deleteRound` | `deleteRound` | 删掉这一轮 | `ok` |
| `activityDetail after deleteRound` | `activityDetail` | 再读详情 | `ok` |
| `round removed` | — | 轮次是否还在 | 详情里没有该 `roundId` |
| `setContribution unsigned` | `setContribution` | 球员 `openid_not_signed` | 失败。该 openid 不是已建档队员 |
| `setContribution` | `setContribution` | 记给自己，进球 1、助攻 1 | `ok` |
| `setAbsent unsigned` | `setAbsent` | 球员 `openid_not_signed` | 失败。该 openid 不是已建档队员 |
| `setAbsent with stats` | `setAbsent` | 进球 1、助攻 1 时把自己标为鸽子 | 失败 |
| `setContribution clear` | `setContribution` | 进球和助攻改回 0 | `ok` |
| `setAbsent` | `setAbsent` | 进球和助攻为 0 时把自己标为鸽子 | `absent` 为真 |
| `stats delta month` / `quarter` / `year` / `team` | `stats` | 再读四个范围 | 进球、助攻与基线相同，缺勤比基线 +1 |
| `stats:avatar` / `stats avatar exposed` | `stats` | 按月汇总读榜单 | 当前用户行的 `avatarUrl` 透出为测试 fileID |
| `updateQuota below signed` | `updateQuota` | 自己球队人数改为 0 | 失败。人数须为 1 到 30 |
| `updateQuota expand` | `updateQuota` | 名额改为 14 | `ok` |
| `homeSummary` | `homeSummary` | 不传 `span`，服务端默认 `3m` | `ok` |
| `homeSummary shape` | — | 返回结构 | 有 `nextActivity`，三个榜是数组 |
| `homeSummary team filter` | `homeSummary` | 传当前用户 `teamId` | 回显 `teamId`；`goalsTop` 行（有 `teamId` 时）均属于该队 |
| `homeSummary signedUp true` | — | 报名后 `nextActivity.signedUp` / `signedTeamId` | `signedUp` 为 `true`，`signedTeamId` 等于当前用户主队（且 `nextActivity` 是冒烟那场） |
| `cancelSignup` | `cancelSignup` | 取消这场报名 | `ok` |
| `cancelSignup again` | `cancelSignup` | 再取消一次 | 失败 |
| `homeSummary signedUp false` | — | 取消后 `nextActivity.signedUp` | `false`（取消是软取消，按 `status: 'signed'` 判断） |
| `signup invalid team` | `signup` | `teamId` 传非法值 | 失败 |
| `signup other team` / `other-team signup kept profile team` | `signup` | 取消后带另一队 `teamId` 再报 | `ok`；`me.user.teamId` 仍为主队；报名行 `teamId` 为另一队 |
| `saveProfile keep signup team` | `saveProfile` | 姓名、主队不变再保存 | `ok`；该场报名行 `teamId` 仍为改报的队 |
| `cancelSignup after other team` | `cancelSignup` | 取消改报 | `ok` |
| `listActivities` | `listActivities` | 从第 1 页起逐页查，每页最多 10 条 | `ok`，且单页不超过 10 条 |
| `activity listed` | — | 列表内容 | 某一页含刚建的 `activityId` |
| `deleteActivity` | `deleteActivity` | 删掉刚建的这场 | `ok` |
| `activityDetail after delete` | `activityDetail` | 再读这场 | 失败 |
| `saveProfile avatar clear` | `saveProfile` | 头像传空串，恢复管理员资料 | `ok`，返回的 `user.avatarUrl` 为空 |
| `avatar cleared` | — | 头像清除确认 | 响应里不再带头像 |

`setAdmin` 不在脚本里。冒烟不改管理员。

## 不测

以下冒烟不覆盖，其中前两项已由 `doc/test-cases.md` 的回归用例覆盖（假 openid 模拟第二人）：

- 第二个微信号报名，以及一队报满后再报被拒绝（回归 R-SIGN-004；真人二号见手工 M-02）。
- 授权或取消管理员（回归 R-AUTH 全组）。
- 数据页切换 `6m`、`1y`、`2y`、`3y`。脚本只打到默认 `3m`（回归 R-STAT-004 覆盖 span 回显与回落，UI 切换见手工 M-03）。
- 页面点击、分享卡片、注册弹层、头像选择器和云存储实际上传（身份显隐见回归 R-UI 组，其余见手工 M-02/M-04/M-05）。未保存头像不被「我的」页刷新清掉已由 `avatar draft survives refresh` 覆盖。
