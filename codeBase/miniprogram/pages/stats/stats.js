const { call, callQuiet, teamName, avatarChar, avatarColor, sortTeamsByMine } = require('../../utils/api.js')
const {
  FILTER_ALL,
  setMultiClubReady,
  joinedClubs,
  normalizeClubs,
  readFilter,
  writeFilter,
  filterOptions,
  resolveFilter,
  summaryPayload
} = require('../../utils/club-context')

const SPANS = [
  { id: '3m', name: '近 3 个月' },
  { id: '6m', name: '近半年' },
  { id: '1y', name: '近 1 年' },
]

const BOARDS_BASE = [
  { id: 'goals', name: '⚽️ 进球', empty: '还没有进球', field: 'goals', miss: false },
  { id: 'assists', name: '👟 助攻', empty: '还没有助攻', field: 'assists', miss: false },
  { id: 'ownGoals', name: '🥅 乌龙', empty: '还没有乌龙', field: 'ownGoals', miss: true },
  { id: 'attendances', name: '🏃 出勤', empty: '还没有出勤', field: 'attendances', miss: false },
]
const ABSENCE_BOARD = { id: 'absences', name: '🐦 鸽子', empty: '还没有鸽子', field: 'absences', miss: true }

function boardsForAdmin(canSeeAbsences) {
  return canSeeAbsences ? BOARDS_BASE.concat([ABSENCE_BOARD]) : BOARDS_BASE.slice()
}

function clubRoleAdmin(clubs, clubId) {
  return (clubs || []).some((club) => (
    club && club._id === clubId && club.joined && (club.role === 'admin' || club.role === 'owner')
  ))
}

/** 与云函数 canViewAbsenceStats 对齐：按当前筛选队判断 */
function isAbsenceAdmin(user, clubs, filter) {
  if (user && user.canGrantAdmin) return true
  const wedAdmin = !!(user && user.isAdmin) || clubRoleAdmin(clubs, 'club_wednesday')
  const jlAdmin = clubRoleAdmin(clubs, 'club_jielong')
  if (filter === 'club_wednesday') return wedAdmin
  if (filter === 'club_jielong') return jlAdmin
  return wedAdmin || jlAdmin
}

Page({
  data: {
    spans: SPANS,
    span: '3m',
    teamFilters: [],
    teamId: '',
    clubs: [],
    filterOptions: [],
    viewClubFilter: '',
    noClub: false,
    canSeeAbsences: false,
    boards: BOARDS_BASE,
    boardId: 'goals',
    board: BOARDS_BASE[0],
    list: [],
  },

  onShow() {
    this.bootstrap()
  },

  onFilterChange(event) {
    writeFilter(event.detail && event.detail.clubId)
    this.bootstrap()
  },

  bootstrap() {
    call('me').then((res) => {
      const myTeamId = (res.user && res.user.teamId) || 'team_jiong'
      const teams = sortTeamsByMine(res.teams || [], myTeamId)
      const wednesdayFilters = [
        { id: 'all', name: '全部' },
        ...teams.map((team) => ({ id: team._id, name: team.name })),
      ]
      return callQuiet('orgMe').then((org) => {
        setMultiClubReady(true)
        return normalizeClubs((org && org.clubs) || [], res.user, res.teams)
      }).catch(() => {
        setMultiClubReady(false)
        return normalizeClubs([], res.user, res.teams)
      }).then((clubs) => {
        const joined = joinedClubs(clubs)
        const viewClubFilter = resolveFilter(clubs)
        const canSeeAbsences = isAbsenceAdmin(res.user, clubs, viewClubFilter)
        const boards = boardsForAdmin(canSeeAbsences)
        const keepBoard = boards.find((item) => item.id === this.data.boardId) || boards[0]
        this._profileUser = res.user
        if (!joined.length) {
          this._lists = { goals: [], assists: [], ownGoals: [], attendances: [], absences: [] }
          this.setData({
            clubs,
            filterOptions: [],
            viewClubFilter: '',
            noClub: true,
            canSeeAbsences,
            boards,
            boardId: keepBoard.id,
            board: keepBoard,
            teamFilters: [],
            teamId: '',
            list: []
          })
          return
        }
        const wed = clubs.find((item) => item._id === 'club_wednesday' && item.joined)
        const jl = clubs.find((item) => item._id === 'club_jielong' && item.joined)
        const wedGroupFilters = (wed && wed.groups && wed.groups.length)
          ? [{ id: 'all', name: '全部' }].concat(wed.groups.map((group) => ({ id: group.id, name: group.name })))
          : wednesdayFilters
        const jlGroupFilters = (jl && jl.groups && jl.groups.length)
          ? [{ id: 'all', name: '全部' }].concat(jl.groups.map((group) => ({ id: group.id, name: group.name })))
          : []
        let filters = []
        if (viewClubFilter === 'club_wednesday') filters = wedGroupFilters
        else if (viewClubFilter === 'club_jielong') filters = jlGroupFilters
        this.setData({
          clubs,
          filterOptions: filterOptions(clubs),
          viewClubFilter,
          noClub: false,
          canSeeAbsences,
          boards,
          boardId: keepBoard.id,
          board: keepBoard,
          teamFilters: filters,
          teamId: ''
        }, () => this.loadBoards())
      })
    }).catch(() => {
      this._profileUser = null
      this.setData({
        noClub: true,
        canSeeAbsences: false,
        boards: BOARDS_BASE,
        boardId: 'goals',
        board: BOARDS_BASE[0],
        list: [],
        teamFilters: []
      })
    })
  },

  onSpan(e) {
    const span = e.currentTarget.dataset.span
    if (!span || span === this.data.span) return
    this.setData({ span })
    this.loadBoards()
  },

  onTeam(e) {
    const raw = e.currentTarget.dataset.id
    const teamId = raw === 'all' ? '' : raw
    if (teamId === this.data.teamId) return
    this.setData({ teamId })
    this.loadBoards()
  },

  onBoard(e) {
    const boardId = e.currentTarget.dataset.id
    if (!boardId || boardId === this.data.boardId) return
    const boards = this.data.boards || BOARDS_BASE
    const board = boards.find((item) => item.id === boardId) || boards[0]
    this.setData({
      boardId,
      board,
      list: this._lists ? (this._lists[boardId] || []) : [],
    })
  },

  loadBoards() {
    if (this.data.noClub) {
      this._lists = { goals: [], assists: [], ownGoals: [], attendances: [], absences: [] }
      this.setData({ list: [] })
      return
    }
    const filter = this.data.viewClubFilter || readFilter()
    if (!filter) {
      this._lists = { goals: [], assists: [], ownGoals: [], attendances: [], absences: [] }
      this.setData({ list: [] })
      return
    }
    const payload = summaryPayload(this.data.span, filter)
    if (this.data.teamId && (filter === 'club_wednesday' || filter === 'club_jielong')) {
      payload.teamId = this.data.teamId
    }
    const jobs = [call('homeSummary', payload)]
    // 界龙进球/助攻/乌龙可来自 contributions 与历史 goal_events
    if (filter === 'club_jielong' || filter === FILTER_ALL) {
      const clubStatsPayload = { clubId: 'club_jielong' }
      if (this.data.teamId && filter === 'club_jielong') clubStatsPayload.teamId = this.data.teamId
      jobs.push(callQuiet('clubStats', clubStatsPayload).catch(() => null))
    } else {
      jobs.push(Promise.resolve(null))
    }
    Promise.all(jobs).then(([res, clubStats]) => {
      const clubGroupTeams = []
      ;(this.data.clubs || []).forEach((c) => {
        ;(c.groups || []).forEach((g) => {
          clubGroupTeams.push({ _id: g.id, name: g.name })
        })
      })
      const teams = (res.teams || []).concat(clubGroupTeams)
      const summaryClub = res.clubId || ''
      // 远端旧云函数可能忽略 clubId：筛界龙时不能沿用周三联榜
      const summaryTrusted = filter === FILTER_ALL
        || summaryClub === filter
        || (filter === 'club_wednesday' && (!summaryClub || summaryClub === 'club_wednesday'))
      const selectedGroupId = this.data.teamId || ''
      const filterByGroup = (rows) => (
        selectedGroupId ? (rows || []).filter((r) => !r.teamId || r.teamId === selectedGroupId) : (rows || [])
      )
      const lists = {
        goals: summaryTrusted ? decorate(res.goalsTop, 'goals', teams) : [],
        assists: summaryTrusted ? decorate(res.assistsTop, 'assists', teams) : [],
        ownGoals: summaryTrusted ? decorate(res.ownGoalsTop, 'ownGoals', teams) : [],
        attendances: summaryTrusted ? decorate(res.attendancesTop, 'attendances', teams) : [],
        absences: summaryTrusted ? decorate(res.absencesTop, 'absences', teams) : [],
      }
      if (clubStats && Array.isArray(clubStats.rows)) {
        const filteredClubRows = filterByGroup(clubStats.rows)
        const jielongGoals = filteredClubRows.filter((row) => row.goals > 0)
        const jielongAssists = filteredClubRows.filter((row) => row.assists > 0)
        const jielongOwnGoals = filteredClubRows.filter((row) => row.ownGoals > 0)
        if (filter === 'club_jielong') {
          lists.goals = decorate(
            jielongGoals.sort((a, b) => b.goals - a.goals).slice(0, 10),
            'goals',
            teams
          )
          lists.assists = decorate(
            jielongAssists.sort((a, b) => b.assists - a.assists).slice(0, 10),
            'assists',
            teams
          )
          lists.ownGoals = decorate(
            jielongOwnGoals.sort((a, b) => b.ownGoals - a.ownGoals).slice(0, 10),
            'ownGoals',
            teams
          )
          // 出勤/鸽子只认界龙 summary；旧云函数不可信时保持空
          if (!summaryTrusted) {
            lists.attendances = []
            lists.absences = []
          }
        } else if (filter === FILTER_ALL) {
          lists.goals = decorate(mergeStatRows(res.goalsTop, jielongGoals, 'goals'), 'goals', teams)
          lists.assists = decorate(mergeStatRows(res.assistsTop, jielongAssists, 'assists'), 'assists', teams)
          lists.ownGoals = decorate(mergeStatRows(res.ownGoalsTop, jielongOwnGoals, 'ownGoals'), 'ownGoals', teams)
        }
      } else if (filter === 'club_jielong') {
        // clubStats 不可用时不要展示周三联进球/助攻
        lists.goals = []
        lists.assists = []
        lists.ownGoals = []
        if (!summaryTrusted) {
          lists.attendances = []
          lists.absences = []
        }
      }
      if (!this.data.canSeeAbsences) lists.absences = []
      this._lists = lists
      const boards = this.data.boards || BOARDS_BASE
      const board = boards.find((item) => item.id === this.data.boardId) || boards[0]
      this.setData({
        board,
        list: lists[board.id] || [],
      })
    }).catch((err) => {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },
})

function mergeStatRows(baseRows, extraRows, field) {
  const map = {}
  ;(baseRows || []).forEach((row) => {
    if (!row || !row.playerOpenid) return
    map[row.playerOpenid] = { ...row }
  })
  ;(extraRows || []).forEach((row) => {
    if (!row || !row.playerOpenid) return
    const prev = map[row.playerOpenid]
    if (!prev) {
      map[row.playerOpenid] = {
        playerOpenid: row.playerOpenid,
        userName: row.userName,
        teamId: row.teamId || '',
        avatarUrl: row.avatarUrl || '',
        goals: row.goals || 0,
        assists: row.assists || 0,
        ownGoals: row.ownGoals || 0,
        absences: 0,
        attendances: 0
      }
      return
    }
    prev.goals = (prev.goals || 0) + (row.goals || 0)
    prev.assists = (prev.assists || 0) + (row.assists || 0)
    prev.ownGoals = (prev.ownGoals || 0) + (row.ownGoals || 0)
    if (!prev.userName && row.userName) prev.userName = row.userName
  })
  return Object.values(map)
    .filter((row) => (row[field] || 0) > 0)
    .sort((a, b) => (b[field] || 0) - (a[field] || 0))
    .slice(0, 10)
}

function decorate(list, field, teams) {
  return (list || []).map((p, i) => ({
    ...p,
    rank: i + 1,
    value: p[field],
    teamName: teamName(teams, p.teamId),
    avatarChar: avatarChar(p.userName),
    avatarBg: avatarColor(p.userName),
  }))
}
