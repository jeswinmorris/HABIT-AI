/**
 * playlist.ts — the morning music player (own playlist, shuffle / repeat / skip).
 * Holds one <audio> element outside React so music keeps playing across tab switches,
 * dialogs and re-renders. Track bytes live in IndexedDB (mediaStore); this module only
 * knows ids + modes, driven by the store through configure().
 */
import { resolveMedia } from '../lib/mediaStore'

export type PlaylistTrack = { id: string; name: string; url: string }
export type PlayMode = 'sequential' | 'shuffle' | 'repeat-one' | 'repeat-all'

type Listener = (s: { playing: boolean; index: number; current: PlaylistTrack | null; mode: PlayMode }) => void

class PlaylistEngine {
  private el: HTMLAudioElement | null = null
  private tracks: PlaylistTrack[] = []
  private mode: PlayMode = 'shuffle'
  private index = 0
  private volume = 0.8
  private muted = false
  private order: number[] = []
  private orderPos = 0
  private urls = new Map<string, string>()
  private listeners = new Set<Listener>()
  playing = false

  configure(cfg: { tracks?: PlaylistTrack[]; mode?: PlayMode; volume?: number; muted?: boolean }) {
    if (cfg.tracks) {
      const same = JSON.stringify(cfg.tracks.map((t) => t.id)) === JSON.stringify(this.tracks.map((t) => t.id))
      this.tracks = cfg.tracks
      if (!same) { this.index = 0; this.order = []; this.orderPos = 0 }
    }
    if (cfg.mode && cfg.mode !== this.mode) { this.mode = cfg.mode; this.order = [] }
    if (typeof cfg.volume === 'number') { this.volume = Math.max(0, Math.min(1, cfg.volume)); if (this.el) this.el.volume = this.muted ? 0 : this.volume }
    if (typeof cfg.muted === 'boolean') { this.muted = cfg.muted; if (this.el) this.el.volume = this.muted ? 0 : this.volume }
    this.emit()
  }

  getState() {
    return { playing: this.playing, index: this.index, current: this.tracks[this.index] || null, mode: this.mode }
  }
  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { const s = this.getState(); this.listeners.forEach((l) => l(s)) }

  private audio(): HTMLAudioElement {
    if (!this.el) {
      const el = new Audio()
      el.preload = 'auto'
      el.volume = this.muted ? 0 : this.volume
      el.onended = () => this.handleEnded()
      el.onerror = () => { if (this.tracks.length > 1) this.next() }
      this.el = el
    }
    return this.el
  }

  private shuffled(): number[] {
    if (this.order.length !== this.tracks.length || this.orderPos >= this.tracks.length) {
      const idx = this.tracks.map((_, i) => i)
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[idx[i], idx[j]] = [idx[j], idx[i]]
      }
      this.order = idx
      this.orderPos = 0
    }
    return this.order
  }

  private pickNext(direction: 1 | -1 = 1): number {
    const n = this.tracks.length
    if (!n) return -1
    if (this.mode === 'repeat-one') return this.index
    if (this.mode === 'shuffle') { const o = this.shuffled(); this.orderPos += 1; return o[Math.min(this.orderPos, n - 1)] ?? 0 }
    if (this.mode === 'repeat-all') return (this.index + direction + n) % n
    const nextIdx = this.index + direction
    return nextIdx >= 0 && nextIdx < n ? nextIdx : -1
  }

  async loadAndPlay(index = this.index): Promise<boolean> {
    const t = this.tracks[index]
    if (!t) return false
    this.index = index
    const url = this.urls.get(t.id) ?? (await resolveMedia(t.url))
    if (url) this.urls.set(t.id, url)
    const el = this.audio()
    el.src = url || ''
    el.volume = this.muted ? 0 : this.volume
    try { await el.play(); this.playing = true } catch { this.playing = false }
    this.emit()
    return this.playing
  }

  async play(): Promise<boolean> {
    if (!this.tracks.length) return false
    if (this.playing && this.el && !this.el.paused) return true
    return this.loadAndPlay(this.index >= 0 && this.index < this.tracks.length ? this.index : 0)
  }
  async resumeOrPlay(): Promise<boolean> {
    const el = this.el
    if (el && el.src && el.paused) { try { await el.play(); this.playing = true; this.emit(); return true } catch { /* fall through */ } }
    return this.play()
  }
  pause() { try { this.el?.pause() } catch {} this.playing = false; this.emit() }
  stop() {
    try { this.el?.pause(); if (this.el) this.el.currentTime = 0 } catch {}
    this.playing = false
    this.emit()
  }
  next() { const i = this.pickNext(1); if (i >= 0) void this.loadAndPlay(i) }
  prev() { const i = this.pickNext(-1); if (i >= 0) void this.loadAndPlay(i) }
  seek(time: number) { try { if (this.el) this.el.currentTime = time } catch {} }
  isBusy() { return this.playing && !!this.el && !this.el.paused }
  duration() { return this.el?.duration || 0 }
  position() { return this.el?.currentTime || 0 }
  private handleEnded() {
    if (this.mode === 'repeat-one' && this.tracks.length) { void this.loadAndPlay(this.index); return }
    const i = this.pickNext(1)
    if (i >= 0) void this.loadAndPlay(i)
    else { this.playing = false; this.emit() }
  }
}

export const playlist = new PlaylistEngine()
