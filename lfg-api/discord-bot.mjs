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
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js'
import {
  buildLfgEmbed,
  buildWhisperFromListing,
  parseWhisperButtonCustomId,
  whisperButtonCustomId,
} from './discord-embed.mjs'

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
  if (data.footer?.text) embed.setFooter({ text: data.footer.text })

  /** @type {import('discord.js').ActionRowBuilder<import('discord.js').ButtonBuilder>[]} */
  const components = []
  if (!opts.closed && listing?.id) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(whisperButtonCustomId(listing.id))
          .setLabel('Whisper')
          .setStyle(ButtonStyle.Primary),
      ),
    )
  }

  return { embeds: [embed], components }
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
          .setDescription('Set the channel where hub squads are announced')
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
        sc.setName('clear').setDescription('Remove this server’s LFG channel config'),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),
  ]
}

async function registerSlashCommands(c) {
  const body = buildSlashCommands()
  const rest = new REST({ version: '10' }).setToken(String(process.env.DISCORD_BOT_TOKEN).trim())
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body })
    console.info('[LFG] Discord slash commands registered (/lfg setup|status|clear)')
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
  const store = getStore?.()
  store?.removeDiscordGuild?.(interaction.guildId)
  await interaction.reply({
    content: 'Cleared this server’s LFG channel config.',
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
          return
        }

        if (!interaction.isButton()) return
        const listingId = parseWhisperButtonCustomId(interaction.customId)
        if (!listingId) return

        const store = getStore?.()
        const row = store?.get?.(listingId)
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
