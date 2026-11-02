Component({
  properties: {
    clubs: { type: Array, value: [] },
    currentClubId: { type: String, value: '' },
    currentName: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    otherHint: { type: String, value: '' },
    otherClubId: { type: String, value: '' },
    compact: { type: Boolean, value: false },
    showManage: { type: Boolean, value: true }
  },
  data: {
    showSheet: false
  },
  methods: {
    noop() {},
    openSheet() {
      if ((this.data.clubs || []).length <= 1) {
        if (this.data.showManage) this.onManage()
        return
      }
      this.setData({ showSheet: true })
    },
    closeSheet() {
      this.setData({ showSheet: false })
    },
    onPick(event) {
      const clubId = event.currentTarget.dataset.id
      if (!clubId || clubId === this.data.currentClubId) {
        this.closeSheet()
        return
      }
      this.closeSheet()
      this.triggerEvent('change', { clubId })
    },
    onOther() {
      const clubId = this.data.otherClubId
      if (!clubId) return
      this.triggerEvent('change', { clubId })
    },
    onManage() {
      this.closeSheet()
      this.triggerEvent('manage')
      wx.navigateTo({ url: '/pages/club/club' })
    }
  }
})