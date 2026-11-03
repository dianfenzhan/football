/**
 * 把正式库 dump 导入当前测试云环境，并把主管理员 openid 换成当前登录用户。
 *
 *   node scripts/db-import-test.js
 *   node scripts/db-import-test.js --dump=../doc/project/db-dumps/prod/20261102
 *
 * 需要开发者工具用测试 AppID 打开项目，自动化端口 9421。
 */

const path = require('path')
const fs = require('fs')
const ci = require('miniprogram-ci')
const automator = require('miniprogram-automator')

const repoRoot = path.resolve(__dirname, '../..')
const projectPath = path.resolve(__dirname, '..')
const DEFAULT_DUMP = path.join(repoRoot, 'doc/project/db-dumps/prod/20261102')
const IMPORT_ORDER = [
  'teams',
  'clubs',
  'meta',
  'users',
  'activities',
  'quotas',
  'signups',
  'rounds',
  'contributions',
  'tactics_boards',
  'goal_events'
]

function arg(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((item) => item.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

function loadTestSecrets() {
  const file = path.join(repoRoot, 'doc/project/profiles/test.local.json')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function findOwnerOpenid(users) {
  const owner = users.find((u) => u.canGrantAdmin)
  if (!owner || !owner._openid) throw new Error('dump 里找不到 canGrantAdmin 主管理员')
  return { openid: owner._openid, name: owner.name, id: owner._id }
}

function remapOpenids(value, from, to) {
  if (value == null) return value
  if (typeof value === 'string') return value === from ? to : value
  if (Array.isArray(value)) return value.map((item) => remapOpenids(item, from, to))
  if (typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) {
      out[key] = remapOpenids(value[key], from, to)
    }
    return out
  }
  return value
}

async function uploadDbImport(secrets) {
  const key = path.join(repoRoot, 'doc/project', path.basename(secrets.privateKeyPath))
  const project = new ci.Project({
    appid: secrets.appId,
    type: 'miniProgram',
    projectPath,
    privateKeyPath: key,
    ignores: ['node_modules/**/*', 'scripts/**/*']
  })
  console.log('上传 dbImport →', secrets.appId, secrets.envId)
  try {
    await ci.cloud.uploadFunction({
      project,
      env: secrets.envId,
      path: path.join(projectPath, 'cloudfunctions/dbImport'),
      name: 'dbImport',
      remoteNpmInstall: true
    })
  } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    if (!/ResourceNotFound\.Function/i.test(msg)) throw err
    console.log('云函数尚不存在，改用开发者工具 CLI 创建…')
    const { execSync } = require('child_process')
    execSync(
      `/Applications/wechatwebdevtools.app/Contents/MacOS/cli cloud functions deploy ` +
      `--env ${secrets.envId} --names dbImport --remote-npm-install --project "${projectPath}" --lang zh`,
      { stdio: 'inherit' }
    )
  }
}

async function callImport(miniProgram, data) {
  // upsertBatch 用 docsBase64，避免 automator 桥损坏非 BMP emoji
  let payload = data
  if (data && data.action === 'upsertBatch' && Array.isArray(data.docs)) {
    payload = {
      action: data.action,
      collection: data.collection,
      docsBase64: Buffer.from(JSON.stringify(data.docs), 'utf8').toString('base64')
    }
  }
  return miniProgram.evaluate(async (body) => {
    const res = await wx.cloud.callFunction({ name: 'dbImport', data: body })
    return res.result
  }, payload)
}

async function main() {
  const dumpDir = path.resolve(arg('dump') || DEFAULT_DUMP)
  if (!fs.existsSync(dumpDir)) throw new Error(`找不到 dump 目录 ${dumpDir}`)

  const secrets = loadTestSecrets()
  if (!process.argv.includes('--skip-upload')) {
    await uploadDbImport(secrets)
  }

  const ws = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
  console.log('连接', ws)
  const miniProgram = await automator.connect({ wsEndpoint: ws })

  try {
    const who = await callImport(miniProgram, { action: 'whoami' })
    if (!who || !who.ok || !who.openid) throw new Error('whoami 失败：' + JSON.stringify(who))
    const newOpenid = who.openid
    console.log('当前测试号 openid =', newOpenid)

    const users = JSON.parse(fs.readFileSync(path.join(dumpDir, 'users.json'), 'utf8'))
    const owner = findOwnerOpenid(users)
    console.log('主管理员', owner.name, owner.openid, '→', newOpenid)

    const ensured = await callImport(miniProgram, {
      action: 'ensureCollections',
      collections: IMPORT_ORDER
    })
    console.log('确保集合 =', ensured)

    // 清掉测试号上已有的同 openid 用户，避免导入后 me 命中重复文档
    const purged = await callImport(miniProgram, {
      action: 'deleteWhereEq',
      collection: 'users',
      field: '_openid',
      value: newOpenid
    })
    console.log('清理测试号旧 users =', purged)

    for (const name of IMPORT_ORDER) {
      const file = path.join(dumpDir, `${name}.json`)
      if (!fs.existsSync(file)) {
        console.log('跳过缺失文件', name)
        continue
      }
      let docs = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!Array.isArray(docs)) docs = []
      if (docs.length === 0) {
        console.log(`${name}: 空`)
        continue
      }
      docs = remapOpenids(docs, owner.openid, newOpenid)

      const batchSize = 5
      let written = 0
      for (let i = 0; i < docs.length; i += batchSize) {
        const chunk = docs.slice(i, i + batchSize)
        const res = await callImport(miniProgram, {
          action: 'upsertBatch',
          collection: name,
          docs: chunk
        })
        if (!res || !res.ok) throw new Error(`${name} 写入失败: ${JSON.stringify(res)}`)
        written += res.written || 0
      }
      console.log(`已导入 ${name}: ${written}`)
    }

    const me = await miniProgram.evaluate(async () => {
      const res = await wx.cloud.callFunction({ name: 'api', data: { action: 'me' } })
      return res.result
    })
    console.log('导入后 me =', JSON.stringify({
      ok: me && me.ok,
      name: me && me.user && me.user.name,
      isAdmin: me && me.user && me.user.isAdmin,
      canGrantAdmin: me && me.user && me.user.canGrantAdmin,
      openidHint: newOpenid.slice(0, 8) + '…'
    }))
    if (!me || !me.ok || !me.user || !me.user.canGrantAdmin) {
      throw new Error('主管理员 remap 后 me 未拿到 canGrantAdmin，请检查 api 是否已部署到测试环境')
    }
    console.log('完成：测试库已导入，主管理员已是当前登录用户')
  } finally {
    try { await miniProgram.close() } catch (e) { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
