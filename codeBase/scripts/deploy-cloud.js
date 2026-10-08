/**
 * 用 miniprogram-ci 上传云函数。
 * 前置：已在微信开发者工具开通云开发，并拿到环境 ID。
 *
 * 用法：
 *   node scripts/deploy-cloud.js --envId=你的环境ID
 *
 * 密钥文件默认读：
 *   ../doc/project/private.wxb8021a7ae0c71bd0.key
 */

const path = require('path')
const fs = require('fs')
const ci = require('miniprogram-ci')

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
  const envId = arg('envId') || process.env.WX_CLOUD_ENV_ID || ''

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

  console.log('上传云函数 api ...')
  const result = await ci.cloud.uploadFunction({
    project,
    env: envId,
    path: path.join(projectPath, 'cloudfunctions/api'),
    name: 'api',
    remoteNpmInstall: true
  })
  console.log('云函数部署完成', result)

  console.log('上传小程序代码为预览包 ...')
  const preview = await ci.preview({
    project,
    desc: '一期球队报名预览',
    setting: {
      es6: true,
      minify: true
    },
    qrcodeFormat: 'image',
    qrcodeOutputDest: path.join(projectPath, 'preview-qrcode.jpg')
  })
  console.log('预览完成，二维码：codeBase/preview-qrcode.jpg', preview)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
