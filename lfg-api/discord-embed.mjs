/**
 * Shared LFG Discord embed + whisper button helpers (bot + webhook).
 */

export const LFG_DISCORD_USERNAME = 'Everything Warframe LFG'
export const WHISPER_CUSTOM_ID_PREFIX = 'lfg:whisper:'

/**
 * @param {string} listingId
 */
export function whisperButtonCustomId(listingId) {
  return `${WHISPER_CUSTOM_ID_PREFIX}${String(listingId)}`
}

/**
 * @param {string} customId
 * @returns {string | null}
 */
export function parseWhisperButtonCustomId(customId) {
  if (typeof customId !== 'string' || !customId.startsWith(WHISPER_CUSTOM_ID_PREFIX)) {
    return null
  }
  const id = customId.slice(WHISPER_CUSTOM_ID_PREFIX.length).trim()
  return id || null
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
 * @param {object} listing
 * @param {{ closed?: boolean }} [opts]
 * @returns {{ title: string, description?: string, color: number, fields: object[], footer?: object }}
 */
export function buildLfgEmbed(listing, opts = {}) {
  const closed = Boolean(opts.closed)
  const members = Array.isArray(listing.members) ? listing.members.length : 1
  const slots = Math.max(2, Number(listing.slotsTotal) || 4)
  const full = !closed && members >= slots
  const roster =
    Array.isArray(listing.members) && listing.members.length
      ? listing.members
          .map((m) => String(m?.ign || '?').slice(0, 24))
          .join(', ')
          .slice(0, 200)
      : String(listing.hostIgn || '?').slice(0, 24)

  const whisper =
    listing.whisper ||
    (!closed ? buildWhisperFromListing(listing) : '')

  const fields = [
    { name: 'Host', value: String(listing.hostIgn || '?').slice(0, 24), inline: true },
    {
      name: 'Activity',
      value: String(listing.activity || 'custom').slice(0, 24),
      inline: true,
    },
    {
      name: 'Slots',
      value: closed
        ? `Closed · was ${members}/${slots}`
        : `${members}/${slots}${full ? ' · FULL' : ''}`,
      inline: true,
    },
    {
      name: 'Roster',
      value: roster || '—',
      inline: false,
    },
    {
      name: 'Platform',
      value: String(listing.platform || 'pc').toUpperCase().slice(0, 16),
      inline: true,
    },
    {
      name: 'Region',
      value: String(listing.region || 'na').toUpperCase().slice(0, 8),
      inline: true,
    },
  ]
  if (listing.relicKey) {
    fields.push({
      name: 'Relic',
      value: [listing.relicKey, listing.refinement, listing.shareType]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 100),
      inline: true,
    })
  }
  if (listing.missionHint) {
    fields.push({
      name: 'Mission',
      value: String(listing.missionHint).slice(0, 60),
      inline: true,
    })
  }
  if (listing.steelPath) {
    fields.push({ name: 'Path', value: 'Steel Path', inline: true })
  }

  const descriptionBits = []
  if (listing.notes) descriptionBits.push(String(listing.notes).slice(0, 160))
  if (!closed && whisper) {
    descriptionBits.push(
      `**Whisper** (button or select → copy)\n\`${String(whisper).slice(0, 180)}\``,
    )
  }

  const titleBase = String(listing.title || 'LFG').slice(0, 80)
  let title = titleBase
  if (closed) title = `${titleBase} · closed`
  else if (full) title = `${titleBase} · FULL`

  const inviteHint = listing.inviteHint || (listing.hostIgn ? `/invite ${listing.hostIgn}` : '')

  return {
    title: title.slice(0, 100),
    description: descriptionBits.join('\n\n').slice(0, 500) || undefined,
    color: closed ? 0x6b7280 : full ? 0xc45c26 : 0x3d9bb8,
    fields,
    footer: inviteHint ? { text: String(inviteHint).slice(0, 100) } : undefined,
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
  return [
    {
      type: 1, // ActionRow
      components: [
        {
          type: 2, // Button
          style: 1, // Primary
          label: 'Whisper',
          custom_id: whisperButtonCustomId(listing.id),
        },
      ],
    },
  ]
}
