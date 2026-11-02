const { call, callQuiet, formatTime } = require('../../utils/api')
const {
  syncFilterFromActivity,
  normalizeClubs,
  setMultiClubReady,
  joinedClubs
} = require('../../utils/club-context')

const PENDING = 'team_pending'
const JIELONG_DEFAULT_GROUP = 'jl_other'
const JIELONG_GROUPS = [
  { id: 'jl_tazi', name: '塔子🕊', color: '#1d6b50' },
  { id: 'jl_jielong', name: '界龙⭐️', color: '#f4f4f4' },
  { id: 'jl_shangxin', name: '伤心🇮🇹', color: '#e6b325' },
  { id: 'jl_tangmu', name: '汤姆🐻', color: '#3d5a80' },
  { id: 'jl_aiqing', name: '爱情🔥', color: '#c44536' },
  { id: 'jl_other', name: '散客⚽️', color: '#1c2421' }
]

function pairRows(list) {
  const rows = []
  for (let i = 0; i < list.length; i += 2) {
    rows.push({ left: list[i], right: list[i + 1] || null })
  }
  return rows
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

Page({
  data: {
    id: '',
    activity: null,
    divided: false,
    isAdmin: false,
    started: false,
    locked: false,
    timeText: '',
    mineStatus: '',
    signedCount: 0,
    waitlistCount: 0,
    pendingCount: 0,
    poolRows: [],
    waitlistRows: [],
    teamCards: [],
    rounds: [],
    standings: [],
    goalEvents: [],
    showDivide: false,
    teamCountOptions: [2, 3, 4, 5, 6],
    sizeOptions: [7, 8, 9],
    pickTeamCount: 4,
    pickSize: 8,
    divideHint: '',
    selectedOpenid: '',
    selectedName: '',
    scoreDraft: {},
    rosterGroups: JIELONG_GROUPS,
    pickGroupId: JIELONG_DEFAULT_GROUP,
    needRosterPick: false
  },
  onLoad(query) {
    this.setData({ id: query.id })
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onShow() {
    if (this.data.id) this.load()
  },
  onShareAppMessage() {
    const activity = this.data.activity
    if (!activity) {
      return {
        title: '界龙散客',
        path: `/pages/session/session?id=${this.data.id}`
      }
    }
    const date = new Date(activity.startTime)
    const weeks = ['日', '一', '二', '三', '四', '五', '六']
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
    const when = `${date.getMonth() + 1}.${date.getDate()} 周${weeks[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    const left = Math.max(0, (activity.maxSignedPlayers || 40) - (this.data.signedCount || 0))
    const gap = left > 0 ? `还差 ${left} 人，速来！` : '正选已满，可排后补'
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
        || !!(detail.me && detail.me.canGrantAdmin)
      const meOpenid = detail.me && detail.me._openid
      const signups = detail.signups || []
      const signed = signups.filter((item) => item.status === 'signed')
      const waitlist = signups.filter((item) => item.status === 'waitlist')
        .slice()
        .sort((a, b) => (a.waitlistOrder || 0) - (b.waitlistOrder || 0))
      const divided = !!activity.divided && (activity.teams || []).length > 0
      const pending = signed.filter((item) => !item.teamId || item.teamId === PENDING)
      const locked = !!(detail.rounds || []).some((round) => round.scoreA != null || round.scoreB != null)
        || !!(detail.goalEvents || []).length
      const mine = signups.find((item) => item._openid === meOpenid && item.status !== 'cancelled')
      let mineStatus = ''
      if (mine && mine.status === 'waitlist') mineStatus = '你在后补'
      else if (mine && divided) {
        const team = (activity.teams || []).find((item) => item.id === mine.teamId)
        mineStatus = team ? `已分到 ${team.name}` : '已报名，待分队'
      } else if (mine) mineStatus = '已报名'

      const rosterGroups = ((club && club.groups) || []).length
        ? club.groups
        : JIELONG_GROUPS
      const existingGroup = (club && club.groupId) || ''
      const needRosterPick = !mine
      const pickGroupId = (existingGroup && rosterGroups.some((g) => g.id === existingGroup))
        ? existingGroup
        : (this.data.pickGroupId && rosterGroups.some((g) => g.id === this.data.pickGroupId)
          ? this.data.pickGroupId
          : JIELONG_DEFAULT_GROUP)

      const teamCards = (activity.teams || []).map((team) => {
        const members = signed.filter((item) => item.teamId === team.id)
        return { ...team, members, count: members.length }
      }).filter((team) => team.count > 0 || isAdmin)

      const nameOf = {}
      signed.concat(waitlist).forEach((item) => { nameOf[item._openid] = item.userName })
      const rounds = (detail.rounds || []).map((round) => ({
        ...round,
        left: ((activity.teams || []).find((team) => team.id === round.teamAId) || {}).name || round.teamAId,
        right: ((activity.teams || []).find((team) => team.id === round.teamBId) || {}).name || round.teamBId,
        scoreText: round.scoreA != null ? `${round.scoreA} : ${round.scoreB}` : '未赛',
        typeLabel: round.matchType === 'final' ? '决赛' : (round.matchType === 'third' ? '三四名' : '')
      }))
      const standings = standingsOf(activity.teams || [], detail.rounds || [])

      this.setData({
        activity,
        divided,
        isAdmin,
        started: activity.startTime <= Date.now(),
        locked,
        timeText: formatTime(activity.startTime),
        mineStatus,
        meOpenid,
        signedCount: signed.length,
        waitlistCount: waitlist.length,
        pendingCount: pending.length,
        poolRows: pairRows(divided ? pending : signed),
        waitlistRows: pairRows(waitlist),
        teamCards,
        rounds,
        standings,
        goalEvents: (detail.goalEvents || []).map((item) => ({
          ...item,
          scorerName: nameOf[item.scorerOpenid] || '球员',
          assistName: item.assisterOpenid ? (nameOf[item.assisterOpenid] || '球员') : ''
        })),
        pickTeamCount: activity.teamCount || 4,
        pickSize: activity.targetPerTeam || 8,
        divideHint: this.hintFor(signed.length, activity.teamCount || 4, activity.targetPerTeam || 8),
        selectedOpenid: '',
        selectedName: '',
        rosterGroups,
        pickGroupId,
        needRosterPick
      })
    })
  },
  onPickRoster(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    this.setData({ pickGroupId: id })
  },
  hintFor(signedCount, teamCount, size) {
    const capacity = teamCount * size
    if (signedCount <= capacity) {
      return `${signedCount} 人分成 ${teamCount} 队，尽量每队 ${size} 人`
    }
    return `${signedCount} 人里先分 ${capacity} 人（每队约 ${size}），多出的留在未分队`
  },
  signup() {
    const groupId = this.data.pickGroupId || JIELONG_DEFAULT_GROUP
    call('signup', { activityId: this.data.id, groupId }).then((res) => {
      wx.showToast({ title: res.waitlist ? '已进后补' : '已报名', icon: 'success' })
      this.load()
    })
  },
  cancel() {
    wx.showModal({
      title: '取消报名',
      content: '确定取消这场报名吗？',
      success: (res) => {
        if (!res.confirm) return
        call('cancelSignup', { activityId: this.data.id }).then(() => {
          wx.showToast({ title: '已取消' })
          this.load()
        })
      }
    })
  },
  openDivide() {
    const signedCount = this.data.signedCount
    this.setData({
      showDivide: true,
      pickTeamCount: this.data.pickTeamCount || 4,
      pickSize: 8,
      divideHint: this.hintFor(signedCount, this.data.pickTeamCount || 4, 8)
    })
  },
  closeDivide() {
    this.setData({ showDivide: false })
  },
  onPickCount(event) {
    const pickTeamCount = Number(event.currentTarget.dataset.value)
    this.setData({
      pickTeamCount,
      divideHint: this.hintFor(this.data.signedCount, pickTeamCount, this.data.pickSize)
    })
  },
  onPickSize(event) {
    const pickSize = Number(event.currentTarget.dataset.value)
    this.setData({
      pickSize,
      divideHint: this.hintFor(this.data.signedCount, this.data.pickTeamCount, pickSize)
    })
  },
  confirmDivide() {
    const { pickTeamCount, pickSize, divided, locked } = this.data
    if (locked) {
      wx.showToast({ title: '已有比分或进球，不能重分', icon: 'none' })
      return
    }
    const run = () => {
      call('assignTeams', {
        activityId: this.data.id,
        teamCount: pickTeamCount,
        targetPerTeam: pickSize
      }).then((res) => {
        const extra = res.leftoverCount ? `，${res.leftoverCount} 人留在未分队` : ''
        const fixtures = res.fixtureCount ? `，已生成 ${res.fixtureCount} 场对阵` : ''
        wx.showToast({ title: `已分成 ${res.teamCount} 队${extra}${fixtures}`.slice(0, 30), icon: 'none' })
        this.setData({ showDivide: false })
        this.load()
      })
    }
    if (divided) {
      wx.showModal({
        title: '重新分队',
        content: pickTeamCount >= 4
          ? '会按新的队数重新分人，并对战场次也会重排。还没有比分时才能这样做。'
          : '会按新的队数重新分人；2 队或 3 队不会生成对战场次。',
        success: (res) => { if (res.confirm) run() }
      })
      return
    }
    run()
  },
  selectPlayer(event) {
    if (!this.data.isAdmin || this.data.locked) return
    const openid = event.currentTarget.dataset.openid
    const name = event.currentTarget.dataset.name
    if (this.data.selectedOpenid === openid) {
      this.setData({ selectedOpenid: '', selectedName: '' })
      return
    }
    this.setData({ selectedOpenid: openid, selectedName: name })
    wx.showToast({ title: '再点目标队名换过去', icon: 'none' })
  },
  moveToTeam(event) {
    if (!this.data.isAdmin || this.data.locked) return
    const teamId = event.currentTarget.dataset.id
    const openid = this.data.selectedOpenid
    if (!openid) {
      wx.showToast({ title: '先点要换队的人', icon: 'none' })
      return
    }
    call('adminMoveSignup', {
      activityId: this.data.id,
      targetOpenid: openid,
      teamId
    }).then(() => {
      this.setData({ selectedOpenid: '', selectedName: '' })
      this.load()
    })
  },
  editTeam(event) {
    if (!this.data.isAdmin) return
    const teamId = event.currentTarget.dataset.id
    const team = (this.data.teamCards || []).find((item) => item.id === teamId)
    if (!team) return
    wx.showModal({
      title: '改队名',
      editable: true,
      placeholderText: team.name,
      content: team.name,
      success: (res) => {
        if (!res.confirm) return
        const name = String(res.content || '').trim()
        if (!name || name === team.name) return
        call('setSessionColor', {
          activityId: this.data.id,
          teamId,
          name
        }).then(() => this.load())
      }
    })
  },
  onScoreInput(event) {
    const id = event.currentTarget.dataset.id
    const side = event.currentTarget.dataset.side
    this.setData({ [`scoreDraft.${id}.${side}`]: event.detail.value })
  },
  saveScore(event) {
    const id = event.currentTarget.dataset.id
    const draft = this.data.scoreDraft[id] || {}
    call('saveFixtureScore', {
      roundId: id,
      scoreA: Number(draft.a),
      scoreB: Number(draft.b)
    }).then(() => {
      wx.showToast({ title: '已记分' })
      this.load()
    })
  },
  swapPitch(event) {
    call('updateFixture', {
      activityId: this.data.id,
      swapRoundNo: Number(event.currentTarget.dataset.round)
    }).then(() => this.load())
  },
  addGoal(event) {
    const openid = event.currentTarget.dataset.openid
    const own = !!event.currentTarget.dataset.own
    const payload = {
      activityId: this.data.id,
      scorerOpenid: openid,
      isOwnGoal: own
    }
    if (this.data.rounds.length) {
      const open = this.data.rounds.find((round) => round.scoreA == null) || this.data.rounds[0]
      payload.roundId = open._id
    }
    call('addGoalEvent', payload).then(() => {
      wx.showToast({ title: own ? '已记乌龙' : '已记进球' })
      this.load()
    })
  }
})
