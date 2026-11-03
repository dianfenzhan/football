/**
 * 一键切换正式 / 测试小程序配置。
 *
 *   npm run use:test
 *   npm run use:prod
 *   node scripts/use-profile.js test
 */

const { main } = require('./apply-local-secrets')

const profile = String(process.argv[2] || '').trim()
if (!['prod', 'test'].includes(profile)) {
  console.error('用法: node scripts/use-profile.js <prod|test>')
  process.exit(1)
}

try {
  main(profile)
} catch (err) {
  console.error(err.message || err)
  process.exit(1)
}
