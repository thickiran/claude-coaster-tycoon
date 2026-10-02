import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanName, sanitizePark, score } from './update-leaderboard.mjs'

const now = new Date().toISOString()
const park = { name: 'Mods Park', rating: 712, guests: 142, guestsTotal: 900, ridesOpen: 5, coasters: 3, riders: 2400, best: 'Fork Bomb', updatedAt: now }

test('a normal park is kept and scored here, not by the player', () => {
  const p = sanitizePark('a1b2c3d4e5f6', { ...park, score: 999999 }, 'thickiran')
  assert.equal(p.score, score(p))
  assert.equal(p.score, Math.round(712 * 2.25 + 45 + 48))
})

test('numbers are clamped', () => {
  const p = sanitizePark('a1b2c3d4e5f6', { ...park, rating: 1e9, ridesOpen: 99, guests: -5 }, 'u')
  assert.equal(p.rating, 999)
  assert.equal(p.ridesOpen, 16)
  assert.equal(p.guests, 0)
})

test('impossible parks are dropped', () => {
  assert.equal(sanitizePark('a1b2c3d4e5f6', { ...park, riders: 1e7, guestsTotal: 10 }, 'u'), null)
  assert.equal(sanitizePark('a1b2c3d4e5f6', { ...park, coasters: 4, ridesOpen: 1 }, 'u'), null)
  assert.equal(sanitizePark('not-an-id', park, 'u'), null)
  assert.equal(sanitizePark('a1b2c3d4e5f6', { ...park, updatedAt: '2999-01-01T00:00:00Z' }, 'u'), null)
  assert.equal(sanitizePark('a1b2c3d4e5f6', 'nope', 'u'), null)
})

test('names lose control characters and markup, and are capped', () => {
  assert.equal(cleanName('  <b>Hi</b>\u0007 '), 'bHi/b')
  assert.equal(cleanName('x'.repeat(80)).length, 40)
  assert.equal(cleanName(''), 'Unnamed Park')
})
