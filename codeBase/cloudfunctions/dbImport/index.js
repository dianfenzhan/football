/**
 * 测试环境灌库：按 _id 覆盖写入。导完可删。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  const action = String(event.action || 'upsertBatch')
  const { OPENID } = cloud.getWXContext()

  if (action === 'whoami') {
    return { ok: true, openid: OPENID || '' }
  }

  if (action === 'ensureCollections') {
    const names = Array.isArray(event.collections) ? event.collections : []
    const created = []
    const existed = []
    for (const raw of names) {
      const name = String(raw || '').trim()
      if (!/^[a-z][a-z0-9_]{0,63}$/i.test(name)) continue
      try {
        await db.createCollection(name)
        created.push(name)
      } catch (err) {
        const msg = err && err.message ? err.message : String(err)
        if (/already exists|已存在|RESOURCE_ALREADY_EXISTS/i.test(msg)) existed.push(name)
        else throw err
      }
    }
    return { ok: true, created, existed }
  }

  if (action === 'deleteWhereEq') {
    const name = String(event.collection || '').trim()
    const field = String(event.field || '').trim()
    const value = event.value
    const keepId = event.keepId ? String(event.keepId) : ''
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(name) || !field) {
      return { ok: false, message: '非法 collection/field' }
    }
    let res
    try {
      res = await db.collection(name).where({ [field]: value }).limit(100).get()
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      if (/not exist|不存在|DATABASE_COLLECTION_NOT_EXIST/i.test(msg)) {
        return { ok: true, collection: name, removed: 0, skipped: true }
      }
      throw err
    }
    let removed = 0
    for (const row of res.data || []) {
      if (keepId && row._id === keepId) continue
      await db.collection(name).doc(row._id).remove()
      removed += 1
    }
    return { ok: true, collection: name, removed }
  }

  if (action === 'upsertBatch') {
    const name = String(event.collection || '').trim()
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(name)) {
      return { ok: false, message: '非法 collection' }
    }
    // docsBase64：避开 automator 桥把非 BMP emoji 弄成 …�
    let docs = []
    if (event.docsBase64) {
      try {
        docs = JSON.parse(Buffer.from(String(event.docsBase64), 'base64').toString('utf8'))
      } catch (err) {
        return { ok: false, message: 'docsBase64 解析失败' }
      }
    } else if (Array.isArray(event.docs)) {
      docs = event.docs
    }
    if (!Array.isArray(docs)) docs = []
    let written = 0
    for (const row of docs) {
      if (!row || !row._id) continue
      const id = row._id
      const data = { ...row }
      delete data._id
      await db.collection(name).doc(id).set({ data })
      written += 1
    }
    return { ok: true, collection: name, written }
  }

  return { ok: false, message: '未知 action' }
}
