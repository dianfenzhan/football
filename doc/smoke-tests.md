# 冒烟测试例子

以 `codeBase/scripts/smoke-test.js` 为准。跑法用 skill `smoke-test`。文档对齐用 skill `doc-anchored`。

前提：开发者工具自动化端口已开，登录微信号已经是管理员。每次新建标题以「冒烟」开头的活动；收尾时取消报名并尽力删除。只有授权人删得掉；若当前号只是管理员、不是授权人，删除检查记为失败，活动会留在库里。

统计按跑前跑后的增量断言，同月可重复跑。后补/满员依赖 `smokeSeedSignups`（需已部署最新 `api`）。

下文按 **功能模块 → 子功能** 归类。每条写清测什么场景、检查名和通过标准。

---

## 1. 账号与资料

### 1.1 登录身份

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 能读到当前用户 | `me` | `ok` |
| 当前号是管理员 | `admin <姓名>` | `isAdmin` 为真，且有 openid；否则整次冒烟停 |

### 1.2 保存资料校验

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 尚无资料时建档（姓名「冒烟管理员」、浦东） | `saveProfile` | `ok`；已有资料则跳过 |
| 姓名为空 | `saveProfile empty name` | 失败 |
| 球队非法 | `saveProfile bad team` | 失败 |
| 擅长位置非法 | `saveProfile bad position` | 失败 |

### 1.3 成员与球员列表

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 授权人拉成员 / 非授权人拒绝 | `listMembers` 或 `listMembers denied` | 授权人成功；其他人失败 |
| 拉全部球员 | `listPlayers` | `ok`，含当前用户 |
| 球员按注册时间倒序 | `listPlayers sorted desc` | 数组倒序成立 |

### 1.4 管理员改球员

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 管理员把自己位置改为前锋 | `adminUpdatePlayer` / `adminUpdatePlayer position` | `ok`，`preferredPosition === 'fw'` |

---

## 2. 活动创建与列表

### 2.1 创建校验

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 标题为空 | `createActivity empty title` | 失败 |
| 地点为空 | `createActivity empty location` | 失败 |

### 2.2 主路径活动（约 10 分钟后开赛）

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 分队创建，两队名额 12 | `createActivity` | 返回 `activityId` |
| 列表能翻到这场 | `listActivities` / `activity listed` | 每页 ≤10，某页含该 `activityId` |
| 授权人删除 / 非授权人拒绝 | `deleteActivity` 或 `deleteActivity denied` | 授权人 `ok`；其他人失败 |
| 删除后再读详情 | `activityDetail after delete` | 失败 |

---

## 3. 正选报名与取消

### 3.1 报名主路径

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 用自己主队报名 | `signup` | `ok` |
| 同一场再报 | `signup duplicate` | 失败 |
| 打开详情 | `activityDetail` | `ok` |
| 订阅模板已配置 | `subscribeTemplates configured` | `remind`、`promote` 均非空 |
| 报名人数与字段 | `one signup` | 正选 1 人，每条带布尔 `isAdmin` |
| 首页显示已报名 | `homeSummary signedUp true` | `signedUp` 真，`signedTeamId` 等于主队 |

### 3.2 临期取消（记鸽子）

距开赛不足 4 小时取消正选。

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 取消正选记系统鸽子 | `cancelSignup` / `activityDetail pigeons` | `ok`；`pigeons` 含自己且 `absentBy` 为 `system` |
| 未开赛时鸽子榜次数不增 | `late cancel pigeon hidden until kickoff` | 首页鸽子榜相对取消前不增加 |
| 系统鸽子不能手改 | `setAbsent system pigeon locked` | 失败 |
| 再取消一次 | `cancelSignup again` | 失败 |
| 取消后首页未报名 | `homeSummary signedUp false` | `signedUp` 为假 |

### 3.3 提早取消（不记鸽子）

约 5 小时后开赛的单独一场。

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 建场并报名 | `createActivity early cancel` / `signup early` | `ok` |
| ≥4 小时外取消 | `cancelSignup early` / `early cancel no pigeon` | `pigeon` 假；详情无系统鸽子 |
| 删提早场 | `deleteActivity early` 或 `… denied` | 授权人 `ok`；其他人失败 |

### 3.4 改报另一队

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| `teamId` 非法 | `signup invalid team` | 失败 |
| 取消后再报另一队 | `signup other team` / `re-signup cleared system pigeon` / `other-team signup kept profile team` | 报名行是另一队；主队资料不变；系统鸽子去掉 |
| 再保存资料不改报名队 | `saveProfile keep signup team` / `saveProfile keeps signup team` | 报名行仍是改报的队 |

---

## 4. 分队后补

单独建一场：本队名额 1，开赛约 7 天后。用假人占满本队。

### 4.1 满员时的选择

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 建分队后补场并注入 1 名正选假人 | `createActivity split` / `smokeSeedSignups signed` | `ok` |
| 本队满且不传 `choice` | `signup full without choice` | 失败 |
| `choice: other` 改报对面 | `signup choice other when full` / `cancelSignup choice other` | 进对方正选；随后取消 |
| 对方正选也满时改报 | `smokeSeedSignups other full` / `signup choice other when other full` | 失败，不进对方后补 |

### 4.2 排后补与改档

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| `choice: waitlist`、`waitHours: 8` | `signup split waitlist` | `waitlist` 真 |
| 后补中改为 4 小时 | `setWaitUntil` | `ok`，有 `waitUntil` |
| `waitHours: 99` | `setWaitUntil bad hours` | 失败 |

### 4.3 后补升正选

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 扩名额把后补顶上 | `updateQuota promote waitlist` / `updateQuota promotes waitlist` | 自己从后补变正选 |
| 名额改到低于已报名人数 | `updateQuota below signed count` | 失败 |
| 分队场不允许换到联队 | `moveSignup on split` | 失败 |
| 取消正选顶后补假人 | `smokeSeedSignups waitlist` / `cancel promotes waitlist` | 假人后补变正选 |
| 删后补场 | `deleteActivity waitlist` 或 `… denied` | 授权人 `ok`；其他人失败 |

### 4.4 临期后补取消

约 30 分钟后开赛、本队已满。

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 排后补后改已过档位 | `signup near waitlist` / `setWaitUntil expired hours` | 改档失败 |
| 取消后补不记鸽子 | `cancelSignup waitlist` / `cancel waitlist no pigeon` | `pigeon` 假；无系统鸽子 |
| 删临期场 | `deleteActivity near waitlist` 或 `… denied` | 授权人 `ok`；其他人失败 |

---

## 5. 联合报名与换组

### 5.1 联合场基础

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 创建联合场 | `createActivity joint` / `activityDetail joint` | 三组名额都是 8，含联队 |
| 联合场改人数被拒 | `updateQuota joint denied` | 失败，人数仍 8 |
| 报进本队组 | `signup joint own group` | 进本队正选 |
| 对方组满时换过去 | `moveSignup group full` | 失败 |
| 换到联队 | `moveSignup` / `moveSignup to unite` | 报名行 `teamId` 为联队 |
| 分队场对调 | `swapSignups on split` | 失败 |
| 和自己对调 | `swapSignups same player` | 失败 |
| 管理员把本人和已满组假人对调 | `swapSignups` / `activityDetail before swap` / `activityDetail after swap` / `swapSignups exchanged` | 两人队伍互换；对方组仍 8 人、联队仍 1 人 |
| 同一组两名正选对调 | `swapSignups same team` | 失败 |
| 取消并删联合场 | `cancelSignup joint` / `deleteActivity joint` 或 `… denied` | 取消 `ok`；删除看是否授权人 |

### 5.2 联合溢出与共享后补

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 本队满后自动进联队 | `signup joint home full to unite` | 进联队 |
| 三组都满进共享后补 | `signup joint shared waitlist` | `waitlist` 真 |
| 删溢出场 | `deleteActivity joint overflow` 或 `… denied` | 授权人 `ok`；其他人失败 |

---

## 6. 名额调整（主路径场）

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 名额改为 0 | `updateQuota below signed` | 失败（须 1～30） |
| 名额扩到 14 | `updateQuota expand` | `ok` |

---

## 7. 本场数据与鸽子

### 7.1 轮次比分

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 新增一轮 2:1 | `saveRound` | 返回 `roundId` |
| 改成 3:3 | `saveRound update` / `saveRound updated` | 详情比分已更新 |
| 删除轮次 | `deleteRound` / `round removed` | 详情不再含该轮 |

### 7.2 进球助攻

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 非正选不能记 | `setContribution unsigned` | 失败 |
| 给自己记 1 球 1 助 | `setContribution` | 返回 `contributionId` |
| 按 id 删除 | `deleteContribution` / `contribution removed` | 详情无该记录 |
| 再记一次 | `setContribution again` | `ok` |
| 有数据时不能标鸽子 | `setAbsent with stats` | 失败 |
| 清零进球助攻 | `setContribution clear` | `ok` |

### 7.3 手标鸽子

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 非正选不能标 | `setAbsent unsigned` | 失败 |
| 进球助攻为 0 时标鸽子 | `setAbsent` | `absent` 真 |
| 清除后再标 | `setAbsent clear` / `setAbsent again` | 先假后真 |

### 7.4 统计增量

先读基线，再断言缺勤 +1、进球助攻不变。

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 记数据前基线 | `stats:month` / `quarter` / `year` / `month:<teamId>` | `ok` |
| 记完后增量 | `stats delta month` / `quarter` / `year` / `team` | 缺勤 +1；进球助攻与基线相同 |

---

## 8. 首页与天气

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 默认近 3 个月摘要 | `homeSummary` / `homeSummary shape` | 有 `nextActivity`；四榜为数组 |
| 首页天气卡（有下一场） | `home weather shape` | `weather.hours` ≥2 且含 20 点 |
| 天气缺时间 | `activityWeather missing time` | 失败 |
| 跨度 6m / 1y | `homeSummary span 6m` / `1y` | `ok` |
| 按主队过滤榜单 | `homeSummary team filter` | 回显 `teamId`；有队属的行属于该队 |

---

## 9. 战术板

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| 场上 9 人 | `saveTacticsBoard too many` | 失败 |
| 正选时可保存活动板 | `saveTacticsBoard activity` / `activity tactics board saved` | `activityBoards[teamId]` 存在 |
| 取消正选后再保存 | `saveTacticsBoard unsigned`（先 `cancelSignup after other team`） | 失败 |

---

## 10. 魔镜

在取消本场报名之后、未报名保存战术板之前跑。

| 场景 | 检查名 | 通过标准 |
| --- | --- | --- |
| FAQ 命中取消鸽子 | `mirrorAsk faq pigeon` | `ok`；`hitId === signup-cancel-pigeon`；`usedModel` 假；答文含鸽子或 4 小时；含 `remaining` |
| 实时下一场 | `mirrorAsk live next` | `ok`；答非空；`usedModel` 假 |
| 未命中走模型路径 | `mirrorAsk model path` | `ok`；答非空；若为「暂未开通」/「开小差」则 `remaining` 与问前相同（失败不计次） |
| 反馈有用 | `mirrorFeedback` | 有 `logId` 时 `ok` |
| 本周额度 | `mirrorQuota` | `ok`；`weekLimit` 按登录身份（授权人 100 / 管理员 50 / 普通 15）；`remaining` 为 0～`weekLimit` |

---

## 不测

- 第二个微信号报名，以及双方正选和后补都满（「两队都满了」）。
- 授权或取消管理员（`setAdmin` 不在脚本里）。
- 定时 `sendKickoffReminders` 与真实推达（只断言模板 ID 已配置）。
- 头像上传/清除/同步，以及「我的」页选择器。
- 页面点击、分享卡片、注册弹层、后补两次授权弹窗。
- 新建页报名方式点选、联合拖拽。
