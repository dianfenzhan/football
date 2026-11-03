const { call, callQuiet, uploadAvatar, avatarChar, avatarColor, assertPlayerName } = require('../../utils/api')
const { PREFERRED_POSITIONS, positionLabel } = require('../../utils/tactics')
const { resolveFilter, clubLabel, setMultiClubReady, joinedClubs, normalizeClubs } = require('../../utils/club-context')

const DEFAULT_TEAM_ID = 'team_jiong'
const CAPTAIN_NAMES = new Set(['jzy', '肉粽'])

function isCaptain(item) {
  if (!item) return false
  return CAPTAIN_NAMES.has(String(item.name || '').trim().toLowerCase())
}

function playerRank(item) {
  if (isCaptain(item)) return 0
  if (item && (item.isClubAdmin || item.isAdmin)) return 1
  return 2
}

function myRoleOnClub(clubs, clubId) {
  const club = (clubs || []).find((item) => item._id === clubId)
  return (club && club.role) || ''
}

Page({
  data: {
    positions: PREFERRED_POSITIONS,
    groupFilters: [],
    groupId: 'all',
    all: [],
    players: [],
    clubs: [],
    viewClubFilter: 'all',
    clubFilterLabel: '全部',
    activeClubId: 'club_wednesday',
    canEditPlayers: false,
    canGrantThisClub: false,
    loading: true,
    grantingId: '',
    showEditModal: false,
    editingPlayerId: '',
    editName: '',
    editPosition: 'mf',
    editAvatarPreview: '',
    editTempAvatar: '',
    editAvatarChar: '?',
    editAvatarBg: '#0f3d2e',
    editIsClubAdmin: false,
    editCanToggleAdmin: false,
    editPlayerStats: {
      activities: 0,
      goals: 0,
      assists: 0,
      ownGoals: 0,
      absences: 0
    },
    savingPlayer: false
  },
  onShow() {
    this.load()
  },
  onFilterChange() {
    this.load()
  },
  load() {
    Promise.all([
      call('me'),
      call('listPlayers'),
      callQuiet('orgMe').catch(() => null)
    ]).then(([meRes, listRes, org]) => {
      if (org) setMultiClubReady(true)
      else setMultiClubReady(false)
      const clubs = normalizeClubs((org && org.clubs) || [], meRes.user, meRes.teams)
      const viewClubFilter = resolveFilter(clubs)
      if (!joinedClubs(clubs).length) {
        this.setData({
          clubs,
          viewClubFilter: '',
          clubFilterLabel: clubLabel(''),
          activeClubId: '',
          canEditPlayers: false,
          canGrantThisClub: false,
          groupFilters: [],
          all: [],
          players: [],
          loading: false
        })
        return
      }
      const activeClubId = viewClubFilter === 'club_jielong'
        ? 'club_jielong'
        : (viewClubFilter === 'all' ? 'club_wednesday' : viewClubFilter)
      const user = meRes.user
      const myRole = myRoleOnClub(clubs, activeClubId)
        || (user && user.canGrantAdmin ? 'owner' : '')
        || (activeClubId === 'club_wednesday' && user && user.isAdmin ? 'admin' : '')
      // 「全部」只读：改资料 / 授权必须先切到具体球队
      const canGrantThisClub = viewClubFilter !== 'all' && (myRole === 'owner' || myRole === 'admin')
      const canEditPlayers = canGrantThisClub
      const activeClub = clubs.find((item) => item._id === activeClubId)
      // 只有筛「周三联」时才出分组；「全部」出分组会点了不生效
      const standingGroups = (activeClub && activeClub.groups) || (
        viewClubFilter === 'club_wednesday'
          ? [
            { id: 'team_jiong', name: 'jiong 路青少年' },
            { id: 'team_pudong', name: '浦东老聚三' }
          ]
          : []
      )
      const groupFilters = (viewClubFilter === 'club_wednesday' || viewClubFilter === 'club_jielong')
        && standingGroups.length
        ? [{ id: 'all', name: '全部' }].concat(standingGroups.map((group) => ({ id: group.id, name: group.name })))
        : []
      const myMemberships = (user && user.memberships) || []
      const iJoinedJielong = myMemberships.some((m) => m && m.clubId === 'club_jielong')
        || !!(user && user.canGrantAdmin)
      const all = (listRes.users || []).map((item) => {
        const role = ((item.clubRoles || {})[activeClubId]) || ''
        const joinedWednesday = item.clubJoined
          ? !!item.clubJoined.club_wednesday
          : !!item.teamId
        let joinedJielong = !!(item.clubJoined && item.clubJoined.club_jielong)
        // 旧云函数没有 clubJoined：本人用 memberships 兜底，避免界龙球员页空白
        if (!joinedJielong && user && item._id === user._id && iJoinedJielong) joinedJielong = true
        if (!joinedJielong && item.canGrantAdmin) joinedJielong = true
        const joined = activeClubId === 'club_jielong' ? joinedJielong : joinedWednesday
        let isClubAdmin = role === 'admin' || role === 'owner'
          || (activeClubId === 'club_wednesday' && !!item.isAdmin)
        if (activeClubId === 'club_jielong' && user && item._id === user._id) {
          const mine = myMemberships.find((m) => m && m.clubId === 'club_jielong')
          if (mine && (mine.role === 'admin' || mine.role === 'owner')) isClubAdmin = true
          if (user.canGrantAdmin) isClubAdmin = true
        }
        const effectiveRole = role
          || (isClubAdmin && user && item._id === user._id && user.canGrantAdmin ? 'owner' : '')
          || (isClubAdmin ? 'admin' : '')
        const rawClubStats = (item.clubStats && item.clubStats[activeClubId]) || null
        const currentClubStats = canEditPlayers && rawClubStats
          ? {
            activities: Number(rawClubStats.activities) || 0,
            goals: Number(rawClubStats.goals) || 0,
            assists: Number(rawClubStats.assists) || 0,
            ownGoals: Number(rawClubStats.ownGoals) || 0,
            absences: Number(rawClubStats.absences) || 0
          }
          : null
        return {
          ...item,
          preferredPosition: item.preferredPosition || 'mf',
          positionLabel: positionLabel(item.preferredPosition || 'mf'),
          avatarChar: avatarChar(item.name),
          avatarBg: avatarColor(item.name),
          joinedWednesday,
          joinedJielong,
          joinedActiveClub: joined,
          clubRole: effectiveRole || role,
          isClubAdmin,
          canToggleAdmin: joined && !item.canGrantAdmin && effectiveRole !== 'owner' && role !== 'owner',
          clubAdminTag: (effectiveRole === 'owner' || (item.canGrantAdmin && activeClubId === 'club_jielong'))
            ? '主管理'
            : (isClubAdmin ? '管理员' : ''),
          metaText: activeClubId === 'club_wednesday'
            ? ''
            : (joined ? '界龙散客队' : ''),
          currentClubStats,
          groupId: (item.clubGroupIds && item.clubGroupIds[activeClubId])
            || item.groupId
            || (user && item._id === user._id
              ? ((myMemberships.find((m) => m && m.clubId === activeClubId) || {}).groupId || '')
              : '')
            || (activeClubId === 'club_wednesday' ? (item.teamId || '') : '')
        }
      })
      this.setData({
        clubs,
        viewClubFilter,
        clubFilterLabel: clubLabel(viewClubFilter),
        activeClubId,
        canEditPlayers,
        canGrantThisClub,
        groupFilters,
        groupId: groupFilters.some((item) => item.id === this.data.groupId) ? this.data.groupId : 'all',
        all,
        loading: false
      })
      this.applyFilter()
    }).catch(() => this.setData({ loading: false }))
  },
  applyFilter() {
    const { all, activeClubId, groupId, viewClubFilter } = this.data
    let list = all.slice()
    if (!viewClubFilter) {
      list = []
    } else if (viewClubFilter === 'club_jielong') {
      list = list.filter((item) => item.joinedJielong)
      if (groupId && groupId !== 'all') {
        list = list.filter((item) => item.groupId === groupId)
      }
    } else if (viewClubFilter === 'club_wednesday') {
      list = list.filter((item) => item.joinedWednesday)
      if (groupId && groupId !== 'all') {
        list = list.filter((item) => item.teamId === groupId || item.groupId === groupId)
      }
    } else {
      list = list.filter((item) => item.joinedWednesday || item.joinedJielong)
    }
    const players = list
      .map((item) => ({
        ...item,
        isCaptain: viewClubFilter === 'club_wednesday' && isCaptain(item),
        metaText: viewClubFilter === 'all'
          ? [
            item.joinedWednesday ? '周三联' : '',
            item.joinedJielong ? '界龙' : ''
          ].filter(Boolean).join(' · ')
          : item.metaText
      }))
      .sort((a, b) => {
        const byRank = playerRank(a) - playerRank(b)
        if (byRank !== 0) return byRank
        return (b.createdAt || 0) - (a.createdAt || 0)
      })
    this.setData({ players })
  },
  onGroup(event) {
    this.setData({ groupId: event.currentTarget.dataset.id })
    this.applyFilter()
  },
  onGrant(event) {
    if (!this.data.canGrantThisClub) return
    const userId = event.currentTarget.dataset.id
    const name = event.currentTarget.dataset.name || '该队员'
    const isAdmin = !!event.detail.value
    const clubName = this.data.clubFilterLabel || '本队'
    // switch 已经先翻了，取消时靠 reload 复位
    wx.showModal({
      title: isAdmin ? '设为本队管理员' : '取消本队管理员',
      content: isAdmin
        ? `确定让「${name}」成为「${clubName}」的管理员吗？\n他可以建活动、记分、改本队设置，但不能管其他球队。`
        : `确定取消「${name}」在「${clubName}」的管理员权限吗？\n取消后他不能再建活动或记分。`,
      confirmText: isAdmin ? '确认授权' : '确认取消',
      confirmColor: isAdmin ? '#0f3d2e' : '#8c3a2f',
      success: (res) => {
        if (!res.confirm) {
          this.load()
          return
        }
        this.setData({ grantingId: userId })
        call('setClubAdmin', {
          clubId: this.data.activeClubId,
          userId,
          isAdmin
        }).then(() => {
          this.setData({ grantingId: '' })
          wx.showToast({
            title: isAdmin ? `已设为${clubName}管理员` : '已取消管理员',
            icon: 'none'
          })
          this.load()
        }).catch((err) => {
          this.setData({ grantingId: '' })
          wx.showToast({ title: (err && err.message) || '授权失败', icon: 'none' })
          this.load()
        })
      }
    })
  },
  onTapPlayer(event) {
    if (!this.data.canEditPlayers) return
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
      editAvatarBg: avatarColor(target.name),
      editIsClubAdmin: !!target.isClubAdmin,
      editCanToggleAdmin: !!target.canToggleAdmin,
      editPlayerStats: target.currentClubStats || {
        activities: 0,
        goals: 0,
        assists: 0,
        ownGoals: 0,
        absences: 0
      }
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
  onEditGrant(event) {
    this.setData({ editIsClubAdmin: !!event.detail.value })
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
    const checked = assertPlayerName(this.data.editName, '请填写姓名')
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' })
      return
    }
    const name = checked.name
    this.setData({ savingPlayer: true })
    const submit = (avatarUrl) => {
      const payload = {
        userId: this.data.editingPlayerId,
        name,
        preferredPosition: this.data.editPosition || 'mf'
      }
      if (typeof avatarUrl === 'string') payload.avatarUrl = avatarUrl
      const jobs = [call('adminUpdatePlayer', payload)]
      if (this.data.canGrantThisClub && this.data.editCanToggleAdmin) {
        jobs.push(call('setClubAdmin', {
          clubId: this.data.activeClubId,
          userId: this.data.editingPlayerId,
          isAdmin: !!this.data.editIsClubAdmin
        }))
      }
      Promise.all(jobs).then(() => {
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
