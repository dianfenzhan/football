const { call, callQuiet, uploadAvatar, assertPlayerName } = require('../../utils/api')
const { PREFERRED_POSITIONS } = require('../../utils/tactics')
const { setMultiClubReady } = require('../../utils/club-context')

const JIELONG_DEFAULT_GROUP = 'jl_other'

function rawGroupId(user, clubId) {
  const hit = ((user && user.memberships) || []).find((item) => item && item.clubId === clubId)
  if (hit && hit.groupId) return String(hit.groupId)
  if (clubId === 'club_wednesday' && user && user.teamId) return String(user.teamId)
  return ''
}

function hasCompleteMembership(club, user) {
  if (!club || !club.joined) return false
  const groups = club.groups || []
  const raw = rawGroupId(user, club._id)
  if (raw) return groups.some((group) => group.id === raw)
  // 有用户资料但库内无分组 → 须弹窗确认；me 拉取失败时才退回 org 视图
  if (user) return false
  return !!(club.groupId && groups.some((group) => group.id === club.groupId))
}

function canInviteClub(club) {
  return !!(club && club.joined && (club.role === 'owner' || club.role === 'admin'))
}

Page({
  data: {
    clubs: [],
    me: null,
    positions: PREFERRED_POSITIONS,
    colors: [
      { id: 'red', label: '红', color: '#c44536' },
      { id: 'orange', label: '橙', color: '#e67e22' },
      { id: 'yellow', label: '黄', color: '#e6b325' },
      { id: 'green', label: '绿', color: '#1d6b50' },
      { id: 'cyan', label: '青', color: '#1abc9c' },
      { id: 'blue', label: '蓝', color: '#3d5a80' },
      { id: 'purple', label: '紫', color: '#7b5ea7' },
      { id: 'pink', label: '粉', color: '#e091b0' },
      { id: 'pinkwhite', label: '粉白', color: '#f4c2c2' },
      { id: 'white', label: '白', color: '#f4f4f4' },
      { id: 'gray', label: '灰', color: '#66706c' },
      { id: 'black', label: '黑', color: '#1c2421' },
      {
        id: 'rainbow',
        label: '彩虹',
        color: 'linear-gradient(135deg,#e40303 0%,#ff8c00 20%,#ffed00 40%,#008026 60%,#24408e 80%,#732982 100%)'
      }
    ],
    inviteClubId: '',
    showInvite: false,
    inviteTitle: '',
    inviteGroups: [],
    regName: '',
    regAvatarUrl: '',
    regTempAvatar: '',
    regPosition: '',
    pickGroupId: '',
    regSaving: false
  },
  onLoad(query) {
    const invite = query && (query.invite === '1' || query.invite === 'true')
    const clubId = query && query.clubId ? String(query.clubId).trim() : ''
    if (invite && clubId) this._pendingInviteClubId = clubId
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
  },
  onShow() {
    this.load()
  },
  onFilterChange() {
    // 顶栏已写入全局筛选
  },
  onShareAppMessage(res) {
    const fromButton = res && res.target && res.target.dataset && res.target.dataset.club
    const clubId = fromButton || this.data.inviteClubId || this._pendingInviteClubId || ''
    const club = this.clubOf(clubId)
    const name = (club && club.name) || '球队'
    return {
      title: `邀请你加入${name}`,
      path: `/pages/club/club?invite=1&clubId=${clubId || ''}`
    }
  },
  clubOf(clubId) {
    return (this.data.clubs || []).find((item) => item._id === clubId)
  },
  load() {
    Promise.all([
      callQuiet('orgMe'),
      callQuiet('me').catch(() => null)
    ]).then(([org, profile]) => {
      setMultiClubReady(true)
      const me = (profile && profile.user) || null
      const clubs = (org.clubs || []).map((club) => Object.assign({}, club, {
        canInvite: canInviteClub(club)
      }))
      this.setData({ clubs, me })
      this.handlePendingInvite()
    }).catch(() => {
      setMultiClubReady(false)
      this.setData({ clubs: [], me: null })
      wx.showToast({ title: '球队接口未就绪，先看活动页', icon: 'none' })
    })
  },
  handlePendingInvite() {
    const clubId = this._pendingInviteClubId
    if (!clubId) return
    this._pendingInviteClubId = ''
    const club = this.clubOf(clubId)
    if (!club) {
      wx.showToast({ title: '球队不存在或暂不可用', icon: 'none' })
      return
    }
    if (hasCompleteMembership(club, this.data.me)) {
      callQuiet('switchClub', { clubId }).catch(() => {})
      wx.showToast({ title: `您已经是${club.name}队员了`, icon: 'none', duration: 2500 })
      return
    }
    this.openInviteSheet(club)
  },
  openInviteSheet(club) {
    const me = this.data.me
    const groups = club.groups || []
    const existingGroup = rawGroupId(me, club._id)
    let pickGroupId = ''
    if (existingGroup && groups.some((item) => item.id === existingGroup)) {
      pickGroupId = existingGroup
    } else if (club._id === 'club_jielong' && groups.some((item) => item.id === JIELONG_DEFAULT_GROUP)) {
      // 界龙默认散客名册组（jl_other / 未分组），用户可改
      pickGroupId = JIELONG_DEFAULT_GROUP
    }
    this.setData({
      showInvite: true,
      inviteClubId: club._id,
      inviteTitle: `加入${club.name}`,
      inviteGroups: groups,
      regName: (me && me.name) || '',
      regAvatarUrl: (me && me.avatarUrl) || '',
      regTempAvatar: '',
      regPosition: (me && me.preferredPosition) || '',
      pickGroupId,
      regSaving: false
    })
  },
  closeInvite() {
    this.setData({ showInvite: false, regSaving: false, regTempAvatar: '' })
  },
  onChooseAvatar(event) {
    const url = event.detail && event.detail.avatarUrl
    if (!url) return
    this.setData({ regAvatarUrl: url, regTempAvatar: url })
  },
  onRegName(event) {
    this.setData({ regName: event.detail.value })
  },
  onRegPosition(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    this.setData({ regPosition: this.data.regPosition === id ? '' : id })
  },
  onPickGroup(event) {
    this.setData({ pickGroupId: event.currentTarget.dataset.id })
  },
  noop() {},
  submitInvite() {
    if (this.data.regSaving) return
    const checked = assertPlayerName(this.data.regName)
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' })
      return
    }
    const groupId = this.data.pickGroupId
    if (!groupId || !this.data.inviteGroups.some((item) => item.id === groupId)) {
      wx.showToast({ title: '请选择分组', icon: 'none' })
      return
    }
    const clubId = this.data.inviteClubId
    this.setData({ regSaving: true })
    const openid = this.data.me && this.data.me._openid
    const tempAvatar = this.data.regTempAvatar
    const save = (avatarUrl) => {
      const payload = {
        name: checked.name,
        clubId,
        groupId,
        preferredPosition: this.data.regPosition || ''
      }
      if (clubId === 'club_wednesday') payload.teamId = groupId
      if (typeof avatarUrl === 'string') payload.avatarUrl = avatarUrl
      return call('saveProfile', payload).then(() => {
        this.setData({ showInvite: false, regSaving: false, regTempAvatar: '' })
        wx.showToast({ title: '已加入', icon: 'success' })
        this.load()
      })
    }
    const fail = () => this.setData({ regSaving: false })
    if (tempAvatar) {
      uploadAvatar(tempAvatar, openid)
        .then((fileID) => save(fileID).catch(fail))
        .catch(fail)
    } else {
      save(this.data.me ? undefined : '').catch(fail)
    }
  },
  onPick(event) {
    const clubId = event.currentTarget.dataset.club
    const groupId = event.currentTarget.dataset.id
    const club = this.clubOf(clubId)
    if (!club) return
    const action = club.joined ? 'setMyGroup' : 'joinClub'
    call(action, { clubId, groupId }).then(() => {
      wx.showToast({ title: club.joined ? '以后默认报这组' : '已加入' })
      this.load()
    })
  },
  onName(event) {
    const clubId = event.currentTarget.dataset.club
    const index = Number(event.currentTarget.dataset.index)
    const clubs = this.data.clubs.map((club) => {
      if (club._id !== clubId) return club
      const groups = club.groups.slice()
      groups[index] = Object.assign({}, groups[index], { name: event.detail.value })
      return Object.assign({}, club, { groups })
    })
    this.setData({ clubs })
  },
  saveName(event) {
    const clubId = event.currentTarget.dataset.club
    const index = Number(event.currentTarget.dataset.index)
    const club = this.clubOf(clubId)
    if (!club) return
    const group = club.groups[index]
    call('updateClubGroup', {
      clubId,
      groupId: group.id,
      name: group.name
    }).then(() => wx.showToast({ title: '已改名' }))
  },
  onColor(event) {
    const id = event.currentTarget.dataset.id
    const swatch = (this.data.colors || []).find((item) => item.id === id)
    if (!swatch || !swatch.color) return
    call('updateClubGroup', {
      clubId: event.currentTarget.dataset.club,
      groupId: event.currentTarget.dataset.group,
      color: swatch.color,
      jerseyColor: swatch.label
    }).then(() => this.load())
  },
  move(event) {
    const clubId = event.currentTarget.dataset.club
    const index = Number(event.currentTarget.dataset.index)
    const dir = Number(event.currentTarget.dataset.dir)
    const club = this.clubOf(clubId)
    if (!club) return
    const groups = club.groups.slice()
    const next = index + dir
    if (next < 0 || next >= groups.length) return
    const swapped = groups[index]
    groups[index] = groups[next]
    groups[next] = swapped
    call('reorderClubGroups', {
      clubId,
      orderedIds: groups.map((group) => group.id)
    }).then((res) => {
      const clubs = this.data.clubs.map((item) => (
        item._id === clubId ? Object.assign({}, item, { groups: res.groups, canInvite: canInviteClub(item) }) : item
      ))
      this.setData({ clubs })
    })
  }
})
