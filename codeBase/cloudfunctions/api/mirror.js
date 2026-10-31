/**
 * 魔镜纯规则：FAQ 匹配、数据路由、模板与提示词。不连云、不调模型。
 */
const fs = require('fs')
const path = require('path')

const MATCH_THRESHOLD = 0.72
const MATCH_MARGIN = 0.10
const USER_WEEKLY_ASK_LIMIT = 15
const ADMIN_WEEKLY_ASK_LIMIT = 50
const GRANT_OWNER_WEEKLY_ASK_LIMIT = 100
const MAX_QUESTION_LEN = 60

const SYNONYMS = [
  [/缺席|缺勤/g, '鸽子'],
  [/报上了没|报了没|报上没|进没进名单/g, '报名了吗'],
  [/报上|报了/g, '报名'],
  [/咋整|咋办|怎么办呀/g, '怎么办'],
  [/踢球|开球/g, '开赛'],
  [/场地在哪|在哪踢/g, '地点'],
  [/气温|下雨|会不会雨/g, '天气']
]

const MODULE_LIVE = {
  next: { hits: ['下一场', '什么时候踢', '地点', '倒计时', '报名了没', '还差几人', '几点', '什么时候'], live: ['next'] },
  signup: { hits: ['怎么报名', '后补', '取消', '换队', '鸽子怎么产生', '开赛通知', '报名'], live: [] },
  stats: { hits: ['进球', '助攻', '出勤', '鸽子', '排行', '我的数据', '榜'], live: ['stats'] },
  weather: { hits: ['天气', '下雨', '温度', '风'], live: ['weather'] },
  tactics: { hits: ['战术板', '站位', '轮换', '海报'], live: [] },
  roster: { hits: ['改名字', '头像', '位置', '球队', '看球员', '队长', '管理员'], live: [] },
  admin: { hits: ['新建活动', '改人数', '记比分', '记数据', '删除活动'], live: [] }
}

const LIVE_EMPTY = {
  next: '最近没有球局。',
  weather: '这次没拿到天气。',
  stats: '这段还没有榜单。',
  'me-stats': '这段你还没有数据。'
}

const QUICK_QUESTIONS = [
  '下一场什么时候',
  '还差几人',
  '我的数据怎么样',
  '后补功能怎么用？',
  '取消报名算鸽子吗？',
  '联合报名是什么？'
]

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function resolveKnowledgePath(name) {
  const candidates = [
    path.join(__dirname, 'knowledge', name),
    path.join(__dirname, '../../../doc', name)
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('找不到知识文件 ' + name)
}

function loadFaqData() {
  return loadJson(resolveKnowledgePath('mirror-faq.json'))
}

function loadManualText() {
  const raw = fs.readFileSync(resolveKnowledgePath('mirror.md'), 'utf8')
  return stripHtmlComments(raw).trim()
}

function stripHtmlComments(text) {
  return String(text || '').replace(/<!--[\s\S]*?-->/g, '')
}

function normalizeQuestion(text) {
  let s = String(text || '').trim().toLowerCase()
  for (const [pattern, rep] of SYNONYMS) s = s.replace(pattern, rep)
  return s.replace(/[^\u4e00-\u9fffa-z0-9]/g, '')
}

function bigrams(text) {
  const s = String(text || '')
  if (s.length <= 1) return s ? [s] : []
  const grams = []
  for (let i = 0; i < s.length - 1; i += 1) grams.push(s.slice(i, i + 2))
  return grams
}

function jaccard(aList, bList) {
  const a = new Set(aList)
  const b = new Set(bList)
  if (!a.size && !b.size) return 0
  let inter = 0
  for (const item of a) if (b.has(item)) inter += 1
  return inter / (a.size + b.size - inter)
}

function scoreItem(normQ, item) {
  const qGrams = bigrams(normQ)
  let best = 0
  for (const question of item.questions || []) {
    const n = normalizeQuestion(question)
    if (!n) continue
    if (normQ === n) return 1
    // 问法被 FAQ 长句包含时按长度比降权，避免「鸽子榜」误贴「鸽子榜在哪」
    if (n.includes(normQ) && normQ.length >= 2) {
      best = Math.max(best, 0.55 + 0.4 * (normQ.length / n.length))
    }
    if (normQ.includes(n) && n.length >= 2) best = Math.max(best, 0.88)
    best = Math.max(best, jaccard(qGrams, bigrams(n)))
  }
  for (const tag of item.tags || []) {
    const t = normalizeQuestion(tag)
    if (t && normQ.includes(t)) best = Math.max(best, best + 0.05)
  }
  // 区分「我的数据 / 榜单」与「鸽子规则 / 怎么报名」
  if (item.id === 'stats-me' && /我(的|有|进|出勤)|几次/.test(normQ)) best = Math.min(1, best + 0.12)
  if (item.id === 'signup-cancel-pigeon') {
    if (/(取消|记鸽子|有没有责|有责|临期)/.test(normQ)) best = Math.min(1, best + 0.12)
    if (/榜|最多|谁/.test(normQ)) best = Math.max(0, best - 0.25)
  }
  if (/^(stats-goals-top|stats-assists-top|stats-attendance-top|stats-absent-top)$/.test(item.id)
    && /榜|最多|谁/.test(normQ)) {
    best = Math.min(1, best + 0.15)
  }
  if (item.id === 'next-signed' && /我.*(报名|报了)|报名了吗|报的哪/.test(normQ)) {
    best = Math.min(1, best + 0.1)
  }
  if (item.id === 'signup-how' && /怎么报名|如何报名|报名入口/.test(normQ)) {
    best = Math.min(1, best + 0.1)
  }
  if (item.id === 'signup-joint' && /联合/.test(normQ)) best = Math.min(1, best + 0.15)
  if (item.id === 'signup-full-waitlist' && /后补/.test(normQ)) best = Math.min(1, best + 0.1)
  return Math.min(1, best)
}

function rankFaq(question, faqData) {
  const norm = normalizeQuestion(question)
  const items = (faqData && faqData.items) || []
  const ranked = items
    .map((item) => ({ item, score: scoreItem(norm, item) }))
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
  return {
    normalized: norm,
    ranked,
    topScore: ranked[0] ? ranked[0].score : 0,
    secondScore: ranked[1] ? ranked[1].score : 0
  }
}

function matchFaq(question, faqData) {
  const threshold = (faqData && faqData.matchThreshold) || MATCH_THRESHOLD
  const ranking = rankFaq(question, faqData)
  const hit = ranking.ranked[0]
  const clear = hit
    && hit.score >= threshold
    && (hit.score - ranking.secondScore) >= MATCH_MARGIN
  return {
    hit: clear ? hit.item : null,
    topScore: ranking.topScore,
    secondScore: ranking.secondScore,
    normalized: ranking.normalized
  }
}

function detectSpan(question) {
  const q = String(question || '')
  if (/半年|近半年|六个月/.test(q)) return '6m'
  if (/一年|近一年|今年|12个月/.test(q)) return '1y'
  return '3m'
}

function detectTeamId(question) {
  const q = String(question || '').toLowerCase()
  if (/jiong|炯|青少年/.test(q)) return 'team_jiong'
  if (/浦东|老聚三|pudong/.test(q)) return 'team_pudong'
  return ''
}

function detectBoard(question) {
  const q = String(question || '')
  if (/助攻/.test(q)) return 'assists'
  if (/出勤|来得最勤/.test(q)) return 'attendances'
  if (/鸽子|缺勤|缺席/.test(q)) return 'absences'
  if (/进球|进球王/.test(q)) return 'goals'
  return 'goals'
}

function wantsMeStats(question) {
  const q = String(question || '')
  return /我(的|有|进了|出勤|助攻)|几次鸽子|我的数据/.test(q)
}

function detectFetched(question, faqLive) {
  if (faqLive === 'next' || faqLive === 'weather' || faqLive === 'stats' || faqLive === 'me-stats') {
    return [faqLive]
  }
  const q = String(question || '')
  const fetched = new Set()
  for (const mod of Object.values(MODULE_LIVE)) {
    if (mod.hits.some((hit) => q.includes(hit))) {
      for (const live of mod.live) fetched.add(live)
    }
  }
  if (wantsMeStats(q)) {
    fetched.add('me-stats')
    fetched.delete('stats')
  } else if (/进球|助攻|出勤|鸽子|排行|榜/.test(q)) {
    fetched.add('stats')
  }
  if (/天气|下雨|温度|风/.test(q)) fetched.add('weather')
  if (/下一场|什么时候|几点|地点|还差|名额|报名了/.test(q)) fetched.add('next')
  return [...fetched]
}

function fillTemplate(template, slots) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = slots[key]
    return value == null ? '' : String(value)
  })
}

function emptyAnswerFor(live) {
  return LIVE_EMPTY[live] || '这次没查到相关数据。'
}

function beijingNowText(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(now))
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || ''
  const week = get('weekday').replace('周', '周')
  return `${get('year')}-${get('month')}-${get('day')} ${week} ${get('hour')}:${get('minute')}`
}

function formatWhenText(startTime) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(startTime))
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || ''
  return `${get('weekday')} ${get('month')}月${get('day')}日 ${get('hour')}:${get('minute')}`
}

function spanLabel(span) {
  if (span === '6m') return '近半年'
  if (span === '1y') return '近1年'
  return '近3个月'
}

function teamLabel(teamId, teams) {
  if (!teamId) return '全部球队'
  const team = (teams || []).find((item) => item._id === teamId)
  return team ? team.name : '全部球队'
}

function boardLabel(board) {
  return {
    goals: '进球',
    assists: '助攻',
    attendances: '出勤',
    absences: '鸽子'
  }[board] || '进球'
}

function buildSystemPrompt(manualText) {
  return [
    '你是「魔镜」，周三快乐足球联队小程序的助手。只根据下面的说明书和本次附带的数据回答。',
    '说明书里没有的功能，就说小程序做不到。人数、时间、天气、榜单只能用附带数据，没有就说查不到，不要猜。',
    '提问人不是管理员时，管理员操作只说「请找管理员」。与本小程序无关的问题，礼貌说只能回答球局相关的事。',
    '答法要精简：先给结论或该点哪里，最多再补一句。不提接口名、字段名。尽量 60 字以内，不要列举一大串。',
    '',
    '【说明书】',
    stripHtmlComments(manualText)
  ].join('\n')
}

function buildUserPrompt(options) {
  const lines = []
  if (options.nowText) lines.push(`【现在】${options.nowText}（北京时间）`)
  if (options.askerText) lines.push(`【提问人】${options.askerText}`)
  if (options.previousText) lines.push(`【上一轮】${options.previousText}`)
  if (options.dataLines && options.dataLines.length) {
    lines.push('【数据】')
    lines.push(...options.dataLines)
  }
  lines.push(`【问题】${options.question}`)
  return lines.join('\n')
}

function askerText(user, teams) {
  if (!user) return '未建档'
  const team = (teams || []).find((item) => item._id === user.teamId)
  const role = user.isAdmin ? (user.canGrantAdmin ? '授权人管理员' : '管理员') : '普通队员'
  return `${user.name || '未命名'}，${team ? team.name : '未选球队'}，${role}，已建档`
}

function previousText(prevQuestion, prevAnswer) {
  const q = String(prevQuestion || '').trim().slice(0, 100)
  const a = String(prevAnswer || '').trim().slice(0, 100)
  if (!q && !a) return ''
  return `问：${q || '（无）'} / 答：${a || '（无）'}`
}

function hasDeepseekKey(apiKey) {
  const key = String(apiKey || '').trim()
  if (!key) return false
  if (/^REPLACE_/i.test(key)) return false
  return key.length >= 16
}

function dayKeyShanghai(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(now))
  const get = (type) => parts.find((p) => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 自然周键：上海时区当周周一日期 YYYY-MM-DD */
function weekKeyShanghai(now = Date.now()) {
  const dayKey = dayKeyShanghai(now)
  const [year, month, day] = dayKey.split('-').map(Number)
  const utc = Date.UTC(year, month - 1, day)
  const dow = new Date(utc).getUTCDay()
  const offset = dow === 0 ? -6 : 1 - dow
  const monday = new Date(utc + offset * 86400000)
  const y = monday.getUTCFullYear()
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0')
  const d = String(monday.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function remainingAsks(used, limit = USER_WEEKLY_ASK_LIMIT) {
  return Math.max(0, limit - (used || 0))
}

/** 模型失败（无 key / 空答 / 调用异常）不计次；FAQ 与模型成功计次 */
function countsTowardQuota(error) {
  return !String(error || '').trim()
}

/** 普通 15 / 管理员 50 / 授权人（超管）100 */
function weeklyAskLimit(user) {
  if (user && user.canGrantAdmin) return GRANT_OWNER_WEEKLY_ASK_LIMIT
  if (user && user.isAdmin) return ADMIN_WEEKLY_ASK_LIMIT
  return USER_WEEKLY_ASK_LIMIT
}

module.exports = {
  MATCH_THRESHOLD,
  MATCH_MARGIN,
  USER_WEEKLY_ASK_LIMIT,
  ADMIN_WEEKLY_ASK_LIMIT,
  GRANT_OWNER_WEEKLY_ASK_LIMIT,
  MAX_QUESTION_LEN,
  QUICK_QUESTIONS,
  LIVE_EMPTY,
  loadFaqData,
  loadManualText,
  stripHtmlComments,
  normalizeQuestion,
  rankFaq,
  matchFaq,
  detectSpan,
  detectTeamId,
  detectBoard,
  wantsMeStats,
  detectFetched,
  fillTemplate,
  emptyAnswerFor,
  beijingNowText,
  formatWhenText,
  spanLabel,
  teamLabel,
  boardLabel,
  buildSystemPrompt,
  buildUserPrompt,
  askerText,
  previousText,
  hasDeepseekKey,
  dayKeyShanghai,
  weekKeyShanghai,
  remainingAsks,
  countsTowardQuota,
  weeklyAskLimit
}
