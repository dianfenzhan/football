/**
 * 用 miniprogram-ci 上传云函数 / 小程序代码。
 * 前置：已在微信开发者工具开通云开发，并填好 doc/project/secrets.local.json。
 *
 * 用法：
 *   node scripts/deploy-cloud.js
 *   node scripts/deploy-cloud.js --function-only
 *   node scripts/deploy-cloud.js --envId=覆盖环境ID
 *
 * appId / 上传密钥 / envId 默认读 secrets.local.json；
 * --envId 或 WX_CLOUD_ENV_ID 可临时覆盖环境。
 */

const path = require('path')
const fs = require('fs')
const ci = require('miniprogram-ci')

function readEnvId(cloudEnvPath) {
  if (!fs.existsSync(cloudEnvPath)) return ''
  const text = fs.readFileSync(cloudEnvPath, 'utf8')
  const hit = text.match(/envId:\s*['"]([^'"]+)['"]/)
  return hit ? hit[1] : ''
}

function arg(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((item) => item.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

function loadSecrets(secretsPath) {
  if (!fs.existsSync(secretsPath)) {
    throw new Error(`缺少 ${secretsPath}，先从 secrets.local.example.json 复制并填写`)
  }
  return JSON.parse(fs.readFileSync(secretsPath, 'utf8'))
}

function resolvePrivateKeyPath(projectRoot, secrets) {
  const raw = String(secrets.privateKeyPath || '').trim()
  if (!raw) {
    throw new Error('secrets.local.json 缺少 privateKeyPath')
  }
  if (path.isAbsolute(raw)) return raw
  return path.resolve(projectRoot, 'doc/project', path.basename(raw))
}

function writeEnvModules(projectPath, envId, forceRemoteCloud) {
  const body = [
    '// 由 scripts/deploy-cloud.js 写入',
    'module.exports = {',
    `  envId: '${envId}',`,
    `  forceRemoteCloud: ${!!forceRemoteCloud}`,
    '}',
    ''
  ].join('\n')
  fs.writeFileSync(path.join(projectPath, 'miniprogram/cloud-env.js'), body)
  fs.writeFileSync(path.join(projectPath, 'cloudfunctions/api/cloud-env.local.js'), body)
}

const PROD_APP_ID = 'wxb8021a7ae0c71bd0'
const PROD_ENV_ID = 'cloudbase-d5g20kltv44b494f6'

function currentGitBranch(repoRoot) {
  try {
    return require('child_process')
      .execSync('git branch --show-current', { cwd: repoRoot, encoding: 'utf8' })
      .trim()
  } catch (err) {
    return ''
  }
}

function allowDeployProdOnTwo(repoRoot) {
  const rulePath = path.join(repoRoot, '.cursor/rules/no-deploy-on-two.mdc')
  if (!fs.existsSync(rulePath)) return false
  const text = fs.readFileSync(rulePath, 'utf8')
  return /allowDeployProdOnTwo:\s*true/.test(text)
}

function assertTwoBranchTargetAllowed(repoRoot, appid, envId) {
  if (currentGitBranch(repoRoot) !== 'two') return
  const targetingProd = appid === PROD_APP_ID || envId === PROD_ENV_ID
  if (!targetingProd) return
  if (allowDeployProdOnTwo(repoRoot) && process.env.ALLOW_DEPLOY_PROD_ON_TWO === '1') {
    console.warn('警告：two 分支正在部署到正式环境（已显式放行）')
    return
  }
  throw new Error(
    'two 分支禁止部署到正式环境。请 npm run use:test 后部署测试环境；' +
    '若确需正式，亲手把 allowDeployProdOnTwo 改为 true，设 ALLOW_DEPLOY_PROD_ON_TWO=1，并说明可以部署正式。'
  )
}

async function main() {
  const projectPath = path.resolve(__dirname, '..')
  const repoRoot = path.resolve(projectPath, '..')
  const secretsPath = path.resolve(repoRoot, 'doc/project/secrets.local.json')
  const secrets = loadSecrets(secretsPath)

  const appid = String(secrets.appId || '').trim()
  if (!appid || appid.startsWith('你的') || appid.startsWith('把')) {
    throw new Error('请先在 secrets.local.json 填写真实 appId')
  }

  const privateKeyPath = resolvePrivateKeyPath(repoRoot, secrets)
  const functionOnly = process.argv.includes('--function-only')
  const envFromFile = readEnvId(path.join(projectPath, 'miniprogram/cloud-env.js'))
  const envId = arg('envId')
    || process.env.WX_CLOUD_ENV_ID
    || String(secrets.envId || secrets.cloudEnvId || '').trim()
    || envFromFile

  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`找不到上传密钥：${privateKeyPath}`)
  }
  if (!envId || envId.startsWith('开通')) {
    throw new Error('请先在 secrets.local.json 填写 envId，或传 --envId=xxx')
  }

  assertTwoBranchTargetAllowed(repoRoot, appid, envId)

  const forceRemoteCloud = envId !== PROD_ENV_ID && appid !== PROD_APP_ID
  writeEnvModules(projectPath, envId, forceRemoteCloud)

  const projectConfigPath = path.join(projectPath, 'project.config.json')
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'))
  if (projectConfig.appid !== appid) {
    projectConfig.appid = appid
    fs.writeFileSync(projectConfigPath, `${JSON.stringify(projectConfig, null, 2)}\n`)
  }

  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath,
    privateKeyPath,
    ignores: ['node_modules/**/*', 'scripts/**/*']
  })

  const envVariables = {}
  if (secrets.subscribeRemindTemplate) {
    envVariables.SUBSCRIBE_REMIND_TEMPLATE = String(secrets.subscribeRemindTemplate)
  }
  if (secrets.subscribePromoteTemplate) {
    envVariables.SUBSCRIBE_PROMOTE_TEMPLATE = String(secrets.subscribePromoteTemplate)
  }

  // miniprogram-ci 的 uploadFunction 不接收环境变量，密钥随函数目录里的本地文件上传，且该文件已 gitignore
  const localPath = path.join(projectPath, 'cloudfunctions/api/subscribe.local.js')
  fs.writeFileSync(localPath, `module.exports = ${JSON.stringify({
    SUBSCRIBE_REMIND_TEMPLATE: envVariables.SUBSCRIBE_REMIND_TEMPLATE || '',
    SUBSCRIBE_PROMOTE_TEMPLATE: envVariables.SUBSCRIBE_PROMOTE_TEMPLATE || ''
  })}\n`)

  console.log('上传云函数 api ...')
  console.log('appId', appid, 'env', envId)
  console.log('本地密钥随代码上传', Object.keys(envVariables).join(', ') || '无')
  const uploadOpts = {
    project,
    env: envId,
    path: path.join(projectPath, 'cloudfunctions/api'),
    name: 'api',
    remoteNpmInstall: true
  }
  const result = await ci.cloud.uploadFunction(uploadOpts)
  console.log('云函数部署完成', result)
  if (functionOnly) process.exit(0)

  // 正式上传到微信后台「开发版本」，可在公众平台选为体验版
  const version = arg('version') || `1.0.${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  const desc = arg('desc') || '球队小程序体验版'
  console.log('上传小程序代码（开发版本，可设为体验版）...', version, desc)
  const uploadResult = await ci.upload({
    project,
    version,
    desc,
    setting: {
      es6: true,
      minify: true
    },
    robot: Number(arg('robot') || process.env.WX_CI_ROBOT || 1) || 1
  })
  console.log('上传完成', uploadResult)
  console.log('下一步：微信公众平台 → 管理 → 版本管理 → 开发版本 → 选为体验版')
  process.exit(0)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
