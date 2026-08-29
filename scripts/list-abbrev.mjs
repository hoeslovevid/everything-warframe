import fs from 'node:fs'

const text = fs.readFileSync('resources/riven-preferences-source.csv', 'utf8')
const lines = text.split(/\r?\n/).slice(19)
const codes = new Set()

function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQ = !inQ
      continue
    }
    if (ch === ',' && !inQ) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

for (const line of lines) {
  const cols = splitCsvLine(line)
  for (const cell of cols.slice(1, 5)) {
    for (const part of String(cell).split(/[>/]/)) {
      const m = part.trim().match(/^([A-Za-z]+)/)
      if (m) codes.add(m[1].toUpperCase())
    }
  }
}

const known = new Set([
  'MS', 'DMG', 'CC', 'CD', 'SC', 'SD', 'FR', 'AS', 'RNG', 'PT', 'RLS', 'CCC', 'IC', 'EFF',
  'FIN', 'SLIDE', 'TOX', 'ELEC', 'IMP', 'PUNC', 'SL', 'MAG', 'PFS', 'REC', 'Z', 'DTG', 'DTC', 'DTI',
])
console.log('unmapped:', [...codes].filter((c) => !known.has(c)).sort().join(', '))
console.log('all:', [...codes].sort().join(', '))
