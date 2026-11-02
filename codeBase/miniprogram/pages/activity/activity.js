const {
  call,
  callQuiet,
  formatTime,
  teamName,
  sortTeamsByMine,
  sortQuotasByMine,
  uploadAvatar,
  avatarChar,
  avatarColor
} = require('../../utils/api')
const {
  buildDefaultTacticsState,
  reconcileSavedBoard,
  applyPitchDrag,
  renderTacticsPoster
} = require('../../utils/tactics')
const {
  syncFilterFromActivity,
  activityPageForClub,
  joinedClubs,
  normalizeClubs,
  setMultiClubReady
} = require('../../utils/club-context')

/** 与球员页相同：这两个昵称是队长，报名名单里固定置顶。 */
const CAPTAIN_NAMES = new Set(['jzy', '肉粽'])

function isRosterCaptain(player) {
  return CAPTAIN_NAMES.has(String((player && player.userName) || '').trim().toLowerCase())
}

function compareRosterPlayers(a, b) {
  const byCaptain = (isRosterCaptain(a) ? 0 : 1) - (isRosterCaptain(b) ? 0 : 1)
  if (byCaptain !== 0) return byCaptain
  return (a.createdAt || 0) - (b.createdAt || 0)
}

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function openWaitHours(startTime, now) {
  const start = Number(startTime)
  if (!Number.isFinite(start)) return []
  const hour = 60 * 60 * 1000
  const list = []
  for (let value = 24; value >= 1; value -= 1) {
    if (start - value * hour > now) list.push(value)
  }
  if (start > now) list.push(0)
  return list
}

function pigeonRuleText(startTime) {
  const start = Number(startTime)
  if (!Number.isFinite(start) || start <= 0) {
    return '开赛前 4 小时之前取消报名，无责；之后取消，记一次鸽子。'
  }
  const date = new Date(start - 4 * 60 * 60 * 1000)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  const when = `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${when} 之前取消报名，无责；之后取消，记一次鸽子。`
}

Page({
  data: {
    id: '',
    activity: null,
    teams: [],
    quotas: [],
    signups: [],
    rounds: [],
    roster: [],
    records: [],
    members: [],
    signedMembers: [],
    pickMembers: [],
    memberTeam: 'all',
    counts: Array.from({ length: 30 }, (_, index) => `${index + 1}`),
    statOptions: Array.from({ length: 21 }, (_, index) => `${index}`),
    pigeonOptions: ['正常', '鸽子'],
    me: null,
    closed: false,
    pickIndex: 0,
    selectedOpenid: '',
    pickedLabel: '选择队员',
    goalIndex: 0,
    assistIndex: 0,
    pigeonIndex: 0,
    savingStat: false,
    scoreLeft: 0,
    scoreRight: 0,
    mineIsJiong: true,
    roundVsText: '',
    showSharePrompt: false,
    showRegister: false,
    showPledge: false,
    showSplitChoice: false,
    showWaitHours: false,
    waitHourOptions: [],
    waitHourSelected: null,
    waitHourInto: '',
    pledgeKind: 'play',
    pledgeChoice: 'home',
    pledgeStep: 'remind',
    pledgeButtonText: '同意并报名',
    pledgeTitle: '报名须知',
    pledgeHint: '',
    pledgeLines: [],
    pledgeAuthStep: 'remind',
    pigeonRuleText: '',
    pigeons: [],
    myPigeon: false,
    cancelWillPigeon: false,
    regAvatarUrl: '',
    regName: '',
    regTeamId: '',
    regSaving: false,
    loadFailed: false,
    tacticsList: [],
    tacticsTeamId: '',
    tacticsTeamName: '',
    tacticsBoard: buildDefaultTacticsState([], { emptyText: '待报名' }),
    tacticsRemovedNotice: '',
    canEditTactics: false,
    activityBoards: {},
    savingTacticsBoard: false,
    exportingTactics: false,
    tacticsDraggingUserId: '',
    tacticsDraggingSource: '',
    tacticsDragPreviewActive: false,
    tacticsDragPreviewLeft: 50,
    tacticsDragPreviewTop: 50,
    tacticsDragPlayer: null,
    draggingId: '',
    dragHoverTeam: '',
    dragHoverOpenid: '',
    dragGhostName: '',
    dragHint: ''
  },
  onLoad(query) {
    this.pendingScrollToTactics = query.scrollTo === 'tactics'
    this.setData({ id: query.id })
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onUnload() {
    this.clearTacticsHoldTimer()
  },
  clearTacticsHoldTimer() {
    if (this.tacticsHoldTimer) {
      clearTimeout(this.tacticsHoldTimer)
      this.tacticsHoldTimer = null
    }
  },
  onShow() {
    if (this.data.id) this.load()
  },
  onShareAppMessage() {
    const activity = this.data.activity
    const page = activityPageForClub(activity && activity.clubId)
    if (!activity) {
      return {
        title: '周三快乐足球联队',
        path: `/pages/${page}/${page}?id=${this.data.id}`
      }
    }
    const left = (this.data.quotas || []).reduce((sum, quota) => sum + Math.max(0, (quota.maxSignups || 0) - (quota.signed || 0)), 0)
    const waitCount = (this.data.waitlist || []).length
    const date = new Date(activity.startTime)
    const weeks = ['日', '一', '二', '三', '四', '五', '六']
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
    const when = `${date.getMonth() + 1}.${date.getDate()} 周${weeks[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    const cap = this.data.joint ? 6 : Math.max(1, (this.data.quotas || []).filter((item) => item.teamId !== 'team_unite').length) * 3
    const gap = left > 0 ? `还差 ${left} 人，速来！` : (waitCount < cap ? '正选已满，可排后补' : '已满员，可先围观')
    return {
      title: `${activity.title}｜${when} ${activity.location}，${gap}`,
      path: `/pages/${page}/${page}?id=${this.data.id}`
    }
  },
  syncClubFilter(activity) {
    const clubId = (activity && activity.clubId) || 'club_wednesday'
    callQuiet('orgMe').then((org) => {
      setMultiClubReady(true)
      const clubs = normalizeClubs((org && org.clubs) || [], null, null)
      syncFilterFromActivity(clubId, clubs)
    }).catch(() => {
      callQuiet('me').then((me) => {
        const clubs = normalizeClubs([], me.user, me.teams)
        if (joinedClubs(clubs).some((club) => club._id === clubId) || clubId === 'club_wednesday') {
          syncFilterFromActivity(clubId, clubs)
        }
      }).catch(() => {})
    })
  },
  load() {
    call('activityDetail', { activityId: this.data.id }).then((res) => {
      this.syncClubFilter(res.activity)
      if (res.activity && res.activity.clubId === 'club_jielong') {
        wx.redirectTo({ url: `/pages/session/session?id=${this.data.id}` })
        return
      }
      const me = res.me
      const myTeamId = (me && me.teamId) || 'team_jiong'
      const teams = sortTeamsByMine(res.teams || [], myTeamId)
      const contributionMap = {}
      ;(res.contributions || []).forEach((item) => {
        contributionMap[item.playerOpenid] = item
      })
      this.contributionMap = contributionMap
      const joint = res.activity.signupMode === 'joint'
      const players = (res.signups || []).filter((signup) => signup.status !== 'waitlist').map((signup) => {
        const stat = contributionMap[signup._openid] || { goals: 0, assists: 0 }
        const team = teamName(teams, signup.teamId)
        const userName = signup.userName || ''
        return {
          ...signup,
          userName,
          teamName: team,
          label: `${userName} · ${team}`,
          shortName: this.shortDisplayName(userName, joint ? 4 : 8),
          goals: stat.goals || 0,
          assists: stat.assists || 0,
          absent: !!stat.absent,
          avatarChar: avatarChar(userName),
          avatarBg: avatarColor(userName)
        }
      })
      const quotas = sortQuotasByMine((res.quotas || []).map((quota) => ({
        ...quota,
        teamName: teamName(teams, quota.teamId),
        full: quota.signed >= quota.maxSignups,
        countIndex: Math.max(0, Math.min(29, (quota.maxSignups || 11) - 1))
      })), myTeamId)
      const roster = teams.map((team) => {
        const quota = quotas.find((item) => item.teamId === team._id)
        return {
          teamId: team._id,
          teamName: team.name,
          signed: quota ? quota.signed : 0,
          maxSignups: quota ? quota.maxSignups : 0,
          full: quota ? quota.full : false,
          countIndex: quota ? quota.countIndex : 11,
          players: players
            .filter((item) => item.teamId === team._id)
            .sort(compareRosterPlayers),
          waiters: (res.signups || [])
            .filter((item) => item.status === 'waitlist' && item.teamId === team._id)
            .sort((a, b) => (a.waitlistOrder || 0) - (b.waitlistOrder || 0))
            .map((item, index) => this.decorateWaiter(item, index, 5))
        }
      })
      const signedMembers = players.map((player) => ({
        _openid: player._openid,
        name: player.userName,
        teamId: player.teamId,
        label: `${player.userName} · ${player.teamName}`
      }))
      const memberTeam = this.data.memberTeam || 'all'
      const pickMembers = memberTeam === 'all'
        ? signedMembers
        : signedMembers.filter((item) => item.teamId === memberTeam)
      const records = (res.contributions || []).map((item) => {
        const goals = item.goals || 0
        const assists = item.assists || 0
        return {
          ...item,
          goals,
          assists,
          absent: !!item.absent,
          goalIndex: Math.max(0, Math.min(20, goals)),
          assistIndex: Math.max(0, Math.min(20, assists)),
          pigeonIndex: item.absent ? 1 : 0,
          absentBy: item.absentBy || 'admin',
          editable: !!players.find((player) => player._openid === item.playerOpenid) && item.absentBy !== 'system',
          teamName: teamName(teams, item.teamId),
          avatarChar: avatarChar(item.userName),
          avatarBg: avatarColor(item.userName)
        }
      })
      const mySignup = me
        ? (res.signups || []).find((item) => item._openid === me._openid)
        : null
      const signed = !!(mySignup && mySignup.status !== 'waitlist')
      const waiting = !!(mySignup && mySignup.status === 'waitlist')
      const otherTeam = teams.find((team) => team._id !== myTeamId && team._id !== 'team_unite') || null
      const myQuota = quotas.find((item) => item.teamId === myTeamId)
      const otherQuota = otherTeam
        ? quotas.find((item) => item.teamId === otherTeam._id)
        : null
      const myTeamFull = !!(myQuota && myQuota.full)
      const otherTeamFull = !!(otherQuota && otherQuota.full)
      const signupButtonText = (!joint && myTeamFull)
        ? '⚽️ 报名'
        : `⚽️ 立即报名 · ${teamName(teams, myTeamId)}`
      const picked = pickMembers.find((item) => item._openid === this.data.selectedOpenid)
      const stat = picked ? (contributionMap[picked._openid] || {}) : {}
      const keepForm = !!(picked && this.data.selectedOpenid === picked._openid)
      const mineIsJiong = myTeamId === 'team_jiong'
      const roundVsText = teams.length >= 2
        ? `${teams[0].name} vs ${teams[1].name}`
        : ''
      const rounds = (res.rounds || []).map((round) => ({
        ...round,
        scoreLeft: mineIsJiong ? round.scoreJiong : round.scorePudong,
        scoreRight: mineIsJiong ? round.scorePudong : round.scoreJiong
      }))
      const activityBoards = res.activityBoards || {}
      // 每次 load 重算各组板：报名/取消后立刻刷新；已保存走校准，未保存按该组正选出勤前 8
      const tacticsList = teams.map((team) => {
        const computed = this.computeGroupTacticsBoard(players, activityBoards, team._id)
        return {
          teamId: team._id,
          teamName: team.name,
          board: computed.board,
          removedNotice: computed.removedNotice || ''
        }
      })
      const preferredTeamId = this.data.tacticsTeamId
        || (mySignup && mySignup.teamId)
        || myTeamId
      const currentView = this.currentTacticsView(tacticsList, preferredTeamId)
      this.setData({
        activity: { ...res.activity, timeText: formatTime(res.activity.startTime) },
        teams,
        quotas,
        signups: res.signups || [],
        activityBoards,
        tacticsList,
        ...currentView,
        canEditTactics: signed,
        rounds,
        mineIsJiong,
        roundVsText,
        roster: joint
          ? this.orderJointRoster(roster, myTeamId)
          : roster,
        records,
        members: pickMembers,
        signedMembers,
        pickMembers,
        memberFilters: [{ id: 'all', name: '全部' }].concat(teams.map((team) => ({
          id: team._id,
          name: team.name
        }))),
        me,
        signed,
        waiting,
        joint,
        quotaLocked: joint,
        waitlist: (res.signups || [])
          .filter((item) => item.status === 'waitlist')
          .sort((a, b) => (a.waitlistOrder || 0) - (b.waitlistOrder || 0))
          .map((item, index) => this.decorateWaiter(item, index, 8)),
        subscribeTemplates: res.subscribeTemplates || {},
        closed: res.activity.startTime <= Date.now(),
        pigeons: (res.pigeons || []).map((item) => ({
          ...item,
          avatarChar: avatarChar(item.userName),
          avatarBg: avatarColor(item.userName)
        })),
        myPigeon: !!(me && !signed && !waiting && (res.pigeons || []).some((item) => item.playerOpenid === me._openid)),
        cancelWillPigeon: !!res.cancelWillPigeon,
        pigeonRuleText: pigeonRuleText(res.activity.startTime),
        showSharePrompt: false,
        pickIndex: keepForm ? this.data.pickIndex : (picked ? pickMembers.indexOf(picked) : 0),
        pickedLabel: keepForm ? this.data.pickedLabel : (picked ? picked.label : '选择队员'),
        goalIndex: keepForm ? this.data.goalIndex : (picked ? (stat.goals || 0) : 0),
        assistIndex: keepForm ? this.data.assistIndex : (picked ? (stat.assists || 0) : 0),
        pigeonIndex: keepForm ? this.data.pigeonIndex : (picked && stat.absent ? 1 : 0),
        myTeamName: me ? teamName(teams, me.teamId) : '',
        signedTeamName: mySignup
          ? teamName(teams, mySignup.teamId)
          : (me ? teamName(teams, me.teamId) : ''),
        otherTeamId: otherTeam ? otherTeam._id : '',
        otherTeamName: otherTeam ? otherTeam.name : '',
        signupButtonText,
        waitBanner: waiting ? this.waitBanner(mySignup, (res.signups || []).filter((item) => item.status === 'waitlist'), me) : '',
        placeNote: this.placeNote(res.activity.signupMode, mySignup, me, teams, quotas),
        waitChoices: res.waitChoices || [],
        loadFailed: false
      }, () => {
        if (this.pendingScrollToTactics) {
          this.pendingScrollToTactics = false
          wx.pageScrollTo({ selector: '#tactics-card', duration: 300 })
        }
      })
    }).catch((error) => {
      if (error && error.message && error.message.indexOf('不存在') !== -1) {
        this.setData({ loadFailed: true, activity: null })
      }
    })
  },
  noop() {},
  waitBanner(signup, waitlist, me) {
    const order = waitlist.findIndex((item) => me && item._openid === me._openid) + 1
    const when = signup && signup.waitUntil ? formatTime(signup.waitUntil) : ''
    return `⏳ 后补第 ${order} 位 · ${when} 前没补上会退出`
  },
  placeNote(mode, signup, me, teams, quotas) {
    if (mode !== 'joint' || !signup || signup.status === 'waitlist' || !me) return ''
    if (!signup.teamId || signup.teamId === me.teamId) return ''
    const how = me.isAdmin
      ? '长按名字可换到有空的队，拖到队员身上可以对调。'
      : '有空位可以长按自己的名字换组。要和对面对调，找管理员。'
    const fullOf = (teamId) => {
      const quota = (quotas || []).find((item) => item.teamId === teamId)
      return !!(quota && quota.full)
    }
    const homeFull = fullOf(me.teamId)
    const uniteFull = fullOf('team_unite')
    if (signup.teamId === 'team_unite') {
      return `${homeFull ? '本队已满，你在联队。' : '你在联队。'}${how}`
    }
    const where = teamName(teams || [], signup.teamId)
    if (homeFull && uniteFull) return `本队和联队已满，你先在 ${where}。${how}`
    return `你在 ${where}。${how}`
  },
  signup() {
    const joint = this.data.joint
    const myId = this.data.me && this.data.me.teamId
    const otherId = this.data.otherTeamId
    const quotaOf = (teamId) => (this.data.quotas || []).find((item) => item.teamId === teamId)
    const waitersOf = (teamId) => ((this.data.roster || []).find((item) => item.teamId === teamId) || {}).waiters || []
    const myQuota = quotaOf(myId)
    const otherQuota = quotaOf(otherId)
    const myFull = !!(myQuota && myQuota.full)
    const otherFull = !!(otherQuota && otherQuota.full)
    if (!joint && myFull && otherFull && waitersOf(myId).length >= 3) {
      wx.showToast({ title: '两队都满了，暂时报不上', icon: 'none' })
      return
    }
    const groups = this.data.quotas || []
    const jointFull = joint && groups.length > 0 && groups.every((item) => item.full)
    this._subFlags = {}
    if (!joint && myFull) {
      this.offerSplitChoice()
      return
    }
    this.pledgeThenSignup('home', jointFull ? 'wait' : 'play')
  },
  offerSplitChoice() {
    this.setData({ showSplitChoice: true })
  },
  chooseSplit(event) {
    const choice = event.currentTarget.dataset.choice
    this.setData({ showSplitChoice: false })
    if (choice === 'other') {
      const otherQuota = (this.data.quotas || []).find((item) => item.teamId === this.data.otherTeamId)
      if (otherQuota && otherQuota.full) {
        wx.showToast({ title: '对面已满，不能报名', icon: 'none' })
        return
      }
      this.pledgeThenSignup('other', 'play')
      return
    }
    if (choice === 'waitlist') this.pledgeThenSignup('waitlist', 'wait')
  },
  pledgeThenSignup(choice, kind) {
    const waiting = kind === 'wait'
    const ownTeam = choice === 'waitlist'
    this.setData({
      showPledge: true,
      pledgeChoice: choice,
      pledgeKind: kind,
      pledgeStep: waiting ? 'both' : 'remind',
      pledgeTitle: waiting ? (ownTeam ? '后补本队' : '后补') : '报名须知',
      pledgeHint: waiting ? '' : '开赛前 2 小时会提醒你这场球。',
      pledgeLines: waiting
        ? ['有人退出，自动补上并发消息', '开赛前 4 小时前取消，不记鸽子']
        : [],
      pledgeButtonText: waiting ? '同意并后补' : '同意并报名',
      pigeonRuleText: pigeonRuleText(this.data.activity && this.data.activity.startTime)
    })
  },
  dismissPledge() {
    this.setData({ showPledge: false })
  },
  confirmPledge() {
    const kind = this.data.pledgeKind
    const waiting = kind === 'wait'
    const choice = this.data.pledgeChoice
    const templates = this.data.subscribeTemplates || {}
    const flags = this._subFlags || {}
    this._subFlags = flags
    const remindId = String(templates.remind || '').trim()
    const promoteId = String(templates.promote || '').trim()
    // 后补一次申请两个模板；正选只申请开赛提醒。须在用户点击回调里同步调用。
    const tmplIds = waiting
      ? [promoteId, remindId].filter(Boolean)
      : (remindId ? [remindId] : [])
    const finish = () => {
      this.setData({ showPledge: false })
      if (kind === 'wait') this.pickWaitHours((hours) => this.doSignup(choice, hours))
      else this.doSignup(choice)
    }
    if (!tmplIds.length || !wx.requestSubscribeMessage) {
      if (!tmplIds.length) wx.showToast({ title: '通知还没配好', icon: 'none' })
      finish()
      return
    }
    wx.requestSubscribeMessage({
      tmplIds,
      success: (result) => {
        if (promoteId && result && result[promoteId] === 'accept') flags.promoteAccepted = true
        if (remindId && result && result[remindId] === 'accept') flags.remindAccepted = true
      },
      fail: (error) => {
        const msg = String((error && error.errMsg) || '')
        if (msg.indexOf('cancel') !== -1 || msg.indexOf('取消') !== -1) return
        wx.showToast({
          title: msg.indexOf('template') !== -1 || msg.indexOf('模板') !== -1
            ? '订阅模板无效，请检查后台配置'
            : '没有弹出授权，请再点一次',
          icon: 'none'
        })
      },
      complete: (result) => {
        const err = (result && result.errMsg) || ''
        if (err.indexOf('fail') !== -1 && err.indexOf('cancel') === -1 && err.indexOf('取消') === -1) return
        finish()
      }
    })
  },
  doSignup(choice, waitHours) {
    const flags = this._subFlags || {}
    const payload = Object.assign({ activityId: this.data.id, choice }, flags)
    if (waitHours != null) payload.waitHours = waitHours
    call('signup', payload).then(() => this.load())
  },
  pickWaitHours(done) {
    const hours = openWaitHours(this.data.activity && this.data.activity.startTime, Date.now())
    if (!hours.length) {
      wx.showToast({ title: '后补时间已经过了', icon: 'none' })
      return
    }
    const selected = hours.indexOf(4) === -1 ? null : 4
    this._waitHourDone = done
    this.setData({
      showWaitHours: true,
      waitHourSelected: selected,
      waitHourInto: selected == null ? '' : `wait-hour-${selected}`,
      waitHourOptions: hours.map((hour) => ({
        hours: hour,
        label: hour === 0 ? '开赛最后一刻' : `开赛前 ${hour} 小时`
      }))
    })
  },
  onSelectWaitHour(event) {
    const hours = Number(event.currentTarget.dataset.hours)
    this.setData({ waitHourSelected: hours, waitHourInto: `wait-hour-${hours}` })
  },
  confirmWaitHour() {
    if (this.data.waitHourSelected == null) {
      wx.showToast({ title: '请选择后补时间', icon: 'none' })
      return
    }
    const hours = this.data.waitHourSelected
    const done = this._waitHourDone
    this._waitHourDone = null
    this.setData({ showWaitHours: false })
    if (done) done(hours)
  },
  closeWaitHours() {
    this._waitHourDone = null
    this.setData({ showWaitHours: false })
  },
  changeWait() {
    this.pickWaitHours((hours) => {
      call('setWaitUntil', { activityId: this.data.id, waitHours: hours }).then(() => this.load())
    })
  },
  decorateWaiter(item, index, nameLimit) {
    const userName = item.userName || ''
    return {
      ...item,
      order: index + 1,
      userName,
      shortName: this.shortDisplayName(userName, nameLimit),
      avatarChar: avatarChar(userName),
      avatarBg: avatarColor(userName)
    }
  },
  shortDisplayName(name, maxChars) {
    const text = String(name || '').trim()
    const limit = maxChars || 6
    if (text.length <= limit) return text || '未命名'
    return `${text.slice(0, limit)}…`
  },
  orderJointRoster(roster, myTeamId) {
    const rank = (teamId) => {
      if (teamId === myTeamId) return 0
      if (teamId === 'team_unite') return 2
      return 1
    }
    return (roster || []).slice().sort((a, b) => rank(a.teamId) - rank(b.teamId))
  },
  canDragRosterPlayer(openid) {
    if (!this.data.joint || this.data.closed || !openid) return false
    const mine = this.data.me && this.data.me._openid
    return openid === mine || !!(this.data.me && this.data.me.isAdmin)
  },
  measureRosterCols(done) {
    const query = wx.createSelectorQuery()
    query.selectAll('.roster-col').fields({ rect: true, dataset: true })
    query.selectAll('.roster .player').fields({ rect: true, dataset: true })
    query.exec((res) => {
      this._rosterRects = (res && res[0]) || []
      this._playerRects = (res && res[1]) || []
      if (typeof done === 'function') done()
    })
  },
  hitAtPoint(rects, clientX, clientY) {
    return (rects || []).find((rect) => (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    )) || null
  },
  teamAtPoint(clientX, clientY) {
    const hit = this.hitAtPoint(this._rosterRects, clientX, clientY)
    return (hit && hit.dataset && hit.dataset.team) || ''
  },
  playerAtPoint(clientX, clientY) {
    const hit = this.hitAtPoint(this._playerRects, clientX, clientY)
    const dataset = (hit && hit.dataset) || {}
    if (!dataset.openid) return null
    return {
      openid: dataset.openid,
      team: dataset.team || '',
      name: dataset.name || '队员'
    }
  },
  clearRosterDrag() {
    this._rosterDragActive = false
    this.setData({
      draggingId: '',
      dragHoverTeam: '',
      dragHoverOpenid: '',
      dragGhostName: '',
      dragHint: ''
    })
  },
  resolveDragHover(clientX, clientY) {
    const selfId = this.data.draggingId
    const isAdmin = !!(this.data.me && this.data.me.isAdmin)
    const player = this.playerAtPoint(clientX, clientY)
    let hoverOpenid = ''
    let teamId = ''
    if (isAdmin && player && player.openid && player.openid !== selfId) {
      hoverOpenid = player.openid
      teamId = player.team
    } else {
      teamId = (player && player.team) || this.teamAtPoint(clientX, clientY) || ''
    }
    const ghost = this.data.dragGhostName
    let dragHint = `拖到目标队后松手 · ${ghost}`
    if (hoverOpenid) {
      dragHint = `松手对调 · ${ghost} ↔ ${player.name}`
    } else if (teamId) {
      const team = (this.data.teams || []).find((item) => item._id === teamId)
      dragHint = `松手放入 · ${(team && team.name) || '该队'}`
    }
    return { hoverOpenid, teamId, dragHint }
  },
  updateDragHover(clientX, clientY) {
    const next = this.resolveDragHover(clientX, clientY)
    if (next.hoverOpenid === this.data.dragHoverOpenid
      && next.teamId === this.data.dragHoverTeam
      && next.dragHint === this.data.dragHint) return next
    this.setData({
      dragHoverOpenid: next.hoverOpenid,
      dragHoverTeam: next.teamId,
      dragHint: next.dragHint
    })
    return next
  },
  onDragStart(event) {
    if (!this.data.joint || this.data.closed) return
    const openid = event.currentTarget.dataset.openid
    if (!this.canDragRosterPlayer(openid)) return
    let player = null
    ;(this.data.roster || []).some((col) => {
      player = (col.players || []).find((item) => item._openid === openid)
      return !!player
    })
    const ghostName = (player && (player.shortName || player.userName)) || '队员'
    this._ignoreRosterTap = true
    this._rosterDragActive = true
    this.measureRosterCols()
    this.setData({
      draggingId: openid,
      dragHoverTeam: '',
      dragHoverOpenid: '',
      dragGhostName: ghostName,
      dragHint: `拖到目标队后松手 · ${ghostName}`
    })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },
  onRosterTouchMove(event) {
    if (!this._rosterDragActive || !this.data.draggingId) return
    const touch = event.touches && event.touches[0]
    if (!touch) return
    this.updateDragHover(touch.clientX, touch.clientY)
  },
  onRosterTouchEnd(event) {
    if (!this._rosterDragActive) return
    const openid = this.data.draggingId
    const touch = (event.changedTouches && event.changedTouches[0]) || null
    const hover = touch
      ? this.resolveDragHover(touch.clientX, touch.clientY)
      : { hoverOpenid: this.data.dragHoverOpenid, teamId: this.data.dragHoverTeam }
    const isAdmin = !!(this.data.me && this.data.me.isAdmin)
    const hoverOpenid = hover.hoverOpenid
    const teamId = hover.teamId
    this.clearRosterDrag()
    if (!openid) return
    if (isAdmin && hoverOpenid && hoverOpenid !== openid) {
      this.confirmSwap(openid, hoverOpenid)
      return
    }
    if (!teamId) return
    const current = (this.data.signups || []).find((item) => item._openid === openid && item.status === 'signed')
    if (current && current.teamId === teamId) return
    const col = (this.data.roster || []).find((item) => item.teamId === teamId)
    if (col && col.full) {
      wx.showToast({ title: '该组已满', icon: 'none' })
      return
    }
    this.commitMove(openid, teamId)
  },
  onDropTeam(event) {
    // 兼容：长按松手后，再点目标列完成换队
    if (this._ignoreRosterTap) {
      this._ignoreRosterTap = false
      return
    }
    const openid = this.data.draggingId
    const teamId = event.currentTarget.dataset.team
    if (!openid || !teamId || this._rosterDragActive) return
    const current = (this.data.signups || []).find((item) => item._openid === openid && item.status === 'signed')
    this.clearRosterDrag()
    if (current && current.teamId === teamId) return
    const col = (this.data.roster || []).find((item) => item.teamId === teamId)
    if (col && col.full) {
      wx.showToast({ title: '该组已满', icon: 'none' })
      return
    }
    this.commitMove(openid, teamId)
  },
  onMovePlayer(event) {
    if (this._ignoreRosterTap) {
      this._ignoreRosterTap = false
      return
    }
    if (this.data.draggingId || this._rosterDragActive) return
    const openid = event.currentTarget.dataset.openid
    if (!this.canDragRosterPlayer(openid)) return
    this.changeGroupFor(openid)
  },
  changeGroup() {
    this.changeGroupFor(this.data.me && this.data.me._openid)
  },
  changeGroupFor(openid) {
    if (!openid || !this.data.joint || this.data.closed) return
    const current = (this.data.signups || []).find((item) => item._openid === openid && item.status === 'signed')
    if (!current) {
      wx.showToast({ title: '你还没有报名', icon: 'none' })
      return
    }
    // 换队只列另外两支，已满的仍显示但点选时提示
    const options = (this.data.teams || []).filter((team) => team._id !== current.teamId)
    if (!options.length) {
      wx.showToast({ title: '没有可换的队', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: options.map((team) => {
        const quota = (this.data.quotas || []).find((item) => item.teamId === team._id)
        const full = !!(quota && quota.full)
        return full ? `${team.name}（已满）` : team.name
      }),
      success: (res) => {
        const team = options[res.tapIndex]
        if (!team) return
        const quota = (this.data.quotas || []).find((item) => item.teamId === team._id)
        if (quota && quota.full) {
          wx.showToast({ title: '该组已满', icon: 'none' })
          return
        }
        this.commitMove(openid, team._id)
      }
    })
  },
  relocatePlayer(openid, teamId, source) {
    const data = source || this.data
    const roster = (data.roster || []).map((col) => ({
      ...col,
      players: (col.players || []).slice()
    }))
    let player = null
    roster.forEach((col) => {
      const index = col.players.findIndex((item) => item._openid === openid)
      if (index >= 0) player = col.players.splice(index, 1)[0]
    })
    const target = roster.find((col) => col.teamId === teamId)
    if (!player || !target) return null
    const team = (data.teams || []).find((item) => item._id === teamId)
    target.players.push({
      ...player,
      teamId,
      teamName: (team && team.name) || player.teamName
    })
    target.players.sort(compareRosterPlayers)
    const quotas = (data.quotas || []).map((quota) => {
      const col = roster.find((item) => item.teamId === quota.teamId)
      if (!col) return quota
      const signed = col.players.length
      return {
        ...quota,
        signed,
        full: signed >= quota.maxSignups
      }
    })
    roster.forEach((col) => {
      const quota = quotas.find((item) => item.teamId === col.teamId)
      if (!quota) return
      col.signed = quota.signed
      col.full = quota.full
    })
    const signups = (data.signups || []).map((item) => (
      item._openid === openid && item.status !== 'waitlist' ? { ...item, teamId } : item
    ))
    return { roster, quotas, signups, teams: data.teams }
  },
  rosterPlayer(openid, source) {
    const data = source || this.data
    let found = null
    ;(data.roster || []).some((col) => {
      found = (col.players || []).find((item) => item._openid === openid) || null
      return !!found
    })
    return found
  },
  confirmSwap(openidA, openidB) {
    const a = this.rosterPlayer(openidA)
    const b = this.rosterPlayer(openidB)
    if (!a || !b || a.teamId === b.teamId) return
    const nameA = a.shortName || a.userName || '队员'
    const nameB = b.shortName || b.userName || '队员'
    const teamName = (teamId) => {
      const team = (this.data.teams || []).find((item) => item._id === teamId)
      return (team && team.name) || '该队'
    }
    wx.showModal({
      title: '对调',
      content: `把${nameA}换到${teamName(b.teamId)}，${nameB}换到${teamName(a.teamId)}？`,
      confirmText: '对调',
      cancelText: '取消',
      confirmColor: '#0f3d2e',
      success: (res) => {
        if (res.confirm) this.commitSwap(openidA, openidB)
      }
    })
  },
  commitSwap(openidA, openidB) {
    const a = this.rosterPlayer(openidA)
    const b = this.rosterPlayer(openidB)
    if (!a || !b || a.teamId === b.teamId) return
    const first = this.relocatePlayer(openidA, b.teamId)
    if (!first) return
    const next = this.relocatePlayer(openidB, a.teamId, first)
    if (!next) return
    const prev = {
      roster: this.data.roster,
      quotas: this.data.quotas,
      signups: this.data.signups
    }
    this.setData({
      roster: next.roster,
      quotas: next.quotas,
      signups: next.signups
    })
    callQuiet('swapSignups', {
      activityId: this.data.id,
      openidA,
      openidB
    }).then(() => {
      this.load()
    }).catch(() => {
      this.setData(prev)
      wx.showToast({ title: '对调失败', icon: 'none' })
    })
  },
  commitMove(openid, teamId) {
    const next = this.relocatePlayer(openid, teamId)
    if (!next) return
    const prev = {
      roster: this.data.roster,
      quotas: this.data.quotas,
      signups: this.data.signups
    }
    this.setData(next)
    callQuiet('moveSignup', {
      activityId: this.data.id,
      teamId,
      targetOpenid: openid
    }).then(() => {
      this.load()
    }).catch(() => {
      this.setData(prev)
      wx.showToast({ title: '换位失败', icon: 'none' })
    })
  },
  cancel() {
    if (this.data.waiting) {
      wx.showModal({
        title: '取消后补',
        content: '现在取消后补，无责。',
        confirmText: '取消后补',
        cancelText: '再想想',
        confirmColor: '#8c3a2f',
        success: (res) => {
          if (!res.confirm) return
          call('cancelSignup', { activityId: this.data.id }).then(() => this.load())
        }
      })
      return
    }
    const late = this.data.cancelWillPigeon
    wx.showModal({
      title: '取消报名',
      content: late
        ? '现在取消会记一次鸽子。开赛前重新报名，这次鸽子会去掉。'
        : '现在取消无责。',
      confirmText: '取消报名',
      cancelText: '再想想',
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('cancelSignup', { activityId: this.data.id }).then(() => this.load())
      }
    })
  },
  openRegister() {
    this.setData({
      showRegister: true,
      regAvatarUrl: '',
      regName: '',
      regTeamId: this.data.regTeamId || (this.data.teams[0] && this.data.teams[0]._id) || ''
    })
  },
  closeRegister() {
    this.setData({ showRegister: false })
  },
  onChooseAvatar(event) {
    this.setData({ regAvatarUrl: event.detail.avatarUrl })
  },
  onRegName(event) {
    this.setData({ regName: event.detail.value })
  },
  onRegTeam(event) {
    this.setData({ regTeamId: event.currentTarget.dataset.team })
  },
  submitRegister() {
    if (this.data.regSaving) return
    const name = this.data.regName.trim()
    if (!name) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (!this.data.regTeamId) {
      wx.showToast({ title: '请选择球队', icon: 'none' })
      return
    }
    this._subFlags = {}
    const flags = this._subFlags
    const templates = this.data.subscribeTemplates || {}
    const remindId = String(templates.remind || '').trim()
    const continueRegister = () => {
      this.setData({ regSaving: true })
      const tempAvatar = this.data.regAvatarUrl
      const openid = this.data.me && this.data.me._openid
      const saveAndSignup = (avatarUrl) => call('saveProfile', {
        name,
        teamId: this.data.regTeamId,
        avatarUrl
      }).then(() => call('signup', {
        activityId: this.data.id,
        remindAccepted: !!flags.remindAccepted,
        promoteAccepted: !!flags.promoteAccepted
      }))
        .then(() => {
          this.setData({ showRegister: false, regSaving: false })
          wx.showToast({ title: '报名成功' })
          this.load()
        })
      const fail = () => {
        this.setData({ regSaving: false, showRegister: false })
        this.load()
      }
      if (tempAvatar) {
        uploadAvatar(tempAvatar, openid)
          .then((fileID) => saveAndSignup(fileID).catch(fail))
          .catch(fail)
      } else {
        saveAndSignup('').catch(fail)
      }
    }
    if (!remindId || !wx.requestSubscribeMessage) {
      if (!remindId) wx.showToast({ title: '通知还没配好', icon: 'none' })
      continueRegister()
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [remindId],
      success: (result) => {
        flags.remindAccepted = !!(result && result[remindId] === 'accept')
      },
      fail: (error) => {
        const msg = String((error && error.errMsg) || '')
        if (msg.indexOf('cancel') !== -1 || msg.indexOf('取消') !== -1) return
        wx.showToast({
          title: msg.indexOf('template') !== -1 || msg.indexOf('模板') !== -1
            ? '订阅模板无效，请检查后台配置'
            : '没有弹出授权，请再点一次',
          icon: 'none'
        })
      },
      complete: (result) => {
        const err = (result && result.errMsg) || ''
        if (err.indexOf('fail') !== -1 && err.indexOf('cancel') === -1 && err.indexOf('取消') === -1) return
        continueRegister()
      }
    })
  },
  onQuota(event) {
    if (!this.data.me || !this.data.me.isAdmin || this.data.closed) return
    const teamId = event.currentTarget.dataset.team
    const maxSignups = Number(event.detail.value) + 1
    call('updateQuota', {
      activityId: this.data.id,
      teamId,
      maxSignups
    }).then(() => this.load())
  },
  onScoreLeft(event) { this.setData({ scoreLeft: Number(event.detail.value) }) },
  onScoreRight(event) { this.setData({ scoreRight: Number(event.detail.value) }) },
  addRound() {
    const left = this.data.scoreLeft
    const right = this.data.scoreRight
    const scoreJiong = this.data.mineIsJiong ? left : right
    const scorePudong = this.data.mineIsJiong ? right : left
    call('saveRound', {
      activityId: this.data.id,
      scoreJiong,
      scorePudong
    }).then(() => {
      this.setData({ scoreLeft: 0, scoreRight: 0 })
      this.load()
    })
  },
  deleteWidth() {
    if (this._deleteWidth) return this._deleteWidth
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this._deleteWidth = 160 * info.windowWidth / 750
    return this._deleteWidth
  },
  onSwipeStart(event) {
    if (!this.data.me || !this.data.me.isAdmin) return
    const touch = event.touches[0]
    const list = event.currentTarget.dataset.list
    const index = event.currentTarget.dataset.index
    this.swipe = {
      x: touch.clientX,
      y: touch.clientY,
      list,
      index,
      base: (this.data[list][index] && this.data[list][index].offset) || 0,
      moved: false,
      ignore: false
    }
  },
  onSwipeMove(event) {
    if (!this.swipe || this.swipe.ignore) return
    const touch = event.touches[0]
    const dx = touch.clientX - this.swipe.x
    const dy = touch.clientY - this.swipe.y
    if (!this.swipe.moved && Math.abs(dy) > Math.abs(dx)) {
      this.swipe.ignore = true
      return
    }
    this.swipe.moved = true
    const width = this.deleteWidth()
    let offset = this.swipe.base + dx
    if (offset > 0) offset = 0
    if (offset < -width) offset = -width
    const index = this.swipe.index
    this.setData({
      [`${this.swipe.list}[${index}].offset`]: offset,
      [`${this.swipe.list}[${index}].dragging`]: true
    })
  },
  onSwipeEnd() {
    if (!this.swipe) return
    const moved = this.swipe.moved && !this.swipe.ignore
    const list = this.swipe.list
    const index = this.swipe.index
    this.swipe = null
    if (!moved) return
    const width = this.deleteWidth()
    const offset = (this.data[list][index] && this.data[list][index].offset) || 0
    const open = offset < -width / 2
    this.setData({
      [list]: this.data[list].map((item, i) => ({
        ...item,
        offset: i === index && open ? -width : 0,
        dragging: false
      }))
    })
  },
  askDeleteRecord(event) {
    if (!this.data.me || !this.data.me.isAdmin) return
    const id = event.currentTarget.dataset.id
    const name = event.currentTarget.dataset.name || '这名队员'
    wx.showModal({
      title: '删除数据',
      content: `删除「${name}」这场的进球、助攻和出勤？`,
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('deleteContribution', { contributionId: id }).then(() => this.load())
      }
    })
  },
  askDeleteRound(event) {
    if (!this.data.me || !this.data.me.isAdmin) return
    const id = event.currentTarget.dataset.id
    const no = event.currentTarget.dataset.no
    wx.showModal({
      title: '删除比分',
      content: `删除第 ${no} 轮比分？`,
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('deleteRound', { roundId: id }).then(() => this.load())
      }
    })
  },

  fillStat(member) {
    const stat = (this.contributionMap && this.contributionMap[member._openid]) || {}
    this.setData({
      selectedOpenid: member._openid,
      pickedLabel: member.label,
      goalIndex: stat.goals || 0,
      assistIndex: stat.assists || 0,
      pigeonIndex: stat.absent ? 1 : 0
    })
  },
  onMemberTeam(event) {
    const memberTeam = event.currentTarget.dataset.id
    const pickMembers = memberTeam === 'all'
      ? this.data.signedMembers
      : this.data.signedMembers.filter((item) => item.teamId === memberTeam)
    const still = pickMembers.find((item) => item._openid === this.data.selectedOpenid)
    this.setData({
      memberTeam,
      pickMembers,
      members: pickMembers,
      pickIndex: still ? pickMembers.indexOf(still) : 0,
      ...(still ? {} : { selectedOpenid: '', pickedLabel: '选择队员' })
    })
  },
  onPickPlayer(event) {
    const pickIndex = Number(event.detail.value)
    const picked = this.data.pickMembers[pickIndex]
    if (!picked) return
    this.setData({ pickIndex })
    this.fillStat(picked)
  },
  rejectAbsentStats() {
    wx.showModal({
      title: '出勤情况',
      content: '鸽子的情况下，进球和助攻得是 0',
      showCancel: false
    })
  },
  keepPicker(field, previous) {
    const other = previous === 0 ? 1 : 0
    this.setData({ [field]: other }, () => this.setData({ [field]: previous }))
  },
  onEditGoals(event) {
    const goalIndex = Number(event.detail.value)
    if (this.data.pigeonIndex === 1 && (goalIndex !== 0 || this.data.assistIndex !== 0)) {
      this.rejectAbsentStats()
      this.keepPicker('goalIndex', this.data.goalIndex)
      return
    }
    this.setData({ goalIndex })
  },
  onEditAssists(event) {
    const assistIndex = Number(event.detail.value)
    if (this.data.pigeonIndex === 1 && (this.data.goalIndex !== 0 || assistIndex !== 0)) {
      this.rejectAbsentStats()
      this.keepPicker('assistIndex', this.data.assistIndex)
      return
    }
    this.setData({ assistIndex })
  },
  onEditAbsent(event) {
    const pigeonIndex = Number(event.detail.value)
    if (pigeonIndex === 1 && (this.data.goalIndex !== 0 || this.data.assistIndex !== 0)) {
      this.rejectAbsentStats()
      this.setData({ pigeonIndex: 0 })
      return
    }
    this.setData({ pigeonIndex })
  },
  saveStat() {
    if (!this.data.me || !this.data.me.isAdmin) return
    const player = this.data.pickMembers.find((item) => item._openid === this.data.selectedOpenid)
    if (!player) {
      wx.showToast({ title: '请选择队员', icon: 'none' })
      return
    }
    if (this.data.pigeonIndex === 1 && (this.data.goalIndex !== 0 || this.data.assistIndex !== 0)) {
      this.rejectAbsentStats()
      return
    }
    this.writeStat(player._openid, this.data.goalIndex, this.data.assistIndex, this.data.pigeonIndex === 1, true)
  },
  onRowGoals(event) {
    const record = this.rowByOpenid(event.currentTarget.dataset.openid)
    if (!record) return
    const goals = Number(event.detail.value)
    if (record.absent && goals !== 0) {
      this.rejectAbsentStats()
      this.load()
      return
    }
    this.writeStat(record.playerOpenid, goals, record.assists, record.absent, false)
  },
  onRowAssists(event) {
    const record = this.rowByOpenid(event.currentTarget.dataset.openid)
    if (!record) return
    const assists = Number(event.detail.value)
    if (record.absent && assists !== 0) {
      this.rejectAbsentStats()
      this.load()
      return
    }
    this.writeStat(record.playerOpenid, record.goals, assists, record.absent, false)
  },
  onRowAbsent(event) {
    const record = this.rowByOpenid(event.currentTarget.dataset.openid)
    if (record && record.absentBy === 'system') return
    if (!record) return
    const absent = Number(event.detail.value) === 1
    if (absent && (record.goals !== 0 || record.assists !== 0)) {
      this.rejectAbsentStats()
      this.load()
      return
    }
    this.writeStat(record.playerOpenid, record.goals, record.assists, absent, false)
  },
  rowByOpenid(openid) {
    if (!this.data.me || !this.data.me.isAdmin) return null
    return this.data.records.find((item) => item.playerOpenid === openid) || null
  },
  writeStat(playerOpenid, goals, assists, absent, toast) {
    if (this.data.savingStat) return
    this.setData({ savingStat: true })
    call('setContribution', {
      activityId: this.data.id,
      playerOpenid,
      goals,
      assists
    }).then(() => call('setAbsent', {
      activityId: this.data.id,
      playerOpenid,
      absent
    })).then(() => {
      this.setData({ savingStat: false })
      if (toast) wx.showToast({ title: '已保存' })
      this.load()
    }).catch(() => this.setData({ savingStat: false }))
  },
  groupSignedPool(signups, teamId) {
    return (signups || []).filter(
      (item) => item && item.teamId === teamId && (!item.status || item.status === 'signed')
    )
  },
  findTacticsEntry(teamId) {
    return (this.data.tacticsList || []).find((item) => item && item.teamId === teamId) || null
  },
  currentTacticsView(list, teamId) {
    const rows = list || []
    const entry = rows.find((item) => item && item.teamId === teamId) || rows[0] || null
    if (!entry) {
      return {
        tacticsTeamId: '',
        tacticsTeamName: '',
        tacticsBoard: buildDefaultTacticsState([], { emptyText: '待报名' }),
        tacticsRemovedNotice: ''
      }
    }
    return {
      tacticsTeamId: entry.teamId,
      tacticsTeamName: entry.teamName,
      tacticsBoard: entry.board,
      tacticsRemovedNotice: entry.removedNotice || ''
    }
  },
  switchTacticsTeam(event) {
    const teamId = event.currentTarget.dataset.teamid
    if (!teamId || teamId === this.data.tacticsTeamId) return
    this.clearTacticsHoldTimer()
    this.setData({
      ...this.currentTacticsView(this.data.tacticsList, teamId),
      tacticsDraggingUserId: '',
      tacticsDraggingSource: '',
      tacticsDragPreviewActive: false,
      tacticsDragPlayer: null
    })
  },
  patchTacticsEntry(teamId, patch) {
    const list = (this.data.tacticsList || []).slice()
    const idx = list.findIndex((item) => item && item.teamId === teamId)
    if (idx < 0) return
    list[idx] = Object.assign({}, list[idx], patch)
    const data = { tacticsList: list }
    if (teamId === this.data.tacticsTeamId) {
      Object.assign(data, this.currentTacticsView(list, teamId))
    }
    this.setData(data)
  },
  computeGroupTacticsBoard(signups, activityBoards, teamId) {
    const pool = this.groupSignedPool(signups, teamId)
    const savedDoc = activityBoards && activityBoards[teamId]
    if (savedDoc && Array.isArray(savedDoc.slots)) {
      const reconciled = reconcileSavedBoard(savedDoc.slots, pool, { emptyText: '待报名' })
      return {
        board: reconciled,
        removedNotice: reconciled.removedNotice || ''
      }
    }
    return {
      board: buildDefaultTacticsState(pool, { emptyText: '待报名' }),
      removedNotice: ''
    }
  },
  measureTacticsZones(cb) {
    const query = this.createSelectorQuery()
    query.select('#tacticsPitch').boundingClientRect()
    query.select('#tacticsBench').boundingClientRect()
    query.exec((res) => {
      this.tacticsPitchRect = (res && res[0]) || null
      this.tacticsBenchRect = (res && res[1]) || null
      if (typeof cb === 'function') cb()
    })
  },
  pointInRect(x, y, rect) {
    return !!(rect && rect.width > 0 && rect.height > 0
      && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
  },
  onTacticsTouchStart(event) {
    if (!this.data.canEditTactics) return
    const touch = (event.touches && event.touches[0]) || null
    const userId = event.currentTarget.dataset.userid
    const teamId = this.data.tacticsTeamId
    const source = event.currentTarget.dataset.source || 'pitch'
    if (!touch || !userId || !teamId) return
    this.clearTacticsHoldTimer()
    this.tacticsTouchStartPoint = { x: touch.clientX, y: touch.clientY }

    const board = this.data.tacticsBoard || {}
    const list = source === 'bench' ? (board.bench || []) : (board.onPitch || [])
    const dragPlayer = list.find((p) => p && p.userId === userId) || null

    this.tacticsHoldTimer = setTimeout(() => {
      this.tacticsHoldTimer = null
      this.measureTacticsZones(() => {
        const rect = this.tacticsPitchRect
        let leftPct = 50
        let topPct = 50
        if (rect && rect.width > 0 && rect.height > 0) {
          leftPct = Math.max(8, Math.min(92, ((touch.clientX - rect.left) / rect.width) * 100))
          topPct = Math.max(8, Math.min(92, ((touch.clientY - rect.top) / rect.height) * 100))
        }
        this.setData({
          tacticsDraggingUserId: userId,
          tacticsDraggingSource: source,
          tacticsDragPreviewActive: true,
          tacticsDragPreviewLeft: Number(leftPct.toFixed(1)),
          tacticsDragPreviewTop: Number(topPct.toFixed(1)),
          tacticsDragPlayer: dragPlayer
        })
      })
    }, 150)
  },
  onTacticsTouchMove(event) {
    const touch = (event.touches && event.touches[0]) || null
    if (!touch) return
    if (!this.data.tacticsDragPreviewActive) {
      if (this.tacticsTouchStartPoint) {
        const dx = Math.abs(touch.clientX - this.tacticsTouchStartPoint.x)
        const dy = Math.abs(touch.clientY - this.tacticsTouchStartPoint.y)
        if (dx > 10 || dy > 10) {
          this.clearTacticsHoldTimer()
        }
      }
      return
    }
    this.tacticsLastMoveClient = { x: touch.clientX, y: touch.clientY }
    const rect = this.tacticsPitchRect
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    // 幽灵头像仍相对球场；拖出球场下方时贴在底边，提示可松手下场
    const leftPct = Math.max(4, Math.min(96, ((touch.clientX - rect.left) / rect.width) * 100))
    const rawTop = ((touch.clientY - rect.top) / rect.height) * 100
    const topPct = Math.max(4, Math.min(108, rawTop))
    this.setData({
      tacticsDragPreviewLeft: Number(leftPct.toFixed(1)),
      tacticsDragPreviewTop: Number(topPct.toFixed(1))
    })
  },
  resolveDropZone(source, cx, cy, pRect, bRect) {
    const onBench = this.pointInRect(cx, cy, bRect)
    const onPitch = this.pointInRect(cx, cy, pRect)
    if (onBench) return 'bench'
    // 场上拖到球场下方（含轮换区与中间缝隙）一律视为下场
    if (source === 'pitch' && pRect && cy > pRect.bottom) return 'bench'
    if (onPitch) return 'pitch'
    return ''
  },
  onTacticsTouchEnd(event) {
    this.clearTacticsHoldTimer()
    if (!this.data.tacticsDragPreviewActive) return
    const changed = (event.changedTouches && event.changedTouches[0]) || this.tacticsLastMoveClient || this.tacticsTouchStartPoint
    const userId = this.data.tacticsDraggingUserId
    const teamId = this.data.tacticsTeamId
    const source = this.data.tacticsDraggingSource || 'pitch'
    this.setData({
      tacticsDraggingUserId: '',
      tacticsDraggingSource: '',
      tacticsDragPreviewActive: false,
      tacticsDragPlayer: null
    })
    if (!changed || !userId || !teamId) return

    const finishDrop = () => {
      const pRect = this.tacticsPitchRect
      const bRect = this.tacticsBenchRect
      const cx = changed.clientX != null ? changed.clientX : changed.x
      const cy = changed.clientY != null ? changed.clientY : changed.y
      const dropZone = this.resolveDropZone(source, cx, cy, pRect, bRect)
      if (!dropZone) return

      const onPitch = dropZone === 'pitch'
      const relX = onPitch && pRect ? (cx - pRect.left) / pRect.width : 0.5
      const relY = onPitch && pRect ? (cy - pRect.top) / pRect.height : 0.5
      const board = this.data.tacticsBoard
      if (!board) return
      const pool = this.groupSignedPool(this.data.signups || [], teamId)
      const out = applyPitchDrag(
        board,
        pool,
        { source, userId, dropZone, x: relX, y: relY },
        { emptyText: '待报名' }
      )
      if (out.toast) {
        wx.showToast({ title: out.toast, icon: 'none' })
        return
      }
      this.patchTacticsEntry(teamId, { board: out.state })
    }

    // 松手前重测，避免拖动中页面微移导致轮换区坐标过期
    this.measureTacticsZones(finishDrop)
  },
  hasProfile(me) {
    return !!(me && String(me.name || '').trim() && me.teamId)
  },
  saveActivityTacticsBoard() {
    if (this.data.savingTacticsBoard) return
    if (!this.data.canEditTactics) {
      wx.showToast({ title: '只有本场正选可以保存战术板', icon: 'none' })
      return
    }
    if (!this.hasProfile(this.data.me)) {
      wx.showModal({
        title: '请先完善资料',
        content: '请先在「我的」里填写姓名和球队，再保存阵容。',
        confirmText: '去填写',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) wx.reLaunch({ url: '/pages/me/me' })
        }
      })
      return
    }
    const teamId = this.data.tacticsTeamId
    if (!teamId) {
      wx.showToast({ title: '请选择球队', icon: 'none' })
      return
    }
    const slots = ((this.data.tacticsBoard && this.data.tacticsBoard.onPitch) || []).map((p) => ({
      userId: p.userId,
      x: p.x,
      y: p.y,
      role: p.role
    }))
    this.setData({ savingTacticsBoard: true })
    call('saveTacticsBoard', {
      scope: 'activity',
      activityId: this.data.id,
      teamId,
      slots
    }).then((res) => {
      const nextBoards = Object.assign({}, this.data.activityBoards || {})
      if (res && res.board) {
        nextBoards[teamId] = res.board
      }
      this.patchTacticsEntry(teamId, { removedNotice: '' })
      this.setData({
        savingTacticsBoard: false,
        activityBoards: nextBoards
      })
      wx.showToast({ title: '阵容已保存' })
    }).catch((err) => {
      this.setData({ savingTacticsBoard: false })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    })
  },
  generateTacticsTempFile() {
    return new Promise((resolve, reject) => {
      const query = this.createSelectorQuery()
      query.select('#tacticsCanvas')
        .fields({ node: true, size: true })
        .exec(async (res) => {
          const canvasNode = res && res[0] && res[0].node
          if (!canvasNode) {
            reject(new Error('画布初始化失败'))
            return
          }
          try {
            const size = await renderTacticsPoster(canvasNode, {
              activity: this.data.activity || {},
              teamName: this.data.tacticsTeamName || teamName(this.data.teams || [], this.data.tacticsTeamId),
              board: this.data.tacticsBoard
            })
            wx.canvasToTempFilePath({
              canvas: canvasNode,
              width: size.width,
              height: size.height,
              destWidth: size.width,
              destHeight: size.height,
              fileType: 'png',
              quality: 1,
              success: (out) => resolve(out.tempFilePath),
              fail: (err) => reject(err)
            })
          } catch (error) {
            reject(error)
          }
        })
    })
  },
  saveTacticsPoster() {
    if (this.data.exportingTactics) return
    this.setData({ exportingTactics: true })
    wx.showLoading({ title: '生成图片中...' })
    this.generateTacticsTempFile()
      .then((filePath) => {
        wx.hideLoading()
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => {
            this.setData({ exportingTactics: false })
            wx.showToast({ title: '已存到相册' })
          },
          fail: (err) => {
            this.setData({ exportingTactics: false })
            const msg = (err && err.errMsg) || ''
            if (msg.indexOf('cancel') !== -1) return
            if (msg.indexOf('auth') !== -1 || msg.indexOf('authorize') !== -1 || msg.indexOf('deny') !== -1) {
              wx.showModal({
                title: '需要相册权限',
                content: '允许访问相册后即可保存战术板图片，或点击预览长按保存。',
                confirmText: '去开启',
                cancelText: '预览图片',
                success: (modalRes) => {
                  if (modalRes.confirm) {
                    wx.openSetting()
                  } else {
                    wx.previewImage({ urls: [filePath], current: filePath })
                  }
                }
              })
              return
            }
            wx.previewImage({ urls: [filePath], current: filePath })
          }
        })
      })
      .catch(() => {
        wx.hideLoading()
        this.setData({ exportingTactics: false })
        wx.showToast({ title: '生成战术板失败', icon: 'none' })
      })
  },
  shareTacticsPoster() {
    if (this.data.exportingTactics) return
    this.setData({ exportingTactics: true })
    wx.showLoading({ title: '生成图片中...' })
    this.generateTacticsTempFile()
      .then((filePath) => {
        wx.hideLoading()
        this.setData({ exportingTactics: false })
        if (typeof wx.showShareImageMenu === 'function') {
          wx.showShareImageMenu({
            path: filePath,
            fail: (err) => {
              const msg = (err && err.errMsg) || ''
              if (msg.indexOf('cancel') !== -1) return
              wx.previewImage({ urls: [filePath], current: filePath })
            }
          })
          return
        }
        wx.previewImage({ urls: [filePath], current: filePath })
      })
      .catch(() => {
        wx.hideLoading()
        this.setData({ exportingTactics: false })
        wx.showToast({ title: '生成战术板失败', icon: 'none' })
      })
  }
})
