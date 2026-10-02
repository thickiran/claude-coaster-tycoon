// The park simulation: rides under construction, test runs, trains, guests.
// Plain data and functions, no `$`: register.tsx drives it, draw.ts and
// vector.ts paint it.
//
// Which model does the work picks the ride: a frontier model's crew builds
// big coasters, Sonnet's builds family rides, Haiku's builds small flat rides.
// Each model has its own crew, so a Haiku subagent builds beside Opus.

// The park grows along its boulevard: each column is 4 tiles wide and holds
// two plots, one either side. It opens with 4 columns and buys more land
// whenever a crew runs out of room, up to COLS_MAX.
export const COLS_START = 4
export const COLS_MAX = 12
export const GY = 13
export const BLVD = 6

export type Tier = 'big' | 'medium' | 'small'
export type Node = { x: number; y: number; h: number; isLoop?: true }
export type RideStatus = 'building' | 'testing' | 'open' | 'crashed'

export type Train = {
  s: number
  mode: 'load' | 'run'
  wait: number
  elapsed: number
  riders: number[]
  isTest: boolean
}

export type Ride = {
  id: number
  name: string
  kind: string
  tier: Tier
  cat: 'track' | 'flat'
  builtBy: string
  slot: number
  half: number
  color: number
  carColor: number
  support: number
  isWood: boolean
  cars: number
  capacity: number
  nodes: Node[]
  built: number
  size: number
  stationLen: number
  liftEnd: number
  splashAt: number
  cx: number
  cy: number
  qx: number
  qy: number
  status: RideStatus
  excitement: number
  intensity: number
  nausea: number
  price: number
  riders: number
  calls: number
  fails: number
  crashAt: number
  train?: Train
  queue: number[]
  willCrash?: boolean
}

export type Guest = {
  id: number
  x: number
  y: number
  tx: number
  state: 'walk' | 'toQueue' | 'queue' | 'ride' | 'leave'
  rideId: number
  rides: number
  maxRides: number
  shirt: number
  speed: number
  lastRide?: string
}

export type Particle = { x: number; y: number; h: number; vx: number; vy: number; vh: number; life: number; c: number }

export type World = {
  rides: Ride[]
  guests: Guest[]
  money: number
  guestsTotal: number
  nextGuest: number
  rideCounter: number
  trees: { x: number; y: number }[]
  flowers: { x: number; y: number; c: number }[]
  particles: Particle[]
  news: string
  newsAt: number
  thought: string
  time: number
  frame: number
  groundVer: number
  spawnAcc: number
  thoughtAcc: number
  finishAcc: number
  isFinishing: boolean
  isWorking: boolean
  toasts: string[]
  milestone: number
  isDirty: boolean
  camX: number
  camY: number
  cols: number
  isShared: boolean
  shareName: string
}

type Slot = { x0: number; y0: number; w: number; h: number; isTop: boolean }

// Plot i: column i / 2, above the boulevard when even, below it when odd.
export function slotAt(i: number): Slot {
  const isTop = i % 2 === 0
  return { x0: 1 + 4 * Math.floor(i / 2), y0: isTop ? 0 : 8, w: 4, h: 5, isTop }
}

// The map's width in tiles: a border column at each end of the plots.
export function gridW(w: { cols: number }): number {
  return 2 + 4 * w.cols
}

// Math.random may repeat itself in the plugin's environment, so the park
// rolls its own dice, seeded from the host's entropy.
let seed = (() => {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0]! ^ Date.now()
  } catch {
    return Date.now() >>> 0
  }
})()

export function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type Layout = 'oval' | 'figure8' | 'outback' | 'helix' | 'twister' | 'zigzag'
type Profile = 'coaster' | 'mouse' | 'flume'

type TrackSpec = {
  kind: string
  isWood: boolean
  hmax: [number, number]
  loops: [number, number]
  corkscrews: [number, number]
  layouts: Layout[]
  cars: number
  profile: Profile
  speed: number
  base: number
}

const BIG: TrackSpec[] = [
  { kind: 'Wooden Roller Coaster', isWood: true, hmax: [4.5, 6], loops: [0, 0], corkscrews: [0, 0], layouts: ['oval', 'figure8', 'outback', 'twister'], cars: 4, profile: 'coaster', speed: 1, base: 1.4 },
  { kind: 'Steel Twister', isWood: false, hmax: [5, 7], loops: [1, 2], corkscrews: [1, 1], layouts: ['twister', 'helix', 'figure8'], cars: 4, profile: 'coaster', speed: 1.1, base: 1.2 },
  { kind: 'Corkscrew Coaster', isWood: false, hmax: [4.5, 6], loops: [0, 1], corkscrews: [1, 2], layouts: ['twister', 'oval', 'helix'], cars: 4, profile: 'coaster', speed: 1, base: 1.2 },
  { kind: 'Mine Train Coaster', isWood: true, hmax: [3, 4.2], loops: [0, 0], corkscrews: [0, 0], layouts: ['twister', 'helix', 'zigzag'], cars: 5, profile: 'coaster', speed: 0.9, base: 1.6 },
  { kind: 'Looping Coaster', isWood: false, hmax: [5.5, 7], loops: [2, 2], corkscrews: [0, 1], layouts: ['oval', 'figure8', 'twister'], cars: 4, profile: 'coaster', speed: 1.1, base: 1.1 },
  { kind: 'Hyper Coaster', isWood: false, hmax: [7.5, 9.2], loops: [0, 0], corkscrews: [0, 0], layouts: ['outback', 'oval', 'figure8', 'helix'], cars: 5, profile: 'coaster', speed: 1.2, base: 1.3 },
]

const MEDIUM_TRACK: TrackSpec[] = [
  { kind: 'Wild Mouse', isWood: false, hmax: [2.6, 3.2], loops: [0, 0], corkscrews: [0, 0], layouts: ['zigzag'], cars: 1, profile: 'mouse', speed: 0.8, base: 2.4 },
  { kind: 'Junior Coaster', isWood: false, hmax: [1.8, 2.6], loops: [0, 0], corkscrews: [0, 0], layouts: ['oval', 'twister', 'figure8'], cars: 3, profile: 'coaster', speed: 0.85, base: 2.1 },
  { kind: 'Log Flume', isWood: true, hmax: [2.4, 3.2], loops: [0, 0], corkscrews: [0, 0], layouts: ['twister', 'oval', 'helix'], cars: 2, profile: 'flume', speed: 0.7, base: 2.6 },
]

type FlatSpec = { kind: string; e: number; i: number; n: number; capacity: number; size: number }

const MEDIUM_FLAT: FlatSpec[] = [
  { kind: 'Ferris Wheel', e: 2.3, i: 0.8, n: 0.5, capacity: 8, size: 16 },
  { kind: 'Swinging Ship', e: 3.6, i: 4.1, n: 4.2, capacity: 12, size: 16 },
  { kind: 'Observation Tower', e: 2.6, i: 0.7, n: 0.3, capacity: 8, size: 16 },
]

const SMALL_FLAT: FlatSpec[] = [
  { kind: 'Merry-Go-Round', e: 1.4, i: 0.6, n: 0.4, capacity: 12, size: 10 },
  { kind: 'Spiral Slide', e: 1.5, i: 1.4, n: 0.9, capacity: 4, size: 10 },
  { kind: 'Dodgems', e: 2.4, i: 1.9, n: 0.7, capacity: 6, size: 10 },
  { kind: 'Twist', e: 2.8, i: 4.1, n: 4.5, capacity: 9, size: 10 },
]

const NAMES: Record<Tier, string[]> = {
  big: [
    'Null Pointer Plunge', 'The Segfault', 'Merge Conflict', 'Stack Overflow',
    'Race Condition', 'Infinite Loop', 'The Big O', 'Heap Drop', 'Recursion Rush',
    'The Refactorer', 'Dependency Hell', 'Kernel Panic', 'Fork Bomb', 'Deadlock Drop',
    'Undefined Behaviour', 'Production Push', 'The Monolith', 'Force Push',
  ],
  medium: [
    'Off-By-One', 'Hotfix Express', 'Cache Miss', 'Git Blame', 'Callback Canyon',
    'Tail Call', 'Rebase Rapids', 'Async Await', 'The Linter', 'Garbage Collector',
    'Type Coercion', 'The Monad', 'Lazy Loader', 'Event Loop',
  ],
  small: [
    'Little Lambda', 'Tiny Tuple', 'Hello World', 'The Semicolon', 'Bit Flip',
    'Small Talk', 'The Null Check', 'Quick Sort', 'Byte Size', 'Tab Spinner',
    'Pixel Pals', 'The Typo', 'Mini Map', 'Unit Test',
  ],
}

const TRACK_COLORS = [0xe03030, 0xf0c020, 0x3a68e8, 0xe060c0, 0xf08020, 0xf4f4f4, 0x9a48e8, 0x20c8e8, 0x30c060]
const CAR_COLORS = [0xf4f4f4, 0x2040c0, 0xe02020, 0xf0d020, 0x20a040, 0x101010, 0xf08020]
export const SHIRTS = [0xe02828, 0x2858e0, 0xf0d028, 0x28b048, 0xe07818, 0xb030c8, 0xf4f4f4, 0x18c0c0, 0xf080a0]

const LABELS = ['Low', 'Medium', 'High', 'Very High', 'Extreme', 'Ultra-Extreme']

export function ratingLabel(v: number): string {
  return LABELS[v < 2.5 ? 0 : v < 5 ? 1 : v < 6.5 ? 2 : v < 8 ? 3 : v < 9.5 ? 4 : 5]!
}

export function tierOf(model: string): Tier {
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 'small'
  if (m.includes('sonnet')) return 'medium'

  return 'big'
}

export function crewName(model: string): string {
  const family = /(opus|sonnet|haiku|fable|mythos)/i.exec(model)?.[1]

  return family ? family[0]!.toUpperCase() + family.slice(1).toLowerCase() : model || 'Claude'
}

export function createWorld(): World {
  const w: World = {
    rides: [], guests: [], money: 10000, guestsTotal: 0, nextGuest: 1, rideCounter: 0,
    trees: [], flowers: [], particles: [],
    news: 'The gates are open! Give Claude some work and the crews start building.',
    newsAt: 0, thought: '', time: 0, frame: 0, groundVer: 1,
    spawnAcc: 0, thoughtAcc: 0, finishAcc: 0, isFinishing: false, isWorking: false,
    toasts: [], milestone: 0, isDirty: true, camX: 9, camY: GY / 2,
    cols: COLS_START, isShared: false, shareName: '',
  }
  plant(w, 0, gridW(w))

  return w
}

// Trees and flowers on the land between columns x0 and x1.
function plant(w: World, x0: number, x1: number) {
  const area = (x1 - x0) * GY
  for (let i = 0; i < area * 0.38; i++) {
    const x = x0 + rnd() * (x1 - x0)
    const y = rnd() * GY
    if (Math.floor(y) === BLVD || (Math.floor(x) === 0 && Math.abs(y - BLVD - 0.5) < 1.5)) continue
    if (w.rides.some(r => {
      const f = footprint(r)
      return x >= f.x0 - 0.2 && x < f.x0 + f.w + 0.2 && y >= f.y0 - 0.2 && y < f.y0 + f.h + 0.2
    })) continue
    w.trees.push({ x, y })
  }
  for (let x = Math.max(1, Math.floor(x0)); x < x1; x++) {
    for (const y of [BLVD - 0.12, BLVD + 1.12]) {
      if (rnd() < 0.5) w.flowers.push({ x: x + rnd(), y, c: pick([0xff4060, 0xffe040, 0xffffff, 0xc060ff]) })
    }
  }
}

// Buys the next strip of land at the end of the boulevard: two new plots.
function expand(w: World) {
  const before = gridW(w)
  w.cols += 1
  w.trees = w.trees.filter(t => t.x < before - 1)
  plant(w, before - 1, gridW(w))
  w.groundVer += 1
  w.isDirty = true
  say(w, `🌳 The park bought more land! ${w.cols * 2} plots now.`)
  w.toasts.push(`🌳 The park expanded: ${w.cols * 2} plots`)
}

const SAVE_VERSION = 2

export function saveWorld(w: World) {
  return {
    v: SAVE_VERSION,
    money: Math.round(w.money),
    guestsTotal: w.guestsTotal,
    nextGuest: w.nextGuest,
    rideCounter: w.rideCounter,
    milestone: w.milestone,
    cols: w.cols,
    isShared: w.isShared,
    shareName: w.shareName,
    trees: w.trees.map(t => [+t.x.toFixed(2), +t.y.toFixed(2)]),
    flowers: w.flowers.map(f => [+f.x.toFixed(2), +f.y.toFixed(2), f.c]),
    rides: w.rides.map(({ train, queue, willCrash, ...rest }) => ({
      ...rest,
      nodes: rest.nodes.map(n => ({ ...n, x: +n.x.toFixed(3), y: +n.y.toFixed(3), h: +n.h.toFixed(3) })),
      status: rest.status === 'testing' ? 'building' : rest.status,
    })),
  }
}

export function loadWorld(saved: unknown): World {
  const w = createWorld()
  const s = saved as ReturnType<typeof saveWorld> | undefined
  if (!s || s.v !== SAVE_VERSION) return w
  w.money = s.money
  w.guestsTotal = s.guestsTotal
  w.nextGuest = s.nextGuest
  w.rideCounter = s.rideCounter
  w.milestone = s.milestone ?? 0
  w.cols = Math.min(COLS_MAX, Math.max(COLS_START, s.cols ?? COLS_START))
  w.isShared = s.isShared ?? false
  w.shareName = s.shareName ?? ''
  w.trees = s.trees.map(([x, y]) => ({ x: x!, y: y! }))
  w.flowers = s.flowers.map(([x, y, c]) => ({ x: x!, y: y!, c: c! }))
  w.rides = s.rides.map(r => ({ ...(r as Ride), queue: [] }))
  for (const r of w.rides) {
    if (r.status === 'open') r.train = newTrain(false)
  }
  if (w.rides.length > 0) w.news = 'The park reopens its gates!'
  w.isFinishing = w.rides.some(r => r.status === 'building')

  return w
}

function newTrain(isTest: boolean): Train {
  return { s: 0, mode: isTest ? 'run' : 'load', wait: 1, elapsed: 0, riders: [], isTest }
}

export function footprint(r: Ride): { x0: number; y0: number; w: number; h: number } {
  const s = slotAt(r.slot)

  return r.half < 0 ? s : { x0: s.x0 + r.half * 2, y0: s.y0, w: 2, h: s.h }
}

export function queueTile(r: Ride): { x: number; y: number } {
  return { x: r.qx, y: r.qy }
}

// ---- Track layouts -------------------------------------------------------
// Each is a closed path in the slot's own coordinates: u across (0..4), v
// away from the boulevard (0..5). Every one starts along v = 0.5, where the
// station sits next to the queue.

type Pt = { u: number; v: number; isHelix?: true }

function layoutPath(layout: Layout): Pt[] {
  switch (layout) {
    case 'oval':
      return [{ u: 0.5, v: 0.5 }, { u: 3.5, v: 0.5 }, { u: 3.5, v: 4.5 }, { u: 0.5, v: 4.5 }]
    case 'figure8':
      return [
        { u: 0.5, v: 0.5 }, { u: 3.5, v: 0.5 }, { u: 3.5, v: 1.8 }, { u: 0.5, v: 3.2 },
        { u: 0.5, v: 4.5 }, { u: 3.5, v: 4.5 }, { u: 3.5, v: 3.2 }, { u: 0.5, v: 1.8 },
      ]
    case 'outback':
      return [{ u: 0.5, v: 0.5 }, { u: 3.5, v: 0.5 }, { u: 2.7, v: 4.6 }, { u: 1.3, v: 4.6 }]
    case 'helix': {
      const path: Pt[] = [{ u: 0.5, v: 0.5 }, { u: 3.5, v: 0.5 }, { u: 3.5, v: 2.4 }]
      const turns = 1.5
      for (let k = 0; k <= 18; k++) {
        const t = (k / 18) * Math.PI * 2 * turns
        path.push({ u: 2 + Math.cos(t) * 1.1, v: 3.4 + Math.sin(t) * 1.05, isHelix: true })
      }
      path.push({ u: 0.5, v: 2.4 })

      return path
    }
    case 'zigzag':
      return [
        { u: 0.5, v: 0.5 }, { u: 3.5, v: 0.5 }, { u: 3.5, v: 1.5 }, { u: 1.1, v: 1.5 },
        { u: 1.1, v: 2.5 }, { u: 3.5, v: 2.5 }, { u: 3.5, v: 3.5 }, { u: 1.1, v: 3.5 },
        { u: 1.1, v: 4.5 }, { u: 0.4, v: 4.5 }, { u: 0.4, v: 1.2 },
      ]
    case 'twister': {
      // A rectangle with every corner pulled in by a random amount, then
      // smoothed: no two come out alike.
      const ring: Pt[] = []
      const side = (a: Pt, b: Pt, k: number) => {
        for (let i = 0; i < k; i++) ring.push({ u: a.u + ((b.u - a.u) * i) / k, v: a.v + ((b.v - a.v) * i) / k })
      }
      side({ u: 3.5, v: 0.5 }, { u: 3.5, v: 4.5 }, 4)
      side({ u: 3.5, v: 4.5 }, { u: 0.5, v: 4.5 }, 3)
      side({ u: 0.5, v: 4.5 }, { u: 0.5, v: 0.5 }, 4)
      const wobbly = ring.map(p => {
        const pull = rnd() * 0.85
        return { u: p.u + (2 - p.u) * pull * 0.6, v: p.v + (2.6 - p.v) * pull * 0.45 }
      })
      let path: Pt[] = [{ u: 0.5, v: 0.5 }, { u: 2.5, v: 0.5 }, ...wobbly.slice(1), { u: 0.5, v: 1 }]
      for (let pass = 0; pass < 2; pass++) {
        const next: Pt[] = [path[0]!, path[1]!]
        for (let i = 1; i < path.length - 1; i++) {
          const a = path[i]!
          const b = path[i + 1]!
          next.push({ u: a.u * 0.75 + b.u * 0.25, v: a.v * 0.75 + b.v * 0.25 }, { u: a.u * 0.25 + b.u * 0.75, v: a.v * 0.25 + b.v * 0.75 })
        }
        next.push(path[path.length - 1]!)
        path = next
      }

      return path
    }
  }
}

function resample(path: Pt[], step: number): Pt[] {
  const out: Pt[] = []
  let carry = 0
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!
    const b = path[(i + 1) % path.length]!
    const len = Math.hypot(b.u - a.u, b.v - a.v)
    let d = carry
    while (d < len) {
      const t = d / len
      out.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t, ...(a.isHelix && b.isHelix ? { isHelix: true as const } : {}) })
      d += step
    }
    carry = d - len
  }

  return out
}

// An inversion spliced in after node `at`: a vertical loop rises in the plane
// of travel, a corkscrew rolls sideways across it.
function inversion(nodes: Node[], at: number, isCorkscrew: boolean): Node[] {
  const a = nodes[at]!
  const b = nodes[(at + 1) % nodes.length]!
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const dx = (b.x - a.x) / len
  const dy = (b.y - a.y) / len
  const out: Node[] = []
  for (let k = 1; k <= 12; k++) {
    const t = (k / 13) * Math.PI * 2
    if (isCorkscrew) {
      const along = (k / 13) * 1.2
      out.push({
        x: a.x + dx * along - dy * Math.sin(t) * 0.45,
        y: a.y + dy * along + dx * Math.sin(t) * 0.45,
        h: a.h + (1 - Math.cos(t)) * 0.7,
        isLoop: true,
      })
    } else {
      const side = (k / 13 - 0.5) * 0.35
      out.push({
        x: a.x + dx * 0.75 * Math.sin(t) - dy * side,
        y: a.y + dy * 0.75 * Math.sin(t) + dx * side,
        h: a.h + (1 - Math.cos(t)) * 1.6,
        isLoop: true,
      })
    }
  }

  return out
}

function makeTrack(slot: Slot, spec: TrackSpec) {
  const layout = pick(spec.layouts)
  const isMirror = rnd() < 0.5
  const pts = resample(layoutPath(layout), 0.5)
  const toWorld = (p: Pt): Node => {
    const u = isMirror ? 4 - p.u : p.u
    return { x: slot.x0 + u, y: slot.isTop ? slot.y0 + slot.h - p.v : slot.y0 + p.v, h: 0 }
  }
  const nodes = pts.map(toWorld)
  const n = nodes.length
  const stationLen = 4
  const hmax = between(...spec.hmax)
  const hs = 0.35
  const lift = clamp(Math.round(n * 0.22), 5, 12)
  const liftEnd = stationLen + lift
  let splashAt = -1
  const helix = pts.map(p => p.isHelix === true)
  const hills = 1 + Math.floor(rnd() * 3)
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!
    if (i < stationLen) {
      node.h = hs
      continue
    }
    if (i < liftEnd) {
      node.h = hs + ((hmax - hs) * (i - stationLen + 1)) / lift
      continue
    }
    if (i >= n - 2) {
      node.h = hs + 0.1
      continue
    }
    const t = (i - liftEnd) / Math.max(1, n - 2 - liftEnd)
    if (spec.profile === 'mouse') {
      node.h = t < 0.65 ? hmax - t * 0.9 : (hmax - 0.6) * (1 - (t - 0.65) / 0.35) + 0.4 + (i % 3 === 0 ? 0.25 : 0)
    } else if (spec.profile === 'flume') {
      node.h = t < 0.6 ? hmax - t * 0.8 : t < 0.7 ? hmax * 0.55 * (1 - (t - 0.6) / 0.1) + 0.2 : 0.25
      if (splashAt < 0 && t >= 0.7) splashAt = i
    } else if (i === liftEnd) {
      node.h = hmax * 0.55
    } else if (i === liftEnd + 1) {
      node.h = 0.6
    } else {

      node.h = 0.6 + Math.abs(Math.sin(t * Math.PI * hills)) * hmax * 0.55 * (1 - t * 0.6)
    }
    if (helix[i]) node.h = Math.max(0.5, node.h * 0.6)
  }

  let loops = Math.round(between(spec.loops[0], spec.loops[1]))
  let screws = Math.round(between(spec.corkscrews[0], spec.corkscrews[1]))
  const spots: number[] = []
  for (let i = liftEnd + 1; i < nodes.length - 4; i++) {
    if (!helix[i] && nodes[i]!.h < 1.3 && spots.every(s => Math.abs(s - i) > 5)) spots.push(i)
  }
  const inserts: { at: number; isCorkscrew: boolean }[] = []
  for (const at of spots) {
    if (loops > 0) {
      inserts.push({ at, isCorkscrew: false })
      loops -= 1
    } else if (screws > 0) {
      inserts.push({ at, isCorkscrew: true })
      screws -= 1
    }
  }
  inserts.sort((a, b) => b.at - a.at)
  for (const ins of inserts) nodes.splice(ins.at + 1, 0, ...inversion(nodes, ins.at, ins.isCorkscrew))
  const inversions = inserts.length
  if (splashAt >= 0) splashAt = nodes.findIndex((nd, i) => i > liftEnd && nd.h <= 0.3)

  const stationU = isMirror ? 4 - 1.25 : 1.25
  const qx = slot.x0 + Math.floor(stationU)
  const qy = slot.isTop ? BLVD - 1 : BLVD + 1

  return { nodes, stationLen, liftEnd, splashAt, qx, qy, layout, hmax, inversions, hasHelix: helix.some(Boolean) }
}

// ---- Building ------------------------------------------------------------

function say(w: World, text: string) {
  w.news = text
  w.newsAt = w.time
}

function building(w: World, tier: Tier) {
  return w.rides.find(r => r.status === 'building' && r.tier === tier)
}

function isBusy(r: Ride) {
  return r.status === 'building' || r.status === 'testing'
}

function demolish(w: World, gone: Ride[]) {
  for (const r of gone) {
    evict(w, r)
    say(w, `${r.name} was demolished to make room for something new.`)
    w.toasts.push(`🚧 Demolished ${r.name} to make room`)
  }
  const ids = new Set(gone.map(r => r.id))
  w.rides = w.rides.filter(r => !ids.has(r.id))
}

// Finds room for a ride: half of a shared plot for a flat ride, else an
// empty plot, else the park buys more land. Only a park at its full size
// makes room by demolishing, and then only the crew's own weakest ride.
function place(w: World, isHalf: boolean, tier: Tier): { slot: number; half: number } | undefined {
  const inSlot = (s: number) => w.rides.filter(r => r.slot === s)
  const score = (r: Ride) => (r.status === 'crashed' ? -1 : r.excitement)
  const worstOf = (list: Ride[]) => list.reduce((a, b) => (score(b) < score(a) ? b : a))
  if (isHalf) {
    for (let s = 0; s < w.cols * 2; s++) {
      const rides = inSlot(s)
      if (rides.length === 1 && rides[0]!.half >= 0) return { slot: s, half: 1 - rides[0]!.half }
    }
  }
  let empty = -1
  for (let s = 0; s < w.cols * 2 && empty < 0; s++) if (inSlot(s).length === 0) empty = s
  if (empty < 0 && w.cols < COLS_MAX) {
    expand(w)
    empty = (w.cols - 1) * 2
  }
  if (empty >= 0) return { slot: empty, half: isHalf ? 0 : -1 }
  if (isHalf) {
    const mine = w.rides.filter(r => r.half >= 0 && r.tier === tier && !isBusy(r))
    if (mine.length === 0) return undefined
    const worst = worstOf(mine)
    demolish(w, [worst])

    return { slot: worst.slot, half: worst.half }
  }
  const mine = w.rides.filter(r => r.half < 0).filter(r => r.tier === tier && !isBusy(r))
  if (mine.length === 0) return undefined
  const worst = worstOf(mine)
  demolish(w, [worst])

  return { slot: worst.slot, half: -1 }
}

function startRide(w: World, tier: Tier, who: string): Ride | undefined {
  const broken = w.rides.find(r => r.status === 'crashed' && r.tier === tier)
  if (broken) {
    broken.status = 'building'
    broken.built = Math.max(1, Math.min(broken.built, broken.size - 6))
    broken.calls = 0
    broken.fails = 0
    broken.builtBy = who
    say(w, `The ${who} crew is repairing ${broken.name}.`)
    w.isDirty = true

    return broken
  }
  let track = tier === 'big' ? pick(BIG) : tier === 'medium' && rnd() < 0.5 ? pick(MEDIUM_TRACK) : undefined
  let flat = track ? undefined : pick(tier === 'medium' ? MEDIUM_FLAT : SMALL_FLAT)
  let spot = place(w, flat !== undefined, tier)
  if (!spot && tier === 'medium') {
    // No plot for a family coaster: Sonnet's crew builds a flat ride instead,
    // or the other way about.
    ;[track, flat] = track ? [undefined, pick(MEDIUM_FLAT)] : [pick(MEDIUM_TRACK), undefined]
    spot = place(w, flat !== undefined, tier)
  }
  if (!spot) return undefined
  const slot = slotAt(spot.slot)
  const used = new Set(w.rides.map(r => r.name))
  const fresh = NAMES[tier].filter(n => !used.has(n))
  w.rideCounter += 1
  const kind = track?.kind ?? flat!.kind
  const ride: Ride = {
    id: w.rideCounter,
    name: fresh.length > 0 ? pick(fresh) : `${kind} ${w.rideCounter}`,
    kind, tier, cat: track ? 'track' : 'flat', builtBy: who,
    slot: spot.slot, half: spot.half,
    color: pick(TRACK_COLORS), carColor: pick(CAR_COLORS),
    support: track?.isWood ? 0x8a5a2a : 0xb8b8c0, isWood: track?.isWood ?? false,
    cars: track?.cars ?? 0, capacity: track ? track.cars * 2 : flat!.capacity,
    nodes: [], built: 0, size: flat?.size ?? 0, stationLen: 0, liftEnd: 0, splashAt: -1,
    cx: 0, cy: 0, qx: 0, qy: 0, status: 'building',
    excitement: 0, intensity: 0, nausea: 0, price: 0, riders: 0,
    calls: 0, fails: 0, crashAt: 0, queue: [],
  }
  if (track) {
    const t = makeTrack(slot, track)
    Object.assign(ride, { nodes: t.nodes, size: t.nodes.length, stationLen: t.stationLen, liftEnd: t.liftEnd, splashAt: t.splashAt, qx: t.qx, qy: t.qy })
    ride.excitement = track.base + t.hmax * 0.5 + t.inversions * 0.9 + (t.hasHelix ? 0.6 : 0) + (t.layout === 'figure8' ? 0.4 : 0)
    ride.intensity = 1 + t.hmax * 0.7 + t.inversions * 1.1 + (t.hasHelix ? 0.8 : 0)
    ride.nausea = 0.4 + t.inversions * 1.1 + (t.hasHelix ? 1 : 0)
    if (track.kind === 'Log Flume') ride.carColor = 0x8a5a2a
    if (track.kind === 'Log Flume') ride.color = 0x3a90e0
  } else {
    const u = spot.half * 2 + 1
    ride.cx = slot.x0 + u
    ride.cy = slot.isTop ? slot.y0 + slot.h - 1.7 : slot.y0 + 1.7
    ride.qx = slot.x0 + spot.half * 2 + (slot.isTop ? 1 : 0)
    ride.qy = slot.isTop ? BLVD - 1 : BLVD + 1
    ride.excitement = flat!.e
    ride.intensity = flat!.i
    ride.nausea = flat!.n
  }
  const f = footprint(ride)
  w.trees = w.trees.filter(t => !(t.x >= f.x0 - 0.2 && t.x < f.x0 + f.w + 0.2 && t.y >= f.y0 - 0.2 && t.y < f.y0 + f.h + 0.2))
  w.rides.push(ride)
  w.groundVer += 1
  w.isDirty = true
  say(w, `The ${who} crew started building ${ride.name} (${ride.kind}).`)

  return ride
}

function evict(w: World, r: Ride) {
  const ids = new Set([...r.queue, ...(r.train?.riders ?? [])])
  for (const g of w.guests) {
    if (ids.has(g.id) || g.rideId === r.id) {
      if (g.state === 'ride' || g.state === 'queue') {
        g.x = r.qx + 0.5
        g.y = BLVD + 0.5
      }
      g.state = 'walk'
      g.rideId = -1
      g.tx = g.x
    }
  }
  r.queue = []
  if (r.train) r.train.riders = []
}

const PIECES: Record<string, number> = {
  Edit: 3, Write: 4, MultiEdit: 4, NotebookEdit: 3, Bash: 2, Agent: 4, Task: 4,
}

export function toolCalled(w: World, tool: string, model: string): string {
  w.isWorking = true
  const tier = tierOf(model)
  const who = crewName(model)
  const ride = building(w, tier) ?? startRide(w, tier, who)
  if (!ride) return ''
  const k = PIECES[tool] ?? 1
  ride.built = Math.min(ride.size, ride.built + k)
  ride.calls += 1
  w.money -= k * (tier === 'big' ? 60 : tier === 'medium' ? 40 : 25)
  w.isDirty = true
  if (ride.built >= ride.size) startTest(w, ride)

  return ride.name
}

export function toolFailed(w: World, rideName: string) {
  const ride = w.rides.find(r => r.name === rideName)
  if (ride) ride.fails += 1
}

export function turnEnded(w: World, reason: string) {
  w.isWorking = false
  const open = w.rides.filter(r => r.status === 'building')
  if (open.length === 0) return
  if (reason === 'aborted' || reason === 'error') {
    for (const r of open) startTest(w, r)
  } else {
    w.isFinishing = true
  }
}

export function turnStarted(w: World) {
  w.isWorking = true
}

function startTest(w: World, r: Ride) {
  r.status = 'testing'
  r.train = newTrain(true)
  const isShaky = r.fails >= 3 && r.fails / Math.max(1, r.calls) >= 0.35
  r.willCrash = r.built < r.size || isShaky
  if (r.cat === 'track') {
    r.crashAt = r.built < r.size ? Math.max(1, r.built - 1) : Math.min(r.size - 2, r.liftEnd + 3)
  }
  say(w, r.built < r.size ? `Test run on ${r.name}... but it isn't finished!` : `Test run: ${r.name}`)
  w.isDirty = true
}

function open(w: World, r: Ride) {
  const jitter = () => rnd() * 0.9 - 0.3
  const penalty = r.fails * 0.12
  r.intensity = clamp(r.intensity + jitter(), 0.3, 11)
  r.excitement = clamp(r.excitement + jitter() - penalty - Math.max(0, r.intensity - 9) * 0.6, 0.3, 9.9)
  r.nausea = clamp(r.nausea + r.intensity * 0.15 + jitter(), 0.2, 10)
  r.price = Math.max(1, Math.round(r.excitement * 1.3))
  r.status = 'open'
  r.train = newTrain(false)
  say(w, `${r.name} is open! Excitement ${r.excitement.toFixed(2)} (${ratingLabel(r.excitement)}), intensity ${r.intensity.toFixed(2)}.`)
  w.toasts.push(`${r.cat === 'track' ? '🎢' : '🎡'} ${r.name} (${r.kind}, built by ${r.builtBy}) is OPEN · Excitement ${r.excitement.toFixed(2)} (${ratingLabel(r.excitement)})`)
  w.isDirty = true
}

function crash(w: World, r: Ride, at: Node, why: string) {
  explode(w, at, r.cat === 'track' ? 46 : 20)
  r.status = 'crashed'
  r.train = undefined
  r.willCrash = false
  say(w, `💥 ${r.name} ${why}! The test was empty, luckily.`)
  w.toasts.push(`💥 ${r.name} ${why}`)
  w.isDirty = true
}

export function nodeAt(r: Ride, s: number): Node {
  const n = r.nodes.length
  const i = ((Math.floor(s) % n) + n) % n
  const f = s - Math.floor(s)
  const a = r.nodes[i]!
  const b = r.nodes[(i + 1) % n]!

  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, h: a.h + (b.h - a.h) * f }
}

function speedAt(r: Ride, s: number): number {
  const n = r.nodes.length
  const i = Math.floor(s)
  const k = r.kind === 'Log Flume' ? 0.7 : r.tier === 'medium' ? 0.85 : 1
  if (i < r.liftEnd) return 2.2
  if (i >= n - 3) return 2.8
  const top = r.nodes[r.liftEnd - 1]!.h

  return 2.2 + 3.4 * k * Math.sqrt(Math.max(0, top - nodeAt(r, s).h))
}

function explode(w: World, at: Node, count: number) {
  for (let i = 0; i < count; i++) {
    const t = rnd() * Math.PI * 2
    const v = 0.4 + rnd() * 1.6
    w.particles.push({
      x: at.x, y: at.y, h: at.h,
      vx: Math.cos(t) * v * 0.6, vy: Math.sin(t) * v * 0.6, vh: 1 + rnd() * 3,
      life: 1 + rnd() * 1.4, c: pick([0xffe040, 0xff9020, 0xff3010, 0x808080, 0xffffff]),
    })
  }
}

function splash(w: World, at: Node) {
  for (let i = 0; i < 10; i++) {
    const t = rnd() * Math.PI * 2
    w.particles.push({
      x: at.x, y: at.y, h: 0.2, vx: Math.cos(t) * 0.5, vy: Math.sin(t) * 0.5, vh: 1.5 + rnd() * 2,
      life: 0.6 + rnd() * 0.4, c: pick([0xffffff, 0xa0d8ff, 0x60b0f0]),
    })
  }
}

// Riders leave, the queue boards; the ride takes its fares.
function board(w: World, r: Ride) {
  const t = r.train!
  for (const id of t.riders) {
    const g = w.guests.find(one => one.id === id)
    if (!g) continue
    g.state = 'walk'
    g.x = r.qx + 0.5
    g.y = BLVD + 0.2 + rnd() * 0.6
    g.rides += 1
    g.lastRide = r.name
    choose(w, g)
  }
  t.riders = r.queue.splice(0, r.capacity)
  for (const id of t.riders) {
    const g = w.guests.find(one => one.id === id)
    if (g) g.state = 'ride'
  }
  w.money += t.riders.length * r.price
  r.riders += t.riders.length
}

const FLAT_RUN = 7
const FLAT_TEST = 4

function stepFlat(w: World, r: Ride, dt: number) {
  const t = r.train!
  if (t.mode === 'load') {
    t.wait -= dt
    if (t.wait <= 0) {
      t.mode = 'run'
      t.elapsed = 0
    }
    return
  }
  t.elapsed += dt
  t.s += dt
  const center: Node = { x: r.cx, y: r.cy, h: 1 }
  if (t.isTest) {
    if (r.willCrash && t.elapsed >= FLAT_TEST / 2) {
      crash(w, r, center, r.built < r.size ? 'collapsed: it was never finished' : 'broke down: too many failed inspections')
    } else if (t.elapsed >= FLAT_TEST) {
      open(w, r)
    }
    return
  }
  if (t.elapsed < FLAT_RUN) return
  board(w, r)
  t.mode = 'load'
  t.wait = 2
}

function stepTrack(w: World, r: Ride, dt: number) {
  const t = r.train!
  const n = r.nodes.length
  if (t.mode === 'load') {
    t.wait -= dt
    if (t.wait <= 0) t.mode = 'run'
    return
  }
  const before = t.s
  t.s += speedAt(r, t.s) * dt
  if (r.splashAt > 0 && before < r.splashAt && t.s >= r.splashAt) splash(w, nodeAt(r, r.splashAt))
  if (t.isTest && r.willCrash && t.s >= r.crashAt) {
    const why = r.built < r.size ? 'flew off the unfinished track' : 'derailed: too many failed inspections'
    crash(w, r, nodeAt(r, r.crashAt), why)
    return
  }
  if (t.s < n) return
  t.s = 0
  if (t.isTest) {
    open(w, r)
    return
  }
  board(w, r)
  t.mode = 'load'
  t.wait = 1.8
}

function choose(w: World, g: Guest) {
  const open = w.rides.filter(r => r.status === 'open' && r.queue.length < 22)
  if (g.rides >= g.maxRides || (open.length === 0 && rnd() < 0.4)) {
    g.state = 'leave'
    g.tx = 0.25
    g.rideId = -1
    return
  }
  if (open.length === 0) {
    g.state = 'walk'
    g.tx = 1 + rnd() * (gridW(w) - 2)
    g.rideId = -1
    g.rides += 0.5
    return
  }
  const weights = open.map(r => (r.excitement + 1.5) ** 1.6 * (r.intensity > 8.5 ? 0.35 : 1))
  let roll = rnd() * weights.reduce((a, b) => a + b, 0)
  let target = open[0]!
  for (let i = 0; i < open.length; i++) {
    roll -= weights[i]!
    if (roll <= 0) {
      target = open[i]!
      break
    }
  }
  g.state = 'walk'
  g.rideId = target.id
  g.tx = target.qx + 0.5
}

function stepGuests(w: World, dt: number) {
  const open = w.rides.filter(r => r.status === 'open')
  const pull = open.reduce((a, r) => a + r.excitement / 5, 0)
  const rate = open.length === 0 ? 0.04 : Math.min(0.75 * w.cols, 0.2 + pull * 0.4)
  w.spawnAcc += rate * dt
  while (w.spawnAcc >= 1) {
    w.spawnAcc -= 1
    if (w.guests.length >= Math.min(400, 50 * w.cols)) continue
    const g: Guest = {
      id: w.nextGuest++, x: 0.2, y: BLVD + 0.15 + rnd() * 0.7, tx: 0,
      state: 'walk', rideId: -1, rides: 0, maxRides: 2 + Math.floor(rnd() * 4),
      shirt: pick(SHIRTS), speed: 1 + rnd() * 0.8,
    }
    choose(w, g)
    w.guests.push(g)
    w.guestsTotal += 1
    w.money += 20
  }
  const byId = new Map(w.rides.map(r => [r.id, r]))
  const gone = new Set<number>()
  for (const g of w.guests) {
    if (g.state === 'ride' || g.state === 'queue') {
      const r = byId.get(g.rideId)
      if (!r || r.status !== 'open') {
        g.state = 'walk'
        g.y = BLVD + 0.5
        choose(w, g)
      }
      continue
    }
    if (g.state === 'toQueue') {
      const r = byId.get(g.rideId)
      if (!r || r.status !== 'open') {
        choose(w, g)
        continue
      }
      const dy = r.qy + 0.5 - g.y
      g.y += Math.sign(dy) * Math.min(Math.abs(dy), g.speed * dt)
      if (Math.abs(dy) < 0.05) {
        g.state = 'queue'
        r.queue.push(g.id)
      }
      continue
    }
    const dx = g.tx - g.x
    g.x += Math.sign(dx) * Math.min(Math.abs(dx), g.speed * dt)
    if (Math.abs(dx) > 0.04) continue
    if (g.state === 'leave') {
      gone.add(g.id)
      continue
    }
    const r = byId.get(g.rideId)
    if (r && r.status === 'open' && r.queue.length < 22) g.state = 'toQueue'
    else choose(w, g)
  }
  if (gone.size > 0) w.guests = w.guests.filter(g => !gone.has(g.id))
}

const GENERAL = [
  'This park is really clean and tidy',
  "I'm hungry",
  "I'm thirsty",
  'I need to find a toilet',
  'I want to go on something more thrilling',
  'The scenery here is beautiful',
  "I'm not paying that much to go on that",
  'Great value for money!',
]

function think(w: World) {
  const g = w.guests[Math.floor(rnd() * w.guests.length)]
  if (!g) return
  const r = w.rides.find(one => one.id === g.rideId)
  let text = pick(GENERAL)
  if (g.state === 'queue' && r && r.queue.length > 12) text = `The queue for ${r.name} is really long`
  else if (g.state === 'ride' && r) text = r.intensity > 7.5 ? `${r.name} is terrifying!` : `Wheee! ${r.name}!`
  else if (g.lastRide && rnd() < 0.6) {
    const last = w.rides.find(one => one.name === g.lastRide)
    text = last && last.nausea > 6 ? `I feel sick after ${g.lastRide}` : `${g.lastRide} was great!`
  } else if (r && r.intensity > 8.5 && rnd() < 0.5) text = `${r.name} looks too intense for me`
  w.thought = `Guest ${g.id}: "${text}"`
}

export function step(w: World, dt: number) {
  w.time += dt
  w.frame += 1
  if (w.isFinishing) {
    const left = w.rides.filter(r => r.status === 'building')
    if (left.length === 0) w.isFinishing = false
    w.finishAcc += dt
    while (w.finishAcc >= 0.12) {
      w.finishAcc -= 0.12
      for (const ride of left) {
        if (ride.status !== 'building') continue
        ride.built += 1
        w.money -= 40
        if (ride.built >= ride.size) startTest(w, ride)
      }
    }
  }
  for (const r of w.rides) {
    if (!r.train) continue
    if (r.cat === 'flat') stepFlat(w, r, dt)
    else stepTrack(w, r, dt)
  }
  stepCamera(w, dt)
  stepGuests(w, dt)
  for (const p of w.particles) {
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vh -= 6 * dt
    p.h = Math.max(0, p.h + p.vh * dt)
    p.life -= dt
  }
  w.particles = w.particles.filter(p => p.life > 0)
  w.thoughtAcc += dt
  if (w.thoughtAcc > 4.5) {
    w.thoughtAcc = 0
    think(w)
  }
  const marks = [25, 50, 100, 150, 200]
  const next = marks.find(m => m > w.milestone)
  if (next && w.guests.length >= next) {
    w.milestone = next
    w.toasts.push(`🎉 ${next} guests in the park!`)
  }
}

export function parkRating(w: World): number {
  const open = w.rides.filter(r => r.status === 'open')
  const fun = open.reduce((a, r) => a + r.excitement, 0)
  const crashed = w.rides.filter(r => r.status === 'crashed').length

  return Math.round(clamp(250 + fun * 20 + w.guests.length * 1.1 + w.trees.length - crashed * 150, 0, 999))
}

export function buildingRides(w: World) {
  return w.rides.filter(r => r.status === 'building')
}

// The camera drifts to the action: a test run, a build site, a wreck, else
// it tours the open rides.
export function stepCamera(w: World, dt: number) {
  const focus =
    w.rides.find(r => r.status === 'testing') ??
    w.rides.find(r => r.status === 'building') ??
    w.rides.find(r => r.status === 'crashed')
  const open = w.rides.filter(r => r.status === 'open')
  const ride = focus ?? open[Math.floor(w.time / 12) % Math.max(1, open.length)]
  let tx = gridW(w) / 2
  let ty = BLVD + 0.5
  if (ride) {
    const f = footprint(ride)
    const s = slotAt(ride.slot)
    tx = f.x0 + f.w / 2
    ty = f.y0 + f.h / 2 + (s.isTop ? 0.8 : -0.8)
  }
  const k = Math.min(1, dt * 1.2)
  w.camX += (tx - w.camX) * k
  w.camY += (ty - w.camY) * k
}
