/**
 * Shared join/leave mutations for HTTP API and Discord bot.
 */

/**
 * @param {unknown} v
 * @param {number} [max]
 */
export function cleanStr(v, max = 80) {
  return String(v || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, max)
}

export function discordClientId(discordUserId) {
  return `discord:${String(discordUserId)}`.slice(0, 64)
}

/**
 * @param {any} store
 * @param {string} listingId
 * @param {{ ign: string, clientId: string }} input
 * @returns {{ ok: boolean, error?: string, status?: number, alreadyJoined?: boolean, row?: any }}
 */
export function joinListing(store, listingId, input) {
  const row = store.get(listingId)
  if (!row || Date.parse(row.expiresAt) <= Date.now()) {
    return { ok: false, status: 404, error: 'Listing not found or expired' }
  }
  const ign = cleanStr(input.ign, 24)
  const clientId = cleanStr(input.clientId, 64)
  if (!ign || ign.length < 2) {
    return { ok: false, status: 400, error: 'In-game name required' }
  }
  if (!clientId) {
    return { ok: false, status: 400, error: 'clientId required' }
  }
  if (row.members.some((m) => m.clientId === clientId)) {
    return { ok: true, alreadyJoined: true, row }
  }
  // Same IGN already in squad (different client) — still allow, Warframe IGNs aren't unique keys
  if (row.members.length >= row.slotsTotal) {
    return { ok: false, status: 409, error: 'Squad full' }
  }
  row.members.push({
    ign,
    clientId,
    joinedAt: new Date().toISOString(),
    isHost: false,
  })
  store.upsert(row)
  return { ok: true, alreadyJoined: false, row }
}

/**
 * @param {any} store
 * @param {string} listingId
 * @param {{ clientId: string }} input
 * @returns {{ ok: boolean, error?: string, status?: number, row?: any | null, closed?: boolean, changed?: boolean }}
 */
export function leaveListing(store, listingId, input) {
  const row = store.get(listingId)
  if (!row) {
    return { ok: false, status: 404, error: 'Listing not found' }
  }
  const clientId = cleanStr(input.clientId, 64)
  if (!clientId) {
    return { ok: false, status: 400, error: 'clientId required' }
  }
  const before = row.members.length
  const snapshot = { ...row, members: [...row.members] }
  row.members = row.members.filter((m) => m.clientId !== clientId)
  if (row.members.length === before) {
    return { ok: true, changed: false, row, closed: false }
  }
  if (!row.members.length || !row.members.some((m) => m.isHost)) {
    store.remove(row.id)
    return { ok: true, changed: true, closed: true, row: snapshot }
  }
  store.upsert(row)
  return { ok: true, changed: true, closed: false, row }
}
