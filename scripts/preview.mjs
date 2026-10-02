// Renders a simulated park to an SVG without running Claude Code, so a
// change to the simulation or the renderers can be looked at directly.
//
//   node scripts/preview.mjs [out.svg] [--turns 6] [--models opus,sonnet,haiku]
//
// It copies the mod's hooks to a temp folder (Node needs explicit .ts import
// suffixes the mod leaves out), plays some turns of fake tool calls through
// the real simulation, and writes the desktop renderer's SVG. Convert it to
// PNG with any SVG viewer (`qlmanage -t -s 1400 out.svg` on macOS).

import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const out = resolve(args.find(a => a.endsWith('.svg')) ?? 'preview.svg')
const turns = Number(flag('turns', '6'))
const models = flag('models', 'opus,sonnet,haiku').split(',').map(m => `claude-${m.trim()}`)

const hooks = resolve(import.meta.dirname, '../plugins/coaster-tycoon/hooks')
const work = mkdtempSync(join(tmpdir(), 'coaster-preview-'))
for (const file of readdirSync(hooks).filter(f => f.endsWith('.ts'))) {
  const source = readFileSync(join(hooks, file), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'")
  writeFileSync(join(work, file), source)
}

const sim = await import(pathToFileURL(join(work, 'sim.ts')).href)
const { renderSvg } = await import(pathToFileURL(join(work, 'vector.ts')).href)

const w = sim.createWorld()
const tools = ['Read', 'Edit', 'Bash', 'Grep', 'Write', 'Edit', 'Bash', 'Edit']
for (let turn = 0; turn < turns; turn++) {
  for (let i = 0; i < 24; i++) {
    sim.toolCalled(w, tools[i % tools.length], models[i % models.length])
    for (let k = 0; k < 8; k++) sim.step(w, 0.15)
  }
  sim.turnEnded(w, 'answer')
  for (let k = 0; k < 300; k++) sim.step(w, 0.15)
}

const svg = renderSvg(w)
writeFileSync(out, svg)
for (const r of w.rides) {
  console.log(`${r.status.padEnd(8)} ${r.kind.padEnd(22)} ${r.name.padEnd(22)} by ${r.builtBy.padEnd(6)} E ${r.excitement.toFixed(2)}`)
}
console.log(`\n${w.guests.length} guests, $${Math.round(w.money)}, SVG ${svg.length} chars (limit 131072)`)
console.log(`wrote ${out}`)
if (svg.length > 131072 || svg.includes('NaN')) process.exit(1)
