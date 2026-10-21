const test = require('node:test')
const assert = require('node:assert/strict')
const {
  assertNotAbsentWithStats,
  normalizeQuotas,
  parseScore,
  periodRange,
  recentStart,
  topBy,
  totalsByPlayer
} = require('../cloudfunctions/api/rules')

function at(iso) {
  return Date.parse(iso)
}

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
    absences: 2
  })
  assert.equal(b.absences, 0)
  assert.equal(b.assists, 3)
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
