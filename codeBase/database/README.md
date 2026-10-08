# 云数据库集合

云函数首次调用会自动写入两支球队到 `teams`。其余集合在第一次写入时由云函数创建文档；建议在云开发控制台预先建好集合，并把权限设为：

**所有用户不可读写**（读写都走云函数）。

| 集合 | 用途 |
| --- | --- |
| teams | 两支球队 |
| users | openid、姓名、所属球队、是否管理员 |
| activities | 标题、开始时间、地点、状态 |
| quotas | 某场活动里某队的名额 |
| signups | 谁报名了哪场、哪一队 |
| rounds | 某一轮双方比分 |
| contributions | 某场活动里某人的进球数、助攻数 |

若控制台提示建索引，按提示确认即可。常见索引：

- `activities.startTime` 降序
- `rounds.activityId + roundNo`
- `signups.activityId + status`
- `contributions.activityStartTime`
