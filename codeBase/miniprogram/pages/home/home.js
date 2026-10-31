const { call, teamName, sortQuotasByMine } = require('../../utils/api')
const { loadActivityWeather } = require('../../utils/weather')

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
    weather: null,
    loading: true,
    isAdmin: false,
    signedTeamName: ''
  },
  onShow() {
    this.load()
  },
  onShareAppMessage() {
    const next = this.data.next
    const quotas = (next && next.quotas) || []
    const left = quotas.reduce((sum, quota) => sum + Math.max(0, (quota.maxSignups || 0) - (quota.signed || 0)), 0)
    const cap = next && next.signupMode === 'joint' ? 6 : 6
    const waiting = (next && next.waitlistCount) || 0
    const gap = !next ? '' : (left > 0 ? '还差 ' + left + ' 人，速来！' : (waiting < cap ? '正选已满，可排后补' : '已满员，可先围观'))
    return {
      title: next ? `${next.title} ${gap}` : '周三快乐足球联队',
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
          weatherDateText: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 周${WEEK[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
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
        weather: null,
        signedTeamName,
        isAdmin: !!(profile.user && profile.user.isAdmin),
        loading: false
      })
      if (next && next.startTime) this.loadWeather(next.startTime)
    }).catch(() => this.setData({ loading: false, weather: null }))
  },
  loadWeather(startTime) {
    loadActivityWeather(startTime).then((result) => {
      if (!(result.hours || []).length) {
        this.setData({ weather: null })
        return
      }
      this.setData({
        weather: {
          hours: result.hours,
          sunrise: result.sunrise || '',
          sunset: result.sunset || '',
          defaultIndex: typeof result.defaultIndex === 'number' ? result.defaultIndex : 0,
          venueAddress: result.venueAddress || '上海市浦东新区川沙镇界绿路88号，界龙足球基地'
        }
      })
    }).catch(() => this.setData({ weather: null }))
  },
  open(event) {
    wx.navigateTo({ url: `/pages/activity/activity?id=${event.currentTarget.dataset.id}` })
  },
  noop() {},
  create() {
    wx.navigateTo({ url: '/pages/activity-edit/activity-edit' })
  }
})
