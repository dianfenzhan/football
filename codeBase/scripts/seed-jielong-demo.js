/**
 * 界龙散客局演示造数（保留活动，不删）。
 * 需要微信开发者工具自动化端口 ws://127.0.0.1:9421，当前登录账号须为界龙管理员。
 *
 * 生成：
 * 1) 冒烟界龙-演示4队        — 32 人自动入 4 队
 * 2) 冒烟界龙-演示5队        — 40 人自动入 5 队
 * 3) 冒烟界龙-演示4队未选10  — 先满 4 队，管理员改组后，再来 10 人进未选队伍
 */
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

async function callApi(miniProgram, action, data = {}) {
  return miniProgram.evaluate(
    async (actionName, payload) => {
      const res = await wx.cloud.callFunction({
        name: 'api',
        data: { action: actionName, ...payload }
      })
      return res.result
    },
    action,
    data
  )
}

function assertOk(name, result) {
  if (!result || !result.ok) {
    throw new Error(name + ': ' + ((result && result.message) || 'no result'))
  }
  console.log('OK', name, summarize(result))
  return result
}

function summarize(result) {
  const bits = []
  if (result.activityId) bits.push('id=' + result.activityId)
  if (result.count != null) bits.push('seed=' + result.count)
  if (result.teamCount != null) bits.push('teams=' + result.teamCount)
  if (result.teamId) bits.push('team=' + result.teamId)
  return bits.join(' ')
}

async function seedSigned(miniProgram, activityId, total) {
  let left = total
  while (left > 0) {
    const n = Math.min(left, 30)
    assertOk('smokeSeedSignups x' + n, await callApi(miniProgram, 'smokeSeedSignups', {
      activityId,
      teamId: 'auto',
      status: 'signed',
      count: n
    }))
    left -= n
  }
}

async function createJielong(miniProgram, title, startOffsetDays) {
  const created = assertOk('createActivity ' + title, await callApi(miniProgram, 'createActivity', {
    clubId: 'club_jielong',
    title,
    location: '界龙足球基地（界绿路 88 号）',
    startTime: Date.now() + startOffsetDays * DAY_MS + 2 * HOUR_MS
  }))
  return created.activityId
}

async function detailSummary(miniProgram, activityId, label) {
  const detail = assertOk('activityDetail ' + label, await callApi(miniProgram, 'activityDetail', {
    activityId
  }))
  const teams = (detail.activity && detail.activity.teams) || []
  const signups = (detail.signups || []).filter((row) => row.status === 'signed')
  const pending = signups.filter((row) => row.teamId === 'team_pending')
  const byTeam = {}
  teams.forEach((team) => { byTeam[team.id] = 0 })
  signups.forEach((row) => {
    if (row.teamId === 'team_pending') return
    byTeam[row.teamId] = (byTeam[row.teamId] || 0) + 1
  })
  console.log('---', label, '---')
  console.log('activityId:', activityId)
  console.log('title:', detail.activity && detail.activity.title)
  console.log('teamCount:', teams.length, 'manualRoster:', !!(detail.activity && detail.activity.manualRoster))
  console.log('signed:', signups.length, 'pending:', pending.length)
  console.log('perTeam:', teams.map((t) => `${t.name}:${byTeam[t.id] || 0}`).join(' / '))
  console.log('fixtures:', (detail.rounds || []).length)
  return detail
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: WS })
  try {
    const me = assertOk('me', await callApi(miniProgram, 'me'))
    if (!me.user || !me.user.isAdmin) {
      throw new Error('当前账号不是管理员，无法造数')
    }

    // 1) 4 队：32 人（本人 1 + 假人 31）
    const id4 = await createJielong(miniProgram, '冒烟界龙-演示4队', 3)
    assertOk('signup 4', await callApi(miniProgram, 'signup', { activityId: id4 }))
    await seedSigned(miniProgram, id4, 31)
    await detailSummary(miniProgram, id4, '4队')

    // 2) 5 队：40 人（本人 1 + 假人 39）
    const id5 = await createJielong(miniProgram, '冒烟界龙-演示5队', 4)
    assertOk('signup 5', await callApi(miniProgram, 'signup', { activityId: id5 }))
    await seedSigned(miniProgram, id5, 39)
    await detailSummary(miniProgram, id5, '5队')

    // 3) 4 队满员后管理员改组，再来 10 人进未选
    const idPending = await createJielong(miniProgram, '冒烟界龙-演示4队未选10', 5)
    assertOk('signup pending-base', await callApi(miniProgram, 'signup', { activityId: idPending }))
    // 先灌 31 假人 → 共 32，满 4 队
    await seedSigned(miniProgram, idPending, 31)
    const before = await detailSummary(miniProgram, idPending, '4队满员(改组前)')
    const signed = (before.signups || []).filter((row) => row.status === 'signed' && row.teamId !== 'team_pending')
    const mover = signed.find((row) => String(row._openid || '').startsWith('smoke_fake_'))
    if (!mover) throw new Error('找不到可挪动的假人')
    const teams = (before.activity && before.activity.teams) || []
    const fromId = mover.teamId
    const toId = (teams.find((team) => team.id !== fromId) || teams[0] || {}).id
    if (!toId) throw new Error('没有目标队可挪')
    assertOk('adminMoveSignup trigger manualRoster', await callApi(miniProgram, 'adminMoveSignup', {
      activityId: idPending,
      targetOpenid: mover._openid,
      teamId: toId
    }))
    await seedSigned(miniProgram, idPending, 10)
    await detailSummary(miniProgram, idPending, '4队+未选10')

    console.log('\nDONE 三场活动已保留，可在小程序界龙列表查看：')
    console.log('1', id4, '冒烟界龙-演示4队')
    console.log('2', id5, '冒烟界龙-演示5队')
    console.log('3', idPending, '冒烟界龙-演示4队未选10')
  } finally {
    miniProgram.disconnect()
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err)
  process.exit(1)
})
