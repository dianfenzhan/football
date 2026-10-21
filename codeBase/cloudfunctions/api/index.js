const cloud = require('wx-server-sdk')
const {
  TEAMS,
  assertNotAbsentWithStats,
  normalizeQuotas,
  parseScore,
  periodRange,
  recentStart,
  topBy,
  totalsByPlayer
} = require('./rules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) return fail('未获取到微信身份')
    await ensureTeams()
    const action = event.action
    if (action === 'me') return ok(await getMe(OPENID))
    if (action === 'saveProfile') return ok(await saveProfile(OPENID, event))
    if (action === 'listMembers') return ok(await listMembers(OPENID))
    if (action === 'listPlayers') return ok(await listPlayers())
    if (action === 'setAdmin') return ok(await setAdmin(OPENID, event))
    if (action === 'listActivities') return ok(await listActivities(OPENID, event))
    if (action === 'activityDetail') return ok(await activityDetail(event.activityId, OPENID))
    if (action === 'createActivity') return ok(await createActivity(OPENID, event))
    if (action === 'deleteActivity') return ok(await deleteActivity(OPENID, event))
    if (action === 'updateQuota') return ok(await updateQuota(OPENID, event))
    if (action === 'signup') return ok(await signup(OPENID, event))
    if (action === 'cancelSignup') return ok(await cancelSignup(OPENID, event))
    if (action === 'saveRound') return ok(await saveRound(OPENID, event))
    if (action === 'deleteRound') return ok(await deleteRound(OPENID, event))
    if (action === 'deleteContribution') return ok(await deleteContribution(OPENID, event))
    if (action === 'setContribution') return ok(await setContribution(OPENID, event))
    if (action === 'setAbsent') return ok(await setAbsent(OPENID, event))
    if (action === 'stats') return ok(await stats(event))
    if (action === 'homeSummary') return ok(await homeSummary(OPENID, event))
    if (action === 'testSetup') return ok(await testSetup(OPENID, event))
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

async function getMe(openid) {
  const user = await ensureOwner(await findUser(openid))
  return { user: await readableUser(user), teams: TEAMS }
}

async function saveProfile(openid, event) {
  const name = String(event.name || '').trim()
  const teamId = event.teamId
  const avatarUrl = typeof event.avatarUrl === 'string' ? event.avatarUrl : undefined
  if (!name) throw new Error('请填写姓名')
  if (!TEAMS.some((team) => team._id === teamId)) throw new Error('请选择球队')
  const existing = await findUser(openid)
  const adminCount = await db.collection('users').where({ isAdmin: true }).count()
  const isAdmin = existing ? !!existing.isAdmin : adminCount.total === 0
  const canGrantAdmin = existing ? !!existing.canGrantAdmin : isAdmin
  const data = { name, teamId, isAdmin, canGrantAdmin, updatedAt: Date.now() }
  if (avatarUrl !== undefined) data.avatarUrl = avatarUrl
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
  const profile = { userName: name, updatedAt: Date.now() }
  if (avatarUrl !== undefined) profile.avatarUrl = avatarUrl
  await db.collection('signups').where({ _openid: openid }).update({ data: profile })
  await db.collection('contributions').where({ playerOpenid: openid }).update({ data: profile })
  return { user: await readableUser(await ensureOwner(user)) }
}

async function listMembers(openid) {
  await requireOwner(openid)
  const res = await db.collection('users').limit(100).get()
  const users = res.data
    .map(publicUser)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  return { users: await readableAvatars(users) }
}

async function listPlayers() {
  const res = await db.collection('users').limit(200).get()
  const users = res.data
    .map(publicUser)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return { users: await readableAvatars(users) }
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
  const res = await db.collection('activities').orderBy('startTime', 'desc').skip((page - 1) * pageSize).limit(pageSize + 1).get()
  const rows = res.data.slice(0, pageSize)
  const activities = []
  for (const activity of rows) {
    const quotas = await quotasOf(activity._id)
    activities.push({ ...activity, quotas })
  }
  return { activities, teams: TEAMS, page, hasMore: res.data.length > pageSize }
}

async function deleteActivity(openid, event) {
  await requireAdmin(openid)
  const activityId = event.activityId
  if (!activityId) throw new Error('缺少活动')
  await mustGet('activities', activityId)
  await removeMatching('quotas', { activityId })
  await removeMatching('signups', { activityId })
  await removeMatching('rounds', { activityId })
  await removeMatching('contributions', { activityId })
  await db.collection('activities').doc(activityId).remove()
  return { removed: true }
}

async function removeMatching(name, where) {
  const rows = await collect(name, where)
  for (const row of rows) {
    await db.collection(name).doc(row._id).remove()
  }
}

async function activityDetail(activityId, openid) {
  if (!activityId) throw new Error('缺少活动')
  const activity = await mustGet('activities', activityId)
  const me = await findUser(openid)
  const quotas = await quotasOf(activityId)
  const signupRes = await db.collection('signups').where({ activityId, status: 'signed' }).limit(100).get()
  const adminRes = await db.collection('users').where({ isAdmin: true }).limit(100).get()
  const adminOpenids = new Set(adminRes.data.map((user) => user._openid))
  const signups = signupRes.data.map((signup) => ({ ...signup, isAdmin: adminOpenids.has(signup._openid) }))
  const roundRes = await db.collection('rounds').where({ activityId }).orderBy('roundNo', 'asc').limit(50).get()
  const contributionRes = await db.collection('contributions').where({ activityId }).limit(100).get()
  return {
    activity,
    quotas,
    signups: await readableAvatars(signups),
    rounds: roundRes.data,
    contributions: await readableAvatars(contributionRes.data),
    members: me && me.isAdmin ? await listMemberBriefs() : [],
    me: await readableUser(me),
    teams: TEAMS
  }
}

async function listMemberBriefs() {
  const res = await db.collection('users').limit(100).get()
  return res.data
    .map((user) => ({ _openid: user._openid, name: user.name, teamId: user.teamId }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
}

async function createActivity(openid, event) {
  await requireAdmin(openid)
  const title = String(event.title || '').trim()
  const location = String(event.location || '').trim()
  const startTime = Number(event.startTime)
  if (!title) throw new Error('请填写标题')
  if (!location) throw new Error('请填写地点')
  if (!startTime) throw new Error('请选择时间')
  const quotas = normalizeQuotas(event.quotas)
  const added = await db.collection('activities').add({
    data: {
      title,
      location,
      startTime,
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

async function updateQuota(openid, event) {
  await requireAdmin(openid)
  const activityId = event.activityId
  const activity = await mustGet('activities', activityId)
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，不能改名额')
  const teamId = event.teamId
  const maxSignups = Number(event.maxSignups)
  if (!activityId || !TEAMS.some((team) => team._id === teamId)) throw new Error('参数不完整')
  if (!Number.isInteger(maxSignups) || maxSignups < 1 || maxSignups > 30) throw new Error('名额为 1 到 30')
  const signed = await signedCount(activityId, teamId)
  if (maxSignups < signed) throw new Error(`已有 ${signed} 人报名，名额不能更低`)
  const quota = await quotaOf(activityId, teamId)
  if (!quota) throw new Error('找不到该队名额')
  await db.collection('quotas').doc(quota._id).update({ data: { maxSignups } })
  return { maxSignups }
}

async function signup(openid, event) {
  const user = await requireUser(openid)
  const activityId = event.activityId
  const activity = await mustGet('activities', activityId)
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，不能报名')
  let teamId = user.teamId
  if (event.teamId != null && event.teamId !== '') {
    if (!TEAMS.some((team) => team._id === event.teamId)) throw new Error('请选择球队')
    teamId = event.teamId
  }
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.collection('signups').where({ activityId, _openid: openid }).limit(1).get()
    const current = existing.data[0]
    if (current && current.status === 'signed') throw new Error('你已经报名了')
    const quotaSnap = await transaction.collection('quotas').where({ activityId, teamId }).limit(1).get()
    const quota = quotaSnap.data[0]
    if (!quota) throw new Error('这场活动没有你所在球队的名额')
    const signedSnap = await transaction.collection('signups').where({ activityId, teamId, status: 'signed' }).limit(100).get()
    if (signedSnap.data.length >= quota.maxSignups) throw new Error('这个队已经满员')
    if (current) {
      await transaction.collection('signups').doc(current._id).update({
        data: { status: 'signed', teamId, userName: user.name, avatarUrl: user.avatarUrl || '', updatedAt: Date.now() }
      })
    } else {
      await transaction.collection('signups').add({
        data: {
          activityId,
          teamId,
          _openid: openid,
          userName: user.name,
          avatarUrl: user.avatarUrl || '',
          status: 'signed',
          createdAt: Date.now()
        }
      })
    }
  })
  return { signed: true }
}

async function cancelSignup(openid, event) {
  const activityId = event.activityId
  const activity = await mustGet('activities', activityId)
  if (activity.startTime <= Date.now()) throw new Error('活动已开始，不能取消报名')
  const existing = await db.collection('signups').where({ activityId, _openid: openid, status: 'signed' }).limit(1).get()
  const current = existing.data[0]
  if (!current) throw new Error('你还没有报名')
  await db.collection('signups').doc(current._id).update({
    data: { status: 'cancelled', updatedAt: Date.now() }
  })
  return { signed: false }
}

async function saveRound(openid, event) {
  await requireAdmin(openid)
  const activityId = event.activityId
  await mustGet('activities', activityId)
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
  await requireAdmin(openid)
  if (!event.roundId) throw new Error('缺少轮次')
  await mustGet('rounds', event.roundId)
  await db.collection('rounds').doc(event.roundId).remove()
  return { removed: true }
}

async function deleteContribution(openid, event) {
  await requireAdmin(openid)
  if (!event.contributionId) throw new Error('缺少记录')
  await mustGet('contributions', event.contributionId)
  await db.collection('contributions').doc(event.contributionId).remove()
  return { removed: true }
}

async function requireSignup(activityId, playerOpenid) {
  const player = await requireMember(playerOpenid)
  const signed = await db.collection('signups').where({
    activityId,
    _openid: playerOpenid,
    status: 'signed'
  }).limit(1).get()
  if (!signed.data[0]) throw new Error('只能给本场已报名的队员记数据')
  return { player, signup: signed.data[0] }
}

async function setContribution(openid, event) {
  await requireAdmin(openid)
  const activityId = event.activityId
  const playerOpenid = event.playerOpenid
  const goals = parseScore(event.goals)
  const assists = parseScore(event.assists)
  const activity = await mustGet('activities', activityId)
  const { player, signup } = await requireSignup(activityId, playerOpenid)
  const found = await db.collection('contributions').where({ activityId, playerOpenid }).limit(1).get()
  const data = {
    activityId,
    playerOpenid,
    userName: player.name,
    teamId: signup.teamId || player.teamId,
    avatarUrl: player.avatarUrl || '',
    activityStartTime: activity.startTime,
    goals,
    assists,
    absent: !!(found.data[0] && found.data[0].absent),
    updatedAt: Date.now()
  }
  assertNotAbsentWithStats(data.absent, goals, assists)
  if (found.data[0]) {
    await db.collection('contributions').doc(found.data[0]._id).update({ data })
    return { contributionId: found.data[0]._id }
  }
  const added = await db.collection('contributions').add({ data: { ...data, createdAt: Date.now() } })
  return { contributionId: added._id }
}

async function setAbsent(openid, event) {
  await requireAdmin(openid)
  const activityId = event.activityId
  const playerOpenid = event.playerOpenid
  const absent = !!event.absent
  const activity = await mustGet('activities', activityId)
  const { player, signup } = await requireSignup(activityId, playerOpenid)
  const found = await db.collection('contributions').where({ activityId, playerOpenid }).limit(1).get()
  const previous = found.data[0]
  const data = {
    activityId,
    playerOpenid,
    userName: player.name,
    teamId: signup.teamId || player.teamId,
    avatarUrl: player.avatarUrl || '',
    activityStartTime: activity.startTime,
    goals: previous ? previous.goals || 0 : 0,
    assists: previous ? previous.assists || 0 : 0,
    absent,
    updatedAt: Date.now()
  }
  assertNotAbsentWithStats(absent, data.goals, data.assists)
  if (previous) {
    await db.collection('contributions').doc(previous._id).update({ data })
    return { absent }
  }
  await db.collection('contributions').add({ data: { ...data, createdAt: Date.now() } })
  return { absent }
}

async function homeSummary(openid, event) {
  const upcoming = await db.collection('activities').where({
    startTime: _.gt(Date.now())
  }).orderBy('startTime', 'asc').limit(20).get()
  const next = upcoming.data[0] || null
  let signedUp = false
  let signedTeamId = ''
  if (next) {
    const mine = await db.collection('signups').where({
      activityId: next._id,
      _openid: openid,
      status: 'signed'
    }).limit(1).get()
    if (mine.data[0]) {
      signedUp = true
      signedTeamId = mine.data[0].teamId || ''
    }
  }
  const nextActivity = next
    ? { ...next, quotas: await quotasOf(next._id), signedUp, signedTeamId }
    : null
  const span = ['3m', '6m', '1y', '2y', '3y'].includes(event.span) ? event.span : '3m'
  const start = recentStart(span)
  const teamFilter = TEAMS.some((team) => team._id === event.teamId) ? event.teamId : ''
  const where = { activityStartTime: _.gte(start) }
  if (teamFilter) where.teamId = teamFilter
  const totals = totalsByPlayer(await collect('contributions', where))
  return {
    nextActivity,
    span,
    teamId: teamFilter,
    goalsTop: await readableAvatars(topBy(totals, 'goals')),
    assistsTop: await readableAvatars(topBy(totals, 'assists')),
    absencesTop: await readableAvatars(topBy(totals, 'absences')),
    teams: TEAMS
  }
}

async function stats(event) {
  const range = periodRange(event)
  const where = {
    activityStartTime: _.gte(range.start).and(_.lt(range.end))
  }
  if (event.teamId) where.teamId = event.teamId
  const list = totalsByPlayer(await collect('contributions', where))
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
  for (const team of TEAMS) counts[team._id] = await signedCount(activityId, team._id)
  return res.data.map((quota) => ({ ...quota, signed: counts[quota.teamId] || 0 }))
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
  const user = await ensureOwner(await requireUser(openid))
  if (!user.canGrantAdmin) throw new Error('只有授权人可以设置管理员')
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
  if (!user) return user
  const [next] = await readableAvatars([user])
  return next
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
  return {
    _id: user._id,
    name: user.name,
    teamId: user.teamId,
    avatarUrl: user.avatarUrl || '',
    isAdmin: !!user.isAdmin,
    canGrantAdmin: !!user.canGrantAdmin,
    createdAt: user.createdAt || 0
  }
}

async function mustGet(collection, id) {
  const res = await db.collection(collection).doc(id).get().catch(() => null)
  if (!res || !res.data) throw new Error('记录不存在')
  return res.data
}

// ---- 回归测试专用：仅在云函数配置了 REGRESSION_KEY 环境变量且入参匹配时可用 ----

const FAKE_OPENID = 'regression_fake_openid'

async function testSetup(openid, event) {
  if (!process.env.REGRESSION_KEY || event.key !== process.env.REGRESSION_KEY) {
    throw new Error('forbidden')
  }
  const op = event.op
  if (op === 'ping') return { ready: true }
  if (op === 'snapshot') {
    return { user: await findUser(openid) }
  }
  if (op === 'unregister') {
    await removeMatching('users', { _openid: openid })
    return { removed: true }
  }
  if (op === 'restore') {
    const record = event.record
    if (!record) throw new Error('缺少快照')
    await removeMatching('users', { _openid: openid })
    const data = { ...record, _openid: openid }
    if (!data._id) delete data._id
    await db.collection('users').add({ data })
    return { restored: true }
  }
  if (op === 'setRole') {
    const user = await requireUser(openid)
    await db.collection('users').doc(user._id).update({
      data: { isAdmin: !!event.isAdmin, canGrantAdmin: !!event.canGrantAdmin, updatedAt: Date.now() }
    })
    return { done: true }
  }
  if (op === 'createFake') {
    await removeFakeRecords()
    const added = await db.collection('users').add({
      data: {
        _openid: FAKE_OPENID,
        name: String(event.name || '回归假人'),
        teamId: TEAMS.some((team) => team._id === event.teamId) ? event.teamId : TEAMS[0]._id,
        avatarUrl: '',
        isAdmin: !!event.isAdmin,
        canGrantAdmin: !!event.canGrantAdmin,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    })
    return { userId: added._id, fakeOpenid: FAKE_OPENID }
  }
  if (op === 'fakeSignup') {
    const activityId = event.activityId
    if (!activityId) throw new Error('缺少活动')
    const fake = await findUser(FAKE_OPENID)
    if (!fake) throw new Error('假队员不存在')
    await removeMatching('signups', { activityId, _openid: FAKE_OPENID })
    await db.collection('signups').add({
      data: {
        activityId,
        teamId: fake.teamId,
        _openid: FAKE_OPENID,
        userName: fake.name,
        avatarUrl: '',
        status: 'signed',
        createdAt: Date.now()
      }
    })
    return { signed: true }
  }
  if (op === 'removeFake') {
    await removeFakeRecords()
    return { removed: true }
  }
  throw new Error('未知 op')
}

async function removeFakeRecords() {
  await removeMatching('users', { _openid: FAKE_OPENID })
  await removeMatching('signups', { _openid: FAKE_OPENID })
  await removeMatching('contributions', { playerOpenid: FAKE_OPENID })
}
