const { call, formatTime, teamName } = require('../../utils/api')

Page({
  data: {
    activities: [],
    isAdmin: false,
    loading: true,
    loadingMore: false,
    page: 1,
    hasMore: false
  },
  onShow() {
    this.load(true)
  },
  load(reset) {
    const request = (this._loadSeq = (this._loadSeq || 0) + 1)
    if (reset) this.setData({ loading: true, activities: [] })
    else this.setData({ loadingMore: true })
    const page = reset ? 1 : this.data.page + 1
    const pendingMe = reset ? call('me') : Promise.resolve(null)
    Promise.all([pendingMe, call('listActivities', { page })]).then(([profile, list]) => {
      if (request !== this._loadSeq) return
      const teams = list.teams || []
      const mapped = (list.activities || []).map((activity) => ({
        ...activity,
        timeText: formatTime(activity.startTime),
        quotaText: (activity.quotas || []).map((quota) => {
          return `${teamName(teams, quota.teamId)} ${quota.signed}/${quota.maxSignups}`
        }).join('  ')
      }))
      const activities = (reset ? [] : this.data.activities).concat(mapped)
      const hasMore = !!list.hasMore && mapped.length > 0
      this.setData({
        activities,
        ...(reset && profile ? { isAdmin: !!(profile.user && profile.user.isAdmin) } : {}),
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
    if (!this.data.isAdmin) return
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
    wx.navigateTo({ url: `/pages/activity/activity?id=${event.currentTarget.dataset.id}` })
  },
  create() {
    wx.navigateTo({ url: '/pages/activity-edit/activity-edit' })
  }
})
