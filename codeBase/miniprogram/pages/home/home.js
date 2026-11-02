const { call, callQuiet, teamName, sortQuotasByMine } = require('../../utils/api')
const { loadActivityWeather } = require('../../utils/weather')
const {
  FILTER_ALL,
  setMultiClubReady,
  clubLabel,
  summaryPayload,
  pickPreferredCreateClub,
  resolveFilter,
  joinedClubs,
  normalizeClubs,
  otherJoinedClub,
  writeFilter,
  activityPageForClub
} = require('../../utils/club-context')

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

function decorateNext(activity, teams, myTeamId) {
  if (!activity) return null
  const date = new Date(activity.startTime)
  const isPool = activity.clubId === 'club_jielong' || activity.signupMode === 'pool'
  const poolCap = activity.maxSignedPlayers || 40
  const poolSigned = typeof activity.signedCount === 'number'
    ? activity.signedCount
    : ((activity.quotas || []).reduce((sum, quota) => sum + (quota.signed || 0), 0))
  return {
    ...activity,
    isPool,
    poolSigned,
    poolCap,
    poolPercent: poolCap ? Math.min(100, Math.round((poolSigned / poolCap) * 100)) : 0,
    clubLabel: clubLabel(activity.clubId || 'club_wednesday'),
    dateText: `${date.getMonth() + 1}月${date.getDate()}日 周${WEEK[date.getDay()]}`,
    clock: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    weatherDateText: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 周${WEEK[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    countdown: countdownText(activity.startTime),
    quotas: isPool ? [] : sortQuotasByMine((activity.quotas || []).map((quota) => ({
      ...quota,
      teamName: teamName(teams, quota.teamId) || ((activity.teams || []).find((team) => team.id === quota.teamId) || {}).name || quota.teamId,
      percent: quota.maxSignups ? Math.min(100, Math.round((quota.signed / quota.maxSignups) * 100)) : 0
    })), myTeamId)
  }
}

Page({
  data: {
    next: null,
    weather: null,
    loading: true,
    isAdmin: false,
    signedTeamName: '',
    clubs: [],
    noClub: false,
    viewClubFilter: '',
    otherHint: ''
  },
  onShow() {
    this.load()
  },
  onShareAppMessage() {
    const next = this.data.next
    if (!next) {
      return { title: '快乐足球', path: '/pages/home/home' }
    }
    const quotas = next.quotas || []
    const left = quotas.reduce((sum, quota) => sum + Math.max(0, (quota.maxSignups || 0) - (quota.signed || 0)), 0)
    const waiting = next.waitlistCount || 0
    const gap = left > 0 ? '还差 ' + left + ' 人，速来！' : (waiting < 6 ? '正选已满，可排后补' : '已满员，可先围观')
    const page = activityPageForClub(next.clubId)
    return {
      title: `${next.title} ${gap}`,
      path: `/pages/${page}/${page}?id=${next._id}`
    }
  },
  load() {
    this.setData({ loading: true })
    callQuiet('orgMe').then((org) => {
      setMultiClubReady(true)
      return call('me').then((profile) => {
        const clubs = normalizeClubs((org && org.clubs) || [], profile.user, profile.teams)
        return this.afterClubs(clubs, profile)
      })
    }).catch(() => {
      setMultiClubReady(false)
      return call('me').then((profile) => {
        const clubs = normalizeClubs([], profile.user, profile.teams)
        return this.afterClubs(clubs, profile)
      }).catch(() => this.setData({ loading: false, noClub: true, next: null, clubs: [] }))
    })
  },
  afterClubs(clubs, profile) {
    const joined = joinedClubs(clubs)
    const anyAdmin = joined.some((club) => club.role === 'admin' || club.role === 'owner')
      || !!(profile.user && profile.user.isAdmin)
    if (!joined.length) {
      this.setData({
        clubs,
        noClub: true,
        next: null,
        weather: null,
        otherHint: '',
        viewClubFilter: '',
        isAdmin: false,
        loading: false
      })
      return
    }
    const viewClubFilter = resolveFilter(clubs)
    this.setData({ clubs, noClub: false, viewClubFilter, isAdmin: anyAdmin })
    return this.loadSummary(clubs, profile, viewClubFilter)
  },
  loadSummary(clubs, profile, viewClubFilter) {
    const filter = viewClubFilter || FILTER_ALL
    const myTeamId = (profile.user && profile.user.teamId) || 'team_jiong'
    const other = otherJoinedClub(clubs, filter)
    const jobs = [call('homeSummary', summaryPayload('3m', filter))]
    if (other) jobs.push(callQuiet('homeSummary', summaryPayload('3m', other._id)).catch(() => null))

    Promise.all(jobs).then(([summary, otherSummary]) => {
      const teams = summary.teams || []
      const next = decorateNext(summary.nextActivity, teams, myTeamId)
      let signedTeamName = ''
      if (next && next.signedUp) {
        signedTeamName = next.isPool
          ? (next.divided ? (teamName(teams, next.signedTeamId) || '已报名') : '已报名')
          : teamName(teams, next.signedTeamId || myTeamId)
      }
      let otherHint = ''
      const otherNext = otherSummary && otherSummary.nextActivity
      if (other && otherNext && otherNext._id && (!next || otherNext._id !== next._id)) {
        const when = new Date(otherNext.startTime)
        otherHint = `${other.name}还有一场 · ${when.getMonth() + 1}月${when.getDate()}日`
      }
      this.setData({
        next,
        weather: null,
        signedTeamName,
        otherHint,
        otherClubId: other ? other._id : '',
        otherActivityId: otherNext ? otherNext._id : '',
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
          venueAddress: result.venueAddress || '上海市浦东新区川沙镇界龙足球基地'
        }
      })
    }).catch(() => this.setData({ weather: null }))
  },
  openOther() {
    const clubId = this.data.otherClubId
    const id = this.data.otherActivityId
    if (!clubId || !id) return
    writeFilter(clubId)
    const page = activityPageForClub(clubId)
    wx.navigateTo({ url: `/pages/${page}/${page}?id=${id}` })
  },
  open(event) {
    const id = event.currentTarget.dataset.id
    const clubId = event.currentTarget.dataset.club || (this.data.next && this.data.next.clubId) || ''
    if (clubId === 'club_jielong' || clubId === 'club_wednesday') writeFilter(clubId)
    const page = activityPageForClub(clubId)
    wx.navigateTo({ url: `/pages/${page}/${page}?id=${id}` })
  },
  noop() {},
  create() {
    const preferred = pickPreferredCreateClub(this.data.viewClubFilter, this.data.clubs)
    if (preferred) {
      wx.navigateTo({ url: `/pages/activity-edit/activity-edit?clubId=${preferred}` })
      return
    }
    wx.showActionSheet({
      itemList: ['周三联', '界龙散客'],
      success: (res) => {
        const clubId = res.tapIndex === 1 ? 'club_jielong' : 'club_wednesday'
        wx.navigateTo({ url: `/pages/activity-edit/activity-edit?clubId=${clubId}` })
      }
    })
  }
})
