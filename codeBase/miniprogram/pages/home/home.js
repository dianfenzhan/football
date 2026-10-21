const { call, teamName, sortQuotasByMine } = require('../../utils/api')

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function countdownText(startTime) {
  const diff = startTime - Date.now()
  if (diff <= 0) return '已开赛'
  const hours = diff / 3600000
  if (hours < 24) return `还有 ${Math.max(1, Math.round(hours))} 小时`
  return `还有 ${Math.ceil(hours / 24)} 天`
}

Page({
  data: {
    next: null,
    loading: true,
    isAdmin: false,
    signedTeamName: ''
  },
  onShow() {
    this.load()
  },
  onShareAppMessage() {
    const next = this.data.next
    return {
      title: next ? next.title : '周三快乐足球联队',
      path: '/pages/home/home'
    }
  },
  load() {
    this.setData({ loading: true })
    Promise.all([call('homeSummary', { span: '3m' }), call('me')]).then(([summary, profile]) => {
      const teams = summary.teams || []
      const myTeamId = (profile.user && profile.user.teamId) || 'team_jiong'
      const activity = summary.nextActivity
      let next = null
      let signedTeamName = ''
      if (activity) {
        const date = new Date(activity.startTime)
        next = {
          ...activity,
          dateText: `${date.getMonth() + 1}月${date.getDate()}日 周${WEEK[date.getDay()]}`,
          clock: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
          countdown: countdownText(activity.startTime),
          quotas: sortQuotasByMine((activity.quotas || []).map((quota) => ({
            ...quota,
            teamName: teamName(teams, quota.teamId),
            percent: quota.maxSignups ? Math.min(100, Math.round((quota.signed / quota.maxSignups) * 100)) : 0
          })), myTeamId)
        }
        if (activity.signedUp) {
          signedTeamName = teamName(teams, activity.signedTeamId || myTeamId)
        }
      }
      this.setData({
        next,
        signedTeamName,
        isAdmin: !!(profile.user && profile.user.isAdmin),
        loading: false
      })
    }).catch(() => this.setData({ loading: false }))
  },
  open(event) {
    wx.navigateTo({ url: `/pages/activity/activity?id=${event.currentTarget.dataset.id}` })
  },
  create() {
    wx.navigateTo({ url: '/pages/activity-edit/activity-edit' })
  }
})
