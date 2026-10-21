const { call, teamName, avatarChar, avatarColor, sortTeamsByMine } = require('../../utils/api.js')

const SPANS = [
  { id: '3m', name: '近 3 个月' },
  { id: '6m', name: '近半年' },
  { id: '1y', name: '近 1 年' },
]

const BOARDS = [
  { id: 'goals', name: '⚽️ 进球', empty: '还没有进球', field: 'goals', miss: false },
  { id: 'assists', name: '👟 助攻', empty: '还没有助攻', field: 'assists', miss: false },
  { id: 'absences', name: '🐦 鸽子', empty: '还没有鸽子', field: 'absences', miss: true },
]

Page({
  data: {
    spans: SPANS,
    span: '3m',
    teamFilters: [],
    teamId: '',
    boards: BOARDS,
    boardId: 'goals',
    board: BOARDS[0],
    list: [],
  },

  onShow() {
    this.bootstrap()
  },

  bootstrap() {
    call('me').then((res) => {
      const myTeamId = (res.user && res.user.teamId) || 'team_jiong'
      const teams = sortTeamsByMine(res.teams || [], myTeamId)
      const teamFilters = [
        { id: 'all', name: '全部' },
        ...teams.map((team) => ({ id: team._id, name: team.name })),
      ]
      this.setData({ teamFilters, teamId: '' }, () => this.loadBoards())
    }).catch(() => this.loadBoards())
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
    const board = BOARDS.find((item) => item.id === boardId) || BOARDS[0]
    this.setData({
      boardId,
      board,
      list: this._lists ? (this._lists[boardId] || []) : [],
    })
  },

  loadBoards() {
    const payload = { span: this.data.span }
    if (this.data.teamId) payload.teamId = this.data.teamId
    call('homeSummary', payload).then((res) => {
      const teams = res.teams || []
      const lists = {
        goals: decorate(res.goalsTop, 'goals', teams),
        assists: decorate(res.assistsTop, 'assists', teams),
        absences: decorate(res.absencesTop, 'absences', teams),
      }
      this._lists = lists
      const board = BOARDS.find((item) => item.id === this.data.boardId) || BOARDS[0]
      this.setData({
        board,
        list: lists[board.id] || [],
      })
    }).catch((err) => {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },
})

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
