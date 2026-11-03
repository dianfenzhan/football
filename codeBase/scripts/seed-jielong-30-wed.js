/**
 * 切回主管理员，造一场界龙「默认自动入队」活动，共 30 人（本人 + 29）。
 * 假人昵称/头像从周三联球员里复制（可循环），看起来不像冒烟假人。
 *
 * 用法：node scripts/seed-jielong-30-wed.js
 * 需开发者工具自动化端口 9421；云函数 api 需已含 smokeSeedSignups.namePool。
 */
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const DAY_MS = 24 * 60 * 60 * 1000

async function call(mp, action, data = {}) {
  return mp.evaluate(async (actionName, payload) => {
    const res = await wx.cloud.callFunction({
      name: 'api',
      data: { action: actionName, ...payload }
    })
    return res.result || {}
  }, action, data)
}

function assertOk(name, result) {
  if (!result || !result.ok) {
    throw new Error(name + ': ' + ((result && result.message) || 'no result'))
  }
  return result
}

function wednesdayPool(users, selfOpenid) {
  return (users || [])
    .filter((u) => {
      if (!u || !String(u.name || '').trim()) return false
      if (selfOpenid && u._openid === selfOpenid) return false
      const joined = u.clubJoined && u.clubJoined.club_wednesday
      const mem = (u.memberships || []).some((m) => m && m.clubId === 'club_wednesday')
      return !!(joined || mem || u.teamId)
    })
    .map((u) => ({
      name: String(u.name).trim(),
      avatarUrl: typeof u.avatarUrl === 'string' ? u.avatarUrl : ''
    }))
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: WS })
  try {
    assertOk('restore owner', await call(mp, 'smokeSetCallerRole', { role: 'owner' }))
    const me = assertOk('me', await call(mp, 'me'))
    const selfOpenid = me.user && me.user._openid
    const players = assertOk('listPlayers', await call(mp, 'listPlayers'))
    let pool = wednesdayPool(players.users, selfOpenid)
    if (pool.length < 5) {
      // 兜底：不限球队，只要有名字
      pool = (players.users || [])
        .filter((u) => u && String(u.name || '').trim() && u._openid !== selfOpenid)
        .map((u) => ({ name: String(u.name).trim(), avatarUrl: u.avatarUrl || '' }))
    }
    if (!pool.length) throw new Error('周三联没有可复制的球员名字')

    const title = '冒烟界龙-30人周三联脸 ' + Date.now().toString(36).slice(-4)
    const created = assertOk('createActivity', await call(mp, 'createActivity', {
      clubId: 'club_jielong',
      title,
      location: '界龙足球基地',
      startTime: Date.now() + 2 * DAY_MS + 2 * 60 * 60 * 1000
    }))
    const activityId = created.activityId
    assertOk('signup self', await call(mp, 'signup', { activityId }))
    assertOk('smokeSeedSignups', await call(mp, 'smokeSeedSignups', {
      activityId,
      teamId: 'auto',
      status: 'signed',
      count: 29,
      namePool: pool
    }))

    const detail = assertOk('activityDetail', await call(mp, 'activityDetail', { activityId }))
    const signed = (detail.signups || []).filter((s) => s.status === 'signed')
    const teams = (detail.activity && detail.activity.teams) || []
    const byTeam = teams.map((t) => {
      const n = signed.filter((s) => s.teamId === t.id).length
      return `${t.name}:${n}`
    }).join(' / ')
    const sample = signed.slice(0, 8).map((s) => s.userName).join('、')

    console.log('OK owner restored')
    console.log('activityId', activityId)
    console.log('title', title)
    console.log('signed', signed.length, 'manualRoster', !!(detail.activity && detail.activity.manualRoster))
    console.log('teams', byTeam || '(none yet)')
    console.log('namePool', pool.length, 'sample', sample)
    console.log('wed names used from', pool.slice(0, 6).map((p) => p.name).join('、'))

    await mp.reLaunch(`/pages/session/session?id=${activityId}`)
    console.log('opened session page')
  } finally {
    await mp.disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
