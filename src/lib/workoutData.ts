/**
 * workoutData.ts — the Workout page and the reminder engine must see the same rows.
 *
 * Segments (chest, legs, face, massage, …) live in habitOS_workoutSegments as they always did,
 * but every reader goes through here so a row is described the same way everywhere:
 *   kind     : what it is (workout | facial | massage) — drives the label + icons
 *   slot     : primary (the morning full-stretch session) | secondary (a quick set, repeated on
 *              its own frequency: every 30 min, every 2 h, …)
 *   priority : what gets reminded first when the morning window is tight
 *   done     : per calendar day (local), reset by the midnight rollover
 */
import { todayKey, localDayOf } from './clock'

export type WorkoutKind = 'workout' | 'facial' | 'massage'
export type WorkoutRow = {
  id: string
  name: string
  reps: string
  kind: WorkoutKind
  slot: 'primary' | 'secondary'
  priority: 'high' | 'normal'
  everyMin: number
  segment: string
  done: boolean
  date: string
  mediaUrl?: string
  mediaType?: 'image' | 'video'
}

export const WORKOUT_KINDS: { id: WorkoutKind; label: string }[] = [
  { id: 'workout', label: 'Strength / cardio' },
  { id: 'facial', label: 'Facial exercise' },
  { id: 'massage', label: 'Massage / mobility' }
]

const STORE = 'habitOS_workoutSegments'
const HISTORY = 'habitOS_workoutDone'

function readDone(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(HISTORY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string[]> = {}
    Object.keys(parsed).forEach((k) => { if (Array.isArray(parsed[k])) out[k] = parsed[k] })
    return out
  } catch { return {} }
}

export function readSegments(): any[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]')
    return Array.isArray(raw) ? raw.filter((s: any) => s && typeof s === 'object') : []
  } catch { return [] }
}

export function writeSegments(segs: any[]) {
  // the key starts with habitOS_ so lib/db mirrors it into the desktop database automatically
  localStorage.setItem(STORE, JSON.stringify(segs))
}

/** Flattened, normalised rows for today (done flags are per local day). */
export function readWorkoutRows(dateKey: string = todayKey()): WorkoutRow[] {
  const doneMap = readDone()
  const flat = readSegments().flatMap((s: any) => (s.workouts || []).map((w: any) => ({ ...w, segment: s.name })))
  return flat
    .filter((w: any) => w && w.name)
    .map((w: any) => ({
      id: String(w.id),
      name: String(w.name),
      reps: String(w.reps || ''),
      kind: (WORKOUT_KINDS.some((k) => k.id === w.kind) ? w.kind : 'workout') as WorkoutKind,
      slot: w.slot === 'secondary' ? 'secondary' : 'primary',
      priority: w.priority === 'normal' ? 'normal' : 'high',
      everyMin: Math.max(15, Number(w.everyMin) || 90),
      segment: String(w.segment || w.group || ''),
      done: (doneMap[w.id] || []).includes(dateKey),
      date: dateKey,
      mediaUrl: w.mediaUrl || '',
      mediaType: w.mediaType || 'image'
    }))
}

export function setWorkoutDone(id: string, done = true, dateKey: string = todayKey()) {
  const map = readDone()
  const list = new Set((map[id] || []).concat(dateKey))
  if (!done) list.delete(dateKey)
  // keep a year of history only
  const cutoff = Date.now() - 372 * 86400000
  map[id] = [...list].filter((d) => new Date(d + 'T12:00:00').getTime() > cutoff).sort()
  localStorage.setItem(HISTORY, JSON.stringify(map))
  // keep the legacy per-segment flag in sync so the Workout page stays consistent
  const segs = readSegments()
  writeSegments(segs.map((s: any) => ({ ...s, workouts: (s.workouts || []).map((w: any) => (String(w.id) === id ? { ...w, completed: done } : w)) })))
  return map[id]
}

export function doneCountFor(dateKey: string = todayKey()): number {
  const map = readDone()
  return Object.values(map).filter((list: any) => Array.isArray(list) && list.includes(dateKey)).length
}

/** How many rows were completed across the last n days — graphs must show real numbers only. */
export function workoutHistory(days = 7): { date: string; done: number; total: number; pct: number }[] {
  const map = readDone()
  const rows = readWorkoutRows()
  const total = rows.length || 0
  const out: { date: string; done: number; total: number; pct: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = localDayOf(new Date(Date.now() - i * 86400000))
    const done = Object.values(map).filter((list: any) => Array.isArray(list) && list.includes(d)).length
    out.push({ date: d, done, total, pct: total ? Math.round((done / total) * 100) : 0 })
  }
  return out
}
