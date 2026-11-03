const FILTER_ALL = 'all'
const STORAGE_KEY = 'viewClubFilter'

let multiClubReady = false

function setMultiClubReady(ok) {
  multiClubReady = !!ok
}

function isMultiClubReady() {
  return multiClubReady
}

function joinedClubs(clubs) {
  return (Array.isArray(clubs) ? clubs : []).filter((club) => club && club.joined && club._id)
}

function fallbackClubsFromProfile(user, teams) {
  if (!user) return []
  const defaultRole = user.canGrantAdmin ? 'owner' : (user.isAdmin ? 'admin' : 'member')
  const groupSource = (teams && teams.length)
    ? teams
    : [
      { _id: 'team_jiong', name: 'jiong 路青少年' },
      { _id: 'team_pudong', name: '浦东老聚三' }
    ]
  const groups = groupSource.map((team) => ({
    id: team._id || team.id,
    name: team.name,
    color: team.color || ''
  })).filter((group) => group.id)
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
          groups: []
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
          groups
        })
      }
    })
    if (clubs.length) return clubs
  }
  // 旧档：有周三联球队/管理员身份，视为已加入周三联
  if (!(user.teamId || user.isAdmin || user.canGrantAdmin)) return []
  return [{
    _id: 'club_wednesday',
    name: '周三联',
    joined: true,
    role: defaultRole,
    groupId: user.teamId || '',
    groups
  }]
}

/** orgMe 结果 + 可选 me.user：保证老用户/旧云函数也能认出已加入 */
function normalizeClubs(clubs, user, teams) {
  const list = Array.isArray(clubs) ? clubs.map((club) => Object.assign({}, club)) : []
  if (joinedClubs(list).length) return list
  if (user && user.teamId) {
    const patched = list.map((club) => (
      club._id === 'club_wednesday'
        ? Object.assign({}, club, {
          joined: true,
          groupId: club.groupId || user.teamId,
          role: club.role || (user.canGrantAdmin ? 'owner' : (user.isAdmin ? 'admin' : 'member'))
        })
        : club
    ))
    if (joinedClubs(patched).length) return patched
  }
  return fallbackClubsFromProfile(user, teams)
}

function readFilter() {
  const value = wx.getStorageSync(STORAGE_KEY)
  if (value === 'club_wednesday' || value === 'club_jielong' || value === FILTER_ALL) return value
  const legacy = wx.getStorageSync('currentClubId')
  if (legacy === 'club_wednesday' || legacy === 'club_jielong') return legacy
  return FILTER_ALL
}

function writeFilter(clubId) {
  const next = clubId === 'club_wednesday' || clubId === 'club_jielong' ? clubId : FILTER_ALL
  wx.setStorageSync(STORAGE_KEY, next)
  if (next !== FILTER_ALL) wx.setStorageSync('currentClubId', next)
  return next
}

/** 只展示已加入的球队；只有一支时不出现「全部」；未加入则空列表 */
function filterOptions(clubs) {
  const joined = joinedClubs(clubs)
  if (!joined.length) return []
  if (joined.length === 1) {
    return [{ id: joined[0]._id, name: joined[0].name || joined[0]._id }]
  }
  return [{ id: FILTER_ALL, name: '全部' }].concat(
    joined.map((club) => ({ id: club._id, name: club.name || club._id }))
  )
}

/** 按已加入球队校正当前筛选；未加入返回空串 */
function resolveFilter(clubs) {
  const joined = joinedClubs(clubs)
  if (!joined.length) return ''
  if (joined.length === 1) {
    const only = joined[0]._id
    writeFilter(only)
    return only
  }
  const current = readFilter()
  if (current === FILTER_ALL) return FILTER_ALL
  if (joined.some((club) => club._id === current)) return current
  return writeFilter(FILTER_ALL)
}

function clubLabel(clubId) {
  if (!clubId) return '未加入球队'
  if (clubId === 'club_jielong') return '界龙散客队'
  if (clubId === 'club_wednesday') return '周三联'
  return '全部'
}

function clubSubtitle(clubId) {
  if (clubId === 'club_jielong') return '先报名，老板当场再分队'
  if (clubId === 'club_wednesday') return '快乐踢球，周三是主场'
  return ''
}

function listPayload(page, filter) {
  const payload = { page: page || 1 }
  if (filter === 'club_jielong' || filter === 'club_wednesday') {
    payload.clubId = filter
  } else if (multiClubReady) {
    payload.clubId = FILTER_ALL
  }
  return payload
}

function summaryPayload(span, filter) {
  const payload = { span: span || '3m' }
  if (filter === 'club_jielong' || filter === 'club_wednesday') {
    payload.clubId = filter
  } else if (multiClubReady) {
    payload.clubId = FILTER_ALL
  }
  return payload
}

function pickPreferredCreateClub(filter, clubs) {
  if (filter === 'club_jielong' || filter === 'club_wednesday') return filter
  const joined = joinedClubs(clubs)
  if (joined.length === 1) return joined[0]._id
  return ''
}

/** 打开某场活动后，把列表筛选切到该队（已加入时） */
function syncFilterFromActivity(clubId, clubs) {
  const id = clubId === 'club_jielong' || clubId === 'club_wednesday' ? clubId : ''
  if (!id) return readFilter()
  const joined = joinedClubs(clubs)
  if (joined.length && !joined.some((club) => club._id === id)) return resolveFilter(clubs)
  return writeFilter(id)
}

function activityPageForClub(clubId) {
  return clubId === 'club_jielong' ? 'session' : 'activity'
}

function otherJoinedClub(clubs, currentClubId) {
  const joined = joinedClubs(clubs)
  if (joined.length < 2) return null
  if (currentClubId === 'club_jielong' || currentClubId === 'club_wednesday') {
    return joined.find((club) => club._id !== currentClubId) || null
  }
  return null
}

module.exports = {
  FILTER_ALL,
  setMultiClubReady,
  isMultiClubReady,
  joinedClubs,
  fallbackClubsFromProfile,
  normalizeClubs,
  readFilter,
  writeFilter,
  filterOptions,
  resolveFilter,
  clubLabel,
  clubSubtitle,
  listPayload,
  summaryPayload,
  pickPreferredCreateClub,
  syncFilterFromActivity,
  activityPageForClub,
  otherJoinedClub
}
