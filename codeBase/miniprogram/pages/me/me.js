const { call, teamName, uploadAvatar, avatarChar, avatarColor } = require('../../utils/api')

Page({
  data: {
    teams: [],
    name: '',
    teamId: '',
    avatarUrl: '',
    tempAvatar: '',
    avatarPreview: '',
    avatarChar: '?',
    avatarBg: '#0f3d2e',
    isAdmin: false,
    canGrantAdmin: false,
    members: [],
    grantingId: '',
    saving: false
  },
  onShow() {
    call('me').then((res) => {
      const user = res.user
      const teams = res.teams || []
      const canGrantAdmin = !!(user && user.canGrantAdmin)
      const name = user ? user.name : ''
      this.setData({
        teams,
        name,
        teamId: user ? user.teamId : '',
        avatarUrl: (user && user.avatarUrl) || '',
        tempAvatar: '',
        avatarPreview: (user && user.avatarUrl) || '',
        avatarBroken: false,
        avatarChar: avatarChar(name),
        avatarBg: avatarColor(name),
        isAdmin: !!(user && user.isAdmin),
        canGrantAdmin
      })
      if (canGrantAdmin) this.loadMembers(teams)
    })
  },
  loadMembers(teams) {
    call('listMembers').then((res) => {
      const members = (res.users || []).filter((user) => !user.canGrantAdmin).map((user) => ({
        ...user,
        teamName: teamName(teams, user.teamId)
      }))
      this.setData({ members })
    })
  },
  onGrant(event) {
    const userId = event.currentTarget.dataset.id
    const isAdmin = event.detail.value
    const members = this.data.members.map((user) => (
      user._id === userId ? { ...user, isAdmin } : user
    ))
    this.setData({ members, grantingId: userId })
    call('setAdmin', { userId, isAdmin }).then(() => {
      this.setData({ grantingId: '' })
      wx.showToast({ title: isAdmin ? '已设为管理员' : '已取消管理员' })
    }).catch(() => {
      const reverted = this.data.members.map((user) => (
        user._id === userId ? { ...user, isAdmin: !isAdmin } : user
      ))
      this.setData({ members: reverted, grantingId: '' })
    })
  },
  onName(event) { this.setData({ name: event.detail.value }) },
  onChooseAvatar(event) {
    this.setData({ tempAvatar: event.detail.avatarUrl, avatarPreview: event.detail.avatarUrl, avatarBroken: false })
  },
  onAvatarError() {
    this.setData({ avatarBroken: true })
  },
  onTeam(event) { this.setData({ teamId: event.currentTarget.dataset.id }) },
  save() {
    if (this.data.saving) return
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    const finish = (avatarUrl) => {
      const payload = { name: this.data.name, teamId: this.data.teamId }
      if (typeof avatarUrl === 'string') payload.avatarUrl = avatarUrl
      call('saveProfile', payload).then((res) => {
        this.setData({
          avatarUrl: res.user.avatarUrl || '',
          avatarPreview: res.user.avatarUrl || '',
          tempAvatar: '',
          isAdmin: !!res.user.isAdmin,
          canGrantAdmin: !!res.user.canGrantAdmin,
          saving: false
        })
        if (res.user.canGrantAdmin) this.loadMembers(this.data.teams)
        wx.showToast({ title: '已同步' })
      }).catch((err) => {
        this.setData({ saving: false })
        wx.showToast({ title: err.message || '保存失败', icon: 'none' })
      })
    }
    if (this.data.tempAvatar) {
      uploadAvatar(this.data.tempAvatar)
        .then((fileID) => finish(fileID))
        .catch(() => {
          this.setData({ saving: false })
          wx.showToast({ title: '头像上传失败', icon: 'none' })
        })
    } else {
      finish()
    }
  }
})
