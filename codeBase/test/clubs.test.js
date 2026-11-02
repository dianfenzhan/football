const test = require('node:test')
const assert = require('node:assert/strict')
const {
  CLUB_JIELONG,
  CLUB_WEDNESDAY,
  PENDING_TEAM,
  clubSeed,
  weekdayName,
  formatKickoff,
  membershipView,
  placeInPool,
  dividePlayers,
  cupFixtures,
  shouldAutoFixture,
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

test('jielong has no standing groups and uses pool signup', () => {
  const wednesday = clubSeed(CLUB_WEDNESDAY)
  const jielong = clubSeed(CLUB_JIELONG)
  assert.equal(wednesday.groups.length, 2)
  assert.equal(jielong.groups.length, 0)
  assert.deepEqual(jielong.signupModes, ['pool'])
  assert.equal(jielong.config.defaultTeamSize, 8)
})

test('join jielong without group; wednesday still needs a group', () => {
  const owner = membershipView({ canGrantAdmin: true, isAdmin: true, teamId: 'team_jiong' }, CLUB_JIELONG)
  const plain = membershipView({ memberships: [{ clubId: CLUB_JIELONG, role: 'member' }] }, CLUB_JIELONG)
  assert.equal(owner.role, 'owner')
  assert.equal(plain.joined, true)
  assert.equal(plain.groupId, '')
})

test('pool signup goes pending then waitlist at cap', () => {
  const first = placeInPool({ signedCount: 10, waitlistCount: 0, maxSignedPlayers: 40, waitlistLimit: 12 })
  assert.equal(first.status, 'signed')
  assert.equal(first.teamId, PENDING_TEAM)
  assert.equal(first.label, '已报名')
  const wait = placeInPool({ signedCount: 40, waitlistCount: 0, maxSignedPlayers: 40, waitlistLimit: 12 })
  assert.equal(wait.status, 'waitlist')
  assert.throws(() => placeInPool({
    signedCount: 40, waitlistCount: 12, maxSignedPlayers: 40, waitlistLimit: 12
  }), /后补已满/)
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

test('auto fixtures only for 4/5/6 teams and prefer eight on pitch 1 balance', () => {
  assert.equal(shouldAutoFixture(2), false)
  assert.equal(shouldAutoFixture(3), false)
  assert.equal(shouldAutoFixture(4), true)
  const ids = ['sess_a', 'sess_b', 'sess_c', 'sess_d', 'sess_e', 'sess_f']
  assert.equal(cupFixtures(ids.slice(0, 4)).length, 6)
  assert.equal(cupFixtures(ids.slice(0, 5)).length, 10)
  const six = cupFixtures(ids)
  assert.equal(six.length, 15)
  const pitch1 = pitchCounts(six)
  ids.forEach((id) => assert.ok(pitch1[id] === 2 || pitch1[id] === 3))
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
