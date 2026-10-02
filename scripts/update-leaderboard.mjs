// Builds leaderboard/leaderboard.json from every registered park gist, and
// registers new players from "[park] join" issues.
//
// Everything a player sends is untrusted data: an issue body yields at most a
// gist id, a gist yields numbers that are clamped and a name that is cleaned,
// and the score is recomputed here, never read. Nothing from a player is run.
//
// Runs in GitHub Actions (Node 22, no dependencies) with GITHUB_TOKEN.

import { readFile, writeFile } from 'node:fs/promises'

const API = 'https://api.github.com'
const REPO = process.env.GITHUB_REPOSITORY ?? 'thickiran/claude-coaster-tycoon'
const TOKEN = process.env.GITHUB_TOKEN
const REGISTRY = 'leaderboard/registry.json'
const BOARD = 'leaderboard/leaderboard.json'
const GIST_FILE = 'park.json'
const STALE_DAYS = 30
const MAX_ENTRIES = 200
const MAX_PARKS_PER_PLAYER = 10

// The same formula as the mod's hooks/board.ts.
export function score(p) {
  return Math.round(p.rating * (1 + 0.25 * p.ridesOpen) + p.guestsTotal * 0.05 + p.riders * 0.02)
}

export function cleanName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40) || 'Unnamed Park'
}

const int = (v, lo, hi) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo
}

// One park from a gist, made safe, or null when it cannot be a real park.
export function sanitizePark(id, raw, user) {
  if (!/^[0-9a-f]{12}$/.test(id) || !raw || typeof raw !== 'object') return null
  const updatedAt = Date.parse(raw.updatedAt)
  if (!Number.isFinite(updatedAt) || updatedAt > Date.now() + 10 * 60_000) return null
  const p = {
    user,
    id,
    name: cleanName(raw.name),
    rating: int(raw.rating, 0, 999),
    guests: int(raw.guests, 0, 200),
    guestsTotal: int(raw.guestsTotal, 0, 50_000_000),
    ridesOpen: int(raw.ridesOpen, 0, 16),
    coasters: int(raw.coasters, 0, 4),
    riders: int(raw.riders, 0, 100_000_000),
    best: cleanName(raw.best).slice(0, 80),
    updatedAt: new Date(updatedAt).toISOString(),
  }
  // Riders come from guests: far more rides than visitors is a hand-edited gist.
  if (p.riders > p.guestsTotal * 12 + 100) return null
  if (p.coasters > p.ridesOpen) return null

  return { ...p, score: score(p) }
}

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${res.status}`)
  return res.status === 204 ? null : res.json()
}

async function readGistParks(gistId) {
  const gist = await gh(`/gists/${gistId}`)
  const file = gist.files?.[GIST_FILE]
  if (!file) return { owner: gist.owner?.login, parks: {} }
  let content = file.content
  if (file.truncated && file.raw_url?.startsWith('https://gist.githubusercontent.com/')) {
    content = await (await fetch(file.raw_url)).text()
  }
  try {
    return { owner: gist.owner?.login, parks: JSON.parse(content).parks ?? {} }
  } catch {
    return { owner: gist.owner?.login, parks: {} }
  }
}

async function registerFromIssue(registry) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const issue = event.issue
  if (!issue || !String(issue.title).startsWith('[park] join')) return
  const user = issue.user?.login
  const gistId = /"gist"\s*:\s*"([0-9a-f]{20,40})"/.exec(issue.body ?? '')?.[1]
  const reply = async (text) => {
    await gh(`/repos/${REPO}/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) })
    await gh(`/repos/${REPO}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) })
  }
  if (!user || !gistId) {
    await reply('Could not find a park gist in this issue. Run `/park join` from the mod to register.')
    return
  }
  const { owner } = await readGistParks(gistId)
  if (owner !== user) {
    await reply(`That gist belongs to ${owner ?? 'nobody'}, not @${user}, so it was not registered.`)
    return
  }
  registry[user] = { gist: gistId, joinedAt: registry[user]?.joinedAt ?? new Date().toISOString() }
  await writeFile(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`)
  await reply(`🎢 Welcome to the leaderboard, @${user}! Your park shows up at the next board update (within about 20 minutes).`)
}

async function rebuild(registry) {
  const entries = []
  for (const [user, { gist }] of Object.entries(registry)) {
    try {
      const { owner, parks } = await readGistParks(gist)
      if (owner !== user) continue
      const fresh = Object.entries(parks)
        .map(([id, raw]) => sanitizePark(id, raw, user))
        .filter(p => p && Date.now() - Date.parse(p.updatedAt) < STALE_DAYS * 86_400_000)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_PARKS_PER_PLAYER)
      entries.push(...fresh)
    } catch (err) {
      console.warn(`skipping ${user}: ${err.message}`)
    }
  }
  entries.sort((a, b) => b.score - a.score || a.user.localeCompare(b.user))
  const top = entries.slice(0, MAX_ENTRIES).map((e, i) => ({ rank: i + 1, ...e }))
  const players = new Set(entries.map(e => e.user)).size
  const previous = JSON.parse(await readFile(BOARD, 'utf8').catch(() => '{}'))
  if (JSON.stringify(previous.entries ?? []) === JSON.stringify(top) && previous.players === players) {
    console.log('leaderboard unchanged')
    return
  }
  await writeFile(BOARD, `${JSON.stringify({ updatedAt: new Date().toISOString(), players, entries: top }, null, 2)}\n`)
  console.log(`leaderboard: ${top.length} parks from ${players} players`)
}

async function main() {
  const registry = JSON.parse(await readFile(REGISTRY, 'utf8'))
  if (process.env.GITHUB_EVENT_NAME === 'issues') await registerFromIssue(registry)
  await rebuild(registry)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
