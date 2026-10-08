const { call } = require('../../utils/api')

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function nextWednesdayAt20(now) {
  const day = now.getDay()
  let add = (3 - day + 7) % 7
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, 20, 0, 0, 0)
  if (candidate.getTime() <= now.getTime()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + add + 7, 20, 0, 0, 0)
  }
  return candidate
}

Page({
  data: {
    teams: [],
    title: '养生球',
    location: '界龙足球基地（界绿路 88 号）',
    date: '',
    time: '',
    counts: Array.from({ length: 30 }, (_, index) => `${index + 1}`),
    quotas: {
      team_jiong: '12',
      team_pudong: '12'
    },
    saving: false
  },
  onLoad() {
    const when = nextWednesdayAt20(new Date())
    this.setData({
      date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
      time: '20:00'
    })
    call('me').then((res) => {
      if (!res.user || !res.user.isAdmin) {
        wx.showToast({ title: '只有管理员可以新建', icon: 'none' })
        return
      }
      this.setData({ teams: res.teams || [] })
    })
  },
  onTitle(event) { this.setData({ title: event.detail.value }) },
  onLocation(event) { this.setData({ location: event.detail.value }) },
  onDate(event) { this.setData({ date: event.detail.value }) },
  onTime(event) { this.setData({ time: event.detail.value }) },
  onQuota(event) {
    const teamId = event.currentTarget.dataset.team
    const count = this.data.counts[Number(event.detail.value)]
    this.setData({ [`quotas.${teamId}`]: count })
  },
  submit() {
    if (this.data.saving) return
    const [hour, minute] = this.data.time.split(':').map(Number)
    const [year, month, day] = this.data.date.split('-').map(Number)
    const startTime = new Date(year, month - 1, day, hour, minute).getTime()
    const quotas = {}
    this.data.teams.forEach((team) => {
      quotas[team._id] = Number(this.data.quotas[team._id])
    })
    this.setData({ saving: true })
    call('createActivity', {
      title: this.data.title,
      location: this.data.location,
      startTime,
      quotas
    }).then((res) => {
      wx.redirectTo({ url: `/pages/activity/activity?id=${res.activityId}&share=1` })
    }).catch(() => this.setData({ saving: false }))
  }
})
