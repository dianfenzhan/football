const cloud = require('wx-server-sdk')
const {
  willRecordPigeon,
  defaultWaitHours,
  waitUntilAt
} = require('./rules')
const {
  VENUE_JIELONG,
  CLUB_WEDNESDAY,
  CLUB_JIELONG,
  PENDING_TEAM,
  JIELONG_DEFAULT_GROUP,
  CLUB_SEEDS,
  clubSeed,
  membershipView,
  withClubMembership,
  renameGroup,
  recolorGroup,
  reorderGroups,
  dividePlayers,
  placeInPool,
  assertAdminMove,
  rosterLocked,
  cupFixtures,
  shouldAutoFixture,
  rankTeams,
  finalsForFour,
  normalizeGoalEvent,
  normalizeTargetSize,
  normalizeTeamCount
} = require('./clubs')

const db = cloud.database()
const _ = db.command

async function findUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || null
}

async function requireUser(openid) {
  const user = await findUser(openid)
  if (!user) throw new Error('请先在「我的」里填写姓名和球队')
  return user
}

async function mustGet(collection, id) {
  const res = await db.collection(collection).doc(id).get().catch(() => null)
  if (!res || !res.data) throw new Error('记录不存在')
  return res.data
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (error) {
    // 已存在时忽略
  }
}

async function putIfMissing(collection, id, data) {
  await ensureCollection(collection)
  try {
    await db.collection(collection).doc(id).get()
  } catch (error) {
    await db.collection(collection).doc(id).set({ data })
  }
}

async function backfillLegacyWednesdayActivities() {
  // 旧活动没有 clubId：一次性打成周三联，方便筛选；已有 clubId 的不动
  const markerId = 'club_backfill_v1'
  await ensureCollection('meta')
  try {
    const marker = await db.collection('meta').doc(markerId).get()
    if (marker.data && marker.data.done) return
  } catch (error) {
    // meta 不存在则继续回填
  }
  let patched = 0
  const res = await db.collection('activities').orderBy('startTime', 'desc').limit(200).get()
  for (const activity of res.data) {
    if (activity.clubId) continue
    await db.collection('activities').doc(activity._id).update({
      data: { clubId: CLUB_WEDNESDAY }
    })
    patched += 1
  }
  await db.collection('meta').doc(markerId).set({
    data: { done: true, patched, at: Date.now() }
  })
}

async function ensureOrg() {
  await putIfMissing('venues', VENUE_JIELONG._id, {
    name: VENUE_JIELONG.name,
    address: VENUE_JIELONG.address,
    latitude: VENUE_JIELONG.latitude,
    longitude: VENUE_JIELONG.longitude,
    pitches: VENUE_JIELONG.pitches
  })
  for (const seed of CLUB_SEEDS) {
    await putIfMissing('clubs', seed._id, {
      name: seed.name,
      signupModes: seed.signupModes,
      groups: seed.groups,
      config: seed.config
    })
    // 已建档但 groups 为空时补种子六组（界龙曾短暂写成无常驻组）
    if ((seed.groups || []).length) {
      try {
        const existing = await db.collection('clubs').doc(seed._id).get()
        if (!(existing.data && existing.data.groups && existing.data.groups.length)) {
          await db.collection('clubs').doc(seed._id).update({ data: { groups: seed.groups } })
        }
      } catch (error) {
        // ignore
      }
    }
    await putIfMissing('club_venues', `${seed._id}__${VENUE_JIELONG._id}`, {
      clubId: seed._id,
      venueId: VENUE_JIELONG._id
    })
  }
  await backfillLegacyWednesdayActivities()
}

async function loadClub(clubId) {
  await ensureOrg()
  const club = await mustGet('clubs', clubId)
  const seed = clubSeed(clubId)
  const groups = (club.groups && club.groups.length)
    ? club.groups
    : ((seed && seed.groups) || [])
  return {
    _id: clubId,
    name: club.name || (seed && seed.name) || '',
    signupModes: club.signupModes || (seed && seed.signupModes) || ['split'],
    groups,
    config: Object.assign({}, seed && seed.config, club.config || {})
  }
}

function assertClubAdmin(user, clubId) {
  const view = membershipView(user, clubId)
  if (view.role !== 'owner' && view.role !== 'admin') throw new Error('只有这支球队的管理员可以操作')
  return view
}

function assertClubOwner(user, clubId) {
  const view = membershipView(user, clubId)
  if (view.role !== 'owner') throw new Error('只有主管理员可以改球队设置')
  return view
}

async function orgMe(openid) {
  await ensureOrg()
  const user = await findUser(openid)
  const clubs = []
  for (const seed of CLUB_SEEDS) {
    const club = await loadClub(seed._id)
    const view = membershipView(user, seed._id)
    clubs.push({
      _id: club._id,
      name: club.name,
      signupModes: club.signupModes,
      groups: club.groups,
      config: club.config,
      role: view.role,
      groupId: view.groupId,
      joined: view.joined
    })
  }
  const currentClubId = user && clubs.some((club) => club._id === user.currentClubId)
    ? user.currentClubId
    : CLUB_WEDNESDAY
  return { clubs, currentClubId, venue: { _id: VENUE_JIELONG._id, name: VENUE_JIELONG.name } }
}

function resolveJielongGroupId(club, requested) {
  const raw = String(requested || '').trim()
  if (raw && club.groups.some((item) => item.id === raw)) return raw
  if (club.groups.some((item) => item.id === JIELONG_DEFAULT_GROUP)) return JIELONG_DEFAULT_GROUP
  return (club.groups[0] && club.groups[0].id) || JIELONG_DEFAULT_GROUP
}

async function joinClub(openid, event) {
  const user = await requireUser(openid)
  const club = await loadClub(event.clubId)
  let groupId = ''
  if (club._id === CLUB_WEDNESDAY) {
    const group = club.groups.find((item) => item.id === event.groupId)
    if (!group) throw new Error('请选择分组')
    groupId = group.id
  } else if (club._id === CLUB_JIELONG) {
    // 名册组必选；未传或非法时落到「散客⚽️」
    groupId = resolveJielongGroupId(club, event.groupId)
  }
  const current = membershipView(user, club._id)
  const role = current.role === 'owner' || current.role === 'admin' ? current.role : 'member'
  const memberships = withClubMembership(user.memberships, club._id, { groupId, role })
  await db.collection('users').doc(user._id).update({
    data: { memberships, currentClubId: club._id, updatedAt: Date.now() }
  })
  return orgMe(openid)
}

async function setMyGroup(openid, event) {
  const user = await requireUser(openid)
  const club = await loadClub(event.clubId)
  const view = membershipView(user, club._id)
  if (!view.joined) throw new Error('请先加入这支球队')
  const group = club.groups.find((item) => item.id === event.groupId)
  if (!group) throw new Error('请选择分组')
  const patch = {
    groupId: group.id,
    role: view.role === 'member' ? 'member' : view.role
  }
  const memberships = withClubMembership(user.memberships, club._id, patch)
  const data = { memberships, updatedAt: Date.now() }
  if (club._id === CLUB_WEDNESDAY) data.teamId = group.id
  await db.collection('users').doc(user._id).update({ data })
  return { clubId: club._id, groupId: group.id }
}

async function switchClub(openid, event) {
  const user = await requireUser(openid)
  const club = await loadClub(event.clubId)
  const view = membershipView(user, club._id)
  if (!view.joined) throw new Error('请先加入这支球队')
  await db.collection('users').doc(user._id).update({
    data: { currentClubId: club._id, updatedAt: Date.now() }
  })
  return { currentClubId: club._id }
}

async function updateClubGroup(openid, event) {
  const user = await requireUser(openid)
  const club = await loadClub(event.clubId)
  assertClubAdmin(user, club._id)
  let groups = club.groups
  if (event.name != null) groups = renameGroup(groups, event.groupId, event.name)
  if (event.color || event.jerseyColor) {
    assertClubOwner(user, club._id)
    groups = recolorGroup(groups, event.groupId, event.color, event.jerseyColor)
  }
  await db.collection('clubs').doc(club._id).update({ data: { groups } })
  return { groups }
}

async function reorderClubGroups(openid, event) {
  const user = await requireUser(openid)
  const club = await loadClub(event.clubId)
  assertClubOwner(user, club._id)
  const groups = reorderGroups(club.groups, event.orderedIds)
  await db.collection('clubs').doc(club._id).update({ data: { groups } })
  return { groups }
}

async function setClubAdmin(openid, event) {
  const user = await requireUser(openid)
  const club = await loadClub(event.clubId)
  // 本队主管理员、普通管理员都能授本队管理员；超管经 membershipView 视为 owner
  assertClubAdmin(user, club._id)
  const target = await mustGet('users', event.userId)
  if (target._openid === openid) throw new Error('不能改自己的权限')
  if (target.canGrantAdmin) throw new Error('不能修改授权人')
  const targetView = membershipView(target, club._id)
  if (targetView.role === 'owner') throw new Error('不能改主管理员')
  const wantAdmin = event.isAdmin === true || event.role === 'admin'
  // 主/管授权时可顺带拉进本队，避免「还没加入」卡死设管理员
  if (!targetView.joined && !wantAdmin) throw new Error('对方还没加入这支球队')
  const role = wantAdmin ? 'admin' : 'member'
  const memberships = withClubMembership(target.memberships, club._id, {
    role,
    groupId: targetView.groupId
  })
  const patch = { memberships, updatedAt: Date.now() }
  // 周三联仍兼容旧的全局 isAdmin 标记
  if (club._id === CLUB_WEDNESDAY) patch.isAdmin = wantAdmin
  await db.collection('users').doc(target._id).update({ data: patch })
  return { userId: target._id, role, clubId: club._id }
}

async function createActivity(openid, event) {
  const user = await requireUser(openid)
  const club = await loadClub(CLUB_JIELONG)
  assertClubAdmin(user, club._id)
  const title = String(event.title || '').trim()
  const location = String(event.location || '').trim()
  const startTime = Number(event.startTime)
  if (!title) throw new Error('请填写标题')
  if (!location) throw new Error('请填写地点')
  if (!startTime) throw new Error('请选择时间')
  let maxSignedPlayers = event.maxSignedPlayers == null
    ? (club.config.maxSignedPlayers || 40)
    : Number(event.maxSignedPlayers)
  if (!Number.isInteger(maxSignedPlayers) || maxSignedPlayers < 1 || maxSignedPlayers > 99) {
    throw new Error('本场报名上限不合法')
  }
  const added = await db.collection('activities').add({
    data: {
      title,
      location,
      startTime,
      endTime: startTime + 2 * 60 * 60 * 1000,
      signupMode: 'pool',
      status: 'open',
      clubId: club._id,
      venueId: VENUE_JIELONG._id,
      sessionType: 'kick',
      pitchIds: ['pitch_1', 'pitch_2'],
      teams: [],
      teamCount: 0,
      targetPerTeam: club.config.defaultTeamSize || 8,
      divided: false,
      maxSignedPlayers,
      createdBy: openid,
      createdAt: Date.now()
    }
  })
  return { activityId: added._id }
}

async function updateActivityBasics(openid, event) {
  const activity = await mustGet('activities', event.activityId)
  const clubId = activity.clubId || CLUB_WEDNESDAY
  const user = await requireUser(openid)
  assertClubAdmin(user, clubId)
  if (activity.startTime <= Date.now()) throw new Error('开赛后不能改标题、时间和地点')
  const data = { updatedAt: Date.now() }
  if (event.title != null) {
    const title = String(event.title).trim()
    if (!title) throw new Error('请填写标题')
    data.title = title
  }
  if (event.location != null) {
    const location = String(event.location).trim()
    if (!location) throw new Error('请填写地点')
    data.location = location
  }
  if (event.startTime != null) {
    const startTime = Number(event.startTime)
    if (!startTime || startTime <= Date.now()) throw new Error('请选择还没到的开赛时间')
    data.startTime = startTime
    data.endTime = startTime + 2 * 60 * 60 * 1000
  }
  if (activity.clubId === CLUB_JIELONG && event.maxSignedPlayers != null) {
    const maxSignedPlayers = Number(event.maxSignedPlayers)
    const signed = await db.collection('signups').where({ activityId: activity._id, status: 'signed' }).count()
    if (!Number.isInteger(maxSignedPlayers) || maxSignedPlayers < signed.total) {
      throw new Error('报名上限不能低于已报名正选')
    }
    data.maxSignedPlayers = maxSignedPlayers
  }
  await db.collection('activities').doc(activity._id).update({ data })
  return { activityId: activity._id }
}

async function signup(openid, event) {
  const user = await requireUser(openid)
  const activity = await mustGet('activities', event.activityId)
  if (activity.clubId !== CLUB_JIELONG) throw new Error('这场不是界龙散客')
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，报名已截止。')
  const club = await loadClub(CLUB_JIELONG)
  let view = membershipView(user, CLUB_JIELONG)
  const rosterGroupId = resolveJielongGroupId(club, event.groupId || view.groupId)
  if (!view.joined) {
    const memberships = withClubMembership(user.memberships, CLUB_JIELONG, {
      role: 'member',
      groupId: rosterGroupId
    })
    await db.collection('users').doc(user._id).update({
      data: { memberships, currentClubId: CLUB_JIELONG, updatedAt: Date.now() }
    })
    view = membershipView({ ...user, memberships }, CLUB_JIELONG)
  } else if (!view.groupId || view.groupId !== rosterGroupId) {
    // 已入队但未设名册组，或本次报名带了新选组：写入/更新
    if (!view.groupId || (event.groupId && event.groupId !== view.groupId)) {
      const memberships = withClubMembership(user.memberships, CLUB_JIELONG, {
        role: view.role === 'member' ? 'member' : view.role,
        groupId: rosterGroupId
      })
      await db.collection('users').doc(user._id).update({
        data: { memberships, updatedAt: Date.now() }
      })
      view = membershipView({ ...user, memberships }, CLUB_JIELONG)
    }
  }
  const signed = await db.collection('signups').where({ activityId: activity._id, status: 'signed' }).count()
  const waiting = await db.collection('signups').where({ activityId: activity._id, status: 'waitlist' }).count()
  const placed = placeInPool({
    signedCount: signed.total,
    waitlistCount: waiting.total,
    maxSignedPlayers: activity.maxSignedPlayers || 40,
    waitlistLimit: club.config.waitlistLimit || 12
  })
  const hours = event.waitHours == null ? defaultWaitHours(activity.startTime, Date.now()) : Number(event.waitHours)
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.collection('signups').where({
      activityId: activity._id, _openid: openid
    }).limit(1).get()
    const current = existing.data[0]
    if (current && (current.status === 'signed' || current.status === 'waitlist')) throw new Error('你已经报名了')
    if (placed.status === 'signed') {
      const allSigned = await transaction.collection('signups').where({
        activityId: activity._id, status: 'signed'
      }).limit(100).get()
      if (allSigned.data.length >= (activity.maxSignedPlayers || 40)) throw new Error('本场已满')
    }
    const data = {
      activityId: activity._id,
      clubId: CLUB_JIELONG,
      teamId: placed.teamId,
      _openid: openid,
      userName: user.name,
      avatarUrl: user.avatarUrl || '',
      status: placed.status,
      remindAccepted: !!event.remindAccepted,
      promoteAccepted: !!event.promoteAccepted,
      remindSent: false,
      updatedAt: Date.now()
    }
    if (placed.status === 'waitlist') {
      data.waitlistOrder = Date.now()
      data.waitHours = hours
      data.waitUntil = waitUntilAt(activity.startTime, hours, Date.now())
    }
    if (current) await transaction.collection('signups').doc(current._id).update({ data })
    else await transaction.collection('signups').add({ data: Object.assign({ createdAt: Date.now() }, data) })
  })
  return {
    signed: placed.status === 'signed',
    waitlist: placed.status === 'waitlist',
    teamId: placed.teamId,
    via: placed.via,
    label: placed.label
  }
}

async function goalEventsOf(activityId) {
  try {
    const found = await db.collection('goal_events').where({ activityId }).limit(50).get()
    return found.data
  } catch (error) {
    return []
  }
}

async function assertRosterOpen(activity) {
  const rounds = await db.collection('rounds').where({ activityId: activity._id }).limit(40).get()
  const events = await goalEventsOf(activity._id)
  if (rosterLocked(rounds.data, events)) throw new Error('已经有比分或进球，不能再改队')
  return rounds
}

async function clearRounds(activityId) {
  const rounds = await db.collection('rounds').where({ activityId }).limit(40).get()
  for (const round of rounds.data) await db.collection('rounds').doc(round._id).remove()
}

async function writeFixtures(activityId, teamIds) {
  await clearRounds(activityId)
  const fixtures = cupFixtures(teamIds)
  for (const fixture of fixtures) {
    await db.collection('rounds').add({
      data: Object.assign({ activityId, createdAt: Date.now() }, fixture)
    })
  }
  return fixtures.length
}

async function assignTeams(openid, event) {
  const user = await requireUser(openid)
  assertClubAdmin(user, CLUB_JIELONG)
  const activity = await mustGet('activities', event.activityId)
  if (activity.clubId !== CLUB_JIELONG) throw new Error('只有界龙散客可以分队')
  await assertRosterOpen(activity)
  const teamCount = normalizeTeamCount(event.teamCount)
  const targetPerTeam = normalizeTargetSize(event.targetPerTeam == null ? 8 : event.targetPerTeam)
  const signed = await db.collection('signups').where({
    activityId: activity._id,
    status: 'signed'
  }).limit(100).get()
  const ordered = signed.data.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  if (!ordered.length) throw new Error('还没有人报名，先等几个人再分')
  const plan = dividePlayers(ordered, teamCount, targetPerTeam)
  for (const team of plan.teams) {
    for (const player of plan.assignments[team.id] || []) {
      await db.collection('signups').doc(player._id).update({
        data: { teamId: team.id, updatedAt: Date.now() }
      })
    }
  }
  for (const player of plan.leftover) {
    await db.collection('signups').doc(player._id).update({
      data: { teamId: PENDING_TEAM, updatedAt: Date.now() }
    })
  }
  let fixtureCount = 0
  if (shouldAutoFixture(teamCount)) {
    fixtureCount = await writeFixtures(activity._id, plan.teams.map((team) => team.id))
  } else {
    await clearRounds(activity._id)
  }
  await db.collection('activities').doc(activity._id).update({
    data: {
      teams: plan.teams,
      teamCount,
      targetPerTeam,
      divided: true,
      updatedAt: Date.now()
    }
  })
  return {
    teamCount,
    targetPerTeam,
    assignedCount: plan.assignedCount,
    leftoverCount: plan.leftover.length,
    fixtureCount,
    teams: plan.teams
  }
}

async function adminMoveSignup(openid, event) {
  const activity = await mustGet('activities', event.activityId)
  const user = await requireUser(openid)
  assertClubAdmin(user, activity.clubId || CLUB_WEDNESDAY)
  if (activity.clubId !== CLUB_JIELONG) throw new Error('周三联请用原来的换组')
  await assertRosterOpen(activity)
  const next = assertAdminMove({
    locked: false,
    teams: activity.teams || [],
    targetId: event.teamId
  })
  await db.runTransaction(async (transaction) => {
    const found = await transaction.collection('signups').where({
      activityId: activity._id, _openid: event.targetOpenid, status: 'signed'
    }).limit(1).get()
    const current = found.data[0]
    if (!current) throw new Error('只能移动本场正选')
    await transaction.collection('signups').doc(current._id).update({
      data: { teamId: next.teamId, updatedAt: Date.now() }
    })
  })
  return { teamId: next.teamId }
}

async function adminSwapSignup(openid, event) {
  const activity = await mustGet('activities', event.activityId)
  const user = await requireUser(openid)
  assertClubAdmin(user, activity.clubId || CLUB_WEDNESDAY)
  if (activity.clubId !== CLUB_JIELONG) throw new Error('周三联请用原来的对调')
  await assertRosterOpen(activity)
  await db.runTransaction(async (transaction) => {
    const load = async (id) => {
      const found = await transaction.collection('signups').where({
        activityId: activity._id, _openid: id, status: 'signed'
      }).limit(1).get()
      if (!found.data[0]) throw new Error('只能对调本场正选')
      return found.data[0]
    }
    const a = await load(event.openidA)
    const b = await load(event.openidB)
    if (a.teamId === b.teamId) throw new Error('两人已在同一队')
    const now = Date.now()
    await transaction.collection('signups').doc(a._id).update({ data: { teamId: b.teamId, updatedAt: now } })
    await transaction.collection('signups').doc(b._id).update({ data: { teamId: a.teamId, updatedAt: now } })
  })
  return { swapped: true }
}

async function setSessionColor(openid, event) {
  const user = await requireUser(openid)
  const activity = await mustGet('activities', event.activityId)
  assertClubAdmin(user, activity.clubId || CLUB_WEDNESDAY)
  if (!activity.divided) throw new Error('先分队再改颜色')
  const teams = (activity.teams || []).map((team) => (
    team.id === event.teamId
      ? Object.assign({}, team, {
        color: event.color || team.color,
        jerseyColor: event.jerseyColor || team.jerseyColor,
        name: event.name != null ? String(event.name).trim() || team.name : team.name
      })
      : team
  ))
  if (!teams.some((team) => team.id === event.teamId)) throw new Error('找不到这个队')
  await db.collection('activities').doc(activity._id).update({ data: { teams } })
  return { teams }
}

async function cancel(openid, event) {
  const activity = await mustGet('activities', event.activityId)
  if (activity.clubId !== CLUB_JIELONG) throw new Error('这场不是界龙散客')
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，报名已截止。')
  const existing = await db.collection('signups').where({
    activityId: activity._id, _openid: openid, status: _.in(['signed', 'waitlist'])
  }).limit(1).get()
  const current = existing.data[0]
  if (!current) throw new Error('你还没有报名')
  const club = await loadClub(CLUB_JIELONG)
  const hours = club.config.cancelSignedCutoffHours
  const now = Date.now()
  const recordPigeon = willRecordPigeon(activity.startTime, now, current.status, hours)
  await db.runTransaction(async (transaction) => {
    await transaction.collection('signups').doc(current._id).update({
      data: { status: 'cancelled', updatedAt: now }
    })
    if (!recordPigeon) return
    const found = await transaction.collection('contributions').where({
      activityId: activity._id, playerOpenid: openid
    }).limit(1).get()
    const data = {
      activityId: activity._id,
      playerOpenid: openid,
      userName: current.userName,
      teamId: current.teamId || PENDING_TEAM,
      avatarUrl: current.avatarUrl || '',
      activityStartTime: activity.startTime,
      goals: 0,
      assists: 0,
      absent: true,
      absentBy: 'system',
      pigeonAt: now,
      updatedAt: now
    }
    if (found.data[0]) await transaction.collection('contributions').doc(found.data[0]._id).update({ data })
    else await transaction.collection('contributions').add({ data: Object.assign({ createdAt: now }, data) })
  })
  if (current.status === 'signed') await promote(activity)
  return { signed: false, pigeon: recordPigeon }
}

async function promote(activity) {
  const cap = activity.maxSignedPlayers || 40
  const signed = await db.collection('signups').where({
    activityId: activity._id, status: 'signed'
  }).count()
  if (signed.total >= cap) return
  const waiting = await db.collection('signups').where({
    activityId: activity._id, status: 'waitlist'
  }).limit(50).get()
  const next = waiting.data.slice().sort((a, b) => (a.waitlistOrder || 0) - (b.waitlistOrder || 0))[0]
  if (!next) return
  if (next.waitUntil && next.waitUntil <= Date.now()) {
    await db.collection('signups').doc(next._id).update({ data: { status: 'cancelled', updatedAt: Date.now() } })
    return promote(activity)
  }
  const teamId = activity.divided ? PENDING_TEAM : PENDING_TEAM
  await db.collection('signups').doc(next._id).update({
    data: { status: 'signed', teamId, updatedAt: Date.now() }
  })
}

async function saveFixtureScore(openid, event) {
  const user = await requireUser(openid)
  assertClubAdmin(user, CLUB_JIELONG)
  const round = await mustGet('rounds', event.roundId)
  const activity = await mustGet('activities', round.activityId)
  if (!shouldAutoFixture(activity.teamCount || (activity.teams || []).length)) {
    throw new Error('这场没有对战场次')
  }
  const scoreA = Number(event.scoreA)
  const scoreB = Number(event.scoreB)
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 99 || scoreB > 99) {
    throw new Error('比分请填 0 到 99 的整数')
  }
  await db.collection('rounds').doc(round._id).update({ data: { scoreA, scoreB } })
  const rounds = await db.collection('rounds').where({ activityId: activity._id }).limit(40).get()
  const ids = (activity.teams || []).map((team) => team.id)
  const merged = rounds.data.map((item) => (item._id === round._id ? Object.assign({}, item, { scoreA, scoreB }) : item))
  const hasFinal = merged.some((item) => item.matchType === 'final')
  if (!hasFinal && ids.length === 4) {
    const finals = finalsForFour(ids, merged, activity.tiebreakOrder)
    for (const fixture of finals) {
      await db.collection('rounds').add({
        data: Object.assign({ activityId: activity._id, createdAt: Date.now() }, fixture)
      })
    }
  }
  const table = rankTeams(ids, merged, activity.tiebreakOrder)
  return { scoreA, scoreB, table }
}

async function updateFixture(openid, event) {
  const user = await requireUser(openid)
  assertClubAdmin(user, CLUB_JIELONG)
  const activity = await mustGet('activities', event.activityId)
  const rounds = await db.collection('rounds').where({ activityId: activity._id }).limit(40).get()
  if (event.swapRoundNo != null) {
    const same = rounds.data.filter((item) => item.roundNo === Number(event.swapRoundNo))
    if (!same.length) throw new Error('找不到这一轮')
    if (same.length === 1) {
      const pitchId = same[0].pitchId === 'pitch_1' ? 'pitch_2' : 'pitch_1'
      await db.collection('rounds').doc(same[0]._id).update({ data: { pitchId } })
      return { pitchId }
    }
    await db.collection('rounds').doc(same[0]._id).update({ data: { pitchId: same[1].pitchId } })
    await db.collection('rounds').doc(same[1]._id).update({ data: { pitchId: same[0].pitchId } })
    return { swapped: true }
  }
  const round = rounds.data.find((item) => item._id === event.roundId)
  if (!round) throw new Error('找不到这场')
  if (round.scoreA != null || round.scoreB != null) throw new Error('已经记过分，不能改对阵')
  const ids = new Set((activity.teams || []).map((team) => team.id))
  if (!ids.has(event.teamAId) || !ids.has(event.teamBId) || event.teamAId === event.teamBId) {
    throw new Error('请选择两支不同的队')
  }
  const pitchId = event.pitchId === 'pitch_2' ? 'pitch_2' : 'pitch_1'
  await db.collection('rounds').doc(round._id).update({
    data: { teamAId: event.teamAId, teamBId: event.teamBId, pitchId }
  })
  return { roundId: round._id }
}

async function addGoalEvent(openid, event) {
  const user = await requireUser(openid)
  const activity = await mustGet('activities', event.activityId)
  assertClubAdmin(user, activity.clubId || CLUB_WEDNESDAY)
  if (activity.clubId === CLUB_WEDNESDAY && event.roundId) throw new Error('周三联的进球记在整场上')
  const goal = normalizeGoalEvent(event)
  let roundId = ''
  const hasFixtures = shouldAutoFixture(activity.teamCount || (activity.teams || []).length)
  if (hasFixtures) {
    if (!event.roundId) throw new Error('请选择场次')
    const round = await mustGet('rounds', event.roundId)
    if (round.activityId !== activity._id) throw new Error('场次不属于这场活动')
    roundId = round._id
  }
  const added = await db.collection('goal_events').add({
    data: {
      activityId: activity._id,
      clubId: activity.clubId || CLUB_WEDNESDAY,
      roundId,
      scorerOpenid: goal.scorerOpenid,
      assisterOpenid: goal.assisterOpenid,
      isOwnGoal: goal.isOwnGoal,
      createdBy: openid,
      createdAt: Date.now()
    }
  })
  return { eventId: added._id }
}

async function deleteGoalEvent(openid, event) {
  const user = await requireUser(openid)
  const row = await mustGet('goal_events', event.eventId)
  const activity = await mustGet('activities', row.activityId)
  assertClubAdmin(user, activity.clubId || CLUB_WEDNESDAY)
  await db.collection('goal_events').doc(row._id).remove()
  return { removed: true }
}

async function clubStats(event) {
  const clubId = event.clubId || ''
  let events = []
  try {
    const found = await db.collection('goal_events').limit(200).get()
    events = found.data.filter((item) => !clubId || item.clubId === clubId)
  } catch (error) {
    events = []
  }
  const users = await db.collection('users').limit(200).get()
  const nameOf = {}
  users.data.forEach((user) => { nameOf[user._openid] = user.name })
  const rows = require('./clubs').applyGoalEvents(events).map((row) => ({
    ...row,
    userName: nameOf[row.playerOpenid] || '球员'
  }))
  return { rows, clubId }
}

module.exports = {
  ensureOrg,
  orgMe,
  joinClub,
  setMyGroup,
  switchClub,
  updateClubGroup,
  reorderClubGroups,
  setClubAdmin,
  createActivity,
  updateActivityBasics,
  signup,
  assignTeams,
  adminMoveSignup,
  adminSwapSignup,
  cancel,
  promote,
  saveFixtureScore,
  updateFixture,
  setSessionColor,
  addGoalEvent,
  deleteGoalEvent,
  clubStats
}
