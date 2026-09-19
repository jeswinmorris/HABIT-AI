/**
 * desktop.ts — one façade over "the operating system".
 *
 * Notifications and timers are owned by the Electron main process (electron/main.cjs) so they
 * keep firing while HABIT.AI sits in the tray or has been closed. In a plain browser (npm run
 * dev without Electron) the same API falls back to in-page timers + the Web Notification API,
 * so nothing downstream needs to know which mode it is in.
 */
import { notify } from './db'

type Armable = { id: string; at: number; title: string; body?: string; go?: string | null }

type Bridge = {
  platform: string
  reminders: {
    arm(list: Armable[]): Promise<any>
    clear(): Promise<boolean>
    status(): Promise<{ supported: boolean; backgroundMode: boolean; pending: number; nextAt: number | null }>
    setBackground(on: boolean): Promise<boolean>
    test(title: string, body: string): Promise<boolean>
    onFired(fn: (r: any) => void): () => void
    onClicked(fn: (r: any) => void): () => void
    onMissed(fn: (list: any[]) => void): () => void
    onResync(fn: (p: any) => void): () => void
  }
  files: {
    saveJson(text: string, name?: string): Promise<string | null>
    openJson(): Promise<{ path: string; text: string } | null>
  }
}

const bridge = (): Bridge | null => {
  const w: any = typeof window !== 'undefined' ? window : null
  return w && w.habitAI && w.habitAI.reminders ? w.habitAI : null
}

export const isDesktop = () => !!bridge()
export const platformName = (): string => bridge()?.platform || (typeof navigator !== 'undefined' ? navigator.platform : 'web')

/* -------------------------- browser fallback timers -------------------------- */
const MISS_KEY = 'habitOS_armedReminders'
let browserTimers = new Map<string, ReturnType<typeof setTimeout>>()

function browserArm(list: Armable[]) {
  browserTimers.forEach((t) => clearTimeout(t))
  browserTimers = new Map()
  const now = Date.now()
  try { localStorage.setItem(MISS_KEY, JSON.stringify(list)) } catch {}
  for (const r of list) {
    const delay = r.at - now
    if (delay <= 0) continue
    browserTimers.set(r.id, setTimeout(() => { notify(r.title, r.body || ''); }, delay))
  }
  return { armed: list.length, supported: typeof Notification !== 'undefined', backgroundMode: false }
}
function browserMissed(): Armable[] {
  try {
    const list: Armable[] = JSON.parse(localStorage.getItem(MISS_KEY) || '[]')
    const now = Date.now()
    const missed = list.filter((r) => r.at <= now - 5000)
    return missed
  } catch { return [] }
}

/* --------------------------------- public api -------------------------------- */
export async function armReminders(list: Armable[]) {
  const clean = (list || [])
    .filter((r) => r && r.id && Number.isFinite(r.at))
    .slice(0, 64)
    .map((r) => ({ id: String(r.id), at: Number(r.at), title: String(r.title || 'HABIT.AI'), body: String(r.body || ''), go: r.go || null }))
  const b = bridge()
  if (b) { try { return await b.reminders.arm(clean) } catch { /* fall through */ } }
  return browserArm(clean)
}

export async function clearReminders() {
  const b = bridge()
  if (b) { try { return await b.reminders.clear() } catch { return false } }
  browserTimers.forEach((t) => clearTimeout(t)); browserTimers = new Map()
  try { localStorage.removeItem(MISS_KEY) } catch {}
  return true
}

export async function reminderStatus() {
  const b = bridge()
  if (b) { try { return await b.reminders.status() } catch { /* fall through */ } }
  return { supported: typeof Notification !== 'undefined' && Notification.permission === 'granted', backgroundMode: false, pending: browserTimers.size, nextAt: null }
}

/** Keep the app alive in the tray when the window is closed (Win + macOS). */
export async function setBackgroundMode(on: boolean) {
  const b = bridge()
  if (b) { try { return await b.reminders.setBackground(on) } catch { return false } }
  return false
}

export async function testNotification(title = 'HABIT.AI', body = 'This is a test notification.') {
  const b = bridge()
  if (b) { try { return await b.reminders.test(title, body) } catch { return false } }
  notify(title, body)
  return true
}

/** Fired while open, missed after a relaunch, clicked for navigation, resync after sleep. */
export function onReminderEvents(h: {
  fired?: (r: any) => void
  clicked?: (r: any) => void
  missed?: (list: any[]) => void
  resync?: (p: any) => void
}): () => void {
  const offs: Array<() => void> = []
  const b = bridge()
  if (b) {
    if (h.fired) offs.push(b.reminders.onFired(h.fired))
    if (h.clicked) offs.push(b.reminders.onClicked(h.clicked))
    if (h.missed) offs.push(b.reminders.onMissed(h.missed))
    if (h.resync) offs.push(b.reminders.onResync(h.resync))
  } else {
    if (h.missed) { const m = browserMissed(); if (m.length) setTimeout(() => h.missed!(m), 800) }
  }
  return () => offs.forEach((off) => { try { off() } catch {} })
}

/** Native "Save As" on desktop, anchor download in the browser. Returns the path or null. */
export async function saveJsonBackup(payload: unknown, name?: string): Promise<string | null> {
  const text = JSON.stringify(payload, null, 2)
  const b = bridge()
  if (b) { try { return await b.files.saveJson(text, name) } catch { /* fall through */ } }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name || 'habit-ai-backup'}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'downloaded'
}

export async function pickJsonBackup(): Promise<{ path: string; data: unknown } | null> {
  const b = bridge()
  if (b) {
    const res = await b.files.openJson().catch(() => null)
    if (!res?.text) return null
    try { return { path: res.path, data: JSON.parse(res.text) } } catch { return null }
  }
  return null
}
