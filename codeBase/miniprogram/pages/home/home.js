const { call, callQuiet, teamName, sortQuotasByMine } = require('../../utils/api')
const { loadActivityWeather } = require('../../utils/weather')
const {
  FILTER_ALL,
  setMultiClubReady,
  clubLabel,
  summaryPayload,
  resolveFilter,
  joinedClubs,
  normalizeClubs,
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

function sessionTeamLabel(activity, teamId) {
  const id = String(teamId || '').trim()
  if (!id || id === 'team_pending') return id === 'team_pending' ? '待分队' : ''
  const hit = ((activity && activity.teams) || []).find((team) => team && (team.id === id || team._id === id))
  return (hit && hit.name) || ''
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
    weatherFailed: false,
    weatherLoading: false,
    loading: true,
    signedTeamName: '',
    clubs: [],
    noClub: false,
    viewClubFilter: ''
  },
  onShow() {
    this.load()
  },
  onShareAppMessage() {
    const next = this.data.next
    if (!next) {
      return { title: '快乐足球', path: '/pages/home/home' }
    }
    const page = activityPageForClub(next.clubId)
    if (next.isPool) {
      const signed = next.poolSigned || 0
      const gap = signed > 0 ? `已报名 ${signed} 人，速来！` : '报名开启，速来！'
      return {
        title: `${next.title} ${gap}`,
        path: `/pages/${page}/${page}?id=${next._id}`
      }
    }
    const quotas = next.quotas || []
    const left = quotas.reduce((sum, quota) => sum + Math.max(0, (quota.maxSignups || 0) - (quota.signed || 0)), 0)
    const waiting = next.waitlistCount || 0
    const gap = left > 0 ? '还差 ' + left + ' 人，速来！' : (waiting < 6 ? '正选已满，可排后补' : '已满员，可先围观')
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
    if (!joined.length) {
      this.setData({
        clubs,
        noClub: true,
        next: null,
        weather: null,
        viewClubFilter: '',
        loading: false
      })
      return
    }
    const viewClubFilter = resolveFilter(clubs)
    this.setData({ clubs, noClub: false, viewClubFilter })
    return this.loadSummary(profile)
  },
  loadSummary(profile) {
    const myTeamId = (profile.user && profile.user.teamId) || 'team_jiong'
    // 下一场：仅已报名的最近一场（跨已加入球队），不跟球队筛选
    call('homeSummary', summaryPayload('3m', FILTER_ALL)).then((summary) => {
      const teams = summary.teams || []
      const next = decorateNext(summary.nextActivity, teams, myTeamId)
      let signedTeamName = ''
      if (next) {
        // 界龙场次队在 activity.teams（sess_*），不能用周三联 TEAMS 去查
        signedTeamName = next.isPool
          ? (next.divided ? sessionTeamLabel(next, next.signedTeamId) : '')
          : teamName(teams, next.signedTeamId || myTeamId)
      }
      this.setData({
        next,
        weather: null,
        signedTeamName,
        loading: false
      })
      if (next && next.startTime) this.loadWeather(next.startTime)
    }).catch(() => this.setData({ loading: false, weather: null }))
  },
  loadWeather(startTime) {
    if (!startTime) return
    this.setData({ weatherLoading: true, weatherFailed: false })
    loadActivityWeather(startTime).then((result) => {
      if (!(result.hours || []).length) {
        this.setData({ weather: null, weatherFailed: true, weatherLoading: false })
        return
      }
      this.setData({
        weather: {
          hours: result.hours,
          sunrise: result.sunrise || '',
          sunset: result.sunset || '',
          defaultIndex: typeof result.defaultIndex === 'number' ? result.defaultIndex : 0,
          venueAddress: result.venueAddress || '上海市浦东新区川沙镇界龙足球基地'
        },
        weatherFailed: false,
        weatherLoading: false
      })
    }).catch(() => this.setData({ weather: null, weatherFailed: true, weatherLoading: false }))
  },
  retryWeather() {
    const next = this.data.next
    if (!next || !next.startTime || this.data.weatherLoading) return
    this.loadWeather(next.startTime)
  },
  open(event) {
    const id = event.currentTarget.dataset.id
    const clubId = event.currentTarget.dataset.club || (this.data.next && this.data.next.clubId) || ''
    if (clubId === 'club_jielong' || clubId === 'club_wednesday') writeFilter(clubId)
    const page = activityPageForClub(clubId)
    wx.navigateTo({ url: `/pages/${page}/${page}?id=${id}` })
  },
  noop() {}
})
