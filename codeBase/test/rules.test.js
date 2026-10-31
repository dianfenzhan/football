const test = require('node:test')
const assert = require('node:assert/strict')
const {
  assertNotAbsentWithStats,
  assertPigeonEditable,
  boardRows,
  pigeonRoster,
  willRecordPigeon,
  normalizeQuotas,
  parseScore,
  periodRange,
  recentStart,
  topBy,
  totalsByPlayer,
  attendancesByPlayer,
  defaultWaitHours,
  jointPlacement,
  signupModeOf,
  waitChoices,
  waitUntilAt,
  withHomeTeam,
  normalizePreferredPosition,
  validateTacticsBoardSave
} = require('../cloudfunctions/api/rules')
const {
  buildTacticsBoard,
  buildDefaultTacticsState,
  reconcileSavedBoard,
  applyPitchDrag,
  filterBenchPlayers
} = require('../miniprogram/utils/tactics')

function at(iso) {
  return Date.parse(iso)
}

test('不足 4 小时取消正选才记鸽子，正好 4 小时或后补不记', () => {
  const start = at('2026-10-30T20:00:00+08:00')
  const inside = start - (4 * 60 * 60 * 1000) + 1
  assert.equal(willRecordPigeon(start, inside, 'signed'), true)
  assert.equal(willRecordPigeon(start, start - 4 * 60 * 60 * 1000, 'signed'), false)
  assert.equal(willRecordPigeon(start, start - 5 * 60 * 60 * 1000, 'signed'), false)
  assert.equal(willRecordPigeon(start, inside, 'waitlist'), false)
  assert.equal(willRecordPigeon(start, start, 'signed'), false)
})

test('系统鸽子不能改，管理员标记可以改', () => {
  assert.throws(() => assertPigeonEditable({ absent: true, absentBy: 'system' }), /系统自动记下的，不能改/)
  assert.doesNotThrow(() => assertPigeonEditable({ absent: true, absentBy: 'admin' }))
  assert.doesNotThrow(() => assertPigeonEditable({ absent: false, absentBy: 'system' }))
  assert.doesNotThrow(() => assertPigeonEditable(null))
})

test('鸽子名单按记下时间从新到旧，未开赛不进榜', () => {
  const rows = pigeonRoster([
    { playerOpenid: 'a', userName: '甲', absent: true, absentBy: 'system', pigeonAt: 10 },
    { playerOpenid: 'b', userName: '乙', absent: false, pigeonAt: 99 },
    { playerOpenid: 'c', userName: '丙', absent: true, absentBy: 'admin', pigeonAt: 30 }
  ])
  assert.deepEqual(rows.map((row) => row.playerOpenid), ['c', 'a'])
  const now = 100
  const counted = boardRows([
    { playerOpenid: 'a', absent: true, activityStartTime: 200, goals: 0 },
    { playerOpenid: 'b', absent: true, activityStartTime: 50, goals: 1 }
  ], now)
  assert.equal(counted[0].absent, false)
  assert.equal(counted[1].absent, true)
  assert.equal(counted[1].goals, 1)
})

test('parseScore 接受 0 到 99 的整数', () => {
  assert.equal(parseScore(0), 0)
  assert.equal(parseScore(99), 99)
  assert.equal(parseScore('8'), 8)
})

test('parseScore 拒绝小数、负数、100 和缺失', () => {
  for (const value of [1.5, -1, 100, undefined, 'x', Number.NaN]) {
    assert.throws(() => parseScore(value), /0 到 99 的整数/)
  }
})

test('parseScore 把空串和 null 当成 0', () => {
  assert.equal(parseScore(''), 0)
  assert.equal(parseScore(null), 0)
})

test('normalizeQuotas 缺省每队 11，并接受 1 到 30', () => {
  assert.deepEqual(normalizeQuotas(), [
    { teamId: 'team_jiong', maxSignups: 11 },
    { teamId: 'team_pudong', maxSignups: 11 }
  ])
  assert.deepEqual(normalizeQuotas({ team_jiong: 1, team_pudong: 30 }), [
    { teamId: 'team_jiong', maxSignups: 1 },
    { teamId: 'team_pudong', maxSignups: 30 }
  ])
  assert.deepEqual(normalizeQuotas({ team_jiong: 12 }), [
    { teamId: 'team_jiong', maxSignups: 12 },
    { teamId: 'team_pudong', maxSignups: 11 }
  ])
})

test('联合名额固定每组 8，统计改记主队', () => {
  assert.equal(signupModeOf({}), 'split')
  assert.equal(signupModeOf({ signupMode: 'joint' }), 'joint')
  assert.deepEqual(normalizeQuotas(null, 'joint').map((item) => item.maxSignups), [8, 8, 8])
  const start = Date.parse('2026-11-04T12:00:00Z')
  const now = start - 3 * 60 * 60 * 1000
  assert.deepEqual(waitChoices(start, now), [2, 1, 0])
  assert.equal(defaultWaitHours(start, now), 2)
  const kickoff = Date.parse('2026-10-30T20:00:00+08:00')
  const evening = Date.parse('2026-10-30T18:31:00+08:00')
  assert.deepEqual(waitChoices(kickoff, evening), [1, 0])
  assert.equal(defaultWaitHours(kickoff, evening), 1)
  assert.equal(defaultWaitHours(kickoff, kickoff - 5 * 60 * 60 * 1000), 4)
  assert.equal(waitUntilAt(start, 0, now), start)
  assert.equal(waitUntilAt(start, 2, now), start - 2 * 60 * 60 * 1000)
  assert.throws(() => waitUntilAt(start, 8, now), /已经过了/)
  assert.throws(() => waitUntilAt(start, 25, now), /请选择后补时间/)
  assert.equal(jointPlacement('team_jiong', { team_jiong: 8, team_unite: 1, team_pudong: 0 }, {
    team_jiong: 8, team_unite: 8, team_pudong: 8
  }).teamId, 'team_unite')
  assert.equal(jointPlacement('team_jiong', { team_jiong: 8, team_unite: 8, team_pudong: 8 }, {
    team_jiong: 8, team_unite: 8, team_pudong: 8
  }), null)
  const rows = withHomeTeam([{ playerOpenid: 'a', teamId: 'team_unite', goals: 1 }], { a: 'team_jiong' })
  assert.equal(rows[0].teamId, 'team_jiong')
})

test('normalizeQuotas 越界时带队名失败', () => {
  assert.throws(() => normalizeQuotas({ team_jiong: 0 }), /jiong 路青少年 的名额为 1 到 30/)
  assert.throws(() => normalizeQuotas({ team_pudong: 31 }), /浦东老聚三 的名额为 1 到 30/)
  assert.throws(() => normalizeQuotas({ team_jiong: 1.5 }), /jiong 路青少年/)
})

test('鸽子不能同时有进球或助攻', () => {
  assert.doesNotThrow(() => assertNotAbsentWithStats(false, 2, 1))
  assert.doesNotThrow(() => assertNotAbsentWithStats(true, 0, 0))
  assert.throws(() => assertNotAbsentWithStats(true, 1, 0), /进球和助攻得是 0/)
  assert.throws(() => assertNotAbsentWithStats(true, 0, 1), /进球和助攻得是 0/)
})

test('periodRange 的起止是东八区零点', () => {
  assert.deepEqual(periodRange({ year: 2026, periodType: 'year' }), {
    start: at('2026-01-01T00:00:00+08:00'),
    end: at('2027-01-01T00:00:00+08:00')
  })
  assert.deepEqual(periodRange({ year: 2026, periodType: 'quarter', quarter: 1 }), {
    start: at('2026-01-01T00:00:00+08:00'),
    end: at('2026-04-01T00:00:00+08:00')
  })
  assert.deepEqual(periodRange({ year: 2026, periodType: 'quarter', quarter: 4 }), {
    start: at('2026-10-01T00:00:00+08:00'),
    end: at('2027-01-01T00:00:00+08:00')
  })
  assert.deepEqual(periodRange({ year: 2026, periodType: 'month', month: 2 }), {
    start: at('2026-02-01T00:00:00+08:00'),
    end: at('2026-03-01T00:00:00+08:00')
  })
  assert.deepEqual(periodRange({ year: 2026, month: 12 }), {
    start: at('2026-12-01T00:00:00+08:00'),
    end: at('2027-01-01T00:00:00+08:00')
  })
})

test('periodRange 拒绝缺年份、非法季度和非法月份', () => {
  assert.throws(() => periodRange({}), /请选择年份/)
  assert.throws(() => periodRange({ year: 2026, periodType: 'quarter', quarter: 0 }), /请选择季度/)
  assert.throws(() => periodRange({ year: 2026, periodType: 'quarter', quarter: 5 }), /请选择季度/)
  assert.throws(() => periodRange({ year: 2026, month: 0 }), /请选择月份/)
  assert.throws(() => periodRange({ year: 2026, month: 13 }), /请选择月份/)
})

test('recentStart 按东八区日历回退，非法 span 当作 3 个月', () => {
  const now = at('2026-10-20T11:00:00+08:00')
  assert.equal(recentStart('3m', now), at('2026-07-20T11:00:00+08:00'))
  assert.equal(recentStart('6m', now), at('2026-04-20T11:00:00+08:00'))
  assert.equal(recentStart('1y', now), at('2025-10-20T11:00:00+08:00'))
  assert.equal(recentStart('2y', now), at('2024-10-20T11:00:00+08:00'))
  assert.equal(recentStart('3y', now), at('2023-10-20T11:00:00+08:00'))
  assert.equal(recentStart('9m', now), recentStart('3m', now))
})

test('recentStart 在目标月没有这一天时会溢到下个月', () => {
  const now = at('2026-05-31T11:00:00+08:00')
  assert.equal(recentStart('3m', now), at('2026-03-03T11:00:00+08:00'))
})

test('totalsByPlayer 按人累加，姓名取最后一行，空头像不覆盖', () => {
  const totals = totalsByPlayer([
    { playerOpenid: 'a', userName: '甲', teamId: 'team_jiong', goals: 1, assists: 0, absent: false },
    { playerOpenid: 'a', userName: '甲二', teamId: 'team_jiong', avatarUrl: 'cloud://a', goals: 2, assists: 1, absent: true },
    { playerOpenid: 'a', userName: '甲三', teamId: 'team_pudong', avatarUrl: '', goals: 0, assists: 0, absent: true },
    { playerOpenid: 'b', userName: '乙', teamId: 'team_pudong', goals: 0, assists: 3, absent: false }
  ])
  const a = totals.find((row) => row.playerOpenid === 'a')
  const b = totals.find((row) => row.playerOpenid === 'b')
  assert.deepEqual(a, {
    playerOpenid: 'a',
    userName: '甲三',
    teamId: 'team_jiong',
    avatarUrl: 'cloud://a',
    goals: 3,
    assists: 1,
    absences: 2,
    attendances: 0
  })
  assert.equal(b.absences, 0)
  assert.equal(b.assists, 3)
})

test('attendancesByPlayer 只计已开始活动的报名，并扣掉鸽子', () => {
  const signups = [
    { activityId: 'past1', _openid: 'a', userName: '甲', teamId: 'team_jiong', status: 'signed' },
    { activityId: 'past2', _openid: 'a', userName: '甲', teamId: 'team_jiong', status: 'signed' },
    { activityId: 'past1', _openid: 'b', userName: '乙', teamId: 'team_pudong', status: 'signed' },
    { activityId: 'future', _openid: 'a', userName: '甲', teamId: 'team_jiong', status: 'signed' },
    { activityId: 'past1', _openid: 'c', userName: '丙', teamId: 'team_jiong', status: 'cancelled' }
  ]
  const rows = attendancesByPlayer(signups, {
    startedIds: ['past1', 'past2'],
    absentKeys: ['past2:a']
  })
  const a = rows.find((row) => row.playerOpenid === 'a')
  const b = rows.find((row) => row.playerOpenid === 'b')
  assert.equal(a.attendances, 1)
  assert.equal(b.attendances, 1)
  assert.equal(rows.some((row) => row.playerOpenid === 'c'), false)
})

test('attendancesByPlayer 按报名球队过滤', () => {
  const signups = [
    { activityId: 'past1', _openid: 'a', userName: '甲', teamId: 'team_jiong', status: 'signed' },
    { activityId: 'past1', _openid: 'b', userName: '乙', teamId: 'team_pudong', status: 'signed' }
  ]
  const rows = attendancesByPlayer(signups, {
    startedIds: ['past1'],
    teamFilter: 'team_pudong'
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].playerOpenid, 'b')
  assert.equal(rows[0].attendances, 1)
})

test('topBy 只留大于 0 的前 10，同分再比进球', () => {
  const byGoals = []
  for (let goals = 0; goals <= 12; goals += 1) {
    byGoals.push({ playerOpenid: `p${goals}`, userName: `p${goals}`, goals, assists: 0, absences: 0 })
  }
  const goalsTop = topBy(byGoals, 'goals')
  assert.equal(goalsTop.length, 10)
  assert.equal(goalsTop[0].goals, 12)
  assert.equal(goalsTop[9].goals, 3)
  assert.equal(goalsTop.some((row) => row.goals === 0), false)

  const byAssists = [
    { playerOpenid: 'low', userName: 'low', goals: 1, assists: 5, absences: 0 },
    { playerOpenid: 'high', userName: 'high', goals: 9, assists: 5, absences: 0 },
    { playerOpenid: 'zero', userName: 'zero', goals: 4, assists: 0, absences: 0 }
  ]
  assert.deepEqual(topBy(byAssists, 'assists').map((row) => row.playerOpenid), ['high', 'low'])
})

test('擅长位置校验与活动战术板 slots 上限', () => {
  assert.equal(normalizePreferredPosition('fw'), 'fw')
  assert.equal(normalizePreferredPosition('gk'), 'gk')
  assert.equal(normalizePreferredPosition('', () => 0), 'fw')
  assert.equal(normalizePreferredPosition(undefined, () => 0.99), 'gk')
  assert.throws(() => normalizePreferredPosition('st'), /请选择擅长位置/)

  const ok = validateTacticsBoardSave({
    title: '炯队',
    slots: [{ userId: 'u1', x: 0.5, y: 0.5, role: 'fw' }]
  })
  assert.equal(ok.scope, 'activity')
  assert.equal(ok.title, '炯队')
  assert.equal(ok.slots.length, 1)

  assert.throws(() => validateTacticsBoardSave({
    title: '炯队',
    slots: Array.from({ length: 9 }, (_, i) => ({ userId: `u${i}`, x: 0.5, y: 0.5, role: 'mf' }))
  }), /场上最多 8 名球员/)
})

test('buildDefaultTacticsState 按近 3 月出勤前 8 与擅长位置排 3-2-2，冲突补空位，超出进轮换', () => {
  const players = [
    { userId: 'p1', userName: '一号', preferredPosition: 'fw', attendances: 1, createdAt: 100 },
    { userId: 'p2', userName: '二号', preferredPosition: 'fw', attendances: 10, createdAt: 200 },
    { userId: 'p3', userName: '三号', preferredPosition: 'fw', attendances: 9, createdAt: 300 },
    { userId: 'p4', userName: '四号', preferredPosition: 'mf', attendances: 8, createdAt: 400 },
    { userId: 'p5', userName: '五号', preferredPosition: 'mf', attendances: 7, createdAt: 500 },
    { userId: 'p6', userName: '六号', preferredPosition: 'df', attendances: 6, createdAt: 600 },
    { userId: 'p7', userName: '七号', preferredPosition: 'df', attendances: 5, createdAt: 700 },
    { userId: 'p8', userName: '八号', preferredPosition: 'gk', attendances: 4, createdAt: 800 },
    { userId: 'p9', userName: '九号', preferredPosition: 'df', attendances: 3, createdAt: 900 }
  ]
  const state = buildDefaultTacticsState(players, { randomFn: () => 0, emptyText: '待选人' })
  assert.equal(state.onPitch.length, 8)
  assert.equal(state.emptySlots.length, 0)
  assert.equal(state.bench.length, 1)
  assert.equal(state.bench[0].userId, 'p1')
  const gkPlayer = state.onPitch.find((p) => p.role === 'gk')
  assert.equal(gkPlayer.userId, 'p8')
})

test('不足 8 人时附近无人的 3-2-2 默认坑位显示待报名，自由拖动与满员拖空地拦截，以及活动板正选校准', () => {
  const pool = [
    { userId: 'p1', userName: '张三', preferredPosition: 'fw', attendances: 5, createdAt: 100 },
    { userId: 'p2', userName: '李四', preferredPosition: 'gk', attendances: 4, createdAt: 200 },
    { userId: 'p3', userName: '王五', preferredPosition: 'mf', attendances: 3, createdAt: 300 }
  ]
  const state3 = buildDefaultTacticsState(pool, { randomFn: () => 0, emptyText: '待报名' })
  assert.equal(state3.onPitch.length, 3)
  assert.equal(state3.emptySlots.length, 5)
  assert.equal(state3.emptySlots[0].emptyText, '待报名')

  // 场上拖到空地改变坐标
  const moved = applyPitchDrag(state3, pool, {
    source: 'pitch',
    userId: 'p1',
    dropZone: 'pitch',
    x: 0.5,
    y: 0.25
  })
  const p1After = moved.state.onPitch.find((p) => p.userId === 'p1')
  assert.equal(p1After.x, 0.5)
  assert.equal(p1After.y, 0.25)

  // 拖进轮换栏即下场
  const toBench = applyPitchDrag(moved.state, pool, {
    source: 'pitch',
    userId: 'p1',
    dropZone: 'bench'
  })
  assert.equal(toBench.state.onPitch.length, 2)
  assert.equal(toBench.state.bench.some((p) => p.userId === 'p1'), true)
  assert.equal(filterBenchPlayers(toBench.state.bench, '张').length, 1)
  assert.equal(filterBenchPlayers(toBench.state.bench, '不存在').length, 0)

  // 满 8 人时从轮换拖到空地提示并不换人，拖到某人身上才互换
  const fullPool = Array.from({ length: 9 }, (_, i) => ({
    userId: `u${i + 1}`,
    userName: `队员${i + 1}`,
    preferredPosition: 'mf',
    attendances: 20 - i
  }))
  const fullState = buildDefaultTacticsState(fullPool, { randomFn: () => 0 })
  assert.equal(fullState.onPitch.length, 8)
  assert.equal(fullState.bench.length, 1)
  const blocked = applyPitchDrag(fullState, fullPool, {
    source: 'bench',
    userId: 'u9',
    dropZone: 'pitch',
    x: 0.1,
    y: 0.1
  })
  assert.equal(blocked.toast, '场上已满，先把一个人拖到轮换')
  assert.equal(blocked.state.onPitch.some((p) => p.userId === 'u9'), false)

  const targetOnPitch = fullState.onPitch[0]
  const swapped = applyPitchDrag(fullState, fullPool, {
    source: 'bench',
    userId: 'u9',
    dropZone: 'pitch',
    x: targetOnPitch.x,
    y: targetOnPitch.y
  })
  assert.equal(swapped.toast, '')
  assert.equal(swapped.state.onPitch.some((p) => p.userId === 'u9'), true)
  assert.equal(swapped.state.bench.some((p) => p.userId === targetOnPitch.userId), true)

  // 已保存活动板再次打开时，离队撤下并提示、新人进轮换池
  const reconciled = reconcileSavedBoard(
    [
      { userId: 'p1', x: 0.35, y: 0.22, role: 'fw' },
      { userId: 'left_user', x: 0.5, y: 0.87, role: 'gk' }
    ],
    pool
  )
  assert.equal(reconciled.onPitch.length, 1)
  assert.equal(reconciled.onPitch[0].userId, 'p1')
  assert.equal(reconciled.bench.length, 2)
  assert.equal(reconciled.removedNotice, '已不在本场正选的人已从板上拿下')
})

