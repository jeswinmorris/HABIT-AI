/**
 * planner.ts — the single source of "what has to happen today, and when".
 *
 * Everything the engine reminds you about is built here from real inputs (your water goal, the
 * weekly drink plan, haircare/skincare weekdays, workout kinds + frequencies, tasks, the day you
 * actually started and your bedtime), then consumed by three places:
 *   • the in-window tick (speech, cards, popups)
 *   • the OS notification scheduler armed through src/lib/desktop.ts (works when hidden/closed)
 *   • the Today priority list and the analytics afterwards
 *
 * Pacing rule (your ask): more than half of the workout — and the primary workout, haircare,
 * skincare and visualization — are pushed into the *first half* of the waking day. Everything
 * else spreads up to bedtime. A paused day re-slots what is left into the remaining window.
 */
import { dayKey, minutesNow, toMinutes, toHHMM, weekdayOf, todayKey, localDayOf, WEEKDAYS, type Weekday } from '../lib/clock'

export type PlanKind =
  | 'drink' | 'water' | 'ritual' | 'visualization' | 'workout-primary' | 'workout-secondary'
  | 'task' | 'daily' | 'midpoint' | 'bedtime'

/** kinds that must never raise a system notification — housekeeping, not a to-do */
export const NO_NOTIFY_KINDS: PlanKind[] = ['midpoint', 'bedtime']

export type PlanItem = {
  id: string
  at: number            // epoch ms
  time: string          // HH:MM local
  kind: PlanKind
  title: string
  body: string
  goTo: string          // tab to open when the notification is clicked
  priority: 'high' | 'normal'
  morning: boolean      // belongs to the first half of the day
  spoken: string        // what the AI says (empty = on-screen only)
}

export type PlanInput = {
  startHHMM: string            // when the day began (or the alarm time before it begins)
  bedtimeHHMM: string
  dayStartedAt?: string | null // ISO of Start the day
  waterGoalMl?: number
  waterSplit?: number
  drinks?: any[]               // habitOS_weeklyDrinks
  ritualTasks?: Record<string, any[]>  // habitOS_ritualTasks { Haircare: [], Skincare: [] }
  workouts?: any[]             // flattened workout rows with kind/slot/priority/everyMin/done
  tasks?: any[]                // today's tasks incl. kind daily/once + tomorrow preview
  vizCount?: number            // visualization slides queued
  activeDays?: string[]        // weekdays the user trains (workout rows are skipped otherwise)
  date?: string
  now?: number
}

const WATERISH = /^(water|plain water|nimbu paani|lemon water|jeer?w?ater|coconut water)$/i

/** Weekday match for a scheduled row (daily / weekdays / 2days / 3days / specific / list). */
function onWeekday(row: any, wd: Weekday): boolean {
  if (Array.isArray(row?.days)) {
    // an explicit list is authoritative: an empty one means "not scheduled"
    return row.days.length ? row.days.includes(wd) : false
  }
  switch (String(row?.frequency || 'daily')) {
    case 'daily': return true
    case 'weekdays': return wd !== 'Sat' && wd !== 'Sun'
    case 'weekend': return wd === 'Sat' || wd === 'Sun'
    case '2days': return ['Mon', 'Wed', 'Fri'].includes(wd)
    case '3days': return ['Mon', 'Thu'].includes(wd)
    case 'specific': return String(row?.day || '').slice(0, 3) === wd
    default: return true
  }
}

/**
 * Local instant for a HH:MM on a given day. A day that runs past midnight (bedtime 02:00 with a
 * 23:40 start) must place those items on the FOLLOWING morning — putting them on "today 00:00"
 * made them 23 hours overdue the moment they were generated.
 */
function epochAt(dateKey: string, hhmm: string, now: number): number {
  const mins = toMinutes(hhmm)
  if (Number.isNaN(mins)) return now
  const [y, m, d] = String(dateKey).split('-').map(Number)
  const build = (dayOffset: number) => {
    const base = new Date(y, (m || 1) - 1, (d || 1) + dayOffset, 0, 0, 0, 0)
    return base.getTime() + mins * 60000
  }
  let t = build(0)
  if (t < now - 12 * 3600000) t = build(1)
  return t
}

/** even spread of n slots inside [from,to) in minutes */
function spread(from: number, to: number, n: number): number[] {
  if (n <= 0) return []
  const span = Math.max(10, to - from)
  const step = span / n
  return Array.from({ length: n }, (_, i) => Math.round(from + step * (i + 0.5)))
}

export function buildDayPlan(input: PlanInput): PlanItem[] {
  const now = input.now ?? Date.now()
  const date = input.date || dayKey(new Date(now))
  const wd = weekdayOf(date)
  const startM = toMinutes(input.startHHMM)
  const bedM = toMinutes(input.bedtimeHHMM)
  const dayStartedMin = input.dayStartedAt && !Number.isNaN(Date.parse(input.dayStartedAt)) ? minutesNow(new Date(input.dayStartedAt)) : startM
  // anchor to whichever came LATER: starting at 22:00 must not create sips timed 06:00
  const from = Math.max(Number.isNaN(startM) ? 0 : startM, dayStartedMin)
  // One continuous axis: minutes since the day started. A 23:48 start with a 02:00 bedtime is a
  // 132-minute day; comparing raw clock numbers (120 < 1428) used to collapse every gap to a
  // minute or two, which is what made the water reminders feel like they fired constantly.
  const span = Number.isNaN(bedM) ? 16 * 60 : (((bedM - from) % 1440) + 1440) % 1440 || 16 * 60
  const bedAbs = from + span
  const midAbs = from + Math.floor(span / 2)
  const DAY_MIN = (mins: number) => (mins % 1440 + 1440) % 1440
  const hhmm = (abs: number) => toHHMM(DAY_MIN(abs))
  /** clock HH:MM -> the next occurrence on or after the day start */
  const absOf = (clockHHMM: string, fallback: number) => {
    const m = toMinutes(clockHHMM)
    if (Number.isNaN(m)) return fallback
    return m >= from ? m : m + 1440
  }
  const items: PlanItem[] = []

  const push = (id: string, absMinutes: number, kind: PlanKind, title: string, body: string, opts: Partial<PlanItem> = {}) => {
    const clamped = Math.max(from, Math.min(bedAbs - 2, Math.round(absMinutes)))
    const atMs = epochAt(date, hhmm(clamped), now)
    items.push({
      id, at: atMs, time: hhmm(clamped), kind, title, body,
      goTo: opts.goTo || 'Today', priority: opts.priority || 'normal', morning: opts.morning ?? clamped < midAbs,
      spoken: opts.spoken ?? `${title}. ${body}`
    })
  }

  /* ---------------- water: the daily goal spread over what is left ---------------- */
  const goal = Math.max(0, Number(input.waterGoalMl) || 0)
  const wantedSplit = Math.max(1, Math.min(12, Number(input.waterSplit) || (goal ? Math.round(goal / 500) : 0)))
  // never schedule sips closer than 20 minutes: a short day means fewer, bigger sips
  const split = goal > 0 ? Math.max(1, Math.min(wantedSplit, Math.floor(span / 20) || 1)) : 0
  if (split > 0) {
    const per = Math.max(50, Math.round(goal / split))
    const slots = spreadAbs(from + 5, bedAbs - 10, split)
    slots.forEach((abs, i) => {
      push(`water:${i}`, abs, 'water', `Water • ${per}ml`, `Sip ${per} ml (${i + 1}/${split} of ${goal} ml)`,
        { goTo: 'Water', spoken: `Water time. ${per} millilitres.` })
    })
  }

  /* ---------------- drinks from the weekly plan ------------------------------- */
  const drinks = (input.drinks || []).filter((d: any) => d.enabled !== false && onWeekday(d, wd))
  const waterDrinks = drinks.filter((d: any) => WATERISH.test(String(d.name || '')))
  const otherDrinks = drinks.filter((d: any) => !WATERISH.test(String(d.name || '')))
  const afterStart = Math.max(from + 5, dayStartedMin + 5)
  for (const d of waterDrinks) {
    push(`drink:${d.id}:${date}`, absOf(d.time || '08:00', from + 15), 'drink', `${d.amount || 300}ml ${d.name}`, `${d.day || 'today'} • ${d.time || hhmm(from + 15)}`,
      { goTo: 'Water', spoken: `Drink ${d.amount || 300} millilitres of ${d.name}.` })
  }
  otherDrinks.forEach((d: any, i: number) => {
    const scheduled = absOf(d.time || '08:00', from + 5)
    const abs = scheduled <= midAbs ? Math.max(scheduled, afterStart) : Math.max(afterStart, from + 5 + i * 10)
    push(`morning-drink:${d.id}:${date}`, abs, 'drink', `${d.amount || 300}ml ${d.name}`, `${d.frequency || 'today'} • after wakeup`,
      { goTo: 'Water', morning: true, spoken: `Have ${d.amount || 300} millilitres of ${d.name}.` })
  })

  /* ---------------- haircare / skincare / visualization: morning block --------- */
  let cursor = from + 5
  for (const tab of ['Haircare', 'Skincare'] as const) {
    const rows = (input.ritualTasks?.[tab] || []).filter((r: any) => onWeekday(r, wd))
    rows.forEach((r: any) => {
      const scheduled = r.time ? absOf(r.time, NaN) : NaN
      const abs = !Number.isNaN(scheduled) && scheduled <= midAbs ? scheduled : Math.min(midAbs - 2, cursor)
      push(`ritual:${tab}:${r.id}:${date}`, abs, 'ritual', `${tab} • ${r.title}`, r.instructions || tab,
        { goTo: 'Rituals', morning: true, spoken: `${tab} time — ${r.title}.` })
      cursor += 5
    })
  }
  const vizN = Number(input.vizCount) || 0
  if (vizN > 0) {
    push(`viz:${date}`, Math.min(midAbs - 2, cursor + 5), 'visualization', 'Visualization', `${vizN} slide(s) queued`,
      { goTo: 'Rituals', morning: true, spoken: 'Visualization time.' })
  }

  /* ---------------- workout ---------------------------------------------------- */
  const trainsToday = !input.activeDays || !input.activeDays.length || (input.activeDays as string[]).includes(wd)
  const workouts = (input.workouts || [])
  const open = workouts.filter((w: any) => !w.done && onWeekday(w, wd)).filter(() => trainsToday)
  const primary = open.filter((w: any) => (w.slot || 'primary') === 'primary')
  const secondary = open.filter((w: any) => w.slot === 'secondary')
  const prio = (w: any) => (w.priority === 'normal' || w.priority === 'low' ? 1 : 0)
  primary.sort((a, b) => prio(a) - prio(b))
  spreadAbs(from + 10, midAbs - 5, Math.max(1, primary.length)).forEach((abs, i) => {
    if (i >= primary.length) return
    const w = primary[i]
    push(`wk-primary:${w.id}:${date}`, abs, 'workout-primary', `${w.kind ? w.kind + ' • ' : ''}${w.name}`, w.reps || 'primary session',
      { goTo: 'Workout', morning: true, priority: prio(w) === 0 ? 'high' : 'normal', spoken: `Workout — ${w.name}. ${w.reps || ''}` })
  })
  secondary.forEach((w: any) => {
    const every = Math.max(15, Math.min(600, Number(w.everyMin) || 90))
    let abs = from + Math.round(every / 2)
    let n = 0
    while (abs < bedAbs - 5 && n < Math.min(10, Math.floor(span / every))) {
      push(`wk-sec:${w.id}:${date}:${n}`, abs, 'workout-secondary', `${w.kind ? w.kind + ' • ' : ''}${w.name}`, `every ${every} min`,
        { goTo: 'Workout', priority: 'normal', spoken: `Quick set — ${w.name}.` })
      abs += every
      n++
    }
  })

  /* ---------------- tasks ----------------------------------------------------- */
  const timed = (input.tasks || []).filter((t: any) => !t.doneAt && t.reminderAt)
  for (const t of timed) {
    const d = new Date(t.reminderAt)
    const abs = minutesNow(d)
    const on = abs >= from ? abs : abs + 1440
    if (on > bedAbs) continue
    push(`task:${t.id}`, on, 'task', t.title, t.kind === 'daily' ? 'daily task' : 'scheduled task',
      { goTo: 'Tasks', priority: t.priority === 'high' ? 'high' : 'normal', spoken: `Task — ${t.title}.` })
  }
  const untimed = (input.tasks || []).filter((t: any) => !t.reminderAt)
  const taskSlots = spreadAbs(Math.max(from + 15, dayStartedMin + 15), bedAbs - 10, Math.max(1, untimed.length))
  untimed.forEach((t: any, i: number) => {
    push(`task:${t.id}`, taskSlots[i] ?? midAbs, 'task', t.title, t.kind === 'daily' ? 'daily task' : 'to do',
      { goTo: 'Tasks', priority: t.priority === 'high' ? 'high' : 'normal', spoken: `To do — ${t.title}.` })
  })

  /* ---------------- milestones ------------------------------------------------ */
  push('midpoint', midAbs, 'midpoint', 'Half of the day is gone', 'More than half of the morning set should be finished',
    { goTo: 'Today', priority: 'high', morning: false, spoken: '' })
  push('bedtime', bedAbs - 20, 'bedtime', 'Wind down', `Day closes at ${input.bedtimeHHMM}`, { goTo: 'Sleep', morning: false, spoken: '' })

  return items.filter((i) => Number.isFinite(i.at)).sort((a, b) => a.at - b.at)
}

/** even spread of n points on the continuous minutes-since-midnight axis */
function spreadAbs(fromAbs: number, toAbs: number, n: number): number[] {
  if (n <= 0) return []
  const window = Math.max(10, toAbs - fromAbs)
  const step = window / n
  return Array.from({ length: n }, (_, i) => Math.round(fromAbs + step * (i + 0.5)))
}

export type PlanSummary = {
  total: number
  done: number
  open: PlanItem[]
  morningOpen: PlanItem[]
  workoutTotal: number
  workoutDone: number
  midpointISO: string
  pastMidpoint: boolean
}

export function summarizePlan(plan: PlanInput | null | undefined, items: PlanItem[], firedDone: Set<string>): PlanSummary {
  const now = plan?.now ?? Date.now()
  const open = items.filter((i) => !firedDone.has(i.id))
  const startM = toMinutes(plan?.startHHMM || '06:00')
  const bedM = toMinutes(plan?.bedtimeHHMM || '22:00')
  const span = bedM > startM ? bedM - startM : bedM + 1440 - startM
  const midpoint = (startM + Math.floor(span / 2)) % 1440
  const workoutTotal = items.filter((i) => i.kind === 'workout-primary').length
  const workoutDone = items.filter((i) => i.kind === 'workout-primary' && firedDone.has(i.id)).length
  return {
    total: items.length,
    done: items.length - open.length,
    open,
    morningOpen: open.filter((i) => i.morning && i.at > now),
    workoutTotal,
    workoutDone,
    midpointISO: toHHMM(midpoint),
    pastMidpoint: minutesNow(new Date(now)) >= midpoint
  }
}

/** Things still open after this moment, ordered by when they land — the voice recap. */
/** Items the day still owes. `doneIds` is genuine completion only — being announced out loud
 * does not finish a task, and never did again after the drip fix. */
export function pendingItems(items: PlanItem[], firedIds: Set<string> | string[], now = Date.now()): PlanItem[] {
  const done = firedIds instanceof Set ? firedIds : new Set((firedIds || []).map(String))
  return items
    .filter((i) => !done.has(i.id) && i.kind !== 'midpoint' && i.kind !== 'bedtime')
    .sort((a, b) => a.at - b.at)
}

/** One spoken sentence: what is left, and when. Capped so it stays listenable. */
export function pendingVoiceLine(items: PlanItem[], firedIds: Set<string> | string[], now = Date.now(), limit = 4): string {
  const open = pendingItems(items, firedIds, now)
  if (!open.length) return 'Nothing left on the day plan. You are clear.'
  const sayTime = (i: PlanItem) => {
    const mins = Math.round((i.at - now) / 60000)
    if (mins <= 1) return 'now'
    if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`
    if (mins < 120) return 'in about an hour'
    return `at ${i.time}`
  }
  const head = open.slice(0, limit).map((i) => `${i.title} ${sayTime(i)}`).join(', ')
  const more = open.length > limit ? `, and ${open.length - limit} more` : ''
  return `Still pending today: ${open.length} item${open.length === 1 ? '' : 's'} — ${head}${more}.`
}

/** Same list for the screen. */
export function pendingScreenList(items: PlanItem[], firedIds: Set<string> | string[], now = Date.now()) {
  return pendingItems(items, firedIds, now).slice(0, 8).map((i) => ({ id: i.id, time: i.time, title: i.title, kind: i.kind, priority: i.priority, goTo: i.goTo, late: i.at < now }))
}

/** Items the OS should notify about (nothing older than a couple of minutes). */
export function toArmable(items: PlanItem[], now = Date.now()) {
  // only genuinely future items go to the OS: an overdue backlog would burst-fire the instant
  // the app is re-focused, which reads as notification spam
  return items
    .filter((i) => i.at > now + 30000)
    .slice(0, 48)
    .filter((i) => !NO_NOTIFY_KINDS.includes(i.kind))
    .map((i) => ({ id: `plan:${i.id}`, at: i.at, title: `HABIT.AI — ${i.title}`, body: i.body, go: i.goTo }))
}

export type ArmOptions = {
  alarmTime?: string
  alarmEnabled?: boolean
  dayPhase?: string
  shortAlarms?: { id: string; label?: string; time: string; fireAt?: string; status?: string }[]
}

/**
 * Everything the operating system should wake you for: the day plan, the one-time
 * alarms from the Sleep page, and the wake alarm on the mornings where the day has
 * not been started yet. Built in one place so hidden-window and open-window
 * behaviour can never drift apart.
 */
export function buildArmedList(items: PlanItem[], opts: ArmOptions = {}, now = Date.now()): ReturnType<typeof toArmable> {
  const list = toArmable(items, now)
  const date = dayKey(new Date(now))
  for (const a of opts.shortAlarms || []) {
    if (a.status !== 'pending') continue
    const at = a.fireAt ? Date.parse(a.fireAt) : NaN
    if (Number.isFinite(at) && at > now - 60000) list.push({ id: `short:${a.id}`, at, title: `HABIT.AI — ${a.label || 'Alarm'}`, body: new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), go: 'Sleep' })
  }
  if (opts.alarmEnabled !== false && opts.alarmTime && (opts.dayPhase === 'unstarted' || opts.dayPhase === 'snoozed')) {
    const at = epochAt(date, opts.alarmTime, now)
    if (at > now - 60000 && !list.some((i) => i.at === at)) list.push({ id: `wake:${date}`, at, title: 'HABIT.AI — Wake up', body: `${opts.alarmTime} • stop or snooze the alarm`, go: 'Today' })
  }
  return list.sort((x, y) => x.at - y.at).slice(0, 60)
}

/**
 * After a paused day, the first-half work has to land in whatever time is left:
 * spread every un-fired morning item between now and the old midpoint (or bedtime if
 * the midpoint already passed).
 */
export function reslotMorningItems(items: PlanItem[], resumeAtMs: number, bedtimeHHMM: string): PlanItem[] {
  const now = resumeAtMs
  const bedM = toMinutes(bedtimeHHMM)
  const date = dayKey(new Date(now))
  const bedAt = epochAt(date, toHHMM(bedM), now)
  const pending = items.filter((i) => i.morning && i.at > now - 60000)
  if (!pending.length) return items
  const window = Math.max(20 * 60000, Math.max(0, bedAt - now))
  const step = window / (pending.length + 1)
  const moved = new Map(pending.map((i, n) => [i.id, now + step * (n + 1)]))
  return items.map((i) => (moved.has(i.id) ? { ...i, at: moved.get(i.id)!, time: toHHMM(minutesNow(new Date(moved.get(i.id)!))) } : i))
    .sort((a, b) => a.at - b.at)
}

/** Human one-liner about where the day stands. */
export function planStatusLine(summary: PlanSummary): string {
  const pct = summary.total ? Math.round((summary.done / summary.total) * 100) : 0
  const workout = summary.workoutTotal ? `Workout ${Math.round((summary.workoutDone / summary.workoutTotal) * 100)}% done.` : ''
  const late = summary.pastMidpoint && summary.morningOpen.length
    ? ` ${summary.morningOpen.length} first-half item(s) still open.`
    : ''
  return `${pct}% of the day plan done. ${workout}${late}`.trim()
}

export { onWeekday, WATERISH }
