/**
 * 全量回归测试：四种身份（未注册 / 普通用户 / 管理员 / 授权人）× 全部云函数 action。
 * 每条断言带用例 ID，与 doc/test-cases.md 一一对应。
 *
 * 前置：
 *  - 微信开发者工具自动化端口（默认 ws://127.0.0.1:9421），登录授权人微信号
 *  - 云函数 api 已部署含 testSetup 的版本，且配置了环境变量 REGRESSION_KEY
 *  - doc/project/secrets.local.json 里配置了相同的 regressionKey
 *
 * 跑前把自己的 users 记录快照到 scripts/.regression-snapshot.json，结束时恢复；
 * 脚本被 kill 导致身份未恢复时，执行 npm run regression:restore 从快照强制还原。
 * 第一条 FAIL 即停，修好后重跑；用例自包含，可重复执行。
 */
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const SNAPSHOT_PATH = path.resolve(__dirname, '.regression-snapshot.json')
const SECRETS_PATH = path.resolve(__dirname, '../../doc/project/secrets.local.json')

const KEY = (() => {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')).regressionKey || ''
  } catch (error) {
    return ''
  }
})()

let passed = 0

function pass(id) {
  passed += 1
  console.log('PASS', id)
}

function fail(id, message) {
  throw new Error(id + ' ' + message)
}

async function ok(id, promise) {
  const result = await promise
  if (!result || !result.ok) fail(id, (result && result.message) || 'no result')
  pass(id)
  return result
}

async function no(id, promise) {
  const result = await promise
  if (result && result.ok) fail(id, 'expected failure')
  pass(id)
  return result
}

async function is(id, cond, message) {
  if (!cond) fail(id, message || 'assertion failed')
  pass(id)
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

function setup(miniProgram, op, data = {}) {
  return callApi(miniProgram, 'testSetup', { op, key: KEY, ...data })
}

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

async function statGoals(miniProgram, openid, teamId) {
  const stats = await callApi(miniProgram, 'stats', periodQuery('month', teamId))
  const row = ((stats && stats.list) || []).find((item) => item.playerOpenid === openid)
  return row ? row.goals : 0
}

async function visit(miniProgram, url) {
  await miniProgram.reLaunch(url)
  const page = await miniProgram.currentPage()
  await page.waitFor(900)
  return page
}

async function cardTitles(page) {
  const els = await page.$$('.card .title')
  return Promise.all(els.map((el) => el.text()))
}

async function main() {
  if (!KEY) {
    throw new Error('doc/project/secrets.local.json 缺少 regressionKey，且云函数 api 需配置相同值的 REGRESSION_KEY 环境变量')
  }
  console.log('connect', WS)
  const miniProgram = await automator.connect({ wsEndpoint: WS })

  const activityIds = []
  let snapshot = null
  let restored = true

  try {
    // ---------- 预检 ----------
    await ok('PREFLIGHT testSetup', setup(miniProgram, 'ping'))
    const me0 = await ok('PREFLIGHT me', callApi(miniProgram, 'me'))
    const user = me0.user
    if (!user || !user.canGrantAdmin) {
      throw new Error('PREFLIGHT 当前微信号不是授权人，回归停在这里')
    }
    const openid = user._openid
    const myTeam = user.teamId
    const otherTeam = myTeam === 'team_jiong' ? 'team_pudong' : 'team_jiong'

    const snap = await ok('PREFLIGHT snapshot', setup(miniProgram, 'snapshot'))
    if (!snap.user) throw new Error('PREFLIGHT snapshot: 拿不到自己的档案')
    snapshot = snap.user
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2))
    restored = false
    console.log('snapshot saved for', snapshot.name)

    // ---------- 阶段 A：授权人 ----------
    console.log('--- 阶段 A：授权人 ---')
    const meOwner = await ok('R-REG-007', callApi(miniProgram, 'me'))
    await is('R-REG-007', meOwner.user.canGrantAdmin === true, 'canGrantAdmin 应为 true')

    const members0 = await ok('R-AUTH-001', callApi(miniProgram, 'listMembers'))
    await is('R-AUTH-001', Array.isArray(members0.users), 'listMembers 缺 users')

    let fake = (await ok('R-AUTH-004:setup', setup(miniProgram, 'createFake', { teamId: otherTeam }))).userId
    await ok('R-AUTH-004', callApi(miniProgram, 'setAdmin', { userId: fake, isAdmin: true }))
    await ok('R-AUTH-005', callApi(miniProgram, 'setAdmin', { userId: fake, isAdmin: false }))
    await no('R-AUTH-006', callApi(miniProgram, 'setAdmin', { userId: snapshot._id, isAdmin: false }))
    await no('R-AUTH-010', callApi(miniProgram, 'setAdmin', { userId: 'no_such_user_id', isAdmin: true }))

    fake = (await ok('R-AUTH-011:setup', setup(miniProgram, 'createFake', { isAdmin: true, canGrantAdmin: true }))).userId
    await no('R-AUTH-011', callApi(miniProgram, 'setAdmin', { userId: fake, isAdmin: false }))

    // ensureOwner：无授权人时最早的管理员被自动补为授权人（自己注册早于假人）
    await ok('R-AUTH-009:setup', setup(miniProgram, 'createFake', { isAdmin: true }))
    await ok('R-AUTH-009:setup', setup(miniProgram, 'setRole', { isAdmin: true, canGrantAdmin: false }))
    const mePromoted = await ok('R-AUTH-009', callApi(miniProgram, 'me'))
    await is('R-AUTH-009', mePromoted.user.canGrantAdmin === true, 'ensureOwner 未自动补授权人')

    // 纯管理员（假人当授权人，挡住 ensureOwner 的自动提升）
    await ok('R-REG-006:setup', setup(miniProgram, 'setRole', { isAdmin: true, canGrantAdmin: false }))
    await ok('R-REG-006:setup', setup(miniProgram, 'createFake', { isAdmin: true, canGrantAdmin: true }))
    const meAdmin = await ok('R-REG-006', callApi(miniProgram, 'me'))
    await is('R-REG-006', meAdmin.user.isAdmin === true && !meAdmin.user.canGrantAdmin, '应为纯管理员')
    await no('R-AUTH-002', callApi(miniProgram, 'listMembers'))
    await no('R-AUTH-007', callApi(miniProgram, 'setAdmin', { userId: fake, isAdmin: false }))

    const mePageA = await visit(miniProgram, '/pages/me/me')
    const hintA = await mePageA.$('.card .muted')
    const hintTextA = hintA ? await hintA.text() : ''
    await is('R-UI-005', hintTextA === '你是管理员。', '我的页应显示「你是管理员。」，实际：' + hintTextA)
    await is('R-UI-005', !(await mePageA.$('.grant-hint')), '纯管理员不应看到授权卡')

    await ok('CLEANUP role', setup(miniProgram, 'setRole', { isAdmin: true, canGrantAdmin: true }))
    await ok('CLEANUP fake', setup(miniProgram, 'removeFake'))

    // ---------- 阶段 B：管理员，建活动与数据 ----------
    console.log('--- 阶段 B：管理员 ---')
    const players = await ok('R-REG-009', callApi(miniProgram, 'listPlayers'))
    const playerList = players.users || []
    const sortedDesc = playerList.every((item, idx) => (
      idx === 0 || (playerList[idx - 1].createdAt || 0) >= (item.createdAt || 0)
    ))
    await is('R-REG-009', sortedDesc && playerList.some((item) => item._id === snapshot._id), 'listPlayers 应按 createdAt 倒序且含自己')

    const created = await ok('R-ACT-001', callApi(miniProgram, 'createActivity', {
      title: '回归 ' + new Date().toISOString(),
      location: '回归球场',
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      quotas: { team_jiong: 1, team_pudong: 1 }
    }))
    const activityId = created.activityId
    activityIds.push(activityId)

    const base = { location: '回归球场', startTime: Date.now() + 2 * 60 * 60 * 1000 }
    await no('R-ACT-004', callApi(miniProgram, 'createActivity', { ...base, title: '' }))
    await no('R-ACT-005', callApi(miniProgram, 'createActivity', { title: '回归', startTime: base.startTime, location: '' }))
    await no('R-ACT-006', callApi(miniProgram, 'createActivity', { title: '回归', location: '回归球场' }))
    await no('R-ACT-007', callApi(miniProgram, 'createActivity', { ...base, title: '回归', quotas: { team_jiong: 0, team_pudong: 1 } }))
    await no('R-ACT-008', callApi(miniProgram, 'createActivity', { ...base, title: '回归', quotas: { team_jiong: 31, team_pudong: 1 } }))

    const past = await ok('R-ACT-011:setup', callApi(miniProgram, 'createActivity', {
      title: '回归已开场',
      location: '回归球场',
      startTime: Date.now() - 60 * 1000,
      quotas: { team_jiong: 1, team_pudong: 1 }
    }))
    const pastId = past.activityId
    activityIds.push(pastId)
    await no('R-ACT-011', callApi(miniProgram, 'updateQuota', { activityId: pastId, teamId: myTeam, maxSignups: 2 }))
    await no('R-SIGN-008', callApi(miniProgram, 'signup', { activityId: pastId }))
    await no('R-SIGN-009', callApi(miniProgram, 'cancelSignup', { activityId: pastId }))

    // 满员拒绝：假人占掉我队的唯一名额
    await ok('R-SIGN-004:setup', setup(miniProgram, 'createFake', { teamId: myTeam }))
    await ok('R-SIGN-004:setup', setup(miniProgram, 'fakeSignup', { activityId }))
    await no('R-SIGN-004', callApi(miniProgram, 'signup', { activityId }))
    await ok('R-SIGN-004:cleanup', setup(miniProgram, 'removeFake'))

    await ok('R-SIGN-001', callApi(miniProgram, 'signup', { activityId }))
    await no('R-SIGN-002', callApi(miniProgram, 'signup', { activityId }))

    const detail = await ok('R-ACT-017', callApi(miniProgram, 'activityDetail', { activityId }))
    await is('R-ACT-017', Array.isArray(detail.members) && detail.members.length > 0, '管理员应拿到 members')
    await is('R-ACT-017', detail.signups.length === 1 && typeof detail.signups[0].isAdmin === 'boolean', '报名列表应 1 人且带 isAdmin')

    await ok('R-ACT-009', callApi(miniProgram, 'updateQuota', { activityId, teamId: myTeam, maxSignups: 2 }))
    await ok('R-ACT-010:setup', setup(miniProgram, 'createFake', { teamId: myTeam }))
    await ok('R-ACT-010:setup', setup(miniProgram, 'fakeSignup', { activityId }))
    await no('R-ACT-010', callApi(miniProgram, 'updateQuota', { activityId, teamId: myTeam, maxSignups: 1 }))
    await ok('R-ACT-010:cleanup', setup(miniProgram, 'removeFake'))
    await no('R-ACT-012', callApi(miniProgram, 'updateQuota', { activityId, teamId: myTeam, maxSignups: 0 }))
    await no('R-ACT-013', callApi(miniProgram, 'updateQuota', { activityId, teamId: 'team_ghost', maxSignups: 2 }))

    const round = await ok('R-RND-001', callApi(miniProgram, 'saveRound', { activityId, scoreJiong: 2, scorePudong: 1 }))
    await no('R-RND-004', callApi(miniProgram, 'saveRound', { activityId, scoreJiong: -1, scorePudong: 0 }))
    await no('R-RND-005', callApi(miniProgram, 'saveRound', { activityId, scoreJiong: 100, scorePudong: 0 }))

    await no('R-CONT-002', callApi(miniProgram, 'setContribution', { activityId, playerOpenid: 'openid_not_signed', goals: 1, assists: 0 }))
    const cont = await ok('R-CONT-001', callApi(miniProgram, 'setContribution', { activityId, playerOpenid: openid, goals: 1, assists: 1 }))
    await no('R-CONT-003', callApi(miniProgram, 'setContribution', { activityId, playerOpenid: openid, goals: 100, assists: 0 }))
    await no('R-CONT-006', callApi(miniProgram, 'setAbsent', { activityId, playerOpenid: openid, absent: true }))
    await no('R-CONT-007', callApi(miniProgram, 'setAbsent', { activityId, playerOpenid: 'openid_not_signed', absent: true }))
    await ok('R-CONT-011', callApi(miniProgram, 'setContribution', { activityId, playerOpenid: openid, goals: 0, assists: 0 }))
    await ok('R-CONT-005', callApi(miniProgram, 'setAbsent', { activityId, playerOpenid: openid, absent: true }))
    await ok('R-CONT-009', callApi(miniProgram, 'setAbsent', { activityId, playerOpenid: openid, absent: false }))
    await ok('R-CONT-010', callApi(miniProgram, 'deleteContribution', { contributionId: cont.contributionId }))
    const detailAfterDel = await callApi(miniProgram, 'activityDetail', { activityId })
    await is('R-CONT-010', !(detailAfterDel.contributions || []).some((item) => item._id === cont.contributionId), '贡献记录应已删除')

    // 统计基线 → 记 2 球 → 队过滤断言（记录留着，给删活动级联验证用）
    const beforeOwn = await statGoals(miniProgram, openid, myTeam)
    const beforeOther = await statGoals(miniProgram, openid, otherTeam)
    await ok('R-STAT-002:setup', callApi(miniProgram, 'setContribution', { activityId, playerOpenid: openid, goals: 2, assists: 1 }))
    const afterOwn = await statGoals(miniProgram, openid, myTeam)
    const afterOther = await statGoals(miniProgram, openid, otherTeam)
    await is('R-STAT-002', afterOwn - beforeOwn === 2 && afterOther === beforeOther, 'stats 按球队过滤不对')

    const actPage = await visit(miniProgram, '/pages/activity/activity?id=' + pastId)
    const titlesB = await cardTitles(actPage)
    await is('R-UI-003', titlesB.includes('记录数据'), '管理员对已开赛活动应看到「记录数据」卡，实际：' + titlesB.join('/'))

    // ---------- 阶段 C：普通用户 ----------
    console.log('--- 阶段 C：普通用户 ---')
    await ok('R-REG-005:setup', setup(miniProgram, 'setRole', { isAdmin: false, canGrantAdmin: false }))
    const meRegular = await ok('R-REG-005', callApi(miniProgram, 'me'))
    await is('R-REG-005', meRegular.user && meRegular.user.isAdmin === false, '应为普通用户')

    await no('R-ACT-002', callApi(miniProgram, 'createActivity', { ...base, title: '回归' }))
    await no('R-ACT-014', callApi(miniProgram, 'updateQuota', { activityId, teamId: myTeam, maxSignups: 2 }))
    await no('R-ACT-015', callApi(miniProgram, 'deleteActivity', { activityId }))
    await no('R-AUTH-003', callApi(miniProgram, 'listMembers'))
    await no('R-RND-002', callApi(miniProgram, 'saveRound', { activityId, scoreJiong: 1, scorePudong: 1 }))
    await no('R-RND-006', callApi(miniProgram, 'deleteRound', { roundId: round.roundId }))
    await no('R-CONT-004', callApi(miniProgram, 'setContribution', { activityId, playerOpenid: openid, goals: 1, assists: 0 }))
    await no('R-CONT-008', callApi(miniProgram, 'setAbsent', { activityId, playerOpenid: openid, absent: true }))

    const detailRegular = await ok('R-ACT-018', callApi(miniProgram, 'activityDetail', { activityId }))
    await is('R-ACT-018', Array.isArray(detailRegular.members) && detailRegular.members.length === 0, '普通用户不应拿到 members')

    await ok('R-SIGN-005', callApi(miniProgram, 'cancelSignup', { activityId }))
    await no('R-SIGN-006', callApi(miniProgram, 'cancelSignup', { activityId }))

    const actPageR = await visit(miniProgram, '/pages/activity/activity?id=' + activityId)
    const titlesC = await cardTitles(actPageR)
    await is('R-UI-002', !titlesC.includes('记录数据'), '普通用户不应看到「记录数据」卡')
    await is('R-UI-002', !!(await actPageR.$('.btn.hero')), '普通用户应看到报名按钮')

    // ---------- 阶段 D：恢复管理员，轮次与统计 ----------
    console.log('--- 阶段 D：恢复管理员 ---')
    await ok('CLEANUP role', setup(miniProgram, 'setRole', { isAdmin: true, canGrantAdmin: true }))
    await ok('R-RND-003', callApi(miniProgram, 'deleteRound', { roundId: round.roundId }))

    for (const type of ['month', 'quarter', 'year']) {
      const stats = await ok('R-STAT-001', callApi(miniProgram, 'stats', periodQuery(type)))
      await is('R-STAT-001', Array.isArray(stats.list) && stats.teams.length === 2, type + ' 结构不对')
    }
    await no('R-STAT-003', callApi(miniProgram, 'stats', { periodType: 'quarter', year: new Date().getFullYear(), quarter: 5 }))
    await no('R-STAT-003', callApi(miniProgram, 'stats', { periodType: 'month', year: new Date().getFullYear(), month: 13 }))
    await no('R-STAT-003', callApi(miniProgram, 'stats', { periodType: 'month' }))

    const home6m = await ok('R-STAT-004', callApi(miniProgram, 'homeSummary', { span: '6m' }))
    await is('R-STAT-004', home6m.span === '6m', 'span 应回显 6m')
    const homeBad = await callApi(miniProgram, 'homeSummary', { span: 'xx' })
    await is('R-STAT-004', homeBad.span === '3m', '非法 span 应回落 3m')

    // ---------- 阶段 E：未注册 ----------
    console.log('--- 阶段 E：未注册 ---')
    await ok('R-REG-001:setup', setup(miniProgram, 'createFake', { isAdmin: true })) // 保证重新注册不会是首个管理员
    await ok('R-REG-001:setup', setup(miniProgram, 'unregister'))
    const meGuest = await ok('R-REG-001', callApi(miniProgram, 'me'))
    await is('R-REG-001', meGuest.user === null, '未注册时 user 应为 null')

    await no('R-REG-002', callApi(miniProgram, 'saveProfile', { name: '', teamId: myTeam }))
    await no('R-SIGN-003', callApi(miniProgram, 'signup', { activityId }))
    await no('R-SIGN-007', callApi(miniProgram, 'cancelSignup', { activityId }))
    await no('R-ACT-003', callApi(miniProgram, 'createActivity', { ...base, title: '回归' }))
    await no('R-AUTH-008', callApi(miniProgram, 'listMembers'))
    await no('R-AUTH-012', callApi(miniProgram, 'setAdmin', { userId: 'someone', isAdmin: true }))

    const guestList = await ok('R-ACT-019', callApi(miniProgram, 'listActivities', { page: 1 }))
    await is('R-ACT-019', Array.isArray(guestList.activities), '游客应能看活动列表')
    const guestStats = await ok('R-STAT-005', callApi(miniProgram, 'stats', periodQuery('month')))
    await is('R-STAT-005', Array.isArray(guestStats.list), '游客应能看统计')

    const actPageU = await visit(miniProgram, '/pages/activity/activity?id=' + activityId)
    const note = await actPageU.$('.top-note')
    const noteText = note ? await note.text() : ''
    await is('R-UI-001', noteText.includes('一键微信注册即报名'), '未注册应看到注册引导，实际：' + noteText)

    const reg = await ok('R-REG-003', callApi(miniProgram, 'saveProfile', { name: '回归队员', teamId: myTeam }))
    await is('R-REG-003', reg.user.isAdmin === false && reg.user.canGrantAdmin === false, '非首个注册用户不应是管理员')
    const renamed = await ok('R-REG-004', callApi(miniProgram, 'saveProfile', { name: '回归队员改', teamId: myTeam }))
    await is('R-REG-004', renamed.user.name === '回归队员改', '改名未生效')
    await ok('CLEANUP unregister', setup(miniProgram, 'unregister'))

    // ---------- 阶段 F：恢复快照并清理 ----------
    console.log('--- 阶段 F：恢复与清理 ---')
    await ok('RESTORE', setup(miniProgram, 'restore', { record: snapshot }))
    await ok('CLEANUP fake', setup(miniProgram, 'removeFake'))
    restored = true

    const meRestored = await ok('R-REG-008', callApi(miniProgram, 'me'))
    const fields = ['name', 'teamId', 'isAdmin', 'canGrantAdmin', 'avatarUrl']
    const mismatch = fields.filter((field) => String(meRestored.user[field] || '') !== String(snapshot[field] || ''))
    await is('R-REG-008', meRestored.user && mismatch.length === 0, '恢复后与快照不一致：' + mismatch.join(','))

    const mePageO = await visit(miniProgram, '/pages/me/me')
    await is('R-UI-004', !!(await mePageO.$('.grant-hint')), '授权人应看到授权管理员卡')

    await ok('R-ACT-016', callApi(miniProgram, 'deleteActivity', { activityId }))
    activityIds.splice(activityIds.indexOf(activityId), 1)
    await no('R-ACT-016', callApi(miniProgram, 'activityDetail', { activityId }))
    const finalGoals = await statGoals(miniProgram, openid, myTeam)
    await is('R-STAT-006', finalGoals === beforeOwn, '删活动后统计应回收（级联删贡献）')

    await ok('CLEANUP past', callApi(miniProgram, 'deleteActivity', { activityId: pastId }))
    activityIds.splice(activityIds.indexOf(pastId), 1)

    fs.unlinkSync(SNAPSHOT_PATH)
    console.log('ALL ' + passed + ' CHECKS PASSED')
  } finally {
    if (!restored && snapshot) {
      await setup(miniProgram, 'restore', { record: snapshot }).catch(() => {})
      await setup(miniProgram, 'removeFake').catch(() => {})
      console.error('身份已从快照恢复（finally），快照保留在 ' + SNAPSHOT_PATH)
    } else if (snapshot) {
      await setup(miniProgram, 'removeFake').catch(() => {})
    }
    for (const id of activityIds) {
      await callApi(miniProgram, 'deleteActivity', { activityId: id }).catch(() => {})
    }
    miniProgram.disconnect()
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err)
  process.exit(1)
})
