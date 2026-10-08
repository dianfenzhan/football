/**
 * API smoke test via miniprogram-automator.
 * Requires WeChat DevTools automation port (default ws://127.0.0.1:9421).
 * The logged-in account must already be an admin.
 * Each run creates one activity titled 冒烟 … and deletes it with all its records at the end (best-effort also on failure).
 */
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'

function periodQuery(type, teamId) {
  const now = new Date()
  const query = {
    periodType: type,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    quarter: Math.floor(now.getMonth() / 3) + 1
  }
  if (teamId) query.teamId = teamId
  return query
}

async function callApi(miniProgram, action, data = {}) {
  return miniProgram.evaluate(
    async (action, data) => {
      const res = await wx.cloud.callFunction({
        name: 'api',
        data: { action, ...data }
      })
      return res.result
    },
    action,
    data
  )
}

function pass(name) {
  console.log('PASS', name)
}

function assertOk(name, result) {
  if (!result || !result.ok) {
    const message = (result && result.message) || 'no result'
    throw new Error(name + ': ' + message)
  }
  pass(name)
  return result
}

function assertFail(name, result) {
  if (result && result.ok) throw new Error(name + ': expected failure')
  pass(name)
  return result
}

async function statRow(miniProgram, openid, type, teamId) {
  const stats = assertOk('stats:' + type + (teamId ? ':' + teamId : ''), await callApi(
    miniProgram,
    'stats',
    periodQuery(type, teamId)
  ))
  const row = (stats.list || []).find((item) => item.playerOpenid === openid)
  return {
    goals: row ? row.goals : 0,
    assists: row ? row.assists : 0,
    absences: row ? row.absences : 0
  }
}

async function main() {
  console.log('connect', WS)
  const miniProgram = await automator.connect({ wsEndpoint: WS })
  let activityId = ''
  let cancelled = false
  let deleted = false

  try {
    const me0 = assertOk('me', await callApi(miniProgram, 'me'))
    let user = me0.user
    if (!user) {
      const saved = assertOk('saveProfile', await callApi(miniProgram, 'saveProfile', {
        name: '冒烟管理员',
        teamId: 'team_pudong'
      }))
      user = saved.user
    }
    if (!user.isAdmin) throw new Error('me: 当前微信号不是管理员，冒烟停在这里')
    if (!user._openid) throw new Error('me: 缺少 openid')
    pass('admin ' + user.name)

    assertFail('saveProfile empty name', await callApi(miniProgram, 'saveProfile', {
      name: '',
      teamId: user.teamId
    }))

    const smokeAvatar = 'cloud://smoke-avatar-check'
    const savedAvatar = assertOk('saveProfile avatar', await callApi(miniProgram, 'saveProfile', {
      name: user.name,
      teamId: user.teamId,
      avatarUrl: smokeAvatar
    }))
    if (savedAvatar.user.avatarUrl !== smokeAvatar) throw new Error('saveProfile avatar: not persisted in response')
    const meAvatar = assertOk('me avatar', await callApi(miniProgram, 'me'))
    if (meAvatar.user.avatarUrl !== smokeAvatar) throw new Error('me avatar: avatarUrl mismatch')
    pass('avatar persisted')

    const members = await callApi(miniProgram, 'listMembers')
    if (user.canGrantAdmin) assertOk('listMembers', members)
    else assertFail('listMembers denied', members)

    const players = assertOk('listPlayers', await callApi(miniProgram, 'listPlayers'))
    if (!Array.isArray(players.users)) throw new Error('listPlayers: missing users')
    const playerList = players.users
    const sortedDesc = playerList.every((item, idx) => (
      idx === 0 || (playerList[idx - 1].createdAt || 0) >= (item.createdAt || 0)
    ))
    if (!sortedDesc) throw new Error('listPlayers: not sorted by createdAt desc')
    if (!playerList.some((item) => item._id === user._id)) throw new Error('listPlayers: current user missing')
    if (!('avatarUrl' in playerList.find((item) => item._id === user._id))) {
      throw new Error('listPlayers: avatarUrl field missing')
    }
    pass('listPlayers sorted desc')

    const openid = user._openid
    const before = {
      month: await statRow(miniProgram, openid, 'month'),
      quarter: await statRow(miniProgram, openid, 'quarter'),
      year: await statRow(miniProgram, openid, 'year'),
      team: await statRow(miniProgram, openid, 'month', user.teamId)
    }

    const created = assertOk('createActivity', await callApi(miniProgram, 'createActivity', {
      title: '冒烟 ' + new Date().toISOString(),
      location: '冒烟球场',
      startTime: Date.now() + 10 * 60 * 1000,
      quotas: { team_jiong: 12, team_pudong: 12 }
    }))
    activityId = created.activityId

    assertOk('signup', await callApi(miniProgram, 'signup', { activityId }))
    assertFail('signup duplicate', await callApi(miniProgram, 'signup', { activityId }))

    const homeSigned = assertOk('homeSummary signedUp true', await callApi(miniProgram, 'homeSummary'))
    if (!(homeSigned.nextActivity && homeSigned.nextActivity._id === activityId)) {
      throw new Error('homeSummary: smoke activity not nextActivity')
    }
    if (homeSigned.nextActivity.signedUp !== true) {
      throw new Error('homeSummary: nextActivity.signedUp not true after signup')
    }
    pass('homeSummary signedUp true')

    const detail = assertOk('activityDetail', await callApi(miniProgram, 'activityDetail', { activityId }))
    if (detail.signups.length !== 1) throw new Error('activityDetail: expected 1 signup')
    if (!detail.signups.every((item) => typeof item.isAdmin === 'boolean')) {
      throw new Error('activityDetail: signup missing isAdmin')
    }
    if (detail.signups[0].avatarUrl !== smokeAvatar) {
      throw new Error('activityDetail: signup avatarUrl not synced')
    }
    pass('one signup')

    const round = assertOk('saveRound', await callApi(miniProgram, 'saveRound', {
      activityId,
      scoreJiong: 2,
      scorePudong: 1
    }))
    if (!round.roundId) throw new Error('saveRound: missing roundId')
    assertOk('deleteRound', await callApi(miniProgram, 'deleteRound', { roundId: round.roundId }))
    const afterDelete = assertOk('activityDetail after deleteRound', await callApi(
      miniProgram,
      'activityDetail',
      { activityId }
    ))
    if ((afterDelete.rounds || []).some((item) => item._id === round.roundId)) {
      throw new Error('deleteRound: round still present')
    }
    pass('round removed')

    assertFail('setContribution unsigned', await callApi(miniProgram, 'setContribution', {
      activityId,
      playerOpenid: 'openid_not_signed',
      goals: 1,
      assists: 0
    }))
    assertOk('setContribution', await callApi(miniProgram, 'setContribution', {
      activityId,
      playerOpenid: openid,
      goals: 1,
      assists: 1
    }))
    assertFail('setAbsent unsigned', await callApi(miniProgram, 'setAbsent', {
      activityId,
      playerOpenid: 'openid_not_signed',
      absent: true
    }))
    assertFail('setAbsent with stats', await callApi(miniProgram, 'setAbsent', {
      activityId,
      playerOpenid: openid,
      absent: true
    }))
    assertOk('setContribution clear', await callApi(miniProgram, 'setContribution', {
      activityId,
      playerOpenid: openid,
      goals: 0,
      assists: 0
    }))
    const absent = assertOk('setAbsent', await callApi(miniProgram, 'setAbsent', {
      activityId,
      playerOpenid: openid,
      absent: true
    }))
    if (!absent.absent) throw new Error('setAbsent: expected absent true')

    const after = {
      month: await statRow(miniProgram, openid, 'month'),
      quarter: await statRow(miniProgram, openid, 'quarter'),
      year: await statRow(miniProgram, openid, 'year'),
      team: await statRow(miniProgram, openid, 'month', user.teamId)
    }
    for (const key of Object.keys(before)) {
      const deltaGoals = after[key].goals - before[key].goals
      const deltaAssists = after[key].assists - before[key].assists
      const deltaAbsences = after[key].absences - before[key].absences
      if (deltaGoals !== 0 || deltaAssists !== 0 || deltaAbsences !== 1) {
        throw new Error('stats delta ' + key + ' ' + JSON.stringify({
          before: before[key],
          after: after[key]
        }))
      }
      pass('stats delta ' + key)
    }

    const statsAvatar = assertOk('stats:avatar', await callApi(miniProgram, 'stats', periodQuery('month')))
    const avatarRow = (statsAvatar.list || []).find((item) => item.playerOpenid === openid)
    if (!avatarRow || avatarRow.avatarUrl !== smokeAvatar) {
      throw new Error('stats avatar: avatarUrl not exposed in list row')
    }
    pass('stats avatar exposed')

    assertFail('updateQuota below signed', await callApi(miniProgram, 'updateQuota', {
      activityId,
      teamId: user.teamId,
      maxSignups: 0
    }))
    assertOk('updateQuota expand', await callApi(miniProgram, 'updateQuota', {
      activityId,
      teamId: user.teamId,
      maxSignups: 14
    }))

    const home = assertOk('homeSummary', await callApi(miniProgram, 'homeSummary'))
    if (!home.nextActivity) throw new Error('homeSummary: missing nextActivity')
    if (!Array.isArray(home.goalsTop) || !Array.isArray(home.assistsTop) || !Array.isArray(home.absencesTop)) {
      throw new Error('homeSummary: missing top lists')
    }
    pass('homeSummary shape')

    assertOk('cancelSignup', await callApi(miniProgram, 'cancelSignup', { activityId }))
    cancelled = true
    assertFail('cancelSignup again', await callApi(miniProgram, 'cancelSignup', { activityId }))

    const homeUnsigned = assertOk('homeSummary signedUp false', await callApi(miniProgram, 'homeSummary'))
    if (homeUnsigned.nextActivity && homeUnsigned.nextActivity._id === activityId
      && homeUnsigned.nextActivity.signedUp !== false) {
      throw new Error('homeSummary: nextActivity.signedUp not false after cancel')
    }
    pass('homeSummary signedUp false')

    let found = false
    let page = 1
    let hasMore = true
    while (!found && hasMore && page <= 20) {
      const list = assertOk('listActivities', await callApi(miniProgram, 'listActivities', { page }))
      if ((list.activities || []).length > 20) throw new Error('listActivities: page longer than 20')
      found = (list.activities || []).some((item) => item._id === activityId)
      hasMore = !!list.hasMore
      page += 1
    }
    if (!found) throw new Error('listActivities: new activity missing')
    pass('activity listed')

    assertOk('deleteActivity', await callApi(miniProgram, 'deleteActivity', { activityId }))
    deleted = true
    assertFail('activityDetail after delete', await callApi(miniProgram, 'activityDetail', { activityId }))

    const cleared = assertOk('saveProfile avatar clear', await callApi(miniProgram, 'saveProfile', {
      name: user.name,
      teamId: user.teamId,
      avatarUrl: ''
    }))
    if (cleared.user.avatarUrl) throw new Error('avatar clear: still present')
    pass('avatar cleared')

    console.log('ALL CHECKS PASSED')
  } finally {
    if (activityId) {
      if (!cancelled) {
        await callApi(miniProgram, 'cancelSignup', { activityId }).catch(() => {})
      }
      if (!deleted) {
        await callApi(miniProgram, 'deleteActivity', { activityId }).catch(() => {})
      }
    }
    miniProgram.disconnect()
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err)
  process.exit(1)
})
