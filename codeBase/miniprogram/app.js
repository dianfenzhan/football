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
    // 开发默认应打本地 api；未开启本地调试时弹窗提示（测线上时请 setForceRemoteCloud(true) 并取消勾选本地调试）
    setTimeout(() => { probeLocalApi() }, 800)
  },
  globalData: {
    user: null
  }
})
