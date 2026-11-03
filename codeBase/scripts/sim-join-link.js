/**
 * 模拟「第一次点活动分享链接」：切角色 + 直接打开带 id 的活动页。
 * 用法：node scripts/sim-join-link.js
 * 可选：JIELONG=1 打开界龙场次；WED=1 打开周三联活动；FRESH=1 完全未入队
 */
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const wantFresh = process.env.FRESH === '1' || process.argv.includes('--fresh')
const wantWed = process.env.WED === '1' || process.argv.includes('--wed')
const wantJl = !wantWed // 默认界龙（未入队点界龙链接最常见）

async function call(mp, action, data = {}) {
  return mp.evaluate(async (actionName, payload) => {
    const res = await wx.cloud.callFunction({
      name: 'api',
      data: { action: actionName, ...payload }
    })
    return res.result || {}
  }, action, data)
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: WS })
  try {
    if (wantFresh) {
      const set = await call(mp, 'smokeSetCallerRole', { role: 'fresh' })
      console.log('role=fresh', JSON.stringify(set.user || set))
    } else if (wantJl) {
      // 只在周三联：点界龙链接时应弹入队窗
      const set = await call(mp, 'smokeSetCallerRole', {
        role: 'member',
        clubs: ['club_wednesday']
      })
      console.log('role=member clubs=[wednesday]', JSON.stringify(set.user || set))
    } else {
      const set = await call(mp, 'smokeSetCallerRole', {
        role: 'member',
        clubs: ['club_jielong']
      })
      console.log('role=member clubs=[jielong]', JSON.stringify(set.user || set))
    }

    const clubId = wantJl ? 'club_jielong' : 'club_wednesday'
    let list = await call(mp, 'listActivities', { page: 1, clubId })
    let target = (list.activities || []).find((a) => a.startTime > Date.now())
      || (list.activities || [])[0]

    if (!target) {
      console.log('no activity, create one as owner then switch back')
      await call(mp, 'smokeSetCallerRole', { role: 'owner' })
      const payload = wantJl
        ? {
          clubId: 'club_jielong',
          title: '体验入队引导 ' + Date.now().toString(36).slice(-4),
          location: '界龙足球基地',
          startTime: Date.now() + 3 * 24 * 3600 * 1000
        }
        : {
          title: '体验入队引导 ' + Date.now().toString(36).slice(-4),
          location: '体验球场',
          startTime: Date.now() + 3 * 24 * 3600 * 1000,
          quotas: { team_jiong: 11, team_pudong: 11 }
        }
      const created = await call(mp, 'createActivity', payload)
      if (!created.ok || !created.activityId) {
        throw new Error('createActivity failed: ' + (created.message || JSON.stringify(created)))
      }
      target = { _id: created.activityId, title: payload.title, startTime: payload.startTime }
      if (wantFresh) {
        await call(mp, 'smokeSetCallerRole', { role: 'fresh' })
      } else if (wantJl) {
        await call(mp, 'smokeSetCallerRole', { role: 'member', clubs: ['club_wednesday'] })
      } else {
        await call(mp, 'smokeSetCallerRole', { role: 'member', clubs: ['club_jielong'] })
      }
    }

    const path = wantJl
      ? `/pages/session/session?id=${target._id}`
      : `/pages/activity/activity?id=${target._id}`

    // 等同微信里点开分享卡片
    const page = await mp.reLaunch(path)
    await page.waitFor(2500)
    const d = await page.data()
    console.log('opened', path)
    console.log('title', (d.activity && d.activity.title) || target.title || '')
    console.log('state', JSON.stringify({
      jielongJoined: d.jielongJoined,
      showRegister: d.showRegister,
      signed: d.signed,
      isAdmin: d.isAdmin,
      noClub: d.noClub
    }))
    console.log('\n现在可以在模拟器里点「报名」。测完恢复主管理员：')
    console.log('  node scripts/sim-join-link.js --restore')
  } finally {
    await mp.disconnect()
  }
}

async function restore() {
  const mp = await automator.connect({ wsEndpoint: WS })
  try {
    const set = await call(mp, 'smokeSetCallerRole', { role: 'owner' })
    console.log('restored owner', JSON.stringify(set.user || set))
    await mp.reLaunch('/pages/me/me')
  } finally {
    await mp.disconnect()
  }
}

if (process.argv.includes('--restore')) {
  restore().catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
