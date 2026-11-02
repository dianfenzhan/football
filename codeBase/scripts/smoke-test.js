/**
 * API smoke test via miniprogram-automator.
 * Requires WeChat DevTools automation port (default ws://127.0.0.1:9421).
 * The logged-in account must already be an admin.
 * Each run creates activities titled 冒烟 … and deletes them with all records at the end
 * (best-effort also on failure).
 */
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const HOUR_MS = 60 * 60 * 1000

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

function track(activityIds, activityId) {
  if (activityId) activityIds.push(activityId)
  return activityId
}

async function cleanupActivities(miniProgram, activityIds) {
  for (let i = activityIds.length - 1; i >= 0; i -= 1) {
    const activityId = activityIds[i]
    await callApi(miniProgram, 'cancelSignup', { activityId }).catch(() => {})
    await callApi(miniProgram, 'deleteActivity', { activityId }).catch(() => {})
  }
}

async function main() {
  console.log('connect', WS)
  const miniProgram = await automator.connect({ wsEndpoint: WS })
  const activityIds = []
  let activityId = ''

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
    assertFail('saveProfile bad team', await callApi(miniProgram, 'saveProfile', {
      name: user.name,
      teamId: 'team_ghost'
    }))
    assertFail('saveProfile bad position', await callApi(miniProgram, 'saveProfile', {
      name: user.name,
      teamId: user.teamId,
      preferredPosition: 'striker'
    }))

    const members = await callApi(miniProgram, 'listMembers')
    if (user.canGrantAdmin) assertOk('listMembers', members)
    else assertFail('listMembers denied', members)
    const owner = !!user.canGrantAdmin
    const assertDelete = (name, result) => (
      owner ? assertOk(name, result) : assertFail(name + ' denied', result)
    )

    const players = assertOk('listPlayers', await callApi(miniProgram, 'listPlayers'))
    if (!Array.isArray(players.users)) throw new Error('listPlayers: missing users')
    const playerList = players.users
    const sortedDesc = playerList.every((item, idx) => (
      idx === 0 || (playerList[idx - 1].createdAt || 0) >= (item.createdAt || 0)
    ))
    if (!sortedDesc) throw new Error('listPlayers: not sorted by createdAt desc')
    if (!playerList.some((item) => item._id === user._id)) throw new Error('listPlayers: current user missing')
    pass('listPlayers sorted desc')

    const openid = user._openid
    const otherTeamId = user.teamId === 'team_jiong' ? 'team_pudong' : 'team_jiong'
    const before = {
      month: await statRow(miniProgram, openid, 'month'),
      quarter: await statRow(miniProgram, openid, 'quarter'),
      year: await statRow(miniProgram, openid, 'year'),
      team: await statRow(miniProgram, openid, 'month', user.teamId)
    }

    assertFail('createActivity empty title', await callApi(miniProgram, 'createActivity', {
      title: '',
      location: '冒烟球场',
      startTime: Date.now() + 7 * 24 * HOUR_MS,
      quotas: { team_jiong: 11, team_pudong: 11 }
    }))
    assertFail('createActivity empty location', await callApi(miniProgram, 'createActivity', {
      title: '冒烟空地点',
      location: '',
      startTime: Date.now() + 7 * 24 * HOUR_MS,
      quotas: { team_jiong: 11, team_pudong: 11 }
    }))

    // --- 分队后补 / 顶上 / setWaitUntil（+7 天，取消不记鸽子）---
    const waitlistCreated = assertOk('createActivity split', await callApi(miniProgram, 'createActivity', {
      title: '冒烟后补 ' + Date.now(),
      location: '冒烟球场',
      startTime: Date.now() + 7 * 24 * HOUR_MS,
      signupMode: 'split',
      quotas: { [user.teamId]: 1, [otherTeamId]: 12 }
    }))
    const waitlistActivityId = track(activityIds, waitlistCreated.activityId)
    assertOk('smokeSeedSignups signed', await callApi(miniProgram, 'smokeSeedSignups', {
      activityId: waitlistActivityId,
      teamId: user.teamId,
      status: 'signed',
      count: 1
    }))
    assertFail('signup full without choice', await callApi(miniProgram, 'signup', {
      activityId: waitlistActivityId
    }))
    const otherWhenFull = assertOk('signup choice other when full', await callApi(miniProgram, 'signup', {
      activityId: waitlistActivityId,
      choice: 'other'
    }))
    if (!otherWhenFull.signed || otherWhenFull.teamId !== otherTeamId) {
      throw new Error('signup choice other: expected other team signed')
    }
    assertOk('cancelSignup choice other', await callApi(miniProgram, 'cancelSignup', {
      activityId: waitlistActivityId
    }))
    assertOk('smokeSeedSignups other full', await callApi(miniProgram, 'smokeSeedSignups', {
      activityId: waitlistActivityId,
      teamId: otherTeamId,
      status: 'signed',
      count: 12
    }))
    assertFail('signup choice other when other full', await callApi(miniProgram, 'signup', {
      activityId: waitlistActivityId,
      choice: 'other'
    }))
    const waitSignup = assertOk('signup split waitlist', await callApi(miniProgram, 'signup', {
      activityId: waitlistActivityId,
      choice: 'waitlist',
      waitHours: 8
    }))
    if (!waitSignup.waitlist) throw new Error('signup split waitlist: expected waitlist')
    const waited = assertOk('setWaitUntil', await callApi(miniProgram, 'setWaitUntil', {
      activityId: waitlistActivityId,
      waitHours: 4
    }))
    if (!waited.waitUntil) throw new Error('setWaitUntil: missing waitUntil')
    assertFail('setWaitUntil bad hours', await callApi(miniProgram, 'setWaitUntil', {
      activityId: waitlistActivityId,
      waitHours: 99
    }))
    assertOk('updateQuota promote waitlist', await callApi(miniProgram, 'updateQuota', {
      activityId: waitlistActivityId,
      teamId: user.teamId,
      maxSignups: 2
    }))
    const afterPromote = assertOk('activityDetail after waitlist promote', await callApi(miniProgram, 'activityDetail', {
      activityId: waitlistActivityId
    }))
    const promoted = (afterPromote.signups || []).find((item) => item._openid === openid)
    if (!promoted || promoted.status !== 'signed') {
      throw new Error('updateQuota: waitlist not promoted to signed')
    }
    pass('updateQuota promotes waitlist')
    assertFail('updateQuota below signed count', await callApi(miniProgram, 'updateQuota', {
      activityId: waitlistActivityId,
      teamId: user.teamId,
      maxSignups: 1
    }))
    assertFail('moveSignup on split', await callApi(miniProgram, 'moveSignup', {
      activityId: waitlistActivityId,
      teamId: 'team_unite'
    }))
    assertFail('swapSignups on split', await callApi(miniProgram, 'swapSignups', {
      activityId: waitlistActivityId,
      openidA: openid,
      openidB: 'smoke_fake_none'
    }))
    assertOk('smokeSeedSignups waitlist', await callApi(miniProgram, 'smokeSeedSignups', {
      activityId: waitlistActivityId,
      teamId: user.teamId,
      status: 'waitlist',
      count: 1
    }))
    assertOk('cancel promotes waitlist', await callApi(miniProgram, 'cancelSignup', {
      activityId: waitlistActivityId
    }))
    const afterCancelPromote = assertOk('activityDetail after cancel promote', await callApi(miniProgram, 'activityDetail', {
      activityId: waitlistActivityId
    }))
    const fakePromoted = (afterCancelPromote.signups || []).find((item) => (
      String(item._openid || '').startsWith('smoke_fake_') && item.status === 'signed'
    ))
    if (!fakePromoted) throw new Error('cancelSignup: waitlist fake not promoted')
    pass('cancel promotes waitlist')
    assertDelete('deleteActivity waitlist', await callApi(miniProgram, 'deleteActivity', {
      activityId: waitlistActivityId
    }))
    activityIds.pop()

    // --- 联合报名 / moveSignup ---
    const joint = assertOk('createActivity joint', await callApi(miniProgram, 'createActivity', {
      title: '冒烟联合 ' + Date.now(),
      location: '冒烟球场',
      startTime: Date.now() + 7 * 24 * HOUR_MS,
      signupMode: 'joint'
    }))
    const jointId = track(activityIds, joint.activityId)
    const jointDetail = assertOk('activityDetail joint', await callApi(miniProgram, 'activityDetail', {
      activityId: jointId
    }))
    if ((jointDetail.quotas || []).length !== 3 || (jointDetail.quotas || []).some((item) => item.maxSignups !== 8)) {
      throw new Error('joint quotas must be three groups of 8')
    }
    assertFail('updateQuota joint denied', await callApi(miniProgram, 'updateQuota', {
      activityId: jointId,
      teamId: user.teamId,
      maxSignups: 9
    }))
    const jointSignup = assertOk('signup joint own group', await callApi(miniProgram, 'signup', {
      activityId: jointId
    }))
    if (jointSignup.teamId !== user.teamId || !jointSignup.signed) {
      throw new Error('signup joint: expected own group signed')
    }
    assertOk('smokeSeedSignups joint other full', await callApi(miniProgram, 'smokeSeedSignups', {
      activityId: jointId,
      teamId: otherTeamId,
      status: 'signed',
      count: 8
    }))
    assertFail('moveSignup group full', await callApi(miniProgram, 'moveSignup', {
      activityId: jointId,
      teamId: otherTeamId
    }))
    assertOk('moveSignup', await callApi(miniProgram, 'moveSignup', {
      activityId: jointId,
      teamId: 'team_unite'
    }))
    const moved = assertOk('activityDetail after moveSignup', await callApi(miniProgram, 'activityDetail', {
      activityId: jointId
    }))
    const movedRow = (moved.signups || []).find((item) => item._openid === openid)
    if (!movedRow || movedRow.teamId !== 'team_unite') {
      throw new Error('moveSignup: teamId not team_unite')
    }
    pass('moveSignup to unite')
    const beforeSwap = assertOk('activityDetail before swap', await callApi(miniProgram, 'activityDetail', {
      activityId: jointId
    }))
    const swapMate = (beforeSwap.signups || []).find((item) => (
      String(item._openid || '').startsWith('smoke_fake_')
      && item.status === 'signed'
      && item.teamId === otherTeamId
    ))
    if (!swapMate) throw new Error('swapSignups: missing seeded teammate')
    assertFail('swapSignups same player', await callApi(miniProgram, 'swapSignups', {
      activityId: jointId,
      openidA: openid,
      openidB: openid
    }))
    assertOk('swapSignups', await callApi(miniProgram, 'swapSignups', {
      activityId: jointId,
      openidA: openid,
      openidB: swapMate._openid
    }))
    const afterSwap = assertOk('activityDetail after swap', await callApi(miniProgram, 'activityDetail', {
      activityId: jointId
    }))
    const swappedUser = (afterSwap.signups || []).find((item) => item._openid === openid)
    const swappedMate = (afterSwap.signups || []).find((item) => item._openid === swapMate._openid)
    if (!swappedUser || swappedUser.teamId !== otherTeamId) {
      throw new Error('swapSignups: user team not exchanged')
    }
    if (!swappedMate || swappedMate.teamId !== 'team_unite') {
      throw new Error('swapSignups: mate team not exchanged')
    }
    const otherSigned = (afterSwap.signups || []).filter((item) => item.status === 'signed' && item.teamId === otherTeamId).length
    const uniteSigned = (afterSwap.signups || []).filter((item) => item.status === 'signed' && item.teamId === 'team_unite').length
    if (otherSigned !== 8 || uniteSigned !== 1) {
      throw new Error('swapSignups: signed counts changed')
    }
    const sameTeamMates = (afterSwap.signups || []).filter((item) => (
      String(item._openid || '').startsWith('smoke_fake_')
      && item.status === 'signed'
      && item.teamId === otherTeamId
    ))
    if (sameTeamMates.length < 2) throw new Error('swapSignups: need two same-team mates')
    assertFail('swapSignups same team', await callApi(miniProgram, 'swapSignups', {
      activityId: jointId,
      openidA: sameTeamMates[0]._openid,
      openidB: sameTeamMates[1]._openid
    }))
    pass('swapSignups exchanged')
    assertOk('cancelSignup joint', await callApi(miniProgram, 'cancelSignup', { activityId: jointId }))
    assertDelete('deleteActivity joint', await callApi(miniProgram, 'deleteActivity', { activityId: jointId }))
    activityIds.pop()

    // --- 联合本队满进联队；三组都满进共享后补 ---
    const unite = assertOk('createActivity joint overflow', await callApi(miniProgram, 'createActivity', {
      title: '冒烟联合溢出 ' + Date.now(),
      location: '冒烟球场',
      startTime: Date.now() + 8 * 24 * HOUR_MS,
      signupMode: 'joint'
    }))
    const uniteId = track(activityIds, unite.activityId)
    assertOk('smokeSeedSignups home full', await callApi(miniProgram, 'smokeSeedSignups', {
      activityId: uniteId,
      teamId: user.teamId,
      status: 'signed',
      count: 8
    }))
    const toUnite = assertOk('signup joint home full to unite', await callApi(miniProgram, 'signup', {
      activityId: uniteId
    }))
    if (!toUnite.signed || toUnite.teamId !== 'team_unite') {
      throw new Error('signup joint overflow: expected team_unite')
    }
    assertOk('cancelSignup joint overflow', await callApi(miniProgram, 'cancelSignup', { activityId: uniteId }))
    assertOk('smokeSeedSignups unite full', await callApi(miniProgram, 'smokeSeedSignups', {
      activityId: uniteId,
      teamId: 'team_unite',
      status: 'signed',
      count: 8
    }))
    assertOk('smokeSeedSignups other full', await callApi(miniProgram, 'smokeSeedSignups', {
      activityId: uniteId,
      teamId: otherTeamId,
      status: 'signed',
      count: 8
    }))
    const sharedWait = assertOk('signup joint shared waitlist', await callApi(miniProgram, 'signup', {
      activityId: uniteId,
      waitHours: 4
    }))
    if (!sharedWait.waitlist) throw new Error('signup joint shared waitlist: expected waitlist')
    assertDelete('deleteActivity joint overflow', await callApi(miniProgram, 'deleteActivity', { activityId: uniteId }))
    activityIds.pop()

    // --- 临期内退出后补不记鸽子；过期档位拒绝 ---
    const nearWait = assertOk('createActivity near waitlist', await callApi(miniProgram, 'createActivity', {
      title: '冒烟临期后补 ' + Date.now(),
      location: '冒烟球场',
      startTime: Date.now() + 30 * 60 * 1000,
      quotas: { [user.teamId]: 1, [otherTeamId]: 12 }
    }))
    const nearWaitId = track(activityIds, nearWait.activityId)
    assertOk('smokeSeedSignups near', await callApi(miniProgram, 'smokeSeedSignups', {
      activityId: nearWaitId,
      teamId: user.teamId,
      status: 'signed',
      count: 1
    }))
    assertOk('signup near waitlist', await callApi(miniProgram, 'signup', {
      activityId: nearWaitId,
      choice: 'waitlist',
      waitHours: 0
    }))
    assertFail('setWaitUntil expired hours', await callApi(miniProgram, 'setWaitUntil', {
      activityId: nearWaitId,
      waitHours: 16
    }))
    const cancelWait = assertOk('cancelSignup waitlist', await callApi(miniProgram, 'cancelSignup', {
      activityId: nearWaitId
    }))
    if (cancelWait.pigeon) throw new Error('cancel waitlist: unexpected pigeon')
    const nearAfter = assertOk('activityDetail after cancel waitlist', await callApi(miniProgram, 'activityDetail', {
      activityId: nearWaitId
    }))
    if ((nearAfter.pigeons || []).some((row) => row.playerOpenid === openid)) {
      throw new Error('cancel waitlist: system pigeon recorded')
    }
    pass('cancel waitlist no pigeon')
    assertDelete('deleteActivity near waitlist', await callApi(miniProgram, 'deleteActivity', {
      activityId: nearWaitId
    }))
    activityIds.pop()

    // --- 提早取消（≥4 小时）不记系统鸽子 ---
    const early = assertOk('createActivity early cancel', await callApi(miniProgram, 'createActivity', {
      title: '冒烟提早取消 ' + Date.now(),
      location: '冒烟球场',
      startTime: Date.now() + 5 * HOUR_MS,
      quotas: { team_jiong: 12, team_pudong: 12 }
    }))
    const earlyId = track(activityIds, early.activityId)
    assertOk('signup early', await callApi(miniProgram, 'signup', { activityId: earlyId }))
    const earlyBefore = assertOk('activityDetail before early cancel', await callApi(miniProgram, 'activityDetail', {
      activityId: earlyId
    }))
    if (earlyBefore.cancelWillPigeon) {
      throw new Error('activityDetail: cancel ≥4 hours should not record pigeon')
    }
    const earlyCancel = assertOk('cancelSignup early', await callApi(miniProgram, 'cancelSignup', {
      activityId: earlyId
    }))
    if (earlyCancel.pigeon) throw new Error('cancelSignup early: unexpected pigeon')
    const earlyAfter = assertOk('activityDetail after early cancel', await callApi(miniProgram, 'activityDetail', {
      activityId: earlyId
    }))
    if ((earlyAfter.pigeons || []).some((row) => row.playerOpenid === openid)) {
      throw new Error('early cancel: system pigeon recorded')
    }
    pass('early cancel no pigeon')
    assertDelete('deleteActivity early', await callApi(miniProgram, 'deleteActivity', { activityId: earlyId }))
    activityIds.pop()

    // --- 主路径：临期取消记鸽子 ---
    const created = assertOk('createActivity', await callApi(miniProgram, 'createActivity', {
      title: '冒烟 ' + new Date().toISOString(),
      location: '冒烟球场',
      startTime: Date.now() + 10 * 60 * 1000,
      quotas: { team_jiong: 12, team_pudong: 12 }
    }))
    activityId = track(activityIds, created.activityId)

    assertOk('signup', await callApi(miniProgram, 'signup', { activityId }))
    assertFail('signup duplicate', await callApi(miniProgram, 'signup', { activityId }))

    const homeSigned = assertOk('homeSummary signedUp true', await callApi(miniProgram, 'homeSummary'))
    if (!(homeSigned.nextActivity && homeSigned.nextActivity._id === activityId)) {
      throw new Error('homeSummary: smoke activity not nextActivity')
    }
    if (homeSigned.nextActivity.signedUp !== true) {
      throw new Error('homeSummary: nextActivity.signedUp not true after signup')
    }
    if (homeSigned.nextActivity.signedTeamId !== user.teamId) {
      throw new Error('homeSummary: signedTeamId mismatch after signup')
    }
    pass('homeSummary signedUp true')

    const detail = assertOk('activityDetail', await callApi(miniProgram, 'activityDetail', { activityId }))
    if (detail.signups.length !== 1) throw new Error('activityDetail: expected 1 signup')
    if (!detail.signups.every((item) => typeof item.isAdmin === 'boolean')) {
      throw new Error('activityDetail: signup missing isAdmin')
    }
    const templates = detail.subscribeTemplates || {}
    if (!templates.remind || !templates.promote) {
      throw new Error('activityDetail: subscribeTemplates remind/promote missing')
    }
    pass('subscribeTemplates configured')
    pass('one signup')

    const round = assertOk('saveRound', await callApi(miniProgram, 'saveRound', {
      activityId,
      scoreJiong: 2,
      scorePudong: 1
    }))
    if (!round.roundId) throw new Error('saveRound: missing roundId')
    assertOk('saveRound update', await callApi(miniProgram, 'saveRound', {
      activityId,
      roundId: round.roundId,
      scoreJiong: 3,
      scorePudong: 3
    }))
    const afterRoundUpdate = assertOk('activityDetail after saveRound update', await callApi(
      miniProgram,
      'activityDetail',
      { activityId }
    ))
    const updatedRound = (afterRoundUpdate.rounds || []).find((item) => item._id === round.roundId)
    if (!updatedRound || updatedRound.scoreJiong !== 3 || updatedRound.scorePudong !== 3) {
      throw new Error('saveRound update: scores not updated')
    }
    pass('saveRound updated')
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
    const contrib = assertOk('setContribution', await callApi(miniProgram, 'setContribution', {
      activityId,
      playerOpenid: openid,
      goals: 1,
      assists: 1
    }))
    if (!contrib.contributionId) throw new Error('setContribution: missing contributionId')
    assertOk('deleteContribution', await callApi(miniProgram, 'deleteContribution', {
      contributionId: contrib.contributionId
    }))
    const afterDeleteContrib = assertOk('activityDetail after deleteContribution', await callApi(
      miniProgram,
      'activityDetail',
      { activityId }
    ))
    if ((afterDeleteContrib.contributions || []).some((item) => item._id === contrib.contributionId)) {
      throw new Error('deleteContribution: contribution still present')
    }
    pass('contribution removed')
    assertOk('setContribution again', await callApi(miniProgram, 'setContribution', {
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
    const clearedAbsent = assertOk('setAbsent clear', await callApi(miniProgram, 'setAbsent', {
      activityId,
      playerOpenid: openid,
      absent: false
    }))
    if (clearedAbsent.absent) throw new Error('setAbsent clear: expected absent false')
    const absentAgain = assertOk('setAbsent again', await callApi(miniProgram, 'setAbsent', {
      activityId,
      playerOpenid: openid,
      absent: true
    }))
    if (!absentAgain.absent) throw new Error('setAbsent again: expected absent true')

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
    if (!Array.isArray(home.goalsTop)
      || !Array.isArray(home.assistsTop)
      || !Array.isArray(home.attendancesTop)
      || !Array.isArray(home.absencesTop)) {
      throw new Error('homeSummary: missing top lists')
    }
    pass('homeSummary shape')

    // Weather is fetched on the client (cloud function timeout is stuck at 3s).
    const weatherPage = await miniProgram.reLaunch('/pages/home/home')
    let weatherData = null
    for (let i = 0; i < 25; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 800))
      weatherData = await weatherPage.data()
      if (weatherData && weatherData.weather && Array.isArray(weatherData.weather.hours)
        && weatherData.weather.hours.length >= 2) {
        break
      }
    }
    if (!(weatherData && weatherData.weather && Array.isArray(weatherData.weather.hours)
      && weatherData.weather.hours.length >= 2)) {
      throw new Error('home weather: hours missing after load')
    }
    if (!weatherData.weather.hours.some((row) => row.hour === 20)) {
      throw new Error('home weather: missing 20:00 point')
    }
    pass('home weather shape')
    assertFail('activityWeather missing time', await callApi(miniProgram, 'activityWeather', {
      startTime: 0
    }))

    for (const span of ['6m', '1y']) {
      const spanned = assertOk('homeSummary span ' + span, await callApi(miniProgram, 'homeSummary', { span }))
      if (!Array.isArray(spanned.goalsTop) || !Array.isArray(spanned.absencesTop)) {
        throw new Error('homeSummary span ' + span + ': missing top lists')
      }
    }

    const homeTeam = assertOk('homeSummary team filter', await callApi(miniProgram, 'homeSummary', {
      span: '3m',
      teamId: user.teamId
    }))
    if (homeTeam.teamId !== user.teamId) throw new Error('homeSummary: teamId not echoed')
    if (!(homeTeam.goalsTop || []).every((row) => !row.teamId || row.teamId === user.teamId)) {
      throw new Error('homeSummary: goalsTop not filtered by team')
    }
    if (!(homeTeam.attendancesTop || []).every((row) => !row.teamId || row.teamId === user.teamId)) {
      throw new Error('homeSummary: attendancesTop not filtered by team')
    }
    pass('homeSummary team filter')

    const beforeCancel = assertOk('activityDetail before late cancel', await callApi(miniProgram, 'activityDetail', { activityId }))
    if (!beforeCancel.cancelWillPigeon) throw new Error('activityDetail: cancel within 4 hours should record pigeon')
    const absencesBefore = ((assertOk('homeSummary before pigeon', await callApi(miniProgram, 'homeSummary'))).absencesTop || [])
      .find((row) => row.playerOpenid === openid)
    const absenceCount = absencesBefore ? absencesBefore.absences : 0
    assertOk('cancelSignup', await callApi(miniProgram, 'cancelSignup', { activityId }))
    const afterPigeon = assertOk('activityDetail pigeons', await callApi(miniProgram, 'activityDetail', { activityId }))
    if (!(afterPigeon.pigeons || []).some((row) => row.playerOpenid === openid && row.absentBy === 'system')) {
      throw new Error('activityDetail: late cancel missing system pigeon')
    }
    const absencesAfter = ((assertOk('homeSummary pigeon not started', await callApi(miniProgram, 'homeSummary'))).absencesTop || [])
      .find((row) => row.playerOpenid === openid)
    if ((absencesAfter ? absencesAfter.absences : 0) !== absenceCount) {
      throw new Error('homeSummary: pigeon counted before kickoff')
    }
    pass('late cancel pigeon hidden until kickoff')
    assertFail('setAbsent system pigeon locked', await callApi(miniProgram, 'setAbsent', {
      activityId,
      playerOpenid: openid,
      absent: false
    }))
    assertFail('cancelSignup again', await callApi(miniProgram, 'cancelSignup', { activityId }))

    const homeUnsigned = assertOk('homeSummary signedUp false', await callApi(miniProgram, 'homeSummary'))
    if (homeUnsigned.nextActivity && homeUnsigned.nextActivity._id === activityId
      && homeUnsigned.nextActivity.signedUp !== false) {
      throw new Error('homeSummary: nextActivity.signedUp not false after cancel')
    }
    pass('homeSummary signedUp false')

    assertFail('signup invalid team', await callApi(miniProgram, 'signup', {
      activityId,
      teamId: 'team_ghost'
    }))
    assertOk('signup other team', await callApi(miniProgram, 'signup', {
      activityId,
      teamId: otherTeamId
    }))
    const meAfterOther = assertOk('me after other-team signup', await callApi(miniProgram, 'me'))
    if (meAfterOther.user.teamId !== user.teamId) {
      throw new Error('signup other team: users.teamId changed')
    }
    const otherDetail = assertOk('activityDetail other-team signup', await callApi(miniProgram, 'activityDetail', {
      activityId
    }))
    const otherSignup = (otherDetail.signups || []).find((item) => item._openid === openid)
    if (!otherSignup || otherSignup.teamId !== otherTeamId) {
      throw new Error('signup other team: signup.teamId mismatch')
    }
    if ((otherDetail.pigeons || []).some((row) => row.playerOpenid === openid)) {
      throw new Error('signup other team: system pigeon not cleared after re-entering signed')
    }
    pass('re-signup cleared system pigeon')
    const homeOther = assertOk('homeSummary signedTeamId other', await callApi(miniProgram, 'homeSummary'))
    if (!(homeOther.nextActivity && homeOther.nextActivity.signedTeamId === otherTeamId)) {
      throw new Error('homeSummary: signedTeamId not other team after cross signup')
    }
    pass('other-team signup kept profile team')

    assertOk('saveProfile keep signup team', await callApi(miniProgram, 'saveProfile', {
      name: user.name,
      teamId: user.teamId
    }))
    const afterProfile = assertOk('activityDetail after saveProfile', await callApi(miniProgram, 'activityDetail', {
      activityId
    }))
    const keptSignup = (afterProfile.signups || []).find((item) => item._openid === openid)
    if (!keptSignup || keptSignup.teamId !== otherTeamId) {
      throw new Error('saveProfile: overwrote signup.teamId')
    }
    pass('saveProfile keeps signup team')

    // 正选可改任意队战术板：当前报在 otherTeam，仍可保存主队板
    const tooManySlots = []
    for (let i = 0; i < 9; i += 1) {
      tooManySlots.push({ userId: 'smoke_slot_' + i, x: 0.5, y: 0.5, role: 'mf' })
    }
    assertFail('saveTacticsBoard too many', await callApi(miniProgram, 'saveTacticsBoard', {
      scope: 'activity',
      activityId,
      teamId: user.teamId,
      slots: tooManySlots
    }))
    assertOk('saveTacticsBoard activity', await callApi(miniProgram, 'saveTacticsBoard', {
      scope: 'activity',
      activityId,
      teamId: user.teamId,
      slots: [{ userId: user._id, x: 0.5, y: 0.87, role: 'gk' }]
    }))
    const detailWithBoard = assertOk('activityDetail with activityBoards', await callApi(miniProgram, 'activityDetail', {
      activityId
    }))
    if (!detailWithBoard.activityBoards || !detailWithBoard.activityBoards[user.teamId]) {
      throw new Error('activityDetail: missing saved activityBoard')
    }
    pass('activity tactics board saved')

    assertOk('cancelSignup after other team', await callApi(miniProgram, 'cancelSignup', { activityId }))

    assertFail('saveTacticsBoard unsigned', await callApi(miniProgram, 'saveTacticsBoard', {
      scope: 'activity',
      activityId,
      teamId: user.teamId,
      slots: [{ userId: user._id, x: 0.5, y: 0.87, role: 'gk' }]
    }))

    const updatedPlayer = assertOk('adminUpdatePlayer', await callApi(miniProgram, 'adminUpdatePlayer', {
      userId: user._id,
      name: user.name,
      preferredPosition: 'fw'
    }))
    if (!updatedPlayer.user || updatedPlayer.user.preferredPosition !== 'fw') {
      throw new Error('adminUpdatePlayer: preferredPosition not updated')
    }
    pass('adminUpdatePlayer position')

    let found = false
    let page = 1
    let hasMore = true
    while (!found && hasMore && page <= 20) {
      const list = assertOk('listActivities', await callApi(miniProgram, 'listActivities', { page }))
      if ((list.activities || []).length > 10) throw new Error('listActivities: page longer than 10')
      found = (list.activities || []).some((item) => item._id === activityId)
      hasMore = !!list.hasMore
      page += 1
    }
    if (!found) throw new Error('listActivities: new activity missing')
    pass('activity listed')

    assertDelete('deleteActivity', await callApi(miniProgram, 'deleteActivity', { activityId }))
    activityIds.pop()
    assertFail('activityDetail after delete', await callApi(miniProgram, 'activityDetail', { activityId }))
    activityId = ''

    console.log('ALL CHECKS PASSED')
  } finally {
    await cleanupActivities(miniProgram, activityIds)
    miniProgram.disconnect()
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err)
  process.exit(1)
})
