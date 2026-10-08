function call(action, data = {}) {
  return wx.cloud.callFunction({
    name: 'api',
    data: { action, ...data }
  }).then((res) => {
    const result = res.result || {}
    if (!result.ok) {
      const error = new Error(result.message || '请求失败')
      wx.showToast({ title: error.message, icon: 'none' })
      throw error
    }
    return result
  }).catch((error) => {
    if (!error.message || error.errMsg) {
      wx.showToast({ title: '云函数未部署或环境未开通', icon: 'none' })
    }
    throw error
  })
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function teamName(teams, teamId) {
  const team = (teams || []).find((item) => item._id === teamId)
  return team ? team.name : ''
}

const AVATAR_COLORS = ['#0f3d2e', '#1d6b50', '#8c3a2f', '#b8763c', '#3d5a80', '#6b4d8c', '#a0522d', '#4a7c59']

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

module.exports = { call, formatTime, teamName, uploadAvatar, avatarChar, avatarColor }
