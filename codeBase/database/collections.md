# 云数据库集合

在云开发控制台创建下列集合。权限统一设为「仅管理端可读写」或「所有用户不可读写」——小程序端不直连数据库，全部走云函数 `api`。

| 集合 | 用途 |
| --- | --- |
| teams | 两支球队（云函数启动时会自动写入） |
| users | openid、姓名、所属球队、擅长位置 `preferredPosition`（`fw` / `mf` / `df` / `gk`）、是否管理员 |
| activities | 标题、开始时间、地点、状态、`signupMode`（`split` 或缺省为分队，`joint` 为联合） |
| quotas | 某场活动里某队的名额。联合场另有 `team_unite`（联队），每组固定 8 |
| signups | 谁报名了哪场、哪一组。`status` 为 `signed`、`waitlist` 或 `cancelled`。后补另有 `waitlistOrder`、`waitHours`、`waitUntil` |
| rounds | 某一轮双方比分 |
| contributions | 某场活动里某人的进球数、助攻数、是否缺勤。鸽子另有 `absentBy`（`system` 临期取消，`admin` 或空为管理员标记）和 `pigeonAt`（记下时间，毫秒） |
| tactics_boards | 活动场次战术板（`scope: 'activity'`，`activityId + teamId` 唯一）。含 `title`、`slots`（`[{ userId, x, y, role }]`，最多 8 人）、`createdBy`、`createdAt`、`updatedBy`、`updatedAt` |

建议索引（控制台提示时添加即可）：

- `activities.startTime` 降序
- `rounds.activityId` + `rounds.roundNo`
- `signups.activityId` + `signups.status`
- `contributions.activityStartTime`
- `tactics_boards.scope` + `tactics_boards.activityId` + `tactics_boards.teamId`
