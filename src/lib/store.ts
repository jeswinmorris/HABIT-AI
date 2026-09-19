/**
 * store.ts — the only safe way to read a collection out of localStorage.
 *
 * Every habit collection lives under a `habitOS_` key, and the day report, the water page and
 * the reminder planner all assume those keys hold arrays or plain objects. They are allowed to be
 * absent (fresh install, "Clean data") or to contain garbage (a half-written value, an older
 * build that stored `{}`), so each reader validates the shape instead of trusting it.
 *
 * The crash this file exists for: `JSON.parse(localStorage.getItem(k) || '{}')` and then
 * `.filter(...)` — a missing `habitOS_waterLogs` came back as an object and killed the Sleep page.
 */

export function readRaw(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

/** Array collection; missing or wrong-shaped storage never throws at the caller. */
export function readArray<T = any>(key: string, fallback: T[] = []): T[] {
  const raw = readRaw(key)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : fallback
  } catch {
    return fallback
  }
}

/** Plain-object map (task completion, workout day lists, ritual tasks…). */
export function readRecord<T = any>(key: string, fallback: Record<string, T> = {}): Record<string, T> {
  const raw = readRaw(key)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, T>) : fallback
  } catch {
    return fallback
  }
}

/** Single scalar kept as JSON (schema marks, day marks). */
export function readNumber(key: string, fallback = 0): number {
  const raw = readRaw(key)
  if (!raw) return fallback
  try {
    const n = JSON.parse(raw)
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback
  } catch {
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  }
}

/** Write helpers that never throw and keep the habitOS_ mirror in sync via lib/db. */
export function writeArray(key: string, list: any[]): void {
  try { localStorage.setItem(key, JSON.stringify(Array.isArray(list) ? list : [])) } catch {}
}
export function writeRecord(key: string, map: Record<string, any>): void {
  try { localStorage.setItem(key, JSON.stringify(map && typeof map === 'object' ? map : {})) } catch {}
}
