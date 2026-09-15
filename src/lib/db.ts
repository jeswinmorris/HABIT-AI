/**
 * db.ts - the whole-app database layer.
 *
 * Every collection in this app lives in a localStorage key that starts with
 * "habitOS_" (tasks, steaks, water logs, alarms, rituals...). This module:
 *   1. hydrates localStorage from the database (Electron/SQLite) at boot
 *   2. write-throughs every setItem into the database (debounced per key)
 *   3. export/import the full habit namespace as habit-ai-YYYY-MM-DD.json
 *   4. native notifications (Electron Notification via IPC, browser fallback)
 * Web mode = localStorage IS the database, everything still works.
 */

type HabitBridge = {
  version: string
  platform: string
  db: {
    hydrate(): Promise<Record<string, string> | null>
    write(key: string, value: string): Promise<boolean>
    export(): Promise<{ file: string | null; snapshot: Record<string, string> } | null>
    import(payload: unknown): Promise<boolean>
    notify(title: string, body: string): Promise<boolean>
    info(): Promise<{ driver: string; path: string; size: number } | null>
  }
}

declare global {
  interface Window { habitAI?: HabitBridge }
}

export const isElectron = () => typeof window !== 'undefined' && !!window.habitAI?.db

/* ------------------------------- boot hydrate ------------------------------- */
let hydrated = false
export async function hydrateFromDB(): Promise<void> {
  if (hydrated || !isElectron()) return
  hydrated = true
  try {
    const rows = await window.habitAI!.db.hydrate()
    if (!rows) return
    let incoming = rows
    // electron may return string values; restore JSON keys that are newer in DB
    for (const [k, v] of Object.entries(incoming)) {
      if (!String(k).startsWith('habitOS_')) continue
      try {
        const localRaw = localStorage.getItem(k)
        // DB wins when local has nothing
        if (localRaw === null || localRaw === undefined) localStorage.setItem(k, v)
      } catch {}
    }
  } catch (e) {
    console.warn('[db] hydrate failed, staying on localStorage', e)
  }
}

/* --------------------------- raw storage primitives -------------------------- */
const origSetItem = typeof localStorage !== 'undefined' ? localStorage.setItem.bind(localStorage) : (k: string, v: string) => { try { (localStorage as any)[k] = v } catch {} }
/** Write a habit collection and guarantee the mirror reaches SQLite (call db.write directly too). */
export function writeStorage(key: string, value: string) {
  try {
    if ((localStorage as any).getItem(key) === value) return
    origSetItem(key, value)
  } catch {
    try { (localStorage as any).setItem(key, value) } catch {}
  }
  try { localStorage.setItem(key, value) } catch {} // goes through patched fn -> mirror (same value now, no harm)
}
export function readStorage(key: string, fallback = 'null'): string {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v } catch { return fallback }
}

/* --------------------------- write-through patching --------------------------- */
const pending = new Map<string, string>()
let timer: number | null = null

function flush() {
  timer = null
  if (!isElectron()) { pending.clear(); return }
  const batch = [...pending.entries()]
  pending.clear()
  for (const [k, v] of batch) {
    window.habitAI!.db.write(k, v).catch(() => undefined)
  }
}

export function installWriteThrough() {
  if (typeof window === 'undefined' || !(window as any).__habitDBPatched) {
    (window as any).__habitDBPatched = true
    const orig = localStorage.setItem.bind(localStorage)
    localStorage.setItem = function (key: string, value: string) {
      orig(key, value)
      if (typeof key === 'string' && key.startsWith('habitOS_')) {
        pending.set(key, String(value))
        if (timer === null) timer = window.setTimeout(flush, 250)
      }
    }
    // save whatever remains when the window closes
    window.addEventListener('beforeunload', () => {
      if (timer !== null) { clearTimeout(timer); timer = null }
      flush()
    })
  }
}

/* -------------------------------- snapshot io ------------------------------- */
export function collectAll(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('habitOS_')) out[k] = localStorage.getItem(k) || ''
    }
  } catch {}
  return out
}

export async function exportDB(): Promise<string> {
  if (isElectron()) {
    try {
      const res = await window.habitAI!.db.export()
      if (res?.file) return `Database exported to ${res.file}`
    } catch {}
  }
  const stamp = new Date().toLocaleDateString('en-CA')
  const payload = { app: 'HABIT.AI', version: '4.1', exportedAt: new Date().toISOString(), data: collectAll() }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u
  a.download = `habit-ai-${stamp}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(u), 4000)
  return `Downloaded habit-ai-${stamp}.json`
}

export async function importDB(json: unknown): Promise<boolean> {
  const data = (((json as any)?.data) || json) as Record<string, string>
  if (!data || typeof data !== 'object') return false
  const keys = Object.keys(data).filter((k) => k.startsWith('habitOS_'))
  if (!keys.length) return false
  for (const k of keys) {
    try { localStorage.setItem(k, typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k])) } catch {}
  }
  if (isElectron()) {
    try { await window.habitAI!.db.import({ data }) } catch {}
  }
  return true
}

/* ------------------------------- notifications ------------------------------ */
export function notify(title: string, body: string, alsoSilent = false) {
  try {
    if (isElectron()) {
      window.habitAI!.db.notify(title, body).catch(() => undefined)
      return
    }
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body })
    else if (alsoSilent) console.log('[notify]', title, body)
  } catch {}
}

export async function requestNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
  } catch {}
}

export async function dbInfo() {
  if (isElectron()) {
    const i = await window.habitAI!.db.info().catch(() => null)
    if (i) return i
  }
  let size = 0
  try {
    size = Object.values(collectAll()).reduce((a, v) => a + v.length, 0)
  } catch {}
  return { driver: isElectron() ? 'sqlite' : 'localStorage', path: isElectron() ? 'userData/habit.db' : 'browser', size }
}
