import fs from 'node:fs'
import { EventEmitter } from 'node:events'

export type LogEvent = {
  type:
    | 'relic_rewards'
    | 'relic_rewards_end'
    | 'riven_reroll'
    | 'riven_reroll_end'
    | 'mission_complete'
  /** Approximate squad size when known (relic reward screen). */
  squadSize?: number | null
}

/**
 * Markers that the fissure reward pick screen is up (AlecaFrame / WFInfo style).
 * Keep these specific — a bare `ProjectionRewardChoice.lua` match also hits
 * close/select lines and used to re-trigger OCR after the pick screen was gone (#8).
 */
const REWARD_START_PATTERNS = [
  /ProjectionRewardChoice\.lua:\s*Relic rewards initialized/i,
  /Relic rewards initialized/i,
  // WFInfo / older builds — "Got rewards" without "screen closed"
  /Got rewards(?!\s+screen\s+closed)/i,
  /Script \[Info\]:.*ProjectionRewardChoice.*(?:initialized|open|shown|show)/i,
  // Proton / newer client variants
  /RelicReward(?:s)?(?:Choice|Screen|UI).*(?:initialized|open|shown|show)/i,
  /UI_Open.*(?:Relic|Projection).*Reward/i,
  /ShowProjectionReward/i,
]

const REWARD_END_PATTERNS = [
  /ProjectionRewardChoice\.lua:.*(?:Selected|Choice made|Closing|closed|Select)/i,
  // Avoid bare EndOfMatch.lua (can appear during mission init under Wine timing)
  /EndOfMatch\.lua:.*(?:initialized|started|begin|completed|destroyed|closed)/i,
  /Got rewards screen closed/i,
  /Script \[Info\]:.*Reward.*(?:closed|dismiss|selected)/i,
  /RelicReward(?:s)?(?:Choice|Screen).*clos/i,
  /HideProjectionReward/i,
]

/**
 * Real EE.log lines from Kuva Cycle:
 *  - "Are you sure you want to cycle Ignis Acri-critabin for ?3,500?"
 *  - then QuickMatchPleaseWait after confirm → compare UI is up
 *
 * Note: "Cycle Riven into current selection?" appears on the compare screen itself
 * and must NOT be treated as dismiss — it was cancelling OCR mid-scan.
 */
const RIVEN_CYCLE_CONFIRM =
  /Are you sure you want to cycle .+ for|Spend\s+[\d,]+\s+Kuva\s+to\s+cycle|cycle this Riven for/i
const RIVEN_CYCLE_PENDING_READY =
  /NavBar_QuickMatchPleaseWait|QuickMatchPleaseWait/i
/** Compare-screen chrome — fire when already armed (or same chunk as confirm). */
const RIVEN_COMPARE_UI =
  /Cycle Riven into current selection|Accept new Riven|Keep current Riven/i

/** Squad join / leave / size hints commonly seen in EE.log. */
const SQUAD_JOIN =
  /(?:joined the squad|has joined|OnSquadMemberJoined|AddSquadMember)[^\n]{0,80}?([A-Za-z0-9_\-.]{2,24})/i
const SQUAD_LEAVE =
  /(?:left the squad|has left|OnSquadMemberLeft|RemoveSquadMember)[^\n]{0,80}?([A-Za-z0-9_\-.]{2,24})/i
const SQUAD_SIZE_LINE =
  /(?:SquadSize|PlayersInSquad|squad of|MatchingService.*Players)\D{0,12}([1-4])\b/i
const VOID_PROJECTION =
  /AddVoidProjection|VoidProjection|Selecting projection/i

/** End-of-mission markers (Arbitration extract / general EOM). */
const MISSION_COMPLETE_PATTERNS = [
  /EndOfMatch\.lua:.*(?:completed|finished|EOM|MissionResults)/i,
  /MissionComplete|EOM_Complete|OnMatchComplete/i,
  /Hud\.lua:.*Mission\s+(?:complete|success|extracted)/i,
]

function lineIsMissionComplete(line: string): boolean {
  return MISSION_COMPLETE_PATTERNS.some((re) => re.test(line))
}

function lineIsRewardEnd(line: string): boolean {
  return REWARD_END_PATTERNS.some((re) => re.test(line))
}

function lineIsRewardStart(line: string): boolean {
  if (lineIsRewardEnd(line)) return false
  return REWARD_START_PATTERNS.some((re) => re.test(line))
}

/**
 * Tail Warframe EE.log for fissure reward-screen and riven cycle markers.
 */
export class LogWatcher extends EventEmitter {
  private path: string | null = null
  private offset = 0
  private timer: NodeJS.Timeout | null = null
  private fsWatcher: fs.FSWatcher | null = null
  private watchDebounce: NodeJS.Timeout | null = null
  private lastStartEmit = 0
  private lastEndEmit = 0
  private lastMissionCompleteEmit = 0
  private lastRivenStart = 0
  private lastRivenEnd = 0
  private rewardScreenOpen = false
  private rivenScreenOpen = false
  /** True after the kuva "want to cycle" dialog appears; cleared on scan emit or timeout. */
  private rivenCycleArmed = false
  private rivenArmTimer: NodeJS.Timeout | null = null
  private squadMembers = new Set<string>()
  private squadSizeHint: number | null = null
  private voidProjectionCount = 0
  private missedTicks = 0

  /** Latest best-guess squad size for relic OCR (1–4), or null. */
  getSquadSizeHint(): number | null {
    if (this.squadSizeHint != null) return this.squadSizeHint
    if (this.voidProjectionCount > 0) return Math.min(4, Math.max(1, this.voidProjectionCount))
    if (this.squadMembers.size > 0) return Math.min(4, Math.max(1, this.squadMembers.size))
    return null
  }

  setPath(next: string | null) {
    this.path = next
    this.offset = 0
    this.rewardScreenOpen = false
    this.rivenScreenOpen = false
    this.rivenCycleArmed = false
    this.squadMembers.clear()
    this.squadSizeHint = null
    this.voidProjectionCount = 0
    if (this.rivenArmTimer) {
      clearTimeout(this.rivenArmTimer)
      this.rivenArmTimer = null
    }
    this.reattachFsWatch()
    if (next && fs.existsSync(next)) {
      try {
        this.offset = fs.statSync(next).size
      } catch {
        this.offset = 0
      }
    }
  }

  start(intervalMs = 1500) {
    this.stop()
    // Poll is a reliability fallback; fs.watch drives near-instant ticks when available.
    this.timer = setInterval(() => this.tick(), intervalMs)
    this.reattachFsWatch()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.watchDebounce) clearTimeout(this.watchDebounce)
    this.watchDebounce = null
    if (this.fsWatcher) {
      try {
        this.fsWatcher.close()
      } catch {
        // ignore
      }
      this.fsWatcher = null
    }
    if (this.rivenArmTimer) {
      clearTimeout(this.rivenArmTimer)
      this.rivenArmTimer = null
    }
  }

  private reattachFsWatch() {
    if (this.fsWatcher) {
      try {
        this.fsWatcher.close()
      } catch {
        // ignore
      }
      this.fsWatcher = null
    }
    if (!this.path || !fs.existsSync(this.path)) return
    try {
      this.fsWatcher = fs.watch(this.path, () => {
        if (this.watchDebounce) clearTimeout(this.watchDebounce)
        // Coalesce burst writes from the game into one tick.
        this.watchDebounce = setTimeout(() => {
          this.watchDebounce = null
          this.tick()
        }, 15)
      })
      this.fsWatcher.on('error', () => {
        try {
          this.fsWatcher?.close()
        } catch {
          // ignore
        }
        this.fsWatcher = null
      })
    } catch {
      // Wine/Proton FS may not support watch — poll-only is fine.
      this.fsWatcher = null
    }
  }

  private armRivenCycle() {
    this.rivenCycleArmed = true
    if (this.rivenArmTimer) clearTimeout(this.rivenArmTimer)
    // Fallback: user may confirm without a PleaseWait line we catch in the same tick.
    this.rivenArmTimer = setTimeout(() => {
      this.rivenArmTimer = null
      if (!this.rivenCycleArmed) return
      this.rivenCycleArmed = false
      this.emitRivenStart()
    }, 1800)
  }

  private emitRivenStart() {
    const now = Date.now()
    if (now - this.lastRivenStart < 4000) return
    this.lastRivenStart = now
    this.rivenScreenOpen = true
    this.rivenCycleArmed = false
    if (this.rivenArmTimer) {
      clearTimeout(this.rivenArmTimer)
      this.rivenArmTimer = null
    }
    this.emit('event', { type: 'riven_reroll' } satisfies LogEvent)
  }

  private tick() {
    if (!this.path) {
      if (++this.missedTicks % 40 === 1) {
        console.warn(
          '[Everything Warframe] EE.log path not set — log-based relic/riven auto-scan disabled',
        )
      }
      return
    }
    if (!fs.existsSync(this.path)) {
      if (++this.missedTicks % 40 === 1) {
        console.warn(`[Everything Warframe] EE.log missing at ${this.path}`)
      }
      return
    }
    this.missedTicks = 0
    try {
      const stat = fs.statSync(this.path)
      if (stat.size < this.offset) this.offset = 0
      if (stat.size === this.offset) return

      const fd = fs.openSync(this.path, 'r')
      const length = stat.size - this.offset
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, this.offset)
      fs.closeSync(fd)
      this.offset = stat.size

      const chunk = buf.toString('utf8')
      const now = Date.now()
      const lines = chunk.split(/\r?\n/)

      // Track squad size from recent lines (used when relic rewards open).
      for (const line of lines) {
        const sizeHit = line.match(SQUAD_SIZE_LINE)
        if (sizeHit) {
          const n = Number(sizeHit[1])
          if (n >= 1 && n <= 4) this.squadSizeHint = n
        }
        if (VOID_PROJECTION.test(line)) {
          this.voidProjectionCount = Math.min(4, this.voidProjectionCount + 1)
        }
        const join = line.match(SQUAD_JOIN)
        if (join?.[1]) this.squadMembers.add(join[1].toLowerCase())
        const leave = line.match(SQUAD_LEAVE)
        if (leave?.[1]) this.squadMembers.delete(leave[1].toLowerCase())
      }

      // Process reward markers in log order so close/select never re-arms a start (#8).
      for (const line of lines) {
        if (!line.trim()) continue
        if (lineIsRewardStart(line)) {
          if (now - this.lastStartEmit >= 5000) {
            this.lastStartEmit = now
            this.rewardScreenOpen = true
            this.emit('event', {
              type: 'relic_rewards',
              squadSize: this.getSquadSizeHint(),
            } satisfies LogEvent)
          }
        } else if (
          this.rewardScreenOpen &&
          lineIsRewardEnd(line) &&
          now - this.lastEndEmit >= 2000
        ) {
          this.lastEndEmit = now
          this.rewardScreenOpen = false
          this.voidProjectionCount = 0
          this.emit('event', { type: 'relic_rewards_end' } satisfies LogEvent)
        } else if (
          lineIsMissionComplete(line) &&
          now - this.lastMissionCompleteEmit >= 8000
        ) {
          this.lastMissionCompleteEmit = now
          this.emit('event', { type: 'mission_complete' } satisfies LogEvent)
        }
      }

      // Kuva spend confirm dialog → arm; PleaseWait / compare chrome → scan.
      const confirmHit = RIVEN_CYCLE_CONFIRM.test(chunk)
      if (confirmHit) {
        this.armRivenCycle()
      }
      if (this.rivenCycleArmed && RIVEN_CYCLE_PENDING_READY.test(chunk)) {
        this.emitRivenStart()
      } else if (this.rivenCycleArmed && RIVEN_COMPARE_UI.test(chunk)) {
        this.emitRivenStart()
      } else if (confirmHit && RIVEN_COMPARE_UI.test(chunk)) {
        // Confirm + compare text in one chunk (slow poll / Proton batching).
        this.emitRivenStart()
      }

      // Compare UI dismiss is handled by auto-hide / hotkey — no reliable EE.log close marker.
    } catch (err) {
      console.error('[Everything Warframe] EE.log watch error', err)
    }
  }
}
