import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankCatalogMatch } from '../electron/services/catalog-match'
import { findTextRows, findRelicTextBand, isCompleteRiven, preferReading } from '../shared/ocr-quality'

const items = ['Mirage Prime Chassis', 'Mirage Prime Systems', 'Mesa Prime Systems',
  'Mag Prime Systems', 'Magnus Prime Barrel', 'Braton Prime Receiver', 'Burston Prime Receiver'].map((name) => ({
  name, normalized: name.toUpperCase(), uniqueName: name,
}))

test('reward matching tolerates glyph errors and reordered words', () => {
  for (const [raw, expected] of [
    ['MIRAGE PRIME CHASS1S', 'Mirage Prime Chassis'],
    ['SYSTEMS PRIME MESA', 'Mesa Prime Systems'],
    ['BRATON PR1ME RECEIVER', 'Braton Prime Receiver'],
  ]) assert.equal(rankCatalogMatch(raw, items)?.item.name, expected)
})

test('generic fragments and unrelated screen text cannot acquire an item price', () => {
  for (const raw of ['PRIME SYSTEMS', 'PRIME', 'CHASSIS', 'OWNED 42', 'ACCEPT DECLINE', '449 E']) {
    assert.equal(rankCatalogMatch(raw, items), null, raw)
  }
})

test('readable part names and short weapon identities are preserved', () => {
  assert.equal(rankCatalogMatch('MIRAGE PRIME SYSTEMS', items)?.item.name, 'Mirage Prime Systems')
  assert.equal(rankCatalogMatch('MAG PRIME SYSTEMS', items)?.item.name, 'Mag Prime Systems')
  assert.equal(rankCatalogMatch('MAG PRIME BARREL', items), null)
})

test('near ties remain below the minimum confidence for reward pricing', () => {
  const ambiguous = ['Astra Prime Systems', 'Astro Prime Systems'].map((name) => ({ name, normalized: name.toUpperCase(), uniqueName: name }))
  assert.ok((rankCatalogMatch('ASTRE PRIME SYSTEMS', ambiguous)?.score ?? 0) < .62)
})

test('readings are selected by confidence, never by extra gibberish length', () => {
  assert.deepEqual(preferReading({ text: 'Mirage Prime Systems', confidence: 90 }, { text: 'Mlrage Prlme Systems Owned Bonus', confidence: 45 }), { text: 'Mirage Prime Systems', confidence: 90 })
  assert.equal(preferReading({ text: '', confidence: 95 }, { text: 'Forma Blueprint', confidence: 70 }).text, 'Forma Blueprint')
})

test('incomplete and impossible riven layouts cannot drive a roll recommendation', () => {
  const stats = [{ name: 'critical chance', value: 120 }, { name: 'critical damage', value: 90 }]
  assert.ok(isCompleteRiven({ weapon: 'Soma', stats }))
  assert.ok(isCompleteRiven({ weapon: 'Soma', stats: [...stats, { name: 'zoom', value: -30 }] }))
  assert.equal(isCompleteRiven({ weapon: 'Unknown Riven', stats }), false)
  assert.equal(isCompleteRiven({ weapon: 'Soma', stats: stats.slice(0, 1) }), false)
  assert.equal(isCompleteRiven({ weapon: 'Soma', stats: [...stats, ...stats] }), false)
  assert.equal(isCompleteRiven({ weapon: 'Soma', stats: [...stats, { name: 'zoom', value: -30 }, { name: 'damage', value: -20 }] }), false)
})

test('adaptive text rows follow vertical UI shifts and ignore empty panels', () => {
  const width = 200, height = 120
  const bitmap = new Uint8Array(width * height * 4).fill(255)
  assert.deepEqual(findTextRows(bitmap, width, height), [])
  for (const top of [15, 45, 80]) for (let y = top; y < top + 9; y++) {
    for (let x = 30; x < 130; x += 3) bitmap[(y * width + x) * 4] = 0
  }
  const rows = findTextRows(bitmap, width, height)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map((r) => r.top), [12, 42, 77])
  assert.deepEqual(findTextRows(new Uint8Array(2), width, height), [])
})

test('reward text is selected instead of the ducat icon below it', () => {
  const width = 200, height = 100
  const bitmap = new Uint8Array(width * height * 4).fill(255)
  for (let y = 35; y < 49; y++) for (let x = 20; x < 180; x += 3) bitmap[(y * width + x) * 4] = 0
  for (let y = 74; y < 90; y++) for (let x = 90; x < 110; x++) bitmap[(y * width + x) * 4] = 0
  assert.equal(findRelicTextBand(bitmap, width, height)?.top, 32)
})
