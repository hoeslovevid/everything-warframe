/**
 * Shared LFG Discord embed + whisper button helpers (bot + webhook).
 */

export const LFG_DISCORD_USERNAME = 'Everything Warframe LFG'
/** Public brand mark for author / thumbnail (repo asset). */
export const BRAND_ICON_URL =
  'https://cdn.jsdelivr.net/gh/hoeslovevid/everything-warframe@master/resources/icon-256.png'

export const WHISPER_CUSTOM_ID_PREFIX = 'lfg:whisper:'
export const JOIN_CUSTOM_ID_PREFIX = 'lfg:join:'
export const LEAVE_CUSTOM_ID_PREFIX = 'lfg:leave:'
export const JOIN_MODAL_ID_PREFIX = 'lfg:joinmodal:'
export const CLOSE_CUSTOM_ID_PREFIX = 'lfg:close:'

/**
 * @param {string} listingId
 */
export function whisperButtonCustomId(listingId) {
  return `${WHISPER_CUSTOM_ID_PREFIX}${String(listingId)}`
}

/**
 * @param {string} listingId
 */
export function joinButtonCustomId(listingId) {
  return `${JOIN_CUSTOM_ID_PREFIX}${String(listingId)}`
}

/**
 * @param {string} listingId
 */
export function leaveButtonCustomId(listingId) {
  return `${LEAVE_CUSTOM_ID_PREFIX}${String(listingId)}`
}

/**
 * @param {string} listingId
 */
export function closeButtonCustomId(listingId) {
  return `${CLOSE_CUSTOM_ID_PREFIX}${String(listingId)}`
}

/**
 * @param {string} listingId
 */
export function joinModalCustomId(listingId) {
  return `${JOIN_MODAL_ID_PREFIX}${String(listingId)}`
}

/**
 * @param {string} customId
 * @param {string} prefix
 * @returns {string | null}
 */
function parsePrefixedId(customId, prefix) {
  if (typeof customId !== 'string' || !customId.startsWith(prefix)) return null
  const id = customId.slice(prefix.length).trim()
  return id || null
}

/**
 * @param {string} customId
 * @returns {string | null}
 */
export function parseWhisperButtonCustomId(customId) {
  return parsePrefixedId(customId, WHISPER_CUSTOM_ID_PREFIX)
}

/**
 * @param {string} customId
 * @returns {string | null}
 */
export function parseJoinButtonCustomId(customId) {
  return parsePrefixedId(customId, JOIN_CUSTOM_ID_PREFIX)
}

/**
 * @param {string} customId
 * @returns {string | null}
 */
export function parseLeaveButtonCustomId(customId) {
  return parsePrefixedId(customId, LEAVE_CUSTOM_ID_PREFIX)
}

/**
 * @param {string} customId
 * @returns {string | null}
 */
export function parseCloseButtonCustomId(customId) {
  return parsePrefixedId(customId, CLOSE_CUSTOM_ID_PREFIX)
}

/**
 * @param {string} customId
 * @returns {string | null}
 */
export function parseJoinModalCustomId(customId) {
  return parsePrefixedId(customId, JOIN_MODAL_ID_PREFIX)
}

/**
 * @param {object} row listing row (store or public)
 */
export function buildWhisperFromListing(row) {
  const bits = [`LFG ${row.title || ''}`.trim()]
  if (row.relicKey) bits.push(row.relicKey)
  if (row.shareType) bits.push(row.shareType)
  if (row.steelPath) bits.push('SP')
  if (row.missionHint) bits.push(row.missionHint)
  const members = Array.isArray(row.members) ? row.members.length : 1
  const slots = Math.max(2, Number(row.slotsTotal) || 4)
  bits.push(`${members}/${slots}`)
  bits.push(String(row.platform || 'pc').toUpperCase())
  bits.push(String(row.region || 'na').toUpperCase())
  return `/w ${row.hostIgn || '?'} ${bits.join(' · ')}`.replace(/\s+/g, ' ').trim()
}

/**
 * @param {number} filled
 * @param {number} total
 */
function slotBar(filled, total) {
  const n = Math.max(2, Math.min(4, total))
  const f = Math.max(0, Math.min(n, filled))
  return `${'▰'.repeat(f)}${'▱'.repeat(n - f)}  **${f}/${n}**`
}

/**
 * @param {string} activity
 */
function activityMeta(activity) {
  const a = String(activity || 'custom').toLowerCase()
  const map = {
    relic: { label: 'Relic', emoji: '◇', color: 0x4a9fd8 },
    fissure: { label: 'Fissure', emoji: '◈', color: 0x6b7fd7 },
    farm: { label: 'Farm', emoji: '▣', color: 0x3dba8c },
    boss: { label: 'Boss', emoji: '⬡', color: 0xd4783c },
    custom: { label: 'Custom', emoji: '◎', color: 0x5a8faf },
  }
  return map[a] || map.custom
}

/**
 * @param {object} listing
 * @param {{ closed?: boolean }} [opts]
 * @returns {{
 *   title: string,
 *   description?: string,
 *   color: number,
 *   fields: object[],
 *   footer?: { text: string, icon_url?: string },
 *   author?: { name: string, icon_url?: string },
 *   thumbnail?: { url: string },
 *   timestamp?: string,
 * }}
 */
export function buildLfgEmbed(listing, opts = {}) {
  const closed = Boolean(opts.closed)
  const members = Array.isArray(listing.members) ? listing.members.length : 1
  const slots = Math.max(2, Number(listing.slotsTotal) || 4)
  const full = !closed && members >= slots
  const meta = activityMeta(listing.activity)
  const host = String(listing.hostIgn || '?').slice(0, 24)
  const platform = String(listing.platform || 'pc').toUpperCase().slice(0, 16)
  const region = String(listing.region || 'na').toUpperCase().slice(0, 8)

  const rosterLines =
    Array.isArray(listing.members) && listing.members.length
      ? listing.members.map((m) => {
          const ign = String(m?.ign || '?').slice(0, 24)
          return m?.isHost ? `★ **${ign}** · host` : `• ${ign}`
        })
      : [`★ **${host}** · host`]
  // Pad empty seats for a clean squad card look
  for (let i = rosterLines.length; i < slots; i++) {
    rosterLines.push(`○ _open_`)
  }

  const detailBits = [`${meta.emoji} ${meta.label}`, platform, region]
  if (listing.steelPath) detailBits.push('Steel Path')
  if (listing.relicKey) {
    detailBits.push(
      [listing.relicKey, listing.refinement, listing.shareType].filter(Boolean).join(' · '),
    )
  }
  if (listing.missionHint) detailBits.push(String(listing.missionHint).slice(0, 60))

  const titleBase = String(listing.title || 'Looking for group').slice(0, 70)
  let title = titleBase
  let color = meta.color
  if (closed) {
    title = `${titleBase}`
    color = 0x6b7280
  } else if (full) {
    title = `${titleBase}`
    color = 0xd97706
  }

  const seekingHost = String(listing.intent || 'host').toLowerCase() === 'seek'
  const statusLine = closed
    ? '**Status** · Closed'
    : full
      ? '**Status** · Full'
      : `**Status** · Open · looking for ${Math.max(0, slots - members)}`

  const descriptionBits = []
  if (seekingHost && !closed) {
    descriptionBits.push('**Looking for host**')
  }
  descriptionBits.push(statusLine)
  if (listing.notes) {
    descriptionBits.push(`\n${String(listing.notes).slice(0, 180)}`)
  }

  const inviteHint = listing.inviteHint || (listing.hostIgn ? `/invite ${listing.hostIgn}` : '')
  const footerParts = []
  if (inviteHint) footerParts.push(inviteHint)
  footerParts.push('Everything Warframe')
  if (closed) footerParts.push('closed')
  else if (full) footerParts.push('full')
  else if (seekingHost) footerParts.push('looking for host')

  let timestamp
  if (listing.createdAt && !Number.isNaN(Date.parse(listing.createdAt))) {
    timestamp = new Date(listing.createdAt).toISOString()
  } else {
    timestamp = new Date().toISOString()
  }

  /** @type {object[]} */
  const fields = [
    {
      name: 'Squad',
      value: slotBar(closed ? members : members, slots),
      inline: true,
    },
    {
      name: 'Details',
      value: detailBits.join(' · ').slice(0, 200),
      inline: true,
    },
  ]
  if (listing.voiceChannelUrl) {
    fields.push({
      name: 'Voice',
      value: `[Join voice](${String(listing.voiceChannelUrl).slice(0, 200)})`,
      inline: true,
    })
  }
  fields.push({
    name: 'Roster',
    value: rosterLines.join('\n').slice(0, 400),
    inline: false,
  })

  return {
    author: {
      name: 'Everything Warframe · LFG',
      icon_url: BRAND_ICON_URL,
    },
    title: title.slice(0, 100),
    description: descriptionBits.join('\n').slice(0, 500) || undefined,
    color,
    thumbnail: { url: BRAND_ICON_URL },
    fields,
    footer: {
      text: footerParts.join(' · ').slice(0, 180),
      icon_url: BRAND_ICON_URL,
    },
    timestamp,
  }
}

/**
 * Webhook JSON body (no interactive components — those need the bot).
 * @param {object} listing
 * @param {{ closed?: boolean }} [opts]
 */
export function buildLfgDiscordPayload(listing, opts = {}) {
  return {
    username: LFG_DISCORD_USERNAME,
    embeds: [buildLfgEmbed(listing, opts)],
  }
}

/**
 * REST-style components for bot messages (ActionRow + Whisper button).
 * @param {object} listing
 * @param {{ closed?: boolean }} [opts]
 */
export function buildLfgDiscordComponents(listing, opts = {}) {
  if (opts.closed || !listing?.id) return []
  const members = Array.isArray(listing.members) ? listing.members.length : 1
  const slots = Math.max(2, Number(listing.slotsTotal) || 4)
  const full = members >= slots
  /** @type {object[]} */
  const buttons = []
  if (!full) {
    buttons.push({
      type: 2,
      style: 3, // Success
      label: 'Join',
      custom_id: joinButtonCustomId(listing.id),
    })
  }
  buttons.push({
    type: 2,
    style: 2, // Secondary
    label: 'Leave',
    custom_id: leaveButtonCustomId(listing.id),
  })
  buttons.push({
    type: 2,
    style: 1, // Primary
    label: 'Whisper',
    custom_id: whisperButtonCustomId(listing.id),
  })
  return [{ type: 1, components: buttons }]
}
