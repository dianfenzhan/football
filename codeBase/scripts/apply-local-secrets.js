/**
 * 按当前 profile 同步本地运行配置。
 *
 * 读：
 *   doc/project/active-profile.local.json   → { "profile": "test" | "prod" }
 *   doc/project/profiles/<profile>.local.json
 *
 * 写：
 *   doc/project/secrets.local.json          （给 deploy-cloud 等旧入口用）
 *   codeBase/project.private.config.json    （开发者工具本地 AppID，已 gitignore）
 *   miniprogram/cloud-env.js
 *   cloudfunctions/api/cloud-env.local.js
 *
 * 用法：
 *   node scripts/apply-local-secrets.js
 *   npm run use:test / npm run use:prod
 */

const path = require('path')
const fs = require('fs')

const projectPath = path.resolve(__dirname, '..')
const docProject = path.resolve(projectPath, '../doc/project')
const activePath = path.join(docProject, 'active-profile.local.json')
const secretsPath = path.join(docProject, 'secrets.local.json')
const privateConfigPath = path.join(projectPath, 'project.private.config.json')
const cloudEnvPath = path.join(projectPath, 'miniprogram/cloud-env.js')
const apiCloudEnvPath = path.join(projectPath, 'cloudfunctions/api/cloud-env.local.js')

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

function resolveProfileName(argvProfile) {
  if (argvProfile) return argvProfile
  if (fs.existsSync(activePath)) {
    const active = readJson(activePath)
    return String(active.profile || '').trim()
  }
  return ''
}

function loadProfile(profile) {
  const file = path.join(docProject, 'profiles', `${profile}.local.json`)
  if (!fs.existsSync(file)) {
    const example = path.join(docProject, 'profiles', `${profile}.example.json`)
    throw new Error(
      `缺少 ${file}\n` +
      (fs.existsSync(example)
        ? `先复制 ${example} 为 ${path.basename(file)} 并填入真实密钥`
        : '先创建该 profile 文件')
    )
  }
  return { file, secrets: readJson(file) }
}

function applySecrets(secrets, profile) {
  const appId = String(secrets.appId || '').trim()
  const envId = String(secrets.envId || secrets.cloudEnvId || '').trim()
  if (!appId || appId.startsWith('把') || /AppID|示例|example/i.test(appId)) {
    throw new Error(`profile「${profile}」的 appId 还没填真实值`)
  }

  const runtimeSecrets = { ...secrets }
  delete runtimeSecrets.name
  writeJson(secretsPath, runtimeSecrets)

  // test AppID 通常未配 open-meteo 合法域名；本地冒烟要关 urlCheck，切 profile 时别冲掉。
  const privateSetting = profile === 'test' ? { urlCheck: false } : undefined
  writeJson(privateConfigPath, {
    description: `本地覆盖：当前 profile=${profile}`,
    projectname: secrets.name || (profile === 'prod' ? '周三快乐足球联队' : '杰克的周三足球二'),
    appid: appId,
    ...(privateSetting ? { setting: privateSetting } : {})
  })

  // 同步一份到 project.config.json，避免旧工具只读这里
  const projectConfigPath = path.join(projectPath, 'project.config.json')
  const projectConfig = readJson(projectConfigPath)
  projectConfig.appid = appId
  if (secrets.name) projectConfig.projectname = secrets.name
  writeJson(projectConfigPath, projectConfig)

  // test：直接打已部署的测试云函数；prod 本地开发仍默认走本地调试
  const forceRemote = profile === 'test'
  const envModule = [
    '// 由 scripts/apply-local-secrets.js / deploy-cloud.js 写入',
    'module.exports = {',
    `  envId: '${envId}',`,
    `  forceRemoteCloud: ${forceRemote}`,
    '}',
    ''
  ].join('\n')
  fs.writeFileSync(cloudEnvPath, envModule)
  fs.writeFileSync(apiCloudEnvPath, envModule)

  const keyPath = path.join(docProject, path.basename(String(secrets.privateKeyPath || '')))
  console.log(`已切换到 profile=${profile}${secrets.name ? `（${secrets.name}）` : ''}`)
  console.log('- appId =', appId)
  console.log('- envId =', envId || '(空)')
  console.log('- 云函数 =', forceRemote ? '测试环境云端（不走本地调试）' : '正式：开发默认本地调试')
  console.log('- 上传密钥 =', keyPath, fs.existsSync(keyPath) ? '(已存在)' : '(缺失)')
}

function main(explicitProfile) {
  const profile = resolveProfileName(explicitProfile)
  if (!profile || !['prod', 'test'].includes(profile)) {
    throw new Error('请先设置 profile 为 prod 或 test：npm run use:test / npm run use:prod')
  }
  writeJson(activePath, { profile })
  const { secrets } = loadProfile(profile)
  applySecrets(secrets, profile)
}

if (require.main === module) {
  try {
    const arg = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : ''
    main(arg)
  } catch (err) {
    console.error(err.message || err)
    process.exit(1)
  }
}

module.exports = { main }
