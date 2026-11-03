const FORCE_REMOTE_KEY = 'cloudApiForceRemote'
const cloudEnv = (() => {
  try { return require('../cloud-env.js') } catch (err) { return {} }
})()

function envVersion() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion || 'develop'
  } catch (err) {
    return 'develop'
  }
}

function isDevelop() {
  return envVersion() === 'develop'
}

function isForceRemote() {
  if (cloudEnv && cloudEnv.forceRemoteCloud) return true
  try {
    return !!wx.getStorageSync(FORCE_REMOTE_KEY)
  } catch (err) {
    return false
  }
}

/** 手动强制走云端；测试 profile 由 cloud-env.forceRemoteCloud 自动打开。 */
function setForceRemoteCloud(on) {
  try {
    if (on) wx.setStorageSync(FORCE_REMOTE_KEY, true)
    else wx.removeStorageSync(FORCE_REMOTE_KEY)
  } catch (err) { /* ignore */ }
}

function preferLocalCloud() {
  return isDevelop() && !isForceRemote()
}

function invoke(action, data = {}) {
  return wx.cloud.callFunction({
    name: 'api',
    data: { action, ...data }
  }).then((res) => res.result || {})
}

function localDebugHint(message) {
  if (!preferLocalCloud()) return message
  if (!/未知操作/.test(message || '')) return message
  return '未走本地云函数：请对 cloudfunctions/api 开启「云函数本地调试」，并保持调试窗口打开'
}

function call(action, data = {}) {
  return invoke(action, data).then((result) => {
    if (!result.ok) {
      const error = new Error(localDebugHint(result.message || '请求失败'))
      wx.showToast({ title: error.message, icon: 'none' })
      throw error
    }
    return result
  }).catch((error) => {
    if (!error.message || error.errMsg) {
      wx.showToast({
        title: preferLocalCloud()
          ? '本地云函数未就绪，请开启 api 云函数本地调试'
          : '云函数未部署或环境未开通',
        icon: 'none'
      })
    }
    throw error
  })
}

function callQuiet(action, data = {}) {
  return invoke(action, data).then((result) => {
    if (!result.ok) throw new Error(localDebugHint(result.message || '请求失败'))
    return result
  })
}

/** 开发模式探测是否打到本地 api；测线上时跳过。 */
function probeLocalApi() {
  if (!preferLocalCloud()) return Promise.resolve({ skipped: true })
  return invoke('devEcho').then((result) => {
    if (result.ok && result.marker === 'devEcho-v1') {
      return { ok: true, local: true }
    }
    if (/未知操作/.test(result.message || '')) {
      wx.showModal({
        title: '未走本地云函数',
        content: '开发默认应打本地 api。资源管理器右键 api → 开启云函数本地调试，并让这个调试窗口一直开着。窗口关掉后，勾选不会再生效，请求会回到云端。',
        showCancel: false
      })
      return { ok: false, local: false }
    }
    return { ok: !!result.ok, local: false, result }
  }).catch(() => {
    wx.showModal({
      title: '本地云函数探测失败',
      content: '请确认已对 cloudfunctions/api 开启云函数本地调试，且调试窗口保持打开。',
      showCancel: false
    })
    return { ok: false, local: false }
  })
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${week} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const UNITE_TEAM = { _id: 'team_unite', name: '联队' }

function teamName(teams, teamId) {
  const team = (teams || []).find((item) => item._id === teamId)
  if (team) return team.name
  if (teamId === UNITE_TEAM._id) return UNITE_TEAM.name
  return ''
}

function sortTeamsByMine(teams, myTeamId) {
  return (teams || []).slice().sort((a, b) => (
    a._id === myTeamId ? -1 : b._id === myTeamId ? 1 : 0
  ))
}

function sortQuotasByMine(quotas, myTeamId) {
  return (quotas || []).slice().sort((a, b) => (
    a.teamId === myTeamId ? -1 : b.teamId === myTeamId ? 1 : 0
  ))
}

const AVATAR_COLORS = ['#0f3d2e', '#1d6b50', '#8c3a2f', '#b8763c', '#3d5a80', '#6b4d8c', '#a0522d', '#4a7c59']
const MAX_PLAYER_NAME_LENGTH = 16

function assertPlayerName(raw, emptyMessage) {
  const name = String(raw || '').trim()
  if (!name) {
    return { ok: false, message: emptyMessage || '请填写昵称', name: '' }
  }
  if ([...name].length > MAX_PLAYER_NAME_LENGTH) {
    return { ok: false, message: '昵称最多 16 个字', name }
  }
  return { ok: true, name }
}

function avatarChar(name) {
  return (name || '?').trim().charAt(0) || '?'
}

function avatarColor(name) {
  return AVATAR_COLORS[avatarChar(name).charCodeAt(0) % AVATAR_COLORS.length]
}

function uploadAvatar(filePath, openid) {
  const cloudPath = openid
    ? `avatars/${openid}.png`
    : `avatars/${Date.now()}-${Math.floor(Math.random() * 10000)}.png`
  return wx.cloud.uploadFile({ cloudPath, filePath }).then((res) => res.fileID)
}

module.exports = {
  call,
  callQuiet,
  formatTime,
  teamName,
  sortTeamsByMine,
  sortQuotasByMine,
  uploadAvatar,
  avatarChar,
  avatarColor,
  MAX_PLAYER_NAME_LENGTH,
  assertPlayerName,
  setForceRemoteCloud,
  isForceRemote,
  preferLocalCloud,
  probeLocalApi
}
