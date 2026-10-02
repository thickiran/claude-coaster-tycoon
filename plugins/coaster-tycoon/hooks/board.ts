// The global leaderboard: what a shared park publishes, and how the board
// reads back. The repository's GitHub Action ranks the parks with the same
// score formula (scripts/update-leaderboard.mjs); keep the two in step.

import { parkRating } from './sim'
import type { World } from './sim'

export const REPO = 'thickiran/claude-coaster-tycoon'
export const BOARD_URL = `https://raw.githubusercontent.com/${REPO}/main/leaderboard/leaderboard.json`
export const GIST_FILE = 'park.json'

export type ParkStats = {
  id: string
  name: string
  rating: number
  guests: number
  guestsTotal: number
  rides: number
  ridesOpen: number
  coasters: number
  riders: number
  money: number
  best: string
  updatedAt: string
}

// Only game numbers and the park's display name leave the machine: never a
// path, a file, a prompt or a line of code.
export function parkStats(w: World, id: string, name: string): ParkStats {
  const open = w.rides.filter(r => r.status === 'open')
  const best = [...open].sort((a, b) => b.excitement - a.excitement)[0]

  return {
    id,
    name: cleanName(name),
    rating: parkRating(w),
    guests: w.guests.length,
    guestsTotal: w.guestsTotal,
    rides: w.rides.length,
    ridesOpen: open.length,
    coasters: open.filter(r => r.tier === 'big').length,
    riders: w.rides.reduce((a, r) => a + r.riders, 0),
    money: Math.round(w.money),
    best: best ? `${best.name} (${best.kind}, E ${best.excitement.toFixed(2)})` : '',
    updatedAt: new Date().toISOString(),
  }
}

export function score(p: Pick<ParkStats, 'rating' | 'ridesOpen' | 'guestsTotal' | 'riders'>): number {
  return Math.round(p.rating * (1 + 0.25 * p.ridesOpen) + p.guestsTotal * 0.05 + p.riders * 0.02)
}

export function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Unnamed Park'
}

export async function parkId(root: string): Promise<string> {
  const bytes = new TextEncoder().encode(`coaster-tycoon:${root}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))

  return [...digest.slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(s)) return '?'
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`

  return `${Math.round(s / 86400)}d ago`
}

export function pad(text: string | number, width: number, isRight = false): string {
  const t = String(text)
  const cut = t.length > width ? `${t.slice(0, width - 1)}…` : t

  return isRight ? cut.padStart(width) : cut.padEnd(width)
}
