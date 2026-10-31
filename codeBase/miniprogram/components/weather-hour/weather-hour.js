const PAD = { left: 36, right: 16, top: 36, bottom: 28 }

Component({
  properties: {
    hours: { type: Array, value: [] },
    sunrise: { type: String, value: '' },
    sunset: { type: String, value: '' },
    venueAddress: { type: String, value: '上海市浦东新区川沙镇界绿路88号，界龙足球基地' },
    defaultIndex: { type: Number, value: 0 },
    dateLabel: { type: String, value: '' },
    embedded: { type: Boolean, value: false }
  },
  data: {
    selectedIndex: 0,
    axisHours: [],
    chartWidth: 0,
    chartHeight: 0
  },
  lifetimes: {
    ready() {
      this._ready = true
      this.initFromProps()
    }
  },
  observers: {
    'hours, defaultIndex': function () {
      if (this._ready) this.initFromProps()
    }
  },
  methods: {
    initFromProps() {
      const hours = this.properties.hours || []
      if (!hours.length) {
        this.setData({ axisHours: [] })
        return
      }
      let selectedIndex = Number(this.properties.defaultIndex)
      if (!Number.isFinite(selectedIndex) || selectedIndex < 0 || selectedIndex >= hours.length) {
        const found = hours.findIndex((h) => h.hour === 20)
        selectedIndex = found >= 0 ? found : 0
      }
      this._points = null
      this._scrubX = null
      this._scrubY = null
      this._scrubIndex = null
      this._dragging = false
      this.setData({ selectedIndex }, () => {
        this.measureAndDraw()
      })
    },
    axisSample(hours, width) {
      if (!hours.length) return []
      const want = [12, 14, 16, 18, 20, 22, 24]
      const picked = want
        .map((h) => hours.find((item) => item.hour === h))
        .filter(Boolean)
      const plotW = Math.max(1, (width || 1) - PAD.left - PAD.right)
      return (picked.length ? picked : hours).map((item) => {
        const idx = hours.findIndex((h) => h.hour === item.hour)
        const x = PAD.left + (hours.length <= 1 ? plotW / 2 : (idx / (hours.length - 1)) * plotW)
        const left = width ? (x / width) * 100 : 50
        return {
          hour: item.hour,
          label: item.label,
          icon: item.icon,
          windLevel: item.windLevel,
          left
        }
      })
    },
    measureAndDraw() {
      const query = this.createSelectorQuery()
      query.select('#weatherCanvas').fields({ node: true, size: true }).exec((res) => {
        const box = res && res[0]
        if (!box || !box.node) return
        const canvas = box.node
        const width = box.width
        const height = box.height
        const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : (wx.getSystemInfoSync().pixelRatio || 2)
        canvas.width = width * dpr
        canvas.height = height * dpr
        const ctx = canvas.getContext('2d')
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)
        this._canvas = canvas
        this._ctx = ctx
        this._width = width
        this._height = height
        this._points = null
        this._wrapLeft = null
        this._wrapWidth = null
        this.setData({
          chartWidth: width,
          chartHeight: height,
          axisHours: this.axisSample(this.properties.hours || [], width)
        })
        this.draw()
      })
    },
    buildPoints(hours, width, height) {
      const temps = hours.map((h) => h.temp)
      let min = Math.min.apply(null, temps)
      let max = Math.max.apply(null, temps)
      if (min === max) {
        min -= 2
        max += 2
      } else {
        const padT = Math.max(1, Math.round((max - min) * 0.15))
        min -= padT
        max += padT
      }
      const plotW = width - PAD.left - PAD.right
      const plotH = height - PAD.top - PAD.bottom
      return hours.map((h, i) => {
        const x = PAD.left + (hours.length <= 1 ? plotW / 2 : (i / (hours.length - 1)) * plotW)
        const y = PAD.top + (1 - (h.temp - min) / (max - min)) * plotH
        return { x, y, temp: h.temp, min, max }
      })
    },
    ensurePoints() {
      const hours = this.properties.hours || []
      const width = this._width
      const height = this._height
      if (!hours.length || !width || !height) return null
      if (!this._points || this._points.length !== hours.length) {
        this._points = this.buildPoints(hours, width, height)
      }
      return this._points
    },
    scrubAtX(x) {
      const points = this._points
      if (!points || !points.length) return null
      const left = points[0].x
      const right = points[points.length - 1].x
      const cx = Math.max(left, Math.min(right, x))
      if (points.length === 1) return { x: points[0].x, y: points[0].y, index: 0 }

      let i = 0
      while (i < points.length - 2 && points[i + 1].x < cx) i += 1
      const a = points[i]
      const b = points[i + 1]
      const t = b.x === a.x ? 0 : (cx - a.x) / (b.x - a.x)
      return {
        x: cx,
        y: a.y + (b.y - a.y) * t,
        index: t < 0.5 ? i : i + 1
      }
    },
    tipTextFor(index) {
      const hours = this.properties.hours || []
      const item = hours[index]
      if (!item) return ''
      return `${item.tipLabel} ${item.text} ${item.temp}°`
    },
    drawTipOnCanvas(ctx, x, text, width) {
      if (!text) return
      ctx.font = '600 11px sans-serif'
      const paddingX = 10
      const th = 22
      const tw = ctx.measureText(text).width + paddingX * 2
      let left = x - tw / 2
      left = Math.max(4, Math.min(width - tw - 4, left))
      const top = 2
      const r = 8
      ctx.beginPath()
      ctx.moveTo(left + r, top)
      ctx.arcTo(left + tw, top, left + tw, top + th, r)
      ctx.arcTo(left + tw, top + th, left, top + th, r)
      ctx.arcTo(left, top + th, left, top, r)
      ctx.arcTo(left, top, left + tw, top, r)
      ctx.closePath()
      ctx.fillStyle = '#1f6a4f'
      ctx.fill()
      const ax = Math.max(left + 10, Math.min(left + tw - 10, x))
      ctx.beginPath()
      ctx.moveTo(ax - 5, top + th - 1)
      ctx.lineTo(ax + 5, top + th - 1)
      ctx.lineTo(ax, top + th + 5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, left + tw / 2, top + th / 2)
      ctx.textBaseline = 'alphabetic'
    },
    draw() {
      const ctx = this._ctx
      const hours = this.properties.hours || []
      const width = this._width
      const height = this._height
      if (!ctx || !hours.length || !width) return

      const points = this.ensurePoints()
      if (!points) return
      const min = points[0].min
      const max = points[0].max

      let curX
      let curY
      let tipIndex
      if (this._dragging && this._scrubX != null && this._scrubY != null) {
        curX = this._scrubX
        curY = this._scrubY
        tipIndex = this._scrubIndex != null ? this._scrubIndex : this.data.selectedIndex
      } else {
        tipIndex = Math.min(this.data.selectedIndex, points.length - 1)
        const cur = points[tipIndex]
        if (cur) {
          curX = cur.x
          curY = cur.y
        }
      }

      ctx.clearRect(0, 0, width, height)

      ctx.fillStyle = '#9aa7a1'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(`${Math.round(max)}°`, 4, PAD.top + 4)
      ctx.fillText(`${Math.round(min)}°`, 4, height - PAD.bottom)

      ctx.beginPath()
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      const last = points[points.length - 1]
      const first = points[0]
      ctx.lineTo(last.x, height - PAD.bottom)
      ctx.lineTo(first.x, height - PAD.bottom)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, PAD.top, 0, height - PAD.bottom)
      grad.addColorStop(0, 'rgba(31, 106, 79, 0.28)')
      grad.addColorStop(1, 'rgba(31, 106, 79, 0.02)')
      ctx.fillStyle = grad
      ctx.fill()

      ctx.beginPath()
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.strokeStyle = '#1f6a4f'
      ctx.lineWidth = 2.5
      ctx.lineJoin = 'round'
      ctx.stroke()

      if (curX != null) {
        ctx.beginPath()
        ctx.moveTo(curX, PAD.top - 8)
        ctx.lineTo(curX, height - PAD.bottom + 4)
        ctx.strokeStyle = 'rgba(31, 106, 79, 0.45)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])

        ctx.beginPath()
        ctx.arc(curX, curY, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#1f6a4f'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(curX, curY, 5, 0, Math.PI * 2)
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()

        this.drawTipOnCanvas(ctx, curX, this.tipTextFor(tipIndex), width)
      }
    },
    scheduleDraw() {
      if (this._rafPending) return
      this._rafPending = true
      const run = () => {
        this._rafPending = false
        this.draw()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 16)
    },
    cacheWrapLeft(done) {
      if (this._wrapLeft != null && this._wrapWidth === this._width) {
        if (done) done()
        return
      }
      this.createSelectorQuery().select('.chart-wrap').boundingClientRect((rect) => {
        if (rect) {
          this._wrapLeft = rect.left
          this._wrapWidth = rect.width
        }
        if (done) done()
      }).exec()
    },
    applyTouchX(clientX, { commit } = {}) {
      const points = this.ensurePoints()
      if (!points || !points.length || this._wrapLeft == null) return
      const scrub = this.scrubAtX(clientX - this._wrapLeft)
      if (!scrub) return

      this._scrubX = scrub.x
      this._scrubY = scrub.y
      this._scrubIndex = scrub.index

      if (commit) {
        this._dragging = false
        this._scrubX = null
        this._scrubY = null
        this._scrubIndex = null
        const patch = { selectedIndex: scrub.index }
        this.setData(patch, () => this.draw())
        return
      }

      this.scheduleDraw()
      if (scrub.index !== this.data.selectedIndex) {
        this.setData({ selectedIndex: scrub.index })
      }
    },
    onTouchStart(event) {
      const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0])
      if (!touch) return
      this._dragging = true
      this.cacheWrapLeft(() => this.applyTouchX(touch.clientX))
    },
    onTouchMove(event) {
      const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0])
      if (!touch || !this._dragging) return
      if (this._wrapLeft == null) {
        this.cacheWrapLeft(() => this.applyTouchX(touch.clientX))
        return
      }
      this.applyTouchX(touch.clientX)
    },
    onTouchEnd(event) {
      const touch = (event.changedTouches && event.changedTouches[0]) || (event.touches && event.touches[0])
      if (!touch) {
        this._dragging = false
        this._scrubX = null
        this._scrubY = null
        this._scrubIndex = null
        this.draw()
        return
      }
      const finish = () => this.applyTouchX(touch.clientX, { commit: true })
      if (this._wrapLeft == null) this.cacheWrapLeft(finish)
      else finish()
    }
  }
})
