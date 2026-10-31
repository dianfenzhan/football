const { call } = require('../../utils/api')

const DEFAULT_QUICK = [
  '下一场什么时候',
  '还差几人',
  '我的数据怎么样',
  '后补功能怎么用？',
  '取消报名算鸽子吗？',
  '联合报名是什么？'
]
const WEEK_LIMIT = 15
const FAB_POS_KEY = 'mirrorFabXY'

Component({
  data: {
    open: false,
    draft: '',
    sending: false,
    messages: [],
    quickQuestions: DEFAULT_QUICK,
    scrollInto: '',
    seq: 0,
    prevQuestion: '',
    prevAnswer: '',
    weekLimit: WEEK_LIMIT,
    remaining: WEEK_LIMIT,
    fabX: 300,
    fabY: 420
  },
  lifetimes: {
    attached() {
      this.initFabPos()
      this.refreshQuota()
    }
  },
  pageLifetimes: {
    show() {
      this.initFabPos()
      this.refreshQuota()
    }
  },
  methods: {
    noop() {},
    initFabPos() {
      const sys = wx.getSystemInfoSync()
      const width = sys.windowWidth || 375
      const height = sys.windowHeight || 667
      const saved = wx.getStorageSync(FAB_POS_KEY)
      const x = (saved && typeof saved.x === 'number') ? saved.x : Math.max(0, width - 76)
      const y = (saved && typeof saved.y === 'number') ? saved.y : Math.max(80, height - 240)
      this.setData({ fabX: x, fabY: y })
    },
    onFabChange(event) {
      const detail = event.detail || {}
      if (detail.source !== 'touch' && detail.source !== 'touch-out-of-bounds' && detail.source !== 'friction') {
        return
      }
      this._movedAt = Date.now()
      const x = Math.round(detail.x || 0)
      const y = Math.round(detail.y || 0)
      wx.setStorageSync(FAB_POS_KEY, { x, y })
    },
    applyQuota(res) {
      if (!res) return
      const weekLimit = Number(res.weekLimit) > 0 ? Number(res.weekLimit) : WEEK_LIMIT
      const remaining = res.remaining == null ? weekLimit : Math.max(0, Number(res.remaining) || 0)
      this.setData({ weekLimit, remaining })
    },
    refreshQuota() {
      call('mirrorQuota').then((res) => {
        this.applyQuota(res)
      }).catch(() => {})
    },
    openPanel() {
      if (this._movedAt && Date.now() - this._movedAt < 180) return
      this.setData({ open: true })
      this.refreshQuota()
    },
    closePanel() {
      this.setData({ open: false })
    },
    onInput(event) {
      this.setData({ draft: event.detail.value || '' })
    },
    onQuick(event) {
      const q = event.currentTarget.dataset.q
      if (!q || this.data.sending) return
      if (this.data.remaining <= 0) {
        wx.showToast({ title: '本周次数已用完', icon: 'none' })
        return
      }
      this.setData({ draft: q })
      this.ask(q)
    },
    onSend() {
      if (this.data.sending) return
      if (this.data.remaining <= 0) {
        wx.showToast({ title: '本周次数已用完', icon: 'none' })
        return
      }
      const q = String(this.data.draft || '').trim()
      if (!q) return
      this.ask(q)
    },
    nextId() {
      const seq = this.data.seq + 1
      this.setData({ seq })
      return String(seq)
    },
    ask(question) {
      const text = String(question || '').trim().slice(0, 60)
      if (!text) return
      const userId = this.nextId()
      const botId = this.nextId()
      const messages = this.data.messages.concat([
        { id: userId, role: 'user', text, display: text, done: true },
        {
          id: botId,
          role: 'bot',
          text: '',
          display: '…',
          done: false,
          logId: '',
          feedback: false
        }
      ])
      this.setData({
        messages,
        draft: '',
        sending: true,
        scrollInto: `msg-${botId}`
      })
      call('mirrorAsk', {
        question: text,
        prevQuestion: this.data.prevQuestion,
        prevAnswer: this.data.prevAnswer
      }).then((res) => {
        const answer = String((res && res.answer) || '助手没答上来').trim()
        const quickQuestions = (res && res.quickQuestions && res.quickQuestions.length)
          ? res.quickQuestions
          : DEFAULT_QUICK
        this.applyQuota(res)
        this.patchMessage(botId, {
          text: answer,
          display: '',
          logId: (res && res.logId) || '',
          done: false
        })
        this.setData({
          quickQuestions,
          prevQuestion: text,
          prevAnswer: answer,
          sending: false
        })
        this.typewrite(botId, answer)
      }).catch(() => {
        const answer = '助手暂时连不上，稍后再试'
        this.patchMessage(botId, { text: answer, display: answer, done: true })
        this.setData({ sending: false, scrollInto: `msg-${botId}` })
      })
    },
    patchMessage(id, patch) {
      const messages = this.data.messages.map((item) => (
        item.id === id ? { ...item, ...patch } : item
      ))
      this.setData({ messages })
    },
    typewrite(id, full) {
      let i = 0
      const step = () => {
        i += 1
        const display = full.slice(0, i)
        this.patchMessage(id, { display, done: i >= full.length })
        this.setData({ scrollInto: `msg-${id}` })
        if (i < full.length) {
          setTimeout(step, full.length > 80 ? 16 : 28)
        }
      }
      step()
    },
    onFeedback(event) {
      const id = event.currentTarget.dataset.id
      const useful = event.currentTarget.dataset.useful === '1' || event.currentTarget.dataset.useful === 1
      const msg = this.data.messages.find((item) => item.id === id)
      if (!msg || msg.feedback || !msg.logId) return
      this.patchMessage(id, { feedback: true })
      call('mirrorFeedback', { logId: msg.logId || '', useful }).catch(() => {})
    }
  }
})
