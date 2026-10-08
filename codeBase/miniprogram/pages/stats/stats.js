const { call, teamName, avatarChar, avatarColor } = require('../../utils/api.js')

const SPANS = [
  { id: '3m', name: '近 3 个月' },
  { id: '6m', name: '近半年' },
  { id: '1y', name: '近 1 年' },
  { id: '2y', name: '近 2 年' },
  { id: '3y', name: '近 3 年' },
]

Page({
  data: {
    spans: SPANS,
    span: '3m',
    goalsTop: [],
    assistsTop: [],
    absencesTop: [],
  },

  onShow() {
    this.loadBoards()
  },

  onSpan(e) {
    const span = e.currentTarget.dataset.span
    if (!span || span === this.data.span) return
    this.setData({ span })
    this.loadBoards()
  },

  loadBoards() {
    call('homeSummary', { span: this.data.span }).then((res) => {
      const teams = res.teams || []
      this.setData({
        goalsTop: decorate(res.goalsTop, 'goals', teams),
        assistsTop: decorate(res.assistsTop, 'assists', teams),
        absencesTop: decorate(res.absencesTop, 'absences', teams),
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
