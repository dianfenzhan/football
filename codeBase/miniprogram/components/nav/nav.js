Component({
  properties: {
    current: String
  },
  methods: {
    go(event) {
      const url = event.currentTarget.dataset.url
      const pages = getCurrentPages()
      const current = `/${pages[pages.length - 1].route}`
      if (current === url) return
      wx.redirectTo({ url })
    }
  }
})
