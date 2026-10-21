const { call, avatarChar, avatarColor, sortTeamsByMine } = require('../../utils/api')

const DEFAULT_TEAM_ID = 'team_jiong'

Page({
  data: {
    teams: [],
    teamId: DEFAULT_TEAM_ID,
    all: [],
    players: [],
    loading: true
  },
  onShow() {
    Promise.all([
      call('me'),
      call('listPlayers')
    ]).then(([meRes, listRes]) => {
      const user = meRes.user
      const myTeamId = (user && user.teamId) || DEFAULT_TEAM_ID
      const teams = sortTeamsByMine(meRes.teams || [], myTeamId)
      this.setData({
        teams,
        teamId: myTeamId,
        all: (listRes.users || []).map((user) => ({
          ...user,
          avatarChar: avatarChar(user.name),
          avatarBg: avatarColor(user.name)
        })),
        loading: false
      })
      this.applyFilter()
    }).catch(() => this.setData({ loading: false }))
  },
  applyFilter() {
    const players = this.data.all
      .filter((item) => item.teamId === this.data.teamId)
      .sort((a, b) => (b.isAdmin ? 1 : 0) - (a.isAdmin ? 1 : 0))
    this.setData({ players })
  },
  onTeam(event) {
    this.setData({ teamId: event.currentTarget.dataset.id })
    this.applyFilter()
  }
})
