const test = require('node:test')
const assert = require('node:assert/strict')
const {
  CLUB_JIELONG,
  CLUB_WEDNESDAY,
  PENDING_TEAM,
  clubSeed,
  pigeonCutoffHours,
  remindBeforeHours,
  remindLeadMs,
  weekdayName,
  formatKickoff,
  membershipView,
  hasClubProfile,
  buildProfileUpdate,
  placeInPool,
  dividePlayers,
  sessionTeamSlot,
  autoSessionPlacement,
  divideByRosterGroups,
  cupFixtures,
  shouldAutoFixture,
  ASSIGN_MIN_PLAYERS,
  CUP_MIN_PLAYERS,
  evaluateJielongCup,
  isCupTeamsDrifted,
  finalsForFour,
  pitchCounts,
  applyGoalEvents,
  normalizeGoalEvent,
  pairRoster
} = require('../cloudfunctions/api/clubs')

test('weekday uses China time', () => {
  const wednesday = Date.parse('2026-04-01T12:00:00.000Z')
  assert.equal(weekdayName(wednesday), '周三')
  assert.match(formatKickoff(wednesday), /周三 20:00/)
})

test('jielong has roster groups and uses pool signup', () => {
  const wednesday = clubSeed(CLUB_WEDNESDAY)
  const jielong = clubSeed(CLUB_JIELONG)
  assert.equal(wednesday.groups.length, 2)
  assert.equal(jielong.name, '界龙散客队')
  assert.equal(jielong.groups.length, 6)
  assert.deepEqual(jielong.signupModes, ['pool'])
  assert.equal(jielong.config.defaultTeamSize, 8)
  assert.equal(jielong.config.cancelSignedCutoffHours, 1.5)
  assert.equal(jielong.config.remindBeforeHours, 2)
  assert.equal(wednesday.config.cancelSignedCutoffHours, 4)
  assert.equal(wednesday.config.remindBeforeHours, 2)
  assert.equal(pigeonCutoffHours(CLUB_JIELONG), 1.5)
  assert.equal(pigeonCutoffHours(CLUB_WEDNESDAY), 4)
  assert.equal(remindBeforeHours(CLUB_JIELONG), 2)
  assert.equal(remindLeadMs(CLUB_JIELONG), 2 * 60 * 60 * 1000)
})

test('join jielong without group defaults to 未分组; wednesday still needs a group', () => {
  const owner = membershipView({ canGrantAdmin: true, isAdmin: true, teamId: 'team_jiong' }, CLUB_JIELONG)
  const plain = membershipView({ memberships: [{ clubId: CLUB_JIELONG, role: 'member' }] }, CLUB_JIELONG)
  const outsider = membershipView({ name: '只在周三联', teamId: 'team_jiong' }, CLUB_JIELONG)
  assert.equal(owner.role, 'owner')
  assert.equal(owner.joined, true)
  assert.equal(owner.groupId, 'jl_other')
  assert.equal(plain.joined, true)
  assert.equal(plain.groupId, 'jl_other')
  assert.equal(outsider.joined, false)
  assert.equal(outsider.groupId, '')
  assert.equal(
    hasClubProfile({ name: '散客球友', memberships: [{ clubId: CLUB_JIELONG, role: 'member' }] }, CLUB_JIELONG),
    true
  )
})

test('pool signup always signs into pending pool without waitlist', () => {
  const first = placeInPool({ signedCount: 10 })
  assert.equal(first.status, 'signed')
  assert.equal(first.teamId, PENDING_TEAM)
  assert.equal(first.label, '已报名')
  const beyond = placeInPool({ signedCount: 60 })
  assert.equal(beyond.status, 'signed')
  assert.equal(beyond.teamId, PENDING_TEAM)
})

test('divide prefers eight per team and leaves leftovers undivided', () => {
  const players = Array.from({ length: 34 }, (_, index) => ({ _id: `p${index}`, name: `P${index}` }))
  const plan = dividePlayers(players, 4, 8)
  assert.equal(plan.teams.length, 4)
  assert.equal(plan.assignedCount, 32)
  assert.equal(plan.leftover.length, 2)
  const sizes = plan.teams.map((team) => plan.assignments[team.id].length)
  assert.deepEqual(sizes, [8, 8, 8, 8])
  const uneven = dividePlayers(players.slice(0, 30), 4, 8)
  assert.deepEqual(uneven.teams.map((team) => uneven.assignments[team.id].length), [8, 8, 7, 7])
})

test('auto session placement grows a team every eight players', () => {
  assert.equal(sessionTeamSlot(0), 0)
  assert.equal(sessionTeamSlot(7), 0)
  assert.equal(sessionTeamSlot(8), 1)
  assert.equal(sessionTeamSlot(16), 2)
  assert.equal(sessionTeamSlot(24), 3)
  assert.equal(sessionTeamSlot(32), 4)
  assert.equal(sessionTeamSlot(40), 5)
  assert.equal(sessionTeamSlot(48), 5)
  const first = autoSessionPlacement(0, [], 8)
  assert.equal(first.teamCount, 1)
  assert.equal(first.teamId, 'sess_a')
  const ninth = autoSessionPlacement(8, first.teams, 8)
  assert.equal(ninth.teamCount, 2)
  assert.equal(ninth.teamId, 'sess_b')
})

test('assign min players is 16 and independent of cup min 24', () => {
  assert.equal(ASSIGN_MIN_PLAYERS, 16)
  assert.equal(CUP_MIN_PLAYERS, 24)
})

test('smart divide around 8 keeps same-tag players together, caps at 5 teams, and only overflows >45', () => {
  const groups = clubSeed(CLUB_JIELONG).groups
  // 1) 32 人：塔子 7 + 界龙 9 + 伤心 5 + 汤姆 3 + 未分组 8 -> 4 队各 8 人，同组抱团，塔子/界龙自动带组名与球衣色
  const roster32 = [
    ...Array.from({ length: 7 }, (_, i) => ({ _id: `tz_${i}`, _openid: `tz_${i}`, group: 'jl_tazi' })),
    ...Array.from({ length: 9 }, (_, i) => ({ _id: `jl_${i}`, _openid: `jl_${i}`, group: 'jl_jielong' })),
    ...Array.from({ length: 5 }, (_, i) => ({ _id: `sx_${i}`, _openid: `sx_${i}`, group: 'jl_shangxin' })),
    ...Array.from({ length: 3 }, (_, i) => ({ _id: `tm_${i}`, _openid: `tm_${i}`, group: 'jl_tangmu' })),
    ...Array.from({ length: 8 }, (_, i) => ({ _id: `un_${i}`, _openid: `un_${i}`, group: 'jl_other' }))
  ]
  const map32 = {}
  roster32.forEach((p) => { map32[p._openid] = p.group })
  const plan32 = divideByRosterGroups(roster32, (id) => map32[id], groups)
  assert.equal(plan32.teams.length, 4)
  assert.equal(plan32.assignedCount, 32)
  assert.equal(plan32.leftover.length, 0)
  assert.deepEqual(plan32.teams.map((t) => plan32.assignments[t.id].length), [8, 8, 8, 8])
  // 塔子 7 人应全部在同一支队，且该队自动命名为「塔子🕊」
  const taziTeam = plan32.teams.find((t) => t.rosterGroupId === 'jl_tazi')
  assert.ok(taziTeam, 'tazi dominant team should adopt group name')
  assert.equal(taziTeam.name, '塔子🕊')
  const taziInTeam = plan32.assignments[taziTeam.id].filter((p) => p.group === 'jl_tazi').length
  assert.equal(taziInTeam, 7)
  // 伤心 5 人与汤姆 3 人均不应被拆散
  const teamContainingAll = (groupKey, expected) => plan32.teams.some(
    (t) => plan32.assignments[t.id].filter((p) => p.group === groupKey).length === expected
  )
  assert.equal(teamContainingAll('jl_shangxin', 5), true)
  assert.equal(teamContainingAll('jl_tangmu', 3), true)

  // 2) 31 人全未分组 -> 4 队 [8,8,8,7]，0 留池，队名保持 A队~D队
  const plain31 = Array.from({ length: 31 }, (_, i) => ({ _id: `p_${i}`, _openid: `p_${i}` }))
  const plan31 = divideByRosterGroups(plain31, () => 'jl_other', groups)
  assert.equal(plan31.teams.length, 4)
  assert.equal(plan31.assignedCount, 31)
  assert.equal(plan31.leftover.length, 0)
  assert.deepEqual(plan31.teams.map((t) => plan31.assignments[t.id].length), [8, 8, 8, 7])
  assert.deepEqual(plan31.teams.map((t) => t.name), ['A队', 'B队', 'C队', 'D队'])

  // 3) 48 人 -> 5 队各 9 人（45 人），多余 3 人进 leftover（未分队池）
  const big48 = Array.from({ length: 48 }, (_, i) => ({ _id: `b_${i}`, _openid: `b_${i}` }))
  const plan48 = divideByRosterGroups(big48, () => '', groups)
  assert.equal(plan48.teams.length, 5)
  assert.equal(plan48.assignedCount, 45)
  assert.equal(plan48.leftover.length, 3)
  assert.deepEqual(plan48.teams.map((t) => plan48.assignments[t.id].length), [9, 9, 9, 9, 9])
})

test('auto fixtures only for 4/5 teams, 3-1-1-1 for 4 teams + final pitch avoidance, and 2 each for 5 teams', () => {
  assert.equal(shouldAutoFixture(2), false)
  assert.equal(shouldAutoFixture(3), false)
  assert.equal(shouldAutoFixture(4), true)
  assert.equal(shouldAutoFixture(5), true)
  assert.equal(shouldAutoFixture(6), false)
  const ids = ['sess_a', 'sess_b', 'sess_c', 'sess_d', 'sess_e', 'sess_f']
  const four = cupFixtures(ids.slice(0, 4), () => 0.99)
  assert.equal(four.length, 6)
  const fourPitch1 = pitchCounts(four)
  const fourValues = ids.slice(0, 4).map((id) => fourPitch1[id] || 0).sort((a, b) => b - a)
  assert.deepEqual(fourValues, [3, 1, 1, 1])

  // 模拟前 3 轮记分：让踢了 3 场 1 号场的队伍进冠亚军，验证决赛自动去 2 号场，季军赛去 1 号场
  const scoredFour = four.map((m) => ({
    ...m,
    scoreA: m.teamAId === 'sess_a' || m.teamBId === 'sess_a' ? (m.teamAId === 'sess_a' ? 2 : 0) : 1,
    scoreB: m.teamAId === 'sess_a' || m.teamBId === 'sess_a' ? (m.teamBId === 'sess_a' ? 2 : 0) : 0
  }))
  const finals = finalsForFour(ids.slice(0, 4), scoredFour, ['sess_a', 'sess_b', 'sess_c', 'sess_d'])
  assert.equal(finals.length, 2)
  const finalMatch = finals.find((m) => m.matchType === 'final')
  const thirdMatch = finals.find((m) => m.matchType === 'third')
  assert.equal(finalMatch.pitchId, 'pitch_2')
  assert.equal(thirdMatch.pitchId, 'pitch_1')

  const five = cupFixtures(ids.slice(0, 5))
  assert.equal(five.length, 10)
  const fivePitch1 = pitchCounts(five)
  ids.slice(0, 5).forEach((id) => assert.equal(fivePitch1[id], 2))
  assert.equal(cupFixtures(ids).length, 0)
})

test('evaluateJielongCup counts only non-empty formal teams and requires 4/5 teams with >=24 players', () => {
  const teams = [
    { id: 'sess_a', name: 'A' },
    { id: 'sess_b', name: 'B' },
    { id: 'sess_c', name: 'C' },
    { id: 'sess_d', name: 'D' },
    { id: 'sess_e', name: 'E' },
    { id: 'sess_f', name: 'F' }
  ]
  const makeSignups = (counts, pending = 0) => {
    const rows = []
    counts.forEach((count, idx) => {
      for (let i = 0; i < count; i += 1) {
        rows.push({ status: 'signed', teamId: teams[idx].id })
      }
    })
    for (let i = 0; i < pending; i += 1) {
      rows.push({ status: 'signed', teamId: PENDING_TEAM })
    }
    return rows
  }

  // 4 non-empty teams + 2 empty teams, 24 players in active teams -> eligible for 4-team cup
  const fourActive = evaluateJielongCup(teams, makeSignups([6, 6, 6, 6, 0, 0], 3))
  assert.equal(fourActive.eligible, true)
  assert.deepEqual(fourActive.activeTeamIds, ['sess_a', 'sess_b', 'sess_c', 'sess_d'])
  assert.equal(fourActive.emptyTeams.length, 2)
  assert.equal(fourActive.activePlayerCount, 24)
  assert.equal(fourActive.pendingCount, 3)

  // 4 non-empty teams with 23 players + 5 pending -> not eligible (pending does not count toward 24)
  const under24 = evaluateJielongCup(teams, makeSignups([6, 6, 6, 5, 0, 0], 5))
  assert.equal(under24.eligible, false)
  assert.match(under24.reason, /不少于 24 人/)

  // 3 non-empty teams with 24 players -> not eligible
  const threeActive = evaluateJielongCup(teams, makeSignups([8, 8, 8, 0, 0, 0]))
  assert.equal(threeActive.eligible, false)
  assert.match(threeActive.reason, /4 或 5 支/)

  // 6 non-empty teams with 36 players -> rejected with 6-team manual hint
  const sixActive = evaluateJielongCup(teams, makeSignups([6, 6, 6, 6, 6, 6]))
  assert.equal(sixActive.eligible, false)
  assert.match(sixActive.reason, /6 支非空队伍，不支持一键开启界龙杯/)

  // Drift check
  assert.equal(isCupTeamsDrifted(['sess_a', 'sess_b', 'sess_c', 'sess_d'], ['sess_a', 'sess_b', 'sess_c', 'sess_d']), false)
  assert.equal(isCupTeamsDrifted(['sess_a', 'sess_b', 'sess_c', 'sess_d'], ['sess_a', 'sess_b', 'sess_c', 'sess_d', 'sess_e']), true)
})

test('pair roster is two columns', () => {
  const rows = pairRoster([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].left.name, 'a')
  assert.equal(rows[0].right.name, 'b')
  assert.equal(rows[1].right, null)
})

test('goal events keep own goals off the goal board', () => {
  assert.throws(() => normalizeGoalEvent({ scorerOpenid: '' }), /进球者/)
  const rows = applyGoalEvents([
    { scorerOpenid: 'a', assisterOpenid: 'b', isOwnGoal: false },
    { scorerOpenid: 'a', assisterOpenid: '', isOwnGoal: true }
  ])
  assert.equal(rows.find((row) => row.playerOpenid === 'a').goals, 1)
  assert.equal(rows.find((row) => row.playerOpenid === 'a').ownGoals, 1)
})

test('registering in jielong does not pollute wednesday membership, and cross-club join preserves personal profile', () => {
  // 1. 全新用户在界龙注册（未选擅长位置，选名册组 jl_tazi）
  const jielongOnly = buildProfileUpdate(
    null,
    {
      name: '界龙新人',
      avatarUrl: 'cloud://avatar_1',
      clubId: CLUB_JIELONG,
      groupId: 'jl_tazi',
      preferredPosition: ''
    },
    { hasAnyAdmin: true, randomFn: () => 0 }
  )
  assert.equal(jielongOnly.name, '界龙新人')
  assert.equal(jielongOnly.avatarUrl, 'cloud://avatar_1')
  assert.equal(jielongOnly.preferredPosition, 'fw')
  assert.equal(jielongOnly.teamId, '')
  assert.equal(hasClubProfile(jielongOnly, CLUB_JIELONG), true)
  assert.equal(hasClubProfile(jielongOnly, CLUB_WEDNESDAY), false)

  // 2. 该界龙用户在「我的」页面仅修改昵称/位置（不传 clubId/teamId），仍不污染周三联
  const personalEdited = buildProfileUpdate(
    jielongOnly,
    { name: '界龙老鸟', preferredPosition: 'gk' },
    { hasAnyAdmin: true }
  )
  assert.equal(personalEdited.name, '界龙老鸟')
  assert.equal(personalEdited.preferredPosition, 'gk')
  assert.equal(personalEdited.teamId, '')
  assert.equal(hasClubProfile(personalEdited, CLUB_JIELONG), true)
  assert.equal(hasClubProfile(personalEdited, CLUB_WEDNESDAY), false)

  // 3. 收到周三联活动分享后注册加入周三联（带出原位置、不换头像、选 team_pudong）
  const joinedBoth = buildProfileUpdate(
    personalEdited,
    {
      name: '界龙老鸟',
      clubId: CLUB_WEDNESDAY,
      groupId: 'team_pudong',
      preferredPosition: 'gk'
    },
    { hasAnyAdmin: true }
  )
  assert.equal(joinedBoth.teamId, 'team_pudong')
  assert.equal(joinedBoth.preferredPosition, 'gk')
  assert.equal(hasClubProfile(joinedBoth, CLUB_JIELONG), true)
  assert.equal(hasClubProfile(joinedBoth, CLUB_WEDNESDAY), true)
  assert.equal(membershipView(joinedBoth, CLUB_JIELONG).groupId, 'jl_tazi')
  assert.equal(membershipView(joinedBoth, CLUB_WEDNESDAY).groupId, 'team_pudong')
})
