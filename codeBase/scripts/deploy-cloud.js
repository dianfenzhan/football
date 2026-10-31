/**
 * 用 miniprogram-ci 上传云函数。
 * 前置：已在微信开发者工具开通云开发，并拿到环境 ID。
 *
 * 用法：
 *   node scripts/deploy-cloud.js --envId=你的环境ID
 *   node scripts/deploy-cloud.js --function-only
 *
 * --function-only 只上传云函数 api，不打预览包。
 * 未传 --envId 时，依次用环境变量 WX_CLOUD_ENV_ID、miniprogram/cloud-env.js。
 *
 * 密钥文件默认读：
 *   ../doc/project/private.wxb8021a7ae0c71bd0.key
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

async function main() {
  const projectPath = path.resolve(__dirname, '..')
  const appid = 'wxb8021a7ae0c71bd0'
  const privateKeyPath = path.resolve(
    __dirname,
    '../../doc/project/private.wxb8021a7ae0c71bd0.key'
  )
  const functionOnly = process.argv.includes('--function-only')
  const envFromFile = readEnvId(path.join(projectPath, 'miniprogram/cloud-env.js'))
  const envId = arg('envId') || process.env.WX_CLOUD_ENV_ID || envFromFile

  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`找不到上传密钥：${privateKeyPath}`)
  }
  if (!envId) {
    throw new Error('请传入 --envId=xxx，或设置环境变量 WX_CLOUD_ENV_ID')
  }

  const cloudEnvPath = path.join(projectPath, 'miniprogram/cloud-env.js')
  fs.writeFileSync(
    cloudEnvPath,
    `// 由 scripts/deploy-cloud.js 写入\nmodule.exports = {\n  envId: '${envId}'\n}\n`
  )

  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath,
    privateKeyPath,
    ignores: ['node_modules/**/*', 'scripts/**/*']
  })

  const secretsPath = path.resolve(__dirname, '../../doc/project/secrets.local.json')
  const secrets = fs.existsSync(secretsPath)
    ? JSON.parse(fs.readFileSync(secretsPath, 'utf8'))
    : {}
  const envVariables = {}
  if (secrets.subscribeRemindTemplate) {
    envVariables.SUBSCRIBE_REMIND_TEMPLATE = String(secrets.subscribeRemindTemplate)
  }
  if (secrets.subscribePromoteTemplate) {
    envVariables.SUBSCRIBE_PROMOTE_TEMPLATE = String(secrets.subscribePromoteTemplate)
  }
  if (secrets.deepseekApiKey) {
    envVariables.DEEPSEEK_API_KEY = String(secrets.deepseekApiKey)
  }
  if (secrets.deepseekBaseUrl) {
    envVariables.DEEPSEEK_BASE_URL = String(secrets.deepseekBaseUrl)
  }
  if (secrets.deepseekModel) {
    envVariables.DEEPSEEK_MODEL = String(secrets.deepseekModel)
  }

  // miniprogram-ci 的 uploadFunction 不接收环境变量，密钥随函数目录里的本地文件上传，且该文件已 gitignore
  const localPath = path.join(projectPath, 'cloudfunctions/api/subscribe.local.js')
  fs.writeFileSync(localPath, `module.exports = ${JSON.stringify({
    SUBSCRIBE_REMIND_TEMPLATE: envVariables.SUBSCRIBE_REMIND_TEMPLATE || '',
    SUBSCRIBE_PROMOTE_TEMPLATE: envVariables.SUBSCRIBE_PROMOTE_TEMPLATE || '',
    DEEPSEEK_API_KEY: envVariables.DEEPSEEK_API_KEY || '',
    DEEPSEEK_BASE_URL: envVariables.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    DEEPSEEK_MODEL: envVariables.DEEPSEEK_MODEL || 'deepseek-flash'
  })}\n`)

  // 魔镜知识文件：以 doc/ 为准同步进云函数目录
  const knowledgeDir = path.join(projectPath, 'cloudfunctions/api/knowledge')
  fs.mkdirSync(knowledgeDir, { recursive: true })
  for (const name of ['mirror-faq.json', 'mirror.md']) {
    const from = path.resolve(projectPath, '../doc', name)
    if (!fs.existsSync(from)) throw new Error(`缺少魔镜知识文件：${from}`)
    fs.copyFileSync(from, path.join(knowledgeDir, name))
  }
  console.log('已同步魔镜知识文件 mirror-faq.json / mirror.md')

  console.log('上传云函数 api ...')
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
