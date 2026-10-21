const {
  call,
  formatTime,
  teamName,
  sortTeamsByMine,
  sortQuotasByMine,
  uploadAvatar,
  avatarChar,
  avatarColor
} = require('../../utils/api')

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
    scoreJiong: 0,
    scorePudong: 0,
    showSharePrompt: false,
    showRegister: false,
    regAvatarUrl: '',
    regName: '',
    regTeamId: '',
    regSaving: false,
    loadFailed: false
  },
  onLoad(query) {
    this.pendingShare = query.share === '1'
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
        title: '周三快乐足球联队',
        path: `/pages/activity/activity?id=${this.data.id}`
      }
    }
    const left = (this.data.quotas || []).reduce((sum, quota) => sum + Math.max(0, (quota.maxSignups || 0) - (quota.signed || 0)), 0)
    const date = new Date(activity.startTime)
    const weeks = ['日', '一', '二', '三', '四', '五', '六']
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
    const when = `${date.getMonth() + 1}.${date.getDate()} 周${weeks[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    const gap = left > 0 ? `还差 ${left} 人，速来！` : '已满员，可先围观'
    return {
      title: `${activity.title}｜${when} ${activity.location}，${gap}`,
      path: `/pages/activity/activity?id=${this.data.id}`
    }
  },
  load() {
    call('activityDetail', { activityId: this.data.id }).then((res) => {
      const me = res.me
      const myTeamId = (me && me.teamId) || 'team_jiong'
      const teams = sortTeamsByMine(res.teams || [], myTeamId)
      const contributionMap = {}
      ;(res.contributions || []).forEach((item) => {
        contributionMap[item.playerOpenid] = item
      })
      this.contributionMap = contributionMap
      const players = (res.signups || []).map((signup) => {
        const stat = contributionMap[signup._openid] || { goals: 0, assists: 0 }
        const team = teamName(teams, signup.teamId)
        return {
          ...signup,
          teamName: team,
          label: `${signup.userName} · ${team}`,
          goals: stat.goals || 0,
          assists: stat.assists || 0,
          absent: !!stat.absent,
          avatarChar: avatarChar(signup.userName),
          avatarBg: avatarColor(signup.userName)
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
            .sort((a, b) => (b.isAdmin ? 1 : 0) - (a.isAdmin ? 1 : 0))
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
          teamName: teamName(teams, item.teamId),
          avatarChar: avatarChar(item.userName),
          avatarBg: avatarColor(item.userName)
        }
      })
      const mySignup = me
        ? (res.signups || []).find((item) => item._openid === me._openid)
        : null
      const signed = !!mySignup
      const otherTeam = teams.find((team) => team._id !== myTeamId) || null
      const myQuota = quotas.find((item) => item.teamId === myTeamId)
      const otherQuota = otherTeam
        ? quotas.find((item) => item.teamId === otherTeam._id)
        : null
      const myTeamFull = !!(myQuota && myQuota.full)
      const otherTeamFull = !!(otherQuota && otherQuota.full)
      const canOfferOther = myTeamFull && otherTeam && !otherTeamFull
      const signupButtonText = canOfferOther
        ? `本队已满，改报 · ${otherTeam.name}`
        : `⚽️ 立即报名 · ${teamName(teams, myTeamId)}`
      const picked = pickMembers.find((item) => item._openid === this.data.selectedOpenid)
      const stat = picked ? (contributionMap[picked._openid] || {}) : {}
      const keepForm = !!(picked && this.data.selectedOpenid === picked._openid)
      this.setData({
        activity: { ...res.activity, timeText: formatTime(res.activity.startTime) },
        teams,
        quotas,
        signups: res.signups || [],
        rounds: res.rounds || [],
        roster,
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
        closed: res.activity.startTime <= Date.now(),
        showSharePrompt: !!this.pendingShare && !!(me && me.isAdmin),
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
        canOfferOther,
        signupButtonText,
        loadFailed: false
      })
    }).catch((error) => {
      if (error && error.message && error.message.indexOf('不存在') !== -1) {
        this.setData({ loadFailed: true, activity: null })
      }
    })
  },
  closeSharePrompt() {
    this.pendingShare = false
    this.setData({ showSharePrompt: false })
  },
  noop() {},
  signup() {
    const activityId = this.data.id
    const otherTeamId = this.data.otherTeamId
    const otherTeamName = this.data.otherTeamName
    const myQuota = (this.data.quotas || []).find((item) => item.teamId === (this.data.me && this.data.me.teamId))
    const otherQuota = (this.data.quotas || []).find((item) => item.teamId === otherTeamId)
    const myFull = !!(myQuota && myQuota.signed >= myQuota.maxSignups)
    const otherFull = !!(otherQuota && otherQuota.signed >= otherQuota.maxSignups)

    if (myFull && otherFull) {
      wx.showToast({ title: '两队都已满员', icon: 'none' })
      return
    }
    if (myFull && otherTeamId && !otherFull) {
      this.offerOtherTeam(otherTeamId, otherTeamName)
      return
    }
    call('signup', { activityId }).then(() => this.load()).catch((error) => {
      if (!error || error.message !== '这个队已经满员') return
      if (!otherTeamId || otherFull) {
        wx.showToast({ title: '两队都已满员', icon: 'none' })
        return
      }
      this.offerOtherTeam(otherTeamId, otherTeamName)
    })
  },
  offerOtherTeam(otherTeamId, otherTeamName) {
    wx.showModal({
      title: '本队已满',
      content: `是否改报「${otherTeamName}」？不会修改你的主队资料。`,
      confirmText: '改报',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        call('signup', { activityId: this.data.id, teamId: otherTeamId }).then(() => this.load())
      }
    })
  },
  cancel() {
    wx.showModal({
      title: '取消报名',
      content: '确定取消这次报名吗？',
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
    this.setData({ regSaving: true })
    const tempAvatar = this.data.regAvatarUrl
    const openid = this.data.me && this.data.me._openid
    const saveAndSignup = (avatarUrl) => call('saveProfile', {
      name,
      teamId: this.data.regTeamId,
      avatarUrl
    }).then(() => call('signup', { activityId: this.data.id }))
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
  onScoreJiong(event) { this.setData({ scoreJiong: Number(event.detail.value) }) },
  onScorePudong(event) { this.setData({ scorePudong: Number(event.detail.value) }) },
  addRound() {
    call('saveRound', {
      activityId: this.data.id,
      scoreJiong: this.data.scoreJiong,
      scorePudong: this.data.scorePudong
    }).then(() => {
      this.setData({ scoreJiong: 0, scorePudong: 0 })
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
  }
})
