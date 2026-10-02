// The desktop's park: the same isometric scene as draw.ts, drawn as vector
// shapes instead of pixels, so it stays sharp at whatever size the pane is.

import { shade, tileMap } from './draw'
import { BLVD, GX, GY, SLOTS, nodeAt, queueTile } from './sim'
import type { Ride, World } from './sim'

const A = 20
const B = A / 2
const HS = A * 0.62
const PAD = 12
const CLIFF = 16
const OX = GY * A + PAD
const OY = 7 * HS + PAD
export const VIEW_W = (GX + GY) * A + PAD * 2
export const VIEW_H = OY + (GX + GY) * B + CLIFF + PAD

const P = (x: number, y: number, h: number): [number, number] => [
  OX + (x - y) * A,
  OY + (x + y) * B - h * HS,
]
const n1 = (v: number) => Math.round(v * 10) / 10
const pt = ([x, y]: [number, number]) => `${n1(x)} ${n1(y)}`
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

const GRASS = [0x5aa02e, 0x4f9428]
const DIRT = [0x9a7444, 0x8c6a3c]
const PATH = [0xa8a8a8, 0x9c9c9c]
const QUEUE = [0xc09868, 0xb48c5c]
const SKIN = '#f0c8a0'

const peep = (step: number) =>
  `<g id="g${step}"><path d="M-.8 0l${step * 0.8} -3M.8 0l${-step * 0.8} -3" stroke="#30304a" stroke-width="1.1"/><rect x="-1.7" y="-6.5" width="3.4" height="4" rx=".8"/><circle cy="-8" r="1.6" fill="${SKIN}"/></g>`
const DEFS =
  '<g id="t"><ellipse rx="6" ry="3" fill="#000" opacity=".18"/><rect x="-1.2" y="-9" width="2.4" height="9" fill="#6a4424"/>' +
  '<circle cy="-14" r="7" fill="#1f5a24"/><circle cx="-2" cy="-16" r="4" fill="#2f7a30"/><circle cx="-3" cy="-17.5" r="1.6" fill="#4a9a40"/></g>' +
  peep(0) + peep(1)

type Shape = { d: number; svg: string }

function line(a: [number, number], b: [number, number], color: string, width: number, cap = ''): string {
  return `<path d="M${pt(a)}L${pt(b)}" stroke="${color}" stroke-width="${width}"${cap ? ` stroke-linecap="${cap}"` : ''}/>`
}

export function renderSvg(w: World): string {
  const out: string[] = []
  const shapes: Shape[] = []
  const add = (d: number, svg: string) => shapes.push({ d, svg })
  const blink = (w.frame & 2) !== 0

  // The ground and the cliff under its front edges.
  const left = P(0, GY, 0)
  const bottom = P(GX, GY, 0)
  const right = P(GX, 0, 0)
  const down = (p: [number, number]): [number, number] => [p[0], p[1] + CLIFF]
  out.push(`<polygon points="${pt(left)} ${pt(bottom)} ${pt(down(bottom))} ${pt(down(left))}" fill="#6e5028"/>`)
  out.push(`<polygon points="${pt(bottom)} ${pt(right)} ${pt(down(right))} ${pt(down(bottom))}" fill="#54391c"/>`)
  out.push(line([left[0], left[1] + CLIFF * 0.45], [bottom[0], bottom[1] + CLIFF * 0.45], '#5e4424', 1))
  out.push(line([bottom[0], bottom[1] + CLIFF * 0.45], [right[0], right[1] + CLIFF * 0.45], '#46301a', 1))
  const tiles = tileMap(w)
  for (let y = 0; y < GY; y++) {
    for (let x = 0; x < GX; x++) {
      const kind = tiles[y * GX + x]!
      const odd = (x + y) & 1
      const c = kind === 1 ? PATH[odd]! : kind === 2 ? QUEUE[odd]! : kind === 3 ? DIRT[odd]! : GRASS[odd]!
      out.push(`<polygon points="${pt(P(x, y, 0))} ${pt(P(x + 1, y, 0))} ${pt(P(x + 1, y + 1, 0))} ${pt(P(x, y + 1, 0))}" fill="${hex(c)}" stroke="${hex(shade(c, 0.88))}" stroke-width=".6"/>`)
    }
  }

  for (const f of w.flowers) {
    const [x, y] = P(f.x, f.y, 0)
    add(f.x + f.y - 0.5, `<circle cx="${n1(x)}" cy="${n1(y - 1)}" r="1.6" fill="${hex(f.c)}"/>`)
  }

  for (const t of w.trees) {
    const [x, y] = P(t.x, t.y, 0)
    add(t.x + t.y, `<use href="#t" x="${n1(x)}" y="${n1(y)}"/>`)
  }

  // The park entrance: two striped posts and a banner.
  {
    const a = P(0.08, BLVD + 0.05, 0)
    const b = P(0.08, BLVD + 0.95, 0)
    const tall = HS * 2.6
    const top = (p: [number, number]): [number, number] => [p[0], p[1] - tall]
    add(BLVD + 0.2,
      line(a, top(a), '#eeeeee', 3) + line(b, top(b), '#eeeeee', 3) +
      `<polygon points="${pt(top(a))} ${pt(top(b))} ${pt([b[0], b[1] - tall + 9])} ${pt([a[0], a[1] - tall + 9])}" fill="#d82828" stroke="#f0d020" stroke-width="1.2"/>`)
  }

  for (const r of w.rides) drawRide(w, r, add, blink)

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
    const [x, y] = P(gx, gy, 0)
    const step = g.state === 'queue' ? 0 : (w.frame + g.id) & 1
    add(gx + gy, `<use href="#g${step}" x="${n1(x)}" y="${n1(y)}" fill="${hex(g.shirt)}"/>`)
  }

  for (const p of w.particles) {
    const [x, y] = P(p.x, p.y, p.h)
    const isSmoke = p.life < 0.4
    add(p.x + p.y + 0.2, `<circle cx="${n1(x)}" cy="${n1(y)}" r="${isSmoke ? 3 : 2}" fill="${isSmoke ? '#707070' : hex(p.c)}"${isSmoke ? ' opacity=".6"' : ''}/>`)
  }

  shapes.sort((a, b) => a.d - b.d)
  for (const s of shapes) out.push(s.svg)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n1(VIEW_W)} ${n1(VIEW_H)}" width="${Math.round(VIEW_W * 2)}" height="${Math.round(VIEW_H * 2)}" stroke-linecap="round" stroke-linejoin="round"><defs>${DEFS}</defs><rect width="100%" height="100%" fill="#0e1210"/>${out.join('')}</svg>`
}

function drawRide(w: World, r: Ride, add: (d: number, svg: string) => void, blink: boolean) {
  if (r.cat === 'flat') {
    drawFlat(w, r, add, blink)
    return
  }
  const n = r.nodes.length
  const built = Math.min(r.built, n)
  const pts = r.nodes.map(node => P(node.x, node.y, node.h))
  const rail = hex(r.color)
  const under = hex(shade(r.color, 0.55))
  const support = hex(r.support)
  const brace = hex(shade(r.support, 0.75))

  for (let i = 0; i < built; i++) {
    const node = r.nodes[i]!
    if (node.isLoop || node.h < 0.25) continue
    if (!r.isWood && i % 2 === 1) continue
    const top = pts[i]!
    const foot = P(node.x, node.y, 0)
    let svg = line([top[0], top[1] + 2], foot, support, r.isWood ? 1.6 : 1.3)
    if (r.isWood && node.h > 1.2) {
      const mid = (top[1] + foot[1]) / 2
      svg += line([foot[0] - 3, foot[1]], [foot[0], mid], brace, 1) + line([foot[0] + 3, foot[1]], [foot[0], mid], brace, 1)
    }
    if (!r.isWood) svg += `<rect x="${n1(foot[0] - 1.5)}" y="${n1(foot[1] - 1)}" width="3" height="2" fill="#808088"/>`
    add(node.x + node.y - 0.03, svg)
  }

  for (let i = 0; i < r.stationLen && i < built; i++) {
    const node = r.nodes[i]!
    const [x, y] = pts[i]!
    add(node.x + node.y - 0.02,
      `<rect x="${n1(x - 8)}" y="${n1(y + 1)}" width="16" height="4" fill="#d8d8d8" stroke="#a0a0a0" stroke-width=".6"/>` +
      (i % 2 === 0 ? `<rect x="${n1(x - 8)}" y="${n1(y - 13)}" width="16" height="3" fill="${rail}"/>${line([x - 7, y + 1], [x - 7, y - 10], '#c0c0c0', 1)}` : ''))
  }

  const segs = built >= n ? n : built - 1
  for (let i = 0; i < segs; i++) {
    const a = r.nodes[i]!
    const b = r.nodes[(i + 1) % n]!
    const pa = pts[i]!
    const pb = pts[(i + 1) % n]!
    add((a.x + b.x + a.y + b.y) / 2 + 0.05,
      r.kind === 'Log Flume'
        ? line([pa[0], pa[1] + 1], [pb[0], pb[1] + 1], '#6a4424', 7) + line(pa, pb, '#5ab4f4', 3.6)
        : line([pa[0], pa[1] + 1.6], [pb[0], pb[1] + 1.6], under, 2.4) + line(pa, pb, rail, 2.6))
  }

  if (r.status === 'building' && built > 0) {
    const end = r.nodes[built - 1]!
    const [x, y] = pts[built - 1]!
    const [gx, gy] = P(end.x + 0.3, end.y + 0.3, 0)
    add(end.x + end.y + 0.3,
      (blink ? `<circle cx="${n1(x)}" cy="${n1(y - 3)}" r="3" fill="#ffe040" stroke="#a08000" stroke-width=".8"/>` : '') +
      `<rect x="${n1(gx - 1.7)}" y="${n1(gy - 6.5)}" width="3.4" height="4" fill="#2858e0"/>` +
      `<circle cx="${n1(gx)}" cy="${n1(gy - 8)}" r="1.6" fill="${SKIN}"/>` +
      `<path d="M${n1(gx - 2.2)} ${n1(gy - 8.6)}h4.4" stroke="#ffd000" stroke-width="1.6"/>`)
  }

  if (r.status === 'crashed') {
    const at = r.nodes[Math.min(n - 1, r.crashAt)]!
    const [x, y] = P(at.x, at.y, at.h)
    const [gx, gy] = P(at.x + 0.25, at.y + 0.15, 0)
    let svg = `<path d="M${n1(gx - 5)} ${n1(gy)}l4 -3l5 1l3 2z" fill="#404040"/><rect x="${n1(gx - 2)}" y="${n1(gy - 4)}" width="6" height="3" fill="${hex(r.carColor)}" transform="rotate(25 ${n1(gx)} ${n1(gy)})"/>`
    for (let k = 0; k < 5; k++) {
      const rise = (w.frame * 0.8 + k * 6) % 30
      const sx = x + Math.sin(w.frame * 0.25 + k * 2) * 3
      svg += `<circle cx="${n1(sx)}" cy="${n1(y - rise)}" r="${n1(2 + rise / 8)}" fill="#808080" opacity="${n1(0.7 - rise / 50)}"/>`
    }
    add(at.x + at.y + 0.4, svg)
  }

  const t = r.train
  if (!t) return
  const car = hex(t.isTest ? 0xffffff : r.carColor)
  const carDark = hex(shade(t.isTest ? 0xdddddd : r.carColor, 0.7))
  for (let k = 0; k < 4; k++) {
    const s = t.s - k * 0.9
    if (s < 0 && t.isTest) continue
    const at = s < 0 ? s + n : s
    const p = nodeAt(r, at)
    const front = P(...xyh(nodeAt(r, at + 0.3)))
    const back = P(...xyh(nodeAt(r, at - 0.3)))
    let svg = line([back[0], back[1] - 2], [front[0], front[1] - 2], carDark, 7, 'round') + line([back[0], back[1] - 3], [front[0], front[1] - 3], car, 5, 'round')
    const [cx, cy] = P(p.x, p.y, p.h)
    for (let seat = 0; seat < 2; seat++) {
      const id = t.riders[k * 2 + seat]
      if (id === undefined) continue
      const g = w.guests.find(one => one.id === id)
      const sx = cx + (seat === 0 ? -1.8 : 1.8)
      svg += `<rect x="${n1(sx - 1.4)}" y="${n1(cy - 8)}" width="2.8" height="3" fill="${hex(g?.shirt ?? 0xe02828)}"/><circle cx="${n1(sx)}" cy="${n1(cy - 9.5)}" r="1.5" fill="${SKIN}"/>`
    }
    add(p.x + p.y + 0.08, svg)
  }
}

const xyh = (p: { x: number; y: number; h: number }): [number, number, number] => [p.x, p.y, p.h]

// ---- Flat rides ------------------------------------------------------------
// Each is drawn around its centre (cx, cy) on the ground; `phase` turns while
// a cycle runs, and the riders sit on whatever moves.

type Ctx = { r: Ride; phase: number; swing: number; riders: string[] }

const ring = (cx: number, cy: number, rad: number, h: number, k: number, from = 0): [number, number][] =>
  Array.from({ length: k }, (_, i) => {
    const t = from + (i / k) * Math.PI * 2
    return P(cx + Math.cos(t) * rad, cy + Math.sin(t) * rad, h)
  })

const poly = (pts: [number, number][], fill: string, extra = '') => `<polygon points="${pts.map(pt).join(' ')}" fill="${fill}"${extra}/>`
const ellipse = (c: [number, number], rad: number, fill: string, extra = '') =>
  `<ellipse cx="${n1(c[0])}" cy="${n1(c[1])}" rx="${n1(rad * A * 1.414)}" ry="${n1(rad * B * 1.414)}" fill="${fill}"${extra}/>`
const rider = (x: number, y: number, shirt: string) =>
  `<rect x="${n1(x - 1.3)}" y="${n1(y - 3)}" width="2.6" height="2.6" fill="${shirt}"/><circle cx="${n1(x)}" cy="${n1(y - 4.3)}" r="1.4" fill="${SKIN}"/>`

function drawFlat(w: World, r: Ride, add: (d: number, svg: string) => void, blink: boolean) {
  const t = r.train
  const running = t?.mode === 'run'
  const elapsed = t?.elapsed ?? 0
  const ramp = running ? Math.min(1, elapsed / 1.5, Math.max(0, (7 - elapsed) / 1.5)) : 0
  const riders = (t?.riders ?? []).map(id => hex(w.guests.find(g => g.id === id)?.shirt ?? 0xe02828))
  const ctx: Ctx = { r, phase: (t?.s ?? 0) * 2.2 * (0.3 + ramp * 0.7), swing: ramp, riders }
  const d = r.cx + r.cy
  const base = ellipse(P(r.cx, r.cy, 0), 0.95, '#000', ' opacity=".15"')
  if (r.status === 'building') {
    const frac = r.built / r.size
    const top = P(r.cx, r.cy, 3 * frac)
    const foot = P(r.cx, r.cy, 0)
    add(d, base +
      `<g opacity="${n1(0.25 + frac * 0.55)}">${drawKind(ctx)}</g>` +
      line([foot[0] - 7, foot[1]], [top[0] - 7, top[1]], '#c8c8c8', 1) + line([foot[0] + 7, foot[1]], [top[0] + 7, top[1]], '#c8c8c8', 1) +
      line([foot[0] - 7, top[1]], [foot[0] + 7, top[1]], '#c8c8c8', 1) +
      (blink ? `<circle cx="${n1(top[0])}" cy="${n1(top[1] - 3)}" r="3" fill="#ffe040" stroke="#a08000" stroke-width=".8"/>` : '') +
      `<use href="#g0" x="${n1(foot[0] + 10)}" y="${n1(foot[1] + 4)}" fill="#2858e0"/>`)
    return
  }
  let svg = base + drawKind(ctx)
  if (r.status === 'crashed') {
    const [x, y] = P(r.cx, r.cy, 1.5)
    for (let k = 0; k < 5; k++) {
      const rise = (w.frame * 0.8 + k * 6) % 30
      svg += `<circle cx="${n1(x + Math.sin(w.frame * 0.25 + k * 2) * 3)}" cy="${n1(y - rise)}" r="${n1(2 + rise / 8)}" fill="#808080" opacity="${n1(0.7 - rise / 50)}"/>`
    }
  }
  add(d, svg)
}

function drawKind(c: Ctx): string {
  switch (c.r.kind) {
    case 'Merry-Go-Round': return carousel(c)
    case 'Spiral Slide': return slide(c)
    case 'Dodgems': return dodgems(c)
    case 'Twist': return twist(c)
    case 'Ferris Wheel': return ferris(c)
    case 'Swinging Ship': return ship(c)
    default: return tower(c)
  }
}

function carousel({ r, phase, riders }: Ctx): string {
  const { cx, cy } = r
  let svg = ellipse(P(cx, cy, 0.15), 0.85, '#b89058') + ellipse(P(cx, cy, 0.3), 0.85, '#e8d8b0')
  const horses: { y: number; svg: string }[] = []
  for (let k = 0; k < 8; k++) {
    const t = phase + (k * Math.PI) / 4
    const bob = Math.sin(phase * 2 + k) * 0.12
    const foot = P(cx + Math.cos(t) * 0.62, cy + Math.sin(t) * 0.62, 0.3)
    const body = P(cx + Math.cos(t) * 0.62, cy + Math.sin(t) * 0.62, 0.9 + bob)
    const top = P(cx + Math.cos(t) * 0.62, cy + Math.sin(t) * 0.62, 1.7)
    horses.push({
      y: body[1],
      svg: line(foot, top, '#e0c040', 0.8) +
        `<rect x="${n1(body[0] - 3)}" y="${n1(body[1] - 2)}" width="6" height="3" rx="1.2" fill="${k % 2 ? '#ffffff' : '#c08040'}"/>` +
        (riders[k] ? rider(body[0], body[1] - 1.5, riders[k]!) : ''),
    })
  }
  horses.sort((a, b) => a.y - b.y)
  const back = horses.filter(h => h.y < P(cx, cy, 0.9)[1])
  const front = horses.filter(h => h.y >= P(cx, cy, 0.9)[1])
  svg += back.map(h => h.svg).join('') + line(P(cx, cy, 0.3), P(cx, cy, 2.3), '#e0c040', 2) + front.map(h => h.svg).join('')
  const rim = ring(cx, cy, 0.9, 1.7, 12, phase * 0.2)
  const apex = P(cx, cy, 2.5)
  const wedges = rim.map((p, i) => ({ y: (p[1] + rim[(i + 1) % 12]![1]) / 2, svg: poly([apex, p, rim[(i + 1) % 12]!], i % 2 ? '#ffffff' : hex(r.color), ' stroke="#00000022" stroke-width=".4"') }))
  wedges.sort((a, b) => a.y - b.y)
  svg += wedges.map(x => x.svg).join('')
  svg += `<circle cx="${n1(apex[0])}" cy="${n1(apex[1] - 1.5)}" r="1.6" fill="#f0d020"/>`

  return svg
}

function slide({ r, phase, riders }: Ctx): string {
  const { cx, cy } = r
  const tall = 3.4
  const w = 0.32
  const a = P(cx - w, cy + w, 0)
  const b = P(cx + w, cy + w, 0)
  const c2 = P(cx + w, cy - w, 0)
  const lift = (p: [number, number]): [number, number] => [p[0], p[1] - tall * HS]
  let back = ''
  let front = ''
  const turns = 2.6
  const pts: [number, number][] = []
  for (let k = 0; k <= 40; k++) {
    const t = (k / 40) * Math.PI * 2 * turns
    pts.push(P(cx + Math.cos(t) * 0.75, cy + Math.sin(t) * 0.75, tall - (k / 40) * (tall - 0.2)))
  }
  for (let k = 0; k < 40; k++) {
    const t = (k / 40) * Math.PI * 2 * turns
    const seg = line(pts[k]!, pts[k + 1]!, '#f0c020', 3.2) + line([pts[k]![0], pts[k]![1] + 1.2], [pts[k + 1]![0], pts[k + 1]![1] + 1.2], '#b08010', 1)
    if (Math.sin(t) < 0) back += seg
    else front += seg
  }
  const tower = poly([a, b, lift(b), lift(a)], hex(r.color)) + poly([b, c2, lift(c2), lift(b)], hex(shade(r.color, 0.7))) +
    poly([lift(a), lift(b), [lift(b)[0], lift(b)[1] - 8], [(lift(a)[0] + lift(b)[0]) / 2, lift(a)[1] - 14]], '#d82828')
  let sliders = ''
  riders.slice(0, 3).forEach((shirt, i) => {
    const k = Math.floor(((phase * 4 + i * 13) % 40 + 40) % 40)
    sliders += rider(pts[k]![0], pts[k]![1] + 1, shirt)
  })

  return back + tower + front + sliders
}

function dodgems({ r, phase, riders }: Ctx): string {
  const { cx, cy } = r
  const s = 0.85
  const floor = [P(cx - s, cy - s, 0), P(cx + s, cy - s, 0), P(cx + s, cy + s, 0), P(cx - s, cy + s, 0)]
  let svg = poly(floor, '#4a4a58', ' stroke="#e8c020" stroke-width="1.6"')
  const cars = ['#e02828', '#2858e0', '#28b048', '#f0d028', '#b030c8', '#18c0c0']
  const placed = cars.map((color, i) => {
    const x = cx + Math.sin(phase * (0.7 + i * 0.13) + i * 1.7) * 0.6
    const y = cy + Math.cos(phase * (0.6 + i * 0.11) + i * 2.3) * 0.6
    return { y: x + y, p: P(x, y, 0), color, shirt: riders[i] }
  })
  placed.sort((a, b) => a.y - b.y)
  for (const car of placed) {
    svg += `<rect x="${n1(car.p[0] - 3.5)}" y="${n1(car.p[1] - 3)}" width="7" height="4" rx="1.5" fill="${car.color}" stroke="#202020" stroke-width=".6"/>`
    svg += line([car.p[0] + 2, car.p[1] - 3], [car.p[0] + 2, car.p[1] - 16], '#909090', 0.5)
    if (car.shirt) svg += rider(car.p[0] - 0.5, car.p[1] - 2, car.shirt)
  }
  const roof = [P(cx - s, cy - s, 1.4), P(cx + s, cy - s, 1.4), P(cx + s, cy + s, 1.4), P(cx - s, cy + s, 1.4)]
  for (let i = 0; i < 4; i++) svg += line(floor[i]!, roof[i]!, '#c0c0c0', 1.2)
  svg += poly(roof, hex(r.color), ' opacity=".35" stroke="#ffffff" stroke-width="1"')

  return svg
}

function twist({ r, phase, riders }: Ctx): string {
  const { cx, cy } = r
  let svg = ellipse(P(cx, cy, 0.1), 0.9, '#707080') + ellipse(P(cx, cy, 0.2), 0.85, '#9a9aaa')
  const cars: { y: number; svg: string }[] = []
  for (let arm = 0; arm < 3; arm++) {
    const ta = phase * 0.8 + (arm * Math.PI * 2) / 3
    const hx = cx + Math.cos(ta) * 0.5
    const hy = cy + Math.sin(ta) * 0.5
    svg += line(P(cx, cy, 0.8), P(hx, hy, 0.6), '#c8c8d0', 1.4)
    for (let k = 0; k < 3; k++) {
      const tc = -phase * 2.2 + (k * Math.PI * 2) / 3
      const p = P(hx + Math.cos(tc) * 0.28, hy + Math.sin(tc) * 0.28, 0.45)
      const shirt = riders[arm * 3 + k]
      cars.push({ y: p[1], svg: `<ellipse cx="${n1(p[0])}" cy="${n1(p[1])}" rx="3.4" ry="2.2" fill="${hex(k % 2 ? r.color : r.carColor)}" stroke="#202020" stroke-width=".5"/>` + (shirt ? rider(p[0], p[1], shirt) : '') })
    }
  }
  cars.sort((a, b) => a.y - b.y)
  svg += line(P(cx, cy, 0.2), P(cx, cy, 1.1), '#e0c040', 2.4) + cars.map(c => c.svg).join('')

  return svg
}

function ferris({ r, phase, riders }: Ctx): string {
  const { cx, cy } = r
  const rh = 2.1
  const rt = 1.3
  const hub = P(cx, cy, rh + 0.35)
  const at = (t: number, k = 1): [number, number] => P(cx, cy + Math.cos(t) * rt * k, rh + 0.35 + Math.sin(t) * rh * k)
  let svg = ''
  for (const side of [-0.28, 0.28]) {
    svg += line(P(cx + side, cy - 0.8, 0), P(cx + side * 0.3, cy, rh + 0.35), '#8a8a94', 1.8)
    svg += line(P(cx + side, cy + 0.8, 0), P(cx + side * 0.3, cy, rh + 0.35), '#8a8a94', 1.8)
  }
  const rim = Array.from({ length: 28 }, (_, i) => at((i / 28) * Math.PI * 2))
  svg += `<polygon points="${rim.map(pt).join(' ')}" fill="none" stroke="${hex(r.color)}" stroke-width="2"/>`
  svg += `<polygon points="${Array.from({ length: 28 }, (_, i) => at((i / 28) * Math.PI * 2, 0.6)).map(pt).join(' ')}" fill="none" stroke="${hex(shade(r.color, 0.7))}" stroke-width="1"/>`
  for (let k = 0; k < 8; k++) {
    const t = -phase * 0.5 + (k * Math.PI) / 4
    const p = at(t)
    svg += line(hub, p, '#d0d0d8', 0.7)
  }
  for (let k = 0; k < 8; k++) {
    const t = -phase * 0.5 + (k * Math.PI) / 4
    const p = at(t)
    const color = ['#e02828', '#2858e0', '#f0d028', '#28b048'][k % 4]!
    svg += line(p, [p[0], p[1] + 3], '#606060', 0.8)
    svg += `<rect x="${n1(p[0] - 3)}" y="${n1(p[1] + 3)}" width="6" height="4.5" rx="1" fill="${color}"/>`
    if (riders[k]) svg += `<circle cx="${n1(p[0])}" cy="${n1(p[1] + 3.4)}" r="1.3" fill="${SKIN}"/>`
  }
  svg += `<circle cx="${n1(hub[0])}" cy="${n1(hub[1])}" r="2.2" fill="#f0d020"/>`

  return svg
}

function ship({ r, phase, swing, riders }: Ctx): string {
  const { cx, cy } = r
  const ph = 2.9
  const pivot = P(cx, cy, ph)
  const theta = Math.sin(phase * 1.3) * 1.15 * swing
  const len = 2.3
  const toScreen = (along: number, up: number): [number, number] => {
    const ca = Math.cos(theta)
    const sa = Math.sin(theta)
    const dy = along * ca - (up - len) * sa
    const dh = along * sa + (up - len) * ca
    return P(cx, cy + dy * 0.62, ph + dh)
  }
  let svg = ''
  for (const side of [-0.45, 0.45]) {
    svg += line(P(cx + side, cy - 1, 0), pivot, '#7a7a84', 2)
    svg += line(P(cx + side, cy + 1, 0), pivot, '#7a7a84', 2)
  }
  svg += line(pivot, toScreen(-1, 0.4), '#a0a0a8', 1.4) + line(pivot, toScreen(1, 0.4), '#a0a0a8', 1.4)
  const hull = [toScreen(-1.4, 0.55), toScreen(1.4, 0.55), toScreen(1.0, 0), toScreen(-1.0, 0)]
  svg += poly(hull, '#8a5a2a', ' stroke="#5a3a1a" stroke-width="1"')
  svg += poly([toScreen(-1.3, 0.55), toScreen(1.3, 0.55), toScreen(1.25, 0.42), toScreen(-1.25, 0.42)], hex(r.color))
  riders.slice(0, 10).forEach((shirt, i) => {
    const p = toScreen(-1.1 + (i / 9) * 2.2, 0.6)
    svg += rider(p[0], p[1], shirt)
  })
  svg += `<circle cx="${n1(pivot[0])}" cy="${n1(pivot[1])}" r="2" fill="#f0d020"/>`

  return svg
}

function tower({ r, phase, riders }: Ctx): string {
  const { cx, cy } = r
  const tall = 6
  const lift = (1 - Math.cos(phase * 0.45)) / 2
  const h = 0.4 + lift * (tall - 1.2)
  let svg = ellipse(P(cx, cy, 0), 0.5, '#9a9aaa')
  svg += line(P(cx, cy, 0), P(cx, cy, tall), '#b8b8c4', 4) + line(P(cx, cy, 0), P(cx, cy, tall), '#e0e0e8', 1.5)
  svg += ellipse(P(cx, cy, h), 0.45, hex(shade(r.color, 0.7))) + ellipse(P(cx, cy, h + 0.25), 0.45, hex(r.color))
  riders.slice(0, 6).forEach((shirt, i) => {
    const t = (i / 6) * Math.PI * 2
    if (Math.sin(t) < -0.2) return
    const p = P(cx + Math.cos(t) * 0.38, cy + Math.sin(t) * 0.38, h + 0.25)
    svg += rider(p[0], p[1], shirt)
  })
  const top = P(cx, cy, tall)
  svg += `<circle cx="${n1(top[0])}" cy="${n1(top[1])}" r="3" fill="#d82828"/>`

  return svg
}
