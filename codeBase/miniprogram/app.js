const cloudConfig = require('./cloud-env.js')

App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '基础库过低',
        content: '请使用 2.2.3 及以上基础库，才能使用云开发',
        showCancel: false
      })
      return
    }
    const init = { traceUser: true }
    if (cloudConfig.envId) init.env = cloudConfig.envId
    wx.cloud.init(init)
  },
  globalData: {
    user: null
  }
})
