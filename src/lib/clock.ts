/**
 * clock.ts — single source of truth for "what time / what day is it".
 *
 * Why: the app used to mix `new Date().toISOString().slice(0,10)` (UTC) with
 * `dayController.todayKey()` (local) when labelling tasks, water logs and steaks.
 * For anyone east of Greenwich the UTC date rolls ahead of the local date by up to
 * 12h, so "today" lookups silently pointed at yesterday and the 00:00 resets fired
 * at the wrong wall-clock time. Everything now goes through the local-day helpers here.
 */

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** Local calendar day, e.g. 2026-09-15. */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function todayKey(): string { return dayKey(new Date()) }

/** Any timestamp (ISO string / Date / 'YYYY-MM-DD...') -> the LOCAL calendar day it falls on.
 *  Storing createdAt as an ISO instant and then slicing 10 characters quietly gives you the
 *  UTC day, so east of Greenwich a habit created this morning reads as "yesterday". */
export function localDayOf(value: string | Date | null | undefined): string {
  if (!value) return todayKey()
  if (value instanceof Date) return dayKey(value)
  const str = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const d = new Date(str)
  return Number.isNaN(d.getTime()) ? todayKey() : dayKey(d)
}
export function tomorrowKey(): string { return addDaysKey(todayKey(), 1) }
export function yesterdayKey(): string { return addDaysKey(todayKey(), -1) }

export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n)
  return dayKey(dt)
}

/** Whole-day distance between two local day keys (DST safe: uses UTC noon). */
export function dayIndexOf(createdAtKey: string, todayKeyStr: string = todayKey()): number {
  const [y1, m1, d1] = String(createdAtKey).slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = String(todayKeyStr).slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(y2, (m2 || 1) - 1, d2 || 1) - Date.UTC(y1, (m1 || 1) - 1, d1 || 1)) / 86400000)
}

export function weekdayOf(keyOrDate: string | Date = new Date()): Weekday {
  const d = typeof keyOrDate === 'string'
    ? new Date(Number(keyOrDate.slice(0, 4)), Number(keyOrDate.slice(5, 7)) - 1, Number(keyOrDate.slice(8, 10)))
    : keyOrDate
  return WEEKDAYS[d.getDay()]
}
export function isWeekend(keyOrDate: string | Date = new Date()): boolean {
  const day = weekdayOf(keyOrDate)
  return day === 'Sat' || day === 'Sun'
}

/** "07:15" -> 435 ; invalid -> NaN */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
  if (!m) return NaN
  const h = Number(m[1]), mi = Number(m[2])
  if (h > 23 || mi > 59) return NaN
  return h * 60 + mi
}
export function toHHMM(minutes: number): string {
  const mins = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}
export function minutesNow(d: Date = new Date()): number { return d.getHours() * 60 + d.getMinutes() }
export function clockNow(d: Date = new Date()): string { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
export function clockWithSeconds(d: Date = new Date()): string { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
export function dateLabel(d: Date = new Date()): string {
  try { return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) } catch { return dayKey(d) }
}
/** Minutes until `hhmm` today, always positive (wraps to tomorrow). */
export function minutesUntil(hhmm: string, from: Date = new Date()): number {
  const target = toMinutes(hhmm)
  if (Number.isNaN(target)) return NaN
  return (target - minutesNow(from) + 1440) % 1440
}
export function untilClock(hhmm: string, from: Date = new Date()): string {
  const mins = minutesUntil(hhmm, from)
  if (Number.isNaN(mins)) return ''
  if (mins === 0) return 'now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}
/** True when the wall clock sits inside [start,end]; wraps over midnight when start > end. */
export function between(hhmmStart: string, hhmmEnd: string, at: Date = new Date()): boolean {
  const a = toMinutes(hhmmStart), b = toMinutes(hhmmEnd)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  const n = minutesNow(at)
  return a <= b ? n >= a && n <= b : n >= a || n <= b
}

/* ------------------------------- tick bus ---------------------------------- */
type ClockListener = (d: Date) => void
const listeners = new Set<ClockListener>()
let timer: ReturnType<typeof setInterval> | null = null

/** Subscribe to a 1s clock. Keeps every scheduler/HUD on the same real time. */
export function onClock(fn: ClockListener): () => void {
  listeners.add(fn)
  if (!timer) timer = setInterval(() => listeners.forEach((l) => l(new Date())), 1000)
  return () => {
    listeners.delete(fn)
    if (timer && listeners.size === 0) { clearInterval(timer); timer = null }
  }
}

/** Fires once per local calendar day change (also on boot if the day already changed). */
export function onNewDay(fn: (today: string, previous: string) => void): () => void {
  let last = dayKey()
  const off = onClock(() => {
    const now = dayKey()
    if (now !== last) {
      const prev = last
      last = now
      fn(now, prev)
    }
  })
  return off
}

/** localStorage is keyed by the real clock; hydrate() may race with a day change. */
export function stampRollover(key = 'habitOS_lastSeenDay'): { changed: boolean; today: string; previous: string } {
  const today = dayKey()
  let previous = today
  try {
    previous = localStorage.getItem(key) || today
    if (previous !== today) localStorage.setItem(key, today)
  } catch {}
  return { changed: previous !== today, today, previous }
}
