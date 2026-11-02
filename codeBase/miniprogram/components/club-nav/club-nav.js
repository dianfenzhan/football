const clubContext = require('../../utils/club-context')
const { callQuiet } = require('../../utils/api')

function measureChrome() {
  let statusBarHeight = 20
  let navBarHeight = 44
  let capsuleGap = 96
  try {
    const sys = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync()
    statusBarHeight = sys.statusBarHeight || 20
    const capsule = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
    if (capsule && capsule.height && capsule.top) {
      navBarHeight = (capsule.top - statusBarHeight) * 2 + capsule.height
      capsuleGap = Math.max(88, Math.ceil((sys.windowWidth || 375) - capsule.left) + 8)
    }
  } catch (error) {
    // keep defaults
  }
  return {
    statusBarHeight,
    navBarHeight,
    totalHeight: statusBarHeight + navBarHeight,
    capsuleGap
  }
}

Component({
  properties: {
    showBack: { type: Boolean, value: false },
    bg: { type: String, value: '#0f3d2e' },
    color: { type: String, value: '#ffffff' }
  },
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    totalHeight: 64,
    capsuleGap: 96,
    options: [],
    value: '',
    title: '加载中',
    canSwitch: false,
    showSheet: false,
    clubs: []
  },
  lifetimes: {
    attached() {
      try {
        this.setData(measureChrome())
      } catch (error) {
        // ignore
      }
      this.refreshClubs()
    }
  },
  pageLifetimes: {
    show() {
      this.refreshClubs()
    }
  },
  methods: {
    noop() {},
    refreshClubs() {
      const applyWithProfile = (clubs, multiReady) => {
        clubContext.setMultiClubReady(!!multiReady)
        callQuiet('me').then((me) => {
          this.applyClubs(clubContext.normalizeClubs(clubs, me.user, me.teams))
        }).catch(() => {
          this.applyClubs(clubContext.normalizeClubs(clubs, null, null))
        })
      }
      callQuiet('orgMe').then((org) => {
        applyWithProfile((org && org.clubs) || [], true)
      }).catch(() => {
        // 旧云函数没有 orgMe：用 me 推断周三联
        applyWithProfile([], false)
      })
    },
    applyClubs(clubs) {
      const options = clubContext.filterOptions(clubs)
      const value = clubContext.resolveFilter(clubs)
      this.setData({
        clubs,
        options,
        value,
        canSwitch: options.length > 1,
        title: clubContext.clubLabel(value)
      })
    },
    openSheet() {
      if (!this.data.canSwitch) return
      const value = clubContext.resolveFilter(this.data.clubs)
      this.setData({
        showSheet: true,
        value,
        title: clubContext.clubLabel(value),
        options: clubContext.filterOptions(this.data.clubs)
      })
    },
    closeSheet() {
      this.setData({ showSheet: false })
    },
    onBack() {
      wx.navigateBack({
        fail: () => {
          wx.reLaunch({ url: '/pages/home/home' })
        }
      })
    },
    onPick(event) {
      const clubId = event.currentTarget.dataset.id
      if (!clubId) return
      const allowed = (this.data.options || []).some((item) => item.id === clubId)
      if (!allowed) return
      const value = clubContext.writeFilter(clubId)
      this.setData({
        showSheet: false,
        value,
        title: clubContext.clubLabel(value)
      })
      this.triggerEvent('change', { clubId: value })
    }
  }
})
