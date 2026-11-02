const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const CST_OFFSET = 8 * 60 * 60 * 1000

const VENUE_JIELONG = {
  _id: 'venue_jielong',
  name: '界龙足球基地',
  address: '上海市浦东新区川沙镇界绿路88号，界龙足球基地',
  latitude: 31.1905,
  longitude: 121.6904,
  pitches: [
    { id: 'pitch_1', name: '1号场', filmed: true },
    { id: 'pitch_2', name: '2号场', filmed: false },
    { id: 'pitch_3', name: '3号场', filmed: false }
  ]
}

const CLUB_WEDNESDAY = 'club_wednesday'
const CLUB_JIELONG = 'club_jielong'
const PENDING_TEAM = 'team_pending'
/** 界龙名册默认组：第一次必选，预选此项，可改 */
const JIELONG_DEFAULT_GROUP = 'jl_other'

const SESSION_TEAM_STYLES = [
  { id: 'sess_a', name: '红队', jerseyColor: '红', color: '#c44536' },
  { id: 'sess_b', name: '白队', jerseyColor: '白', color: '#f4f4f4' },
  { id: 'sess_c', name: '黄队', jerseyColor: '黄', color: '#e6b325' },
  { id: 'sess_d', name: '绿队', jerseyColor: '绿', color: '#1d6b50' },
  { id: 'sess_e', name: '蓝队', jerseyColor: '蓝', color: '#3d5a80' },
  { id: 'sess_f', name: '黑队', jerseyColor: '黑', color: '#1c2421' }
]

const CLUB_SEEDS = [
  {
    _id: CLUB_WEDNESDAY,
    name: '周三联',
    signupModes: ['split', 'joint'],
    groups: [
      { id: 'team_jiong', name: 'jiong 路青少年', jerseyColor: '黄', color: '#e6b325' },
      { id: 'team_pudong', name: '浦东老聚三', jerseyColor: '粉白', color: '#f4c2c2' }
    ],
    config: {
      cancelSignedCutoffHours: 4,
      waitlistLimit: 3,
      jointWaitlistLimit: 6,
      maxOnPitch: 8,
      enableTitleOdds: false
    }
  },
  {
    _id: CLUB_JIELONG,
    name: '界龙散客',
    signupModes: ['pool'],
    // 常驻名册六组（我的 / 球员 / 数据筛）；本场报名仍进待分队，由老板当场再分
    groups: [
      { id: 'jl_tazi', name: '塔子🕊', jerseyColor: '绿', color: '#1d6b50' },
      { id: 'jl_jielong', name: '界龙⭐️', jerseyColor: '白', color: '#f4f4f4' },
      { id: 'jl_shangxin', name: '伤心🇮🇹', jerseyColor: '黄', color: '#e6b325' },
      { id: 'jl_tangmu', name: '汤姆🐻', jerseyColor: '蓝', color: '#3d5a80' },
      { id: 'jl_aiqing', name: '爱情🔥', jerseyColor: '红', color: '#c44536' },
      { id: 'jl_other', name: '散客⚽️', jerseyColor: '黑', color: '#1c2421' }
    ],
    config: {
      cancelSignedCutoffHours: 4,
      waitlistLimit: 12,
      jointWaitlistLimit: 0,
      maxOnPitch: 8,
      enableTitleOdds: false,
      maxSignedPlayers: 40,
      defaultTeamSize: 8
    }
  }
]

function clubSeed(clubId) {
  return CLUB_SEEDS.find((club) => club._id === clubId) || null
}

function weekdayName(timestamp) {
  const shifted = new Date(Number(timestamp) + CST_OFFSET)
  return WEEKDAYS[shifted.getUTCDay()]
}

function formatKickoff(timestamp) {
  const shifted = new Date(Number(timestamp) + CST_OFFSET)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${weekdayName(timestamp)} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

function membershipView(user, clubId) {
  const list = (user && user.memberships) || []
  const hit = list.find((item) => item && item.clubId === clubId) || null
  let role = hit && hit.role ? hit.role : ''
  if (!role && user && user.canGrantAdmin) role = 'owner'
  else if (!role && user && user.isAdmin && clubId === CLUB_WEDNESDAY) role = 'admin'
  else if (!role && hit) role = 'member'
  else if (!role && user && clubId === CLUB_WEDNESDAY && user.teamId) role = 'member'
  const groupId = (hit && hit.groupId) || (clubId === CLUB_WEDNESDAY ? ((user && user.teamId) || '') : '')
  const joined = !!(hit || role || (clubId === CLUB_WEDNESDAY && user && user.teamId))
  return { role, groupId, joined }
}

function withWednesdayGroup(memberships, teamId) {
  const list = Array.isArray(memberships) ? memberships.map((item) => Object.assign({}, item)) : []
  const hit = list.find((item) => item.clubId === CLUB_WEDNESDAY)
  if (hit) hit.groupId = teamId
  else list.push({ clubId: CLUB_WEDNESDAY, groupId: teamId, role: '', labels: [] })
  return list
}

function withClubMembership(memberships, clubId, patch) {
  const list = Array.isArray(memberships) ? memberships.map((item) => Object.assign({}, item)) : []
  let hit = list.find((item) => item.clubId === clubId)
  if (!hit) {
    hit = { clubId, groupId: '', role: '', labels: [] }
    list.push(hit)
  }
  if (patch.groupId !== undefined) hit.groupId = patch.groupId
  if (patch.role) hit.role = patch.role
  if (patch.labels) hit.labels = patch.labels
  return list
}

function renameGroup(groups, groupId, name) {
  const nextName = String(name || '').trim()
  if (!nextName) throw new Error('请填写分组名称')
  if (nextName.length > 20) throw new Error('分组名称最多 20 个字')
  const list = (groups || []).map((group) => Object.assign({}, group))
  const hit = list.find((group) => group.id === groupId)
  if (!hit) throw new Error('找不到这个分组')
  hit.name = nextName
  return list
}

function recolorGroup(groups, groupId, color, jerseyColor) {
  const list = (groups || []).map((group) => Object.assign({}, group))
  const hit = list.find((group) => group.id === groupId)
  if (!hit) throw new Error('找不到这个分组')
  if (color) hit.color = String(color)
  if (jerseyColor) hit.jerseyColor = String(jerseyColor).trim()
  if (!hit.color && !hit.jerseyColor) throw new Error('请选择颜色')
  return list
}

function reorderGroups(groups, orderedIds) {
  const list = groups || []
  const ids = orderedIds || []
  if (ids.length !== list.length) throw new Error('分组顺序不完整')
  const map = {}
  list.forEach((group) => { map[group.id] = group })
  if (ids.some((id) => !map[id])) throw new Error('分组顺序不完整')
  if (new Set(ids).size !== ids.length) throw new Error('分组顺序不完整')
  return ids.map((id) => Object.assign({}, map[id]))
}

function normalizeTargetSize(value) {
  const size = Number(value == null ? 8 : value)
  if (![7, 8, 9].includes(size)) throw new Error('每队人数请选 7、8 或 9')
  return size
}

function normalizeTeamCount(value) {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 2 || count > 6) throw new Error('请分成 2 到 6 队')
  return count
}

function buildSessionTeams(teamCount) {
  const count = normalizeTeamCount(teamCount)
  return SESSION_TEAM_STYLES.slice(0, count).map((item) => Object.assign({}, item))
}

/**
 * 尽量按每队 targetSize（默认 8）分配。
 * 人不够时尽量匀开（允许 7 对 8）；人太多时只取前 capacity 人，其余留未分队。
 */
function dividePlayers(players, teamCount, targetSize = 8) {
  const count = normalizeTeamCount(teamCount)
  const size = normalizeTargetSize(targetSize)
  const list = Array.isArray(players) ? players.slice() : []
  const capacity = count * size
  const take = list.slice(0, Math.min(list.length, capacity))
  const leftover = list.slice(take.length)
  const teams = buildSessionTeams(count)
  const sizes = Array(count).fill(Math.floor(take.length / count))
  for (let i = 0; i < take.length % count; i += 1) sizes[i] += 1
  // Prefer teams closer to targetSize: put larger buckets first when leftover capacity exists
  const assignments = {}
  let cursor = 0
  teams.forEach((team, index) => {
    const chunk = take.slice(cursor, cursor + sizes[index])
    cursor += sizes[index]
    assignments[team.id] = chunk
  })
  return {
    teams,
    assignments,
    leftover,
    targetSize: size,
    capacity,
    assignedCount: take.length
  }
}

function placeInPool(input) {
  const signed = Number(input.signedCount || 0)
  const waiting = Number(input.waitlistCount || 0)
  const cap = Number(input.maxSignedPlayers || 40)
  const waitLimit = Number(input.waitlistLimit || 12)
  if (signed < cap) {
    return { status: 'signed', teamId: PENDING_TEAM, via: 'pool', label: '已报名' }
  }
  if (waiting >= waitLimit) throw new Error('后补已满')
  return { status: 'waitlist', teamId: PENDING_TEAM, via: 'waitlist', label: '后补' }
}

function assertAdminMove(input) {
  if (input.locked) throw new Error('已经有比分或进球，不能再改队')
  const teams = input.teams || []
  const targetId = input.targetId
  if (targetId !== PENDING_TEAM && !teams.some((team) => team.id === targetId)) {
    throw new Error('请选择队伍')
  }
  return { teamId: targetId }
}

function rosterLocked(rounds, events) {
  const scored = (rounds || []).some((round) => round.scoreA != null || round.scoreB != null)
  return scored || (events || []).length > 0
}

function matchRow(roundNo, pitchId, teamAId, teamBId, matchType) {
  return {
    roundNo,
    pitchId,
    teamAId,
    teamBId,
    scoreA: null,
    scoreB: null,
    matchType: matchType || 'group'
  }
}

function cupFixtures(groupIds) {
  const ids = groupIds || []
  if (ids.length === 4) {
    const [a, b, c, d] = ids
    return [
      matchRow(1, 'pitch_1', a, b),
      matchRow(1, 'pitch_2', c, d),
      matchRow(2, 'pitch_1', a, c),
      matchRow(2, 'pitch_2', b, d),
      matchRow(3, 'pitch_1', b, c),
      matchRow(3, 'pitch_2', a, d)
    ]
  }
  if (ids.length === 5) {
    const [a, b, c, d, e] = ids
    return [
      matchRow(1, 'pitch_1', a, b),
      matchRow(1, 'pitch_2', c, d),
      matchRow(2, 'pitch_1', c, e),
      matchRow(2, 'pitch_2', a, d),
      matchRow(3, 'pitch_1', d, e),
      matchRow(3, 'pitch_2', b, c),
      matchRow(4, 'pitch_1', b, d),
      matchRow(4, 'pitch_2', a, e),
      matchRow(5, 'pitch_1', a, c),
      matchRow(5, 'pitch_2', b, e)
    ]
  }
  if (ids.length === 6) {
    const [a, b, c, d, e, f] = ids
    return [
      matchRow(1, 'pitch_1', a, b),
      matchRow(1, 'pitch_2', c, d),
      matchRow(2, 'pitch_1', a, c),
      matchRow(2, 'pitch_2', e, f),
      matchRow(3, 'pitch_1', a, d),
      matchRow(3, 'pitch_2', b, e),
      matchRow(4, 'pitch_1', b, f),
      matchRow(4, 'pitch_2', a, e),
      matchRow(5, 'pitch_1', c, e),
      matchRow(5, 'pitch_2', a, f),
      matchRow(6, 'pitch_1', d, e),
      matchRow(6, 'pitch_2', b, c),
      matchRow(7, 'pitch_1', c, f),
      matchRow(7, 'pitch_2', b, d),
      matchRow(8, 'pitch_1', d, f)
    ]
  }
  return []
}

function shouldAutoFixture(teamCount) {
  return teamCount === 4 || teamCount === 5 || teamCount === 6
}

function rankTeams(groupIds, matches, tiebreakOrder) {
  const order = {}
  groupIds.forEach((id, index) => { order[id] = index })
  const rows = groupIds.map((id) => ({ id, pts: 0, gf: 0, ga: 0, gd: 0 }))
  const byId = {}
  rows.forEach((row) => { byId[row.id] = row })
  for (const match of matches || []) {
    if (match.matchType === 'final' || match.matchType === 'third') continue
    if (match.scoreA == null || match.scoreB == null) continue
    const home = byId[match.teamAId]
    const away = byId[match.teamBId]
    if (!home || !away) continue
    home.gf += match.scoreA
    home.ga += match.scoreB
    away.gf += match.scoreB
    away.ga += match.scoreA
    if (match.scoreA > match.scoreB) home.pts += 3
    else if (match.scoreA < match.scoreB) away.pts += 3
    else {
      home.pts += 1
      away.pts += 1
    }
  }
  rows.forEach((row) => { row.gd = row.gf - row.ga })
  const tieIndex = {}
  ;(tiebreakOrder || []).forEach((id, index) => { tieIndex[id] = index })
  rows.sort((a, b) => (
    b.pts - a.pts
    || b.gd - a.gd
    || b.gf - a.gf
    || (tieIndex[a.id] == null ? 99 : tieIndex[a.id]) - (tieIndex[b.id] == null ? 99 : tieIndex[b.id])
    || order[a.id] - order[b.id]
  ))
  rows.forEach((row) => { row.tied = false })
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[i].pts === rows[j].pts && rows[i].gd === rows[j].gd && rows[i].gf === rows[j].gf) {
        rows[i].tied = true
        rows[j].tied = true
      }
    }
  }
  return rows
}

function finalsForFour(groupIds, matches, tiebreakOrder) {
  if (!groupIds || groupIds.length !== 4) return []
  const groupMatches = (matches || []).filter((match) => match.matchType !== 'final' && match.matchType !== 'third')
  if (groupMatches.length < 6) return []
  if (groupMatches.some((match) => match.scoreA == null || match.scoreB == null)) return []
  const table = rankTeams(groupIds, groupMatches, tiebreakOrder)
  if (table.some((row) => row.tied) && !(tiebreakOrder || []).length) return []
  return [
    matchRow(4, 'pitch_1', table[0].id, table[1].id, 'final'),
    matchRow(4, 'pitch_2', table[2].id, table[3].id, 'third')
  ]
}

function pitchCounts(matches) {
  const counts = {}
  for (const match of matches || []) {
    if (match.pitchId !== 'pitch_1') continue
    counts[match.teamAId] = (counts[match.teamAId] || 0) + 1
    counts[match.teamBId] = (counts[match.teamBId] || 0) + 1
  }
  return counts
}

function applyGoalEvents(events) {
  const byPlayer = {}
  const touch = (openid) => {
    if (!openid) return null
    if (!byPlayer[openid]) byPlayer[openid] = { playerOpenid: openid, goals: 0, assists: 0, ownGoals: 0 }
    return byPlayer[openid]
  }
  for (const event of events || []) {
    if (event.isOwnGoal) {
      const row = touch(event.scorerOpenid)
      if (row) row.ownGoals += 1
      continue
    }
    const scorer = touch(event.scorerOpenid)
    if (scorer) scorer.goals += 1
    const assist = touch(event.assisterOpenid)
    if (assist) assist.assists += 1
  }
  return Object.values(byPlayer)
}

function normalizeGoalEvent(input) {
  const scorerOpenid = String((input && input.scorerOpenid) || '').trim()
  if (!scorerOpenid) throw new Error('请选择进球者')
  const isOwnGoal = !!(input && input.isOwnGoal)
  const assisterOpenid = isOwnGoal ? '' : String((input && input.assisterOpenid) || '').trim()
  if (isOwnGoal && input && input.assisterOpenid) throw new Error('乌龙没有助攻')
  if (assisterOpenid && assisterOpenid === scorerOpenid) throw new Error('助攻不能是进球者本人')
  return { scorerOpenid, assisterOpenid, isOwnGoal }
}

function pairRoster(signups) {
  const list = (signups || []).slice()
  const rows = []
  for (let i = 0; i < list.length; i += 2) {
    rows.push({ left: list[i], right: list[i + 1] || null })
  }
  return rows
}

module.exports = {
  VENUE_JIELONG,
  CLUB_WEDNESDAY,
  CLUB_JIELONG,
  PENDING_TEAM,
  JIELONG_DEFAULT_GROUP,
  SESSION_TEAM_STYLES,
  CLUB_SEEDS,
  clubSeed,
  weekdayName,
  formatKickoff,
  membershipView,
  withWednesdayGroup,
  withClubMembership,
  renameGroup,
  recolorGroup,
  reorderGroups,
  normalizeTargetSize,
  normalizeTeamCount,
  buildSessionTeams,
  dividePlayers,
  placeInPool,
  assertAdminMove,
  rosterLocked,
  cupFixtures,
  shouldAutoFixture,
  rankTeams,
  finalsForFour,
  pitchCounts,
  applyGoalEvents,
  normalizeGoalEvent,
  pairRoster
}
