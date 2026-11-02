Component({
  properties: {
    options: { type: Array, value: [] },
    value: { type: String, value: 'all' }
  },
  methods: {
    onPick(event) {
      const id = event.currentTarget.dataset.id
      if (!id || id === this.data.value) return
      this.triggerEvent('change', { clubId: id })
    }
  }
})