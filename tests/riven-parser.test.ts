import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRivenOcr, recommendRolls } from '../electron/services/riven-grader'

test('real Vectis debug card retains all three elemental and critical values', () => {
  const roll = parseRivenOcr('Vectis Acri-ignitox\n+113.4% Critical Damage\n+70.5% Toxin\n+70.6% Heat', 'current')
  assert.match(roll.weapon, /Vectis/)
  assert.deepEqual(roll.stats.map((s) => [s.name, s.value]).sort(), [
    ['critical damage', 113.4], ['heat damage', 70.6], ['toxin damage', 70.5],
  ])
})

test('equal values on different stats are not deduplicated', () => {
  const roll = parseRivenOcr('Vectis Acri-ignitox\n+70.5% Toxin\n+70.5% Heat', 'current')
  assert.equal(roll.stats.length, 2)
})

test('negative signs and decimal commas survive OCR cleanup', () => {
  const roll = parseRivenOcr('Vectis Hera-ignitis\n+97,6% Heat\n+69,7% Zoom\n+125,1% Critical Damage\n−95,3% Slash', 'reroll')
  assert.equal(roll.stats.find((s) => s.name === 'heat damage')?.value, 97.6)
  assert.equal(roll.stats.find((s) => s.name === 'slash damage')?.value, -95.3)
})

test('faction multiplier is converted to percentage without losing other stats', () => {
  const roll = parseRivenOcr('Akarius Pura-hexatio\n+67.1% Electricity\nx1.38 Damage to Infested\n+73.1% Status Chance', 'reroll')
  assert.equal(roll.stats.find((s) => s.name === 'damage to infested')?.value, 38)
  assert.equal(roll.stats.find((s) => s.name === 'electricity damage')?.value, 67.1)
})

test('one parsed stat cannot trigger a keep/take recommendation', () => {
  const current = parseRivenOcr('Vectis Acri-ignitox\n+113.4% Critical Damage', 'current')
  const reroll = parseRivenOcr('Vectis Hera-ignitis\n+97.6% Heat\n+125.1% Critical Damage', 'reroll')
  assert.equal(recommendRolls(current, reroll).recommendation, 'none')
})

test('observed sparse OCR preserves split decimals and the Heat glyph confusion', () => {
  const roll = parseRivenOcr('Vectis Hera-ignitis\n+97.6%\nHeal\n+69. 7% Zoom\n+125.1% Critical Damage\n-95.3%\nSlash', 'reroll')
  assert.equal(roll.stats.find((s) => s.name === 'zoom')?.value, 69.7)
  assert.equal(roll.stats.find((s) => s.name === 'heat damage')?.value, 97.6)
  assert.equal(roll.stats.length, 4)
})
