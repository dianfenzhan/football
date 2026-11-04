const { call, callQuiet, formatTime, uploadAvatar, assertPlayerName, avatarChar, avatarColor } = require('../../utils/api')
const {
  PREFERRED_POSITIONS,
  buildDefaultTacticsState,
  reconcileSavedBoard,
  applyPitchDrag,
  renderTacticsPoster
} = require('../../utils/tactics')
const {
  syncFilterFromActivity,
  normalizeClubs,
  setMultiClubReady,
  joinedClubs
} = require('../../utils/club-context')

const PENDING = 'team_pending'
/** 开赛前多久自动开放轮次/积分/个人数据（队员可见；管理员可提前筹备对阵） */
const SESSION_OPEN_LEAD_MS = 2 * 60 * 60 * 1000
const JIELONG_DEFAULT_GROUP = 'jl_other'
const JIELONG_GROUPS = [
  { id: 'jl_tazi', name: '塔子🕊', color: '#1d6b50' },
  { id: 'jl_jielong', name: '界龙⭐️', color: '#f4f4f4' },
  { id: 'jl_shangxin', name: '伤心🇮🇹', color: '#e6b325' },
  { id: 'jl_tangmu', name: '汤姆🐻', color: '#3d5a80' },
  { id: 'jl_aiqing', name: '爱情🔥', color: '#c44536' },
  { id: 'jl_other', name: '未分组', color: '#66706c' }
]
/** 与云函数 SESSION_TEAM_STYLES 对齐；对阵引用已删队时的兜底名 */
const SESSION_TEAM_FALLBACK = {
  sess_a: { name: 'A队', color: '#c44536' },
  sess_b: { name: 'B队', color: '#f4f4f4' },
  sess_c: { name: 'C队', color: '#e6b325' },
  sess_d: { name: 'D队', color: '#1d6b50' },
  sess_e: { name: 'E队', color: '#3d5a80' },
  sess_f: { name: 'F队', color: '#1c2421' }
}

function sessionTeamLabel(teamId, teamNameMap) {
  const id = String(teamId || '').trim()
  if (!id) return '未知队'
  const mapped = teamNameMap && teamNameMap[id]
  if (mapped) return mapped
  const fallback = SESSION_TEAM_FALLBACK[id]
  return fallback ? `${fallback.name}（已不在名单）` : '未知队'
}

function sessionTeamColor(teamId, teamColorMap) {
  const id = String(teamId || '').trim()
  const mapped = teamColorMap && teamColorMap[id]
  if (mapped) return mapped
  const fallback = SESSION_TEAM_FALLBACK[id]
  return (fallback && fallback.color) || '#66706c'
}

function sessionOrderKey(row) {
  if (row && Number.isFinite(row.sessionOrder)) return row.sessionOrder
  return (row && row.createdAt) || 0
}

function sortSessionMembers(list) {
  return (list || []).slice().sort((a, b) => (
    sessionOrderKey(a) - sessionOrderKey(b)
    || String(a.userName || '').localeCompare(String(b.userName || ''), 'zh')
  ))
}

function pigeonRuleText(startTime, cutoffHours) {
  const hours = cutoffHours == null ? 1.5 : Number(cutoffHours)
  const start = Number(startTime)
  if (!Number.isFinite(start) || start <= 0) {
    return `开赛前 ${hours} 小时之前取消报名，无责；之后取消，记一次鸽子。`
  }
  const date = new Date(start - hours * 60 * 60 * 1000)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  const when = `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${when} 之前取消报名，无责；之后取消，记一次鸽子。`
}

function standingsOf(teams, rounds) {
  const list = (teams || []).map((team) => ({
    id: team.id,
    name: team.name,
    color: team.color,
    pts: 0,
    gf: 0,
    ga: 0,
    gd: 0
  }))
  const byId = {}
  list.forEach((row) => { byId[row.id] = row })
  ;(rounds || []).forEach((round) => {
    if (round.matchType === 'final' || round.matchType === 'third') return
    if (round.scoreA == null || round.scoreB == null) return
    const home = byId[round.teamAId]
    const away = byId[round.teamBId]
    if (!home || !away) return
    home.gf += Number(round.scoreA)
    home.ga += Number(round.scoreB)
    away.gf += Number(round.scoreB)
    away.ga += Number(round.scoreA)
    if (round.scoreA > round.scoreB) home.pts += 3
    else if (round.scoreA < round.scoreB) away.pts += 3
    else {
      home.pts += 1
      away.pts += 1
    }
  })
  list.forEach((row) => { row.gd = row.gf - row.ga })
  list.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
  return list
}

function teamMeta(teams, teamId) {
  const hit = (teams || []).find((t) => t.id === teamId)
  return hit
    ? { id: hit.id, name: hit.name, color: hit.color }
    : { id: teamId, name: sessionTeamLabel(teamId), color: sessionTeamColor(teamId) }
}

/** 4 队：决赛+季军赛记满后出领奖台；5 队：小组赛全部记满后按积分前三 */
function buildPodium(teams, rounds, cupTeamCount) {
  const count = Number(cupTeamCount) || (teams || []).length
  const list = teams || []
  const allRounds = rounds || []
  if (count === 4) {
    const final = allRounds.find((r) => r.matchType === 'final' && r.scoreA != null && r.scoreB != null)
    const third = allRounds.find((r) => r.matchType === 'third' && r.scoreA != null && r.scoreB != null)
    if (!final || !third) return []
    if (Number(final.scoreA) === Number(final.scoreB)) return []
    if (Number(third.scoreA) === Number(third.scoreB)) return []
    const champId = Number(final.scoreA) > Number(final.scoreB) ? final.teamAId : final.teamBId
    const secondId = champId === final.teamAId ? final.teamBId : final.teamAId
    const thirdId = Number(third.scoreA) > Number(third.scoreB) ? third.teamAId : third.teamBId
    return [
      Object.assign({ place: '冠军', placeRank: 1 }, teamMeta(list, champId)),
      Object.assign({ place: '亚军', placeRank: 2 }, teamMeta(list, secondId)),
      Object.assign({ place: '季军', placeRank: 3 }, teamMeta(list, thirdId))
    ]
  }
  if (count === 5) {
    const group = allRounds.filter((r) => r.matchType !== 'final' && r.matchType !== 'third')
    if (group.length < 10 || group.some((r) => r.scoreA == null || r.scoreB == null)) return []
    const table = standingsOf(list, allRounds)
    return table.slice(0, 3).map((row, idx) => Object.assign({
      place: idx === 0 ? '冠军' : (idx === 1 ? '亚军' : '季军'),
      placeRank: idx + 1
    }, row))
  }
  return []
}

const CN_NUMS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
function roundLabel(no) {
  return `第${CN_NUMS[no] || no}轮`
}

function buildRoundDirectories(teams, rounds, extraRounds = [], hiddenRounds = [], cupStarted = false) {
  const teamList = teams || []
  const byRound = {}
  ;(rounds || []).forEach((match) => {
    const no = Number(match.roundNo) || 1
    if (!byRound[no]) byRound[no] = []
    byRound[no].push(match)
  })
  const defaultMax = cupStarted
    ? (teamList.length === 4 ? 4 : (teamList.length === 5 ? 5 : 0))
    : 0
  const roundNos = new Set()
  for (let i = 1; i <= defaultMax; i += 1) roundNos.add(i)
  Object.keys(byRound).forEach((k) => roundNos.add(Number(k)))
  ;(extraRounds || []).forEach((n) => roundNos.add(Number(n)))
  const hidden = new Set((hiddenRounds || []).map((n) => Number(n)).filter((n) => n >= 1))
  return Array.from(roundNos)
    .filter((n) => {
      if (n < 1) return false
      // 仍有场次的轮次始终展示；隐藏只作用于空目录
      if (byRound[n] && byRound[n].length) return true
      return !hidden.has(n)
    })
    .sort((a, b) => a - b)
    .map((roundNo, index) => {
      const matches = (byRound[roundNo] || []).slice().sort((a, b) => (
        String(a.pitchId || '').localeCompare(String(b.pitchId || ''))
      ))
      const playingIds = new Set()
      matches.forEach((m) => {
        if (m.teamAId) playingIds.add(m.teamAId)
        if (m.teamBId) playingIds.add(m.teamBId)
      })
      const byeTeams = matches.length > 0
        ? teamList.filter((t) => !playingIds.has(t.id)).map((t) => t.name)
        : []
      return {
        roundNo,
        // 展示序号按当前可见顺序，避免删中间轮后仍显示「第三轮」
        title: roundLabel(index + 1),
        matches,
        byeText: byeTeams.length ? `轮空：${byeTeams.join('、')}` : ''
      }
    })
}

function withPlayerAvatar(player) {
  const userName = (player && player.userName) || ''
  return {
    ...player,
    userName,
    avatarChar: avatarChar(userName),
    avatarBg: avatarColor(userName)
  }
}

function sessionTeamGridCols(teamCount) {
  return Number(teamCount) <= 4 ? 2 : 3
}

function countPitchOneByTeams(teams, rounds) {
  const counts = {}
  ;(rounds || []).forEach((m) => {
    if (m.pitchId !== 'pitch_1') return
    counts[m.teamAId] = (counts[m.teamAId] || 0) + 1
    counts[m.teamBId] = (counts[m.teamBId] || 0) + 1
  })
  return (teams || []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    count: counts[t.id] || 0
  }))
}

Page({
  data: {
    id: '',
    activity: null,
    divided: false,
    isAdmin: false,
    started: false,
    sessionOpen: false,
    cupStarted: false,
    cupTeamCount: 0,
    cupTeamsChanged: false,
    activeTeamCount: 0,
    activePlayerCount: 0,
    emptyTeamNames: [],
    showStandings: false,
    showFixtures: false,
    showPersonalData: false,
    ended: false,
    locked: false,
    timeText: '',
    mineStatus: '',
    signed: false,
    cancelWillPigeon: false,
    signedCount: 0,
    pendingCount: 0,
    pendingPlayers: [],
    teamCards: [],
    rounds: [],
    roundGroups: [],
    extraRoundNos: [],
    hiddenRoundNos: [],
    pitchOneSummary: [],
    standings: [],
    scoreDraft: {},
    rosterGroups: JIELONG_GROUPS,
    positions: PREFERRED_POSITIONS,
    pickGroupId: JIELONG_DEFAULT_GROUP,
    hasProfile: false,
    jielongJoined: false,
    me: null,
    showRegister: false,
    showPledge: false,
    pledgeButtonText: '同意并报名',
    pledgeTitle: '报名须知',
    pledgeHint: '',
    pigeonRuleText: '',
    pigeonCutoffHours: 1.5,
    remindBeforeHours: 2,
    subscribeTemplates: {},
    regName: '',
    regAvatarUrl: '',
    regTempAvatar: '',
    regPosition: '',
    regSaving: false,
    showRename: false,
    renameTeamId: '',
    renameDraft: '',
    renameColor: '',
    renameJerseyColor: '',
    colorPresets: [
      { id: 'red', label: '红', color: '#c44536' },
      { id: 'white', label: '白', color: '#f4f4f4' },
      { id: 'yellow', label: '黄', color: '#e6b325' },
      { id: 'green', label: '绿', color: '#1d6b50' },
      { id: 'blue', label: '蓝', color: '#3d5a80' },
      { id: 'black', label: '黑', color: '#1c2421' },
      { id: 'gray', label: '灰', color: '#66706c' }
    ],
    cupActionEnabled: false,
    cupActionHint: '',
    podium: [],
    showFixtureModal: false,
    fixtureEditId: '',
    fixtureRoundNo: 1,
    fixtureRoundLocked: false,
    fixtureRoundOptions: [],
    fixtureRoundIndex: 0,
    fixturePitchId: 'pitch_1',
    fixtureMatchType: 'group',
    fixtureTeamAId: '',
    fixtureTeamBId: '',
    fixtureSaving: false,
    statOptions: Array.from({ length: 21 }, (_, index) => `${index}`),
    pigeonOptions: ['正常', '鸽子'],
    memberFilters: [],
    memberTeam: 'all',
    signedMembers: [],
    pickMembers: [],
    pickIndex: 0,
    selectedOpenid: '',
    pickedLabel: '选择队员',
    goalIndex: 0,
    assistIndex: 0,
    ownGoalIndex: 0,
    pigeonIndex: 0,
    savingStat: false,
    records: [],
    pigeons: [],
    allSignedPlayers: [],
    draggingId: '',
    dragHoverTeam: '',
    dragHoverOpenid: '',
    dragGhostName: '',
    dragHint: '',
    canAddTeam: false,
    canRemoveTeam: false,
    teamGridCols: 2,
    showBasics: false,
    basicsTitle: '',
    basicsDate: '',
    basicsTime: '',
    basicsMax: '40',
    basicsSaving: false,
    signups: [],
    activityBoards: {},
    tacticsList: [],
    tacticsTeamId: '',
    tacticsTeamName: '',
    tacticsBoard: buildDefaultTacticsState([]),
    tacticsRemovedNotice: '',
    canEditTactics: false,
    savingTacticsBoard: false,
    exportingTactics: false,
    tacticsDraggingUserId: '',
    tacticsDraggingSource: '',
    tacticsDragPreviewActive: false,
    tacticsDragPreviewLeft: 50,
    tacticsDragPreviewTop: 50,
    tacticsDragPlayer: null
  },
  onLoad(query) {
    this.setData({ id: query.id })
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onUnload() {
    this.clearTacticsHoldTimer()
  },
  onShow() {
    if (this.data.id) this.load()
  },
  onShareAppMessage() {
    const activity = this.data.activity
    if (!activity) {
      return {
        title: '界龙散客队',
        path: `/pages/session/session?id=${this.data.id}`
      }
    }
    const date = new Date(activity.startTime)
    const weeks = ['日', '一', '二', '三', '四', '五', '六']
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
    const when = `${date.getMonth() + 1}.${date.getDate()} 周${weeks[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    const signed = this.data.signedCount || 0
    const gap = signed > 0 ? `已报名 ${signed} 人，速来！` : '报名开启，速来！'
    return {
      title: `${activity.title}｜${when} ${activity.location || ''}，${gap}`,
      path: `/pages/session/session?id=${this.data.id}`
    }
  },
  syncClubFilter(activity) {
    const clubId = (activity && activity.clubId) || 'club_jielong'
    callQuiet('orgMe').then((org) => {
      setMultiClubReady(true)
      syncFilterFromActivity(clubId, normalizeClubs((org && org.clubs) || [], null, null))
    }).catch(() => {
      callQuiet('me').then((me) => {
        const clubs = normalizeClubs([], me.user, me.teams)
        if (!joinedClubs(clubs).length || joinedClubs(clubs).some((c) => c._id === clubId)) {
          syncFilterFromActivity(clubId, clubs)
        }
      }).catch(() => {})
    })
  },
  load() {
    Promise.all([
      call('activityDetail', { activityId: this.data.id }),
      callQuiet('orgMe').catch(() => null)
    ]).then(([detail, org]) => {
      const activity = detail.activity
      this.syncClubFilter(activity)
      const clubs = normalizeClubs((org && org.clubs) || [], detail.me, null)
      const club = clubs.find((item) => item._id === 'club_jielong')
      const isAdmin = !!(club && club.joined && (club.role === 'admin' || club.role === 'owner'))
        || !!(detail.me && (detail.me.canGrantAdmin || detail.me.isAdmin))
      const me = detail.me || null
      const meOpenid = me && me._openid
      const hasProfile = !!(me && String(me.name || '').trim())
      const rosterGroups = ((club && club.groups) || []).length
        ? club.groups
        : JIELONG_GROUPS
      const groupInRoster = (groupId) => !!(groupId && rosterGroups.some((g) => (g.id || g._id) === groupId))
      // 已入队且名册为空时与后端一致，按「未分组」计，避免每次报名再弹确认资料
      const rawGroup = (club && club.groupId)
        || (((me && me.memberships) || []).find((m) => m && m.clubId === 'club_jielong') || {}).groupId
        || ''
      const existingGroup = groupInRoster(rawGroup)
        ? rawGroup
        : ((club && club.joined && groupInRoster(JIELONG_DEFAULT_GROUP)) ? JIELONG_DEFAULT_GROUP : '')
      const hasValidGroup = groupInRoster(existingGroup)
      const jielongJoined = !!(hasProfile && club && club.joined && hasValidGroup)
      const signups = detail.signups || []
      const signedList = signups.filter((item) => item.status === 'signed')
      const divided = !!activity.divided && (activity.teams || []).length > 0
      const pending = signedList.filter((item) => !item.teamId || item.teamId === PENDING)
      // 与后端一致：有比分才锁队；进球不锁
      const locked = !!(detail.rounds || []).some((round) => round.scoreA != null || round.scoreB != null)
      const mine = signups.find((item) => item._openid === meOpenid && item.status === 'signed')
      const iSigned = !!mine
      let mineStatus = ''
      if (iSigned && divided) {
        const team = (activity.teams || []).find((item) => item.id === mine.teamId)
        mineStatus = team ? `已报名 · ${team.name}` : '已报名 · 待分队'
      } else if (iSigned) mineStatus = '已报名'

      const pickGroupId = hasValidGroup
        ? existingGroup
        : (this.data.pickGroupId && rosterGroups.some((g) => g.id === this.data.pickGroupId)
          ? this.data.pickGroupId
          : JIELONG_DEFAULT_GROUP)

      const allTeamsWithMembers = (activity.teams || []).map((team) => {
        const members = sortSessionMembers(signedList.filter((item) => item.teamId === team.id))
          .map(withPlayerAvatar)
        return { ...team, members, count: members.length }
      })
      const activeTeams = allTeamsWithMembers.filter((team) => team.count > 0)
      const emptyTeams = allTeamsWithMembers.filter((team) => team.count === 0)
      const activeTeamCount = activeTeams.length
      const activePlayerCount = activeTeams.reduce((sum, team) => sum + team.count, 0)
      const emptyTeamNames = emptyTeams.map((team) => team.name)
      const teamCards = allTeamsWithMembers.filter((team) => team.count > 0 || isAdmin)
      // ≤4 队两列；≥5 队三列（含空队；加减队后随 teams.length 变）
      const teamCount = (activity.teams || []).length
      const teamGridCols = sessionTeamGridCols(teamCount)
      const canAddTeam = !!(isAdmin && divided && !locked && teamCount < 6)
      const canRemoveTeam = !!(isAdmin && divided && !locked && teamCount > 2)
      const pendingSorted = sortSessionMembers(pending).map(withPlayerAvatar)

      const cupStarted = !!activity.cupStarted
      const cupTeamIds = Array.isArray(activity.cupTeamIds) && activity.cupTeamIds.length
        ? activity.cupTeamIds
        : []
      const cupTeams = (cupStarted && cupTeamIds.length)
        ? cupTeamIds
          .map((id) => (activity.teams || []).find((t) => t.id === id))
          .filter(Boolean)
        : activeTeams
      const cupTeamCount = cupStarted ? (cupTeams.length || activeTeamCount) : 0
      const activeIds = activeTeams.map((t) => t.id)
      const cupTeamsChanged = !!(
        cupStarted
        && cupTeamIds.length
        && (cupTeamIds.length !== activeIds.length || cupTeamIds.some((id) => !activeIds.includes(id)))
      )

      const teamNameMap = {}
      const teamColorMap = {}
      ;(activity.teams || []).forEach((t) => {
        const id = t && (t.id || t._id)
        if (!id) return
        const name = String((t && t.name) || '').trim()
        if (name) teamNameMap[id] = name
        if (t.color) teamColorMap[id] = t.color
      })
      const rounds = (detail.rounds || []).map((round) => ({
        ...round,
        left: sessionTeamLabel(round.teamAId, teamNameMap),
        right: sessionTeamLabel(round.teamBId, teamNameMap),
        leftColor: sessionTeamColor(round.teamAId, teamColorMap),
        rightColor: sessionTeamColor(round.teamBId, teamColorMap),
        scoreText: round.scoreA != null ? `${round.scoreA} : ${round.scoreB}` : '未记分',
        typeLabel: round.matchType === 'final' ? '冠亚军' : (round.matchType === 'third' ? '季军赛' : ''),
        scored: round.scoreA != null && round.scoreB != null
      }))
      const scoreDraft = {}
      rounds.forEach((r) => {
        const prev = (this.data.scoreDraft && this.data.scoreDraft[r._id]) || {}
        scoreDraft[r._id] = {
          a: r.scoreA != null ? String(r.scoreA) : (prev.a != null ? prev.a : ''),
          b: r.scoreB != null ? String(r.scoreB) : (prev.b != null ? prev.b : '')
        }
      })
      const roundGroups = buildRoundDirectories(
        cupStarted ? cupTeams : activeTeams,
        rounds,
        this.data.extraRoundNos || [],
        this.data.hiddenRoundNos || [],
        cupStarted
      )
      const pitchOneSummary = countPitchOneByTeams(cupStarted ? cupTeams : activeTeams, rounds)
      const standings = cupStarted ? standingsOf(cupTeams, detail.rounds || []) : []
      const podium = cupStarted
        ? buildPodium(cupTeams, detail.rounds || [], cupTeamCount || cupTeams.length)
        : []
      const now = Date.now()
      const sessionOpen = Number(activity.startTime) - SESSION_OPEN_LEAD_MS <= now
      // 开启界龙杯后立即展示积分榜、轮次与管理员记球员数据；未开启界龙杯则在开赛前 2 小时自动开放轮次与个人数据（无积分榜）
      const showStandings = !!(cupStarted && standings.length)
      const showFixtures = !!(divided && (cupStarted || sessionOpen))
      const showPersonalData = !!((sessionOpen || cupStarted) && isAdmin)
      const cupEligible = (activeTeamCount === 4 || activeTeamCount === 5) && activePlayerCount >= 24
      let cupActionHint = ''
      if (!cupEligible) {
        if (activeTeamCount === 6) {
          cupActionHint = '6 支非空队不支持一键开赛（仅 4 或 5 队）'
        } else if (activeTeamCount < 4) {
          cupActionHint = `需 4 或 5 支非空队（当前 ${activeTeamCount}）且 ≥24 人`
        } else {
          cupActionHint = `需队内正选 ≥24 人（当前 ${activePlayerCount}）`
        }
      }
      const cupActionEnabled = !!(isAdmin && (cupStarted || cupEligible))
      const allSignedPlayers = signedList.map((item) => ({
        openid: item._openid,
        name: item.userName,
        teamId: item.teamId || PENDING
      }))

      const contributionMap = {}
      ;(detail.contributions || []).forEach((item) => {
        contributionMap[item.playerOpenid] = item
      })
      this.contributionMap = contributionMap
      const signedMembers = signedList.map((item) => {
        const tName = teamNameMap[item.teamId] || '待分队'
        return {
          _openid: item._openid,
          name: item.userName,
          teamId: item.teamId || PENDING,
          teamName: tName,
          label: `${item.userName} · ${tName}`
        }
      })
      const memberTeam = this.data.memberTeam || 'all'
      const pickMembers = memberTeam === 'all'
        ? signedMembers
        : signedMembers.filter((item) => item.teamId === memberTeam)
      const picked = pickMembers.find((item) => item._openid === this.data.selectedOpenid) || pickMembers[0] || null
      const stat = picked ? (contributionMap[picked._openid] || {}) : {}
      const keepForm = !!(picked && this.data.selectedOpenid === picked._openid)

      const records = (detail.contributions || []).map((item) => {
        const goals = item.goals || 0
        const assists = item.assists || 0
        const ownGoals = item.ownGoals || 0
        const signedRow = signedList.find((s) => s._openid === item.playerOpenid)
        const resolvedTeamId = (signedRow && signedRow.teamId) || item.teamId || ''
        return {
          ...item,
          goals,
          assists,
          ownGoals,
          absent: !!item.absent,
          goalIndex: Math.max(0, Math.min(20, goals)),
          assistIndex: Math.max(0, Math.min(20, assists)),
          ownGoalIndex: Math.max(0, Math.min(20, ownGoals)),
          pigeonIndex: item.absent ? 1 : 0,
          absentBy: item.absentBy || 'admin',
          editable: !!signedRow && item.absentBy !== 'system',
          deletable: true,
          teamName: teamNameMap[resolvedTeamId] || '界龙散客',
          avatarChar: avatarChar(item.userName),
          avatarBg: avatarColor(item.userName)
        }
      })
      const pigeons = (detail.pigeons || []).map((item) => ({
        ...item,
        avatarChar: avatarChar(item.userName),
        avatarBg: avatarColor(item.userName)
      }))
      const memberFilters = [{ id: 'all', name: '全部' }].concat(
        (activity.teams || []).map((t) => ({ id: t.id, name: t.name }))
      )
      const activityBoards = detail.activityBoards || {}
      const tacticsTeams = divided
        ? (activity.teams || []).filter((t) => t && t.id && t.id !== PENDING)
        : []
      const tacticsList = tacticsTeams.map((team) => {
        const computed = this.computeGroupTacticsBoard(signedList, activityBoards, team.id)
        return {
          teamId: team.id,
          teamName: team.name,
          color: team.color || '',
          board: computed.board,
          removedNotice: computed.removedNotice || ''
        }
      })
      const preferredTeamId = (this.data.tacticsTeamId && tacticsList.some((t) => t.teamId === this.data.tacticsTeamId))
        ? this.data.tacticsTeamId
        : ((mine && mine.teamId && mine.teamId !== PENDING)
          ? mine.teamId
          : (tacticsList[0] ? tacticsList[0].teamId : ''))
      const currentTactics = this.currentTacticsView(tacticsList, preferredTeamId)

      this.setData({
        activity: { ...activity, timeText: formatTime(activity.startTime) },
        divided,
        isAdmin,
        started: activity.startTime <= now,
        sessionOpen,
        cupStarted,
        cupTeamCount,
        cupTeamsChanged,
        activeTeamCount,
        activePlayerCount,
        emptyTeamNames,
        showStandings,
        showFixtures,
        showPersonalData,
        ended: (Number(activity.endTime) || (Number(activity.startTime) + 2 * 60 * 60 * 1000)) <= now,
        locked,
        timeText: formatTime(activity.startTime),
        mineStatus,
        signed: iSigned,
        cancelWillPigeon: !!detail.cancelWillPigeon,
        subscribeTemplates: detail.subscribeTemplates || {},
        pigeonCutoffHours: detail.pigeonCutoffHours == null ? 1.5 : detail.pigeonCutoffHours,
        remindBeforeHours: detail.remindBeforeHours == null ? 2 : detail.remindBeforeHours,
        pigeonRuleText: pigeonRuleText(activity.startTime, detail.pigeonCutoffHours),
        me,
        meOpenid,
        hasProfile,
        jielongJoined,
        signups: signedList,
        activityBoards,
        tacticsList,
        ...currentTactics,
        canEditTactics: iSigned,
        signedCount: signedList.length,
        pendingCount: pendingSorted.length,
        pendingPlayers: pendingSorted,
        teamCards,
        teamGridCols,
        canAddTeam,
        canRemoveTeam,
        rounds,
        roundGroups,
        pitchOneSummary,
        scoreDraft,
        standings,
        podium,
        cupActionEnabled,
        cupActionHint,
        allSignedPlayers,
        memberFilters,
        signedMembers,
        pickMembers,
        selectedOpenid: picked ? picked._openid : '',
        pickIndex: keepForm ? this.data.pickIndex : (picked ? Math.max(0, pickMembers.indexOf(picked)) : 0),
        pickedLabel: keepForm ? this.data.pickedLabel : (picked ? picked.label : '选择队员'),
        goalIndex: keepForm ? this.data.goalIndex : (picked ? (stat.goals || 0) : 0),
        assistIndex: keepForm ? this.data.assistIndex : (picked ? (stat.assists || 0) : 0),
        ownGoalIndex: keepForm ? this.data.ownGoalIndex : (picked ? (stat.ownGoals || 0) : 0),
        pigeonIndex: keepForm ? this.data.pigeonIndex : (picked && stat.absent ? 1 : 0),
        records,
        pigeons,
        draggingId: '',
        dragHoverTeam: '',
        dragHoverOpenid: '',
        dragGhostName: '',
        dragHint: '',
        rosterGroups,
        pickGroupId
      })
    })
  },
  onPickGroup(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    this.setData({ pickGroupId: id })
  },
  onSignupTap() {
    if (!this.data.jielongJoined) {
      this.openRegister()
      return
    }
    this.pledgeThenSignup()
  },
  pledgeThenSignup() {
    this._subFlags = {}
    this.setData({
      showPledge: true,
      pledgeTitle: '报名须知',
      pledgeHint: `开赛前 ${this.data.remindBeforeHours == null ? 2 : this.data.remindBeforeHours} 小时会提醒你这场球。`,
      pledgeButtonText: '同意并报名',
      pigeonRuleText: pigeonRuleText(
        this.data.activity && this.data.activity.startTime,
        this.data.pigeonCutoffHours
      )
    })
  },
  dismissPledge() {
    this.setData({ showPledge: false })
  },
  confirmPledge() {
    const templates = this.data.subscribeTemplates || {}
    const flags = this._subFlags || {}
    this._subFlags = flags
    const remindId = String(templates.remind || '').trim()
    const tmplIds = remindId ? [remindId] : []
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      if (this._pledgeSubTimer) {
        clearTimeout(this._pledgeSubTimer)
        this._pledgeSubTimer = null
      }
      this.setData({ showPledge: false })
      this.doSignup()
    }
    // 订阅失败/取消/模拟器卡住都不能挡住报名
    if (!tmplIds.length || !wx.requestSubscribeMessage) {
      finish()
      return
    }
    this._pledgeSubTimer = setTimeout(finish, 8000)
    wx.requestSubscribeMessage({
      tmplIds,
      success: (result) => {
        if (remindId && result && result[remindId] === 'accept') flags.remindAccepted = true
      },
      fail: (error) => {
        const msg = String((error && error.errMsg) || '')
        if (msg.indexOf('cancel') !== -1 || msg.indexOf('取消') !== -1) return
        if (msg.indexOf('template') !== -1 || msg.indexOf('模板') !== -1) {
          wx.showToast({ title: '提醒订阅暂不可用，已继续报名', icon: 'none' })
        }
      },
      complete: finish
    })
  },
  doSignup() {
    const flags = this._subFlags || {}
    return call('signup', {
      activityId: this.data.id,
      remindAccepted: !!flags.remindAccepted,
      promoteAccepted: !!flags.promoteAccepted
    }).then((res) => {
      wx.showToast({ title: '已报名', icon: 'success' })
      this.load()
      return res
    })
  },
  openRegister() {
    const me = this.data.me
    this.setData({
      showRegister: true,
      regName: (me && me.name) || '',
      regAvatarUrl: (me && me.avatarUrl) || '',
      regTempAvatar: '',
      regPosition: (me && me.preferredPosition) || '',
      pickGroupId: this.data.pickGroupId || JIELONG_DEFAULT_GROUP,
      regSaving: false
    })
  },
  closeRegister() {
    this.setData({ showRegister: false, regSaving: false, regTempAvatar: '' })
  },
  onChooseAvatar(event) {
    const url = event.detail && event.detail.avatarUrl
    if (!url) return
    this.setData({ regAvatarUrl: url, regTempAvatar: url })
  },
  onRegName(event) {
    this.setData({ regName: event.detail.value })
  },
  onRegPosition(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    this.setData({ regPosition: this.data.regPosition === id ? '' : id })
  },
  noop() {},
  submitRegister() {
    if (this.data.regSaving) return
    const checked = assertPlayerName(this.data.regName)
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' })
      return
    }
    const name = checked.name
    const groupId = this.data.pickGroupId || JIELONG_DEFAULT_GROUP
    if (!this.data.rosterGroups.some((item) => item.id === groupId)) {
      wx.showToast({ title: '请选择名册分组', icon: 'none' })
      return
    }
    this.setData({ regSaving: true })
    const openid = this.data.meOpenid
    const tempAvatar = this.data.regTempAvatar
    // 先入队，再走报名须知 + 订阅授权（与已加入时点报名同一路径）
    const saveThenPledge = (avatarUrl) => {
      const payload = {
        name,
        clubId: 'club_jielong',
        groupId,
        preferredPosition: this.data.regPosition || ''
      }
      if (typeof avatarUrl === 'string') payload.avatarUrl = avatarUrl
      return call('saveProfile', payload).then(() => {
        this.setData({
          showRegister: false,
          regSaving: false,
          regTempAvatar: '',
          hasProfile: true,
          jielongJoined: true
        })
        this.pledgeThenSignup()
      })
    }
    const fail = () => this.setData({ regSaving: false })
    if (tempAvatar) {
      uploadAvatar(tempAvatar, openid)
        .then((fileID) => saveThenPledge(fileID).catch(fail))
        .catch(fail)
    } else {
      saveThenPledge(this.data.me ? undefined : '').catch(fail)
    }
  },
  cancel() {
    const late = this.data.cancelWillPigeon
    wx.showModal({
      title: '取消报名',
      content: late
        ? '现在取消会记一次鸽子。开赛前重新报名，这次鸽子会去掉。'
        : '现在取消无责。',
      confirmText: '取消报名',
      cancelText: '再想想',
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('cancelSignup', { activityId: this.data.id }).then(() => {
          wx.showToast({ title: '已取消' })
          this.load()
        })
      }
    })
  },
  assignByRoster() {
    if (!this.data.isAdmin || this.data.locked) {
      wx.showToast({ title: '已有比分，不能重分', icon: 'none' })
      return
    }
    if (!this.data.signedCount) {
      wx.showToast({ title: '还没有人报名', icon: 'none' })
      return
    }
    wx.showModal({
      title: '一键分队？',
      content: '按 8 人制（2～5 队）自动均分，同名册组优先分在同一队；超过 45 人时晚报名者留在未分队池。分完可随时拖拽微调。',
      confirmText: '一键分队',
      confirmColor: '#0f3d2e',
      success: (res) => {
        if (!res.confirm) return
        call('assignTeams', { activityId: this.data.id }).then((result) => {
          const left = result.leftoverCount ? `，未分队 ${result.leftoverCount} 人` : ''
          wx.showToast({ title: `已分成 ${result.teamCount} 队${left}`.slice(0, 30), icon: 'none' })
          this.load()
        })
      }
    })
  },
  clearRosterDrag() {
    this._rosterDragActive = false
    this.setData({
      draggingId: '',
      dragHoverTeam: '',
      dragHoverOpenid: '',
      dragGhostName: '',
      dragHint: ''
    })
  },
  measureRoster(done) {
    const query = wx.createSelectorQuery()
    query.selectAll('.drop-team').fields({ rect: true, dataset: true })
    query.selectAll('.drop-player').fields({ rect: true, dataset: true })
    query.exec((res) => {
      this._teamRects = (res && res[0]) || []
      this._playerRects = (res && res[1]) || []
      if (typeof done === 'function') done()
    })
  },
  hitAtPoint(rects, clientX, clientY) {
    return (rects || []).find((rect) => (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    )) || null
  },
  resolveDragHover(clientX, clientY) {
    const selfId = this.data.draggingId
    const playerHit = this.hitAtPoint(this._playerRects, clientX, clientY)
    const player = (playerHit && playerHit.dataset) || {}
    let hoverOpenid = ''
    let teamId = ''
    if (player.openid && player.openid !== selfId) {
      hoverOpenid = player.openid
      teamId = player.team || ''
    } else {
      const teamHit = this.hitAtPoint(this._teamRects, clientX, clientY)
      teamId = (teamHit && teamHit.dataset && teamHit.dataset.team) || ''
    }
    const ghost = this.data.dragGhostName
    let dragHint = `拖到目标队后松手 · ${ghost}`
    if (hoverOpenid) dragHint = `松手对调 · ${ghost} ↔ ${player.name || '队员'}`
    else if (teamId) {
      const team = (this.data.teamCards || []).find((item) => item.id === teamId)
      const label = teamId === PENDING
        ? '未分队'
        : ((team && team.name) || '该队')
      dragHint = `松手放入 · ${label}`
    }
    return { hoverOpenid, teamId, dragHint }
  },
  updateDragHover(clientX, clientY) {
    const next = this.resolveDragHover(clientX, clientY)
    if (next.hoverOpenid === this.data.dragHoverOpenid
      && next.teamId === this.data.dragHoverTeam
      && next.dragHint === this.data.dragHint) return next
    this.setData({
      dragHoverOpenid: next.hoverOpenid,
      dragHoverTeam: next.teamId,
      dragHint: next.dragHint
    })
    return next
  },
  canMoveSessionPlayer(openid) {
    // 有比分仍可调人（散客中途换人常见）；加减队/一键重分仍受 locked 限制
    if (!openid || !this.data.divided) return false
    return !!this.data.isAdmin
  },
  onDragStart(event) {
    const openid = event.currentTarget.dataset.openid
    const name = event.currentTarget.dataset.name || '队员'
    if (!this.canMoveSessionPlayer(openid)) return
    this._ignoreRosterTap = true
    this._rosterDragActive = true
    this.measureRoster()
    this.setData({
      draggingId: openid,
      dragHoverTeam: '',
      dragHoverOpenid: '',
      dragGhostName: name,
      dragHint: this.data.isAdmin
        ? `拖到队员身上对调，或拖到队上换组 · ${name}`
        : `拖到目标队后松手 · ${name}`
    })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },
  onTapPlayer(event) {
    if (this._ignoreRosterTap) {
      this._ignoreRosterTap = false
      return
    }
    if (this.data.draggingId || this._rosterDragActive) return
    const openid = event.currentTarget.dataset.openid
    if (!this.canMoveSessionPlayer(openid)) return
    const hit = (this.data.allSignedPlayers || []).find((item) => item.openid === openid)
    if (!hit) return
    const currentTeamId = hit.teamId || PENDING
    const teams = ((this.data.activity && this.data.activity.teams) || [])
      .filter((t) => t.id !== currentTeamId)
    if (!teams.length) {
      wx.showToast({ title: '没有可换的队', icon: 'none' })
      return
    }
    // wx.showActionSheet 最多支持 6 项；界龙最多 6 队，过滤当前队后最多 5 项，可再加「未分队」
    const options = teams.slice(0, 5).map((t) => ({ id: t.id, name: t.name }))
    if (currentTeamId !== PENDING) {
      options.push({ id: PENDING, name: '未分队' })
    }
    wx.showActionSheet({
      itemList: options.map((t) => {
        if (t.id === PENDING) return `未分队（${this.data.pendingCount || 0}人）`
        const card = (this.data.teamCards || []).find((c) => c.id === t.id)
        const count = card ? card.count : 0
        return `${t.name}（${count}人）`
      }),
      success: (res) => {
        const picked = options[res.tapIndex]
        if (!picked) return
        this.commitMove(openid, picked.id)
      }
    })
  },
  onRosterTouchMove(event) {
    if (!this._rosterDragActive || !this.data.draggingId) return
    const touch = event.touches && event.touches[0]
    if (!touch) return
    this.updateDragHover(touch.clientX, touch.clientY)
  },
  onRosterTouchEnd(event) {
    if (!this._rosterDragActive) return
    const openid = this.data.draggingId
    const touch = (event.changedTouches && event.changedTouches[0]) || null
    const hover = touch
      ? this.resolveDragHover(touch.clientX, touch.clientY)
      : { hoverOpenid: this.data.dragHoverOpenid, teamId: this.data.dragHoverTeam }
    this.clearRosterDrag()
    setTimeout(() => { this._ignoreRosterTap = false }, 80)
    if (!openid) return
    if (this.data.isAdmin && hover.hoverOpenid && hover.hoverOpenid !== openid) {
      this.confirmSwap(openid, hover.hoverOpenid)
      return
    }
    if (!hover.teamId) return
    const mine = (this.data.allSignedPlayers || []).find((item) => item.openid === openid)
    if (mine && mine.teamId === hover.teamId) return
    this.commitMove(openid, hover.teamId)
  },
  confirmSwap(openidA, openidB) {
    const nameOf = (openid) => {
      const hit = (this.data.allSignedPlayers || []).find((item) => item.openid === openid)
      return (hit && hit.name) || '队员'
    }
    const teamName = (openid) => {
      const hit = (this.data.allSignedPlayers || []).find((item) => item.openid === openid)
      if (!hit) return '该队'
      if (hit.teamId === PENDING) return '未分队'
      const team = (this.data.teamCards || []).find((item) => item.id === hit.teamId)
      return (team && team.name) || '该队'
    }
    wx.showModal({
      title: '对调',
      content: `把${nameOf(openidA)}换到${teamName(openidB)}，${nameOf(openidB)}换到${teamName(openidA)}？顺序位置互换。`,
      confirmText: '对调',
      cancelText: '取消',
      confirmColor: '#0f3d2e',
      success: (res) => {
        if (!res.confirm) return
        call('adminSwapSignup', {
          activityId: this.data.id,
          openidA,
          openidB
        }).then(() => {
          wx.showToast({ title: '已对调' })
          this.load()
        })
      }
    })
  },
  commitMove(openid, teamId) {
    call('adminMoveSignup', {
      activityId: this.data.id,
      targetOpenid: openid,
      teamId
    }).then(() => {
      wx.showToast({ title: '已换组' })
      this.load()
    })
  },
  editTeam(event) {
    if (!this.data.isAdmin) return
    const teamId = event.currentTarget.dataset.id
    const team = (this.data.teamCards || []).find((item) => item.id === teamId)
    if (!team) return
    this.setData({
      showRename: true,
      renameTeamId: teamId,
      renameDraft: team.name,
      renameColor: team.color || '#66706c',
      renameJerseyColor: team.jerseyColor || ''
    })
  },
  openBasics() {
    if (!this.data.isAdmin || this.data.started) return
    const activity = this.data.activity
    if (!activity) return
    const date = new Date(activity.startTime)
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
    this.setData({
      showBasics: true,
      basicsTitle: activity.title || '',
      basicsDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      basicsTime: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
      basicsSaving: false
    })
  },
  closeBasics() {
    this.setData({ showBasics: false, basicsSaving: false })
  },
  onBasicsTitle(event) { this.setData({ basicsTitle: event.detail.value }) },
  onBasicsDate(event) { this.setData({ basicsDate: event.detail.value }) },
  onBasicsTime(event) { this.setData({ basicsTime: event.detail.value }) },
  submitBasics() {
    if (this.data.basicsSaving || !this.data.isAdmin || this.data.started) return
    const title = String(this.data.basicsTitle || '').trim()
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    const [year, month, day] = String(this.data.basicsDate || '').split('-').map(Number)
    const [hour, minute] = String(this.data.basicsTime || '').split(':').map(Number)
    if (!year || !month || !day || hour == null || minute == null || Number.isNaN(hour) || Number.isNaN(minute)) {
      wx.showToast({ title: '请选择时间', icon: 'none' })
      return
    }
    const startTime = new Date(year, month - 1, day, hour, minute).getTime()
    this.setData({ basicsSaving: true })
    call('updateActivityBasics', {
      activityId: this.data.id,
      title,
      startTime
    }).then(() => {
      wx.showToast({ title: '已保存' })
      this.setData({ showBasics: false, basicsSaving: false })
      this.load()
    }).catch(() => this.setData({ basicsSaving: false }))
  },
  addTeam() {
    if (!this.data.canAddTeam) return
    call('addSessionTeam', { activityId: this.data.id }).then(() => {
      wx.showToast({ title: '已加一队' })
      this.load()
    })
  },
  removeTeam(event) {
    if (!this.data.canRemoveTeam) return
    const teamId = event.currentTarget.dataset.id
    const team = (this.data.teamCards || []).find((item) => item.id === teamId)
    if (!team || team.count > 0) {
      wx.showToast({ title: '空队才能删', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删掉这队？',
      content: `确定删除「${team.name}」？`,
      confirmText: '删除',
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('removeSessionTeam', {
          activityId: this.data.id,
          teamId
        }).then(() => {
          wx.showToast({ title: '已删除' })
          this.load()
        })
      }
    })
  },
  closeRename() {
    this.setData({
      showRename: false,
      renameTeamId: '',
      renameDraft: '',
      renameColor: '',
      renameJerseyColor: ''
    })
  },
  onRenameDraft(event) {
    this.setData({ renameDraft: event.detail.value })
  },
  onPickRenameColor(event) {
    const color = event.currentTarget.dataset.color
    const label = event.currentTarget.dataset.label || ''
    if (!color) return
    this.setData({
      renameColor: color,
      renameJerseyColor: label || this.data.renameJerseyColor
    })
  },
  onPickRenameName(event) {
    const name = event.currentTarget.dataset.name
    if (!name) return
    const group = (this.data.rosterGroups || []).find((item) => item.name === name)
    const applyGroup = () => {
      this.setData({
        renameDraft: name,
        renameColor: (group && group.color) || this.data.renameColor,
        renameJerseyColor: (group && (group.jerseyColor || group.name)) || this.data.renameJerseyColor
      })
    }
    if (group && group.color && this.data.renameColor && group.color !== this.data.renameColor) {
      wx.showModal({
        title: '同步球衣颜色？',
        content: `选用「${name}」会把球衣色改为该组颜色，保存前仍可再改。`,
        confirmText: '同步颜色',
        cancelText: '只改队名',
        success: (res) => {
          if (res.confirm) applyGroup()
          else this.setData({ renameDraft: name })
        }
      })
      return
    }
    applyGroup()
  },
  submitRename() {
    const teamId = this.data.renameTeamId
    const name = String(this.data.renameDraft || '').trim()
    if (!teamId || !name) {
      wx.showToast({ title: '请填写队名', icon: 'none' })
      return
    }
    const payload = {
      activityId: this.data.id,
      teamId,
      name,
      color: this.data.renameColor || undefined,
      jerseyColor: this.data.renameJerseyColor || undefined
    }
    call('setSessionColor', payload).then(() => {
      this.closeRename()
      this.load()
    })
  },
  onScoreInput(event) {
    const id = event.currentTarget.dataset.id
    const side = event.currentTarget.dataset.side
    this.setData({ [`scoreDraft.${id}.${side}`]: event.detail.value })
  },
  saveScore(event) {
    const id = event.currentTarget.dataset.id
    const draft = (this.data.scoreDraft && this.data.scoreDraft[id]) || {}
    const rawA = String(draft.a == null ? '' : draft.a).trim()
    const rawB = String(draft.b == null ? '' : draft.b).trim()
    if (rawA === '' && rawB === '') {
      call('saveFixtureScore', { roundId: id, clear: true }).then(() => {
        wx.showToast({ title: '已清空比分' })
        this.load()
      })
      return
    }
    const scoreA = rawA === '' ? 0 : Number(rawA)
    const scoreB = rawB === '' ? 0 : Number(rawB)
    call('saveFixtureScore', {
      roundId: id,
      scoreA,
      scoreB
    }).then(() => {
      wx.showToast({ title: '已记分' })
      this.load()
    })
  },
  onTapJielongCup() {
    if (!this.data.isAdmin) return
    const {
      divided,
      locked,
      cupStarted,
      activeTeamCount,
      activePlayerCount,
      emptyTeamNames,
      pendingCount,
      cupTeamCount
    } = this.data
    if (!divided) {
      wx.showModal({
        title: '请先分队',
        content: '请先有队员报名并完成分队后，再开启界龙杯。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    if (locked) {
      wx.showModal({
        title: cupStarted ? '无法直接重开界龙杯' : '已有比分记录',
        content: `已有场次记录了比分，不能直接${cupStarted ? '重开' : '开启'}界龙杯。是否先清空全部比分？（轮次与球员个人数据保留，清空后可再次点击${cupStarted ? '重开' : '开启'}）`,
        confirmText: '清空比分',
        confirmColor: '#8c3a2f',
        cancelText: '取消',
        success: (res) => {
          if (!res.confirm) return
          call('clearFixtureScores', { activityId: this.data.id }).then(() => {
            wx.showToast({ title: '已清空比分' })
            this.load()
          })
        }
      })
      return
    }
    const eligible = (activeTeamCount === 4 || activeTeamCount === 5) && activePlayerCount >= 24
    const notes = []
    if (emptyTeamNames && emptyTeamNames.length) {
      notes.push(`空队不参赛：${emptyTeamNames.join('、')}`)
    }
    if (pendingCount > 0) {
      notes.push(`未分队池还有 ${pendingCount} 人未入队`)
    }
    const extraNote = notes.length ? `\n（${notes.join('；')}）` : ''

    if (!cupStarted) {
      if (activeTeamCount === 6) {
        wx.showModal({
          title: '无法一键开启界龙杯',
          content: '当前有 6 支非空队伍，不支持一键开启界龙杯（仅支持 4 队或 5 队）。开赛前 2 小时起支持手动记录轮次比分与个人数据，无积分榜。',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      if (!eligible) {
        wx.showModal({
          title: '暂不满足开赛条件',
          content: `开启界龙杯需满足：非空队伍数为 4 或 5 支（当前 ${activeTeamCount} 支），且队内总人数不少于 24 人（当前 ${activePlayerCount} 人）。`,
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      // confirmText 最多 4 个汉字；超长时微信会静默失败，表现为「点了没反应」
      wx.showModal({
        title: '开启界龙杯',
        content: `目前有 ${activeTeamCount} 个队伍（共 ${activePlayerCount} 人），是否开启 ${activeTeamCount} 队界龙杯比赛？${extraNote}`,
        confirmText: '开启',
        confirmColor: '#0f3d2e',
        success: (res) => {
          if (!res.confirm) return
          call('startJielongCup', { activityId: this.data.id }).then(() => {
            this.setData({ extraRoundNos: [], hiddenRoundNos: [] })
            wx.showToast({ title: `已开启${activeTeamCount}队界龙杯` })
            this.load()
          })
        }
      })
      return
    }

    // cupStarted === true（重开界龙杯）
    if (eligible) {
      const changePrefix = cupTeamCount && cupTeamCount !== activeTeamCount
        ? `当前有效队伍已从 ${cupTeamCount} 队变为 ${activeTeamCount} 队（共 ${activePlayerCount} 人），是否重开 ${activeTeamCount} 队界龙杯？`
        : `目前有 ${activeTeamCount} 个队伍（共 ${activePlayerCount} 人），是否重开 ${activeTeamCount} 队界龙杯？`
      wx.showModal({
        title: '重开界龙杯',
        content: `${changePrefix}将重新生成对阵并重置积分榜，球员个人数据不受影响。${extraNote}`,
        confirmText: '重开',
        confirmColor: '#0f3d2e',
        success: (res) => {
          if (!res.confirm) return
          call('startJielongCup', { activityId: this.data.id }).then(() => {
            this.setData({ extraRoundNos: [], hiddenRoundNos: [] })
            wx.showToast({ title: `已重开${activeTeamCount}队界龙杯` })
            this.load()
          })
        }
      })
      return
    }

    // 已开赛后队伍变为 <=3 或 6，或人数 <24：提示清除轮次与积分榜，转手动填写
    const reasonText = activeTeamCount === 6
      ? `当前为 6 支非空队伍（仅 4 或 5 队支持界龙杯自动赛程）`
      : (activeTeamCount <= 3
        ? `当前仅 ${activeTeamCount} 支非空队伍（需 4 或 5 队）`
        : `当前有 ${activeTeamCount} 支非空队伍，但队内总人数仅 ${activePlayerCount} 人（不足 24 人）`)
    wx.showModal({
      title: '清除轮次与积分榜',
      content: `${reasonText}。确认后将清除现有轮次对阵与积分榜，由你手动填写轮次，球员个人数据不受影响。`,
      confirmText: '确认清除',
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('startJielongCup', { activityId: this.data.id, exitToManual: true }).then(() => {
          this.setData({ extraRoundNos: [], hiddenRoundNos: [] })
          wx.showToast({ title: '已清除赛程与积分榜' })
          this.load()
        })
      }
    })
  },
  resetFixturesTap() {
    if (!this.data.isAdmin) return
    if (this.data.cupStarted) {
      this.onTapJielongCup()
      return
    }
    if (this.data.locked) {
      wx.showModal({
        title: '无法清空对阵',
        content: '已有场次记录了比分，不能清空。请先清空已记的比分。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    wx.showModal({
      title: '清空对阵',
      content: '将清空当前未记分的全部场次，方便重新手动排场。确定清空？',
      confirmText: '清空对阵',
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('resetFixtures', { activityId: this.data.id }).then(() => {
          this.setData({ extraRoundNos: [], hiddenRoundNos: [] })
          wx.showToast({ title: '已清空对阵' })
          this.load()
        })
      }
    })
  },
  addRoundDirectory() {
    if (!this.data.isAdmin) return
    const existing = (this.data.roundGroups || []).map((g) => g.roundNo)
    const nextNo = existing.length ? Math.max(...existing) + 1 : 1
    const extraRoundNos = Array.from(new Set((this.data.extraRoundNos || []).concat([nextNo])))
    const hiddenRoundNos = (this.data.hiddenRoundNos || []).filter((n) => Number(n) !== nextNo)
    const teams = (this.data.teamCards || []).filter((t) => t.count > 0)
    const roundGroups = buildRoundDirectories(
      teams,
      this.data.rounds || [],
      extraRoundNos,
      hiddenRoundNos,
      this.data.cupStarted
    )
    this.setData({ extraRoundNos, hiddenRoundNos, roundGroups })
    wx.showToast({ title: `已加${roundLabel(nextNo)}`, icon: 'none' })
  },
  deleteRoundDirectory(event) {
    if (!this.data.isAdmin) return
    const roundNo = Number(event.currentTarget.dataset.round)
    if (!roundNo) return
    const group = (this.data.roundGroups || []).find((item) => item.roundNo === roundNo)
    const matchCount = group && group.matches ? group.matches.length : 0
    wx.showModal({
      title: `删除${roundLabel(roundNo)}`,
      content: matchCount
        ? `本轮有 ${matchCount} 场对阵，删除后场次一并清除。确定删除？`
        : '确定删除这一轮目录？',
      confirmText: '删除',
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        const finishLocal = () => {
          let hiddenRoundNos
          let extraRoundNos
          if (matchCount > 0) {
            // 云端会把后续 roundNo 前移，本地 meta 同步前移
            const shift = (list) => Array.from(new Set(
              (list || [])
                .map(Number)
                .filter((n) => n >= 1 && n !== roundNo)
                .map((n) => (n > roundNo ? n - 1 : n))
            )).sort((a, b) => a - b)
            hiddenRoundNos = shift(this.data.hiddenRoundNos)
            extraRoundNos = shift(this.data.extraRoundNos)
          } else {
            // 空目录只本地隐藏；标题按可见顺序编号，不依赖前移
            hiddenRoundNos = Array.from(new Set(
              (this.data.hiddenRoundNos || []).concat([roundNo]).map(Number).filter((n) => n >= 1)
            ))
            extraRoundNos = (this.data.extraRoundNos || []).filter((n) => Number(n) !== roundNo)
          }
          this.setData({ hiddenRoundNos, extraRoundNos })
          wx.showToast({ title: '已删除轮次' })
          this.load()
        }
        if (!matchCount) {
          finishLocal()
          return
        }
        call('deleteRoundDirectory', {
          activityId: this.data.id,
          roundNo
        }).then(finishLocal)
      }
    })
  },
  openAddFixture(event) {
    if (!this.data.isAdmin) return
    const teams = (this.data.activity && this.data.activity.teams) || []
    if (teams.length < 2) {
      wx.showToast({ title: '至少需要 2 支队', icon: 'none' })
      return
    }
    const presetRound = Number(event && event.currentTarget && event.currentTarget.dataset.round) || 0
    const groups = this.data.roundGroups || []
    const maxNo = groups.length ? Math.max(...groups.map((g) => g.roundNo)) : 4
    const totalOptions = Math.max(maxNo + 1, 6)
    const fixtureRoundOptions = Array.from({ length: totalOptions }, (_, idx) => ({
      roundNo: idx + 1,
      label: roundLabel(idx + 1)
    }))
    // 从「本轮加场」进来：锁定到当前轮次；顶部「加一场」默认落到第一轮
    const roundNo = presetRound || (groups[0] ? groups[0].roundNo : 1)
    const sameRound = (this.data.rounds || []).filter((r) => r.roundNo === roundNo)
    const defaultPitch = sameRound.some((r) => r.pitchId === 'pitch_1') && !sameRound.some((r) => r.pitchId === 'pitch_2')
      ? 'pitch_2'
      : 'pitch_1'
    this.setData({
      showFixtureModal: true,
      fixtureEditId: '',
      fixtureRoundNo: roundNo,
      fixtureRoundLocked: !!presetRound,
      fixtureRoundOptions,
      fixtureRoundIndex: Math.max(0, roundNo - 1),
      fixturePitchId: defaultPitch,
      fixtureMatchType: 'group',
      fixtureTeamAId: teams[0].id,
      fixtureTeamBId: teams[1].id,
      fixtureSaving: false
    })
  },
  openEditFixture(event) {
    if (!this.data.isAdmin) return
    const id = event.currentTarget.dataset.id
    const round = (this.data.rounds || []).find((item) => item._id === id)
    if (!round) return
    if (round.scored) {
      wx.showToast({ title: '已记分，请先清空比分再改对阵', icon: 'none' })
      return
    }
    const groups = this.data.roundGroups || []
    const maxNo = Math.max(round.roundNo || 1, groups.length ? Math.max(...groups.map((g) => g.roundNo)) : 4)
    const totalOptions = Math.max(maxNo + 1, 6)
    const fixtureRoundOptions = Array.from({ length: totalOptions }, (_, idx) => ({
      roundNo: idx + 1,
      label: roundLabel(idx + 1)
    }))
    this.setData({
      showFixtureModal: true,
      fixtureEditId: round._id,
      fixtureRoundNo: round.roundNo,
      fixtureRoundLocked: false,
      fixtureRoundOptions,
      fixtureRoundIndex: Math.max(0, round.roundNo - 1),
      fixturePitchId: round.pitchId || 'pitch_1',
      fixtureMatchType: round.matchType || 'group',
      fixtureTeamAId: round.teamAId,
      fixtureTeamBId: round.teamBId,
      fixtureSaving: false
    })
  },
  closeFixtureModal() {
    this.setData({ showFixtureModal: false, fixtureSaving: false, fixtureRoundLocked: false })
  },
  onPickFixtureRound(event) {
    if (this.data.fixtureRoundLocked) return
    const idx = Number(event.detail.value)
    const opt = (this.data.fixtureRoundOptions || [])[idx]
    if (!opt) return
    this.setData({ fixtureRoundIndex: idx, fixtureRoundNo: opt.roundNo })
  },
  onPickFixturePitch(event) {
    const pitchId = event.currentTarget.dataset.pitch
    if (!pitchId) return
    this.setData({ fixturePitchId: pitchId })
  },
  onPickFixtureType(event) {
    const matchType = event.currentTarget.dataset.type
    if (!matchType) return
    this.setData({ fixtureMatchType: matchType })
  },
  onPickFixtureTeamA(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    this.setData({ fixtureTeamAId: id })
  },
  onPickFixtureTeamB(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    this.setData({ fixtureTeamBId: id })
  },
  submitFixtureModal() {
    if (this.data.fixtureSaving) return
    const { fixtureEditId, fixtureRoundNo, fixturePitchId, fixtureMatchType, fixtureTeamAId, fixtureTeamBId } = this.data
    if (!fixtureTeamAId || !fixtureTeamBId || fixtureTeamAId === fixtureTeamBId) {
      wx.showToast({ title: '请选择两支不同的队', icon: 'none' })
      return
    }
    this.setData({ fixtureSaving: true })
    const action = fixtureEditId ? 'updateFixture' : 'addFixture'
    const payload = {
      activityId: this.data.id,
      roundNo: fixtureRoundNo,
      pitchId: fixturePitchId,
      matchType: fixtureMatchType,
      teamAId: fixtureTeamAId,
      teamBId: fixtureTeamBId
    }
    if (fixtureEditId) payload.roundId = fixtureEditId
    call(action, payload).then(() => {
      wx.showToast({ title: fixtureEditId ? '已修改场次' : '已添加场次' })
      const hiddenRoundNos = (this.data.hiddenRoundNos || [])
        .filter((n) => Number(n) !== Number(fixtureRoundNo))
      this.setData({
        showFixtureModal: false,
        fixtureSaving: false,
        fixtureRoundLocked: false,
        hiddenRoundNos
      })
      this.load()
    }).catch(() => this.setData({ fixtureSaving: false }))
  },
  deleteFixtureTap(event) {
    if (!this.data.isAdmin) return
    const id = event.currentTarget.dataset.id
    const round = (this.data.rounds || []).find((item) => item._id === id)
    if (!round) return
    wx.showModal({
      title: '删除场次',
      content: `确定删除「${roundLabel(round.roundNo)} · ${round.left} vs ${round.right}」？`,
      confirmText: '删除',
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('deleteRound', { roundId: id }).then(() => {
          wx.showToast({ title: '已删除' })
          this.load()
        })
      }
    })
  },
  swapPitch(event) {
    call('updateFixture', {
      activityId: this.data.id,
      swapRoundNo: Number(event.currentTarget.dataset.round)
    }).then(() => {
      wx.showToast({ title: '已换场' })
      this.load()
    })
  },
  swapFixtureSides(event) {
    if (!this.data.isAdmin) return
    const id = event.currentTarget.dataset.id
    const round = (this.data.rounds || []).find((item) => item._id === id)
    if (!round) return
    if (round.scored) {
      wx.showToast({ title: '已记分，不能对调', icon: 'none' })
      return
    }
    call('updateFixture', {
      activityId: this.data.id,
      roundId: id,
      teamAId: round.teamBId,
      teamBId: round.teamAId,
      pitchId: round.pitchId
    }).then(() => {
      wx.showToast({ title: '已对调双方' })
      this.load()
    })
  },
  fillStat(member) {
    const stat = (this.contributionMap && this.contributionMap[member._openid]) || {}
    this.setData({
      selectedOpenid: member._openid,
      pickedLabel: member.label,
      goalIndex: stat.goals || 0,
      assistIndex: stat.assists || 0,
      ownGoalIndex: stat.ownGoals || 0,
      pigeonIndex: stat.absent ? 1 : 0
    })
  },
  onMemberTeam(event) {
    const memberTeam = event.currentTarget.dataset.id
    this.applyMemberTeamFilter(memberTeam)
  },
  applyMemberTeamFilter(memberTeam) {
    const pickMembers = memberTeam === 'all'
      ? this.data.signedMembers
      : this.data.signedMembers.filter((item) => item.teamId === memberTeam)
    const still = pickMembers.find((item) => item._openid === this.data.selectedOpenid) || pickMembers[0] || null
    const stat = (still && this.contributionMap && this.contributionMap[still._openid]) || {}
    this.setData({
      memberTeam,
      pickMembers,
      pickIndex: still ? Math.max(0, pickMembers.indexOf(still)) : 0,
      selectedOpenid: still ? still._openid : '',
      pickedLabel: still ? still.label : '选择队员',
      goalIndex: still ? (stat.goals || 0) : 0,
      assistIndex: still ? (stat.assists || 0) : 0,
      ownGoalIndex: still ? (stat.ownGoals || 0) : 0,
      pigeonIndex: still && stat.absent ? 1 : 0
    })
  },
  jumpToMatchPlayerStats(event) {
    const teamAId = event.currentTarget.dataset.teama || 'all'
    if (teamAId && (this.data.memberFilters || []).some((f) => f.id === teamAId)) {
      this.applyMemberTeamFilter(teamAId)
    }
    wx.pageScrollTo({
      selector: '#personal-stats-card',
      duration: 260
    })
  },
  onPickPlayer(event) {
    const pickIndex = Number(event.detail.value)
    const picked = this.data.pickMembers[pickIndex]
    if (!picked) return
    this.setData({ pickIndex })
    this.fillStat(picked)
  },
  rejectAbsentStats() {
    wx.showModal({
      title: '出勤情况',
      content: '鸽子的情况下，进球、助攻和乌龙球得是 0',
      showCancel: false
    })
  },
  keepPicker(field, previous) {
    const other = previous === 0 ? 1 : 0
    this.setData({ [field]: other }, () => this.setData({ [field]: previous }))
  },
  onEditGoals(event) {
    const goalIndex = Number(event.detail.value)
    if (this.data.pigeonIndex === 1 && (goalIndex !== 0 || this.data.assistIndex !== 0 || this.data.ownGoalIndex !== 0)) {
      this.rejectAbsentStats()
      this.keepPicker('goalIndex', this.data.goalIndex)
      return
    }
    this.setData({ goalIndex })
  },
  onEditAssists(event) {
    const assistIndex = Number(event.detail.value)
    if (this.data.pigeonIndex === 1 && (this.data.goalIndex !== 0 || assistIndex !== 0 || this.data.ownGoalIndex !== 0)) {
      this.rejectAbsentStats()
      this.keepPicker('assistIndex', this.data.assistIndex)
      return
    }
    this.setData({ assistIndex })
  },
  onEditOwnGoals(event) {
    const ownGoalIndex = Number(event.detail.value)
    if (this.data.pigeonIndex === 1 && (this.data.goalIndex !== 0 || this.data.assistIndex !== 0 || ownGoalIndex !== 0)) {
      this.rejectAbsentStats()
      this.keepPicker('ownGoalIndex', this.data.ownGoalIndex)
      return
    }
    this.setData({ ownGoalIndex })
  },
  onEditAbsent(event) {
    const pigeonIndex = Number(event.detail.value)
    if (pigeonIndex === 1 && (this.data.goalIndex !== 0 || this.data.assistIndex !== 0 || this.data.ownGoalIndex !== 0)) {
      this.rejectAbsentStats()
      this.setData({ pigeonIndex: 0 })
      return
    }
    this.setData({ pigeonIndex })
  },
  saveStat() {
    if (!this.data.isAdmin) return
    const player = this.data.pickMembers.find((item) => item._openid === this.data.selectedOpenid)
    if (!player) {
      wx.showToast({ title: '请选择队员', icon: 'none' })
      return
    }
    if (this.data.pigeonIndex === 1 && (this.data.goalIndex !== 0 || this.data.assistIndex !== 0 || this.data.ownGoalIndex !== 0)) {
      this.rejectAbsentStats()
      return
    }
    this.writeStat(player._openid, this.data.goalIndex, this.data.assistIndex, this.data.ownGoalIndex, this.data.pigeonIndex === 1, true)
  },
  onRowGoals(event) {
    const record = this.rowByOpenid(event.currentTarget.dataset.openid)
    if (!record) return
    const goals = Number(event.detail.value)
    if (record.absent && goals !== 0) {
      this.rejectAbsentStats()
      this.load()
      return
    }
    this.writeStat(record.playerOpenid, goals, record.assists, record.ownGoals || 0, record.absent, false)
  },
  onRowAssists(event) {
    const record = this.rowByOpenid(event.currentTarget.dataset.openid)
    if (!record) return
    const assists = Number(event.detail.value)
    if (record.absent && assists !== 0) {
      this.rejectAbsentStats()
      this.load()
      return
    }
    this.writeStat(record.playerOpenid, record.goals, assists, record.ownGoals || 0, record.absent, false)
  },
  onRowOwnGoals(event) {
    const record = this.rowByOpenid(event.currentTarget.dataset.openid)
    if (!record) return
    const ownGoals = Number(event.detail.value)
    if (record.absent && ownGoals !== 0) {
      this.rejectAbsentStats()
      this.load()
      return
    }
    this.writeStat(record.playerOpenid, record.goals, record.assists, ownGoals, record.absent, false)
  },
  onRowAbsent(event) {
    const record = this.rowByOpenid(event.currentTarget.dataset.openid)
    if (record && record.absentBy === 'system') return
    if (!record) return
    const absent = Number(event.detail.value) === 1
    if (absent && (record.goals !== 0 || record.assists !== 0 || (record.ownGoals || 0) !== 0)) {
      this.rejectAbsentStats()
      this.load()
      return
    }
    this.writeStat(record.playerOpenid, record.goals, record.assists, record.ownGoals || 0, absent, false)
  },
  rowByOpenid(openid) {
    if (!this.data.isAdmin) return null
    return (this.data.records || []).find((item) => item.playerOpenid === openid) || null
  },
  writeStat(playerOpenid, goals, assists, ownGoals, absent, toast) {
    if (this.data.savingStat) return
    this.setData({ savingStat: true })
    call('setContribution', {
      activityId: this.data.id,
      playerOpenid,
      goals,
      assists,
      ownGoals
    }).then(() => call('setAbsent', {
      activityId: this.data.id,
      playerOpenid,
      absent
    })).then(() => {
      this.setData({ savingStat: false })
      if (toast) wx.showToast({ title: '已保存' })
      this.load()
    }).catch(() => this.setData({ savingStat: false }))
  },
  askDeleteRecord(event) {
    if (!this.data.isAdmin) return
    const id = event.currentTarget.dataset.id
    const name = event.currentTarget.dataset.name || '这名队员'
    wx.showModal({
      title: '删除数据',
      content: `删除「${name}」这场的进球、助攻、乌龙球和考勤（含鸽子）？`,
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('deleteContribution', { contributionId: id }).then(() => {
          wx.showToast({ title: '已删除' })
          this.load()
        })
      }
    })
  },
  clearTacticsHoldTimer() {
    if (this.tacticsHoldTimer) {
      clearTimeout(this.tacticsHoldTimer)
      this.tacticsHoldTimer = null
    }
  },
  groupSignedPool(signups, teamId) {
    return (signups || []).filter(
      (item) => item && item.teamId === teamId && (!item.status || item.status === 'signed')
    )
  },
  currentTacticsView(list, teamId) {
    const rows = list || []
    const entry = rows.find((item) => item && item.teamId === teamId) || rows[0] || null
    if (!entry) {
      return {
        tacticsTeamId: '',
        tacticsTeamName: '',
        tacticsBoard: buildDefaultTacticsState([]),
        tacticsRemovedNotice: ''
      }
    }
    return {
      tacticsTeamId: entry.teamId,
      tacticsTeamName: entry.teamName,
      tacticsBoard: entry.board,
      tacticsRemovedNotice: entry.removedNotice || ''
    }
  },
  switchTacticsTeam(event) {
    const teamId = event.currentTarget.dataset.teamid
    if (!teamId || teamId === this.data.tacticsTeamId) return
    this.clearTacticsHoldTimer()
    this.setData({
      ...this.currentTacticsView(this.data.tacticsList, teamId),
      tacticsDraggingUserId: '',
      tacticsDraggingSource: '',
      tacticsDragPreviewActive: false,
      tacticsDragPlayer: null
    })
  },
  patchTacticsEntry(teamId, patch) {
    const list = (this.data.tacticsList || []).slice()
    const idx = list.findIndex((item) => item && item.teamId === teamId)
    if (idx < 0) return
    list[idx] = Object.assign({}, list[idx], patch)
    const data = { tacticsList: list }
    if (teamId === this.data.tacticsTeamId) {
      Object.assign(data, this.currentTacticsView(list, teamId))
    }
    this.setData(data)
  },
  computeGroupTacticsBoard(signups, activityBoards, teamId) {
    const pool = this.groupSignedPool(signups, teamId)
    const savedDoc = activityBoards && activityBoards[teamId]
    if (savedDoc && Array.isArray(savedDoc.slots)) {
      const reconciled = reconcileSavedBoard(savedDoc.slots, pool)
      return {
        board: reconciled,
        removedNotice: reconciled.removedNotice || ''
      }
    }
    return {
      board: buildDefaultTacticsState(pool),
      removedNotice: ''
    }
  },
  measureTacticsZones(cb) {
    const query = this.createSelectorQuery()
    query.select('#tacticsPitch').boundingClientRect()
    query.select('#tacticsBench').boundingClientRect()
    query.exec((res) => {
      this.tacticsPitchRect = (res && res[0]) || null
      this.tacticsBenchRect = (res && res[1]) || null
      if (typeof cb === 'function') cb()
    })
  },
  pointInRect(x, y, rect) {
    return !!(rect && rect.width > 0 && rect.height > 0
      && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
  },
  onTacticsTouchStart(event) {
    if (!this.data.canEditTactics) return
    const touch = (event.touches && event.touches[0]) || null
    const userId = event.currentTarget.dataset.userid
    const teamId = this.data.tacticsTeamId
    const source = event.currentTarget.dataset.source || 'pitch'
    if (!touch || !userId || !teamId) return
    this.clearTacticsHoldTimer()
    this.tacticsTouchStartPoint = { x: touch.clientX, y: touch.clientY }

    const board = this.data.tacticsBoard || {}
    const list = source === 'bench' ? (board.bench || []) : (board.onPitch || [])
    const dragPlayer = list.find((p) => p && p.userId === userId) || null

    this.tacticsHoldTimer = setTimeout(() => {
      this.tacticsHoldTimer = null
      this.measureTacticsZones(() => {
        const rect = this.tacticsPitchRect
        let leftPct = 50
        let topPct = 50
        if (rect && rect.width > 0 && rect.height > 0) {
          leftPct = Math.max(8, Math.min(92, ((touch.clientX - rect.left) / rect.width) * 100))
          topPct = Math.max(8, Math.min(92, ((touch.clientY - rect.top) / rect.height) * 100))
        }
        this.setData({
          tacticsDraggingUserId: userId,
          tacticsDraggingSource: source,
          tacticsDragPreviewActive: true,
          tacticsDragPreviewLeft: Number(leftPct.toFixed(1)),
          tacticsDragPreviewTop: Number(topPct.toFixed(1)),
          tacticsDragPlayer: dragPlayer
        })
      })
    }, 150)
  },
  onTacticsTouchMove(event) {
    const touch = (event.touches && event.touches[0]) || null
    if (!touch) return
    if (!this.data.tacticsDragPreviewActive) {
      if (this.tacticsTouchStartPoint) {
        const dx = Math.abs(touch.clientX - this.tacticsTouchStartPoint.x)
        const dy = Math.abs(touch.clientY - this.tacticsTouchStartPoint.y)
        if (dx > 10 || dy > 10) {
          this.clearTacticsHoldTimer()
        }
      }
      return
    }
    this.tacticsLastMoveClient = { x: touch.clientX, y: touch.clientY }
    const rect = this.tacticsPitchRect
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const leftPct = Math.max(4, Math.min(96, ((touch.clientX - rect.left) / rect.width) * 100))
    const rawTop = ((touch.clientY - rect.top) / rect.height) * 100
    const topPct = Math.max(4, Math.min(108, rawTop))
    this.setData({
      tacticsDragPreviewLeft: Number(leftPct.toFixed(1)),
      tacticsDragPreviewTop: Number(topPct.toFixed(1))
    })
  },
  resolveDropZone(source, cx, cy, pRect, bRect) {
    const onBench = this.pointInRect(cx, cy, bRect)
    const onPitch = this.pointInRect(cx, cy, pRect)
    if (onBench) return 'bench'
    if (source === 'pitch' && pRect && cy > pRect.bottom) return 'bench'
    if (onPitch) return 'pitch'
    return ''
  },
  onTacticsTouchEnd(event) {
    this.clearTacticsHoldTimer()
    if (!this.data.tacticsDragPreviewActive) return
    const changed = (event.changedTouches && event.changedTouches[0]) || this.tacticsLastMoveClient || this.tacticsTouchStartPoint
    const userId = this.data.tacticsDraggingUserId
    const teamId = this.data.tacticsTeamId
    const source = this.data.tacticsDraggingSource || 'pitch'
    this.setData({
      tacticsDraggingUserId: '',
      tacticsDraggingSource: '',
      tacticsDragPreviewActive: false,
      tacticsDragPlayer: null
    })
    if (!changed || !userId || !teamId) return

    const finishDrop = () => {
      const pRect = this.tacticsPitchRect
      const bRect = this.tacticsBenchRect
      const cx = changed.clientX != null ? changed.clientX : changed.x
      const cy = changed.clientY != null ? changed.clientY : changed.y
      const dropZone = this.resolveDropZone(source, cx, cy, pRect, bRect)
      if (!dropZone) return

      const onPitch = dropZone === 'pitch'
      const relX = onPitch && pRect ? (cx - pRect.left) / pRect.width : 0.5
      const relY = onPitch && pRect ? (cy - pRect.top) / pRect.height : 0.5
      const board = this.data.tacticsBoard
      if (!board) return
      const pool = this.groupSignedPool(this.data.signups || [], teamId)
      const out = applyPitchDrag(board, pool, { source, userId, dropZone, x: relX, y: relY })
      if (out.toast) {
        wx.showToast({ title: out.toast, icon: 'none' })
        return
      }
      this.patchTacticsEntry(teamId, { board: out.state })
    }

    this.measureTacticsZones(finishDrop)
  },
  saveActivityTacticsBoard() {
    if (this.data.savingTacticsBoard) return
    if (!this.data.canEditTactics) {
      wx.showToast({ title: '只有本场正选可以保存战术板', icon: 'none' })
      return
    }
    if (!this.data.hasProfile) {
      wx.showModal({
        title: '请先完善资料',
        content: '请先在「我的」里填写个人资料，再保存阵容。',
        confirmText: '去填写',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) wx.reLaunch({ url: '/pages/me/me' })
        }
      })
      return
    }
    const teamId = this.data.tacticsTeamId
    if (!teamId) {
      wx.showToast({ title: '请选择分组', icon: 'none' })
      return
    }
    const slots = ((this.data.tacticsBoard && this.data.tacticsBoard.onPitch) || []).map((p) => ({
      userId: p.userId,
      x: p.x,
      y: p.y,
      role: p.role
    }))
    this.setData({ savingTacticsBoard: true })
    call('saveTacticsBoard', {
      scope: 'activity',
      activityId: this.data.id,
      teamId,
      slots
    }).then((res) => {
      const nextBoards = Object.assign({}, this.data.activityBoards || {})
      if (res && res.board) {
        nextBoards[teamId] = res.board
      }
      this.patchTacticsEntry(teamId, { removedNotice: '' })
      this.setData({
        savingTacticsBoard: false,
        activityBoards: nextBoards
      })
      wx.showToast({ title: '阵容已保存' })
    }).catch((err) => {
      this.setData({ savingTacticsBoard: false })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    })
  },
  generateTacticsTempFile() {
    return new Promise((resolve, reject) => {
      const query = this.createSelectorQuery()
      query.select('#tacticsCanvas')
        .fields({ node: true, size: true })
        .exec(async (res) => {
          const canvasNode = res && res[0] && res[0].node
          if (!canvasNode) {
            reject(new Error('画布初始化失败'))
            return
          }
          try {
            const size = await renderTacticsPoster(canvasNode, {
              activity: this.data.activity || {},
              teamName: this.data.tacticsTeamName || '本队',
              board: this.data.tacticsBoard
            })
            wx.canvasToTempFilePath({
              canvas: canvasNode,
              width: size.width,
              height: size.height,
              destWidth: size.width,
              destHeight: size.height,
              fileType: 'png',
              quality: 1,
              success: (out) => resolve(out.tempFilePath),
              fail: (err) => reject(err)
            })
          } catch (error) {
            reject(error)
          }
        })
    })
  },
  saveTacticsPoster() {
    if (this.data.exportingTactics) return
    this.setData({ exportingTactics: true })
    wx.showLoading({ title: '生成图片中...' })
    this.generateTacticsTempFile()
      .then((filePath) => {
        wx.hideLoading()
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => {
            this.setData({ exportingTactics: false })
            wx.showToast({ title: '已存到相册' })
          },
          fail: (err) => {
            this.setData({ exportingTactics: false })
            const msg = (err && err.errMsg) || ''
            if (msg.indexOf('cancel') !== -1) return
            if (msg.indexOf('auth') !== -1 || msg.indexOf('authorize') !== -1 || msg.indexOf('deny') !== -1) {
              wx.showModal({
                title: '需要相册权限',
                content: '允许访问相册后即可保存战术板图片，或点击预览长按保存。',
                confirmText: '去开启',
                cancelText: '预览图片',
                success: (modalRes) => {
                  if (modalRes.confirm) {
                    wx.openSetting()
                  } else {
                    wx.previewImage({ urls: [filePath], current: filePath })
                  }
                }
              })
              return
            }
            wx.previewImage({ urls: [filePath], current: filePath })
          }
        })
      })
      .catch(() => {
        wx.hideLoading()
        this.setData({ exportingTactics: false })
        wx.showToast({ title: '生成战术板失败', icon: 'none' })
      })
  },
  shareTacticsPoster() {
    if (this.data.exportingTactics) return
    this.setData({ exportingTactics: true })
    wx.showLoading({ title: '生成图片中...' })
    this.generateTacticsTempFile()
      .then((filePath) => {
        wx.hideLoading()
        this.setData({ exportingTactics: false })
        if (typeof wx.showShareImageMenu === 'function') {
          wx.showShareImageMenu({
            path: filePath,
            fail: (err) => {
              const msg = (err && err.errMsg) || ''
              if (msg.indexOf('cancel') !== -1) return
              wx.previewImage({ urls: [filePath], current: filePath })
            }
          })
          return
        }
        wx.previewImage({ urls: [filePath], current: filePath })
      })
      .catch(() => {
        wx.hideLoading()
        this.setData({ exportingTactics: false })
        wx.showToast({ title: '生成战术板失败', icon: 'none' })
      })
  }
})
