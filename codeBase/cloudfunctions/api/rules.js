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
        absences: 0,
        attendances: 0
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

/**
 * 出勤：已开始活动里仍为 signed 的报名，且该场未被标鸽子。
 * startedIds：活动 id 集合；absentKeys：`${activityId}:${openid}`。
 */
function attendancesByPlayer(signups, options = {}) {
  const startedIds = new Set(options.startedIds || [])
  const absentKeys = new Set(options.absentKeys || [])
  const teamFilter = options.teamFilter || ''
  const byPlayer = {}
  for (const signup of signups || []) {
    if (signup.status && signup.status !== 'signed') continue
    if (!startedIds.has(signup.activityId)) continue
    if (teamFilter && signup.teamId !== teamFilter) continue
    const openid = signup._openid || signup.playerOpenid
    if (!openid) continue
    if (absentKeys.has(`${signup.activityId}:${openid}`)) continue
    if (!byPlayer[openid]) {
      byPlayer[openid] = {
        playerOpenid: openid,
        userName: signup.userName,
        teamId: signup.teamId,
        avatarUrl: signup.avatarUrl || '',
        goals: 0,
        assists: 0,
        absences: 0,
        attendances: 0
      }
    }
    byPlayer[openid].attendances += 1
    byPlayer[openid].userName = signup.userName
    byPlayer[openid].avatarUrl = signup.avatarUrl || byPlayer[openid].avatarUrl
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

const FOUR_HOURS = 4 * 60 * 60 * 1000

function willRecordPigeon(startTime, now, status) {
  return status === 'signed' && startTime > now && startTime - now < FOUR_HOURS
}

function assertPigeonEditable(row) {
  if (row && row.absent && row.absentBy === 'system') {
    throw new Error('这场鸽子是系统自动记下的，不能改')
  }
}

function pigeonRoster(contributions) {
  return (contributions || [])
    .filter((row) => row.absent)
    .slice()
    .sort((a, b) => (b.pigeonAt || 0) - (a.pigeonAt || 0))
    .map((row) => ({
      playerOpenid: row.playerOpenid,
      userName: row.userName,
      avatarUrl: row.avatarUrl || '',
      absentBy: row.absentBy === 'system' ? 'system' : 'admin',
      pigeonAt: row.pigeonAt || 0
    }))
}

function boardRows(rows, now) {
  return (rows || []).map((row) => {
    if (row.absent && row.activityStartTime > now) return Object.assign({}, row, { absent: false })
    return row
  })
}

function parseScore(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 99) throw new Error('比分和数据请填 0 到 99 的整数')
  return number
}

const UNITE_TEAM = { _id: 'team_unite', name: '联队' }
const WAIT_HOURS = []
for (let hour = 24; hour >= 0; hour -= 1) WAIT_HOURS.push(hour)
const HOUR_MS = 60 * 60 * 1000

function signupModeOf(activity) {
  return activity && activity.signupMode === 'joint' ? 'joint' : 'split'
}

function otherClubId(teamId) {
  return teamId === 'team_jiong' ? 'team_pudong' : 'team_jiong'
}

function rosterTeams(mode) {
  return mode === 'joint' ? TEAMS.concat([UNITE_TEAM]) : TEAMS.slice()
}

function normalizeQuotas(input, mode) {
  if (mode === 'joint') {
    return rosterTeams('joint').map((team) => ({ teamId: team._id, maxSignups: 8 }))
  }
  const source = input || {}
  return TEAMS.map((team) => {
    const raw = source[team._id] == null ? 11 : Number(source[team._id])
    if (!Number.isInteger(raw) || raw < 1 || raw > 30) throw new Error(`${team.name} 的名额为 1 到 30`)
    return { teamId: team._id, maxSignups: raw }
  })
}

function waitChoices(startTime, now) {
  return WAIT_HOURS.filter((hours) => hours === 0 || startTime - hours * HOUR_MS > now)
}

function defaultWaitHours(startTime, now) {
  const choices = waitChoices(startTime, now)
  if (choices.indexOf(4) !== -1) return 4
  return choices[0]
}

function waitUntilAt(startTime, hours, now) {
  const value = Number(hours)
  if (WAIT_HOURS.indexOf(value) === -1) throw new Error('请选择后补时间')
  if (value !== 0 && startTime - value * HOUR_MS <= now) throw new Error('这个时间已经过了')
  return value === 0 ? startTime : startTime - value * HOUR_MS
}

function jointPlacement(homeTeamId, counts, maxes) {
  const order = [homeTeamId, UNITE_TEAM._id, otherClubId(homeTeamId)]
  for (let index = 0; index < order.length; index += 1) {
    const teamId = order[index]
    if ((counts[teamId] || 0) < (maxes[teamId] || 0)) {
      return { teamId, via: index === 0 ? 'home' : (teamId === UNITE_TEAM._id ? 'unite' : 'other') }
    }
  }
  return null
}

function withHomeTeam(rows, homeByOpenid) {
  if (!homeByOpenid) return rows
  return (rows || []).map((row) => {
    const openid = row.playerOpenid || row._openid
    const home = homeByOpenid[openid]
    if (!home) return row
    return Object.assign({}, row, { teamId: home })
  })
}

const PREFERRED_POSITIONS = [
  { id: 'fw', label: '前锋' },
  { id: 'mf', label: '中场' },
  { id: 'df', label: '后卫' },
  { id: 'gk', label: '门将' }
]
const POSITION_IDS = PREFERRED_POSITIONS.map((item) => item.id)
const MAX_ON_PITCH = 8

function isValidPosition(pos) {
  return POSITION_IDS.indexOf(pos) !== -1
}

function randomPreferredPosition(randomFn = Math.random) {
  const idx = Math.floor(randomFn() * POSITION_IDS.length)
  return POSITION_IDS[Math.max(0, Math.min(POSITION_IDS.length - 1, idx))]
}

function normalizePreferredPosition(pos, randomFn = Math.random) {
  if (pos === undefined || pos === null || pos === '') {
    return randomPreferredPosition(randomFn)
  }
  const value = String(pos).trim()
  if (!isValidPosition(value)) throw new Error('请选择擅长位置')
  return value
}

function validateTacticsBoardSave(payload) {
  const title = String((payload && payload.title) || '').trim() || '本场战术板'
  const slots = Array.isArray(payload && payload.slots) ? payload.slots : []
  if (slots.length > MAX_ON_PITCH) {
    throw new Error('场上最多 8 名球员')
  }
  const seen = new Set()
  const normalizedSlots = []
  for (const item of slots) {
    const userId = String((item && (item.userId || item._id || item.openid || item._openid)) || '').trim()
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    const rawX = Number(item.x)
    const rawY = Number(item.y)
    const x = Number.isFinite(rawX) ? Math.max(0.08, Math.min(0.92, Number(rawX.toFixed(4)))) : 0.5
    const y = Number.isFinite(rawY) ? Math.max(0.08, Math.min(0.92, Number(rawY.toFixed(4)))) : 0.5
    const role = isValidPosition(item.role) ? item.role : 'mf'
    normalizedSlots.push({ userId, x, y, role })
  }
  return {
    scope: 'activity',
    title,
    slots: normalizedSlots
  }
}

module.exports = {
  TEAMS,
  UNITE_TEAM,
  WAIT_HOURS,
  PREFERRED_POSITIONS,
  POSITION_IDS,
  MAX_ON_PITCH,
  assertNotAbsentWithStats,
  assertPigeonEditable,
  boardRows,
  pigeonRoster,
  willRecordPigeon,
  defaultWaitHours,
  jointPlacement,
  normalizeQuotas,
  otherClubId,
  parseScore,
  periodRange,
  recentStart,
  rosterTeams,
  signupModeOf,
  topBy,
  totalsByPlayer,
  attendancesByPlayer,
  waitChoices,
  waitUntilAt,
  withHomeTeam,
  isValidPosition,
  randomPreferredPosition,
  normalizePreferredPosition,
  validateTacticsBoardSave
}
