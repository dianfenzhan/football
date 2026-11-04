const { call, callQuiet, uploadAvatar, avatarChar, avatarColor, assertPlayerName } = require('../../utils/api')
const { PREFERRED_POSITIONS } = require('../../utils/tactics')
const { setMultiClubReady, isMultiClubReady } = require('../../utils/club-context')

const FALLBACK_GROUP_STYLE = {
  team_jiong: { color: '#e6b325', jerseyColor: '黄' },
  team_pudong: { color: '#f4c2c2', jerseyColor: '粉白' }
}

const JIELONG_GROUPS = [
  { id: 'jl_tazi', name: '塔子🕊', color: '#1d6b50', jerseyColor: '绿' },
  { id: 'jl_jielong', name: '界龙⭐️', color: '#f4f4f4', jerseyColor: '白' },
  { id: 'jl_shangxin', name: '伤心🇮🇹', color: '#e6b325', jerseyColor: '黄' },
  { id: 'jl_tangmu', name: '汤姆🐻', color: '#3d5a80', jerseyColor: '蓝' },
  { id: 'jl_aiqing', name: '爱情🔥', color: '#c44536', jerseyColor: '红' },
  { id: 'jl_other', name: '未分组', color: '#66706c', jerseyColor: '灰' }
]

function roleLabel(role) {
  if (role === 'owner') return '主管理员'
  if (role === 'admin') return '管理员'
  return '成员'
}

function decorateClubs(clubs, multiReady) {
  return (clubs || [])
    .filter((club) => club && club.joined)
    .map((club) => {
      const rawGroupId = club.groupId || ''
      const effectiveGroupId = club._id === 'club_jielong' && !rawGroupId
        ? 'jl_other'
        : rawGroupId
      const groups = (club.groups || []).map((group) => ({
        ...group,
        isCurrent: group.id === effectiveGroupId
      }))
      const current = groups.find((group) => group.isCurrent)
      return {
        ...club,
        groupId: effectiveGroupId,
        groups,
        currentGroupName: current ? current.name : (club._id === 'club_jielong' ? '未分组' : ''),
        hasGroups: groups.length > 0,
        roleLabel: roleLabel(club.role),
        canEditGroup: !!multiReady
          && (club.role === 'owner' || club.role === 'admin')
      }
    })
}

function wednesdayGroups(teams) {
  return (teams || []).map((team) => {
    const style = FALLBACK_GROUP_STYLE[team._id] || { color: '#1d6b50', jerseyColor: '' }
    return {
      id: team._id,
      name: team.name,
      color: style.color,
      jerseyColor: style.jerseyColor
    }
  })
}

function fallbackClubs(res) {
  const user = (res && res.user) || {}
  const teams = (res && res.teams) || [
    { _id: 'team_jiong', name: 'jiong 路青少年' },
    { _id: 'team_pudong', name: '浦东老聚三' }
  ]
  const defaultRole = user.canGrantAdmin ? 'owner' : (user.isAdmin ? 'admin' : 'member')
  const memberships = Array.isArray(user.memberships) ? user.memberships : []
  if (memberships.length) {
    const clubs = []
    memberships.forEach((item) => {
      if (!item || !item.clubId) return
      if (item.clubId === 'club_jielong') {
        clubs.push({
          _id: 'club_jielong',
          name: '界龙散客队',
          joined: true,
          role: item.role || defaultRole,
          groupId: item.groupId || '',
          groups: JIELONG_GROUPS.slice()
        })
        return
      }
      if (item.clubId === 'club_wednesday') {
        clubs.push({
          _id: 'club_wednesday',
          name: '周三联',
          joined: true,
          role: item.role || defaultRole,
          groupId: item.groupId || user.teamId || '',
          groups: wednesdayGroups(teams)
        })
      }
    })
    if (clubs.length) return clubs
  }
  if (!(user.teamId || user.isAdmin || user.canGrantAdmin)) return []
  return [
    {
      _id: 'club_wednesday',
      name: '周三联',
      joined: true,
      role: defaultRole,
      groupId: user.teamId || '',
      groups: wednesdayGroups(teams)
    }
  ]
}

Page({
  data: {
    positions: PREFERRED_POSITIONS,
    name: '',
    teamId: '',
    preferredPosition: 'mf',
    avatarUrl: '',
    tempAvatar: '',
    avatarPreview: '',
    avatarChar: '?',
    avatarBg: '#0f3d2e',
    roleHint: '',
    myStats: {
      activities: 0,
      goals: 0,
      assists: 0,
      ownGoals: 0,
      absences: 0
    },
    clubs: [],
    editingClubId: '',
    saving: false,
    justSaved: false
  },
  onShow() {
    this.loadProfile()
    this.loadClubs()
  },
  loadProfile() {
    call('me').then((res) => {
      const user = res.user
      const name = user ? user.name : ''
      const rawStats = (res && res.myStats) || {}
      const profile = {
        name,
        teamId: user ? user.teamId : '',
        preferredPosition: (user && user.preferredPosition) || 'mf',
        avatarChar: avatarChar(name),
        avatarBg: avatarColor(name),
        myStats: {
          activities: Number(rawStats.activities) || 0,
          goals: Number(rawStats.goals) || 0,
          assists: Number(rawStats.assists) || 0,
          ownGoals: Number(rawStats.ownGoals) || 0,
          absences: Number(rawStats.absences) || 0
        },
        roleHint: user && user.canGrantAdmin
          ? '授权人 · 可在「球员」里设管理员'
          : (user && user.isAdmin ? '管理员 · 可在「球员」里给本队授权' : '')
      }
      if (!this.data.tempAvatar) {
        profile.avatarUrl = (user && user.avatarUrl) || ''
        profile.avatarPreview = profile.avatarUrl
        profile.avatarBroken = false
      }
      if (!isMultiClubReady() && !(this.data.clubs || []).length) {
        profile.clubs = decorateClubs(fallbackClubs(res), false)
      }
      this._savedName = name
      this._savedPosition = profile.preferredPosition
      this.setData(profile)
    })
  },
  loadClubs() {
    callQuiet('orgMe').then((org) => {
      setMultiClubReady(true)
      this.setData({
        clubs: decorateClubs(org.clubs || [], true),
        editingClubId: ''
      })
    }).catch(() => {
      setMultiClubReady(false)
      callQuiet('me').then((res) => {
        this.setData({
          clubs: decorateClubs(fallbackClubs(res), false),
          editingClubId: ''
        })
      }).catch(() => {
        this.setData({ clubs: [], editingClubId: '' })
      })
    })
  },
  onName(event) {
    const name = event.detail.value
    this.setData({
      name,
      avatarChar: avatarChar(name),
      avatarBg: avatarColor(name)
    })
  },
  onNameBlur() {
    this.persistProfile()
  },
  onPosition(event) {
    const preferredPosition = event.currentTarget.dataset.id
    if (!preferredPosition || preferredPosition === this.data.preferredPosition) return
    this.setData({ preferredPosition })
    this.persistProfile({ preferredPosition })
  },
  onChooseAvatar(event) {
    const src = event.detail.avatarUrl
    if (!src) return
    const show = (path) => {
      this.setData({ tempAvatar: path, avatarPreview: path, avatarBroken: false })
      this.persistProfile({ forceAvatar: true })
    }
    if (/^https:\/\//.test(src)) {
      show(src)
      return
    }
    const fs = wx.getFileSystemManager()
    const dest = `${wx.env.USER_DATA_PATH}/avatar-draft.png`
    const copy = () => fs.copyFile({
      srcPath: src,
      destPath: dest,
      success: () => show(dest),
      fail: () => show(src)
    })
    fs.unlink({ filePath: dest, complete: copy })
  },
  onAvatarError() {
    this.setData({ avatarBroken: true })
  },
  toggleEditGroups(event) {
    const clubId = event.currentTarget.dataset.club
    this.setData({
      editingClubId: this.data.editingClubId === clubId ? '' : clubId
    })
  },
  onPickGroup(event) {
    const clubId = event.currentTarget.dataset.club
    const groupId = event.currentTarget.dataset.id
    const club = (this.data.clubs || []).find((item) => item._id === clubId)
    if (!club || !club.joined) return
    if (club.groupId === groupId) return
    const group = (club.groups || []).find((item) => item.id === groupId)
    const groupName = (group && group.name) || '该组'
    wx.showModal({
      title: '切换默认分组',
      content: `之后新报名默认进「${groupName}」。已报过的场次不会改。`,
      confirmText: '确认切换',
      confirmColor: '#0f3d2e',
      success: (res) => {
        if (!res.confirm) return
        this.applyGroup(club, groupId)
      }
    })
  },
  applyGroup(club, groupId) {
    if (!isMultiClubReady()) {
      call('saveProfile', {
        name: this.data.name,
        teamId: groupId,
        preferredPosition: this.data.preferredPosition || 'mf'
      }).then((res) => {
        const clubs = (this.data.clubs || []).map((item) => (
          item._id === club._id ? Object.assign({}, item, { groupId }) : item
        ))
        this.setData({
          teamId: (res.user && res.user.teamId) || groupId,
          clubs: decorateClubs(clubs, false)
        })
        wx.showToast({ title: '已切换', icon: 'success' })
      })
      return
    }
    call('setMyGroup', { clubId: club._id, groupId }).then(() => {
      this.setData({ teamId: groupId })
      wx.showToast({ title: '已切换', icon: 'success' })
      this.loadClubs()
    })
  },
  onGroupName(event) {
    const clubId = event.currentTarget.dataset.club
    const index = Number(event.currentTarget.dataset.index)
    const clubs = this.data.clubs.map((club) => {
      if (club._id !== clubId) return club
      const groups = (club.groups || []).slice()
      groups[index] = Object.assign({}, groups[index], { name: event.detail.value })
      return Object.assign({}, club, { groups })
    })
    this.setData({ clubs })
  },
  saveGroupName(event) {
    const clubId = event.currentTarget.dataset.club
    const index = Number(event.currentTarget.dataset.index)
    const club = (this.data.clubs || []).find((item) => item._id === clubId)
    if (!club || !club.groups[index]) return
    const group = club.groups[index]
    call('updateClubGroup', {
      clubId,
      groupId: group.id,
      name: group.name
    }).then(() => wx.showToast({ title: '已改名', icon: 'success' }))
  },
  persistProfile(opts) {
    const options = opts || {}
    const checked = assertPlayerName(this.data.name)
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' })
      return
    }
    const name = checked.name
    const preferredPosition = options.preferredPosition || this.data.preferredPosition || 'mf'
    const forceAvatar = !!options.forceAvatar
    const nameChanged = name !== (this._savedName || '')
    const positionChanged = preferredPosition !== (this._savedPosition || '')
    if (!forceAvatar && !nameChanged && !positionChanged && !this.data.tempAvatar) return
    if (this.data.saving) {
      this._pendingPersist = options
      return
    }

    this.setData({ saving: true, justSaved: false })
    const finish = (avatarUrl) => {
      const wed = (this.data.clubs || []).find((item) => item._id === 'club_wednesday')
      const wedTeamId = (wed && wed.groupId) || this.data.teamId || ''
      const payload = {
        name,
        preferredPosition
      }
      if (wedTeamId) payload.teamId = wedTeamId
      if (typeof avatarUrl === 'string') payload.avatarUrl = avatarUrl
      call('saveProfile', payload).then((res) => {
        this._savedName = res.user.name || name
        this._savedPosition = res.user.preferredPosition || preferredPosition
        this.setData({
          name: this._savedName,
          avatarUrl: res.user.avatarUrl || '',
          avatarPreview: res.user.avatarUrl || this.data.avatarPreview,
          preferredPosition: this._savedPosition,
          tempAvatar: '',
          teamId: res.user.teamId || payload.teamId,
          avatarChar: avatarChar(this._savedName),
          avatarBg: avatarColor(this._savedName),
          saving: false,
          justSaved: true
        })
        if (this._savedFlash) clearTimeout(this._savedFlash)
        this._savedFlash = setTimeout(() => this.setData({ justSaved: false }), 1600)
        if (this._pendingPersist) {
          const pending = this._pendingPersist
          this._pendingPersist = null
          this.persistProfile(pending)
        }
      }).catch((err) => {
        this.setData({ saving: false })
        wx.showToast({ title: err.message || '同步失败', icon: 'none' })
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
