import { writeStorage, readStorage } from '../lib/db'
import { dayKey, addDaysKey as clockAddDays, dayIndexOf as clockDayIndex, localDayOf } from '../lib/clock'
import { readSteaks as readSteaksFromFlow, steakDueOnWeekday } from './dayFlow'
// src/core/dayController.ts - FINAL v4.2
// Real pause/resume: pauses table, isPaused() gate read by every engine
// (reminders, alarms, voice, notifications), missed-steak catch-up on resume,
// and PRD adherence = Completed / (Total - Skipped - Paused).

export type SkipEntry = {
  id: string
  streakId: string
  days: number
  reason: string
  startDate: string
  endDate: string
  createdAt: string
  type: 'skip'
}

export type PauseEntry = {
  id: string
  date: string
  startTime: string
  endTime?: string
  active: number
}

export let dayController = (() => {
  const V4 = 'habitOS_v4_final'

  const read = (): any => {
    try { return JSON.parse(readStorage(V4, '{}')) } catch { return {} }
  }
  const write = (patch: any) => {
    try {
      const cur = read()
      writeStorage(V4, JSON.stringify({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }))
    } catch {}
  }

  // local calendar day (was UTC-based in places, which shifted "today" for IST users)
  const todayKey = () => dayKey()
  const addDaysKey = (key: string, n: number) => clockAddDays(key, n)

  function pauseDay() {
    const st = read()
    if (st.dayPaused) return { dayPaused: true }
    const now = new Date().toISOString()
    const pauses: PauseEntry[] = (st.pauses || []).map((p: any) => ({ ...p, active: 0 }))
    pauses.push({ id: Date.now().toString(), date: todayKey(), startTime: now, active: 1 })
    write({ dayPaused: true, pauseAt: now, pauses })
    return { dayPaused: true, pauseAt: now }
  }

  function resumeDay() {
    const st = read()
    const open = (st.pauses || []).find((p: any) => p.active === 1)
    const now = new Date().toISOString()
    const pauses = (st.pauses || []).map((p: any) => (p.active === 1 ? { ...p, active: 0, endTime: now } : p))
    const missed: { streakId: string; name: string; dates: string[] }[] = []

    if (open) {
      // every steak without a check-in between pause start and resume day
      const startDay = localDayOf(open.startTime || open.date)
      const steaks: any[] = readSteaks()
      const logs: any[] = (st.dailyLogs || []).concat(customLogs())
      for (const s of steaks) {
        const dates: string[] = []
        let dk = startDay
        while (dk <= todayKey()) {
          const logged = logs.some((l) => l.streakId === s.id && localDayOf(l.date) === dk)
          const skipped = (st.skips || []).some((k: SkipEntry) => k.streakId.toLowerCase() === String(s.id).toLowerCase() && dk >= localDayOf(k.startDate) && dk <= localDayOf(k.endDate))
          const pausedDay = dk === startDay
          if (!logged && !skipped && !pausedDay) dates.push(dk)
          dk = addDaysKey(dk, 1)
        }
        if (dates.length) missed.push({ streakId: s.id, name: s.name, dates })
      }
    }
    // recompute today's pending catch-up (what is STILL open right now counts toward the plan)
    const pendingNow = pendingSteaks().filter((p) => missed.some((m) => m.streakId === p.id))
    const plan = pendingNow.map((p, i) => ({ id: Date.now().toString() + '-' + i, streakId: p.id, name: p.name }))
    write({ dayPaused: false, resumeAt: now, pauses, catchUp: plan })
    return { dayPaused: false, resumeAt: now, missed: plan }
  }

  function readSteaks(): any[] { return readSteaksFromFlow() }

  // dailyLogs written by TodayView check-ins (streakId + date)
  function customLogs(): any[] {
    return read().dailyLogs || []
  }

  /** steaks (grid habits) that are NOT checked-in / skipped / complete today */
  function pendingSteaks(): { id: string; name: string }[] {
    const st = read()
    const today = todayKey()
    const out: { id: string; name: string }[] = []
    for (const s of readSteaks()) {
      if (!steakDueOnWeekday(s)) continue // weekday-specific steak: not today's problem
      const total = s.total || 1
      const completed: number[] = Array.isArray(s.completed) ? s.completed : []
      if (completed.length >= total) continue // steak finished for good
      const createdAt = localDayOf(s.createdAt)
      if (today < createdAt) continue
      const dayIdx = dayIndexOf(createdAt, today)
      const doneToday = completed.includes(dayIdx) || (st.dailyLogs || []).some((l: any) => l.streakId === s.id && localDayOf(l.date) === today)
      const skipped = (st.skips || []).some((k: SkipEntry) => k.streakId.toLowerCase() === String(s.id).toLowerCase() && today >= localDayOf(k.startDate) && today <= localDayOf(k.endDate))
      if (!doneToday && !skipped) out.push({ id: s.id, name: s.name })
    }
    return out
  }

  function dayIndexOf(createdAtKey: string, todayKeyStr: string) {
    return clockDayIndex(createdAtKey, todayKeyStr)
  }

  function isPaused(): boolean {
    return !!read().dayPaused
  }

  /** The wake alarm can be switched off without forgetting its time. */
  function alarmEnabled(): boolean {
    return read().alarmEnabled !== false
  }

  function pauseInfo(): { since?: string; durationMin: number } {
    const st = read()
    if (!st.dayPaused || !st.pauseAt) return { durationMin: 0 }
    return { since: st.pauseAt, durationMin: Math.round((Date.now() - new Date(st.pauseAt).getTime()) / 60000) }
  }

  // ---------- skips (modal writes through the store, this reads truth) ----------
  function createSkip(streakId: string, days: number, reason: string): SkipEntry {
    const start = new Date()
    const end = new Date()
    end.setDate(start.getDate() + days)
    return {
      id: Date.now().toString(),
      streakId,
      days,
      reason,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      createdAt: start.toISOString(),
      type: 'skip'
    }
  }

  function isSkipped(streakId: string, when: Date = new Date()): SkipEntry | null {
    const st = read()
    const key = dayKey(when)
    return (st.skips || []).find((s: SkipEntry) => {
      const same = String(s.streakId).toLowerCase() === String(streakId).toLowerCase()
      const within = key >= localDayOf(s.startDate) && key <= localDayOf(s.endDate)
      return same && within
    }) || null
  }

  function getAdherence(completed: number, total: number, skipped: number): number {
    const denom = total - skipped
    if (denom <= 0) return 100
    return Math.round((completed / denom) * 100)
  }

  /** PRD: Completed / (Total − Skipped − Paused) over trailing `days`. */
  function adherence30(days = 30): number {
    const st = read()
    const today = todayKey()
    const steaks = readSteaks()
    let required = 0
    let done = 0
    for (let i = 0; i < days; i++) {
      const dk = addDaysKey(today, -i)
      for (const s of steaks) {
        const createdAt = localDayOf(s.createdAt || dk)
        if (dk < createdAt) continue
        if (isSkipped(s.id, new Date(dk + 'T12:00:00'))) continue
        if ((st.pauses || []).some((p: any) => String(p.date || '').slice(0, 10) === dk)) continue
        required++
        const completed: number[] = Array.isArray(s.completed) ? s.completed : []
        const loggedDay = (st.dailyLogs || []).some((l: any) => l.streakId === s.id && localDayOf(l.date) === dk)
        const dayDone = loggedDay || completed.includes(dayIndexOf(createdAt, dk))
        if (dayDone) done++
      }
    }
    return required === 0 ? 0 : Math.round((done / required) * 100)
  }

  return {
    pauseDay,
    resumeDay,
    isPaused,
    alarmEnabled,
    pauseInfo,
    createSkip,
    isSkipped,
    getAdherence,
    adherence30,
    pendingSteaks,
    readSteaks,
    customLogs,
    todayKey,
    addDaysKey,
    dayIndexOf
  }
})()

export default dayController
