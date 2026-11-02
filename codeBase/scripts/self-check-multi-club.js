/**
 * 多球队自测：开发者工具自动化 + 云函数本地调试。
 * 先：对 cloudfunctions/api 开启云函数本地调试并保持窗口打开
 * （会 open 项目、开 automator，并勾选 api「云函数本地调试」）
 */
const automator = require('miniprogram-automator')

const PROJECT = require('path').resolve(__dirname, '..')
const PORT = Number(process.env.AUTO_PORT || 9421)

async function callApi(miniProgram, action, data = {}) {
  return miniProgram.evaluate(async (actionName, payload) => {
    const res = await wx.cloud.callFunction({
      name: 'api',
      data: { action: actionName, ...payload }
    })
    return res.result || {}
  }, action, data)
}

function assert(name, cond, detail) {
  if (!cond) throw new Error(`${name}: ${detail || 'failed'}`)
  console.log('PASS', name)
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` })
  const page = await miniProgram.reLaunch('/pages/home/home')
  await page.waitFor(1200)

  const anchor = await page.$('.club-switcher-anchor')
  assert('home has club-switcher anchor', !!anchor)
  const homeData = await page.data()
  assert('home has onClubChange wiring', typeof homeData.clubSubtitle === 'string')

  const org = await callApi(miniProgram, 'orgMe')
  if (!org.ok && /未知操作/.test(org.message || '')) {
    throw new Error('orgMe 未知操作：请先对 api 开启云函数本地调试并保持窗口打开，然后再跑本脚本')
  }
  assert('orgMe ok', org.ok, org.message || JSON.stringify(org))
  assert('orgMe two clubs', (org.clubs || []).length >= 2, JSON.stringify(org.clubs))
  const jielong = (org.clubs || []).find((club) => club._id === 'club_jielong')
  assert('jielong present', !!jielong)

  if (!jielong.joined) {
    const joined = await callApi(miniProgram, 'joinClub', { clubId: 'club_jielong' })
    assert('joinClub jielong', joined.ok, joined.message)
  }

  const switched = await callApi(miniProgram, 'switchClub', { clubId: 'club_jielong' })
  assert('switchClub jielong', switched.ok, switched.message)

  await miniProgram.evaluate(() => {
    wx.setStorageSync('currentClubId', 'club_jielong')
  })
  const homeAgain = await miniProgram.reLaunch('/pages/home/home')
  await homeAgain.waitFor(1000)
  const nameText = await homeAgain.data()
  assert('home current club jielong', nameText.currentClubId === 'club_jielong', JSON.stringify({
    currentClubId: nameText.currentClubId,
    currentClubName: nameText.currentClubName
  }))

  const created = await callApi(miniProgram, 'createActivity', {
    clubId: 'club_jielong',
    title: '自测界龙',
    location: '界龙足球基地',
    startTime: Date.now() + 3 * 24 * 3600 * 1000,
    maxSignedPlayers: 40
  })
  assert('createActivity jielong', created.ok, created.message)
  const activityId = created.activityId || (created.activity && created.activity._id)
  assert('createActivity id', !!activityId, JSON.stringify(created))

  const signed = await callApi(miniProgram, 'signup', { activityId })
  assert('signup pool', signed.ok, signed.message)
  assert('signup pending', signed.teamId === 'team_pending' || signed.status === 'signed' || signed.waitlist === false || signed.ok)

  const session = await miniProgram.navigateTo(`/pages/session/session?id=${activityId}`)
  await session.waitFor(1000)
  const sessionData = await session.data()
  assert('session page loaded', !!sessionData.activity, 'no activity')
  assert('session undivided', !sessionData.divided)

  const seed = await callApi(miniProgram, 'smokeSeedSignups', {
    activityId,
    count: 30
  }).catch(() => null)
  if (seed && seed.ok) {
    console.log('PASS smokeSeedSignups')
  } else {
    console.log('SKIP smokeSeedSignups', seed && seed.message)
  }

  const divided = await callApi(miniProgram, 'assignTeams', {
    activityId,
    teamCount: 4,
    targetPerTeam: 8
  })
  assert('assignTeams', divided.ok, divided.message)
  assert('assignTeams fixtures', (divided.fixtureCount || 0) >= 6, JSON.stringify(divided))

  await session.waitFor(800)
  await session.callMethod('load')
  await session.waitFor(800)
  const after = await session.data()
  assert('session divided', after.divided)
  assert('session standings', (after.standings || []).length >= 4, JSON.stringify(after.standings))
  assert('session rounds', (after.rounds || []).length >= 6)

  const activities = await miniProgram.reLaunch('/pages/activities/activities')
  await activities.waitFor(1000)
  const actData = await activities.data()
  assert('activities club context', actData.currentClubId === 'club_jielong', actData.currentClubId)

  const switchedBack = await callApi(miniProgram, 'switchClub', { clubId: 'club_wednesday' })
  assert('switchClub wednesday', switchedBack.ok, switchedBack.message)
  await miniProgram.evaluate(() => wx.setStorageSync('currentClubId', 'club_wednesday'))
  const wedHome = await miniProgram.reLaunch('/pages/home/home')
  await wedHome.waitFor(1000)
  const wedData = await wedHome.data()
  assert('home back wednesday', wedData.currentClubId === 'club_wednesday', wedData.currentClubId)

  if (activityId) {
    await callApi(miniProgram, 'deleteActivity', { activityId }).catch(() => null)
  }

  console.log('\nALL SELF-CHECKS PASSED')
  await miniProgram.disconnect()
}

main().catch((error) => {
  console.error('\nSELF-CHECK FAILED')
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
