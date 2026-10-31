/**
 * 魔镜云侧编排：查数、限流、调模型。由 index.js 注入 db 能力。
 */
const https = require('https')
const {
  TEAMS,
  UNITE_TEAM,
  signupModeOf,
  topBy,
  boardRows,
  totalsByPlayer,
  attendancesByPlayer,
  withHomeTeam,
  recentStart
} = require('./rules')
const { fetchActivityWeather } = require('./weather')
const mirror = require('./mirror')

function postChat(baseUrl, apiKey, body, timeoutMs = 12000) {
  const url = new URL(String(baseUrl || '').replace(/\/$/, '') + '/chat/completions')
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(raw) } catch (err) { /* ignore */ }
        if (res.statusCode && res.statusCode >= 400) {
          const msg = (parsed && parsed.error && parsed.error.message) || raw.slice(0, 200) || '模型服务不可用'
          reject(new Error(msg))
          return
        }
        resolve(parsed)
      })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('模型服务超时'))
    })
    req.on('error', () => reject(new Error('模型服务请求失败')))
    req.write(payload)
    req.end()
  })
}

function teamName(teamId) {
  if (teamId === UNITE_TEAM._id) return UNITE_TEAM.name
  const team = TEAMS.find((item) => item._id === teamId)
  return team ? team.name : teamId || ''
}

function formatNextSlots(next) {
  if (!next) return null
  const mode = signupModeOf(next) === 'joint' ? '联合' : '分队'
  const whenText = mirror.formatWhenText(next.startTime)
  const place = next.location || ''
  const title = next.title || '球局'
  const signedText = next.signedUp
    ? `已报名（${teamName(next.signedTeamId) || '本场'}）`
    : '未报名'
  const quotaText = (next.quotas || []).map((quota) => (
    `${teamName(quota.teamId)} ${quota.signed || 0}/${quota.maxSignups}`
  )).join('，') + (next.waitlistCount ? `；后补 ${next.waitlistCount}` : '')
  const line = `下一场：${title}，${whenText}，${place}；报名方式：${mode}；你：${signedText}；名额：${quotaText}`
  return { whenText, place, title, signedText, quotaText, line }
}

function formatWeatherLine(weather, startTime) {
  if (!weather || !weather.hours || !weather.hours.length) return null
  const kickHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    hour12: false
  }).format(new Date(startTime)))
  let kick = weather.hours.find((item) => item.hour === kickHour)
  if (!kick) kick = weather.hours[weather.defaultIndex] || weather.hours[0]
  const nearby = weather.hours
    .filter((item) => Math.abs(item.hour - kick.hour) <= 2 && item.hour !== kick.hour)
    .slice(0, 2)
    .map((item) => `${item.label}${item.text}${item.temp}°C`)
    .join('，')
  const summary = nearby ? `前后：${nearby}` : '晚间概况见首页'
  return `开赛 ${kick.label}：${kick.text} ${kick.temp}°C 风${kick.windLevel}级；${summary}`
}

function formatBoardLine(span, teamId, board, rows) {
  const label = mirror.boardLabel(board)
  const field = board === 'attendances' ? 'attendances' : board === 'absences' ? 'absences' : board
  const top = topBy(rows, field)
  const boardText = top.length
    ? top.map((row) => `${row.userName || '未知'}${row[field]}`).join('、')
    : '暂无'
  return {
    spanText: `${mirror.spanLabel(span)}·`,
    teamText: mirror.teamLabel(teamId, TEAMS),
    boardText,
    line: `${mirror.spanLabel(span)}·${mirror.teamLabel(teamId, TEAMS)}｜${label}前10：${boardText}`
  }
}

function formatMeLine(span, teamId, openid, totals, attendanceRows) {
  const goals = totals.find((row) => row.playerOpenid === openid) || {}
  const attendance = attendanceRows.find((row) => row.playerOpenid === openid) || {}
  const myText = `进球${goals.goals || 0}、助攻${goals.assists || 0}、出勤${attendance.attendances || 0}、鸽子${goals.absences || 0}`
  return {
    spanText: `${mirror.spanLabel(span)}·`,
    teamText: `${mirror.teamLabel(teamId, TEAMS)}，`,
    myText,
    line: `你（${mirror.spanLabel(span)}·${mirror.teamLabel(teamId, TEAMS)}）：${myText}`
  }
}

function createMirrorAsk(deps) {
  const {
    db,
    _,
    collect,
    quotasOf,
    homeTeams,
    findUser,
    deepseekConfig
  } = deps

  async function loadNext(openid) {
    const upcoming = await db.collection('activities').where({
      startTime: _.gt(Date.now())
    }).orderBy('startTime', 'asc').limit(5).get()
    const next = upcoming.data[0] || null
    if (!next) return null
    let signedUp = false
    let signedTeamId = ''
    const mine = await db.collection('signups').where({
      activityId: next._id,
      _openid: openid,
      status: 'signed'
    }).limit(1).get()
    if (mine.data[0]) {
      signedUp = true
      signedTeamId = mine.data[0].teamId || ''
    }
    const waiting = await db.collection('signups').where({
      activityId: next._id,
      status: 'waitlist'
    }).count()
    return {
      ...next,
      quotas: await quotasOf(next._id),
      signedUp,
      signedTeamId,
      waitlistCount: waiting.total
    }
  }

  async function loadBoardTotals(span, teamId, now = Date.now()) {
    const start = recentStart(span, now)
    const teamFilter = TEAMS.some((team) => team._id === teamId) ? teamId : ''
    const homes = await homeTeams()
    const contributions = withHomeTeam(
      await collect('contributions', { activityStartTime: _.gte(start) }),
      homes
    ).filter((row) => !teamFilter || row.teamId === teamFilter)
    const totals = totalsByPlayer(boardRows(contributions, now))
    const activities = await collect('activities', { startTime: _.gte(start) })
    const startedIds = activities
      .filter((activity) => activity.startTime <= now)
      .map((activity) => activity._id)
    let attendanceRows = []
    if (startedIds.length) {
      const signups = await collect('signups', {
        status: 'signed',
        activityId: _.in(startedIds)
      })
      const absentKeys = contributions
        .filter((row) => row.absent)
        .map((row) => `${row.activityId}:${row.playerOpenid}`)
      attendanceRows = attendancesByPlayer(withHomeTeam(signups, homes), {
        startedIds,
        absentKeys,
        teamFilter
      })
    }
    return { totals, attendanceRows, span, teamId: teamFilter }
  }

  async function fetchCompact(openid, fetched, question) {
    const span = mirror.detectSpan(question)
    const teamId = mirror.detectTeamId(question)
    const board = mirror.detectBoard(question)
    const lines = []
    const slots = {}
    let next = null

    if (fetched.includes('next') || fetched.includes('weather')) {
      next = await loadNext(openid)
      const nextSlots = formatNextSlots(next)
      if (nextSlots) {
        Object.assign(slots, nextSlots)
        if (fetched.includes('next')) lines.push(nextSlots.line)
      }
    }

    if (fetched.includes('weather')) {
      if (!next) {
        slots.kickoffWeather = mirror.emptyAnswerFor('weather')
      } else {
        try {
          const weather = await fetchActivityWeather(next.startTime)
          const weatherLine = formatWeatherLine(weather, next.startTime)
          if (weatherLine) {
            slots.kickoffWeather = weatherLine
            lines.push(weatherLine)
          } else {
            slots.kickoffWeather = mirror.emptyAnswerFor('weather')
          }
        } catch (err) {
          slots.kickoffWeather = mirror.emptyAnswerFor('weather')
        }
      }
    }

    if (fetched.includes('stats') || fetched.includes('me-stats')) {
      const boards = await loadBoardTotals(span, teamId)
      if (fetched.includes('stats')) {
        const rows = board === 'attendances' ? boards.attendanceRows : boards.totals
        const field = board === 'attendances' ? 'attendances' : board === 'absences' ? 'absences' : board
        const packed = formatBoardLine(span, boards.teamId, board, rows)
        Object.assign(slots, packed)
        lines.push(packed.line)
        if (!topBy(rows, field).length) slots._statsEmpty = true
      }
      if (fetched.includes('me-stats')) {
        const packed = formatMeLine(span, boards.teamId, openid, boards.totals, boards.attendanceRows)
        Object.assign(slots, packed)
        lines.push(packed.line)
      }
    }

    return { lines, slots, next }
  }

  let mirrorLogsReady = false
  async function ensureMirrorLogs() {
    if (mirrorLogsReady) return
    try {
      await db.createCollection('mirror_logs')
    } catch (err) {
      // 已存在时忽略
    }
    mirrorLogsReady = true
  }

  async function countWeeklyAsks(openid, weekKey) {
    await ensureMirrorLogs()
    const res = await db.collection('mirror_logs').where({
      _openid: openid,
      weekKey,
      counted: true
    }).count()
    return res.total || 0
  }

  async function getQuota(openid, userMaybe) {
    const user = userMaybe || await findUser(openid)
    const weekKey = mirror.weekKeyShanghai()
    const used = await countWeeklyAsks(openid, weekKey)
    const weekLimit = mirror.weeklyAskLimit(user)
    return {
      weekKey,
      weekLimit,
      used,
      remaining: mirror.remainingAsks(used, weekLimit)
    }
  }

  async function writeLog(openid, row) {
    await ensureMirrorLogs()
    const added = await db.collection('mirror_logs').add({
      data: {
        _openid: openid,
        createdAt: Date.now(),
        dayKey: mirror.dayKeyShanghai(),
        weekKey: mirror.weekKeyShanghai(),
        useful: null,
        counted: true,
        ...row
      }
    })
    return added._id
  }

  async function callModel(question, user, previous, dataLines) {
    const cfg = deepseekConfig()
    if (!mirror.hasDeepseekKey(cfg.apiKey)) {
      return { answer: '魔镜暂未开通，稍后再试，或点上面的常用问题。', error: 'no_key', usedModel: false }
    }
    const manual = mirror.loadManualText()
    const system = mirror.buildSystemPrompt(manual)
    const userContent = mirror.buildUserPrompt({
      nowText: mirror.beijingNowText(),
      askerText: mirror.askerText(user, TEAMS),
      previousText: mirror.previousText(previous && previous.question, previous && previous.answer),
      dataLines,
      question
    })
    try {
      const res = await postChat(cfg.baseUrl, cfg.apiKey, {
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 160,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent }
        ]
      }, 12000)
      const answer = (((res || {}).choices || [])[0] || {}).message
      const text = answer && answer.content ? String(answer.content).trim() : ''
      if (!text) return { answer: '魔镜开小差了，稍后再试', error: 'empty', usedModel: true }
      return { answer: text.slice(0, 180), error: '', usedModel: true }
    } catch (err) {
      return {
        answer: '魔镜开小差了，稍后再试',
        error: err.message || 'model_error',
        usedModel: true
      }
    }
  }

  function withQuota(payload, quota) {
    return {
      ...payload,
      weekLimit: quota.weekLimit,
      used: quota.used,
      remaining: quota.remaining,
      quickQuestions: mirror.QUICK_QUESTIONS
    }
  }

  async function mirrorQuota(openid) {
    return getQuota(openid)
  }

  async function mirrorAsk(openid, event) {
    const question = String(event.question || '').trim().slice(0, mirror.MAX_QUESTION_LEN)
    if (!question) throw new Error('请输入问题')
    const faq = mirror.loadFaqData()
    const matched = mirror.matchFaq(question, faq)
    const previous = {
      question: String(event.prevQuestion || '').trim().slice(0, 100),
      answer: String(event.prevAnswer || '').trim().slice(0, 100)
    }
    const user = await findUser(openid)
    const quotaBefore = await getQuota(openid, user)
    if (quotaBefore.remaining <= 0) {
      return withQuota({
        answer: '本周问答次数用完了，下周再来，或先点常用问题旁看看说明。',
        hitId: '',
        usedModel: false,
        logId: '',
        error: 'rate_limited'
      }, quotaBefore)
    }

    if (matched.hit) {
      const item = matched.hit
      let answer = item.answer || ''
      let fetched = []
      if (item.kind === 'live' && item.live) {
        fetched = [item.live]
        const compact = await fetchCompact(openid, fetched, question)
        if (item.live === 'next' && !compact.next) {
          answer = item.emptyAnswer || mirror.emptyAnswerFor('next')
        } else if (item.live === 'weather' && (!compact.slots.kickoffWeather
          || compact.slots.kickoffWeather === mirror.emptyAnswerFor('weather'))) {
          answer = item.emptyAnswer || mirror.emptyAnswerFor('weather')
        } else if (item.live === 'stats' && compact.slots._statsEmpty) {
          answer = item.emptyAnswer || mirror.emptyAnswerFor('stats')
        } else {
          answer = mirror.fillTemplate(item.answerTemplate || '', compact.slots)
          if (!String(answer).trim()) answer = item.emptyAnswer || mirror.emptyAnswerFor(item.live)
        }
      }
      const logId = await writeLog(openid, {
        question,
        hitId: item.id,
        topScore: matched.topScore,
        secondScore: matched.secondScore,
        fetched,
        usedModel: false,
        answer,
        error: ''
      })
      const quota = await getQuota(openid)
      return withQuota({
        answer,
        hitId: item.id,
        usedModel: false,
        logId
      }, quota)
    }

    const fetched = mirror.detectFetched(question, null)
    const compact = await fetchCompact(openid, fetched, question)
    const model = await callModel(question, user, previous, compact.lines)
    const error = model.error || ''
    const logId = await writeLog(openid, {
      question,
      hitId: '',
      topScore: matched.topScore,
      secondScore: matched.secondScore,
      fetched,
      usedModel: model.usedModel,
      answer: model.answer,
      error,
      counted: mirror.countsTowardQuota(error)
    })
    const quota = await getQuota(openid)
    return withQuota({
      answer: model.answer,
      hitId: '',
      usedModel: model.usedModel,
      logId
    }, quota)
  }

  async function mirrorFeedback(openid, event) {
    const logId = String(event.logId || '').trim()
    const useful = event.useful === true || event.useful === false ? event.useful : null
    if (useful == null) throw new Error('请选择有用或没用')
    if (logId) {
      const doc = await db.collection('mirror_logs').doc(logId).get().catch(() => null)
      if (doc && doc.data && doc.data._openid === openid) {
        await db.collection('mirror_logs').doc(logId).update({ data: { useful } })
        return { useful }
      }
    }
    // 无 logId 时按最近一条本用户日志回写
    const latest = await db.collection('mirror_logs')
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
    if (!latest.data[0]) throw new Error('找不到这条回答')
    await db.collection('mirror_logs').doc(latest.data[0]._id).update({ data: { useful } })
    return { useful }
  }

  return { mirrorAsk, mirrorFeedback, mirrorQuota, loadBoardTotals }
}

module.exports = {
  createMirrorAsk,
  formatNextSlots,
  formatWeatherLine,
  formatBoardLine,
  formatMeLine
}
