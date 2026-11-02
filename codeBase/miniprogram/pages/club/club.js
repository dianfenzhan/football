const { call, callQuiet } = require('../../utils/api')
const { setMultiClubReady } = require('../../utils/club-context')

Page({
  data: {
    clubs: [],
    colors: [
      { label: '绿', color: '#1d6b50' },
      { label: '白', color: '#f4f4f4' },
      { label: '黄', color: '#e6b325' },
      { label: '粉白', color: '#f4c2c2' },
      { label: '蓝', color: '#3d5a80' },
      { label: '红', color: '#c44536' },
      { label: '黑', color: '#1c2421' }
    ]
  },
  onShow() {
    this.load()
  },
  onFilterChange() {
    // 顶栏已写入全局筛选
  },
  load() {
    callQuiet('orgMe').then((res) => {
      setMultiClubReady(true)
      this.setData({ clubs: res.clubs || [] })
    }).catch(() => {
      setMultiClubReady(false)
      this.setData({ clubs: [] })
      wx.showToast({ title: '球队接口未就绪，先看活动页', icon: 'none' })
    })
  },
  clubOf(clubId) {
    return (this.data.clubs || []).find((item) => item._id === clubId)
  },
  joinJielong() {
    call('joinClub', { clubId: 'club_jielong' }).then(() => {
      wx.showToast({ title: '已加入界龙散客' })
      this.load()
    })
  },
  onPick(event) {
    const clubId = event.currentTarget.dataset.club
    const groupId = event.currentTarget.dataset.id
    const club = this.clubOf(clubId)
    if (!club) return
    const action = club.joined ? 'setMyGroup' : 'joinClub'
    call(action, { clubId, groupId }).then(() => {
      wx.showToast({ title: club.joined ? '以后默认报这组' : '已加入' })
      this.load()
    })
  },
  onName(event) {
    const clubId = event.currentTarget.dataset.club
    const index = Number(event.currentTarget.dataset.index)
    const clubs = this.data.clubs.map((club) => {
      if (club._id !== clubId) return club
      const groups = club.groups.slice()
      groups[index] = Object.assign({}, groups[index], { name: event.detail.value })
      return Object.assign({}, club, { groups })
    })
    this.setData({ clubs })
  },
  saveName(event) {
    const clubId = event.currentTarget.dataset.club
    const index = Number(event.currentTarget.dataset.index)
    const club = this.clubOf(clubId)
    if (!club) return
    const group = club.groups[index]
    call('updateClubGroup', {
      clubId,
      groupId: group.id,
      name: group.name
    }).then(() => wx.showToast({ title: '已改名' }))
  },
  onColor(event) {
    call('updateClubGroup', {
      clubId: event.currentTarget.dataset.club,
      groupId: event.currentTarget.dataset.group,
      color: event.currentTarget.dataset.color,
      jerseyColor: event.currentTarget.dataset.label
    }).then(() => this.load())
  },
  move(event) {
    const clubId = event.currentTarget.dataset.club
    const index = Number(event.currentTarget.dataset.index)
    const dir = Number(event.currentTarget.dataset.dir)
    const club = this.clubOf(clubId)
    if (!club) return
    const groups = club.groups.slice()
    const next = index + dir
    if (next < 0 || next >= groups.length) return
    const swapped = groups[index]
    groups[index] = groups[next]
    groups[next] = swapped
    call('reorderClubGroups', {
      clubId,
      orderedIds: groups.map((group) => group.id)
    }).then((res) => {
      const clubs = this.data.clubs.map((item) => (
        item._id === clubId ? Object.assign({}, item, { groups: res.groups }) : item
      ))
      this.setData({ clubs })
    })
  }
})
