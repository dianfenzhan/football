# 云数据库集合

在云开发控制台创建下列集合。权限统一设为「仅管理端可读写」或「所有用户不可读写」——小程序端不直连数据库，全部走云函数 `api`。

| 集合 | 用途 |
| --- | --- |
| teams | 两支球队（云函数启动时会自动写入） |
| users | openid、姓名、所属球队、是否管理员 |
| activities | 标题、开始时间、地点、状态 |
| quotas | 某场活动里某队的名额 |
| signups | 谁报名了哪场、哪一队 |
| rounds | 某一轮双方比分 |
| contributions | 某场活动里某人的进球数、助攻数、是否缺勤 |

建议索引（控制台提示时添加即可）：

- `activities.startTime` 降序
- `rounds.activityId` + `rounds.roundNo`
- `signups.activityId` + `signups.status`
- `contributions.activityStartTime`
