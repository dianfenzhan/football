const cloud = require('wx-server-sdk')
const {
  TEAMS,
  UNITE_TEAM,
  assertNotAbsentWithStats,
  assertPigeonEditable,
  pigeonRoster,
  willRecordPigeon,
  defaultWaitHours,
  waitChoices,
  jointPlacement,
  normalizeQuotas,
  otherClubId,
  parseScore,
  periodRange,
  recentStart,
  rosterTeams,
  signupModeOf,
  topBy,
  totalsByPlayer,
  attendancesByPlayer,
  summarizePlayerStats,
  summarizeAllPlayerStats,
  boardRows,
  waitUntilAt,
  withHomeTeam,
  isValidPosition,
  randomPreferredPosition,
  normalizePreferredPosition,
  normalizePlayerName,
  resolveActivityTacticsGroups,
  validateTacticsBoardSave
} = require('./rules')
const { fetchActivityWeather } = require('./weather')

function localSecret(name) {
  if (process.env[name]) return process.env[name]
  try {
    return require('./subscribe.local')[name] || ''
  } catch (err) {
    return ''
  }
}

function subscribeTemplate(name) {
  return localSecret(name)
}

// 本地调试未配环境变量时 TCB_ENV 常为 local，DYNAMIC_CURRENT_ENV 会连不上库。
// 本地 envId 来自 cloud-env.local.js（由 apply-local-secrets / deploy-cloud 写入）；
// 线上部署时 TCB_ENV 会被云端注入为当前环境。
function localCloudEnvId() {
  try {
    return require('./cloud-env.local').envId || ''
  } catch (err) {
    return ''
  }
}
const runtimeEnv = process.env.TCB_ENV || process.env.SCF_NAMESPACE || ''
const fallbackEnvId = localCloudEnvId()
if ((!runtimeEnv || runtimeEnv === 'local') && !fallbackEnvId) {
  throw new Error('本地云环境未配置：先填 secrets.local.json 的 envId，再跑 npm run local:secrets')
}
cloud.init({
  env: runtimeEnv && runtimeEnv !== 'local' ? runtimeEnv : fallbackEnvId
})

const org = require('./org')
const {
  CLUB_JIELONG,
  CLUB_WEDNESDAY,
  buildProfileUpdate,
  membershipView,
  autoSessionPlacement,
  pigeonCutoffHours,
  remindBeforeHours,
  remindLeadMs
} = require('./clubs')
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const action = event.action
    if (event.Type === 'timer' || action === 'sendKickoffReminders') {
      await ensureTeams()
      return ok(await sendKickoffReminders())
    }
    if (!OPENID) return fail('未获取到微信身份')
    await ensureTeams()
    if (action === 'me') return ok(await getMe(OPENID))
    if (action === 'saveProfile') return ok(await saveProfile(OPENID, event))
    if (action === 'listMembers') return ok(await listMembers(OPENID))
    if (action === 'listPlayers') return ok(await listPlayers(OPENID))
    if (action === 'setAdmin') return ok(await setAdmin(OPENID, event))
    if (action === 'listActivities') return ok(await listActivities(OPENID, event))
    if (action === 'activityDetail') return ok(await activityDetail(event.activityId, OPENID))
    if (action === 'createActivity') return ok(await createActivity(OPENID, event))
    if (action === 'deleteActivity') return ok(await deleteActivity(OPENID, event))
    if (action === 'updateQuota') return ok(await updateQuota(OPENID, event))
    if (action === 'signup') return ok(await signup(OPENID, event))
    if (action === 'cancelSignup') return ok(await cancelSignup(OPENID, event))
    if (action === 'moveSignup') return ok(await moveSignup(OPENID, event))
    if (action === 'swapSignups') return ok(await swapSignups(OPENID, event))
    if (action === 'setWaitUntil') return ok(await setWaitUntil(OPENID, event))
    if (action === 'saveRound') return ok(await saveRound(OPENID, event))
    if (action === 'deleteRound') return ok(await deleteRound(OPENID, event))
    if (action === 'deleteContribution') return ok(await deleteContribution(OPENID, event))
    if (action === 'setContribution') return ok(await setContribution(OPENID, event))
    if (action === 'setAbsent') return ok(await setAbsent(OPENID, event))
    if (action === 'adminUpdatePlayer') return ok(await adminUpdatePlayer(OPENID, event))
    if (action === 'saveTacticsBoard') return ok(await saveTacticsBoard(OPENID, event))
    if (action === 'stats') return ok(await stats(event))
    if (action === 'homeSummary') return ok(await homeSummary(OPENID, event))
    if (action === 'activityWeather') return ok(await activityWeather(event))
    if (action === 'smokeSeedSignups') return ok(await smokeSeedSignups(OPENID, event))
    if (action === 'smokeSetCallerRole') return ok(await smokeSetCallerRole(OPENID, event))
    // 仅用于确认模拟器打到本地代码；勿依赖其业务语义。
    if (action === 'devEcho') {
      const env = process.env.TCB_ENV || process.env.SCF_NAMESPACE || ''
      return ok({ marker: 'devEcho-v1', env: env || 'local' })
    }
    if (action === 'orgMe') return ok(await org.orgMe(OPENID))
    if (action === 'joinClub') return ok(await org.joinClub(OPENID, event))
    if (action === 'setMyGroup') return ok(await org.setMyGroup(OPENID, event))
    if (action === 'switchClub') return ok(await org.switchClub(OPENID, event))
    if (action === 'updateClubGroup') return ok(await org.updateClubGroup(OPENID, event))
    if (action === 'reorderClubGroups') return ok(await org.reorderClubGroups(OPENID, event))
    if (action === 'setClubAdmin') return ok(await org.setClubAdmin(OPENID, event))
    if (action === 'updateActivityBasics') return ok(await org.updateActivityBasics(OPENID, event))
    if (action === 'assignTeams') return ok(await org.assignTeams(OPENID, event))
    if (action === 'adminMoveSignup') return ok(await org.adminMoveSignup(OPENID, event))
    if (action === 'adminSwapSignup') return ok(await org.adminSwapSignup(OPENID, event))
    if (action === 'addSessionTeam') return ok(await org.addSessionTeam(OPENID, event))
    if (action === 'removeSessionTeam') return ok(await org.removeSessionTeam(OPENID, event))
    if (action === 'startJielongCup') return ok(await org.startJielongCup(OPENID, event))
    if (action === 'clearFixtureScores') return ok(await org.clearFixtureScores(OPENID, event))
    if (action === 'saveFixtureScore') return ok(await org.saveFixtureScore(OPENID, event))
    if (action === 'addFixture') return ok(await org.addFixture(OPENID, event))
    if (action === 'deleteFixture') return ok(await org.deleteFixture(OPENID, event))
    if (action === 'deleteRoundDirectory') return ok(await org.deleteRoundDirectory(OPENID, event))
    if (action === 'resetFixtures') return ok(await org.resetFixtures(OPENID, event))
    if (action === 'updateFixture') return ok(await org.updateFixture(OPENID, event))
    if (action === 'setSessionColor') return ok(await org.setSessionColor(OPENID, event))
    if (action === 'addGoalEvent') return ok(await org.addGoalEvent(OPENID, event))
    if (action === 'deleteGoalEvent') return ok(await org.deleteGoalEvent(OPENID, event))
    if (action === 'clubStats') return ok(await org.clubStats(event))
    return fail('未知操作')
  } catch (error) {
    return fail(error.message || '操作失败')
  }
}

function ok(data) {
  return { ok: true, ...data }
}

function fail(message) {
  return { ok: false, message }
}

async function ensureTeams() {
  for (const team of TEAMS) {
    try {
      await db.collection('teams').doc(team._id).get()
    } catch (error) {
      await db.collection('teams').doc(team._id).set({
        data: { name: team.name }
      })
    }
  }
}

async function loadMyStats(openid, now = Date.now()) {
  if (!openid) return summarizePlayerStats('', {})
  try {
    const [signups, contributions] = await Promise.all([
      collect('signups', { _openid: openid, status: 'signed' }),
      collect('contributions', { playerOpenid: openid })
    ])
    let goalEvents = []
    try {
      const [scored, assisted] = await Promise.all([
        db.collection('goal_events').where({ scorerOpenid: openid }).limit(200).get(),
        db.collection('goal_events').where({ assisterOpenid: openid }).limit(200).get()
      ])
      const seen = new Set()
      for (const item of [...(scored.data || []), ...(assisted.data || [])]) {
        if (item && item._id && !seen.has(item._id)) {
          seen.add(item._id)
          goalEvents.push(item)
        }
      }
    } catch (e) {
      goalEvents = []
    }
    const actIds = Array.from(new Set([
      ...signups.map((s) => s && s.activityId).filter(Boolean),
      ...contributions.map((c) => c && c.activityId).filter(Boolean),
      ...goalEvents.map((g) => g && g.activityId).filter(Boolean)
    ]))
    const startedIds = new Set()
    const validActivityIds = new Set()
    for (let i = 0; i < actIds.length; i += 100) {
      const batch = actIds.slice(i, i + 100)
      const acts = await collect('activities', { _id: _.in(batch) })
      for (const act of acts) {
        if (!act || !act._id) continue
        validActivityIds.add(act._id)
        if (act.startTime <= now) startedIds.add(act._id)
      }
    }
    return summarizePlayerStats(openid, {
      signups,
      contributions,
      startedIds,
      validActivityIds,
      goalEvents,
      now
    })
  } catch (e) {
    return summarizePlayerStats('', {})
  }
}

async function getMe(openid) {
  let user = await ensureOwner(await findUser(openid))
  if (user && !isValidPosition(user.preferredPosition)) {
    const preferredPosition = randomPreferredPosition()
    await db.collection('users').doc(user._id).update({ data: { preferredPosition } })
    user = { ...user, preferredPosition }
  }
  const myStats = await loadMyStats(openid)
  return { user: await readableUser(user), teams: TEAMS, myStats }
}

async function saveProfile(openid, event) {
  const existing = await findUser(openid)
  const adminCount = await db.collection('users').where({ isAdmin: true }).count()
  let jielongGroups = null
  if (event && event.clubId === CLUB_JIELONG) {
    try {
      await org.ensureOrg()
      const clubDoc = await db.collection('clubs').doc(CLUB_JIELONG).get()
      if (clubDoc && clubDoc.data && Array.isArray(clubDoc.data.groups) && clubDoc.data.groups.length) {
        jielongGroups = clubDoc.data.groups
      }
    } catch (e) {
      // 忽略，回退到默认种子分组
    }
  }
  const data = buildProfileUpdate(existing, event, {
    hasAnyAdmin: adminCount.total > 0,
    jielongGroups
  })
  let user
  if (existing) {
    await db.collection('users').doc(existing._id).update({ data })
    user = { ...existing, ...data }
  } else {
    const added = await db.collection('users').add({
      data: { _openid: openid, ...data, createdAt: Date.now() }
    })
    user = { _id: added._id, _openid: openid, ...data }
  }
  const profile = { userName: data.name, updatedAt: Date.now() }
  if (data.avatarUrl !== undefined) profile.avatarUrl = data.avatarUrl
  await db.collection('signups').where({ _openid: openid }).update({ data: profile })
  await db.collection('contributions').where({ playerOpenid: openid }).update({ data: profile })
  return { user: await readableUser(await ensureOwner(user)) }
}

async function listMembers(openid) {
  await requireOwner(openid)
  const res = await db.collection('users').limit(100).get()
  const users = []
  for (const raw of res.data) {
    users.push(publicUser(await ensureUserPosition(raw)))
  }
  users.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  return { users: await readableAvatars(users) }
}

/** 鸽子榜 / 队内鸽子汇总：仅对应球队管理员（或主管理员）可见 */
function canViewAbsenceStats(user, clubId) {
  if (!user) return false
  if (user.canGrantAdmin) return true
  const wedView = membershipView(user, CLUB_WEDNESDAY)
  const jlView = membershipView(user, CLUB_JIELONG)
  const isWedAdmin = !!(user.isAdmin || wedView.role === 'owner' || wedView.role === 'admin')
  const isJlAdmin = !!(jlView.role === 'owner' || jlView.role === 'admin')
  if (clubId === CLUB_WEDNESDAY) return isWedAdmin
  if (clubId === CLUB_JIELONG) return isJlAdmin
  return isWedAdmin || isJlAdmin
}

async function loadStatsByClubForAdmin(callerUser) {
  if (!callerUser) return { wedStatsByOpenid: null, jlStatsByOpenid: null }
  const wedView = membershipView(callerUser, CLUB_WEDNESDAY)
  const jlView = membershipView(callerUser, CLUB_JIELONG)
  const isWedAdmin = !!(callerUser.canGrantAdmin || callerUser.isAdmin || wedView.role === 'owner' || wedView.role === 'admin')
  const isJlAdmin = !!(callerUser.canGrantAdmin || jlView.role === 'owner' || jlView.role === 'admin')
  if (!isWedAdmin && !isJlAdmin) {
    return { wedStatsByOpenid: null, jlStatsByOpenid: null }
  }
  try {
    const now = Date.now()
    const [activities, signups, contributions] = await Promise.all([
      collect('activities', {}),
      collect('signups', { status: 'signed' }),
      collect('contributions', {})
    ])
    let goalEvents = []
    try {
      const ge = await db.collection('goal_events').limit(200).get()
      goalEvents = ge.data || []
    } catch (e) {
      goalEvents = []
    }
    const wedValid = new Set()
    const wedStarted = new Set()
    const jlValid = new Set()
    const jlStarted = new Set()
    for (const act of activities) {
      if (!act || !act._id) continue
      const isJl = act.clubId === CLUB_JIELONG
      const started = act.startTime <= now
      if (isJl) {
        jlValid.add(act._id)
        if (started) jlStarted.add(act._id)
      } else {
        wedValid.add(act._id)
        if (started) wedStarted.add(act._id)
      }
    }
    const wedStatsByOpenid = isWedAdmin
      ? summarizeAllPlayerStats({
        signups,
        contributions,
        goalEvents,
        startedIds: wedStarted,
        validActivityIds: wedValid,
        now
      })
      : null
    const jlStatsByOpenid = isJlAdmin
      ? summarizeAllPlayerStats({
        signups,
        contributions,
        goalEvents,
        startedIds: jlStarted,
        validActivityIds: jlValid,
        now
      })
      : null
    return { wedStatsByOpenid, jlStatsByOpenid }
  } catch (e) {
    return { wedStatsByOpenid: null, jlStatsByOpenid: null }
  }
}

async function listPlayers(openid) {
  const caller = openid ? await ensureOwner(await findUser(openid)) : null
  const [res, clubStatsMap] = await Promise.all([
    db.collection('users').limit(200).get(),
    loadStatsByClubForAdmin(caller)
  ])
  const emptyStats = { activities: 0, goals: 0, assists: 0, ownGoals: 0, absences: 0 }
  const users = []
  for (const raw of res.data) {
    const pub = publicUser(await ensureUserPosition(raw))
    const playerOpenid = raw._openid
    const clubStats = {}
    if (clubStatsMap.wedStatsByOpenid) {
      clubStats[CLUB_WEDNESDAY] = (playerOpenid && clubStatsMap.wedStatsByOpenid[playerOpenid])
        ? { ...clubStatsMap.wedStatsByOpenid[playerOpenid] }
        : { ...emptyStats }
    }
    if (clubStatsMap.jlStatsByOpenid) {
      clubStats[CLUB_JIELONG] = (playerOpenid && clubStatsMap.jlStatsByOpenid[playerOpenid])
        ? { ...clubStatsMap.jlStatsByOpenid[playerOpenid] }
        : { ...emptyStats }
    }
    if (Object.keys(clubStats).length) {
      pub.clubStats = clubStats
    }
    users.push(pub)
  }
  users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return { users: await readableAvatars(users) }
}

async function ensureUserPosition(user) {
  if (!user || isValidPosition(user.preferredPosition)) return user
  const preferredPosition = randomPreferredPosition()
  try {
    await db.collection('users').doc(user._id).update({ data: { preferredPosition } })
  } catch (e) {
    // 忽略并发补写错误
  }
  return { ...user, preferredPosition }
}

async function adminUpdatePlayer(openid, event) {
  await requireAdmin(openid)
  const userId = String((event && event.userId) || '').trim()
  if (!userId) throw new Error('找不到这个队员')
  const target = await db.collection('users').doc(userId).get().then((r) => r.data).catch(() => null)
  if (!target) throw new Error('找不到这个队员')
  let name
  if (event.name !== undefined) {
    name = normalizePlayerName(event.name)
  } else {
    name = String(target.name || '').trim()
    if (!name) throw new Error('请填写姓名')
  }
  const preferredPosition = event.preferredPosition !== undefined
    ? normalizePreferredPosition(event.preferredPosition)
    : (isValidPosition(target.preferredPosition) ? target.preferredPosition : randomPreferredPosition())
  const avatarUrl = typeof event.avatarUrl === 'string' ? event.avatarUrl : undefined
  const now = Date.now()
  const data = { name, preferredPosition, updatedAt: now }
  if (avatarUrl !== undefined) data.avatarUrl = avatarUrl
  await db.collection('users').doc(userId).update({ data })
  const profile = { userName: name, updatedAt: now }
  if (avatarUrl !== undefined) profile.avatarUrl = avatarUrl
  if (target._openid) {
    await db.collection('signups').where({ _openid: target._openid }).update({ data: profile })
    await db.collection('contributions').where({ playerOpenid: target._openid }).update({ data: profile })
  }
  const updated = await readableUser({ ...target, ...data })
  return { user: publicUser(updated) }
}

async function setAdmin(openid, event) {
  await requireOwner(openid)
  const userId = event.userId
  if (!userId) throw new Error('缺少用户')
  const target = await mustGet('users', userId)
  if (target._openid === openid || target.canGrantAdmin) throw new Error('不能修改授权人的管理员身份')
  const isAdmin = !!event.isAdmin
  await db.collection('users').doc(userId).update({
    data: { isAdmin, updatedAt: Date.now() }
  })
  return { user: publicUser({ ...target, _id: userId, isAdmin }) }
}

async function listActivities(openid, event) {
  const pageSize = 10
  const page = Math.max(1, Number(event && event.page) || 1)
  const clubId = event && event.clubId
  // 打开多球队筛选时顺带把旧活动补上 club_wednesday（有标记，只跑一次）
  if (clubId === 'all' || clubId === CLUB_JIELONG || clubId === CLUB_WEDNESDAY) {
    try { await org.ensureOrg() } catch (error) { /* 旧环境无 org 时忽略 */ }
  }
  let rows = []
  let hasMore = false
  if (clubId === 'all' || clubId === CLUB_JIELONG || clubId === CLUB_WEDNESDAY) {
    const res = await db.collection('activities').orderBy('startTime', 'desc').limit(200).get()
    const filtered = res.data.filter((activity) => {
      if (clubId === 'all') return true
      if (clubId === CLUB_JIELONG) return activity.clubId === CLUB_JIELONG
      return !activity.clubId || activity.clubId === CLUB_WEDNESDAY
    })
    const start = (page - 1) * pageSize
    rows = filtered.slice(start, start + pageSize)
    hasMore = filtered.length > start + pageSize
  } else {
    // 旧客户端不传 clubId：仍只看周三联，避免把界龙场混进旧包
    const res = await db.collection('activities').orderBy('startTime', 'desc').skip((page - 1) * pageSize).limit(pageSize + 1).get()
    rows = res.data.filter((activity) => activity.clubId !== CLUB_JIELONG).slice(0, pageSize)
    hasMore = res.data.length > pageSize
  }
  const activities = []
  for (const activity of rows) {
    const quotas = await quotasOf(activity._id)
    let signedCount = 0
    if (activity.clubId === CLUB_JIELONG) {
      const signed = await db.collection('signups').where({ activityId: activity._id, status: 'signed' }).count()
      signedCount = signed.total
    }
    activities.push({ ...activity, quotas, signedCount })
  }
  return { activities, teams: TEAMS, page, hasMore }
}

async function deleteActivity(openid, event) {
  const activityId = event.activityId
  if (!activityId) throw new Error('缺少活动')
  const activity = await mustGet('activities', activityId)
  if (activity.clubId === CLUB_JIELONG) {
    const user = await requireUser(openid)
    if (membershipView(user, CLUB_JIELONG).role !== 'owner') throw new Error('只有主管理员可以删除活动')
  } else {
    await requireGrantOwner(openid, '只有授权人可以删除活动')
  }
  await removeMatching('quotas', { activityId })
  await removeMatching('signups', { activityId })
  await removeMatching('rounds', { activityId })
  await removeMatching('contributions', { activityId })
  await removeMatchingSafe('tactics_boards', { activityId })
  await removeMatchingSafe('goal_events', { activityId })
  await db.collection('activities').doc(activityId).remove()
  return { removed: true }
}

async function removeMatchingSafe(name, where) {
  try {
    await removeMatching(name, where)
  } catch (e) {
    // 集合未初始化或无记录时忽略
  }
}

async function removeMatching(name, where) {
  const rows = await collect(name, where)
  for (const row of rows) {
    await db.collection(name).doc(row._id).remove()
  }
}

async function recentAttendanceMap(span = '3m') {
  const start = recentStart(span)
  const now = Date.now()
  const activities = await collect('activities', { startTime: _.gte(start) })
  const startedIds = activities.filter((a) => a.startTime <= now).map((a) => a._id)
  if (!startedIds.length) return {}
  const signups = await collect('signups', {
    status: 'signed',
    activityId: _.in(startedIds)
  })
  const contributions = await collect('contributions', { activityStartTime: _.gte(start) })
  const absentKeys = contributions
    .filter((row) => row.absent)
    .map((row) => `${row.activityId}:${row.playerOpenid}`)
  const rows = attendancesByPlayer(signups, { startedIds, absentKeys })
  const map = {}
  for (const row of rows) {
    map[row.playerOpenid] = row.attendances || 0
  }
  return map
}

function publicTacticsBoard(doc) {
  return {
    _id: doc._id,
    scope: 'activity',
    teamId: doc.teamId || '',
    activityId: doc.activityId || '',
    title: doc.title || '',
    slots: Array.isArray(doc.slots) ? doc.slots : [],
    createdAt: doc.createdAt || 0,
    updatedAt: doc.updatedAt || doc.createdAt || 0
  }
}

async function safeCollectBoards(where) {
  try {
    return await collect('tactics_boards', where)
  } catch (e) {
    return []
  }
}

async function ensureTacticsBoardsCollection() {
  try {
    await db.createCollection('tactics_boards')
  } catch (e) {
    // 已存在时忽略
  }
}

async function addTacticsBoard(data) {
  try {
    return await db.collection('tactics_boards').add({ data })
  } catch (e) {
    const message = String((e && (e.message || e.errMsg)) || e || '')
    if (message.indexOf('tactics_boards') === -1 && message.indexOf('-502005') === -1) throw e
    await ensureTacticsBoardsCollection()
    return db.collection('tactics_boards').add({ data })
  }
}

async function saveTacticsBoard(openid, event) {
  await requireUser(openid)
  const teamId = String((event && event.teamId) || '').trim()
  const activityId = String((event && event.activityId) || '').trim()
  if (!activityId) throw new Error('缺少活动')
  const now = Date.now()
  const activity = await mustGet('activities', activityId)
  const signedSnap = await db.collection('signups').where({
    activityId,
    _openid: openid,
    status: 'signed'
  }).limit(1).get()
  if (!signedSnap.data[0]) throw new Error('只有本场正选可以保存战术板')
  const validGroups = resolveActivityTacticsGroups(activity)
  const groupObj = validGroups.find((g) => g._id === teamId)
  if (!groupObj) throw new Error('请选择分组')
  const groupSignups = await db.collection('signups').where({
    activityId,
    teamId,
    status: 'signed'
  }).limit(100).get()
  const allowedUserIds = new Set()
  const openids = (groupSignups.data || []).map((s) => s._openid).filter(Boolean)
  openids.forEach((id) => allowedUserIds.add(String(id)))
  if (openids.length) {
    const userRes = await db.collection('users').where({ _openid: _.in(openids) }).limit(100).get()
    ;(userRes.data || []).forEach((u) => {
      if (u && u._id) allowedUserIds.add(String(u._id))
      if (u && u._openid) allowedUserIds.add(String(u._openid))
    })
  }
  const validated = validateTacticsBoardSave(
    { title: groupObj.name, slots: event.slots },
    { allowedUserIds }
  )
  const existing = await safeCollectBoards({ scope: 'activity', activityId, teamId })
  const current = existing[0]
  if (current) {
    const data = {
      title: groupObj.name,
      slots: validated.slots,
      updatedBy: openid,
      updatedAt: now
    }
    await db.collection('tactics_boards').doc(current._id).update({ data })
    return { board: publicTacticsBoard({ ...current, ...data }) }
  }
  const data = {
    scope: 'activity',
    teamId,
    activityId,
    title: groupObj.name,
    slots: validated.slots,
    createdBy: openid,
    createdAt: now,
    updatedBy: openid,
    updatedAt: now
  }
  const added = await addTacticsBoard(data)
  return { board: publicTacticsBoard({ _id: added._id, ...data }) }
}

async function activityDetail(activityId, openid) {
  if (!activityId) throw new Error('缺少活动')
  const activity = await mustGet('activities', activityId)
  const me = await findUser(openid)
  const quotas = await quotasOf(activityId)
  await expireWaitlists(activityId)
  const signupRes = await db.collection('signups').where({ activityId, status: _.in(['signed', 'waitlist']) }).limit(100).get()
  const allUsers = await collect('users', {})
  const userByOpenid = {}
  const adminOpenids = new Set()
  for (const raw of allUsers) {
    const ensured = await ensureUserPosition(raw)
    userByOpenid[ensured._openid] = ensured
    if (ensured.isAdmin) adminOpenids.add(ensured._openid)
  }
  const attMap = await recentAttendanceMap('3m')
  const signups = signupRes.data.map((signup) => {
    const u = userByOpenid[signup._openid]
    return {
      ...signup,
      userId: (u && u._id) || signup._openid,
      preferredPosition: (u && u.preferredPosition) || 'mf',
      attendances: attMap[signup._openid] || 0,
      isAdmin: adminOpenids.has(signup._openid)
    }
  })
  const rawActivityBoards = await safeCollectBoards({ scope: 'activity', activityId })
  const activityBoards = {}
  for (const doc of rawActivityBoards) {
    if (doc && doc.teamId) {
      activityBoards[doc.teamId] = publicTacticsBoard(doc)
    }
  }
  const roundRes = await db.collection('rounds').where({ activityId }).orderBy('roundNo', 'asc').limit(50).get()
  const contributionRes = await db.collection('contributions').where({ activityId }).limit(100).get()
  let goalEvents = []
  try {
    const eventRes = await db.collection('goal_events').where({ activityId }).limit(100).get()
    goalEvents = eventRes.data
  } catch (error) {
    goalEvents = []
  }
  return {
    activity,
    quotas,
    signups: await readableAvatars(signups),
    activityBoards,
    rounds: roundRes.data,
    contributions: await readableAvatars(contributionRes.data),
    pigeons: pigeonRoster(contributionRes.data),
    goalEvents,
    cancelWillPigeon: !!(me && willRecordPigeon(
      activity.startTime,
      Date.now(),
      (signupRes.data.find((item) => item._openid === openid) || {}).status,
      pigeonCutoffHours(activity.clubId)
    )),
    pigeonCutoffHours: pigeonCutoffHours(activity.clubId),
    remindBeforeHours: remindBeforeHours(activity.clubId),
    members: me && me.isAdmin ? await listMemberBriefs() : [],
    me: await readableUser(me ? await ensureOwner(await ensureUserPosition(me)) : null),
    teams: rosterTeams(signupModeOf(activity)),
    subscribeTemplates: {
      remind: subscribeTemplate('SUBSCRIBE_REMIND_TEMPLATE'),
      promote: subscribeTemplate('SUBSCRIBE_PROMOTE_TEMPLATE')
    },
    waitChoices: waitChoices(activity.startTime, Date.now())
  }
}

async function listMemberBriefs() {
  const res = await db.collection('users').limit(100).get()
  return res.data
    .map((user) => ({ _openid: user._openid, name: user.name, teamId: user.teamId }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
}

async function createActivity(openid, event) {
  if (event.clubId === CLUB_JIELONG) return org.createActivity(openid, event)
  await requireAdmin(openid)
  const title = String(event.title || '').trim()
  const location = String(event.location || '').trim()
  const startTime = Number(event.startTime)
  if (!title) throw new Error('请填写标题')
  if (!location) throw new Error('请填写地点')
  if (!startTime) throw new Error('请选择时间')
  const signupMode = event.signupMode === 'joint' ? 'joint' : 'split'
  const quotas = normalizeQuotas(event.quotas, signupMode)
  const added = await db.collection('activities').add({
    data: {
      title,
      location,
      startTime,
      signupMode,
      clubId: CLUB_WEDNESDAY,
      status: 'open',
      createdBy: openid,
      createdAt: Date.now()
    }
  })
  for (const quota of quotas) {
    await db.collection('quotas').add({
      data: { activityId: added._id, teamId: quota.teamId, maxSignups: quota.maxSignups }
    })
  }
  return { activityId: added._id }
}

const TEST_CLOUD_ENV = 'dev-d7g1iusl7549930ee'
const SMOKE_PLACEHOLDER_OWNER_OPENID = 'smoke_placeholder_owner'

function assertTestCloudEnv() {
  const env = process.env.TCB_ENV || process.env.SCF_NAMESPACE || localCloudEnvId() || ''
  if (env !== TEST_CLOUD_ENV) {
    throw new Error('smokeSetCallerRole 仅测试环境可用')
  }
}

async function ensureSmokePlaceholderOwner() {
  const found = await db.collection('users').where({ _openid: SMOKE_PLACEHOLDER_OWNER_OPENID }).limit(1).get()
  if (found.data[0]) {
    if (!found.data[0].canGrantAdmin) {
      await db.collection('users').doc(found.data[0]._id).update({
        data: { canGrantAdmin: true, isAdmin: true, updatedAt: Date.now() }
      })
    }
    return found.data[0]._id
  }
  const added = await db.collection('users').add({
    data: {
      _openid: SMOKE_PLACEHOLDER_OWNER_OPENID,
      name: '冒烟占位授权人',
      isAdmin: true,
      canGrantAdmin: true,
      teamId: 'team_pudong',
      preferredPosition: 'mf',
      memberships: [
        { clubId: CLUB_WEDNESDAY, groupId: 'team_pudong', role: 'owner', labels: [] },
        { clubId: CLUB_JIELONG, groupId: 'jl_other', role: 'owner', labels: [] }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  })
  return added._id
}

async function removeSmokePlaceholderOwner() {
  const found = await db.collection('users').where({ _openid: SMOKE_PLACEHOLDER_OWNER_OPENID }).limit(1).get()
  if (found.data[0]) {
    await db.collection('users').doc(found.data[0]._id).remove()
  }
}

/**
 * 仅测试环境：切换当前登录者角色，便于单微信号测普通管理/普通成员。
 * role: owner | admin | member | fresh
 * clubs: 可选，限制加入的俱乐部（fresh 忽略）
 */
async function smokeSetCallerRole(openid, event) {
  assertTestCloudEnv()
  const role = String((event && event.role) || '').trim()
  if (!['owner', 'admin', 'member', 'fresh'].includes(role)) {
    throw new Error('role 须为 owner / admin / member / fresh')
  }
  const user = await findUser(openid)
  if (!user) throw new Error('找不到当前用户')
  const now = Date.now()
  const backup = user._smokeBackup || {
    name: user.name || '',
    isAdmin: !!user.isAdmin,
    canGrantAdmin: !!user.canGrantAdmin,
    teamId: user.teamId || '',
    preferredPosition: user.preferredPosition || '',
    memberships: Array.isArray(user.memberships) ? user.memberships : [],
    avatarUrl: user.avatarUrl || ''
  }
  if (role === 'owner') {
    await db.collection('users').doc(user._id).update({
      data: {
        name: backup.name || user.name || '测试用户',
        isAdmin: true,
        canGrantAdmin: true,
        teamId: backup.teamId || user.teamId || 'team_pudong',
        preferredPosition: backup.preferredPosition || user.preferredPosition || 'mf',
        memberships: (backup.memberships && backup.memberships.length)
          ? backup.memberships
          : [
            { clubId: CLUB_WEDNESDAY, groupId: backup.teamId || 'team_pudong', role: 'owner', labels: [] },
            { clubId: CLUB_JIELONG, groupId: 'jl_other', role: 'owner', labels: [] }
          ],
        _smokeBackup: _.remove(),
        updatedAt: now
      }
    })
    await removeSmokePlaceholderOwner()
    const restored = await mustGet('users', user._id)
    return {
      role: 'owner',
      user: {
        isAdmin: !!restored.isAdmin,
        canGrantAdmin: !!restored.canGrantAdmin,
        teamId: restored.teamId || '',
        memberships: restored.memberships || []
      }
    }
  }

  await ensureSmokePlaceholderOwner()
  const wantClubs = Array.isArray(event.clubs) && event.clubs.length
    ? event.clubs.filter((id) => id === CLUB_WEDNESDAY || id === CLUB_JIELONG)
    : [CLUB_WEDNESDAY, CLUB_JIELONG]
  const wedGroup = backup.teamId || user.teamId || 'team_pudong'
  const jlGroup = ((backup.memberships || []).find((m) => m && m.clubId === CLUB_JIELONG) || {}).groupId || 'jl_other'

  if (role === 'fresh') {
    await db.collection('users').doc(user._id).update({
      data: {
        _smokeBackup: backup,
        isAdmin: false,
        canGrantAdmin: false,
        teamId: '',
        memberships: [],
        updatedAt: now
      }
    })
  } else {
    const clubRole = role === 'admin' ? 'admin' : 'member'
    const memberships = []
    if (wantClubs.indexOf(CLUB_WEDNESDAY) !== -1) {
      memberships.push({ clubId: CLUB_WEDNESDAY, groupId: wedGroup, role: clubRole, labels: [] })
    }
    if (wantClubs.indexOf(CLUB_JIELONG) !== -1) {
      memberships.push({ clubId: CLUB_JIELONG, groupId: jlGroup, role: clubRole, labels: [] })
    }
    await db.collection('users').doc(user._id).update({
      data: {
        _smokeBackup: backup,
        isAdmin: role === 'admin',
        canGrantAdmin: false,
        teamId: wantClubs.indexOf(CLUB_WEDNESDAY) !== -1 ? wedGroup : '',
        memberships,
        updatedAt: now
      }
    })
  }
  const updated = await mustGet('users', user._id)
  return {
    role,
    user: {
      isAdmin: !!updated.isAdmin,
      canGrantAdmin: !!updated.canGrantAdmin,
      teamId: updated.teamId || '',
      memberships: updated.memberships || []
    }
  }
}

/** 仅冒烟：给标题以「冒烟」开头的活动注入假人报名，便于测后补/顶上。 */
async function smokeSeedSignups(openid, event) {
  await requireAdmin(openid)
  const activity = await mustGet('activities', event.activityId)
  if (!String(activity.title || '').startsWith('冒烟')) {
    throw new Error('仅标题以冒烟开头的活动可注入假人')
  }
  const mode = signupModeOf(activity)
  let teamId = event.teamId
  const jielong = activity.clubId === CLUB_JIELONG
  const jielongOk = jielong && (
    teamId === 'team_pending'
    || teamId === 'auto'
    || (activity.teams || []).some((team) => team.id === teamId)
  )
  if (!jielongOk && !rosterTeams(mode).some((team) => team._id === teamId)) throw new Error('请选择球队')
  const status = event.status === 'waitlist' ? 'waitlist' : 'signed'
  const count = Math.min(Math.max(Number(event.count) || 1, 1), 30)
  const now = Date.now()
  const signupIds = []
  let teams = (activity.teams || []).slice()
  let signedCount = 0
  const manualRoster = !!(jielong && (activity.manualRoster || activity.cupStarted))
  if (jielong && status === 'signed' && !manualRoster) {
    const signed = await db.collection('signups').where({
      activityId: activity._id, status: 'signed'
    }).count()
    signedCount = signed.total
  }
  const teamSize = activity.targetPerTeam || 8
  const namePool = Array.isArray(event.namePool)
    ? event.namePool.filter((row) => row && String(row.name || '').trim())
    : []
  for (let i = 0; i < count; i += 1) {
    let assignTeamId = teamId
    let sessionOrder = i
    if (jielong && status === 'signed' && (teamId === 'team_pending' || teamId === 'auto')) {
      if (manualRoster) {
        assignTeamId = 'team_pending'
      } else {
        const placement = autoSessionPlacement(signedCount, teams, teamSize)
        teams = placement.teams
        assignTeamId = placement.teamId
        sessionOrder = signedCount
        signedCount += 1
      }
    }
    const cloned = namePool.length ? namePool[i % namePool.length] : null
    const data = {
      activityId: activity._id,
      teamId: assignTeamId,
      sessionOrder,
      _openid: `smoke_fake_${now}_${i}`,
      userName: cloned ? String(cloned.name).trim() : `冒烟假人${i + 1}`,
      avatarUrl: cloned && typeof cloned.avatarUrl === 'string' ? cloned.avatarUrl : '',
      status,
      remindAccepted: false,
      promoteAccepted: false,
      remindSent: false,
      createdAt: now + i,
      updatedAt: now
    }
    if (status === 'waitlist') {
      data.waitlistOrder = now + i
      data.waitHours = 4
      data.waitUntil = waitUntilAt(activity.startTime, 4, now)
      data.teamId = 'team_pending'
      delete data.sessionOrder
    }
    const added = await db.collection('signups').add({ data })
    signupIds.push(added._id)
  }
  if (jielong && status === 'signed' && !manualRoster && (teamId === 'team_pending' || teamId === 'auto') && teams.length) {
    await db.collection('activities').doc(activity._id).update({
      data: {
        teams,
        teamCount: teams.length,
        targetPerTeam: teamSize,
        divided: true,
        updatedAt: Date.now()
      }
    })
  }
  return { signupIds, count, teamCount: teams.length || undefined }
}

async function updateQuota(openid, event) {
  await requireAdmin(openid)
  const activityId = event.activityId
  const activity = await mustGet('activities', activityId)
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，不能改名额')
  if (signupModeOf(activity) === 'joint') throw new Error('联合报名不能修改人数')
  const teamId = event.teamId
  const maxSignups = Number(event.maxSignups)
  if (!activityId || !TEAMS.some((team) => team._id === teamId)) throw new Error('参数不完整')
  if (!Number.isInteger(maxSignups) || maxSignups < 1 || maxSignups > 30) throw new Error('名额为 1 到 30')
  const signed = await signedCount(activityId, teamId)
  if (maxSignups < signed) throw new Error(`已有 ${signed} 人报名，名额不能更低`)
  const quota = await quotaOf(activityId, teamId)
  if (!quota) throw new Error('找不到该队名额')
  await db.collection('quotas').doc(quota._id).update({ data: { maxSignups } })
  await promoteWaitlist(activity, teamId)
  return { maxSignups }
}

async function signup(openid, event) {
  const user = await requireUser(openid)
  const activityId = event.activityId
  const activity = await mustGet('activities', activityId)
  if (activity.clubId === CLUB_JIELONG) return org.signup(openid, event)
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，报名已截止。')
  const wedTeamId = user.teamId || membershipView(user, CLUB_WEDNESDAY).groupId
  if (!TEAMS.some((team) => team._id === wedTeamId)) throw new Error('请先选择所属球队')
  const wedUser = user.teamId === wedTeamId ? user : { ...user, teamId: wedTeamId }
  await expireWaitlists(activityId)
  const mode = signupModeOf(activity)
  const placed = await placeSignup(activity, wedUser, event)
  const flags = acceptFlags(event)
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.collection('signups').where({ activityId, _openid: openid }).limit(1).get()
    const current = existing.data[0]
    if (current && (current.status === 'signed' || current.status === 'waitlist')) throw new Error('你已经报名了')
    if (placed.status === 'signed') {
      const quotaSnap = await transaction.collection('quotas').where({ activityId, teamId: placed.teamId }).limit(1).get()
      const quota = quotaSnap.data[0]
      if (!quota) throw new Error('这场活动没有你所在球队的名额')
      const signedSnap = await transaction.collection('signups').where({
        activityId, teamId: placed.teamId, status: 'signed'
      }).limit(100).get()
      if (signedSnap.data.length >= quota.maxSignups) throw new Error(placed.fullMessage || '这个队已经满员')
    } else {
      const waiting = await transaction.collection('signups').where({
        activityId, status: 'waitlist', teamId: placed.teamId
      }).limit(100).get()
      const limit = mode === 'joint' ? 6 : 3
      if (waiting.data.length >= limit) throw new Error(placed.fullMessage)
    }
    const data = signupData(activity, user, placed, flags)
    if (current) {
      await transaction.collection('signups').doc(current._id).update({ data })
    } else {
      await transaction.collection('signups').add({ data: Object.assign({ createdAt: Date.now() }, data) })
    }
  })
  if (placed.status === 'signed') {
    await clearSystemPigeon(activityId, openid)
    await maybeRemindNow(activity, openid)
  }
  return { signed: placed.status === 'signed', waitlist: placed.status === 'waitlist', teamId: placed.teamId, via: placed.via || '' }
}

async function cancelSignup(openid, event) {
  const activityId = event.activityId
  const activity = await mustGet('activities', activityId)
  if (activity.clubId === CLUB_JIELONG) return org.cancel(openid, event)
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，报名已截止。')
  const existing = await db.collection('signups').where({
    activityId, _openid: openid, status: _.in(['signed', 'waitlist'])
  }).limit(1).get()
  const current = existing.data[0]
  if (!current) throw new Error('你还没有报名')
  const wasSigned = current.status === 'signed'
  const teamId = current.teamId
  const now = Date.now()
  const recordPigeon = willRecordPigeon(
    activity.startTime,
    now,
    current.status,
    pigeonCutoffHours(activity.clubId)
  )
  await db.runTransaction(async (transaction) => {
    await transaction.collection('signups').doc(current._id).update({
      data: { status: 'cancelled', updatedAt: now }
    })
    if (recordPigeon) await writeSystemPigeon(transaction, activity, current, now)
  })
  if (wasSigned) await promoteWaitlist(activity, teamId)
  return { signed: false, pigeon: recordPigeon }
}

async function writeSystemPigeon(transaction, activity, signup, now) {
  const found = await transaction.collection('contributions').where({
    activityId: activity._id,
    playerOpenid: signup._openid
  }).limit(1).get()
  const data = {
    activityId: activity._id,
    playerOpenid: signup._openid,
    userName: signup.userName,
    teamId: signup.teamId,
    avatarUrl: signup.avatarUrl || '',
    activityStartTime: activity.startTime,
    goals: 0,
    assists: 0,
    absent: true,
    absentBy: 'system',
    pigeonAt: now,
    updatedAt: now
  }
  const previous = found.data[0]
  if (previous) {
    await transaction.collection('contributions').doc(previous._id).update({ data })
  } else {
    await transaction.collection('contributions').add({ data: Object.assign({ createdAt: now }, data) })
  }
}

async function clearSystemPigeon(activityId, openid) {
  const found = await db.collection('contributions').where({ activityId, playerOpenid: openid }).limit(1).get()
  const row = found.data[0]
  if (!row || !row.absent || row.absentBy !== 'system') return
  await db.collection('contributions').doc(row._id).update({
    data: { absent: false, absentBy: '', pigeonAt: 0, updatedAt: Date.now() }
  })
}

async function moveSignup(openid, event) {
  const activity = await mustGet('activities', event.activityId)
  if (signupModeOf(activity) !== 'joint') throw new Error('这场不能换组')
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，报名已截止。')
  const me = await requireUser(openid)
  const targetId = event.targetOpenid || openid
  if (targetId !== openid && !me.isAdmin) throw new Error('只能移动自己的报名')
  const teamId = event.teamId
  if (!rosterTeams('joint').some((team) => team._id === teamId)) throw new Error('请选择球队')
  await db.runTransaction(async (transaction) => {
    const found = await transaction.collection('signups').where({
      activityId: event.activityId, _openid: targetId, status: 'signed'
    }).limit(1).get()
    const current = found.data[0]
    if (!current) throw new Error('你还没有报名')
    if (current.teamId === teamId) return
    const quotaSnap = await transaction.collection('quotas').where({
      activityId: event.activityId, teamId
    }).limit(1).get()
    const quota = quotaSnap.data[0]
    const signedSnap = await transaction.collection('signups').where({
      activityId: event.activityId, teamId, status: 'signed'
    }).limit(100).get()
    if (!quota || signedSnap.data.length >= quota.maxSignups) throw new Error('该组已满')
    await transaction.collection('signups').doc(current._id).update({
      data: { teamId, updatedAt: Date.now() }
    })
  })
  return { teamId }
}

async function swapSignups(openid, event) {
  await requireAdmin(openid)
  const activity = await mustGet('activities', event.activityId)
  if (signupModeOf(activity) !== 'joint') throw new Error('这场不能换组')
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，报名已截止。')
  const openidA = event.openidA
  const openidB = event.openidB
  if (!openidA || !openidB || openidA === openidB) throw new Error('请选择两名队员')
  let teamA = ''
  let teamB = ''
  await db.runTransaction(async (transaction) => {
    const loadSigned = async (id) => {
      const found = await transaction.collection('signups').where({
        activityId: event.activityId,
        _openid: id,
        status: 'signed'
      }).limit(1).get()
      const row = found.data[0]
      if (!row) throw new Error('只能对调本场正选')
      return row
    }
    const a = await loadSigned(openidA)
    const b = await loadSigned(openidB)
    if (a.teamId === b.teamId) throw new Error('两人已在同一组')
    const now = Date.now()
    await transaction.collection('signups').doc(a._id).update({
      data: { teamId: b.teamId, updatedAt: now }
    })
    await transaction.collection('signups').doc(b._id).update({
      data: { teamId: a.teamId, updatedAt: now }
    })
    teamA = b.teamId
    teamB = a.teamId
  })
  return { openidA, teamA, openidB, teamB }
}

async function setWaitUntil(openid, event) {
  await requireUser(openid)
  const activity = await mustGet('activities', event.activityId)
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，报名已截止。')
  const hours = Number(event.waitHours)
  const waitUntil = waitUntilAt(activity.startTime, hours, Date.now())
  const existing = await db.collection('signups').where({
    activityId: event.activityId, _openid: openid, status: 'waitlist'
  }).limit(1).get()
  if (!existing.data[0]) throw new Error('你还没有报名')
  await db.collection('signups').doc(existing.data[0]._id).update({
    data: { waitHours: hours, waitUntil, updatedAt: Date.now() }
  })
  return { waitUntil }
}

function acceptFlags(event) {
  return {
    remindAccepted: !!event.remindAccepted,
    promoteAccepted: !!event.promoteAccepted
  }
}

function signupData(activity, user, placed, flags) {
  const data = {
    activityId: activity._id,
    teamId: placed.teamId,
    _openid: user._openid,
    userName: user.name,
    avatarUrl: user.avatarUrl || '',
    status: placed.status,
    remindAccepted: flags.remindAccepted,
    promoteAccepted: flags.promoteAccepted,
    remindSent: false,
    updatedAt: Date.now()
  }
  if (placed.status === 'waitlist') {
    data.waitlistOrder = placed.waitlistOrder
    data.waitHours = placed.waitHours
    data.waitUntil = placed.waitUntil
  }
  return data
}

async function placeSignup(activity, user, event) {
  const mode = signupModeOf(activity)
  const quotas = await quotasOf(activity._id)
  const maxes = {}
  const counts = {}
  quotas.forEach((quota) => {
    maxes[quota.teamId] = quota.maxSignups
    counts[quota.teamId] = quota.signed
  })
  if (mode === 'joint') {
    const slot = jointPlacement(user.teamId, counts, maxes)
    if (slot) return { status: 'signed', teamId: slot.teamId, via: slot.via }
    const waiting = await db.collection('signups').where({ activityId: activity._id, status: 'waitlist' }).count()
    if (waiting.total >= 6) throw new Error('名额和后补都满了')
    return waitlistPlacement(activity, event, '')
  }
  const home = user.teamId
  const homeFull = (counts[home] || 0) >= (maxes[home] || 0)
  if (!homeFull && event.choice !== 'other' && !(event.teamId && event.teamId !== home)) {
    return { status: 'signed', teamId: home, via: 'home' }
  }
  if (!homeFull && event.teamId && event.teamId !== home) {
    if (!TEAMS.some((team) => team._id === event.teamId)) throw new Error('请选择球队')
    if ((counts[event.teamId] || 0) >= (maxes[event.teamId] || 0)) throw new Error('这个队已经满员')
    return { status: 'signed', teamId: event.teamId, via: 'other' }
  }
  const other = otherClubId(home)
  const homeWaiting = await db.collection('signups').where({ activityId: activity._id, teamId: home, status: 'waitlist' }).count()
  const otherFull = (counts[other] || 0) >= (maxes[other] || 0)
  if (homeWaiting.total >= 3 && otherFull) throw new Error('两队都满了，暂时报不上')
  if (event.choice === 'waitlist' || (!event.choice && !event.teamId)) {
    if (!event.choice) throw new Error('请选择后补或改报对方队')
    if (homeWaiting.total >= 3) throw new Error('本队后补已满')
    return waitlistPlacement(activity, event, home)
  }
  if (event.choice === 'other' || event.teamId === other) {
    if (otherFull) throw new Error('对面已满，不能报名')
    return { status: 'signed', teamId: other, via: 'other', fullMessage: '对面已满，不能报名' }
  }
  throw new Error('请选择后补或改报对方队')
}

function waitlistPlacement(activity, event, teamId) {
  const hours = event.waitHours == null ? defaultWaitHours(activity.startTime, Date.now()) : Number(event.waitHours)
  return {
    status: 'waitlist',
    teamId,
    waitHours: hours,
    waitUntil: waitUntilAt(activity.startTime, hours, Date.now()),
    waitlistOrder: Date.now(),
    fullMessage: teamId ? '本队后补已满' : '名额和后补都满了'
  }
}

async function expireWaitlists(activityId, now) {
  const moment = now || Date.now()
  const rows = await db.collection('signups').where({ activityId, status: 'waitlist' }).limit(100).get()
  for (const row of rows.data) {
    if (row.waitUntil && row.waitUntil <= moment) {
      await db.collection('signups').doc(row._id).update({
        data: { status: 'cancelled', updatedAt: moment }
      })
    }
  }
}

async function promoteWaitlist(activity, teamId) {
  await expireWaitlists(activity._id)
  const mode = signupModeOf(activity)
  const where = { activityId: activity._id, status: 'waitlist' }
  if (mode !== 'joint') where.teamId = teamId
  const quota = await quotaOf(activity._id, teamId)
  if (!quota) return
  const signed = await signedCount(activity._id, teamId)
  let room = quota.maxSignups - signed
  if (room <= 0) return
  const waiting = await db.collection('signups').where(where).limit(100).get()
  const queue = waiting.data.sort((a, b) => (a.waitlistOrder || 0) - (b.waitlistOrder || 0))
  for (const row of queue) {
    if (room <= 0) break
    await db.collection('signups').doc(row._id).update({
      data: { status: 'signed', teamId, updatedAt: Date.now() }
    })
    await clearSystemPigeon(activity._id, row._openid)
    room -= 1
    await maybeRemindNow(activity, row._openid)
    await sendPromote(activity, row)
  }
}

async function maybeRemindNow(activity, openid) {
  if (Date.now() < activity.startTime - remindLeadMs(activity.clubId)) return
  const found = await db.collection('signups').where({
    activityId: activity._id, _openid: openid, status: 'signed'
  }).limit(1).get()
  const row = found.data[0]
  if (!row || !row.remindAccepted || row.remindSent) return
  const sent = await sendRemind(activity, row)
  if (sent) {
    await db.collection('signups').doc(row._id).update({ data: { remindSent: true, updatedAt: Date.now() } })
  }
}

async function sendKickoffReminders() {
  const now = Date.now()
  const upcoming = await db.collection('activities').where({ startTime: _.gt(now) }).limit(50).get()
  let sent = 0
  for (const activity of upcoming.data) {
    if (now < activity.startTime - remindLeadMs(activity.clubId)) continue
    const signups = await db.collection('signups').where({ activityId: activity._id, status: 'signed' }).limit(100).get()
    for (const row of signups.data) {
      if (!row.remindAccepted || row.remindSent) continue
      if (await sendRemind(activity, row)) {
        await db.collection('signups').doc(row._id).update({ data: { remindSent: true, updatedAt: now } })
        sent += 1
      }
    }
  }
  return { sent }
}

async function sendRemind(activity, signup) {
  const templateId = subscribeTemplate('SUBSCRIBE_REMIND_TEMPLATE')
  if (!templateId) return false
  const teams = rosterTeams('joint')
  const team = teams.find((item) => item._id === signup.teamId) || TEAMS.find((item) => item._id === signup.teamId)
  // 公共模板「活动开始通知」：温馨提示/活动名称/主办方/开始时间/活动地点
  return sendSubscribeMessage(signup._openid, templateId, activity._id, {
    thing7: { value: cutText('【杰克的周三球局】今晚有球') },
    thing4: { value: cutText(activity.title) },
    thing11: { value: cutText(team ? team.name : '本场') },
    date3: { value: formatSubscribeTime(activity.startTime) },
    thing6: { value: cutText(activity.location) }
  })
}

async function sendPromote(activity, signup) {
  const templateId = subscribeTemplate('SUBSCRIBE_PROMOTE_TEMPLATE')
  if (!templateId || !signup.promoteAccepted) return false
  // 公共模板「报名候补通知」：候补状态/活动名称/活动时间/活动场馆/温馨提示
  return sendSubscribeMessage(signup._openid, templateId, activity._id, {
    phrase10: { value: '成功' },
    thing2: { value: cutText(activity.title) },
    time4: { value: formatSubscribeChineseTime(activity.startTime) },
    thing3: { value: cutText(activity.location) },
    thing6: { value: cutText('后补成功，已进入正选') }
  })
}

async function sendSubscribeMessage(openid, templateId, activityId, data) {
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId,
      page: `pages/activity/activity?id=${activityId}`,
      data
    })
    return true
  } catch (error) {
    console.error('subscribe send failed', error && error.message)
    return false
  }
}

function cutText(value) {
  const text = String(value || '')
  return text.length > 20 ? text.slice(0, 20) : text
}

function formatSubscribeTime(startTime) {
  const date = new Date(startTime + 8 * 60 * 60 * 1000)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

function formatSubscribeChineseTime(startTime) {
  const date = new Date(startTime + 8 * 60 * 60 * 1000)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

async function saveRound(openid, event) {
  await requireAdmin(openid)
  const activityId = event.activityId
  const activity = await mustGet('activities', activityId)
  if (activity.clubId === CLUB_JIELONG) throw new Error('界龙散客队用场次图记比分')
  const scoreJiong = parseScore(event.scoreJiong)
  const scorePudong = parseScore(event.scorePudong)
  if (event.roundId) {
    await db.collection('rounds').doc(event.roundId).update({
      data: { scoreJiong, scorePudong }
    })
    return { roundId: event.roundId }
  }
  const existing = await db.collection('rounds').where({ activityId }).orderBy('roundNo', 'desc').limit(1).get()
  const roundNo = existing.data[0] ? existing.data[0].roundNo + 1 : 1
  const added = await db.collection('rounds').add({
    data: { activityId, roundNo, scoreJiong, scorePudong, createdAt: Date.now() }
  })
  return { roundId: added._id, roundNo }
}

async function deleteRound(openid, event) {
  if (!event.roundId) throw new Error('缺少轮次')
  const round = await mustGet('rounds', event.roundId)
  const activity = await mustGet('activities', round.activityId)
  await requireActivityAdmin(openid, activity)
  await db.collection('rounds').doc(event.roundId).remove()
  return { removed: true }
}

async function requireActivityAdmin(openid, activity) {
  const user = await requireUser(openid)
  const clubId = (activity && activity.clubId) || CLUB_WEDNESDAY
  const view = membershipView(user, clubId)
  if (view.role === 'owner' || view.role === 'admin' || user.canGrantAdmin) return user
  if (clubId === CLUB_WEDNESDAY && user.isAdmin) return user
  throw new Error('只有管理员可以操作')
}

async function deleteContribution(openid, event) {
  if (!event.contributionId) throw new Error('缺少记录')
  const row = await mustGet('contributions', event.contributionId)
  const activity = await mustGet('activities', row.activityId)
  await requireActivityAdmin(openid, activity)
  // 系统鸽子也可以删；改进球/助攻仍走 assertPigeonEditable
  await db.collection('contributions').doc(event.contributionId).remove()
  return { removed: true }
}

async function requireSignup(activityId, playerOpenid) {
  const signed = await db.collection('signups').where({
    activityId,
    _openid: playerOpenid,
    status: 'signed'
  }).limit(1).get()
  const signup = signed.data[0]
  if (!signup) throw new Error('只能给本场正选记进球、助攻和鸽子')
  const existingPlayer = await findUser(playerOpenid)
  const player = existingPlayer || {
    _openid: playerOpenid,
    name: signup.userName || '队员',
    teamId: signup.teamId || '',
    avatarUrl: signup.avatarUrl || '',
    memberships: []
  }
  return { player, signup }
}

function resolveUserClubGroupId(user, clubId, fallbackTeamId) {
  if (!user) return fallbackTeamId || ''
  const view = membershipView(user, clubId)
  if (clubId === CLUB_JIELONG) {
    return view.groupId || 'jl_other'
  }
  return view.groupId || user.teamId || fallbackTeamId || ''
}

async function setContribution(openid, event) {
  const activityId = event.activityId
  const playerOpenid = event.playerOpenid
  const goals = parseScore(event.goals)
  const assists = parseScore(event.assists)
  const activity = await mustGet('activities', activityId)
  await requireActivityAdmin(openid, activity)
  const { player, signup } = await requireSignup(activityId, playerOpenid)
  const found = await db.collection('contributions').where({ activityId, playerOpenid }).limit(1).get()
  const previous = found.data[0]
  assertPigeonEditable(previous)
  const ownGoals = event.ownGoals !== undefined
    ? parseScore(event.ownGoals)
    : (previous ? previous.ownGoals || 0 : 0)
  const clubId = activity.clubId || CLUB_WEDNESDAY
  const data = {
    activityId,
    playerOpenid,
    userName: player.name || signup.userName || '队员',
    teamId: resolveUserClubGroupId(player, clubId, signup.teamId),
    avatarUrl: player.avatarUrl || signup.avatarUrl || '',
    activityStartTime: activity.startTime,
    goals,
    assists,
    ownGoals,
    absent: !!(previous && previous.absent),
    absentBy: (previous && previous.absentBy) || '',
    pigeonAt: (previous && previous.pigeonAt) || 0,
    updatedAt: Date.now()
  }
  assertNotAbsentWithStats(data.absent, goals, assists, ownGoals)
  if (previous) {
    await db.collection('contributions').doc(previous._id).update({ data })
    return { contributionId: previous._id }
  }
  const added = await db.collection('contributions').add({ data: { ...data, createdAt: Date.now() } })
  return { contributionId: added._id }
}

async function setAbsent(openid, event) {
  const activityId = event.activityId
  const playerOpenid = event.playerOpenid
  const absent = !!event.absent
  const activity = await mustGet('activities', activityId)
  await requireActivityAdmin(openid, activity)
  const { player, signup } = await requireSignup(activityId, playerOpenid)
  const found = await db.collection('contributions').where({ activityId, playerOpenid }).limit(1).get()
  const previous = found.data[0]
  assertPigeonEditable(previous)
  const now = Date.now()
  const clubId = activity.clubId || CLUB_WEDNESDAY
  const data = {
    activityId,
    playerOpenid,
    userName: player.name || signup.userName || '队员',
    teamId: resolveUserClubGroupId(player, clubId, signup.teamId),
    avatarUrl: player.avatarUrl || signup.avatarUrl || '',
    activityStartTime: activity.startTime,
    goals: previous ? previous.goals || 0 : 0,
    assists: previous ? previous.assists || 0 : 0,
    ownGoals: previous ? previous.ownGoals || 0 : 0,
    absent,
    absentBy: absent ? 'admin' : '',
    pigeonAt: absent ? now : 0,
    updatedAt: now
  }
  assertNotAbsentWithStats(absent, data.goals, data.assists, data.ownGoals)
  if (previous) {
    await db.collection('contributions').doc(previous._id).update({ data })
    return { absent }
  }
  await db.collection('contributions').add({ data: { ...data, createdAt: Date.now() } })
  return { absent }
}

async function activityWeather(event) {
  return fetchActivityWeather(event.startTime)
}

function activityMatchesClub(activity, clubId) {
  if (clubId === 'all') return true
  if (clubId === CLUB_JIELONG) return activity.clubId === CLUB_JIELONG
  if (clubId === CLUB_WEDNESDAY) return !activity.clubId || activity.clubId === CLUB_WEDNESDAY
  // 旧调用不传 clubId：榜单仍只算周三联，避免界龙混进来
  return activity.clubId !== CLUB_JIELONG
}

async function loadBoardTotals(span, teamId, now = Date.now(), clubId = '') {
  const start = recentStart(span, now)
  const teamFilter = String(teamId || '').trim()
  const homes = await homeTeams(clubId)
  const activities = (await collect('activities', { startTime: _.gte(start) }))
    .filter((activity) => activityMatchesClub(activity, clubId))
  const activityIds = new Set(activities.map((activity) => activity._id))
  const contributions = withHomeTeam(
    (await collect('contributions', { activityStartTime: _.gte(start) }))
      .filter((row) => activityIds.has(row.activityId)),
    homes
  ).filter((row) => !teamFilter || row.teamId === teamFilter)
  const totals = totalsByPlayer(boardRows(contributions, now))
  const startedIds = activities
    .filter((activity) => activity.startTime <= now)
    .map((activity) => activity._id)
  let attendanceRows = []
  if (startedIds.length) {
    const signups = await collect('signups', {
      status: 'signed',
      activityId: _.in(startedIds)
    })
    const absentKeys = contributions
      .filter((row) => row.absent)
      .map((row) => `${row.activityId}:${row.playerOpenid}`)
    attendanceRows = attendancesByPlayer(withHomeTeam(signups, homes), {
      startedIds,
      absentKeys,
      teamFilter
    })
  }
  return { totals, attendanceRows, span, teamId: teamFilter, clubId: clubId || '' }
}

async function homeSummary(openid, event) {
  const upcoming = await db.collection('activities').where({
    startTime: _.gt(Date.now())
  }).orderBy('startTime', 'asc').limit(30).get()
  const wantClub = event && event.clubId
  const mySignups = await db.collection('signups').where({
    _openid: openid,
    status: 'signed'
  }).limit(100).get()
  const signedByActivity = {}
  for (const row of mySignups.data || []) {
    if (row.activityId) signedByActivity[row.activityId] = row
  }
  // 首页下一场：仅已报名（正选）的最近一场；可按俱乐部筛（数据页）
  const next = (upcoming.data.filter((activity) => {
    if (!signedByActivity[activity._id]) return false
    if (wantClub === 'all') return true
    if (wantClub) return (activity.clubId || CLUB_WEDNESDAY) === wantClub
    return activity.clubId !== CLUB_JIELONG
  })[0]) || null
  const signedUp = !!next
  const signedTeamId = next ? ((signedByActivity[next._id] && signedByActivity[next._id].teamId) || '') : ''
  let waitlistCount = 0
  if (next) {
    const waiting = await db.collection('signups').where({ activityId: next._id, status: 'waitlist' }).count()
    waitlistCount = waiting.total
  }
  let signedCount = 0
  if (next) {
    const signed = await db.collection('signups').where({ activityId: next._id, status: 'signed' }).count()
    signedCount = signed.total
  }
  const nextActivity = next
    ? { ...next, quotas: await quotasOf(next._id), signedUp, signedTeamId, waitlistCount, signedCount }
    : null
  const span = ['3m', '6m', '1y', '2y', '3y'].includes(event.span) ? event.span : '3m'
  const boardClub = wantClub === 'all' || wantClub === CLUB_JIELONG || wantClub === CLUB_WEDNESDAY
    ? wantClub
    : ''
  const teamFilter = String((event && event.teamId) || '').trim()
  const boards = await loadBoardTotals(span, teamFilter, Date.now(), boardClub)
  const { totals, attendanceRows } = boards
  const goalsByOpenid = {}
  for (const row of totals) goalsByOpenid[row.playerOpenid] = row.goals
  for (const row of attendanceRows) {
    row.goals = goalsByOpenid[row.playerOpenid] || 0
  }
  const caller = await findUser(openid)
  let absencesTop = []
  if (canViewAbsenceStats(caller, boardClub)) {
    if (boardClub === 'all' || boardClub === '') {
      const wedOk = canViewAbsenceStats(caller, CLUB_WEDNESDAY)
      const jlOk = canViewAbsenceStats(caller, CLUB_JIELONG)
      if (wedOk && jlOk) {
        absencesTop = await readableAvatars(topBy(totals, 'absences'))
      } else if (wedOk || jlOk) {
        const scoped = await loadBoardTotals(span, teamFilter, Date.now(), wedOk ? CLUB_WEDNESDAY : CLUB_JIELONG)
        absencesTop = await readableAvatars(topBy(scoped.totals, 'absences'))
      }
    } else {
      absencesTop = await readableAvatars(topBy(totals, 'absences'))
    }
  }
  return {
    nextActivity,
    span,
    teamId: teamFilter,
    clubId: boardClub || '',
    goalsTop: await readableAvatars(topBy(totals, 'goals')),
    assistsTop: await readableAvatars(topBy(totals, 'assists')),
    ownGoalsTop: await readableAvatars(topBy(totals, 'ownGoals')),
    attendancesTop: await readableAvatars(topBy(attendanceRows, 'attendances')),
    // 鸽子榜仅管理员；非管理员固定空数组，避免前端误展示
    absencesTop,
    absencesAdminOnly: true,
    teams: next && signupModeOf(next) === 'joint' ? TEAMS.concat([UNITE_TEAM]) : TEAMS
  }
}

async function stats(event) {
  const range = periodRange(event)
  const where = {
    activityStartTime: _.gte(range.start).and(_.lt(range.end))
  }
  const homes = await homeTeams()
  const rows = withHomeTeam(await collect('contributions', where), homes)
    .filter((row) => !event.teamId || row.teamId === event.teamId)
  const list = totalsByPlayer(rows)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.absences - a.absences)
  return { list: await readableAvatars(list), teams: TEAMS, range }
}

async function collect(name, where) {
  const pageSize = 100
  const all = []
  let skip = 0
  while (skip < 1000) {
    const res = await db.collection(name).where(where).skip(skip).limit(pageSize).get()
    all.push(...res.data)
    if (res.data.length < pageSize) break
    skip += pageSize
  }
  return all
}

async function quotasOf(activityId) {
  const res = await db.collection('quotas').where({ activityId }).limit(10).get()
  const counts = {}
  for (const quota of res.data) counts[quota.teamId] = await signedCount(activityId, quota.teamId)
  return res.data.map((quota) => ({ ...quota, signed: counts[quota.teamId] || 0 }))
}

async function homeTeams(clubId = '') {
  const users = await collect('users', {})
  const map = {}
  users.forEach((user) => {
    if (clubId === CLUB_JIELONG) {
      const view = membershipView(user, CLUB_JIELONG)
      map[user._openid] = view.groupId || 'jl_other'
    } else {
      const view = membershipView(user, CLUB_WEDNESDAY)
      map[user._openid] = view.groupId || user.teamId || ''
    }
  })
  return map
}

async function quotaOf(activityId, teamId) {
  const res = await db.collection('quotas').where({ activityId, teamId }).limit(1).get()
  return res.data[0] || null
}

async function signedCount(activityId, teamId) {
  const res = await db.collection('signups').where({ activityId, teamId, status: 'signed' }).count()
  return res.total
}

async function findUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || null
}

async function requireMember(openid) {
  const user = await findUser(openid)
  if (!user) throw new Error('找不到这个队员')
  return user
}

async function requireUser(openid) {
  const user = await findUser(openid)
  if (!user) throw new Error('请先在「我的」里填写姓名和球队')
  return user
}

async function requireAdmin(openid) {
  const user = await requireUser(openid)
  if (!user.isAdmin) throw new Error('只有管理员可以操作')
  return user
}

async function requireOwner(openid) {
  return requireGrantOwner(openid, '只有授权人可以设置管理员')
}

async function requireGrantOwner(openid, message) {
  const user = await ensureOwner(await requireUser(openid))
  if (!user.canGrantAdmin) throw new Error(message)
  return user
}

async function ensureOwner(user) {
  if (!user || !user.isAdmin || user.canGrantAdmin) return user
  const owners = await db.collection('users').where({ canGrantAdmin: true }).count()
  if (owners.total > 0) return user
  const admins = await db.collection('users').where({ isAdmin: true }).limit(20).get()
  const first = admins.data.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0]
  if (!first || first._id !== user._id) return user
  await db.collection('users').doc(user._id).update({ data: { canGrantAdmin: true } })
  return { ...user, canGrantAdmin: true }
}

async function readableUser(user) {
  // Keep stored fileID (cloud://). <image> accepts it; list/canvas paths still use readableAvatars.
  return user
}

async function readableAvatars(rows) {
  const list = rows || []
  const ids = [...new Set(list
    .map((row) => row && row.avatarUrl)
    .filter((url) => typeof url === 'string' && url.startsWith('cloud://')))]
  if (!ids.length) return list
  const map = {}
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      const res = await cloud.getTempFileURL({
        fileList: chunk.map((fileID) => ({ fileID, maxAge: 86400 }))
      })
      for (const item of res.fileList || []) {
        if (item && item.status === 0 && item.tempFileURL) map[item.fileID] = item.tempFileURL
      }
    } catch (error) {
      // 换链失败时保留原 fileID，避免整页名单失败
    }
  }
  if (!Object.keys(map).length) return list
  return list.map((row) => (row && map[row.avatarUrl] ? { ...row, avatarUrl: map[row.avatarUrl] } : row))
}

function publicUser(user) {
  const wednesday = membershipView(user, CLUB_WEDNESDAY)
  const jielong = membershipView(user, CLUB_JIELONG)
  return {
    _id: user._id,
    name: user.name,
    teamId: user.teamId,
    avatarUrl: user.avatarUrl || '',
    preferredPosition: isValidPosition(user.preferredPosition) ? user.preferredPosition : 'mf',
    isAdmin: !!user.isAdmin,
    canGrantAdmin: !!user.canGrantAdmin,
    createdAt: user.createdAt || 0,
    memberships: user.memberships || [],
    clubRoles: {
      [CLUB_WEDNESDAY]: wednesday.role || '',
      [CLUB_JIELONG]: jielong.role || ''
    },
    clubJoined: {
      [CLUB_WEDNESDAY]: !!wednesday.joined,
      [CLUB_JIELONG]: !!jielong.joined
    },
    groupId: wednesday.groupId || user.teamId || '',
    clubGroupIds: {
      [CLUB_WEDNESDAY]: wednesday.groupId || user.teamId || '',
      [CLUB_JIELONG]: jielong.groupId || ''
    }
  }
}

async function mustGet(collection, id) {
  const res = await db.collection(collection).doc(id).get().catch(() => null)
  if (!res || !res.data) throw new Error('记录不存在')
  return res.data
}
