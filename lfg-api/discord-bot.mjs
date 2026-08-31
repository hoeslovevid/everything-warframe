/**
 * Optional Discord bot for LFG announces + Whisper button + /lfg setup.
 * Env: DISCORD_BOT_TOKEN (required)
 *      DISCORD_CHANNEL_ID (optional fallback channel)
 */
import { randomBytes, randomUUID } from 'node:crypto'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import {
  buildLfgEmbed,
  buildWhisperFromListing,
  closeButtonCustomId,
  joinButtonCustomId,
  joinModalCustomId,
  leaveButtonCustomId,
  parseCloseButtonCustomId,
  parseJoinButtonCustomId,
  parseJoinModalCustomId,
  parseLeaveButtonCustomId,
  parseWhisperButtonCustomId,
  whisperButtonCustomId,
} from './discord-embed.mjs'
import {
  cleanStr,
  discordClientId,
  joinListing,
  leaveListing,
} from './listing-actions.mjs'

/** @type {import('discord.js').Client | null} */
let client = null
/** @type {(() => any) | null} */
let getStore = null
let ready = false
/** @type {Promise<boolean> | null} */
let startPromise = null

export function isBotConfigured() {
  const token = process.env.DISCORD_BOT_TOKEN
  return Boolean(token && String(token).trim())
}

export function isBotReady() {
  return ready && Boolean(client?.isReady())
}

function envFallbackChannelId() {
  const ch = process.env.DISCORD_CHANNEL_ID
  return ch && String(ch).trim() ? String(ch).trim() : ''
}

/**
 * @returns {Array<{
 *   guildId: string | null,
 *   channelId: string,
 *   webhookUrl?: string | null,
 *   membersOnly?: boolean,
 *   activityAllowlist?: string[],
 *   regionAllowlist?: string[],
 *   platformAllowlist?: string[],
 *   pingRoleId?: string | null
 * }>}
 */
function resolveAnnounceTargets() {
  /** @type {Map<string, {
   *   guildId: string | null,
   *   channelId: string,
   *   webhookUrl?: string | null,
   *   membersOnly?: boolean,
   *   activityAllowlist?: string[],
   *   regionAllowlist?: string[],
   *   platformAllowlist?: string[],
   *   pingRoleId?: string | null
   * }>} */
  const byChannel = new Map()
  const store = getStore?.()
  const guilds = store?.listDiscordGuilds?.() || []
  for (const g of guilds) {
    if (!g?.channelId) continue
    byChannel.set(g.channelId, {
      guildId: g.guildId,
      channelId: g.channelId,
      webhookUrl: g.webhookUrl || null,
      membersOnly: Boolean(g.membersOnly),
      activityAllowlist: Array.isArray(g.activityAllowlist) ? g.activityAllowlist : [],
      regionAllowlist: Array.isArray(g.regionAllowlist) ? g.regionAllowlist : [],
      platformAllowlist: Array.isArray(g.platformAllowlist) ? g.platformAllowlist : [],
      pingRoleId: g.pingRoleId || null,
    })
  }
  const envCh = envFallbackChannelId()
  if (envCh && !byChannel.has(envCh)) {
    byChannel.set(envCh, {
      guildId: null,
      channelId: envCh,
      webhookUrl: null,
      membersOnly: false,
      activityAllowlist: [],
      regionAllowlist: [],
      platformAllowlist: [],
      pingRoleId: null,
    })
  }
  return [...byChannel.values()]
}

/** @param {string | null | undefined} raw */
function parseCommaAllowlist(raw) {
  if (typeof raw !== 'string') return null
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 24)
}

/**
 * Discord user ids that may represent this listing's host.
 * @param {object} listing
 * @returns {string[]}
 */
function hostDiscordUserIds(listing) {
  /** @type {Set<string>} */
  const ids = new Set()
  const store = getStore?.()
  const host = listing?.members?.find((m) => m.isHost)
  if (host?.clientId && String(host.clientId).startsWith('discord:')) {
    ids.add(String(host.clientId).slice('discord:'.length))
  }
  const ign = listing?.hostIgn || host?.ign
  if (ign && store?.findDiscordUserIdsByIgn) {
    for (const uid of store.findDiscordUserIdsByIgn(ign)) ids.add(uid)
  }
  return [...ids]
}

/**
 * True if this Discord user is the listing host (discord: clientId or /lfg link IGN).
 * @param {object} listing
 * @param {string} discordUserId
 */
function isDiscordListingHost(listing, discordUserId) {
  if (!listing || !discordUserId) return false
  const myClientId = discordClientId(discordUserId)
  if (listing.members?.some((m) => m.isHost && m.clientId === myClientId)) return true
  const store = getStore?.()
  const linked = store?.getDiscordUserIgn?.(discordUserId)
  if (
    linked &&
    String(listing.hostIgn || '')
      .trim()
      .toLowerCase() === String(linked).trim().toLowerCase()
  ) {
    return true
  }
  return false
}

/**
 * @param {string} discordUserId
 * @returns {any | null}
 */
function findHostedListing(discordUserId) {
  const store = getStore?.()
  if (!store) return null
  const rows = store.list({}) || []
  return (
    rows.find((r) => isDiscordListingHost(r, discordUserId)) || null
  )
}

/**
 * @param {string} guildId
 * @param {string[]} userIds
 */
async function guildHasAnyMember(guildId, userIds) {
  if (!client || !guildId || !userIds.length) return false
  try {
    const guild = await client.guilds.fetch(guildId)
    for (const uid of userIds) {
      try {
        await guild.members.fetch(uid)
        return true
      } catch {
        // not in guild
      }
    }
  } catch (err) {
    console.warn(
      '[lfg-api] Discord guild member check failed:',
      err instanceof Error ? err.message : err,
    )
  }
  return false
}

/**
 * @param {object} listing
 * @returns {Promise<{
 *   targets: Array<{
 *     guildId: string | null,
 *     channelId: string,
 *     webhookUrl?: string | null,
 *     membersOnly?: boolean,
 *     activityAllowlist?: string[],
 *     regionAllowlist?: string[],
 *     platformAllowlist?: string[],
 *     pingRoleId?: string | null
 *   }>,
 *   skips: Array<{ guildId: string | null, channelId: string, reason: string }>
 * }>}
 */
async function resolveTargetsForListing(listing) {
  const targets = resolveAnnounceTargets()
  const hostIds = hostDiscordUserIds(listing)
  const activity = String(listing?.activity || '')
    .trim()
    .toLowerCase()
  const region = String(listing?.region || '')
    .trim()
    .toLowerCase()
  const platform = String(listing?.platform || '')
    .trim()
    .toLowerCase()
  /** @type {typeof targets} */
  const out = []
  /** @type {Array<{ guildId: string | null, channelId: string, reason: string }>} */
  const skips = []

  for (const t of targets) {
    const allow = Array.isArray(t.activityAllowlist) ? t.activityAllowlist : []
    if (allow.length && activity && !allow.includes(activity)) {
      skips.push({
        guildId: t.guildId,
        channelId: t.channelId,
        reason: `activity_filter (${activity} not in ${allow.join(', ')})`,
      })
      continue
    }
    const regionAllow = Array.isArray(t.regionAllowlist) ? t.regionAllowlist : []
    if (regionAllow.length && region && !regionAllow.includes(region)) {
      skips.push({
        guildId: t.guildId,
        channelId: t.channelId,
        reason: `region_filter (${region} not in ${regionAllow.join(', ')})`,
      })
      continue
    }
    const platformAllow = Array.isArray(t.platformAllowlist) ? t.platformAllowlist : []
    if (platformAllow.length && platform && !platformAllow.includes(platform)) {
      skips.push({
        guildId: t.guildId,
        channelId: t.channelId,
        reason: `platform_filter (${platform} not in ${platformAllow.join(', ')})`,
      })
      continue
    }
    if (!t.membersOnly || !t.guildId) {
      out.push(t)
      continue
    }
    if (!hostIds.length) {
      skips.push({
        guildId: t.guildId,
        channelId: t.channelId,
        reason: 'members_only_no_link',
      })
      continue
    }
    if (await guildHasAnyMember(t.guildId, hostIds)) {
      out.push(t)
    } else {
      skips.push({
        guildId: t.guildId,
        channelId: t.channelId,
        reason: 'members_only_not_in_guild',
      })
    }
  }
  return { targets: out, skips }
}

/**
 * Notify linked Discord host(s) that someone joined their squad.
 * @param {object} listing
 * @param {string} joinerIgn
 * @param {string} joinerDiscordId
 */
async function notifyHostOfJoin(listing, joinerIgn, joinerDiscordId) {
  if (!client || !listing) return
  const hostIds = hostDiscordUserIds(listing).filter((id) => id !== joinerDiscordId)
  if (!hostIds.length) return
  const title = listing.title || 'LFG'
  const whisper = buildWhisperFromListing(listing)
  const body = [
    `**${joinerIgn}** joined your squad **${title}**.`,
    whisper ? `Whisper:\n\`\`\`\n${whisper}\n\`\`\`` : '',
  ]
    .filter(Boolean)
    .join('\n')
  for (const uid of hostIds.slice(0, 3)) {
    try {
      const user = await client.users.fetch(uid)
      await user.send({ content: body })
    } catch {
      // DMs closed or no mutual server — ignore
    }
  }
}

/**
 * @param {object} listing
 * @param {{ closed?: boolean }} [opts]
 */
function toDiscordPayload(listing, opts = {}) {
  const data = buildLfgEmbed(listing, opts)
  const embed = new EmbedBuilder().setTitle(data.title).setColor(data.color)
  if (data.description) embed.setDescription(data.description)
  if (data.fields?.length) embed.addFields(data.fields)
  if (data.author?.name) {
    embed.setAuthor({
      name: data.author.name,
      iconURL: data.author.icon_url || undefined,
    })
  }
  if (data.thumbnail?.url) embed.setThumbnail(data.thumbnail.url)
  if (data.footer?.text) {
    embed.setFooter({
      text: data.footer.text,
      iconURL: data.footer.icon_url || undefined,
    })
  }
  if (data.timestamp) embed.setTimestamp(new Date(data.timestamp))

  /** @type {import('discord.js').ActionRowBuilder<import('discord.js').ButtonBuilder>[]} */
  const components = []
  if (!opts.closed && listing?.id) {
    const members = Array.isArray(listing.members) ? listing.members.length : 1
    const slots = Math.max(2, Number(listing.slotsTotal) || 4)
    const full = members >= slots
    const row = new ActionRowBuilder()
    if (!full) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(joinButtonCustomId(listing.id))
          .setLabel('Join')
          .setStyle(ButtonStyle.Success),
      )
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(leaveButtonCustomId(listing.id))
        .setLabel('Leave')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(whisperButtonCustomId(listing.id))
        .setLabel('Whisper')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(closeButtonCustomId(listing.id))
        .setLabel('Close')
        .setStyle(ButtonStyle.Danger),
    )
    components.push(row)
  }

  return { embeds: [embed], components }
}

function enrichListingForDiscord(row) {
  return {
    ...row,
    whisper: buildWhisperFromListing(row),
    inviteHint: row.hostIgn ? `/invite ${row.hostIgn}` : undefined,
    discordMessageId: row.discordMessageId || null,
    discordPosts: Array.isArray(row.discordPosts) ? row.discordPosts : [],
  }
}

/**
 * @param {string} channelId
 */
async function fetchTextChannel(channelId) {
  if (!client || !channelId) return null
  try {
    const ch = await client.channels.fetch(channelId)
    if (!ch || !ch.isTextBased() || ch.isDMBased()) return null
    return ch
  } catch (err) {
    console.warn(
      '[lfg-api] Discord channel fetch failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * @param {object} listing
 * @returns {Array<{ guildId: string | null, channelId: string, messageId: string }>}
 */
function listingPosts(listing) {
  if (Array.isArray(listing?.discordPosts) && listing.discordPosts.length) {
    return listing.discordPosts.filter((p) => p?.messageId && p?.channelId)
  }
  if (listing?.discordMessageId) {
    const envCh = envFallbackChannelId()
    const ch =
      listing.discordChannelId ||
      envCh ||
      resolveAnnounceTargets()[0]?.channelId ||
      ''
    if (ch) {
      return [
        {
          guildId: listing.discordGuildId || null,
          channelId: ch,
          messageId: listing.discordMessageId,
        },
      ]
    }
  }
  return []
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName('lfg')
      .setDescription('Everything Warframe LFG board')
      .addSubcommand((sc) =>
        sc
          .setName('setup')
          .setDescription('Set the channel where hub squads are announced (admin)')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Text channel for LFG posts')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          )
          .addBooleanOption((opt) =>
            opt
              .setName('members_only')
              .setDescription(
                'Only announce squads whose host linked IGN is in this Discord server',
              )
              .setRequired(false),
          )
          .addStringOption((opt) =>
            opt
              .setName('activities')
              .setDescription(
                'Optional activity allowlist (comma-separated), e.g. radshare,sortie,farm — empty = all',
              )
              .setRequired(false)
              .setMaxLength(120),
          )
          .addStringOption((opt) =>
            opt
              .setName('regions')
              .setDescription(
                'Optional region allowlist (comma-separated), e.g. na,eu — empty = all',
              )
              .setRequired(false)
              .setMaxLength(80),
          )
          .addStringOption((opt) =>
            opt
              .setName('platforms')
              .setDescription(
                'Optional platform allowlist (comma-separated), e.g. pc,psn — empty = all',
              )
              .setRequired(false)
              .setMaxLength(80),
          )
          .addRoleOption((opt) =>
            opt
              .setName('ping_role')
              .setDescription('Optional role to ping when a new LFG is announced')
              .setRequired(false),
          ),
      )
      .addSubcommand((sc) =>
        sc.setName('status').setDescription('Show this server’s LFG Discord config'),
      )
      .addSubcommand((sc) =>
        sc.setName('clear').setDescription('Remove this server’s LFG channel config (admin)'),
      )
      .addSubcommand((sc) =>
        sc
          .setName('help')
          .setDescription('How to use the Everything Warframe LFG Discord bot'),
      )
      .addSubcommand((sc) =>
        sc
          .setName('link')
          .setDescription('Save your Warframe IGN (Join + members-only announces)')
          .addStringOption((opt) =>
            opt
              .setName('ign')
              .setDescription('Your in-game name')
              .setRequired(true)
              .setMinLength(2)
              .setMaxLength(24),
          ),
      )
      .addSubcommand((sc) =>
        sc.setName('unlink').setDescription('Clear your saved Warframe IGN'),
      )
      .addSubcommand((sc) =>
        sc
          .setName('post')
          .setDescription('Create a hub LFG listing from Discord')
          .addStringOption((opt) =>
            opt
              .setName('title')
              .setDescription('Squad title')
              .setRequired(true)
              .setMinLength(2)
              .setMaxLength(100),
          )
          .addStringOption((opt) =>
            opt
              .setName('activity')
              .setDescription('Activity type')
              .setRequired(false)
              .addChoices(
                { name: 'Relic', value: 'relic' },
                { name: 'Fissure', value: 'fissure' },
                { name: 'Farm', value: 'farm' },
                { name: 'Boss', value: 'boss' },
                { name: 'Custom', value: 'custom' },
              ),
          )
          .addStringOption((opt) =>
            opt
              .setName('platform')
              .setDescription('Platform (pc, psn, xbox, switch, …)')
              .setRequired(false)
              .setMaxLength(16),
          )
          .addStringOption((opt) =>
            opt
              .setName('region')
              .setDescription('Region (na, eu, as, …)')
              .setRequired(false)
              .setMaxLength(8),
          )
          .addStringOption((opt) =>
            opt
              .setName('notes')
              .setDescription('Optional notes')
              .setRequired(false)
              .setMaxLength(160),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('slots')
              .setDescription('Squad size (2–4); ignored when seeking a host')
              .setRequired(false)
              .setMinValue(2)
              .setMaxValue(4),
          )
          .addStringOption((opt) =>
            opt
              .setName('intent')
              .setDescription('Are you hosting or looking for a host?')
              .setRequired(false)
              .addChoices(
                { name: 'Host', value: 'host' },
                { name: 'Looking for host', value: 'seek' },
              ),
          )
          .addBooleanOption((opt) =>
            opt
              .setName('steel_path')
              .setDescription('Steel Path')
              .setRequired(false),
          )
          .addStringOption((opt) =>
            opt
              .setName('mission_hint')
              .setDescription('Mission / node hint')
              .setRequired(false)
              .setMaxLength(60),
          )
          .addStringOption((opt) =>
            opt
              .setName('relic_key')
              .setDescription('Relic (e.g. Lith A1)')
              .setRequired(false)
              .setMaxLength(40),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName('find')
          .setDescription('Browse open hub LFG listings')
          .addStringOption((opt) =>
            opt
              .setName('activity')
              .setDescription('Filter by activity')
              .setRequired(false)
              .addChoices(
                { name: 'Relic', value: 'relic' },
                { name: 'Fissure', value: 'fissure' },
                { name: 'Farm', value: 'farm' },
                { name: 'Boss', value: 'boss' },
                { name: 'Custom', value: 'custom' },
              ),
          )
          .addStringOption((opt) =>
            opt
              .setName('region')
              .setDescription('Filter by region (na, eu, …)')
              .setRequired(false)
              .setMaxLength(8),
          )
          .addStringOption((opt) =>
            opt
              .setName('platform')
              .setDescription('Filter by platform (pc, psn, …)')
              .setRequired(false)
              .setMaxLength(16),
          )
          .addStringOption((opt) =>
            opt
              .setName('q')
              .setDescription('Search title / host / relic')
              .setRequired(false)
              .setMaxLength(60),
          )
          .addStringOption((opt) =>
            opt
              .setName('intent')
              .setDescription('Host squads or looking-for-host')
              .setRequired(false)
              .addChoices(
                { name: 'Hosting', value: 'host' },
                { name: 'Looking for host', value: 'seek' },
              ),
          ),
      )
      .addSubcommand((sc) =>
        sc.setName('close').setDescription('Close your active LFG listing'),
      )
      .addSubcommand((sc) =>
        sc
          .setName('edit')
          .setDescription('Edit your active LFG listing')
          .addStringOption((opt) =>
            opt
              .setName('title')
              .setDescription('New title')
              .setRequired(false)
              .setMaxLength(100),
          )
          .addStringOption((opt) =>
            opt
              .setName('notes')
              .setDescription('New notes')
              .setRequired(false)
              .setMaxLength(160),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('slots')
              .setDescription('Squad size 2–4')
              .setRequired(false)
              .setMinValue(2)
              .setMaxValue(4),
          )
          .addStringOption((opt) =>
            opt
              .setName('mission_hint')
              .setDescription('Mission / node hint')
              .setRequired(false)
              .setMaxLength(60),
          ),
      )
      .toJSON(),
  ]
}

async function registerSlashCommands(c) {
  const body = buildSlashCommands()
  const rest = new REST({ version: '10' }).setToken(String(process.env.DISCORD_BOT_TOKEN).trim())
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body })
    console.info(
      '[LFG] Discord slash commands registered (/lfg setup|status|clear|help|link|unlink|post|find|close|edit)',
    )
  } catch (err) {
    console.warn(
      '[lfg-api] Discord command register failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSetupCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Run this in a server.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'Need **Manage Server** to run `/lfg setup`.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  const store = getStore?.()
  if (!store?.upsertDiscordGuild) {
    await interaction.reply({
      content: 'Store unavailable — try again later.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const channel = interaction.options.getChannel('channel', true)
  if (!channel || !('guild' in channel)) {
    await interaction.reply({
      content: 'Pick a text channel in this server.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const membersOnlyOpt = interaction.options.getBoolean('members_only')
  const activitiesRaw = interaction.options.getString('activities')
  const regionsRaw = interaction.options.getString('regions')
  const platformsRaw = interaction.options.getString('platforms')
  const pingRole = interaction.options.getRole('ping_role')
  const prev = store.getDiscordGuild?.(interaction.guildId)
  const membersOnly =
    typeof membersOnlyOpt === 'boolean' ? membersOnlyOpt : Boolean(prev?.membersOnly)
  const parsedActivities = parseCommaAllowlist(activitiesRaw)
  const activityAllowlist =
    parsedActivities !== null
      ? parsedActivities
      : Array.isArray(prev?.activityAllowlist)
        ? prev.activityAllowlist
        : []
  const parsedRegions = parseCommaAllowlist(regionsRaw)
  const regionAllowlist =
    parsedRegions !== null
      ? parsedRegions
      : Array.isArray(prev?.regionAllowlist)
        ? prev.regionAllowlist
        : []
  const parsedPlatforms = parseCommaAllowlist(platformsRaw)
  const platformAllowlist =
    parsedPlatforms !== null
      ? parsedPlatforms
      : Array.isArray(prev?.platformAllowlist)
        ? prev.platformAllowlist
        : []
  const pingRoleId =
    pingRole && 'id' in pingRole
      ? pingRole.id
      : prev?.pingRoleId || null

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  let webhookUrl = null
  try {
    const textCh = await fetchTextChannel(channel.id)
    if (textCh && 'createWebhook' in textCh) {
      const existing = await textCh.fetchWebhooks()
      let hook = existing.find(
        (w) => w.owner?.id === client?.user?.id && w.name === 'Everything Warframe LFG',
      )
      if (!hook) {
        hook = await textCh.createWebhook({
          name: 'Everything Warframe LFG',
          reason: 'LFG hub announce fallback',
        })
      }
      webhookUrl = hook.url || null
    }
  } catch (err) {
    console.warn(
      '[lfg-api] Webhook auto-create skipped:',
      err instanceof Error ? err.message : err,
    )
  }

  store.upsertDiscordGuild({
    guildId: interaction.guildId,
    channelId: channel.id,
    webhookUrl,
    configuredBy: interaction.user.id,
    membersOnly,
    activityAllowlist,
    regionAllowlist,
    platformAllowlist,
    pingRoleId,
  })

  const guideUrl =
    'https://hoeslovevid.github.io/Warframe-Companion-Helper/lfg-discord.html'
  const bits = [
    `LFG announces will post in <#${channel.id}>.`,
    membersOnly
      ? '**Members only:** on — only squads whose host ran `/lfg link` with an IGN matching a member of this server.'
      : '**Members only:** off — all hub squads are announced here (subject to filters).',
    activityAllowlist.length
      ? `**Activity filter:** ${activityAllowlist.join(', ')}`
      : '**Activity filter:** off (all activities).',
    regionAllowlist.length
      ? `**Region filter:** ${regionAllowlist.join(', ')}`
      : '**Region filter:** off (all regions).',
    platformAllowlist.length
      ? `**Platform filter:** ${platformAllowlist.join(', ')}`
      : '**Platform filter:** off (all platforms).',
    pingRoleId ? `**Ping role:** <@&${pingRoleId}>` : '**Ping role:** off.',
    webhookUrl
      ? 'A channel webhook was created/reused as fallback.'
      : 'Could not create a webhook (bot needs Manage Webhooks) — bot posts will still work.',
    '',
    '**Next steps**',
    '1. Hosts: `/lfg link ign:YourIgn` (needed for Join + members-only + `/lfg post`).',
    '2. Post a squad with `/lfg post` or from Everything Warframe → LFG.',
    '3. Players use **Join** / **Leave** / **Whisper** on the Discord embed.',
    `Guide: ${guideUrl}`,
    'Commands: `/lfg help` · `/lfg status` · `/lfg clear`',
  ]
  await interaction.editReply({ content: bits.join('\n') })
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleStatusCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Run this in a server.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  const store = getStore?.()
  const cfg = store?.getDiscordGuild?.(interaction.guildId)
  const envCh = envFallbackChannelId()
  if (!cfg) {
    await interaction.reply({
      content: envCh
        ? `No per-server setup. Env fallback channel: \`${envCh}\`.\nRun \`/lfg setup\` to bind a channel here.`
        : 'No LFG channel configured. Run `/lfg setup channel:#your-lfg`.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  await interaction.reply({
    content: [
      `Channel: <#${cfg.channelId}>`,
      `Members only: ${cfg.membersOnly ? 'yes' : 'no'}`,
      `Activity filter: ${
        cfg.activityAllowlist?.length ? cfg.activityAllowlist.join(', ') : 'off (all)'
      }`,
      `Region filter: ${
        cfg.regionAllowlist?.length ? cfg.regionAllowlist.join(', ') : 'off (all)'
      }`,
      `Platform filter: ${
        cfg.platformAllowlist?.length ? cfg.platformAllowlist.join(', ') : 'off (all)'
      }`,
      `Ping role: ${cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : 'off'}`,
      `Webhook fallback: ${cfg.webhookUrl ? 'yes' : 'no'}`,
      cfg.configuredAt ? `Configured: ${cfg.configuredAt}` : '',
      cfg.membersOnly
        ? 'Hosts must `/lfg link` their IGN and be in this server to announce here.'
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    flags: MessageFlags.Ephemeral,
  })
}

async function handleHelpCommand(interaction) {
  const invite =
    'https://discord.com/oauth2/authorize?client_id=1543118817654476840&permissions=536955880&scope=bot%20applications.commands'
  const guide =
    'https://hoeslovevid.github.io/Warframe-Companion-Helper/lfg-discord.html'
  await interaction.reply({
    content: [
      '**Everything Warframe LFG bot**',
      '',
      '**Admins**',
      '• `/lfg setup channel:#lfg` — bind announce channel',
      '• `members_only:True` — only hosts in this server (via `/lfg link`)',
      '• `activities:relic,fissure` — optional activity allowlist',
      '• `regions:na,eu` — optional region allowlist',
      '• `platforms:pc,psn` — optional platform allowlist',
      '• `ping_role:@LFG` — ping a role on new announces',
      '• `/lfg status` / `/lfg clear`',
      '',
      '**Everyone**',
      '• `/lfg link ign:YourIgn` — Join button + members-only matching + `/lfg post`',
      '• `/lfg unlink` — clear linked IGN',
      '• `/lfg post title:…` — create a hub listing (join a voice channel to attach voice link)',
      '• `/lfg find` — browse open hub squads',
      '• `/lfg edit` / `/lfg close` — manage your active listing (or use **Close** on the post)',
      '• On posts: **Join** · **Leave** · **Whisper** · **Close** (hosts get a DM on Join when linked)',
      '',
      `Invite: ${invite}`,
      `Guide: ${guide}`,
      'Terms / Privacy: https://hoeslovevid.github.io/Warframe-Companion-Helper/terms.html',
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  })
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleClearCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Run this in a server.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'Need **Manage Server** to run `/lfg clear`.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  const store = getStore?.()
  store?.removeDiscordGuild?.(interaction.guildId)
  await interaction.reply({
    content: 'Cleared this server’s LFG channel config.',
    flags: MessageFlags.Ephemeral,
  })
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleLinkCommand(interaction) {
  const store = getStore?.()
  const ign = cleanStr(interaction.options.getString('ign', true), 24)
  if (!ign || ign.length < 2) {
    await interaction.reply({
      content: 'Enter a valid Warframe IGN (2–24 characters).',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  store?.setDiscordUserIgn?.(interaction.user.id, ign)
  await interaction.reply({
    content: [
      `Linked IGN **${ign}**.`,
      'Join on LFG posts will use this name.',
      'Servers with **members only** announce will show your hub squads when you post with this IGN.',
      'Change anytime with `/lfg link`.',
    ].join(' '),
    flags: MessageFlags.Ephemeral,
  })
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleUnlinkCommand(interaction) {
  const store = getStore?.()
  store?.clearDiscordUserIgn?.(interaction.user.id)
  await interaction.reply({
    content: 'Cleared your linked IGN. Join will ask for your name again.',
    flags: MessageFlags.Ephemeral,
  })
}

const DEFAULT_POST_TTL_MS = 15 * 60_000

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handlePostCommand(interaction) {
  const store = getStore?.()
  if (!store?.upsert) {
    await interaction.reply({
      content: 'Store unavailable — try again later.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const hostIgn = store.getDiscordUserIgn?.(interaction.user.id)
  if (!hostIgn) {
    await interaction.reply({
      content: 'Link your Warframe IGN first with `/lfg link ign:YourIgn`, then run `/lfg post` again.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const intentRaw = cleanStr(interaction.options.getString('intent') || 'host', 8).toLowerCase()
  const intent = intentRaw === 'seek' ? 'seek' : 'host'
  const slotsOpt = interaction.options.getInteger('slots')
  const slotsTotal =
    intent === 'seek'
      ? 1
      : Math.min(4, Math.max(2, Math.floor(Number(slotsOpt) || 4)))

  let voiceChannelUrl = null
  const member = interaction.member
  const voiceChannelId =
    member && typeof member === 'object' && 'voice' in member
      ? member.voice?.channelId || null
      : null
  if (voiceChannelId && interaction.guildId) {
    voiceChannelUrl = `https://discord.com/channels/${interaction.guildId}/${voiceChannelId}`
  }

  const now = Date.now()
  const id = randomUUID()
  const hostToken = randomBytes(18).toString('hex')
  const titleRaw = cleanStr(interaction.options.getString('title', true), 100)
  const row = {
    id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEFAULT_POST_TTL_MS).toISOString(),
    hostIgn,
    hostToken,
    platform:
      cleanStr(interaction.options.getString('platform') || 'pc', 16).toLowerCase() || 'pc',
    region:
      cleanStr(interaction.options.getString('region') || 'na', 8).toLowerCase() || 'na',
    language: 'en',
    activity:
      cleanStr(interaction.options.getString('activity') || 'custom', 24).toLowerCase() ||
      'custom',
    title:
      titleRaw ||
      (intent === 'seek' ? 'Looking for host' : 'LFG'),
    notes: cleanStr(interaction.options.getString('notes') || '', 160),
    relicKey: (() => {
      const v = interaction.options.getString('relic_key')
      return v ? cleanStr(v, 40) : null
    })(),
    refinement: null,
    shareType: null,
    steelPath: Boolean(interaction.options.getBoolean('steel_path')),
    missionHint: (() => {
      const v = interaction.options.getString('mission_hint')
      return v ? cleanStr(v, 60) : null
    })(),
    slotsTotal,
    intent,
    voiceChannelUrl,
    reportCount: 0,
    hidden: false,
    discordMessageId: null,
    discordPosts: [],
    members: [
      {
        ign: hostIgn,
        clientId: discordClientId(interaction.user.id),
        joinedAt: new Date(now).toISOString(),
        isHost: true,
      },
    ],
  }

  store.upsert(row)

  const enriched = enrichListingForDiscord(row)
  let posts = []
  try {
    const result = await createLfgMessage(enriched)
    posts = result?.posts || []
    if (posts.length || result?.messageId) {
      const fresh = store.get?.(id)
      if (fresh) {
        fresh.discordMessageId = result.messageId || posts[0]?.messageId || null
        fresh.discordPosts = posts
        store.upsert(fresh)
      }
    }
  } catch (err) {
    console.warn(
      '[lfg-api] Discord /lfg post announce failed:',
      err instanceof Error ? err.message : err,
    )
  }

  const bits = [
    `Posted **${row.title}** as **${hostIgn}** (${intent === 'seek' ? 'looking for host' : 'hosting'}).`,
    voiceChannelUrl ? `Voice link attached from your current channel.` : '',
    posts.length
      ? `Announced in ${posts.length} channel(s).`
      : 'Saved to the hub board — Discord announce may be filtered or not configured (`/lfg setup`).',
  ].filter(Boolean)

  await interaction.editReply({ content: bits.join('\n') })
}

async function handleFindCommand(interaction) {
  const store = getStore?.()
  if (!store) {
    await interaction.reply({
      content: 'Store unavailable.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const rows = store.list({
    activity: interaction.options.getString('activity') || '',
    region: interaction.options.getString('region') || '',
    platform: interaction.options.getString('platform') || '',
    q: interaction.options.getString('q') || '',
    intent: interaction.options.getString('intent') || '',
  })
  if (!rows.length) {
    await interaction.editReply({
      content: 'No open listings match those filters right now.',
    })
    return
  }
  const lines = rows.slice(0, 12).map((r) => {
    const slots = `${(r.members || []).length}/${r.slotsTotal}`
    const seek = r.intent === 'seek' ? ' · LFH' : ''
    return `• **${r.title}** — ${r.hostIgn}${seek} · ${r.activity} · ${String(r.platform).toUpperCase()} · ${String(r.region).toUpperCase()} · ${slots}`
  })
  if (rows.length > 12) lines.push(`_…and ${rows.length - 12} more on the companion board._`)
  await interaction.editReply({ content: lines.join('\n') })
}

async function handleCloseCommand(interaction) {
  const store = getStore?.()
  if (!store) {
    await interaction.reply({
      content: 'Store unavailable.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const listing = findHostedListing(interaction.user.id)
  if (!listing) {
    await interaction.editReply({
      content:
        'You have no active listing. Hosts must `/lfg link` the same IGN used when posting from the companion.',
    })
    return
  }
  store.remove(listing.id)
  closeLfgMessage(enrichListingForDiscord(listing))
  try {
    const { broadcastLfgEvent } = await import('./hub-events.mjs')
    broadcastLfgEvent('listing', { type: 'closed', id: listing.id })
  } catch {
    // optional
  }
  await interaction.editReply({ content: `Closed **${listing.title}**.` })
}

async function handleEditCommand(interaction) {
  const store = getStore?.()
  if (!store) {
    await interaction.reply({
      content: 'Store unavailable.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const listing = findHostedListing(interaction.user.id)
  if (!listing) {
    await interaction.editReply({
      content: 'You have no active listing to edit.',
    })
    return
  }
  const title = interaction.options.getString('title')
  const notes = interaction.options.getString('notes')
  const slots = interaction.options.getInteger('slots')
  const missionHint = interaction.options.getString('mission_hint')
  if (title == null && notes == null && slots == null && missionHint == null) {
    await interaction.editReply({
      content: 'Provide at least one of: title, notes, slots, mission_hint.',
    })
    return
  }
  if (typeof title === 'string') listing.title = cleanStr(title, 100) || listing.title
  if (typeof notes === 'string') listing.notes = cleanStr(notes, 160)
  if (typeof slots === 'number' && listing.intent !== 'seek') {
    listing.slotsTotal = Math.min(4, Math.max(2, slots))
  }
  if (typeof missionHint === 'string') {
    listing.missionHint = cleanStr(missionHint, 60) || null
  }
  store.upsert(listing)
  void editLfgMessage(enrichListingForDiscord(listing))
  try {
    const { broadcastLfgEvent } = await import('./hub-events.mjs')
    broadcastLfgEvent('listing', { type: 'updated', id: listing.id })
  } catch {
    // optional
  }
  await interaction.editReply({ content: `Updated **${listing.title}**.` })
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string} listingId
 */
async function showJoinModal(interaction, listingId) {
  const modal = new ModalBuilder()
    .setCustomId(joinModalCustomId(listingId))
    .setTitle('Join LFG squad')
  const ignInput = new TextInputBuilder()
    .setCustomId('ign')
    .setLabel('Warframe in-game name')
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(24)
    .setRequired(true)
    .setPlaceholder('Your IGN')
  modal.addComponents(new ActionRowBuilder().addComponents(ignInput))
  await interaction.showModal(modal)
}

/**
 * @param {string} listingId
 * @param {string} discordUserId
 * @param {string} ign
 */
async function performDiscordJoin(listingId, discordUserId, ign) {
  const store = getStore?.()
  if (!store) return { ok: false, error: 'Store unavailable' }
  const result = joinListing(store, listingId, {
    ign,
    clientId: discordClientId(discordUserId),
  })
  if (result.ok && result.row && !result.alreadyJoined) {
    void editLfgMessage(enrichListingForDiscord(result.row))
    void notifyHostOfJoin(result.row, ign, discordUserId)
  }
  return result
}

/**
 * @param {import('discord.js').ButtonInteraction | import('discord.js').ModalSubmitInteraction} interaction
 * @param {string} listingId
 * @param {string} ign
 */
async function replyJoinResult(interaction, listingId, ign, result) {
  if (!result.ok) {
    await interaction.reply({
      content: result.error || 'Could not join.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  const whisper = result.row ? buildWhisperFromListing(result.row) : ''
  const prefix = result.alreadyJoined
    ? `Already on the roster as **${ign}**.`
    : `Joined as **${ign}**. Shown on the hub board (and companion app on refresh).`
  await interaction.reply({
    content: `${prefix}\nCopy whisper:\n\`\`\`\n${whisper}\n\`\`\``,
    flags: MessageFlags.Ephemeral,
  })
}

/**
 * @param {() => any} storeGetter
 * @returns {Promise<boolean>}
 */
export function startDiscordBot(storeGetter) {
  if (!isBotConfigured()) return Promise.resolve(false)
  if (startPromise) return startPromise
  getStore = storeGetter

  startPromise = (async () => {
    const token = String(process.env.DISCORD_BOT_TOKEN).trim()

    client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
      partials: [Partials.Channel],
    })

    client.once(Events.ClientReady, async (c) => {
      ready = true
      const targets = resolveAnnounceTargets()
      console.info(
        `[LFG] Discord bot ready as ${c.user.tag} · announce targets: ${targets.length}` +
          (envFallbackChannelId() ? ` (env channel ${envFallbackChannelId()})` : ''),
      )
      await registerSlashCommands(c)
    })

    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (interaction.isChatInputCommand() && interaction.commandName === 'lfg') {
          const sub = interaction.options.getSubcommand()
          if (sub === 'setup') await handleSetupCommand(interaction)
          else if (sub === 'status') await handleStatusCommand(interaction)
          else if (sub === 'clear') await handleClearCommand(interaction)
          else if (sub === 'help') await handleHelpCommand(interaction)
          else if (sub === 'link') await handleLinkCommand(interaction)
          else if (sub === 'unlink') await handleUnlinkCommand(interaction)
          else if (sub === 'post') await handlePostCommand(interaction)
          else if (sub === 'find') await handleFindCommand(interaction)
          else if (sub === 'close') await handleCloseCommand(interaction)
          else if (sub === 'edit') await handleEditCommand(interaction)
          return
        }

        if (interaction.isModalSubmit()) {
          const listingId = parseJoinModalCustomId(interaction.customId)
          if (!listingId) return
          const ign = cleanStr(interaction.fields.getTextInputValue('ign'), 24)
          const store = getStore?.()
          if (ign) store?.setDiscordUserIgn?.(interaction.user.id, ign)
          const result = await performDiscordJoin(listingId, interaction.user.id, ign)
          await replyJoinResult(interaction, listingId, ign, result)
          return
        }

        if (!interaction.isButton()) return

        const whisperId = parseWhisperButtonCustomId(interaction.customId)
        if (whisperId) {
          const store = getStore?.()
          const row = store?.get?.(whisperId)
          if (!row || Date.parse(row.expiresAt) <= Date.now()) {
            await interaction.reply({
              content: 'That squad is closed or expired.',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          const whisper = buildWhisperFromListing(row)
          await interaction.reply({
            content: `Copy into Warframe chat:\n\`\`\`\n${whisper}\n\`\`\``,
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        const joinId = parseJoinButtonCustomId(interaction.customId)
        if (joinId) {
          const store = getStore?.()
          const linked = store?.getDiscordUserIgn?.(interaction.user.id)
          if (linked) {
            const result = await performDiscordJoin(joinId, interaction.user.id, linked)
            await replyJoinResult(interaction, joinId, linked, result)
          } else {
            await showJoinModal(interaction, joinId)
          }
          return
        }

        const leaveId = parseLeaveButtonCustomId(interaction.customId)
        if (leaveId) {
          const store = getStore?.()
          if (!store) {
            await interaction.reply({
              content: 'Store unavailable — try again later.',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          const result = leaveListing(store, leaveId, {
            clientId: discordClientId(interaction.user.id),
          })
          if (!result.ok) {
            await interaction.reply({
              content: result.error || 'Could not leave.',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          if (!result.changed) {
            await interaction.reply({
              content: 'You were not on this squad (join from Discord first, or leave in the app).',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          if (result.closed && result.row) {
            closeLfgMessage(enrichListingForDiscord(result.row))
          } else if (result.row) {
            void editLfgMessage(enrichListingForDiscord(result.row))
          }
          await interaction.reply({
            content: result.closed
              ? 'Left — squad closed (host gone).'
              : 'Left the squad. Hub board / companion will refresh shortly.',
            flags: MessageFlags.Ephemeral,
          })
          return
        }

        const closeId = parseCloseButtonCustomId(interaction.customId)
        if (closeId) {
          const store = getStore?.()
          const row = store?.get?.(closeId)
          if (!row || Date.parse(row.expiresAt) <= Date.now()) {
            await interaction.reply({
              content: 'That listing is already closed.',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          if (!isDiscordListingHost(row, interaction.user.id)) {
            await interaction.reply({
              content:
                'Only the host can close this listing. Link your IGN with `/lfg link` if you posted from the companion.',
              flags: MessageFlags.Ephemeral,
            })
            return
          }
          store.remove(row.id)
          closeLfgMessage(enrichListingForDiscord(row))
          try {
            const { broadcastLfgEvent } = await import('./hub-events.mjs')
            broadcastLfgEvent('listing', { type: 'closed', id: row.id })
          } catch {
            // optional
          }
          await interaction.reply({
            content: `Closed **${row.title}**.`,
            flags: MessageFlags.Ephemeral,
          })
        }
      } catch (err) {
        console.warn(
          '[lfg-api] Discord interaction failed:',
          err instanceof Error ? err.message : err,
        )
        try {
          if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'Could not handle that — try again.',
              flags: MessageFlags.Ephemeral,
            })
          }
        } catch {
          // ignore
        }
      }
    })

    client.on(Events.Error, (err) => {
      console.warn('[lfg-api] Discord client error:', err?.message || err)
    })

    try {
      await client.login(token)
      const deadline = Date.now() + 15_000
      while (!client.isReady() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      return client.isReady()
    } catch (err) {
      console.warn(
        '[lfg-api] Discord bot login failed:',
        err instanceof Error ? err.message : err,
      )
      ready = false
      client = null
      return false
    }
  })()

  return startPromise
}

/**
 * Post to configured guild channels (+ env fallback), respecting members_only + activity/region/platform filters.
 * @param {object} listing
 * @returns {Promise<{
 *   messageId: string | null,
 *   posts: Array<{ guildId: string | null, channelId: string, messageId: string }>,
 *   filteredOut?: boolean,
 *   skips?: Array<{ guildId: string | null, channelId: string, reason: string }>,
 *   targetCount?: number
 * }>}
 */
export async function createLfgMessage(listing) {
  if (!isBotReady()) return { messageId: null, posts: [], targetCount: 0 }
  const allTargets = resolveAnnounceTargets()
  if (!allTargets.length) {
    console.warn('[lfg-api] Discord bot ready but no channels configured (/lfg setup or DISCORD_CHANNEL_ID)')
    return { messageId: null, posts: [], targetCount: 0, skips: [] }
  }

  const { targets, skips } = await resolveTargetsForListing(listing)
  if (!targets.length) {
    console.info(
      '[lfg-api] Discord announce skipped for',
      listing?.hostIgn || listing?.id,
      skips.map((s) => s.reason).join(', ') || 'filter',
    )
    return {
      messageId: null,
      posts: [],
      filteredOut: true,
      skips,
      targetCount: allTargets.length,
    }
  }

  /** @type {Array<{ guildId: string | null, channelId: string, messageId: string }>} */
  const posts = []
  const basePayload = toDiscordPayload(listing)

  for (const t of targets) {
    const ch = await fetchTextChannel(t.channelId)
    if (!ch || !('send' in ch)) continue
    try {
      /** @type {import('discord.js').MessageCreateOptions} */
      const sendPayload = { ...basePayload }
      if (t.pingRoleId) {
        sendPayload.content = `<@&${t.pingRoleId}>`
        sendPayload.allowedMentions = { roles: [t.pingRoleId] }
      }
      const msg = await ch.send(sendPayload)
      if (msg?.id) {
        /** @type {string | null} */
        let threadId = null
        try {
          if (typeof msg.startThread === 'function') {
            const thread = await msg.startThread({
              name: `${String(listing.title || 'LFG').slice(0, 80)} · ${String(listing.hostIgn || 'squad').slice(0, 20)}`,
              autoArchiveDuration: 60,
              reason: 'LFG squad coordination',
            })
            threadId = thread?.id || null
            if (threadId) {
              const intro = [
                `Squad thread for **${listing.hostIgn || '?'}** — **${listing.title || 'LFG'}**.`,
                listing.whisper || buildWhisperFromListing(listing)
                  ? `Whisper: \`${listing.whisper || buildWhisperFromListing(listing)}\``
                  : '',
              ]
                .filter(Boolean)
                .join('\n')
              await thread.send({ content: intro }).catch(() => {})
            }
          }
        } catch (err) {
          console.warn(
            '[lfg-api] Discord thread create failed:',
            err instanceof Error ? err.message : err,
          )
        }
        posts.push({
          guildId: t.guildId,
          channelId: t.channelId,
          messageId: msg.id,
          threadId,
        })
      }
    } catch (err) {
      console.warn(
        `[lfg-api] Discord bot create failed (${t.channelId}):`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return {
    messageId: posts[0]?.messageId || null,
    posts,
    skips,
    targetCount: allTargets.length,
  }
}

/** Snapshot for /health and companion status. */
export function getDiscordHubStatus() {
  const guilds = getStore?.()?.listDiscordGuilds?.() || []
  return {
    botReady: isBotReady(),
    guildCount: guilds.length,
    membersOnlyGuilds: guilds.filter((g) => g.membersOnly).length,
    announceTargets: resolveAnnounceTargets().length,
  }
}

/**
 * @param {object} listing
 * @param {{ closed?: boolean }} [opts]
 */
export async function editLfgMessage(listing, opts = {}) {
  if (!isBotReady()) return { ok: false }
  const posts = listingPosts(listing)
  if (!posts.length) return { ok: false }

  const payload = toDiscordPayload(listing, opts)
  let any = false
  for (const p of posts) {
    const ch = await fetchTextChannel(p.channelId)
    if (!ch || !('messages' in ch)) continue
    try {
      await ch.messages.edit(p.messageId, payload)
      any = true
    } catch (err) {
      console.warn(
        '[lfg-api] Discord bot edit failed:',
        err instanceof Error ? err.message : err,
      )
    }
  }
  return { ok: any }
}

/**
 * @param {object} listing
 */
export async function deleteLfgMessage(listing) {
  if (!isBotReady()) return { ok: false }
  /** @type {Array<{ guildId: string | null, channelId: string, messageId: string }>} */
  const posts = [...listingPosts(listing)]
  if (!posts.length && listing?.discordMessageId) {
    const envCh = envFallbackChannelId()
    if (envCh) {
      posts.push({ guildId: null, channelId: envCh, messageId: listing.discordMessageId })
    }
  }
  let any = false
  for (const p of posts) {
    const ch = await fetchTextChannel(p.channelId)
    if (!ch || !('messages' in ch)) continue
    try {
      await ch.messages.delete(p.messageId)
      any = true
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 10008) {
        any = true
        continue
      }
      console.warn(
        '[lfg-api] Discord bot delete failed:',
        err instanceof Error ? err.message : err,
      )
    }
  }
  return { ok: any }
}

/**
 * @param {object} listing
 * @param {{ deleteMessage?: boolean }} [opts]
 */
export function closeLfgMessage(listing, { deleteMessage = true } = {}) {
  if (!listingPosts(listing).length && !listing?.discordMessageId) return
  if (!isBotReady()) return
  void (async () => {
    try {
      // Archive squad threads first
      for (const p of listingPosts(listing)) {
        if (!p.threadId || !client) continue
        try {
          const th = await client.channels.fetch(p.threadId)
          if (th && 'setArchived' in th) {
            await th.setArchived(true, 'LFG closed')
          }
        } catch {
          // thread may already be gone
        }
      }
      await editLfgMessage(listing, { closed: true })
      if (deleteMessage) {
        await new Promise((r) => setTimeout(r, 2500))
        await deleteLfgMessage(listing)
      }
    } catch (err) {
      console.warn(
        '[lfg-api] Discord bot close failed:',
        err instanceof Error ? err.message : err,
      )
    }
  })()
}

/** Guild webhook URLs for fallback (skips members_only guilds — those need bot membership checks). */
export function listConfiguredWebhookUrls() {
  const store = getStore?.()
  const guilds = store?.listDiscordGuilds?.() || []
  return guilds
    .filter((g) => !g.membersOnly && g.webhookUrl)
    .map((g) => g.webhookUrl)
    .filter(Boolean)
}
