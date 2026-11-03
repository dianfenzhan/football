const { call, callQuiet, sortTeamsByMine } = require('../../utils/api')

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
      team_jiong: '11',
      team_pudong: '11'
    },
    saving: false,
    signupMode: 'split',
    clubId: '',
    maxSignedPlayers: '40'
  },
  onLoad() {
    const when = nextWednesdayAt20(new Date())
    const clubId = wx.getStorageSync('currentClubId') || ''
    this.setData({
      clubId,
      date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
      time: '20:00',
      title: clubId === 'club_jielong' ? '界龙散客局' : '养生球'
    })
    const profileCall = clubId === 'club_jielong' ? callQuiet('orgMe') : call('me')
    profileCall.then((res) => {
      if (clubId === 'club_jielong') {
        const club = (res.clubs || []).find((item) => item._id === 'club_jielong')
        const allowed = club && (club.role === 'admin' || club.role === 'owner')
        if (!allowed) wx.showToast({ title: '只有管理员可以新建', icon: 'none' })
        return
      }
      if (!res.user || !res.user.isAdmin) {
        wx.showToast({ title: '只有管理员可以新建', icon: 'none' })
        return
      }
      const myTeamId = (res.user && res.user.teamId) || 'team_jiong'
      this.setData({ teams: sortTeamsByMine(res.teams || [], myTeamId) })
    }).catch((err) => {
      if (clubId !== 'club_jielong') return
      const msg = (err && err.message) || ''
      wx.showToast({
        title: /未知操作|invalid action/i.test(msg)
          ? '未走本地云函数，请开启 api 云函数本地调试'
          : (msg || '加载失败'),
        icon: 'none'
      })
    })
  },
  onMax(event) { this.setData({ maxSignedPlayers: event.detail.value }) },
  onMode(event) {
    const mode = event.currentTarget.dataset.mode
    if (mode !== 'split' && mode !== 'joint') return
    this.setData({ signupMode: mode })
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
    if (this.data.clubId === 'club_jielong') {
      this.setData({ saving: true })
      call('createActivity', {
        clubId: 'club_jielong',
        title: this.data.title,
        location: this.data.location,
        startTime
      }).then((res) => {
        wx.redirectTo({ url: `/pages/session/session?id=${res.activityId}` })
      }).catch(() => this.setData({ saving: false }))
      return
    }
    const quotas = {}
    this.data.teams.forEach((team) => {
      quotas[team._id] = Number(this.data.quotas[team._id])
    })
    this.setData({ saving: true })
    call('createActivity', {
      title: this.data.title,
      location: this.data.location,
      startTime,
      quotas,
      signupMode: this.data.signupMode || 'split'
    }).then((res) => {
      wx.redirectTo({ url: `/pages/activity/activity?id=${res.activityId}` })
    }).catch(() => this.setData({ saving: false }))
  }
})
