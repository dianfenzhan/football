/**
 * 检查模拟器的 api 调用是否打到本地云函数（云函数本地调试）。
 * 只读：不调用 cli open / cli auto，也不点界面。cli open/auto 会让项目进入精简窗口，
 * 并关掉已打开的「云函数本地调试」窗口，请求随之回到云端。
 */
const { spawnSync } = require('child_process')

const AUTO_PORT = Number(process.env.AUTO_PORT || 9421)

const STEPS = `
开启本地 api 的步骤（只在开发者工具里手动做）：
  1. 从开发者工具「项目列表」打开 codeBase（不要用 cli open）
  2. 资源管理器右键 cloudfunctions/api → 开启云函数本地调试
  3. 「云函数本地调试」窗口保持打开，关掉就会回到云端
  4. 主窗口点「普通编译」：不再弹「未走本地云函数」即为成功
`

function workerAlive() {
  const res = spawnSync('ps', ['aux'], { encoding: 'utf8' })
  return /cloud-functions-debugger-server\/worker\/node\.js/.test(res.stdout || '')
}

function autoPortOpen() {
  const res = spawnSync('lsof', ['-nP', `-iTCP:${AUTO_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  return /LISTEN/.test(res.stdout || '')
}

async function probe() {
  const automator = require('miniprogram-automator')
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` })
  try {
    return await mp.evaluate(async () => {
      const res = await wx.cloud.callFunction({ name: 'api', data: { action: 'devEcho' } })
      return res.result || {}
    })
  } finally {
    try { await mp.disconnect() } catch (e) { /* ignore */ }
  }
}

async function main() {
  if (!workerAlive()) {
    console.log('本地调试未运行。' + STEPS)
    process.exitCode = 2
    return
  }
  console.log('本地调试 worker 在运行')
  if (!autoPortOpen()) {
    console.log(`自动化端口 ${AUTO_PORT} 未开，跳过 devEcho 探测；以模拟器是否弹「未走本地云函数」为准。`)
    return
  }
  const result = await probe()
  if (result && result.ok && result.marker === 'devEcho-v1') {
    console.log('PASS：api 走本地')
    return
  }
  console.log('FAIL：api 仍走云端', JSON.stringify(result), STEPS)
  process.exitCode = 2
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
