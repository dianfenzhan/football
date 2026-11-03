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

function withShortName(item) {
  const id = item && item.id
  let shortName = item.name
  if (id === 'all') shortName = '全部'
  else if (id === 'club_wednesday') shortName = '周三联'
  else if (id === 'club_jielong') shortName = '界龙'
  return Object.assign({}, item, { shortName })
}

function labelOf(options, value) {
  const hit = (options || []).find((item) => item.id === value)
  return (hit && (hit.shortName || hit.name)) || '全部'
}

Component({
  properties: {
    title: { type: String, value: '球队' },
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
    currentLabel: '全部',
    canSwitch: false,
    showMenu: false,
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
      this.setData({ showMenu: false })
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
        applyWithProfile([], false)
      })
    },
    applyClubs(clubs) {
      const options = clubContext.filterOptions(clubs).map(withShortName)
      const value = clubContext.resolveFilter(clubs)
      const canSwitch = options.length > 1
      const chrome = measureChrome()
      // 多队时绿顶栏下加一行隐蔽队名，标题字号保持不变
      if (canSwitch) chrome.totalHeight += 26
      this.setData(Object.assign({
        clubs,
        options,
        value,
        currentLabel: labelOf(options, value),
        canSwitch,
        showMenu: false
      }, chrome))
    },
    onBack() {
      this.setData({ showMenu: false })
      wx.navigateBack({
        fail: () => {
          wx.reLaunch({ url: '/pages/home/home' })
        }
      })
    },
    onTitleTap() {
      if (!this.data.canSwitch) return
      this.setData({ showMenu: !this.data.showMenu })
    },
    closeMenu() {
      this.setData({ showMenu: false })
    },
    onPick(event) {
      const clubId = event.currentTarget.dataset.id
      if (!clubId) return
      const allowed = (this.data.options || []).some((item) => item.id === clubId)
      if (!allowed) return
      const value = clubContext.writeFilter(clubId)
      this.setData({
        value,
        currentLabel: labelOf(this.data.options, value),
        showMenu: false
      })
      this.triggerEvent('change', { clubId: value })
    }
  }
})
