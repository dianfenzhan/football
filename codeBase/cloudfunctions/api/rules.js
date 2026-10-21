const TEAMS = [
  { _id: 'team_jiong', name: 'jiong 路青少年' },
  { _id: 'team_pudong', name: '浦东老聚三' }
]

const SPAN_MONTHS = { '3m': 3, '6m': 6, '1y': 12, '2y': 24, '3y': 36 }
const CST_OFFSET = 8 * 60 * 60 * 1000

function recentStart(span, now = Date.now()) {
  const months = SPAN_MONTHS[span] || 3
  const shifted = new Date(now + CST_OFFSET)
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() - months,
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds()
  ) - CST_OFFSET
}

function totalsByPlayer(rows) {
  const byPlayer = {}
  for (const row of rows) {
    const key = row.playerOpenid
    if (!byPlayer[key]) {
      byPlayer[key] = {
        playerOpenid: key,
        userName: row.userName,
        teamId: row.teamId,
        avatarUrl: row.avatarUrl || '',
        goals: 0,
        assists: 0,
        absences: 0
      }
    }
    byPlayer[key].goals += row.goals || 0
    byPlayer[key].assists += row.assists || 0
    if (row.absent) byPlayer[key].absences += 1
    byPlayer[key].userName = row.userName
    byPlayer[key].avatarUrl = row.avatarUrl || byPlayer[key].avatarUrl
  }
  return Object.values(byPlayer)
}

function topBy(rows, field) {
  return rows
    .filter((row) => row[field] > 0)
    .sort((a, b) => b[field] - a[field] || b.goals - a.goals)
    .slice(0, 10)
}

function periodRange(event) {
  const year = Number(event.year)
  const type = event.periodType || 'month'
  if (!year) throw new Error('请选择年份')
  if (type === 'year') {
    return { start: localDate(year, 0, 1), end: localDate(year + 1, 0, 1) }
  }
  if (type === 'quarter') {
    const quarter = Number(event.quarter)
    if (quarter < 1 || quarter > 4) throw new Error('请选择季度')
    const month = (quarter - 1) * 3
    return rangeFrom(year, month, 3)
  }
  const month = Number(event.month) - 1
  if (month < 0 || month > 11) throw new Error('请选择月份')
  return rangeFrom(year, month, 1)
}

function rangeFrom(year, monthIndex, span) {
  const start = localDate(year, monthIndex, 1)
  const end = localDate(year, monthIndex + span, 1)
  return { start, end }
}

function localDate(year, monthIndex, day) {
  return Date.UTC(year, monthIndex, day) - CST_OFFSET
}

function assertNotAbsentWithStats(absent, goals, assists) {
  if (absent && ((goals || 0) !== 0 || (assists || 0) !== 0)) {
    throw new Error('鸽子的情况下，进球和助攻得是 0')
  }
}

function parseScore(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 99) throw new Error('比分和数据请填 0 到 99 的整数')
  return number
}

function normalizeQuotas(input) {
  const source = input || {}
  return TEAMS.map((team) => {
    const raw = source[team._id] == null ? 11 : Number(source[team._id])
    if (!Number.isInteger(raw) || raw < 1 || raw > 30) throw new Error(`${team.name} 的名额为 1 到 30`)
    return { teamId: team._id, maxSignups: raw }
  })
}

module.exports = {
  TEAMS,
  assertNotAbsentWithStats,
  normalizeQuotas,
  parseScore,
  periodRange,
  recentStart,
  topBy,
  totalsByPlayer
}
