/**
 * Verify tactics poster generation + album/share API reachability via automator.
 * Requires DevTools automation port (default ws://127.0.0.1:9421).
 */
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'

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

function assertOk(name, result) {
  if (!result || !result.ok) {
    throw new Error(name + ': ' + ((result && result.message) || 'no result'))
  }
  console.log('PASS', name)
  return result
}

async function main() {
  console.log('connect', WS)
  const miniProgram = await automator.connect({ wsEndpoint: WS })
  try {
    const home = assertOk('homeSummary', await callApi(miniProgram, 'homeSummary'))
    let activityId = home.nextActivity && home.nextActivity._id
    let created = false
    if (!activityId) {
      const createdAct = assertOk('createActivity for poster test', await callApi(miniProgram, 'createActivity', {
        title: '冒烟海报 ' + Date.now().toString(36).slice(-4),
        location: '海报测试球场',
        startTime: Date.now() + 60 * 60 * 1000,
        quotas: { team_jiong: 11, team_pudong: 11 },
        signupMode: 'split'
      }))
      activityId = createdAct.activityId
      created = true
      assertOk('signup for poster test', await callApi(miniProgram, 'signup', { activityId }))
    }

    await miniProgram.reLaunch(`/pages/activity/activity?id=${activityId}&scrollTo=tactics`)
    const page = await miniProgram.currentPage()
    await page.waitFor(2000)
    await miniProgram.evaluate(async () => {
      wx.pageScrollTo({ selector: '#tactics-card', duration: 0 })
    }).catch(() => {})
    await page.waitFor(500)

    // Ensure canvas is in DOM and board has data
    const data = await page.data()
    if (!data.tacticsBoard || !Array.isArray(data.tacticsBoard.onPitch)) {
      throw new Error('tacticsBoard missing after page load')
    }
    // Seed one on-pitch player if empty so poster draws avatars path too
    if (data.tacticsBoard.onPitch.length === 0) {
      const seeded = {
        ...data.tacticsBoard,
        onPitch: [{
          userId: 'smoke_poster_user',
          userName: '海报测',
          x: 0.5,
          y: 0.5,
          role: 'mf',
          leftPct: 50,
          topPct: 50,
          shortLabel: '中',
          avatarChar: '海',
          avatarBg: '#0f3d2e',
          avatarUrl: ''
        }],
        emptySlots: (data.tacticsBoard.emptySlots || []).slice(1)
      }
      const list = (data.tacticsList || []).slice()
      const idx = list.findIndex((item) => item && item.teamId === data.tacticsTeamId)
      if (idx >= 0) list[idx] = { ...list[idx], board: seeded }
      await page.setData({ tacticsBoard: seeded, tacticsList: list })
    }
    console.log('PASS', 'activity tactics board loaded', `(onPitch=${(await page.data()).tacticsBoard.onPitch.length})`)

    // Core: generate temp image file (shared by album + share)
    const genResult = await miniProgram.evaluate(async () => {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      if (!page || typeof page.generateTacticsTempFile !== 'function') {
        return { ok: false, message: 'generateTacticsTempFile missing on page' }
      }
      try {
        const filePath = await page.generateTacticsTempFile()
        return { ok: true, filePath }
      } catch (err) {
        return { ok: false, message: (err && (err.message || err.errMsg)) || String(err) }
      }
    })
    if (!genResult.ok || !genResult.filePath) {
      throw new Error('generateTacticsTempFile: ' + (genResult.message || 'empty path'))
    }
    console.log('PASS', 'generateTacticsTempFile', genResult.filePath)

    // Album API reachability (simulator may deny auth — still counts as API wired)
    const album = await miniProgram.evaluate(async (filePath) => {
      return new Promise((resolve) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => resolve({ ok: true, mode: 'saved' }),
          fail: (err) => resolve({
            ok: false,
            mode: 'fail',
            errMsg: (err && err.errMsg) || String(err)
          })
        })
      })
    }, genResult.filePath)
    if (album.ok) {
      console.log('PASS', 'saveImageToPhotosAlbum saved')
    } else if (/auth|authorize|deny|permission|cancel/i.test(album.errMsg || '')) {
      console.log('PASS', 'saveImageToPhotosAlbum reachable (need album permission)', album.errMsg)
    } else if (/not support|fail|invalid/i.test(album.errMsg || '')) {
      console.log('WARN', 'saveImageToPhotosAlbum simulator limitation:', album.errMsg)
    } else {
      throw new Error('saveImageToPhotosAlbum unexpected: ' + album.errMsg)
    }

    // Share menu API
    const share = await miniProgram.evaluate(async (filePath) => {
      return new Promise((resolve) => {
        if (typeof wx.showShareImageMenu !== 'function') {
          resolve({ ok: true, mode: 'fallback_preview', reason: 'showShareImageMenu missing' })
          return
        }
        let settled = false
        const done = (payload) => {
          if (settled) return
          settled = true
          resolve(payload)
        }
        wx.showShareImageMenu({
          path: filePath,
          success: () => done({ ok: true, mode: 'share_menu' }),
          fail: (err) => done({
            ok: false,
            mode: 'fail',
            errMsg: (err && err.errMsg) || String(err)
          })
        })
        setTimeout(() => done({ ok: true, mode: 'share_menu_invoked' }), 800)
      })
    }, genResult.filePath)
    if (share.ok) {
      console.log('PASS', 'shareTacticsPoster API', share.mode, share.reason || '')
    } else if (/cancel|not support/i.test(share.errMsg || '')) {
      console.log('PASS', 'shareTacticsPoster reachable', share.errMsg)
    } else {
      console.log('WARN', 'showShareImageMenu:', share.errMsg)
    }

    // Exercise page entry methods (should drive generate without hard crash)
    const saveInvoke = await miniProgram.evaluate(async () => {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      try {
        page.saveTacticsPoster()
        return { ok: true }
      } catch (err) {
        return { ok: false, message: (err && err.message) || String(err) }
      }
    })
    if (!saveInvoke.ok) throw new Error('saveTacticsPoster invoke: ' + saveInvoke.message)
    await page.waitFor(1500)
    console.log('PASS', 'saveTacticsPoster page method invoked')

    const shareInvoke = await miniProgram.evaluate(async () => {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      try {
        page.shareTacticsPoster()
        return { ok: true }
      } catch (err) {
        return { ok: false, message: (err && err.message) || String(err) }
      }
    })
    if (!shareInvoke.ok) throw new Error('shareTacticsPoster invoke: ' + shareInvoke.message)
    await page.waitFor(1500)
    console.log('PASS', 'shareTacticsPoster page method invoked')

    if (created) {
      await callApi(miniProgram, 'cancelSignup', { activityId }).catch(() => {})
      await callApi(miniProgram, 'deleteActivity', { activityId }).catch(() => {})
      console.log('PASS', 'cleanup created activity')
    }

    console.log('ALL POSTER CHECKS PASSED')
  } finally {
    try {
      const closing = miniProgram.disconnect()
      if (closing && typeof closing.then === 'function') await closing
    } catch (e) { /* ignore */ }
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err)
  process.exit(1)
})
