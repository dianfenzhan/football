const cloudConfig = require('./cloud-env.js')
const { probeLocalApi } = require('./utils/api')

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
    // 正式 profile 开发默认打本地 api；测试 profile（forceRemoteCloud）跳过探测，直接打测试云端
    setTimeout(() => { probeLocalApi() }, 800)
  },
  globalData: {
    user: null
  }
})
