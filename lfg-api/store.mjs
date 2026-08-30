/**
 * LFG persistence layer.
 * Prefer built-in node:sqlite (Node 22.5+) on a durable volume — no native addons.
 * Fall back to atomic JSON for Electron local hubs (older embedded Node).
 *
 * Env:
 *   LFG_DATA      — full path to .sqlite or .json
 *   LFG_DATA_DIR  — directory (default file: lfg.sqlite inside it)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * @typedef {object} LfgStore
 * @property {string} kind
 * @property {string} path
 * @property {() => number} count
 * @property {() => any[]} purgeExpired  returns removed rows (for Discord cleanup)
 * @property {(filters?: { region?: string, platform?: string, activity?: string, q?: string, intent?: string }) => any[]} list
 * @property {(id: string) => any | null} get
 * @property {(row: any) => void} upsert
 * @property {(id: string) => void} remove
 * @property {() => Array<{ guildId: string, channelId: string, webhookUrl: string | null, configuredBy: string | null, configuredAt: string, membersOnly: boolean, activityAllowlist: string[], regionAllowlist: string[], platformAllowlist: string[], pingRoleId: string | null }>} listDiscordGuilds
 * @property {(guildId: string) => any | null} getDiscordGuild
 * @property {(row: { guildId: string, channelId: string, webhookUrl?: string | null, configuredBy?: string | null, membersOnly?: boolean, activityAllowlist?: string[] | null, regionAllowlist?: string[] | null, platformAllowlist?: string[] | null, pingRoleId?: string | null }) => void} upsertDiscordGuild
 * @property {(guildId: string) => void} removeDiscordGuild
 * @property {(discordUserId: string) => string | null} getDiscordUserIgn
 * @property {(discordUserId: string, ign: string) => void} setDiscordUserIgn
 * @property {(discordUserId: string) => void} clearDiscordUserIgn
 * @property {(ign: string) => string[]} findDiscordUserIdsByIgn
 * @property {(clientId: string) => boolean} isClientBlocked
 * @property {(clientId: string, reason?: string) => void} blockClient
 * @property {(listingId: string, reporterClientId: string, reason?: string) => { ok: boolean, reportCount?: number, hidden?: boolean, error?: string }} reportListing
 * @property {() => void} [close]
 */

export function resolveDataPath() {
  if (process.env.LFG_DATA) return path.resolve(process.env.LFG_DATA)
  const dir = process.env.LFG_DATA_DIR
    ? path.resolve(process.env.LFG_DATA_DIR)
    : path.join(__dirname, 'data')
  return path.join(dir, 'lfg.sqlite')
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

/** @param {unknown} raw */
function normalizeActivityAllowlist(raw) {
  /** @type {string[]} */
  let parts = []
  if (Array.isArray(raw)) {
    parts = raw.map((s) => String(s || '').trim().toLowerCase())
  } else if (typeof raw === 'string') {
    parts = raw.split(/[,;]+/).map((s) => s.trim().toLowerCase())
  }
  return [...new Set(parts.filter(Boolean))].slice(0, 24)
}

const normalizeStringAllowlist = normalizeActivityAllowlist

/**
 * @param {any} g
 */
function normalizeGuildRow(guildId, g) {
  return {
    guildId,
    channelId: String(g.channelId),
    webhookUrl: g.webhookUrl ? String(g.webhookUrl) : null,
    configuredBy: g.configuredBy ? String(g.configuredBy) : null,
    configuredAt: g.configuredAt || new Date().toISOString(),
    membersOnly: Boolean(g.membersOnly),
    activityAllowlist: normalizeStringAllowlist(g.activityAllowlist),
    regionAllowlist: normalizeStringAllowlist(g.regionAllowlist),
    platformAllowlist: normalizeStringAllowlist(g.platformAllowlist),
    pingRoleId: g.pingRoleId ? String(g.pingRoleId) : null,
  }
}

function migrateJsonInto(store, jsonPath) {
  try {
    if (!fs.existsSync(jsonPath)) return 0
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const arr = Array.isArray(raw?.listings) ? raw.listings : []
    let n = 0
    for (const row of arr) {
      if (row?.id) {
        store.upsert(row)
        n++
      }
    }
    if (n > 0) {
      const bak = `${jsonPath}.migrated`
      try {
        fs.renameSync(jsonPath, bak)
      } catch {
        // keep original if rename fails
      }
      console.info(`[LFG] Migrated ${n} listing(s) from ${jsonPath}`)
    }
    return n
  } catch (err) {
    console.warn('[LFG] JSON migrate skipped:', err instanceof Error ? err.message : err)
    return 0
  }
}

function applyFilters(rows, filters = {}) {
  let out = rows.filter((r) => !r.hidden)
  const region = (filters.region || '').toLowerCase()
  const platform = (filters.platform || '').toLowerCase()
  const activity = (filters.activity || '').toLowerCase()
  const intent = (filters.intent || '').toLowerCase()
  const q = (filters.q || '').toLowerCase()
  if (region && region !== 'all') out = out.filter((r) => r.region === region)
  if (platform && platform !== 'all') {
    out = out.filter((r) => r.platform === platform || platform === 'crossplay')
  }
  if (activity && activity !== 'all') out = out.filter((r) => r.activity === activity)
  if (intent && intent !== 'all') {
    out = out.filter((r) => String(r.intent || 'host') === intent)
  }
  if (q) {
    out = out.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.relicKey || '').toLowerCase().includes(q) ||
        r.hostIgn.toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q),
    )
  }
  return out
}

function createJsonStore(filePath) {
  ensureParentDir(filePath)
  /** @type {Map<string, any>} */
  const listings = new Map()
  /** @type {Map<string, any>} */
  const discordGuilds = new Map()
  /** @type {Map<string, string>} */
  const discordUserIgns = new Map()
  /** @type {Set<string>} */
  const blockedClients = new Set()
  /** @type {Map<string, Set<string>>} */
  const listingReports = new Map()

  function load() {
    try {
      if (!fs.existsSync(filePath)) return
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const arr = Array.isArray(raw?.listings) ? raw.listings : []
      for (const row of arr) {
        if (row?.id) {
          listings.set(row.id, {
            ...row,
            intent: row.intent === 'seek' ? 'seek' : 'host',
            voiceChannelUrl: row.voiceChannelUrl || null,
            reportCount: Number(row.reportCount) || 0,
            hidden: Boolean(row.hidden),
          })
        }
      }
      const guilds =
        raw?.discordGuilds && typeof raw.discordGuilds === 'object' ? raw.discordGuilds : {}
      for (const [guildId, g] of Object.entries(guilds)) {
        if (g && typeof g === 'object' && g.channelId) {
          discordGuilds.set(guildId, normalizeGuildRow(guildId, g))
        }
      }
      const igns =
        raw?.discordUserIgns && typeof raw.discordUserIgns === 'object'
          ? raw.discordUserIgns
          : {}
      for (const [uid, ign] of Object.entries(igns)) {
        if (typeof ign === 'string' && ign.trim()) {
          discordUserIgns.set(uid, ign.trim().slice(0, 24))
        }
      }
      for (const id of Array.isArray(raw?.blockedClients) ? raw.blockedClients : []) {
        if (typeof id === 'string' && id.trim()) blockedClients.add(id.trim())
      }
    } catch {
      // ignore corrupt
    }
  }

  function save() {
    ensureParentDir(filePath)
    const tmp = `${filePath}.${process.pid}.tmp`
    const payload = JSON.stringify(
      {
        listings: [...listings.values()],
        discordGuilds: Object.fromEntries(
          [...discordGuilds.entries()].map(([id, g]) => [id, g]),
        ),
        discordUserIgns: Object.fromEntries([...discordUserIgns.entries()]),
        blockedClients: [...blockedClients],
      },
      null,
      0,
    )
    fs.writeFileSync(tmp, payload, 'utf8')
    fs.renameSync(tmp, filePath)
  }

  load()

  /** @type {LfgStore} */
  return {
    kind: 'json',
    path: filePath,
    count() {
      return listings.size
    },
    purgeExpired() {
      const now = Date.now()
      /** @type {any[]} */
      const removed = []
      for (const [id, row] of listings) {
        if (Date.parse(row.expiresAt) <= now) {
          removed.push(row)
          listings.delete(id)
        }
      }
      if (removed.length) save()
      return removed
    },
    list(filters = {}) {
      const rows = applyFilters([...listings.values()], filters)
      rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return rows
    },
    get(id) {
      return listings.get(id) || null
    },
    upsert(row) {
      listings.set(row.id, row)
      save()
    },
    remove(id) {
      if (listings.delete(id)) save()
    },
    listDiscordGuilds() {
      return [...discordGuilds.values()]
    },
    getDiscordGuild(guildId) {
      return discordGuilds.get(guildId) || null
    },
    upsertDiscordGuild(row) {
      const prev = discordGuilds.get(row.guildId)
      discordGuilds.set(
        row.guildId,
        normalizeGuildRow(row.guildId, {
          channelId: row.channelId,
          webhookUrl: row.webhookUrl !== undefined ? row.webhookUrl : prev?.webhookUrl,
          configuredBy: row.configuredBy !== undefined ? row.configuredBy : prev?.configuredBy,
          configuredAt: new Date().toISOString(),
          membersOnly:
            typeof row.membersOnly === 'boolean'
              ? row.membersOnly
              : Boolean(prev?.membersOnly),
          activityAllowlist:
            row.activityAllowlist !== undefined
              ? row.activityAllowlist
              : prev?.activityAllowlist,
          regionAllowlist:
            row.regionAllowlist !== undefined ? row.regionAllowlist : prev?.regionAllowlist,
          platformAllowlist:
            row.platformAllowlist !== undefined
              ? row.platformAllowlist
              : prev?.platformAllowlist,
          pingRoleId:
            row.pingRoleId !== undefined ? row.pingRoleId : prev?.pingRoleId,
        }),
      )
      save()
    },
    removeDiscordGuild(guildId) {
      if (discordGuilds.delete(guildId)) save()
    },
    getDiscordUserIgn(discordUserId) {
      return discordUserIgns.get(discordUserId) || null
    },
    setDiscordUserIgn(discordUserId, ign) {
      discordUserIgns.set(discordUserId, String(ign).trim().slice(0, 24))
      save()
    },
    clearDiscordUserIgn(discordUserId) {
      if (discordUserIgns.delete(discordUserId)) save()
    },
    findDiscordUserIdsByIgn(ign) {
      const needle = String(ign || '')
        .trim()
        .toLowerCase()
      if (!needle) return []
      /** @type {string[]} */
      const out = []
      for (const [uid, linked] of discordUserIgns) {
        if (String(linked).trim().toLowerCase() === needle) out.push(uid)
      }
      return out
    },
    isClientBlocked(clientId) {
      return blockedClients.has(String(clientId || '').trim())
    },
    blockClient(clientId) {
      const id = String(clientId || '').trim()
      if (!id) return
      blockedClients.add(id)
      save()
    },
    reportListing(listingId, reporterClientId, reason = '') {
      const row = listings.get(listingId)
      if (!row) return { ok: false, error: 'Listing not found' }
      const reporter = String(reporterClientId || '').trim()
      if (!reporter) return { ok: false, error: 'clientId required' }
      if (row.members?.some((m) => m.clientId === reporter)) {
        return { ok: false, error: 'Cannot report your own squad' }
      }
      let set = listingReports.get(listingId)
      if (!set) {
        set = new Set()
        listingReports.set(listingId, set)
      }
      if (set.has(reporter)) {
        return { ok: true, reportCount: row.reportCount || set.size, hidden: Boolean(row.hidden) }
      }
      set.add(reporter)
      row.reportCount = set.size
      row.reportNote = String(reason || '').slice(0, 120)
      if (set.size >= 3) {
        row.hidden = true
        // Soft-block repeat offenders by host clientId
        const host = row.members?.find((m) => m.isHost)
        if (host?.clientId) blockedClients.add(host.clientId)
      }
      listings.set(listingId, row)
      save()
      return { ok: true, reportCount: row.reportCount, hidden: Boolean(row.hidden) }
    },
  }
}

function parseDiscordPosts(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function rowFromSqlite(listing, members) {
  const discordPosts = parseDiscordPosts(listing.discord_posts)
  const discordMessageId =
    listing.discord_message_id || discordPosts[0]?.messageId || null
  return {
    id: listing.id,
    createdAt: listing.created_at,
    expiresAt: listing.expires_at,
    hostIgn: listing.host_ign,
    hostToken: listing.host_token,
    platform: listing.platform,
    region: listing.region,
    language: listing.language,
    activity: listing.activity,
    title: listing.title,
    notes: listing.notes || '',
    relicKey: listing.relic_key,
    refinement: listing.refinement,
    shareType: listing.share_type,
    steelPath: Boolean(listing.steel_path),
    missionHint: listing.mission_hint,
    slotsTotal: listing.slots_total,
    intent: listing.intent === 'seek' ? 'seek' : 'host',
    voiceChannelUrl: listing.voice_channel_url || null,
    reportCount: Number(listing.report_count) || 0,
    hidden: Boolean(listing.hidden),
    discordMessageId,
    discordPosts,
    members: members.map((m) => ({
      ign: m.ign,
      clientId: m.client_id,
      joinedAt: m.joined_at,
      isHost: Boolean(m.is_host),
    })),
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    host_ign TEXT NOT NULL,
    host_token TEXT NOT NULL,
    platform TEXT NOT NULL,
    region TEXT NOT NULL,
    language TEXT NOT NULL,
    activity TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    relic_key TEXT,
    refinement TEXT,
    share_type TEXT,
    steel_path INTEGER NOT NULL DEFAULT 0,
    mission_hint TEXT,
    slots_total INTEGER NOT NULL,
    discord_message_id TEXT,
    discord_posts TEXT,
    intent TEXT NOT NULL DEFAULT 'host',
    voice_channel_url TEXT,
    report_count INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS members (
    listing_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    ign TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    is_host INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (listing_id, client_id),
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS discord_guild_settings (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    webhook_url TEXT,
    configured_by TEXT,
    configured_at TEXT NOT NULL,
    members_only INTEGER NOT NULL DEFAULT 0,
    activity_allowlist TEXT,
    region_allowlist TEXT,
    platform_allowlist TEXT,
    ping_role_id TEXT
  );
  CREATE TABLE IF NOT EXISTS discord_user_profiles (
    discord_user_id TEXT PRIMARY KEY,
    ign TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blocked_clients (
    client_id TEXT PRIMARY KEY,
    reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS listing_reports (
    listing_id TEXT NOT NULL,
    reporter_client_id TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (listing_id, reporter_client_id)
  );
  CREATE INDEX IF NOT EXISTS idx_listings_expires ON listings(expires_at);
  CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at);
`

function migrateLegacyJson(store, dataPath) {
  migrateJsonInto(store, path.join(path.dirname(dataPath), 'lfg-data.json'))
  migrateJsonInto(store, dataPath.replace(/\.sqlite3?$/i, '.json'))
  migrateJsonInto(store, path.join(__dirname, 'lfg-data.json'))
}

/**
 * @param {string} dbPath
 * @param {typeof import('node:sqlite').DatabaseSync} DatabaseSync
 * @returns {LfgStore}
 */
function openNodeSqlite(dbPath, DatabaseSync) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_SQL)

  const run = (sql, params = {}) => db.prepare(sql).run(params)
  const all = (sql, params = {}) => db.prepare(sql).all(params)
  const getOne = (sql, params = {}) => db.prepare(sql).get(params)

  // Additive migration for existing volumes
  const listingCols = new Set(all(`PRAGMA table_info(listings)`).map((c) => c.name))
  if (!listingCols.has('discord_message_id')) {
    db.exec(`ALTER TABLE listings ADD COLUMN discord_message_id TEXT`)
  }
  if (!listingCols.has('discord_posts')) {
    db.exec(`ALTER TABLE listings ADD COLUMN discord_posts TEXT`)
  }
  if (!listingCols.has('intent')) {
    db.exec(`ALTER TABLE listings ADD COLUMN intent TEXT NOT NULL DEFAULT 'host'`)
  }
  if (!listingCols.has('voice_channel_url')) {
    db.exec(`ALTER TABLE listings ADD COLUMN voice_channel_url TEXT`)
  }
  if (!listingCols.has('report_count')) {
    db.exec(`ALTER TABLE listings ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0`)
  }
  if (!listingCols.has('hidden')) {
    db.exec(`ALTER TABLE listings ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_guild_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      webhook_url TEXT,
      configured_by TEXT,
      configured_at TEXT NOT NULL,
      members_only INTEGER NOT NULL DEFAULT 0,
      activity_allowlist TEXT,
      region_allowlist TEXT,
      platform_allowlist TEXT,
      ping_role_id TEXT
    );
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_clients (
      client_id TEXT PRIMARY KEY,
      reason TEXT,
      created_at TEXT NOT NULL
    );
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS listing_reports (
      listing_id TEXT NOT NULL,
      reporter_client_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (listing_id, reporter_client_id)
    );
  `)
  const guildCols = new Set(
    all(`PRAGMA table_info(discord_guild_settings)`).map((c) => c.name),
  )
  if (!guildCols.has('members_only')) {
    db.exec(
      `ALTER TABLE discord_guild_settings ADD COLUMN members_only INTEGER NOT NULL DEFAULT 0`,
    )
  }
  if (!guildCols.has('activity_allowlist')) {
    db.exec(`ALTER TABLE discord_guild_settings ADD COLUMN activity_allowlist TEXT`)
  }
  if (!guildCols.has('region_allowlist')) {
    db.exec(`ALTER TABLE discord_guild_settings ADD COLUMN region_allowlist TEXT`)
  }
  if (!guildCols.has('platform_allowlist')) {
    db.exec(`ALTER TABLE discord_guild_settings ADD COLUMN platform_allowlist TEXT`)
  }
  if (!guildCols.has('ping_role_id')) {
    db.exec(`ALTER TABLE discord_guild_settings ADD COLUMN ping_role_id TEXT`)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_user_profiles (
      discord_user_id TEXT PRIMARY KEY,
      ign TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  function hydrate(listingRow) {
    if (!listingRow) return null
    const members = all(
      `SELECT client_id, ign, joined_at, is_host FROM members WHERE listing_id = $id ORDER BY joined_at ASC`,
      { id: listingRow.id },
    )
    return rowFromSqlite(listingRow, members)
  }

  /** @type {LfgStore} */
  const store = {
    kind: 'sqlite',
    path: dbPath,
    count() {
      return getOne(`SELECT COUNT(*) AS n FROM listings`).n
    },
    purgeExpired() {
      const now = new Date().toISOString()
      const expired = all(`SELECT * FROM listings WHERE expires_at <= $now`, { now }).map((r) =>
        hydrate(r),
      )
      if (expired.length) {
        run(`DELETE FROM listings WHERE expires_at <= $now`, { now })
      }
      return expired
    },
    list(filters = {}) {
      return applyFilters(
        all(`SELECT * FROM listings ORDER BY created_at DESC`).map((r) => hydrate(r)),
        filters,
      )
    },
    get(id) {
      return hydrate(getOne(`SELECT * FROM listings WHERE id = $id`, { id }))
    },
    upsert(row) {
      db.exec('BEGIN')
      try {
        run(`DELETE FROM listings WHERE id = $id`, { id: row.id })
        run(
          `INSERT INTO listings (
            id, created_at, expires_at, host_ign, host_token, platform, region, language,
            activity, title, notes, relic_key, refinement, share_type, steel_path, mission_hint,
            slots_total, discord_message_id, discord_posts, intent, voice_channel_url, report_count, hidden
          ) VALUES (
            $id, $created_at, $expires_at, $host_ign, $host_token, $platform, $region, $language,
            $activity, $title, $notes, $relic_key, $refinement, $share_type, $steel_path, $mission_hint,
            $slots_total, $discord_message_id, $discord_posts, $intent, $voice_channel_url, $report_count, $hidden
          )`,
          {
            id: row.id,
            created_at: row.createdAt,
            expires_at: row.expiresAt,
            host_ign: row.hostIgn,
            host_token: row.hostToken,
            platform: row.platform,
            region: row.region,
            language: row.language,
            activity: row.activity,
            title: row.title,
            notes: row.notes || '',
            relic_key: row.relicKey,
            refinement: row.refinement,
            share_type: row.shareType,
            steel_path: row.steelPath ? 1 : 0,
            mission_hint: row.missionHint,
            slots_total: row.slotsTotal,
            discord_message_id: row.discordMessageId || null,
            discord_posts:
              row.discordPosts && Array.isArray(row.discordPosts) && row.discordPosts.length
                ? JSON.stringify(row.discordPosts)
                : null,
            intent: row.intent === 'seek' ? 'seek' : 'host',
            voice_channel_url: row.voiceChannelUrl || null,
            report_count: Number(row.reportCount) || 0,
            hidden: row.hidden ? 1 : 0,
          },
        )
        for (const m of row.members || []) {
          run(
            `INSERT INTO members (listing_id, client_id, ign, joined_at, is_host)
             VALUES ($listing_id, $client_id, $ign, $joined_at, $is_host)`,
            {
              listing_id: row.id,
              client_id: m.clientId,
              ign: m.ign,
              joined_at: m.joinedAt,
              is_host: m.isHost ? 1 : 0,
            },
          )
        }
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    remove(id) {
      run(`DELETE FROM listings WHERE id = $id`, { id })
    },
    listDiscordGuilds() {
      return all(`SELECT * FROM discord_guild_settings ORDER BY configured_at ASC`).map((r) =>
        mapGuildSqliteRow(r),
      )
    },
    getDiscordGuild(guildId) {
      const r = getOne(`SELECT * FROM discord_guild_settings WHERE guild_id = $id`, {
        id: guildId,
      })
      return r ? mapGuildSqliteRow(r) : null
    },
    upsertDiscordGuild(row) {
      const prev = store.getDiscordGuild(row.guildId)
      const membersOnly =
        typeof row.membersOnly === 'boolean'
          ? row.membersOnly
          : Boolean(prev?.membersOnly)
      const activityAllowlist =
        row.activityAllowlist !== undefined
          ? normalizeStringAllowlist(row.activityAllowlist)
          : normalizeStringAllowlist(prev?.activityAllowlist)
      const regionAllowlist =
        row.regionAllowlist !== undefined
          ? normalizeStringAllowlist(row.regionAllowlist)
          : normalizeStringAllowlist(prev?.regionAllowlist)
      const platformAllowlist =
        row.platformAllowlist !== undefined
          ? normalizeStringAllowlist(row.platformAllowlist)
          : normalizeStringAllowlist(prev?.platformAllowlist)
      const pingRoleId =
        row.pingRoleId !== undefined
          ? row.pingRoleId
            ? String(row.pingRoleId)
            : null
          : prev?.pingRoleId || null
      run(
        `INSERT INTO discord_guild_settings (
          guild_id, channel_id, webhook_url, configured_by, configured_at, members_only,
          activity_allowlist, region_allowlist, platform_allowlist, ping_role_id
        ) VALUES (
          $guild_id, $channel_id, $webhook_url, $configured_by, $configured_at, $members_only,
          $activity_allowlist, $region_allowlist, $platform_allowlist, $ping_role_id
        )
        ON CONFLICT(guild_id) DO UPDATE SET
          channel_id = excluded.channel_id,
          webhook_url = excluded.webhook_url,
          configured_by = excluded.configured_by,
          configured_at = excluded.configured_at,
          members_only = excluded.members_only,
          activity_allowlist = excluded.activity_allowlist,
          region_allowlist = excluded.region_allowlist,
          platform_allowlist = excluded.platform_allowlist,
          ping_role_id = excluded.ping_role_id`,
        {
          guild_id: row.guildId,
          channel_id: row.channelId,
          webhook_url: row.webhookUrl || null,
          configured_by: row.configuredBy || null,
          configured_at: new Date().toISOString(),
          members_only: membersOnly ? 1 : 0,
          activity_allowlist: activityAllowlist.length
            ? JSON.stringify(activityAllowlist)
            : null,
          region_allowlist: regionAllowlist.length ? JSON.stringify(regionAllowlist) : null,
          platform_allowlist: platformAllowlist.length
            ? JSON.stringify(platformAllowlist)
            : null,
          ping_role_id: pingRoleId,
        },
      )
    },
    removeDiscordGuild(guildId) {
      run(`DELETE FROM discord_guild_settings WHERE guild_id = $id`, { id: guildId })
    },
    getDiscordUserIgn(discordUserId) {
      const r = getOne(
        `SELECT ign FROM discord_user_profiles WHERE discord_user_id = $id`,
        { id: discordUserId },
      )
      return r?.ign ? String(r.ign) : null
    },
    setDiscordUserIgn(discordUserId, ign) {
      run(
        `INSERT INTO discord_user_profiles (discord_user_id, ign, updated_at)
         VALUES ($id, $ign, $updated_at)
         ON CONFLICT(discord_user_id) DO UPDATE SET
           ign = excluded.ign,
           updated_at = excluded.updated_at`,
        {
          id: discordUserId,
          ign: String(ign).trim().slice(0, 24),
          updated_at: new Date().toISOString(),
        },
      )
    },
    clearDiscordUserIgn(discordUserId) {
      run(`DELETE FROM discord_user_profiles WHERE discord_user_id = $id`, {
        id: discordUserId,
      })
    },
    findDiscordUserIdsByIgn(ign) {
      const needle = String(ign || '')
        .trim()
        .toLowerCase()
      if (!needle) return []
      return all(`SELECT discord_user_id, ign FROM discord_user_profiles`)
        .filter((r) => String(r.ign || '').trim().toLowerCase() === needle)
        .map((r) => String(r.discord_user_id))
    },
    isClientBlocked(clientId) {
      const id = String(clientId || '').trim()
      if (!id) return false
      return Boolean(
        getOne(`SELECT client_id FROM blocked_clients WHERE client_id = $id`, { id }),
      )
    },
    blockClient(clientId, reason = '') {
      const id = String(clientId || '').trim()
      if (!id) return
      run(
        `INSERT INTO blocked_clients (client_id, reason, created_at)
         VALUES ($id, $reason, $created_at)
         ON CONFLICT(client_id) DO UPDATE SET reason = excluded.reason`,
        {
          id,
          reason: String(reason || '').slice(0, 120),
          created_at: new Date().toISOString(),
        },
      )
    },
    reportListing(listingId, reporterClientId, reason = '') {
      const row = store.get(listingId)
      if (!row) return { ok: false, error: 'Listing not found' }
      const reporter = String(reporterClientId || '').trim()
      if (!reporter) return { ok: false, error: 'clientId required' }
      if (row.members?.some((m) => m.clientId === reporter)) {
        return { ok: false, error: 'Cannot report your own squad' }
      }
      const existing = getOne(
        `SELECT 1 AS n FROM listing_reports WHERE listing_id = $lid AND reporter_client_id = $rid`,
        { lid: listingId, rid: reporter },
      )
      if (!existing) {
        run(
          `INSERT INTO listing_reports (listing_id, reporter_client_id, reason, created_at)
           VALUES ($lid, $rid, $reason, $created_at)`,
          {
            lid: listingId,
            rid: reporter,
            reason: String(reason || '').slice(0, 120),
            created_at: new Date().toISOString(),
          },
        )
      }
      const countRow = getOne(
        `SELECT COUNT(*) AS n FROM listing_reports WHERE listing_id = $lid`,
        { lid: listingId },
      )
      const reportCount = Number(countRow?.n) || 0
      row.reportCount = reportCount
      if (reportCount >= 3) {
        row.hidden = true
        const host = row.members?.find((m) => m.isHost)
        if (host?.clientId) store.blockClient(host.clientId, 'auto: reports>=3')
      }
      store.upsert(row)
      return { ok: true, reportCount, hidden: Boolean(row.hidden) }
    },
    close() {
      db.close()
    },
  }

  function mapGuildSqliteRow(r) {
    let activityAllowlist = []
    let regionAllowlist = []
    let platformAllowlist = []
    try {
      activityAllowlist = r.activity_allowlist
        ? JSON.parse(String(r.activity_allowlist))
        : []
    } catch {
      activityAllowlist = []
    }
    try {
      regionAllowlist = r.region_allowlist ? JSON.parse(String(r.region_allowlist)) : []
    } catch {
      regionAllowlist = []
    }
    try {
      platformAllowlist = r.platform_allowlist
        ? JSON.parse(String(r.platform_allowlist))
        : []
    } catch {
      platformAllowlist = []
    }
    return {
      guildId: r.guild_id,
      channelId: r.channel_id,
      webhookUrl: r.webhook_url || null,
      configuredBy: r.configured_by || null,
      configuredAt: r.configured_at,
      membersOnly: Boolean(r.members_only),
      activityAllowlist: normalizeStringAllowlist(activityAllowlist),
      regionAllowlist: normalizeStringAllowlist(regionAllowlist),
      platformAllowlist: normalizeStringAllowlist(platformAllowlist),
      pingRoleId: r.ping_role_id || null,
    }
  }

  return store
}

/**
 * @param {string} [dataPath]
 * @returns {Promise<LfgStore>}
 */
export async function openStore(dataPath = resolveDataPath()) {
  ensureParentDir(dataPath)
  const wantJson = /\.json$/i.test(dataPath)

  if (!wantJson) {
    try {
      const mod = await import('node:sqlite')
      const DatabaseSync = mod.DatabaseSync
      if (!DatabaseSync) throw new Error('DatabaseSync missing')
      const store = openNodeSqlite(dataPath, DatabaseSync)
      migrateLegacyJson(store, dataPath)
      return store
    } catch (err) {
      console.warn('[LFG] node:sqlite unavailable:', err instanceof Error ? err.message : err)
    }
  }

  const jsonPath = wantJson ? dataPath : `${dataPath.replace(/\.sqlite3?$/i, '')}.json`
  const store = createJsonStore(jsonPath)
  migrateJsonInto(store, path.join(__dirname, 'lfg-data.json'))
  return store
}
