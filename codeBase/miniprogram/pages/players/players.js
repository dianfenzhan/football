const { call, uploadAvatar, avatarChar, avatarColor, sortTeamsByMine } = require('../../utils/api')
const { PREFERRED_POSITIONS, positionLabel } = require('../../utils/tactics')

const DEFAULT_TEAM_ID = 'team_jiong'

/** 各队队长昵称（小写比较）：置顶于该队管理员之上，并标「队长」 */
const CAPTAIN_NAMES = new Set(['jzy', '肉粽'])

function isCaptain(item) {
  if (!item) return false
  return CAPTAIN_NAMES.has(String(item.name || '').trim().toLowerCase())
}

function playerRank(item) {
  if (isCaptain(item)) return 0
  if (item && item.isAdmin) return 1
  return 2
}

Page({
  data: {
    teams: [],
    positions: PREFERRED_POSITIONS,
    teamId: DEFAULT_TEAM_ID,
    all: [],
    players: [],
    isAdmin: false,
    loading: true,
    showEditModal: false,
    editingPlayerId: '',
    editName: '',
    editPosition: 'mf',
    editAvatarPreview: '',
    editTempAvatar: '',
    editAvatarChar: '?',
    editAvatarBg: '#0f3d2e',
    savingPlayer: false
  },
  onShow() {
    this.load()
  },
  load() {
    Promise.all([
      call('me'),
      call('listPlayers')
    ]).then(([meRes, listRes]) => {
      const user = meRes.user
      const myTeamId = (user && user.teamId) || DEFAULT_TEAM_ID
      const teams = sortTeamsByMine(meRes.teams || [], myTeamId)
      const currentTeamId = this.initializedTeam ? this.data.teamId : myTeamId
      this.initializedTeam = true
      this.setData({
        teams,
        teamId: currentTeamId,
        isAdmin: !!(user && user.isAdmin),
        all: (listRes.users || []).map((item) => ({
          ...item,
          preferredPosition: item.preferredPosition || 'mf',
          positionLabel: positionLabel(item.preferredPosition || 'mf'),
          avatarChar: avatarChar(item.name),
          avatarBg: avatarColor(item.name)
        })),
        loading: false
      })
      this.applyFilter()
    }).catch(() => this.setData({ loading: false }))
  },
  applyFilter() {
    const players = this.data.all
      .filter((item) => item.teamId === this.data.teamId)
      .map((item) => ({
        ...item,
        isCaptain: isCaptain(item)
      }))
      .sort((a, b) => {
        const byRank = playerRank(a) - playerRank(b)
        if (byRank !== 0) return byRank
        return (b.createdAt || 0) - (a.createdAt || 0)
      })
    this.setData({ players })
  },
  onTeam(event) {
    this.initializedTeam = true
    this.setData({ teamId: event.currentTarget.dataset.id })
    this.applyFilter()
  },
  onTapPlayer(event) {
    if (!this.data.isAdmin) return
    const id = event.currentTarget.dataset.id
    const target = (this.data.players || []).find((p) => p._id === id)
    if (!target) return
    this.setData({
      showEditModal: true,
      editingPlayerId: target._id,
      editName: target.name || '',
      editPosition: target.preferredPosition || 'mf',
      editAvatarPreview: target.avatarUrl || '',
      editTempAvatar: '',
      editAvatarChar: avatarChar(target.name),
      editAvatarBg: avatarColor(target.name)
    })
  },
  closeEditModal() {
    if (this.data.savingPlayer) return
    this.setData({
      showEditModal: false,
      editingPlayerId: '',
      editTempAvatar: ''
    })
  },
  onEditName(event) {
    const val = event.detail.value || ''
    this.setData({
      editName: val,
      editAvatarChar: avatarChar(val),
      editAvatarBg: avatarColor(val)
    })
  },
  onEditPosition(event) {
    this.setData({ editPosition: event.currentTarget.dataset.id })
  },
  onChooseEditAvatar(event) {
    const src = event.detail && event.detail.avatarUrl
    if (!src) return
    this.setData({
      editTempAvatar: src,
      editAvatarPreview: src
    })
  },
  saveEditPlayer() {
    if (this.data.savingPlayer) return
    const name = String(this.data.editName || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' })
      return
    }
    this.setData({ savingPlayer: true })
    const submit = (avatarUrl) => {
      const payload = {
        userId: this.data.editingPlayerId,
        name,
        preferredPosition: this.data.editPosition || 'mf'
      }
      if (typeof avatarUrl === 'string') payload.avatarUrl = avatarUrl
      call('adminUpdatePlayer', payload).then(() => {
        this.setData({
          savingPlayer: false,
          showEditModal: false,
          editingPlayerId: '',
          editTempAvatar: ''
        })
        wx.showToast({ title: '已保存' })
        this.load()
      }).catch((err) => {
        this.setData({ savingPlayer: false })
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
      })
    }
    if (this.data.editTempAvatar) {
      uploadAvatar(this.data.editTempAvatar)
        .then((fileID) => submit(fileID))
        .catch(() => {
          this.setData({ savingPlayer: false })
          wx.showToast({ title: '头像上传失败', icon: 'none' })
        })
    } else {
      submit()
    }
  },
  noop() {}
})
