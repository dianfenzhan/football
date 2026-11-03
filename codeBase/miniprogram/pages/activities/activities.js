const { call, callQuiet, formatTime, teamName, sortQuotasByMine } = require('../../utils/api')
const {
  FILTER_ALL,
  setMultiClubReady,
  joinedClubs,
  normalizeClubs,
  writeFilter,
  filterOptions,
  resolveFilter,
  clubLabel,
  listPayload,
  pickPreferredCreateClub
} = require('../../utils/club-context')

Page({
  data: {
    activities: [],
    isAdmin: false,
    canDelete: false,
    myTeamId: 'team_jiong',
    clubs: [],
    filterOptions: [],
    viewClubFilter: '',
    loading: true,
    loadingMore: false,
    page: 1,
    hasMore: false
  },
  onShow() {
    this.load(true)
  },
  onFilterChange(event) {
    writeFilter(event.detail && event.detail.clubId)
    this.load(true)
  },
  load(reset) {
    const request = (this._loadSeq = (this._loadSeq || 0) + 1)
    if (reset) this.setData({ loading: true, activities: [] })
    else this.setData({ loadingMore: true })
    const page = reset ? 1 : this.data.page + 1
    const pendingMe = reset ? call('me') : Promise.resolve(null)
    const pendingOrg = reset
      ? callQuiet('orgMe').then((org) => {
        setMultiClubReady(true)
        return org
      }).catch(() => {
        setMultiClubReady(false)
        return null
      })
      : Promise.resolve({ clubs: this.data.clubs })

    Promise.all([pendingMe, pendingOrg]).then(([profile, org]) => {
      const rawClubs = (org && org.clubs) || this.data.clubs || []
      const clubs = normalizeClubs(rawClubs, profile && profile.user, profile && profile.teams)
      const viewClubFilter = resolveFilter(clubs)
      if (!joinedClubs(clubs).length) {
        return { profile, list: { activities: [], teams: [], hasMore: false }, clubs, viewClubFilter: '' }
      }
      return call('listActivities', listPayload(page, viewClubFilter || FILTER_ALL)).then((list) => ({
        profile, org, list, clubs, viewClubFilter
      }))
    }).then(({ profile, list, clubs, viewClubFilter }) => {
      if (request !== this._loadSeq) return
      const teams = list.teams || []
      const myTeamId = reset && profile && profile.user && profile.user.teamId
        ? profile.user.teamId
        : this.data.myTeamId
      const mapped = (list.activities || []).map((activity) => {
        const isPool = activity.clubId === 'club_jielong' || activity.signupMode === 'pool'
        const quotaText = isPool
          ? `已报名 ${typeof activity.signedCount === 'number' ? activity.signedCount : ((activity.quotas || []).reduce((sum, quota) => sum + (quota.signed || 0), 0))} 人`
          : sortQuotasByMine(activity.quotas || [], myTeamId).map((quota) => {
            const name = teamName(teams, quota.teamId) || ((activity.teams || []).find((team) => team.id === quota.teamId) || {}).name || ''
            return `${name} ${quota.signed}/${quota.maxSignups}`
          }).join('  ')
        return {
          ...activity,
          clubId: activity.clubId || 'club_wednesday',
          clubLabel: clubLabel(activity.clubId || 'club_wednesday'),
          timeText: formatTime(activity.startTime),
          quotaText,
          expired: Date.now() > activity.startTime + 12 * 60 * 60 * 1000
        }
      }).filter((activity) => {
        // 云端旧版可能忽略 clubId：前端再挡一层
        if (!viewClubFilter) return false
        if (viewClubFilter === 'club_jielong') return activity.clubId === 'club_jielong'
        if (viewClubFilter === 'club_wednesday') return activity.clubId !== 'club_jielong'
        return true
      })
      const activities = (reset ? [] : this.data.activities).concat(mapped)
      const hasMore = !!list.hasMore && mapped.length > 0
      const current = clubs.find((club) => club._id === viewClubFilter)
      const clubAdmin = !!(current && (current.role === 'admin' || current.role === 'owner'))
      const anyAdmin = clubs.some((club) => club.role === 'admin' || club.role === 'owner')
      this.setData({
        activities,
        ...(reset ? {
          isAdmin: clubAdmin || anyAdmin || !!(profile && profile.user && profile.user.isAdmin),
          // 只有授权人（主管理员）可删活动；普通管理员也不能删
          canDelete: !!(profile && profile.user && profile.user.canGrantAdmin),
          myTeamId,
          clubs,
          filterOptions: filterOptions(clubs),
          viewClubFilter
        } : {}),
        page,
        hasMore,
        loading: false,
        loadingMore: false
      })
    }).catch(() => {
      if (request !== this._loadSeq) return
      this.setData({ loading: false, loadingMore: false })
    })
  },
  more() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    this.load(false)
  },
  onReachBottom() {
    this.more()
  },
  deleteWidth() {
    if (this._deleteWidth) return this._deleteWidth
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this._deleteWidth = 160 * info.windowWidth / 750
    return this._deleteWidth
  },
  onTouchStart(event) {
    if (!this.data.canDelete) return
    const touch = event.touches[0]
    const index = event.currentTarget.dataset.index
    this.touch = {
      x: touch.clientX,
      y: touch.clientY,
      index,
      base: this.data.activities[index].offset || 0,
      moved: false,
      ignore: false
    }
  },
  onTouchMove(event) {
    if (!this.touch || this.touch.ignore) return
    const touch = event.touches[0]
    const dx = touch.clientX - this.touch.x
    const dy = touch.clientY - this.touch.y
    if (!this.touch.moved && Math.abs(dy) > Math.abs(dx)) {
      this.touch.ignore = true
      return
    }
    this.touch.moved = true
    const width = this.deleteWidth()
    let offset = this.touch.base + dx
    if (offset > 0) offset = 0
    if (offset < -width) offset = -width
    const index = this.touch.index
    this.setData({
      [`activities[${index}].offset`]: offset,
      [`activities[${index}].dragging`]: true
    })
  },
  onTouchEnd() {
    if (!this.touch) return
    const moved = this.touch.moved && !this.touch.ignore
    const index = this.touch.index
    this.skipOpen = moved
    if (!moved) {
      this.touch = null
      return
    }
    const width = this.deleteWidth()
    const offset = this.data.activities[index].offset || 0
    const open = offset < -width / 2
    const activities = this.data.activities.map((item, i) => ({
      ...item,
      offset: i === index && open ? -width : 0,
      dragging: false
    }))
    this.setData({ activities })
    this.touch = null
  },
  askDelete(event) {
    const id = event.currentTarget.dataset.id
    const activity = this.data.activities.find((item) => item._id === id)
    wx.showModal({
      title: '删除活动',
      content: activity ? `删除「${activity.title}」？报名、比分和本场数据会一起删掉` : '报名、比分和本场数据会一起删掉',
      confirmColor: '#8c3a2f',
      success: (res) => {
        if (!res.confirm) return
        call('deleteActivity', { activityId: id }).then(() => this.load(true))
      }
    })
  },
  open(event) {
    if (this.skipOpen) {
      this.skipOpen = false
      return
    }
    const current = this.data.activities.find((item) => item.offset)
    if (current) {
      this.setData({
        activities: this.data.activities.map((item) => ({ ...item, offset: 0, dragging: false }))
      })
      return
    }
    const activity = this.data.activities.find((item) => item._id === event.currentTarget.dataset.id)
    if (activity && (activity.clubId === 'club_jielong' || activity.clubId === 'club_wednesday')) {
      writeFilter(activity.clubId)
    }
    const page = activity && activity.clubId === 'club_jielong' ? 'session' : 'activity'
    wx.navigateTo({ url: `/pages/${page}/${page}?id=${event.currentTarget.dataset.id}` })
  },
  create() {
    const preferred = pickPreferredCreateClub(this.data.viewClubFilter, this.data.clubs)
    if (preferred) {
      wx.navigateTo({ url: `/pages/activity-edit/activity-edit?clubId=${preferred}` })
      return
    }
    wx.showActionSheet({
      itemList: ['周三联', '界龙散客队'],
      success: (res) => {
        const clubId = res.tapIndex === 1 ? 'club_jielong' : 'club_wednesday'
        wx.navigateTo({ url: `/pages/activity-edit/activity-edit?clubId=${clubId}` })
      }
    })
  }
})
