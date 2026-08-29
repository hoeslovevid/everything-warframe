/**
 * Optional Discord bot for LFG announces + Whisper button + /lfg setup.
 * Env: DISCORD_BOT_TOKEN (required)
 *      DISCORD_CHANNEL_ID (optional fallback channel)
 */
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
  joinButtonCustomId,
  joinModalCustomId,
  leaveButtonCustomId,
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
 * @returns {Array<{ guildId: string | null, channelId: string, webhookUrl?: string | null }>}
 */
function resolveAnnounceTargets() {
  /** @type {Map<string, { guildId: string | null, channelId: string, webhookUrl?: string | null }>} */
  const byChannel = new Map()
  const store = getStore?.()
  const guilds = store?.listDiscordGuilds?.() || []
  for (const g of guilds) {
    if (!g?.channelId) continue
    byChannel.set(g.channelId, {
      guildId: g.guildId,
      channelId: g.channelId,
      webhookUrl: g.webhookUrl || null,
    })
  }
  const envCh = envFallbackChannelId()
  if (envCh && !byChannel.has(envCh)) {
    byChannel.set(envCh, { guildId: null, channelId: envCh, webhookUrl: null })
  }
  return [...byChannel.values()]
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
          .setName('link')
          .setDescription('Save your Warframe IGN for one-click Join')
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
      .toJSON(),
  ]
}

async function registerSlashCommands(c) {
  const body = buildSlashCommands()
  const rest = new REST({ version: '10' }).setToken(String(process.env.DISCORD_BOT_TOKEN).trim())
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body })
    console.info('[LFG] Discord slash commands registered (/lfg setup|status|clear|link|unlink)')
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
  })

  const bits = [
    `LFG announces will post in <#${channel.id}>.`,
    webhookUrl
      ? 'A channel webhook was created/reused as fallback.'
      : 'Could not create a webhook (bot needs Manage Webhooks) — bot posts will still work.',
    'Hub squads from Everything Warframe will appear here with live slots + Whisper.',
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
      `Webhook fallback: ${cfg.webhookUrl ? 'yes' : 'no'}`,
      cfg.configuredAt ? `Configured: ${cfg.configuredAt}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
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
    content: `Linked IGN **${ign}**. Join on LFG posts will use this name. Change anytime with \`/lfg link\`.`,
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
      intents: [GatewayIntentBits.Guilds],
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
          else if (sub === 'link') await handleLinkCommand(interaction)
          else if (sub === 'unlink') await handleUnlinkCommand(interaction)
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
 * Post to all configured guild channels (+ env fallback).
 * @param {object} listing
 * @returns {Promise<{ messageId: string | null, posts: Array<{ guildId: string | null, channelId: string, messageId: string }> }>}
 */
export async function createLfgMessage(listing) {
  if (!isBotReady()) return { messageId: null, posts: [] }
  const targets = resolveAnnounceTargets()
  if (!targets.length) {
    console.warn('[lfg-api] Discord bot ready but no channels configured (/lfg setup or DISCORD_CHANNEL_ID)')
    return { messageId: null, posts: [] }
  }

  /** @type {Array<{ guildId: string | null, channelId: string, messageId: string }>} */
  const posts = []
  const payload = toDiscordPayload(listing)

  for (const t of targets) {
    const ch = await fetchTextChannel(t.channelId)
    if (!ch || !('send' in ch)) continue
    try {
      const msg = await ch.send(payload)
      if (msg?.id) {
        posts.push({
          guildId: t.guildId,
          channelId: t.channelId,
          messageId: msg.id,
        })
      }
    } catch (err) {
      console.warn(
        `[lfg-api] Discord bot create failed (${t.channelId}):`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return { messageId: posts[0]?.messageId || null, posts }
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

/** Guild webhook URLs saved by /lfg setup (for webhook-only fallback fan-out). */
export function listConfiguredWebhookUrls() {
  const store = getStore?.()
  const guilds = store?.listDiscordGuilds?.() || []
  return guilds.map((g) => g.webhookUrl).filter(Boolean)
}
