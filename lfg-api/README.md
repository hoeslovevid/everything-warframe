# Everything Warframe — LFG Hub

Shared squad matchmaking API for the companion **LFG** tab.

Listings are stored in **SQLite** via Node’s built-in `node:sqlite` (Node 22.5+).  
No native npm addons — Railway/Nixpacks installs stay simple.  
If SQLite can’t load (e.g. Electron’s older embedded Node), the hub falls back to an atomic JSON file with the same API.

## Local / LAN

From the repo root:

```bash
npm run lfg:serve
```

Or from this folder:

```bash
npm start
```

(`npm install` is required only if you use the Discord bot — `discord.js`. Core hub uses **node:sqlite**.)

Listens on `http://0.0.0.0:17864` (or `PORT`). Leave **Hub URL** empty in the app to auto-start a local hub, or set Hub URL to `http://YOUR_LAN_IP:17864` on friends’ PCs.

Default DB file: `lfg-api/data/lfg.sqlite`.

## Railway (friends / community board)

### 1. Deploy

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → this repo.
2. Service **Settings**:
   - **Root Directory:** `lfg-api`
   - Start command is already set via `railway.toml` / `package.json` (`node server.mjs`).
3. **Networking** → **Generate Domain**.
4. Confirm: `https://YOUR-DOMAIN.up.railway.app/health` returns `{ "ok": true, "store": "sqlite", ... }`.
   Start command: `node boot.mjs` (see `railway.toml`).

### Railway edge 429 (`rate limited` / `railway-hikari`)

If `https://YOUR.up.railway.app/health` returns plain text `rate limited` with
`server: railway-hikari`, the block is **Railway’s edge**, not this app — requests
never reach the container. The desktop app will auto-fall back to a **local** board.

**Fix community board:**

1. Railway → service → **Networking** → remove the current domain → **Generate Domain** again  
   (or attach a **custom domain**).
2. Confirm the new URL’s `/health` returns JSON `{ "ok": true, ... }`.
3. Paste that URL into Everything Warframe → LFG → **Hub URL** (or update the app default).

### 2. Volume (keep boards across redeploys)

Without a volume, Railway’s disk is ephemeral and the DB is wiped on every deploy.

1. Service → **Volumes** → **Add Volume**.
2. **Mount path:** `/data`
3. Service → **Variables**:

| Variable | Value |
|----------|--------|
| `LFG_DATA` | `/data/lfg.sqlite` |

Redeploy once after attaching the volume. `/health` should show `"dataPath":"/data/lfg.sqlite"`.

### 3. Point the app at the hub

In Everything Warframe → **LFG** → set **Hub URL** to the HTTPS domain (no trailing slash) on every PC.

### Optional env

| Variable | Default | Notes |
|----------|---------|--------|
| `PORT` | set by Railway | Do not override |
| `LFG_DATA` | `./data/lfg.sqlite` | Full path to SQLite (or `.json` to force JSON) |
| `LFG_DATA_DIR` | `./data` | Used when `LFG_DATA` is unset |
| `LFG_ORIGIN` | `*` | CORS allow origin |
| `DISCORD_BOT_TOKEN` | unset | Bot login (required for bot + `/lfg setup`) |
| `DISCORD_CHANNEL_ID` | unset | Optional fallback channel if no `/lfg setup` yet |
| `DISCORD_WEBHOOK_URL` | unset | Fallback announce if bot unset/unavailable |

## Discord (optional)

### Hub bot (recommended)

Posts embeds with live slots/roster and buttons: **Join**, **Leave**, **Whisper**.

**Public invite (add to any server you manage):**  
[Add Everything Warframe LFG bot](https://discord.com/oauth2/authorize?client_id=1543118817654476840&permissions=536955880&scope=bot%20applications.commands)

**Discord Developer Portal — legal URLs:**
- Terms of Service: https://hoeslovevid.github.io/Warframe-Companion-Helper/terms.html
- Privacy Policy: https://hoeslovevid.github.io/Warframe-Companion-Helper/privacy.html

After installing, an admin runs `/lfg setup` in that server (see below).

Operator setup (hosting the hub):

1. [Discord Developer Portal](https://discord.com/developers/applications) → your application → **Bot** → copy token.
2. Enable no privileged intents (Guilds only).
3. Invite uses scopes `bot` + `applications.commands` and permissions: **Send Messages**, **Embed Links**, **Read Message History**, **Manage Webhooks** (same as the public link above).
4. Railway / host variable (only the token is required):

```bash
DISCORD_BOT_TOKEN=your-bot-token
# optional until an admin runs /lfg setup:
# DISCORD_CHANNEL_ID=123456789012345678
```

5. In Discord (Manage Server), run:

```
/lfg setup channel:#your-lfg-channel
```

Optional: only announce squads whose host is in **this** Discord server:

```
/lfg setup channel:#your-lfg-channel members_only:True
```

That stores the channel in the hub DB and auto-creates a channel webhook as fallback.  
With **members only**, the host must have run `/lfg link` (or joined Discord with a matching IGN) and be a member of that server — otherwise that guild is skipped.  
Also useful: `/lfg status`, `/lfg clear`.

6. Anyone can save their Warframe name for Join **and** members-only announce matching:

```
/lfg link ign:YourIgn
```

**Join** on a post uses that IGN (or opens a modal if not linked), updates the hub roster, refreshes the Discord embed, and the companion LFG board shows it on the next poll. **Leave** removes a Discord join (`discord:<userId>`). **Whisper** still returns the `/w` line for in-game invite.

Redeploy after setting the token. Logs should show `Discord bot ready` and slash commands registered. New hub squads fan out to every server that ran `/lfg setup` (plus `DISCORD_CHANNEL_ID` if set), except **members only** guilds filter by host membership as above.

### Hub webhook (fallback)

If the bot is not configured (or login fails), set:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID/TOKEN
```

Same live slot updates, but **no Whisper button** (webhooks cannot handle button clicks). Guild webhooks created by `/lfg setup` are also used as fallback when the bot is down — **except** for **members only** guilds (those require the bot’s membership check; they are not webhook-spammed).

Every successful `POST /listings` posts an embed. Join/leave PATCH the same message. Close/expiry marks closed, then deletes.

### Personal webhook (desktop app)

In the companion **LFG → Advanced hub settings**: enable **Discord notify on post** and paste your
own webhook URL. That posts only squads **you** create, to **your** Discord — the URL never leaves
the app (not sent to the hub). Independent of the hub bot.

## Schema (SQLite)

- `listings` — one row per open squad (TTL via `expires_at`)
- `members` — squad roster (`listing_id` + `client_id`)
- `discord_guild_settings` — per-server channel + optional `members_only` from `/lfg setup`
- `discord_user_profiles` — Discord user → Warframe IGN from `/lfg link` (Join + members-only matching)

Old `lfg-data.json` files are imported automatically on first SQLite open, then renamed to `*.migrated`.

Swapping to Postgres later only requires a new store backend behind `openStore()` in `store.mjs`; the HTTP API stays the same.

## Other hosts (Render / Fly / VPS)

```bash
LFG_DATA=/var/lib/ew-lfg/lfg.sqlite node boot.mjs
```

Mount durable storage at that path, then set **Hub URL** in the app to `https://your-host.example`.

## API

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Hub status (`store`, `dataPath`, `listings`) |
| GET | `/listings?region=&activity=&q=` | Open queues |
| POST | `/listings` | Create (returns `hostToken`) |
| POST | `/listings/:id/join` | Join squad |
| POST | `/listings/:id/leave` | Leave |
| POST | `/listings/:id/extend` | Host add TTL (`X-LFG-Token`, default +10m) |
| DELETE | `/listings/:id` | Host close (`X-LFG-Token`) |

No Overwolf / in-game invite automation — clients copy `/w` whisper lines into Warframe.
