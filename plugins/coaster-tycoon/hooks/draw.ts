// Paints the park into a pixel buffer (0xRRGGBB per pixel) in the original
// game's isometric style, then packs it for the terminal (half-block Raster
// cells) or the desktop (an SVG of horizontal runs).

import { BLVD, GY, footprint, gridW, nodeAt, queueTile } from './sim'
import type { Ride, World } from './sim'

type View = { W: number; H: number; a: number; b: number; hs: number; ox: number; oy: number }

const BG = 0x0e1210
const GRASS = [0x5aa02e, 0x4f9428]
const GRASS_SPECK = 0x6cb43a
const DIRT = [0x9a7444, 0x8c6a3c]
const PATH = [0xa2a2a2, 0x989898]
const QUEUE = [0xc09868, 0xb48c5c]
const CLIFF = [0x7a5a30, 0x5e4424, 0x4a361c]
const EDGE_DARK = 0.86

// Fits the whole park when it can; otherwise zooms to `minA` and follows the
// camera, as the original's scrolling viewport did.
function makeView(W: number, H: number, minA: number, camX: number, camY: number, GX: number): View {
  const span = GX + GY
  const cliff = 3
  const fit = Math.max(1.2, Math.min((W - 2) / span, (H - cliff - 2) / (span / 2 + 5.5)))
  const a = Math.max(fit, minA)
  const b = a / 2
  const hs = a * 0.62
  if (a === fit) {
    const ox = Math.round(W / 2 - ((GX - GY) * a) / 2)
    const oy = Math.round(H - cliff - span * b - 1)

    return { W, H, a, b, hs, ox, oy }
  }
  const ox = Math.round(W / 2 - (camX - camY) * a)
  const oy = Math.round(H / 2 - (camX + camY) * b + 1.5 * hs)

  return { W, H, a, b, hs, ox, oy }
}

const proj = (v: View, x: number, y: number, h: number): [number, number] => [
  Math.round(v.ox + (x - y) * v.a),
  Math.round(v.oy + (x + y) * v.b - h * v.hs),
]

export function shade(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k))
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k))
  const b = Math.min(255, Math.round((c & 255) * k))

  return (r << 16) | (g << 8) | b
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Tile kinds: 0 grass, 1 path, 2 queue, 3 construction dirt.
export function tileMap(w: World): Uint8Array {
  const GX = gridW(w)
  const t = new Uint8Array(GX * GY)
  for (let x = 0; x < GX; x++) t[BLVD * GX + x] = 1
  for (const r of w.rides) {
    const q = queueTile(r)
    t[q.y * GX + q.x] = 2
    if (r.status === 'building') {
      const s = footprint(r)
      for (let y = s.y0; y < s.y0 + s.h; y++) for (let x = s.x0; x < s.x0 + s.w; x++) t[y * GX + x] = 3
    }
  }

  return t
}

let groundKey = ''
let groundBuf = new Uint32Array(0)

function ground(w: World, v: View): Uint32Array {
  const key = `${v.W}x${v.H}:${v.a}:${v.ox}:${v.oy}:${w.groundVer}:${w.rides.map(r => r.status[0]).join('')}`
  if (key === groundKey) return groundBuf
  const tiles = tileMap(w)
  const GX = gridW(w)
  const buf = new Uint32Array(v.W * v.H)
  const edge = v.a >= 5 ? 0.9 / v.a : 0
  const drop = Math.max(2, Math.round(v.a * 0.8))
  const onMap = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < GX && ty < GY
  for (let py = 0; py < v.H; py++) {
    for (let px = 0; px < v.W; px++) {
      const u = (px + 0.5 - v.ox) / v.a
      const vv = (py + 0.5 - v.oy) / v.b
      const tx = (u + vv) / 2
      const ty = (vv - u) / 2
      let c = BG
      if (onMap(tx, ty)) {
        const ix = Math.floor(tx)
        const iy = Math.floor(ty)
        const kind = tiles[iy * GX + ix]!
        const odd = (ix + iy) & 1
        c = kind === 1 ? PATH[odd]! : kind === 2 ? QUEUE[odd]! : kind === 3 ? DIRT[odd]! : GRASS[odd]!
        if (kind === 0 && hash(px, py) < 0.06) c = GRASS_SPECK
        if (edge > 0 && (tx - ix < edge || ty - iy < edge)) c = shade(c, EDGE_DARK)
        if (kind === 0 && ix === 0 && iy === BLVD) c = PATH[0]!
      } else {
        for (let k = 1; k <= drop; k++) {
          const v2 = (py + 0.5 - k - v.oy) / v.b
          if (onMap((u + v2) / 2, (v2 - u) / 2)) {
            c = CLIFF[Math.min(2, Math.floor(((k - 1) / drop) * 3))]!
            if (u < 0) c = shade(c, 0.8)
            break
          }
        }
      }
      buf[py * v.W + px] = c
    }
  }
  groundKey = key
  groundBuf = buf

  return buf
}

class Canvas {
  readonly v: View
  readonly px: Uint32Array

  constructor(v: View, px: Uint32Array) {
    this.v = v
    this.px = px
  }

  set(x: number, y: number, c: number) {
    if (x < 0 || y < 0 || x >= this.v.W || y >= this.v.H) return
    this.px[y * this.v.W + x] = c
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number) {
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (let guard = 0; guard < 2000; guard++) {
      this.set(x0, y0, c)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }

  disc(cx: number, cy: number, r: number, c: number) {
    const rr = Math.ceil(r)
    for (let y = -rr; y <= rr; y++) {
      for (let x = -rr; x <= rr; x++) {
        if (x * x + y * y <= r * r + 0.3) this.set(cx + x, cy + y, c)
      }
    }
  }
}

type Sprite = { d: number; draw: () => void }

export function renderFrame(w: World, W: number, H: number, minA = 0): Uint32Array {
  const v = makeView(W, H, minA, w.camX, w.camY, gridW(w))
  const cv = new Canvas(v, ground(w, v).slice())
  const big = v.a >= 5
  const sprites: Sprite[] = []
  const add = (d: number, draw: () => void) => sprites.push({ d, draw })

  for (const f of w.flowers) {
    add(f.x + f.y - 0.5, () => {
      const [x, y] = proj(v, f.x, f.y, 0)
      cv.set(x, y, f.c)
    })
  }

  for (const t of w.trees) {
    add(t.x + t.y, () => {
      const [x, y] = proj(v, t.x, t.y, 0)
      const trunk = Math.max(1, Math.round(v.a * 0.35))
      const r = Math.max(0.8, v.a * 0.5)
      cv.line(x, y, x, y - trunk, 0x6a4424)
      cv.disc(x, y - trunk - Math.round(r), r, 0x24642a)
      if (big) {
        cv.disc(x - 1, y - trunk - Math.round(r) - 1, r * 0.45, 0x3a8a34)
      }
    })
  }

  // The park entrance: two posts and a banner on the left edge.
  add(BLVD + 0.2, () => {
    const [ax, ay] = proj(v, 0.05, BLVD + 0.05, 0)
    const [bx, by] = proj(v, 0.05, BLVD + 0.95, 0)
    const tall = Math.max(3, Math.round(v.hs * 2))
    cv.line(ax, ay, ax, ay - tall, 0xe8e8e8)
    cv.line(bx, by, bx, by - tall, 0xe8e8e8)
    cv.line(ax, ay - tall, bx, by - tall, 0xe03030)
    if (big) {
      cv.line(ax, ay - tall + 1, bx, by - tall + 1, 0xf0d020)
      cv.line(ax, ay - tall - 1, bx, by - tall - 1, 0xe03030)
    }
  })

  for (const r of w.rides) drawRide(w, r, v, cv, add, big)

  for (const g of w.guests) {
    if (g.state === 'ride') continue
    let gx = g.x
    let gy = g.y
    if (g.state === 'queue') {
      const r = w.rides.find(one => one.id === g.rideId)
      if (r) {
        const k = r.queue.indexOf(g.id)
        const q = queueTile(r)
        gx = q.x + 0.15 + (k % 5) * 0.17
        gy = q.y + 0.15 + Math.floor(k / 5) * 0.16
      }
    }
    add(gx + gy, () => {
      const bob = g.state === 'queue' ? 0 : (w.frame + g.id) & 1
      const [x, y] = proj(v, gx, gy, 0)
      if (big) {
        cv.set(x, y, bob ? 0x303040 : 0x404058)
        cv.set(x, y - 1, g.shirt)
        cv.set(x, y - 2, 0xf0c8a0)
      } else {
        cv.set(x, y, g.shirt)
      }
    })
  }

  for (const p of w.particles) {
    add(p.x + p.y + 0.2, () => {
      const [x, y] = proj(v, p.x, p.y, p.h)
      cv.set(x, y, p.life < 0.4 ? 0x606060 : p.c)
      if (big) cv.set(x + 1, y, p.life < 0.4 ? 0x505050 : p.c)
    })
  }

  sprites.sort((a, b) => a.d - b.d)
  for (const s of sprites) s.draw()

  return cv.px
}

// A flat ride in a few pixels: its base, and a few dots that turn with it.
function drawFlat(w: World, r: Ride, v: View, cv: Canvas, add: (d: number, f: () => void) => void) {
  const frac = r.status === 'building' ? r.built / r.size : 1
  const phase = r.train?.mode === 'run' ? r.train.s * 2.4 : 0
  add(r.cx + r.cy, () => {
    const [x, y] = proj(v, r.cx, r.cy, 0)
    const rad = Math.max(1.5, v.a * 0.7)
    cv.disc(x, y, rad * 0.6, r.status === 'building' ? 0x8c6a3c : shade(r.color, 0.6))
    if (frac < 1) {
      cv.line(x, y, x, y - Math.round(v.hs * 2 * frac), 0xc0c0c0)
      if (w.frame & 2) cv.set(x, y - Math.round(v.hs * 2 * frac) - 1, 0xffe040)
      return
    }
    const tall = r.kind === 'Observation Tower' ? 5 : r.kind === 'Ferris Wheel' || r.kind === 'Spiral Slide' ? 2.6 : 1.2
    cv.line(x, y, x, y - Math.round(v.hs * tall), 0xd0d0d0)
    for (let k = 0; k < 4; k++) {
      const t = phase + (k * Math.PI) / 2
      const px = Math.round(x + Math.cos(t) * rad)
      const py = r.kind === 'Ferris Wheel'
        ? Math.round(y - v.hs * 1.4 + Math.sin(t) * rad)
        : Math.round(y - v.hs * 0.6 + Math.sin(t) * rad * 0.5)
      cv.set(px, py, k % 2 ? r.color : r.carColor)
    }
    if (r.status === 'crashed' && w.frame & 2) cv.set(x, y - Math.round(v.hs * tall) - 2, 0x808080)
  })
}

function drawRide(w: World, r: Ride, v: View, cv: Canvas, add: (d: number, f: () => void) => void, big: boolean) {
  if (r.cat === 'flat') {
    drawFlat(w, r, v, cv, add)
    return
  }
  const n = r.nodes.length
  const built = Math.min(r.built, n)
  const pts = r.nodes.map(node => proj(v, node.x, node.y, node.h))
  const dark = shade(r.color, 0.65)

  for (let i = 0; i < built; i++) {
    const node = r.nodes[i]!
    if (node.isLoop || node.h < 0.25) continue
    if (i % (big ? (r.isWood ? 1 : 2) : r.isWood ? 2 : 3) !== 0) continue
    add(node.x + node.y - 0.03, () => {
      const [x, y] = pts[i]!
      const [, gy] = proj(v, node.x, node.y, 0)
      cv.line(x, y + 1, x, gy, r.support)
      if (r.isWood && big && i % 2 === 0) cv.line(x - 1, gy, x + 1, gy, shade(r.support, 0.8))
    })
  }

  for (let i = 0; i < r.stationLen && i < built; i++) {
    const node = r.nodes[i]!
    add(node.x + node.y - 0.02, () => {
      const [x, y] = pts[i]!
      const half = Math.max(1, Math.round(v.a * 0.45))
      cv.line(x - half, y + 1, x + half, y + 1, 0xd8d8d8)
      if (big) cv.line(x - half, y + 2, x + half, y + 2, 0xb0b0b0)
    })
  }

  const segs = built >= n ? n : built - 1
  for (let i = 0; i < segs; i++) {
    const a = r.nodes[i]!
    const b = r.nodes[(i + 1) % n]!
    add((a.x + b.x + a.y + b.y) / 2 + 0.05, () => {
      const [x0, y0] = pts[i]!
      const [x1, y1] = pts[(i + 1) % n]!
      if (big) cv.line(x0, y0 + 1, x1, y1 + 1, dark)
      cv.line(x0, y0, x1, y1, r.color)
    })
  }

  if (r.status === 'building' && built > 0) {
    const end = r.nodes[built - 1]!
    add(end.x + end.y + 0.3, () => {
      const [x, y] = pts[built - 1]!
      if (w.frame & 2) {
        cv.set(x, y - 1, 0xffe040)
        cv.set(x, y - 2, 0xffe040)
      }
      const [gx, gy] = proj(v, end.x + 0.3, end.y + 0.3, 0)
      cv.set(gx, gy, 0x2858e0)
      cv.set(gx, gy - 1, 0xffd000)
    })
  }

  if (r.status === 'crashed') {
    const at = r.nodes[Math.min(n - 1, r.crashAt)]!
    add(at.x + at.y + 0.4, () => {
      const [x, y] = proj(v, at.x, at.y, at.h)
      for (let k = 0; k < 5; k++) {
        const rise = (w.frame * 0.5 + k * 3) % 12
        const sx = x + Math.round(Math.sin(w.frame * 0.3 + k * 2) * 1.5)
        cv.set(sx, y - Math.round(rise), rise > 8 ? 0x505050 : 0x808080)
      }
      const [gx, gy] = proj(v, at.x + 0.2, at.y + 0.1, 0)
      cv.set(gx, gy, 0x404040)
      cv.set(gx + 1, gy, r.carColor)
    })
  }

  const t = r.train
  if (!t) return
  const cars = 4
  for (let k = 0; k < cars; k++) {
    const s = t.s - k * 0.9
    if (s < 0 && t.isTest) continue
    const p = nodeAt(r, s < 0 ? s + n : s)
    add(p.x + p.y + 0.08, () => {
      const [x, y] = proj(v, p.x, p.y, p.h)
      const color = t.isTest && k === 0 ? 0xffffff : r.carColor
      cv.set(x, y - 1, color)
      cv.set(x + 1, y - 1, color)
      if (big) {
        cv.set(x - 1, y - 1, color)
        cv.set(x - 1, y - 2, shade(color, 0.8))
        cv.set(x + 1, y - 2, shade(color, 0.8))
      }
      for (let seat = 0; seat < 2; seat++) {
        const id = t.riders[k * 2 + seat]
        if (id === undefined) continue
        const g = w.guests.find(one => one.id === id)
        const sx = x + seat
        cv.set(sx, y - 2, g?.shirt ?? 0xe02828)
        if (big) cv.set(sx, y - 3, 0xf0c8a0)
      }
    })
  }
}

export function toRasterCells(px: Uint32Array, W: number, rows: number): string {
  const words = new Uint32Array(W * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < W; c++) {
      const top = px[2 * r * W + c] ?? BG
      const bottom = px[(2 * r + 1) * W + c] ?? BG
      const i = (r * W + c) * 3
      words[i] = 0x2580
      words[i + 1] = top
      words[i + 2] = bottom
    }
  }

  return base64(new Uint8Array(words.buffer))
}

function base64(bytes: Uint8Array): string {
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(bin)
}

export function toSvg(px: Uint32Array, W: number, H: number, scale: number): string {
  const runs = new Map<number, string[]>()
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      const c = px[y * W + x]!
      let end = x + 1
      while (end < W && px[y * W + end] === c) end++
      if (c !== BG) {
        let list = runs.get(c)
        if (!list) runs.set(c, (list = []))
        list.push(`M${x} ${y}h${end - x}v1h${x - end}z`)
      }
      x = end
    }
  }
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`
  let body = ''
  for (const [c, list] of runs) body += `<path fill="${hex(c)}" d="${list.join('')}"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}" shape-rendering="crispEdges"><rect width="${W}" height="${H}" fill="${hex(BG)}"/>${body}</svg>`
}
