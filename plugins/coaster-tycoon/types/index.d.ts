export type ParkTick = number

export type ParkView = 'park' | 'leaderboard'

export type LeaderboardEntry = {
  rank: number
  user: string
  id: string
  name: string
  score: number
  rating: number
  guests: number
  guestsTotal: number
  ridesOpen: number
  coasters: number
  riders: number
  best: string
  updatedAt: string
}

export type Leaderboard = {
  updatedAt: string
  players: number
  entries: LeaderboardEntry[]
}

export type ParkBoard = {
  board: Leaderboard | null
  fetchedAt: number
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'coaster-tycoon': { tick: ParkTick; view: ParkView; board: ParkBoard }
  }
}
