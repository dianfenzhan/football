/**
 * 从指定 profile 的云环境只读导出数据库到本地 JSON。
 *
 * 默认读正式库（profiles/prod.local.json），不覆盖业务云函数 api，
 * 只临时上传/调用 dbDump。
 *
 * 用法：
 *   node scripts/db-dump.js              # 正式 → doc/project/db-dumps/prod/
 *   node scripts/db-dump.js --profile=test
 *
 * 需要开发者工具自动化端口 9421（与 smoke 相同）。
 */

const path = require('path')
const fs = require('fs')
const ci = require('miniprogram-ci')
const automator = require('miniprogram-automator')

const repoRoot = path.resolve(__dirname, '../..')
const projectPath = path.resolve(__dirname, '..')
const PROD_APP_ID = 'wxb8021a7ae0c71bd0'
const COLLECTIONS = [
  'teams',
  'users',
  'activities',
  'quotas',
  'signups',
  'rounds',
  'contributions',
  'tactics_boards',
  'goal_events',
  'meta',
  'clubs'
]

function arg(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((item) => item.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

function loadProfile(profile) {
  const file = path.join(repoRoot, 'doc/project/profiles', `${profile}.local.json`)
  if (!fs.existsSync(file)) throw new Error(`缺少 ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function privateKeyPath(secrets) {
  return path.resolve(repoRoot, 'doc/project', path.basename(String(secrets.privateKeyPath)))
}

async function uploadDbDump(secrets) {
  const appid = secrets.appId
  const envId = secrets.envId
  const key = privateKeyPath(secrets)
  if (!fs.existsSync(key)) throw new Error(`缺少上传密钥 ${key}`)

  console.log('临时上传只读云函数 dbDump →', appid, envId)
  if (appid === PROD_APP_ID) {
    console.log('（正式环境：只传 dbDump，不覆盖 api）')
  }

  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath,
    privateKeyPath: key,
    ignores: ['node_modules/**/*', 'scripts/**/*']
  })

  const result = await ci.cloud.uploadFunction({
    project,
    env: envId,
    path: path.join(projectPath, 'cloudfunctions/dbDump'),
    name: 'dbDump',
    remoteNpmInstall: true
  })
  console.log('dbDump 已上传', result)
}

function decodeDumpList(result) {
  if (result && typeof result.listBase64 === 'string') {
    return JSON.parse(Buffer.from(result.listBase64, 'base64').toString('utf8'))
  }
  // 兼容旧版 dbDump（可能已在 emoji 后插入 U+FFFD）
  return Array.isArray(result && result.list) ? result.list : []
}

async function callDump(miniProgram, collection, skip) {
  const result = await miniProgram.evaluate(
    async (collection, skip) => {
      const res = await wx.cloud.callFunction({
        name: 'dbDump',
        data: { collection, skip, limit: 100 }
      })
      return res.result
    },
    collection,
    skip
  )
  if (!result || result.ok === false) {
    throw new Error(`${collection}@${skip}: ${(result && result.message) || JSON.stringify(result)}`)
  }
  return {
    ...result,
    list: decodeDumpList(result)
  }
}

async function dumpAll(miniProgram, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const summary = { dumpedAt: new Date().toISOString(), collections: {} }

  for (const name of COLLECTIONS) {
    const rows = []
    let skip = 0
    let total = null
    let missing = false

    for (;;) {
      const page = await callDump(miniProgram, name, skip)
      if (page.missing) {
        missing = true
        total = 0
        break
      }
      total = page.total
      rows.push(...(page.list || []))
      skip += (page.list || []).length
      console.log(`  ${name}: ${rows.length}/${total}`)
      if (!page.list || page.list.length === 0 || rows.length >= total) break
    }

    const file = path.join(outDir, `${name}.json`)
    fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`)
    summary.collections[name] = { total: rows.length, missing, file: path.basename(file) }
    console.log(missing ? `跳过不存在集合 ${name}` : `已写 ${file} (${rows.length})`)
  }

  fs.writeFileSync(path.join(outDir, '_summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

async function main() {
  const profile = arg('profile') || 'prod'
  const secrets = loadProfile(profile)
  const outDir = path.join(
    repoRoot,
    'doc/project/db-dumps',
    profile,
    new Date().toISOString().slice(0, 10).replace(/-/g, '')
  )

  if (!process.argv.includes('--skip-upload')) await uploadDbDump(secrets)
  else console.log('跳过上传 dbDump')

  const ws = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
  console.log('连接开发者工具', ws)
  console.log('请确认工具已用对应 AppID 打开本项目，并已开自动化端口 9421')

  let miniProgram
  try {
    miniProgram = await automator.connect({ wsEndpoint: ws })
  } catch (err) {
    throw new Error(
      `连不上 ${ws}。请用微信开发者工具打开 codeBase（AppID=${secrets.appId}），` +
      `并开启自动化端口 9421。原始错误：${err.message || err}`
    )
  }

  try {
    const summary = await dumpAll(miniProgram, outDir)
    console.log('导出完成', outDir)
    console.log(JSON.stringify(summary.collections, null, 2))
  } finally {
    try { await miniProgram.close() } catch (e) { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
