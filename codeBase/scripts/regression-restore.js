/**
 * 回归测试兜底恢复：脚本被 kill 导致身份没还原时使用。
 * 从 scripts/.regression-snapshot.json 读快照，恢复自己的 users 记录并清掉假队员。
 *
 * 用法：npm run regression:restore
 */
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const SNAPSHOT_PATH = path.resolve(__dirname, '.regression-snapshot.json')
const SECRETS_PATH = path.resolve(__dirname, '../../doc/project/secrets.local.json')

async function main() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.log('没有快照文件，无需恢复')
    return
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'))
  const key = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')).regressionKey || ''
  if (!key) throw new Error('doc/project/secrets.local.json 缺少 regressionKey')

  console.log('connect', WS)
  const miniProgram = await automator.connect({ wsEndpoint: WS })
  try {
    const call = (data) => miniProgram.evaluate(async (data) => {
      const res = await wx.cloud.callFunction({ name: 'api', data })
      return res.result
    }, data)

    const restored = await call({ action: 'testSetup', op: 'restore', key, record: snapshot })
    if (!restored || !restored.ok) throw new Error('restore: ' + ((restored && restored.message) || 'no result'))
    await call({ action: 'testSetup', op: 'removeFake', key }).catch(() => {})

    const me = await call({ action: 'me' })
    if (!me || !me.ok || !me.user) throw new Error('恢复后 me 校验失败')
    console.log('已恢复：', me.user.name, 'isAdmin=' + !!me.user.isAdmin, 'canGrantAdmin=' + !!me.user.canGrantAdmin)
    fs.unlinkSync(SNAPSHOT_PATH)
    console.log('快照已删除')
  } finally {
    miniProgram.disconnect()
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err)
  process.exit(1)
})
