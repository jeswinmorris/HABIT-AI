/**
 * dayFlow.ts — the day's phase machine + the morning briefing.
 *
 * The day no longer "begins" when a timer happens to strike 08:00. Nothing (steaks,
 * reminders, affirmations, workout nudges, music) runs until you stop the alarm and
 * press / say "Start the day", and everything stops at "End day" / bedtime. That fixes
 * the old behaviour where reminders nagged you while you were still asleep and steaks
 * were treated as missed before the day had even begun.
 *
 * Phases:  unstarted -> (alarm ringing) -> briefing -> active -> ended
 *                               |-> snoozed -> back to alarm at fire time
 */
import { dayKey, todayKey, tomorrowKey, weekdayOf, localDayOf, dayIndexOf, WEEKDAYS, type Weekday } from '../lib/clock'
import { readStorage, writeStorage } from '../lib/db'

export type Phase = 'unstarted' | 'snoozed' | 'ringing' | 'briefing' | 'active' | 'ended'

const V4 = 'habitOS_v4_final'
function read(): any { try { return JSON.parse(readStorage(V4, '{}')) } catch { return {} } }
function write(patch: any) {
  const cur = read()
  writeStorage(V4, JSON.stringify({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }))
}

export type DayRecord = { phase: Phase; day: string; startedAt: string | null; alarmClosedAt: string | null; endedAt: string | null; snoozeUntil: number | null }

const emptyDay = (): DayRecord => ({ phase: 'unstarted', day: todayKey(), startedAt: null, alarmClosedAt: null, endedAt: null, snoozeUntil: null })

/** Reads the day, and self-heals across a midnight crossing (the clock is the boss). */
export function dayRecord(): DayRecord {
  const st = read()
  const raw: DayRecord = { ...emptyDay(), ...(st.day || {}) }
  const today = todayKey()
  if (raw.day !== today) {
    // A new calendar day arrived while the app slept: yesterday is closed, today has not started.
    const fresh = emptyDay()
    write({ day: fresh, dayPaused: false })
    return fresh
  }
  return raw
}

export function setDay(patch: Partial<DayRecord>): DayRecord {
  const cur = dayRecord()
  const next = { ...cur, ...patch, day: todayKey() }
  write({ day: next })
  return next
}

export const phase = (): Phase => dayRecord().phase
export const isDayActive = (): boolean => dayRecord().phase === 'active'
export const isDayOver = (): boolean => dayRecord().phase === 'ended'

/** The window every reminder/nudge must respect: after Start-day, before End-day/bedtime. */
export function inAwakeWindow(bedtime = '22:00', at = new Date()): boolean {
  const rec = dayRecord()
  if (rec.phase !== 'active') return false
  const mins = at.getHours() * 60 + at.getMinutes()
  const bed = /^(\d{1,2}):(\d{2})$/.exec(bedtime || '')
  if (bed) {
    const bedMins = Number(bed[1]) * 60 + Number(bed[2])
    // bedtime is the hard stop; also covers a start after midnight in a late-night session
    if (mins > bedMins && rec.startedAt && String(rec.startedAt).slice(0, 10) === dayKey(at)) return false
  }
  return true
}

/** Called when you kill the alarm — the voice briefing is shown, then day can start. */
export function markAlarmClosed(): DayRecord {
  return setDay({ phase: 'briefing', alarmClosedAt: new Date().toISOString(), snoozeUntil: null })
}
export function markSnoozed(untilMs: number): DayRecord {
  return setDay({ phase: 'snoozed', snoozeUntil: untilMs })
}
export function startDay(): DayRecord {
  const cur = dayRecord()
  return setDay({ phase: 'active', startedAt: cur.startedAt || new Date().toISOString(), snoozeUntil: null })
}
export function endDay(): DayRecord {
  return setDay({ phase: 'ended', endedAt: new Date().toISOString() })
}
/** How long the day has been running, for "not before X minutes" nudge rules. */
export function activeMinutes(at = Date.now()): number {
  const { startedAt } = dayRecord()
  if (!startedAt) return 0
  return Math.max(0, Math.round((at - new Date(startedAt).getTime()) / 60000))
}

/* ------------------------------- data readers ------------------------------- */
export function readSteaks(): any[] {
  try {
    const raw = JSON.parse(readStorage('habitOS_streaks', 'null'))
    if (Array.isArray(raw)) return raw
    const legacy = JSON.parse(readStorage('habitOS_streaksCustom', 'null'))
    return Array.isArray(legacy) ? legacy : []
  } catch { return [] }
}

/** A steak can be every day or specific weekdays (default: every day). */
export function steakWeekdays(s: any): Weekday[] {
  const list = Array.isArray(s?.days) && s.days.length ? s.days : [...WEEKDAYS]
  return list.filter((d: string) => (WEEKDAYS as readonly string[]).includes(d)) as Weekday[]
}
export function steakDueOnWeekday(s: any, weekday: Weekday = weekdayOf()): boolean {
  return steakWeekdays(s).includes(weekday)
}

export function tasksOn(dateKey: string = todayKey()): any[] {
  let list: any[] = []
  try { list = JSON.parse(readStorage('habitOS_tasks', '[]')) } catch { list = [] }
  const rank = { high: 0, normal: 1, medium: 1, low: 2 } as Record<string, number>
  return list
    .filter((t: any) => String(t.date || '') === dateKey)
    .slice()
    .sort((a: any, b: any) => {
      const byStatus = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)
      if (byStatus) return byStatus
      const byPriority = (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)
      if (byPriority) return byPriority
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    })
}

/** Prayer / Affirmations / Visualization get a plain "done for today" tick, stored as a log. */
export function ritualDoneToday(key: string, logs?: any[]): boolean {
  const today = todayKey()
  try {
    const list: any[] = logs || (JSON.parse(readStorage('habitOS_v4_final', '{}')).dailyLogs || [])
    return list.some((l: any) => String(l.streakId || '').toLowerCase() === key.toLowerCase() && localDayOf(l.date) === today)
  } catch { return false }
}
export function markRitualDone(key: string, done = true) {
  const today = todayKey()
  const st = read()
  const logs: any[] = st.dailyLogs || []
  const isKey = (l: any) => String(l.streakId || '').toLowerCase() === key.toLowerCase() && localDayOf(l.date) === today
  const next = done ? (logs.some(isKey) ? logs : [...logs, { id: `${key}-${today}`, streakId: key.toLowerCase(), date: today, amount: 1 }]) : logs.filter((l: any) => !isKey(l))
  write({ dailyLogs: next })
  return next
}

export type WeeklyDrink = { id: string; frequency: string; day: string; name: string; amount: number; time: string; enabled: boolean }
export function drinksOn(weekday: Weekday = weekdayOf()): WeeklyDrink[] {
  let plan: WeeklyDrink[] = []
  try { plan = JSON.parse(readStorage('habitOS_weeklyDrinks', '[]')) } catch { plan = [] }
  return plan.filter((w) => {
    if (w.enabled === false) return false
    switch (w.frequency) {
      case 'daily': return true
      case 'weekdays': return weekday !== 'Sat' && weekday !== 'Sun'
      case '2days': return ['Mon', 'Wed', 'Fri'].includes(weekday)
      case '3days': return ['Mon', 'Thu'].includes(weekday)
      case 'specific': return (w.day || '').slice(0, 3) === weekday
      default: return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(weekday)
    }
  })
}

export function workoutSlots(): { primary: any[]; secondary: any[] } {
  let segs: any[] = []
  try { segs = JSON.parse(readStorage('habitOS_workoutSegments', '[]')) } catch { segs = [] }
  const all = segs.flatMap((s: any) => (s.workouts || []).map((w: any) => ({ ...w, segment: s.name })))
  return {
    primary: all.filter((w: any) => (w.slot || 'primary') === 'primary' && !w.completed),
    secondary: all.filter((w: any) => w.slot === 'secondary' && !w.completed)
  }
}

/* -------------------------------- the briefing ------------------------------- */
export type BriefingSection = { key: string; label: string; lines: string[]; empty: string }
export type Briefing = { date: string; weekday: Weekday; sections: BriefingSection[]; spoken: string; counts: Record<string, number> }

/**
 * "What do I actually have to do today?" — assembled from the steak list, the water
 * weekly plan, today's tasks, projects and the workout split, filtered by real weekday.
 * Runs after the alarm is closed and before the morning music starts.
 */
export function buildBriefing(opts: { alarmTime?: string; bedtime?: string; projects?: any[] } = {}): Briefing {
  const today = todayKey()
  const weekday = weekdayOf(today)
  const steaks = readSteaks()
  const dueSteaks = steaks.filter((s: any) => !s.archived && steakDueOnWeekday(s, weekday))
  const openSteaks = dueSteaks.filter((s: any) => {
    const total = s.total || 1
    const completed: number[] = Array.isArray(s.completed) ? s.completed : []
    if (completed.length >= total) return false
    const idx = dayIndexOf(localDayOf(s.createdAt || today), today)
    return !completed.includes(idx)
  })
  const water = drinksOn(weekday)
  let waterGoal = 3000
  try { waterGoal = JSON.parse(readStorage('habitOS_waterGoal', '{"amount":3000}')).amount || 3000 } catch {}
  const todays = tasksOn(today)
  const tomorrow = tasksOn(tomorrowKey())
  const { primary } = workoutSlots()
  const projects = (opts.projects || []).filter((p: any) => (p.progress ?? 0) < 100 && p.status !== 'done')

  const sections: BriefingSection[] = [
    {
      key: 'steaks',
      label: `Steaks • ${weekday}`,
      lines: dueSteaks.map((s: any) => `${(s.completed || []).length}/${s.total} ${s.name}${openSteaks.includes(s) ? '' : ' ✓'}`),
      empty: 'No steaks scheduled for a ' + weekday
    },
    {
      key: 'water',
      label: `Water • target ${waterGoal}ml`,
      lines: water.length ? water.map((w) => `${w.time} • ${w.amount}ml ${w.name}`) : [`Plain water through the day • ${waterGoal}ml`],
      empty: 'No weekly drink plan'
    },
    {
      key: 'tasks',
      label: `To do • ${todays.length}`,
      lines: todays.map((t: any) => `${t.title}${t.priority === 'high' ? ' (high)' : ''}${t.time ? ` @${t.time}` : ''}${t.status === 'done' ? ' — done' : ''}`),
      empty: 'Nothing on the list yet — add tomorrow’s tasks any time'
    },
    {
      key: 'projects',
      label: `Projects • ${projects.length}`,
      lines: projects.map((p: any) => `${p.name} • ${p.progress ?? 0}%${p.deadline ? ` • due ${p.deadline}` : ''}`),
      empty: 'No open projects'
    },
    {
      key: 'workout',
      label: `Primary workout • after prayers + affirmations`,
      lines: primary.map((w: any) => `${w.name} • ${w.reps || w.segment || ''}`),
      empty: 'Mark at least one session as Primary in Workout'
    }
  ]

  const spokenBits = [
    `Good morning. It is ${weekday}, ${today}.`,
    openSteaks.length ? `${openSteaks.length} steaks on the board today: ${openSteaks.slice(0, 4).map((s: any) => s.name).join(', ')}.` : 'No steaks open today.',
    `Water plan: ${water.length ? water.map((w) => `${w.amount} millilitres of ${w.name} at ${w.time}`).join(', ') : waterGoal + ' millilitres of water through the day.'}.`,
    todays.length ? `Today's to do: ${todays.filter((t: any) => t.status !== 'done').slice(0, 5).map((t: any) => t.title).join(', ')}.` : "Today's list is empty.",
    tomorrow.length ? `Queued for tomorrow: ${tomorrow.slice(0, 4).map((t: any) => t.title).join(', ')}.` : '',
    projects.length ? `${projects.length} projects in flight. ${projects.slice(0, 2).map((p: any) => `${p.name} at ${p.progress ?? 0} percent`).join(', ')}.` : '',
    primary.length ? `Then prayer, affirmations, and your primary workout — ${primary.slice(0, 2).map((w: any) => w.name).join(', ')}.` : ''
  ].filter(Boolean)

  return { date: today, weekday, sections, spoken: spokenBits.join(' '), counts: { steaks: openSteaks.length, water: water.length, tasks: todays.length, projects: projects.length, workout: primary.length } }
}
