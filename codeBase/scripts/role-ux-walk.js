/**
 * 三角色 UX 走查（仅测试云环境 + 开发者工具 automator）。
 * 用 smokeSetCallerRole 在同一微信号上切换 owner/admin/member/fresh。
 * 结束时务必恢复 owner。
 */
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const findings = []
const activityIds = []

function note(role, name, ok, detail) {
  const row = { role, name, ok: !!ok, detail: detail || '' }
  findings.push(row)
  console.log(ok ? 'PASS' : 'FAIL', `[${role}]`, name, detail || '')
  return ok
}

async function call(mp, action, data = {}) {
  return mp.evaluate(async (actionName, payload) => {
    const res = await wx.cloud.callFunction({
      name: 'api',
      data: { action: actionName, ...payload }
    })
    return res.result || {}
  }, action, data)
}

async function setRole(mp, role, clubs) {
  const payload = { role }
  if (clubs) payload.clubs = clubs
  const res = await call(mp, 'smokeSetCallerRole', payload)
  if (!res.ok) throw new Error('smokeSetCallerRole ' + role + ': ' + (res.message || 'fail'))
  return res
}

async function cleanup(mp) {
  for (let i = activityIds.length - 1; i >= 0; i -= 1) {
    await call(mp, 'cancelSignup', { activityId: activityIds[i] }).catch(() => {})
    await call(mp, 'deleteActivity', { activityId: activityIds[i] }).catch(() => {})
  }
  activityIds.length = 0
}

async function walkAdmin(mp) {
  const role = 'admin'
  await setRole(mp, 'admin')
  const me = await call(mp, 'me')
  note(role, 'identity', me.ok && me.user && me.user.isAdmin && !me.user.canGrantAdmin, JSON.stringify({
    isAdmin: me.user && me.user.isAdmin,
    canGrantAdmin: me.user && me.user.canGrantAdmin
  }))

  const members = await call(mp, 'listMembers')
  note(role, 'listMembers denied', !members.ok, members.message || '')

  const home = await mp.reLaunch('/pages/home/home')
  await home.waitFor(3000)
  let d = await home.data()
  const createLink = await home.$('.admin-create')
  const createBtn = await home.$('button.btn.hero-cta')
  note(role, 'home no create', !createLink && !createBtn, 'create only on activities FAB')

  const acts = await mp.reLaunch('/pages/activities/activities')
  await acts.waitFor(3500)
  d = await acts.data()
  note(role, 'activities FAB', !!d.isAdmin, '')
  note(role, 'activities no delete', !d.canDelete, `canDelete=${d.canDelete}`)

  const wed = await call(mp, 'createActivity', {
    title: '冒烟普管周三联 ' + Date.now().toString(36).slice(-4),
    location: '体验球场',
    startTime: Date.now() + 9 * 24 * 3600 * 1000,
    quotas: { team_jiong: 11, team_pudong: 11 }
  })
  note(role, 'create wednesday', !!wed.ok, wed.message || wed.activityId || '')
  if (wed.activityId) activityIds.push(wed.activityId)

  const del = await call(mp, 'deleteActivity', { activityId: wed.activityId })
  note(role, 'delete wednesday denied', !del.ok, del.message || '')

  const jl = await call(mp, 'createActivity', {
    clubId: 'club_jielong',
    title: '冒烟普管界龙 ' + Date.now().toString(36).slice(-4),
    location: '界龙足球基地',
    startTime: Date.now() + 10 * 24 * 3600 * 1000
  })
  note(role, 'create jielong', !!jl.ok, jl.message || jl.activityId || '')
  if (jl.activityId) activityIds.push(jl.activityId)

  if (jl.activityId) {
    await call(mp, 'signup', { activityId: jl.activityId })
    const assign = await call(mp, 'assignTeams', { activityId: jl.activityId })
    note(role, 'jielong assignTeams', !!assign.ok, assign.message || `teams=${assign.teamCount}`)
    const sess = await mp.reLaunch(`/pages/session/session?id=${jl.activityId}`)
    await sess.waitFor(2500)
    d = await sess.data()
    note(role, 'session admin chrome', !!d.isAdmin, '')
    note(role, 'session assign/edit visible', !!d.isAdmin && !d.locked, '')
  }

  if (wed.activityId) {
    const page = await mp.reLaunch(`/pages/activity/activity?id=${wed.activityId}`)
    await page.waitFor(2500)
    d = await page.data()
    note(role, 'activity admin quota tip', !!(d.me && d.me.isAdmin), '')
    await mp.evaluate(() => {
      const p = getCurrentPages().pop()
      if (p.signup) p.signup()
    })
    await page.waitFor(400)
    await mp.evaluate(() => {
      const p = getCurrentPages().pop()
      if (p.confirmPledge) p.confirmPledge()
    })
    for (let i = 0; i < 20; i += 1) {
      await page.waitFor(400)
      d = await page.data()
      if (d.signed) break
    }
    note(role, 'wednesday signup', !!d.signed, d.signedTeamName || '')
  }

  await mp.evaluate(() => wx.setStorageSync('viewClubFilter', 'club_wednesday'))
  const players = await mp.reLaunch('/pages/players/players')
  await players.waitFor(3500)
  d = await players.data()
  note(role, 'players can edit', !!d.canEditPlayers, '')
  note(role, 'players can grant', !!d.canGrantThisClub, 'club admin may grant')
  const firstPlayer = (d.players || [])[0]
  note(role, 'players currentClubStats visible', !!(firstPlayer && firstPlayer.currentClubStats), JSON.stringify(firstPlayer && firstPlayer.currentClubStats))
  if (firstPlayer) {
    await mp.evaluate((pid) => {
      const p = getCurrentPages().pop()
      if (p.onTapPlayer) p.onTapPlayer({ currentTarget: { dataset: { id: pid } } })
    }, firstPlayer._id)
    await players.waitFor(500)
    d = await players.data()
    note(role, 'players modal stats', !!(d.showEditModal && d.editPlayerStats && typeof d.editPlayerStats.activities === 'number'), JSON.stringify(d.editPlayerStats))
    await mp.evaluate(() => {
      const p = getCurrentPages().pop()
      if (p.closeEditModal) p.closeEditModal()
    })
  }

  const mePage = await mp.reLaunch('/pages/me/me')
  await mePage.waitFor(2500)
  d = await mePage.data()
  note(role, 'me myStats visible', !!(d.myStats && typeof d.myStats.activities === 'number'), JSON.stringify(d.myStats))
}

async function walkMember(mp) {
  const role = 'member'
  await setRole(mp, 'member')
  const me = await call(mp, 'me')
  note(role, 'identity', me.ok && me.user && !me.user.isAdmin && !me.user.canGrantAdmin, JSON.stringify({
    isAdmin: me.user && me.user.isAdmin,
    canGrantAdmin: me.user && me.user.canGrantAdmin
  }))

  const home = await mp.reLaunch('/pages/home/home')
  await home.waitFor(3000)
  let d = await home.data()
  const createLink = await home.$('.admin-create')
  note(role, 'home no create', !createLink, '')

  const acts = await mp.reLaunch('/pages/activities/activities')
  await acts.waitFor(3500)
  d = await acts.data()
  note(role, 'activities no FAB', !d.isAdmin, '')
  note(role, 'activities no delete', !d.canDelete, '')

  const createDenied = await call(mp, 'createActivity', {
    title: '冒烟成员不应创建',
    location: 'x',
    startTime: Date.now() + 8 * 24 * 3600 * 1000,
    quotas: { team_jiong: 11, team_pudong: 11 }
  })
  note(role, 'create wednesday denied', !createDenied.ok, createDenied.message || '')

  // reuse last wed/jl activities if still present; else create as owner briefly
  let wedId = activityIds.find(Boolean)
  if (!wedId) {
    await setRole(mp, 'owner')
    const wed = await call(mp, 'createActivity', {
      title: '冒烟成员周三联 ' + Date.now().toString(36).slice(-4),
      location: '体验球场',
      startTime: Date.now() + 11 * 24 * 3600 * 1000,
      quotas: { team_jiong: 11, team_pudong: 11 }
    })
    wedId = wed.activityId
    if (wedId) activityIds.push(wedId)
    await setRole(mp, 'member')
  }

  if (wedId) {
    const page = await mp.reLaunch(`/pages/activity/activity?id=${wedId}`)
    await page.waitFor(2500)
    d = await page.data()
    note(role, 'activity no admin tip', !(d.me && d.me.isAdmin), '')
    if (!d.signed) {
      await mp.evaluate(() => {
        const p = getCurrentPages().pop()
        if (p.signup) p.signup()
      })
      await page.waitFor(400)
      await mp.evaluate(() => {
        const p = getCurrentPages().pop()
        if (p.confirmPledge) p.confirmPledge()
      })
      for (let i = 0; i < 20; i += 1) {
        await page.waitFor(400)
        d = await page.data()
        if (d.signed) break
      }
    }
    note(role, 'wednesday signup', !!d.signed, d.signedTeamName || '')
    const quota = await call(mp, 'updateQuota', { activityId: wedId, teamId: 'team_pudong', maxSignups: 14 })
    note(role, 'updateQuota denied', !quota.ok, quota.message || '')
  }

  let jlId = activityIds[activityIds.length - 1]
  const list = await call(mp, 'listActivities', { page: 1, clubId: 'club_jielong' })
  const jlHit = (list.activities || []).find((a) => /冒烟/.test(a.title || ''))
  if (jlHit) jlId = jlHit._id
  if (jlId) {
    const assign = await call(mp, 'assignTeams', { activityId: jlId })
    note(role, 'jielong assign denied', !assign.ok, assign.message || '')
    const sess = await mp.reLaunch(`/pages/session/session?id=${jlId}`)
    await sess.waitFor(2500)
    d = await sess.data()
    note(role, 'session not admin', !d.isAdmin, '')
    if (!d.signed) {
      await mp.evaluate(() => {
        const p = getCurrentPages().pop()
        if (p.onSignupTap) p.onSignupTap()
      })
      await sess.waitFor(2000)
      d = await sess.data()
    }
    note(role, 'jielong signup', !!d.signed, '')
  }

  await mp.evaluate(() => wx.setStorageSync('viewClubFilter', 'club_wednesday'))
  const players = await mp.reLaunch('/pages/players/players')
  await players.waitFor(3500)
  d = await players.data()
  const memberFirst = (d.players || [])[0]
  note(role, 'players cannot edit', !d.canEditPlayers, '')
  note(role, 'players clubStats hidden for member', !(memberFirst && memberFirst.currentClubStats), '')
  const rawList = await call(mp, 'listPlayers')
  const rawFirst = (rawList.users || [])[0]
  note(role, 'listPlayers no clubStats in API for member', !(rawFirst && rawFirst.clubStats), '')

  const mePage = await mp.reLaunch('/pages/me/me')
  await mePage.waitFor(2500)
  d = await mePage.data()
  note(role, 'me myStats visible for member', !!(d.myStats && typeof d.myStats.activities === 'number'), JSON.stringify(d.myStats))
}

async function walkCrossClub(mp) {
  // 只加入周三联 → 打开界龙活动应走入队/注册
  await setRole(mp, 'member', ['club_wednesday'])
  const role = 'wedOnly'
  const me = await call(mp, 'orgMe')
  const jl = (me.clubs || []).find((c) => c._id === 'club_jielong')
  note(role, 'jielong not joined', !(jl && jl.joined), JSON.stringify(jl && { joined: jl.joined, role: jl.role }))

  await setRole(mp, 'owner')
  const created = await call(mp, 'createActivity', {
    clubId: 'club_jielong',
    title: '冒烟跨队入界龙 ' + Date.now().toString(36).slice(-4),
    location: '界龙足球基地',
    startTime: Date.now() + 12 * 24 * 3600 * 1000
  })
  if (created.activityId) activityIds.push(created.activityId)
  await setRole(mp, 'member', ['club_wednesday'])

  if (created.activityId) {
    const sess = await mp.reLaunch(`/pages/session/session?id=${created.activityId}`)
    await sess.waitFor(2500)
    let d = await sess.data()
    note(role, 'jielong page needs join', !d.jielongJoined || !!d.showRegister || !d.signed, JSON.stringify({
      jielongJoined: d.jielongJoined,
      showRegister: d.showRegister,
      signed: d.signed
    }))
    // 点报名应弹注册/入队
    await mp.evaluate(() => {
      const p = getCurrentPages().pop()
      if (p.onSignupTap) p.onSignupTap()
    })
    await sess.waitFor(1000)
    d = await sess.data()
    note(role, 'signup opens register', !!d.showRegister || !!d.jielongJoined, `showRegister=${d.showRegister}`)
  }

  // fresh：无任何球队
  await setRole(mp, 'fresh')
  const fresh = 'fresh'
  const org = await call(mp, 'orgMe')
  const joined = (org.clubs || []).filter((c) => c.joined)
  note(fresh, 'no club joined', joined.length === 0, JSON.stringify(joined.map((c) => c._id)))
  const home = await mp.reLaunch('/pages/home/home')
  await home.waitFor(3000)
  const hd = await home.data()
  note(fresh, 'home noClub or empty', !!(hd.noClub || !hd.next), JSON.stringify({ noClub: hd.noClub, hasNext: !!hd.next }))
}

async function walkOwnerSmoke(mp) {
  const role = 'owner'
  await setRole(mp, 'owner')
  const me = await call(mp, 'me')
  note(role, 'identity restored', me.ok && me.user && me.user.canGrantAdmin, JSON.stringify({
    isAdmin: me.user && me.user.isAdmin,
    canGrantAdmin: me.user && me.user.canGrantAdmin
  }))
  const acts = await mp.reLaunch('/pages/activities/activities')
  await acts.waitFor(3500)
  const d = await acts.data()
  note(role, 'canDelete back', !!d.canDelete, '')

  await mp.evaluate(() => wx.setStorageSync('viewClubFilter', 'all'))
  const playersAll = await mp.reLaunch('/pages/players/players')
  await playersAll.waitFor(3500)
  const pdAll = await playersAll.data()
  const allFirst = (pdAll.players || [])[0]
  note(role, 'players filter=all read-only & stats hidden', !pdAll.canEditPlayers && !(allFirst && allFirst.currentClubStats), '')

  await mp.evaluate(() => wx.setStorageSync('viewClubFilter', 'club_jielong'))
  const playersJl = await mp.reLaunch('/pages/players/players')
  await playersJl.waitFor(3500)
  const pdJl = await playersJl.data()
  const jlFirst = (pdJl.players || [])[0]
  note(role, 'players filter=jielong stats visible for owner', !!pdJl.canEditPlayers && !!(jlFirst && jlFirst.currentClubStats), JSON.stringify(jlFirst && jlFirst.currentClubStats))

  const mePage = await mp.reLaunch('/pages/me/me')
  await mePage.waitFor(2500)
  const md = await mePage.data()
  note(role, 'me myStats visible for owner', !!(md.myStats && typeof md.myStats.activities === 'number'), JSON.stringify(md.myStats))
}

async function main() {
  console.log('connect', WS)
  const mp = await automator.connect({ wsEndpoint: WS })
  try {
    await setRole(mp, 'owner')
    await walkAdmin(mp)
    await walkMember(mp)
    await walkCrossClub(mp)
    await walkOwnerSmoke(mp)
  } catch (err) {
    console.error('WALK ERROR', err && err.message ? err.message : err)
    findings.push({ role: 'system', name: 'walk aborted', ok: false, detail: String(err && err.message || err) })
    try { await setRole(mp, 'owner') } catch (e) { console.error('restore failed', e) }
  } finally {
    try {
      await setRole(mp, 'owner')
      // owner can delete smoke activities
      const list = await call(mp, 'listActivities', { page: 1, clubId: 'all' })
      for (const a of (list.activities || [])) {
        if (/冒烟/.test(a.title || '') || /体验走查/.test(a.title || '')) {
          await call(mp, 'cancelSignup', { activityId: a._id }).catch(() => {})
          await call(mp, 'deleteActivity', { activityId: a._id }).catch(() => {})
        }
      }
      await cleanup(mp)
    } catch (e) {
      console.error('cleanup/restore', e)
    }
    await mp.disconnect()
  }

  const failed = findings.filter((f) => !f.ok)
  console.log('\nSUMMARY', { total: findings.length, failed: failed.length })
  console.log(JSON.stringify({ findings, failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
