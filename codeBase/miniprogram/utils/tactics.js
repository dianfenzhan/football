const { avatarChar, avatarColor } = require('./api')

const PREFERRED_POSITIONS = [
  { id: 'fw', label: '前锋', shortLabel: '前锋' },
  { id: 'mf', label: '中场', shortLabel: '中场' },
  { id: 'df', label: '后卫', shortLabel: '后卫' },
  { id: 'gk', label: '门将', shortLabel: '门将' }
]

const POSITION_LABEL_MAP = {
  fw: '前锋',
  mf: '中场',
  df: '后卫',
  gk: '门将'
}

const TACTICS_SLOTS = [
  { index: 0, role: 'fw', label: '左前锋', shortLabel: '前锋', x: 0.32, y: 0.17 },
  { index: 1, role: 'fw', label: '右前锋', shortLabel: '前锋', x: 0.68, y: 0.17 },
  { index: 2, role: 'mf', label: '左中场', shortLabel: '中场', x: 0.32, y: 0.41 },
  { index: 3, role: 'mf', label: '右中场', shortLabel: '中场', x: 0.68, y: 0.41 },
  { index: 4, role: 'df', label: '左后卫', shortLabel: '后卫', x: 0.20, y: 0.65 },
  { index: 5, role: 'df', label: '中后卫', shortLabel: '后卫', x: 0.50, y: 0.65 },
  { index: 6, role: 'df', label: '右后卫', shortLabel: '后卫', x: 0.80, y: 0.65 },
  { index: 7, role: 'gk', label: '门将', shortLabel: '门将', x: 0.50, y: 0.87 }
]

const LINE_GROUPS = [
  [0, 1],
  [2, 3],
  [4, 5, 6],
  [7]
]

const MAX_ON_PITCH = 8
const SLOT_OCCUPIED_RADIUS = 0.14
const PLAYER_HIT_RADIUS = 0.13

function positionLabel(pos) {
  return POSITION_LABEL_MAP[pos] || '中场'
}

function normalizeRole(pos) {
  return POSITION_LABEL_MAP[pos] ? pos : 'mf'
}

function clampCoord(val, min = 0.08, max = 0.92) {
  const num = Number(val)
  if (!Number.isFinite(num)) return 0.5
  return Math.max(min, Math.min(max, Number(num.toFixed(4))))
}

function distance2D(x1, y1, x2, y2) {
  const dx = Number(x1) - Number(x2)
  const dy = Number(y1) - Number(y2)
  return Math.sqrt(dx * dx + dy * dy)
}

function normalizePlayer(raw, orderIndex = 0) {
  if (!raw) return null
  const userName = raw.userName || raw.name || '队员'
  const userId = String(raw.userId || raw._id || raw._openid || `player_${orderIndex}`)
  const preferredPosition = normalizeRole(raw.preferredPosition || raw.role)
  return {
    userId,
    _id: raw._id || userId,
    _openid: raw._openid || userId,
    userName,
    name: userName,
    avatarUrl: raw.avatarUrl || '',
    avatarChar: raw.avatarChar || avatarChar(userName),
    avatarBg: raw.avatarBg || avatarColor(userName),
    teamId: raw.teamId || '',
    preferredPosition,
    positionLabel: positionLabel(preferredPosition),
    attendances: Number(raw.attendances) || 0,
    createdAt: Number(raw.createdAt) || 0,
    signupOrder: orderIndex + 1
  }
}

function sortByAttendanceTop(players) {
  return (players || [])
    .map((item, idx) => ({ player: normalizePlayer(item, idx), idx }))
    .filter((entry) => !!entry.player)
    .sort((a, b) => {
      if (b.player.attendances !== a.player.attendances) {
        return b.player.attendances - a.player.attendances
      }
      if (a.player.createdAt !== b.player.createdAt) {
        return a.player.createdAt - b.player.createdAt
      }
      return a.idx - b.idx
    })
    .map((entry) => entry.player)
}

function nearestSlotRole(x, y, fallbackRole = 'mf') {
  let best = TACTICS_SLOTS[0]
  let bestDist = Infinity
  for (const slot of TACTICS_SLOTS) {
    const d = distance2D(x, y, slot.x, slot.y)
    if (d < bestDist) {
      bestDist = d
      best = slot
    }
  }
  return best ? best.role : normalizeRole(fallbackRole)
}

function computeEmptySlots(onPitch, emptyText = '待报名') {
  const list = onPitch || []
  if (list.length >= MAX_ON_PITCH) return []
  return TACTICS_SLOTS.filter((slot) => {
    const occupied = list.some((p) => distance2D(p.x, p.y, slot.x, slot.y) < SLOT_OCCUPIED_RADIUS)
    return !occupied
  }).map((slot) => ({
    ...slot,
    emptyText
  }))
}

function decorateOnPitchItem(player, x, y, role) {
  const norm = normalizePlayer(player)
  const finalX = clampCoord(x)
  const finalY = clampCoord(y)
  const finalRole = normalizeRole(role || norm.preferredPosition || nearestSlotRole(finalX, finalY))
  return {
    ...norm,
    x: finalX,
    y: finalY,
    leftPct: Number((finalX * 100).toFixed(2)),
    topPct: Number((finalY * 100).toFixed(2)),
    role: finalRole,
    shortLabel: positionLabel(finalRole)
  }
}

function buildStateFromPitchAndPool(onPitchRaw, allPoolRaw, options = {}) {
  const emptyText = options.emptyText || '待报名'
  const pool = (allPoolRaw || []).map((p, i) => normalizePlayer(p, i)).filter(Boolean)
  const poolById = {}
  for (const p of pool) {
    poolById[p.userId] = p
  }

  const seen = new Set()
  const onPitch = []
  for (const item of onPitchRaw || []) {
    if (!item || onPitch.length >= MAX_ON_PITCH) break
    const p = item.player ? normalizePlayer(item.player) : normalizePlayer(item)
    const uid = String(item.userId || (p && p.userId) || '')
    if (!uid || seen.has(uid)) continue
    const base = poolById[uid] || p
    if (!base) continue
    seen.add(uid)
    onPitch.push(decorateOnPitchItem(base, item.x, item.y, item.role || base.preferredPosition))
  }

  const bench = []
  for (const p of pool) {
    if (!seen.has(p.userId)) {
      bench.push(p)
    }
  }

  const emptySlots = computeEmptySlots(onPitch, emptyText)
  const slots = TACTICS_SLOTS.map((slot, idx) => ({
    ...slot,
    player: onPitch[idx] || null
  }))
  const lines = LINE_GROUPS.map((indices) => indices.map((i) => slots[i]))

  return {
    onPitch,
    bench,
    emptySlots,
    onPitchCount: onPitch.length,
    slots,
    lines,
    items: onPitch.map((p) => p).concat(bench)
  }
}

function assign322ByPosition(starters, randomFn = Math.random) {
  const list = (starters || []).slice(0, MAX_ON_PITCH).map((p, i) => normalizePlayer(p, i)).filter(Boolean)
  const assignedBySlot = new Array(TACTICS_SLOTS.length).fill(null)
  const buckets = { fw: [], mf: [], df: [], gk: [] }
  for (const p of list) {
    const role = normalizeRole(p.preferredPosition)
    buckets[role].push(p)
  }
  const overflow = []
  const roleSlots = {
    fw: [0, 1],
    mf: [2, 3],
    df: [4, 5, 6],
    gk: [7]
  }
  for (const role of ['fw', 'mf', 'df', 'gk']) {
    const indices = roleSlots[role]
    const candidates = buckets[role]
    for (let i = 0; i < candidates.length; i += 1) {
      if (i < indices.length) {
        assignedBySlot[indices[i]] = candidates[i]
      } else {
        overflow.push(candidates[i])
      }
    }
  }
  const emptyIndices = []
  for (let i = 0; i < TACTICS_SLOTS.length; i += 1) {
    if (!assignedBySlot[i]) emptyIndices.push(i)
  }
  for (const player of overflow) {
    if (!emptyIndices.length) break
    const pickIdx = Math.max(0, Math.min(emptyIndices.length - 1, Math.floor(randomFn() * emptyIndices.length)))
    const slotIndex = emptyIndices.splice(pickIdx, 1)[0]
    assignedBySlot[slotIndex] = player
  }
  const onPitch = []
  for (let i = 0; i < TACTICS_SLOTS.length; i += 1) {
    const player = assignedBySlot[i]
    if (!player) continue
    const slot = TACTICS_SLOTS[i]
    onPitch.push(decorateOnPitchItem(player, slot.x, slot.y, slot.role))
  }
  return onPitch
}

function buildDefaultTacticsState(players, options = {}) {
  const randomFn = options.randomFn || Math.random
  const emptyText = options.emptyText || '待报名'
  const sorted = sortByAttendanceTop(players)
  const starters = sorted.slice(0, MAX_ON_PITCH)
  const onPitch = assign322ByPosition(starters, randomFn)
  return buildStateFromPitchAndPool(onPitch, sorted, { emptyText })
}

function reconcileSavedBoard(savedSlots, currentPool, options = {}) {
  const emptyText = options.emptyText || '待报名'
  const pool = sortByAttendanceTop(currentPool)
  const poolById = {}
  for (const p of pool) {
    poolById[p.userId] = p
  }
  const kept = []
  let removedCount = 0
  for (const slot of savedSlots || []) {
    const uid = String((slot && (slot.userId || slot._id || slot._openid)) || '')
    if (!uid) continue
    if (poolById[uid]) {
      kept.push({
        ...poolById[uid],
        x: slot.x,
        y: slot.y,
        role: slot.role || poolById[uid].preferredPosition
      })
    } else {
      removedCount += 1
    }
  }
  const state = buildStateFromPitchAndPool(kept, pool, { emptyText })
  return {
    ...state,
    removedAbsentCount: removedCount,
    removedNotice: removedCount > 0 ? '已不在本场正选的人已从板上拿下' : ''
  }
}

function findHitPitchPlayer(onPitch, targetX, targetY, excludeUserId = '') {
  let best = null
  let bestDist = PLAYER_HIT_RADIUS
  for (const item of onPitch || []) {
    if (!item || item.userId === excludeUserId) continue
    const d = distance2D(item.x, item.y, targetX, targetY)
    if (d <= bestDist) {
      bestDist = d
      best = item
    }
  }
  return best
}

function applyPitchDrag(state, allPool, payload, options = {}) {
  const emptyText = options.emptyText || '待报名'
  const currentOnPitch = (state && state.onPitch) ? state.onPitch.slice() : []
  const source = payload && payload.source
  const userId = String((payload && payload.userId) || '')
  const dropZone = (payload && payload.dropZone) || 'pitch'
  const x = clampCoord(payload && payload.x)
  const y = clampCoord(payload && payload.y)

  if (!userId) {
    return { state, toast: '' }
  }

  if (source === 'pitch') {
    const idx = currentOnPitch.findIndex((p) => p.userId === userId)
    if (idx === -1) return { state, toast: '' }
    const moving = currentOnPitch[idx]

    if (dropZone === 'bench') {
      currentOnPitch.splice(idx, 1)
      return {
        state: buildStateFromPitchAndPool(currentOnPitch, allPool, { emptyText }),
        toast: ''
      }
    }

    const hit = findHitPitchPlayer(currentOnPitch, x, y, userId)
    if (hit) {
      const hitIdx = currentOnPitch.findIndex((p) => p.userId === hit.userId)
      const oldX = moving.x
      const oldY = moving.y
      const oldRole = moving.role
      currentOnPitch[idx] = decorateOnPitchItem(moving, hit.x, hit.y, hit.role)
      currentOnPitch[hitIdx] = decorateOnPitchItem(hit, oldX, oldY, oldRole)
    } else {
      currentOnPitch[idx] = decorateOnPitchItem(moving, x, y, nearestSlotRole(x, y, moving.preferredPosition))
    }
    return {
      state: buildStateFromPitchAndPool(currentOnPitch, allPool, { emptyText }),
      toast: ''
    }
  }

  if (source === 'bench') {
    if (dropZone !== 'pitch') {
      return { state, toast: '' }
    }
    const pool = sortByAttendanceTop(allPool)
    const benchPlayer = pool.find((p) => p.userId === userId)
    if (!benchPlayer) return { state, toast: '' }

    const hit = findHitPitchPlayer(currentOnPitch, x, y, userId)
    if (currentOnPitch.length >= MAX_ON_PITCH) {
      if (!hit) {
        return {
          state,
          toast: '场上已满，先把一个人拖到轮换'
        }
      }
      const hitIdx = currentOnPitch.findIndex((p) => p.userId === hit.userId)
      currentOnPitch[hitIdx] = decorateOnPitchItem(benchPlayer, hit.x, hit.y, hit.role || benchPlayer.preferredPosition)
      return {
        state: buildStateFromPitchAndPool(currentOnPitch, pool, { emptyText }),
        toast: ''
      }
    }

    if (hit) {
      const hitIdx = currentOnPitch.findIndex((p) => p.userId === hit.userId)
      currentOnPitch[hitIdx] = decorateOnPitchItem(benchPlayer, hit.x, hit.y, hit.role || benchPlayer.preferredPosition)
    } else {
      currentOnPitch.push(decorateOnPitchItem(benchPlayer, x, y, nearestSlotRole(x, y, benchPlayer.preferredPosition)))
    }
    return {
      state: buildStateFromPitchAndPool(currentOnPitch, pool, { emptyText }),
      toast: ''
    }
  }

  return { state, toast: '' }
}

function filterBenchPlayers(bench, keyword) {
  const list = bench || []
  const q = String(keyword || '').trim().toLowerCase()
  if (!q) return list
  return list.filter((p) => String(p.userName || p.name || '').toLowerCase().indexOf(q) !== -1)
}

function teamSignupsInOrder(signups, teamId) {
  return (signups || [])
    .filter((item) => item && item.teamId === teamId && (!item.status || item.status === 'signed'))
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const aa = Number(b.item.attendances) - Number(a.item.attendances)
      if (aa !== 0 && !Number.isNaN(aa)) return aa
      const ta = Number(a.item.createdAt) || 0
      const tb = Number(b.item.createdAt) || 0
      if (ta !== tb) return ta - tb
      return a.idx - b.idx
    })
    .map((entry, orderIndex) => normalizePlayer(entry.item, orderIndex))
}

function buildTacticsBoard(signups, teamId, options = {}) {
  const filtered = (signups || []).filter(
    (item) => item && (!teamId || item.teamId === teamId) && (!item.status || item.status === 'signed')
  )
  return buildDefaultTacticsState(filtered, options)
}

function hydrateBoardFromItems(rawItems) {
  return buildDefaultTacticsState((rawItems || []).filter(Boolean))
}

function swapTacticsItems(rawItems, indexA, indexB) {
  const next = Array.isArray(rawItems) ? rawItems.slice() : []
  const a = Number(indexA)
  const b = Number(indexB)
  if (Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < next.length && b < next.length) {
    const tmp = next[a]
    next[a] = next[b]
    next[b] = tmp
  }
  return buildDefaultTacticsState(next.filter(Boolean))
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function truncateText(text, maxChars) {
  const str = String(text || '')
  if (str.length <= maxChars) return str
  return `${str.slice(0, maxChars - 1)}…`
}

function resolveLocalImagePath(url) {
  return new Promise((resolve) => {
    if (!url || typeof wx === 'undefined' || !wx.getImageInfo) {
      resolve('')
      return
    }
    let settled = false
    const done = (path) => {
      if (settled) return
      settled = true
      resolve(path || '')
    }
    const timer = setTimeout(() => done(''), 2500)
    wx.getImageInfo({
      src: url,
      success: (res) => {
        clearTimeout(timer)
        done(res && res.path ? res.path : url)
      },
      fail: () => {
        clearTimeout(timer)
        done('')
      }
    })
  })
}

function loadCanvasImage(canvas, url) {
  return resolveLocalImagePath(url).then((src) => new Promise((resolve) => {
    if (!src || !canvas || !canvas.createImage) {
      resolve(null)
      return
    }
    let settled = false
    const done = (img) => {
      if (settled) return
      settled = true
      resolve(img)
    }
    const timer = setTimeout(() => done(null), 2500)
    const img = canvas.createImage()
    img.onload = () => {
      clearTimeout(timer)
      done(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      done(null)
    }
    img.src = src
  }))
}

async function renderTacticsPoster(canvas, payload) {
  const {
    activity = null,
    teamName = '',
    boardTitle = '',
    board = {}
  } = payload || {}
  const onPitch = Array.isArray(board.onPitch) ? board.onPitch : []
  const emptySlots = Array.isArray(board.emptySlots) ? board.emptySlots : []
  const benchPlayers = Array.isArray(board.bench)
    ? board.bench.map((item) => (item && item.player ? item.player : item)).filter(Boolean)
    : []
  const hasActivity = !!(activity && (activity.title || activity.timeText || activity.location))
  const W = 375
  const headerBottomY = hasActivity ? 94 : 68
  const ph = 382
  const benchHeight = benchPlayers.length > 0 ? 56 : 0
  const H = headerBottomY + ph + benchHeight + 48
  const dpr = 2

  canvas.width = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.scale(dpr, dpr)

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H)
  bgGrad.addColorStop(0, '#0c3125')
  bgGrad.addColorStop(1, '#144936')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 20px sans-serif'
  ctx.textBaseline = 'top'
  const headerTitle = boardTitle
    ? `${truncateText(teamName || '球队', 8)} · ${truncateText(boardTitle, 10)}`
    : truncateText(teamName || '球队战术板', 14)
  ctx.fillText(headerTitle, 20, 20)

  const badgeW = 98
  const badgeH = 24
  const badgeX = W - 20 - badgeW
  const badgeY = 20
  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 12)
  ctx.fillStyle = '#f2c14e'
  ctx.fill()
  ctx.fillStyle = '#0f3d2e'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('8人制', badgeX + badgeW / 2, badgeY + badgeH / 2)

  if (hasActivity) {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#d7e6df'
    ctx.font = '12px sans-serif'
    const metaTitle = truncateText(activity.title || '周三养生球', 14)
    const metaTime = activity.timeText || ''
    ctx.fillText(`${metaTitle}${metaTime ? ' · ' + metaTime : ''}`, 20, 48)
    if (activity.location) {
      ctx.fillStyle = '#9fc2b2'
      ctx.font = '11px sans-serif'
      ctx.fillText(`📍 ${truncateText(activity.location, 24)}`, 20, 68)
    }
  }

  const px = 20
  const py = headerBottomY
  const pw = W - 40

  ctx.save()
  roundRectPath(ctx, px, py, pw, ph, 16)
  ctx.clip()

  const stripeCount = 8
  const stripeH = ph / stripeCount
  for (let i = 0; i < stripeCount; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? '#1f7050' : '#196145'
    ctx.fillRect(px, py + i * stripeH, pw, stripeH + 1)
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)'
  ctx.lineWidth = 1.5
  const pad = 12
  const ix = px + pad
  const iy = py + pad
  const iw = pw - pad * 2
  const ih = ph - pad * 2
  ctx.strokeRect(ix, iy, iw, ih)

  const midY = iy + ih * 0.5
  ctx.beginPath()
  ctx.moveTo(ix, midY)
  ctx.lineTo(ix + iw, midY)
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(ix + iw / 2, midY, 32, 0, Math.PI * 2)
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(ix + iw / 2, midY, 2.5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.fill()

  const boxW = 148
  const boxH = 46
  ctx.strokeRect(ix + (iw - boxW) / 2, iy, boxW, boxH)
  ctx.strokeRect(ix + (iw - boxW) / 2, iy + ih - boxH, boxW, boxH)

  const goalW = 72
  const goalH = 18
  ctx.strokeRect(ix + (iw - goalW) / 2, iy, goalW, goalH)
  ctx.strokeRect(ix + (iw - goalW) / 2, iy + ih - goalH, goalW, goalH)
  ctx.restore()

  const R = 21
  for (let i = 0; i < emptySlots.length; i += 1) {
    const slot = emptySlots[i]
    const cx = px + slot.x * pw
    const cy = py + slot.y * ph
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(12, 49, 37, 0.42)'
    ctx.fill()
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.stroke()
    ctx.restore()

    if (slot.role === 'gk') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(slot.shortLabel || '门将', cx, cy)
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(slot.emptyText || '待报名', cx, cy + R + 12)
  }

  const avatarImages = await Promise.all(
    onPitch.map((player) => (player && player.avatarUrl
      ? loadCanvasImage(canvas, player.avatarUrl)
      : Promise.resolve(null)))
  )

  for (let i = 0; i < onPitch.length; i += 1) {
    const player = onPitch[i]
    const cx = px + player.x * pw
    const cy = py + player.y * ph
    const isGk = player.role === 'gk'

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy + 2, R + 1, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
    ctx.fill()
    ctx.restore()

    const img = avatarImages[i]
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    if (img) {
      ctx.drawImage(img, cx - R, cy - R, R * 2, R * 2)
    } else {
      ctx.fillStyle = player.avatarBg || '#0f3d2e'
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 15px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(player.avatarChar || avatarChar(player.userName), cx, cy)
    }
    ctx.restore()

    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.lineWidth = 2.2
    ctx.strokeStyle = isGk ? '#f2c14e' : '#ffffff'
    ctx.stroke()

    if (isGk) {
      const tagText = player.shortLabel || '门将'
      const tagW = 30
      const tagH = 14
      const tagX = cx + R - 18
      const tagY = cy - R - 4
      roundRectPath(ctx, tagX, tagY, tagW, tagH, 7)
      ctx.fillStyle = '#f2c14e'
      ctx.fill()
      ctx.fillStyle = '#0f3d2e'
      ctx.font = 'bold 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(tagText, tagX + tagW / 2, tagY + tagH / 2)
    }

    const nameStr = truncateText(player.userName, 6)
    ctx.font = 'bold 11px sans-serif'
    const textWidth = Math.max(38, Math.min(76, ctx.measureText(nameStr).width + 14))
    const pillH = 18
    const pillX = cx - textWidth / 2
    const pillY = cy + R + 4
    roundRectPath(ctx, pillX, pillY, textWidth, pillH, 9)
    ctx.fillStyle = 'rgba(10, 38, 28, 0.82)'
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(nameStr, cx, pillY + pillH / 2)
  }

  if (benchPlayers.length > 0) {
    const bx = 20
    const by = py + ph + 10
    const bw = W - 40
    const bh = 48
    roundRectPath(ctx, bx, by, bw, bh, 12)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.fill()

    ctx.fillStyle = '#f2c14e'
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`轮换（${benchPlayers.length}人）`, bx + 12, by + 9)

    const names = benchPlayers.map((p) => p.userName || p.name).join('、')
    ctx.fillStyle = '#e4f3eb'
    ctx.font = '11px sans-serif'
    ctx.fillText(truncateText(names, 26), bx + 12, by + 27)
  }

  ctx.fillStyle = 'rgba(183, 215, 200, 0.75)'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('周三快乐足球联队 · 8人制战术板', W / 2, H - 18)

  ctx.restore()
  return { width: W * dpr, height: H * dpr }
}

module.exports = {
  PREFERRED_POSITIONS,
  POSITION_LABEL_MAP,
  TACTICS_SLOTS,
  LINE_GROUPS,
  MAX_ON_PITCH,
  SLOT_OCCUPIED_RADIUS,
  PLAYER_HIT_RADIUS,
  positionLabel,
  normalizeRole,
  clampCoord,
  normalizePlayer,
  sortByAttendanceTop,
  assign322ByPosition,
  computeEmptySlots,
  buildStateFromPitchAndPool,
  buildDefaultTacticsState,
  reconcileSavedBoard,
  applyPitchDrag,
  filterBenchPlayers,
  teamSignupsInOrder,
  buildTacticsBoard,
  swapTacticsItems,
  hydrateBoardFromItems,
  renderTacticsPoster
}
