const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const CST_OFFSET = 8 * 60 * 60 * 1000
const {
  TEAMS,
  normalizePlayerName,
  normalizePreferredPosition,
  isValidPosition,
  randomPreferredPosition
} = require('./rules')

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
  { id: 'sess_a', name: 'A队', jerseyColor: '红', color: '#c44536' },
  { id: 'sess_b', name: 'B队', jerseyColor: '白', color: '#f4f4f4' },
  { id: 'sess_c', name: 'C队', jerseyColor: '黄', color: '#e6b325' },
  { id: 'sess_d', name: 'D队', jerseyColor: '绿', color: '#1d6b50' },
  { id: 'sess_e', name: 'E队', jerseyColor: '蓝', color: '#3d5a80' },
  { id: 'sess_f', name: 'F队', jerseyColor: '黑', color: '#1c2421' }
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
      remindBeforeHours: 2,
      waitlistLimit: 3,
      jointWaitlistLimit: 6,
      maxOnPitch: 8,
      enableTitleOdds: false
    }
  },
  {
    _id: CLUB_JIELONG,
    name: '界龙散客队',
    signupModes: ['pool'],
    // 常驻名册六组；本场报名按 8 人自动扩队，也可一键按名册组分 6 队
    groups: [
      { id: 'jl_tazi', name: '塔子🕊', jerseyColor: '绿', color: '#1d6b50' },
      { id: 'jl_jielong', name: '界龙⭐️', jerseyColor: '白', color: '#f4f4f4' },
      { id: 'jl_shangxin', name: '伤心🇮🇹', jerseyColor: '黄', color: '#e6b325' },
      { id: 'jl_tangmu', name: '汤姆🐻', jerseyColor: '蓝', color: '#3d5a80' },
      { id: 'jl_aiqing', name: '爱情🔥', jerseyColor: '红', color: '#c44536' },
      { id: 'jl_other', name: '未分组', jerseyColor: '灰', color: '#66706c' }
    ],
    config: {
      cancelSignedCutoffHours: 1.5,
      remindBeforeHours: 2,
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

/** 临期取消记鸽子的小时数：周三联 4，界龙 1.5 */
function pigeonCutoffHours(clubId) {
  const seed = clubSeed(clubId || CLUB_WEDNESDAY)
  const hours = seed && seed.config && seed.config.cancelSignedCutoffHours
  return hours == null ? 4 : Number(hours)
}

/** 开赛提醒提前小时数：周三联 2，界龙 2 */
function remindBeforeHours(clubId) {
  const seed = clubSeed(clubId || CLUB_WEDNESDAY)
  const hours = seed && seed.config && seed.config.remindBeforeHours
  return hours == null ? 2 : Number(hours)
}

function remindLeadMs(clubId) {
  return remindBeforeHours(clubId) * 60 * 60 * 1000
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
  else if (!role && user && user.isAdmin) role = 'admin'
  else if (!role && hit) role = 'member'
  else if (!role && user && clubId === CLUB_WEDNESDAY && user.teamId) role = 'member'
  let groupId = (hit && hit.groupId) || (clubId === CLUB_WEDNESDAY ? ((user && user.teamId) || '') : '')
  const joined = !!(
    hit
    || (user && user.canGrantAdmin)
    || (clubId === CLUB_WEDNESDAY && user && (user.teamId || user.isAdmin))
  )
  // 界龙已入队但未写名册组 → 视为「未分组」（与「我的」展示、报名兜底一致）
  if (!groupId && joined && clubId === CLUB_JIELONG) groupId = JIELONG_DEFAULT_GROUP
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

function hasClubProfile(user, clubId, clubGroups) {
  if (!user || !String(user.name || '').trim()) return false
  const view = membershipView(user, clubId)
  if (!view.joined || !view.groupId) return false
  const groups = Array.isArray(clubGroups) && clubGroups.length
    ? clubGroups
    : ((clubSeed(clubId) && clubSeed(clubId).groups) || [])
  if (!groups.length) return true
  return groups.some((group) => (group.id || group._id) === view.groupId)
}

function buildProfileUpdate(existing, event = {}, options = {}) {
  const name = normalizePlayerName(event.name)
  const avatarUrl = typeof event.avatarUrl === 'string' ? event.avatarUrl : undefined
  const preferredPosition = event.preferredPosition !== undefined && event.preferredPosition !== ''
    ? normalizePreferredPosition(event.preferredPosition, options.randomFn)
    : (existing && isValidPosition(existing.preferredPosition)
      ? existing.preferredPosition
      : randomPreferredPosition(options.randomFn))
  const hasAnyAdmin = options.hasAnyAdmin !== undefined ? !!options.hasAnyAdmin : true
  const isAdmin = existing ? !!existing.isAdmin : !hasAnyAdmin
  const canGrantAdmin = existing ? !!existing.canGrantAdmin : isAdmin

  let teamId = (existing && existing.teamId) || ''
  let memberships = Array.isArray(existing && existing.memberships)
    ? existing.memberships.map((item) => Object.assign({}, item))
    : []
  let currentClubId = (existing && existing.currentClubId) || ''

  const targetClubId = String(event.clubId || '').trim()
  const hasExplicitTeam = event.teamId !== undefined && event.teamId !== ''

  if (targetClubId === CLUB_JIELONG) {
    const groups = (Array.isArray(options.jielongGroups) && options.jielongGroups.length)
      ? options.jielongGroups
      : ((clubSeed(CLUB_JIELONG) && clubSeed(CLUB_JIELONG).groups) || [])
    const groupId = String(event.groupId || event.teamId || '').trim()
    if (!groupId || !groups.some((item) => item.id === groupId)) {
      throw new Error('请选择名册分组')
    }
    const current = membershipView(existing, CLUB_JIELONG)
    const role = current.role === 'owner' || current.role === 'admin' ? current.role : 'member'
    memberships = withClubMembership(memberships, CLUB_JIELONG, { groupId, role })
    currentClubId = CLUB_JIELONG
  } else if (targetClubId === CLUB_WEDNESDAY || hasExplicitTeam) {
    const wedTeamId = targetClubId === CLUB_WEDNESDAY && event.groupId
      ? String(event.groupId).trim()
      : String(event.teamId || '').trim()
    if (!TEAMS.some((team) => team._id === wedTeamId)) throw new Error('请选择球队')
    teamId = wedTeamId
    memberships = withWednesdayGroup(memberships, wedTeamId)
    currentClubId = CLUB_WEDNESDAY
  }

  const data = {
    name,
    teamId,
    preferredPosition,
    isAdmin,
    canGrantAdmin,
    memberships,
    updatedAt: options.now || Date.now()
  }
  if (currentClubId) data.currentClubId = currentClubId
  if (avatarUrl !== undefined) data.avatarUrl = avatarUrl
  return data
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

/** 第 signedIndex（0 起）个正选应进第几队：每队 teamSize 人，最多 maxTeams 队，溢出进最后一队 */
function sessionTeamSlot(signedIndex, teamSize = 8, maxTeams = SESSION_TEAM_STYLES.length) {
  const size = Math.max(1, Number(teamSize) || 8)
  const max = Math.min(Math.max(Number(maxTeams) || SESSION_TEAM_STYLES.length, 1), SESSION_TEAM_STYLES.length)
  const index = Math.max(0, Number(signedIndex) || 0)
  return Math.min(Math.floor(index / size), max - 1)
}

/** 把 activity.teams 扩到至少 neededCount 支（沿用已有队，补 SESSION_TEAM_STYLES） */
function expandSessionTeams(teams, neededCount) {
  const list = Array.isArray(teams) ? teams.slice() : []
  const needed = Math.min(Math.max(Number(neededCount) || 1, 1), SESSION_TEAM_STYLES.length)
  const used = new Set(list.map((team) => team && team.id).filter(Boolean))
  while (list.length < needed) {
    const style = SESSION_TEAM_STYLES.find((item) => !used.has(item.id))
    if (!style) break
    used.add(style.id)
    list.push(Object.assign({}, style))
  }
  return list
}

/**
 * 按报名序号自动入队：扩队 + 给出本场 teamId。
 * signedIndex：当前将写入的正选是全场第几个（0 起）。
 */
function autoSessionPlacement(signedIndex, existingTeams, teamSize = 8) {
  const slot = sessionTeamSlot(signedIndex, teamSize, SESSION_TEAM_STYLES.length)
  const teams = expandSessionTeams(existingTeams, slot + 1)
  const team = teams[slot] || teams[teams.length - 1]
  return {
    teams,
    teamId: team.id,
    teamIndex: slot,
    teamCount: teams.length
  }
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

/** 按名册组落到 6 个场次队；无名册组进最后一队（散客） */
function divideByRosterGroups(players, groupIdOf, rosterGroups) {
  const groups = Array.isArray(rosterGroups) && rosterGroups.length
    ? rosterGroups.slice(0, SESSION_TEAM_STYLES.length)
    : []
  const teams = SESSION_TEAM_STYLES.map((style, index) => {
    const group = groups[index]
    if (!group) return Object.assign({}, style)
    return Object.assign({}, style, {
      name: group.name || style.name,
      color: group.color || style.color,
      jerseyColor: group.jerseyColor || style.jerseyColor,
      rosterGroupId: group.id
    })
  })
  const groupToTeam = {}
  groups.forEach((group, index) => {
    if (group && group.id) groupToTeam[group.id] = teams[index].id
  })
  const fallbackTeamId = teams[teams.length - 1].id
  const assignments = {}
  teams.forEach((team) => { assignments[team.id] = [] })
  ;(players || []).forEach((player) => {
    const openid = player && (player._openid || player.openid)
    const groupId = typeof groupIdOf === 'function' ? groupIdOf(openid, player) : ''
    const teamId = (groupId && groupToTeam[groupId]) || fallbackTeamId
    assignments[teamId].push(player)
  })
  return {
    teams,
    assignments,
    assignedCount: (players || []).length,
    leftover: []
  }
}

function placeInPool() {
  return { status: 'signed', teamId: PENDING_TEAM, via: 'pool', label: '已报名' }
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
  // 只按比分锁定；进球/助攻可边记边调人，不锁分队
  void events
  return (rounds || []).some((round) => round.scoreA != null || round.scoreB != null)
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

function shuffleIds(list, rng) {
  const random = typeof rng === 'function' ? rng : Math.random
  const copy = (list || []).slice()
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = copy[i]
    copy[i] = copy[j]
    copy[j] = temp
  }
  return copy
}

function cupFixtures(groupIds, rng) {
  const ids = shuffleIds(groupIds || [], rng)
  if (ids.length === 4) {
    // 3-1-1-1：抽到第 1 位的 a 在小组赛踢 3 场 1 号场，其余三队各踢 1 场 1 号场
    const [a, b, c, d] = ids
    return [
      matchRow(1, 'pitch_1', a, b),
      matchRow(1, 'pitch_2', c, d),
      matchRow(2, 'pitch_1', a, c),
      matchRow(2, 'pitch_2', b, d),
      matchRow(3, 'pitch_1', a, d),
      matchRow(3, 'pitch_2', b, c)
    ]
  }
  if (ids.length === 5) {
    // 随机洗牌后套入 5 轮模板：每队踢 4 场、轮空 1 轮、1 号场严格各 2 场
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
  return []
}

function shouldAutoFixture(teamCount) {
  return teamCount === 4 || teamCount === 5
}

const CUP_MIN_PLAYERS = 24

function evaluateJielongCup(teams, signups) {
  const teamList = (teams || []).filter((team) => team && team.id && team.id !== PENDING_TEAM)
  const validTeamIds = new Set(teamList.map((team) => team.id))
  const countByTeam = {}
  let pendingCount = 0
  ;(signups || []).forEach((row) => {
    if (!row || (row.status && row.status !== 'signed')) return
    const teamId = row.teamId || PENDING_TEAM
    if (teamId === PENDING_TEAM || !validTeamIds.has(teamId)) {
      pendingCount += 1
      return
    }
    countByTeam[teamId] = (countByTeam[teamId] || 0) + 1
  })
  const activeTeams = teamList.filter((team) => (countByTeam[team.id] || 0) > 0)
  const emptyTeams = teamList.filter((team) => !(countByTeam[team.id] || 0))
  const activeTeamIds = activeTeams.map((team) => team.id)
  const activePlayerCount = activeTeams.reduce((sum, team) => sum + (countByTeam[team.id] || 0), 0)
  const count = activeTeams.length
  const eligible = (count === 4 || count === 5) && activePlayerCount >= CUP_MIN_PLAYERS
  let reason = ''
  if (!eligible) {
    if (count === 6) {
      reason = '当前有 6 支非空队伍，不支持一键开启界龙杯（仅支持 4 队或 5 队）；开赛前 2 小时起支持手动记录轮次比分与个人数据，无积分榜'
    } else {
      reason = `开启界龙杯需满足：非空队伍数为 4 或 5 支（当前 ${count} 支），且队内总人数不少于 ${CUP_MIN_PLAYERS} 人（当前 ${activePlayerCount} 人）`
    }
  }
  return {
    activeTeams,
    activeTeamIds,
    emptyTeams,
    activePlayerCount,
    pendingCount,
    eligible,
    reason
  }
}

function isCupTeamsDrifted(cupTeamIds, activeTeamIds) {
  if (!Array.isArray(cupTeamIds) || !cupTeamIds.length) return false
  const current = Array.isArray(activeTeamIds) ? activeTeamIds : []
  if (cupTeamIds.length !== current.length) return true
  const set = new Set(current)
  return cupTeamIds.some((id) => !set.has(id))
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
  const counts = pitchCounts(groupMatches)
  const finalHasTwoPlus = (counts[table[0].id] || 0) >= 2 || (counts[table[1].id] || 0) >= 2
  const thirdHasTwoPlus = (counts[table[2].id] || 0) >= 2 || (counts[table[3].id] || 0) >= 2
  let finalPitch = 'pitch_1'
  let thirdPitch = 'pitch_2'
  // 小组赛已在 1 号场踢过 ≥2 场的队伍默认让出 1 号场，去 2 号场
  if (finalHasTwoPlus && !thirdHasTwoPlus) {
    finalPitch = 'pitch_2'
    thirdPitch = 'pitch_1'
  }
  return [
    matchRow(4, finalPitch, table[0].id, table[1].id, 'final'),
    matchRow(4, thirdPitch, table[2].id, table[3].id, 'third')
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
  pigeonCutoffHours,
  remindBeforeHours,
  remindLeadMs,
  weekdayName,
  formatKickoff,
  membershipView,
  withWednesdayGroup,
  withClubMembership,
  hasClubProfile,
  buildProfileUpdate,
  renameGroup,
  recolorGroup,
  reorderGroups,
  normalizeTargetSize,
  normalizeTeamCount,
  buildSessionTeams,
  sessionTeamSlot,
  expandSessionTeams,
  autoSessionPlacement,
  dividePlayers,
  divideByRosterGroups,
  placeInPool,
  assertAdminMove,
  rosterLocked,
  shuffleIds,
  cupFixtures,
  shouldAutoFixture,
  CUP_MIN_PLAYERS,
  evaluateJielongCup,
  isCupTeamsDrifted,
  rankTeams,
  finalsForFour,
  pitchCounts,
  applyGoalEvents,
  normalizeGoalEvent,
  pairRoster
}
