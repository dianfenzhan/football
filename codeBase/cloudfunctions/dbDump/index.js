/**
 * 只读导出：按集合分页拉取文档。部署到目标云环境后由 scripts/db-dump.js 调用。
 * 勿用于业务；导完可删。
 *
 * 返回 listBase64（UTF-8 JSON 的 base64），避免开发者工具 automator 桥
 * 在非 BMP emoji 后插入 U+FFFD。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event = {}) => {
  const name = String(event.collection || '').trim()
  if (!name) return { ok: false, message: '缺少 collection' }
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(name)) {
    return { ok: false, message: '非法 collection' }
  }

  const skip = Math.max(0, Number(event.skip) || 0)
  const limit = Math.min(100, Math.max(1, Number(event.limit) || 100))

  try {
    const countRes = await db.collection(name).count()
    const res = await db.collection(name).skip(skip).limit(limit).get()
    const list = res.data || []
    return {
      ok: true,
      collection: name,
      total: countRes.total,
      skip,
      limit,
      listBase64: Buffer.from(JSON.stringify(list), 'utf8').toString('base64')
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    // 集合不存在时当作空
    if (/not exist|不存在|ResourceNotFound|COLLECTION_NOT_EXIST/i.test(message)) {
      return {
        ok: true,
        collection: name,
        total: 0,
        skip,
        limit,
        listBase64: Buffer.from('[]', 'utf8').toString('base64'),
        missing: true
      }
    }
    return { ok: false, message }
  }
}
