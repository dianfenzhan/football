const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
  matchFaq,
  detectFetched,
  detectSpan,
  detectTeamId,
  detectBoard,
  fillTemplate,
  emptyAnswerFor,
  buildSystemPrompt,
  buildUserPrompt,
  hasDeepseekKey,
  loadFaqData,
  weekKeyShanghai,
  remainingAsks,
  countsTowardQuota,
  weeklyAskLimit,
  USER_WEEKLY_ASK_LIMIT,
  ADMIN_WEEKLY_ASK_LIMIT,
  GRANT_OWNER_WEEKLY_ASK_LIMIT,
  MATCH_MARGIN
} = require('../cloudfunctions/api/mirror')

const faq = loadFaqData()
const evalPath = path.join(__dirname, '../scripts/mirror-eval.json')
const evalCases = JSON.parse(fs.readFileSync(evalPath, 'utf8'))

test('FAQ 评测集：命中 id 或交给 model', () => {
  const fails = []
  for (const item of evalCases) {
    const matched = matchFaq(item.q, faq)
    const actual = matched.hit ? matched.hit.id : 'model'
    if (actual !== item.expect) {
      fails.push(`${item.q} => ${actual} (want ${item.expect}) top=${matched.topScore.toFixed(2)} second=${matched.secondScore.toFixed(2)}`)
    }
  }
  assert.equal(fails.length, 0, fails.join('\n'))
})

test('撞车对：我的鸽子 vs 取消鸽子；我报名了吗 vs 怎么报名', () => {
  assert.equal(matchFaq('我有几次鸽子', faq).hit.id, 'stats-me')
  assert.equal(matchFaq('取消报名会记鸽子吗', faq).hit.id, 'signup-cancel-pigeon')
  assert.equal(matchFaq('我报名了吗', faq).hit.id, 'next-signed')
  assert.equal(matchFaq('怎么报名', faq).hit.id, 'signup-how')
})

test('分差不够时不命中 FAQ', () => {
  const matched = matchFaq('鸽子', faq)
  if (matched.hit) {
    assert.ok(matched.topScore - matched.secondScore >= MATCH_MARGIN)
  }
})

test('detectFetched 按问题选数据', () => {
  assert.deepEqual(detectFetched('下一场什么时候'), ['next'])
  assert.ok(detectFetched('会不会下雨').includes('weather'))
  assert.deepEqual(detectFetched('我进了几个球'), ['me-stats'])
  assert.ok(detectFetched('谁进球最多').includes('stats'))
})

test('时间范围与球队识别', () => {
  assert.equal(detectSpan('近半年进球榜'), '6m')
  assert.equal(detectSpan('今年出勤'), '1y')
  assert.equal(detectSpan('谁进球最多'), '3m')
  assert.equal(detectTeamId('jiong 路进球榜'), 'team_jiong')
  assert.equal(detectTeamId('浦东助攻'), 'team_pudong')
  assert.equal(detectBoard('助攻榜'), 'assists')
  assert.equal(detectBoard('鸽子榜'), 'absences')
})

test('模板填充与空数据兜底', () => {
  assert.equal(fillTemplate('下一场 {{whenText}}', { whenText: '周三 20:00' }), '下一场 周三 20:00')
  assert.ok(emptyAnswerFor('next').includes('没有球局'))
})

test('提示词结构', () => {
  const system = buildSystemPrompt('## 使用流程\n先填资料')
  assert.ok(system.includes('【说明书】'))
  assert.ok(system.includes('先填资料'))
  const user = buildUserPrompt({
    nowText: '2026-10-31 周六 13:55',
    askerText: '张三，普通队员，已建档',
    dataLines: ['下一场：养生球'],
    question: '还差几人'
  })
  assert.ok(user.includes('【现在】'))
  assert.ok(user.includes('【问题】还差几人'))
})

test('DeepSeek key 占位不算开通', () => {
  assert.equal(hasDeepseekKey(''), false)
  assert.equal(hasDeepseekKey('REPLACE_DEEPSEEK_API_KEY'), false)
  assert.equal(hasDeepseekKey('valid-deepseek-key-ok'), true)
})

test('模型失败不计次，成功与 FAQ 计次', () => {
  assert.equal(countsTowardQuota(''), true)
  assert.equal(countsTowardQuota('no_key'), false)
  assert.equal(countsTowardQuota('empty'), false)
  assert.equal(countsTowardQuota('model_error'), false)
})

test('周键按上海周一，剩余次数不小于 0', () => {
  assert.equal(weekKeyShanghai(Date.parse('2026-10-31T12:00:00+08:00')), '2026-10-26')
  assert.equal(weekKeyShanghai(Date.parse('2026-10-26T00:30:00+08:00')), '2026-10-26')
  assert.equal(remainingAsks(0), 15)
  assert.equal(remainingAsks(15), 0)
  assert.equal(remainingAsks(20), 0)
})

test('周额度：普通 15 / 管理员 50 / 授权人 100', () => {
  assert.equal(weeklyAskLimit(null), USER_WEEKLY_ASK_LIMIT)
  assert.equal(weeklyAskLimit({}), USER_WEEKLY_ASK_LIMIT)
  assert.equal(weeklyAskLimit({ isAdmin: true }), ADMIN_WEEKLY_ASK_LIMIT)
  assert.equal(weeklyAskLimit({ isAdmin: true, canGrantAdmin: true }), GRANT_OWNER_WEEKLY_ASK_LIMIT)
  assert.equal(weeklyAskLimit({ canGrantAdmin: true }), GRANT_OWNER_WEEKLY_ASK_LIMIT)
})
