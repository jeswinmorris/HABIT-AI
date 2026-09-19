/**
 * audioBus.ts — exactly one thing makes sound at a time.
 *
 * The complaint: the playlist, an affirmation clip, a visualization video and the AI's own
 * voice all talked over each other. Every audio owner registers here; when one of them starts,
 * the others are suspended, and the suspended owner is resumed when the channel frees up — so
 * the morning playlist keeps running "mild" under the day, pauses for a reminder, and picks
 * back up afterwards without being restarted from zero.
 */
export type AudioChannel = 'speech' | 'affirmation' | 'video' | 'music' | 'prayer'
// 'affirmation' and 'prayer' clips share one lane: they are intentional listening, like video

type Owner = {
  channel: AudioChannel
  suspend: () => void
  maybeResume: () => void
  /** user explicitly paused/stopped this source — the bus must not restart it */
  isWanted: () => boolean
}

const RANK: Record<AudioChannel, number> = { speech: 4, affirmation: 3, prayer: 3, video: 3, music: 1 }

class AudioBus {
  private owners = new Map<AudioChannel, Owner>()
  private active: AudioChannel | null = null
  private suspended = new Set<AudioChannel>()

  register(owner: Owner) {
    this.owners.set(owner.channel, owner)
    return () => { this.owners.delete(owner.channel); this.suspended.delete(owner.channel); if (this.active === owner.channel) this.active = null }
  }

  /** Ask for the channel. Everything lower-or-equal ranked gets suspended. */
  claim(channel: AudioChannel): boolean {
    const owner = this.owners.get(channel)
    if (!owner) return false
    if (this.active && this.active !== channel) {
      const cur = this.owners.get(this.active)
      // a higher-priority source keeps playing; don't fight the voice over the speakers
      if (RANK[this.active] > RANK[channel] && this.active === 'speech') return false
      if (cur && cur.isWanted()) { cur.suspend(); this.suspended.add(this.active) }
      this.active = null
    }
    this.active = channel
    this.suspended.delete(channel)
    return true
  }

  /** Done with the channel — hand it back to whoever was waiting, music last. */
  release(channel: AudioChannel) {
    if (this.active === channel) this.active = null
    this.suspended.delete(channel)
    const waiting = [...this.suspended]
      .map((c) => this.owners.get(c)!)
      .filter((o) => o && o.isWanted())
      .sort((a, b) => RANK[b.channel] - RANK[a.channel])
    if (waiting.length) {
      const next = waiting[0]
      this.active = next.channel
      this.suspended.delete(next.channel)
      next.maybeResume()
    }
  }

  activeChannel() { return this.active }
  isBusy() { return !!this.active || this.suspended.size > 0 && [...this.suspended].some((c) => this.owners.get(c)?.isWanted()) }
  /** Anything playing right now? (used to stop random playout from cutting in) */
  isPlaying() { return !!this.active }
}

export const audioBus = new AudioBus()

// The AI's own voice registers lazily from speakingModel; the lane helpers below are used by
// every uploaded-clip / video player so a new sound always silences the previous one.
export const claimLane = (channel: AudioChannel) => audioBus.claim(channel)
export const releaseLane = (channel: AudioChannel) => audioBus.release(channel)
