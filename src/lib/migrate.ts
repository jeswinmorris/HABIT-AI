/**
 * migrate.ts — one-time clean-slate pass.
 *
 * Older builds shipped placeholder rows (a Chest segment with 20 pushups, two demo projects,
 * a 'Morning Guidance' prayer slide, a 'Future self' visualization, a 'Water 500ml @08:00'
 * weekly drink, an affirmation) so the very first screen you saw looked populated but was fake.
 * Everything is seeded from zero now, and the day graphs only draw real data.
 *
 * Settings, identity, voice, playlist tracks and the day plan are kept; only habit *data* goes.
 * Runs once per app version, before React mounts.
 */
import { readStorage, writeStorage } from './db'

const VERSION_KEY = 'habitOS_schemaVersion'
const TARGET = 3

const WIPE_KEYS = [
  'habitOS_streaks',
  'habitOS_streaksCustom',
  'habitOS_tasks',
  'habitOS_tasksHistory',
  'habitOS_waterLogs',
  'habitOS_waterHistory',
  'habitOS_weeklyDrinks',
  'habitOS_workoutSegments',
  'habitOS_workoutHistory',
  'habitOS_diet',
  'habitOS_injury',
  'habitOS_ritualTasks',
  'habitOS_prayerSlides',
  'habitOS_prayerAudios',
  'habitOS_vizSlides',
  'habitOS_affirmations',
  'habitOS_affAudios',
  'habitOS_shortAlarms',
  'habitOS_dailyAlarms',
  'habitOS_remainderPlan',
  'habitOS_lastAffirm',
  'habitOS_skipHistory'
]

/** Rows that used to be pre-filled with demo content: remove them, keep user-created ones. */
const isSeedRow = (row: any): boolean => {
  const id = String(row?.id ?? '')
  const name = String(row?.name ?? row?.title ?? '').trim().toLowerCase()
  const seedIds = ['1', '2', '3', 'w1', 'w2', 'w3', 'w4', 'w5', 'p1', 'v1', 'a1', 's1', 's2', 'seed-workout', 'seed-water', 'seed-read', '1-water', '1-workout']
  const seedNames = [
    'chest', 'biceps', 'triceps', 'neck', 'forearms', 'leg',
    '20 pushups', '30 sec plank', '15 squats', '20 jumping jacks', '15 lunges',
    'habit os v4', 'habit os v5', 'habit.ai mobile', 'future self os',
    'morning guidance', 'future self 1 year', 'i am becoming my best self',
    'morning workout', 'meditation', 'reading', 'water', 'workout',
    'lemon water', 'morning power', 'focus flow', 'sleep calm',
    'drink 3l water', 'morning workout 100 pushups'
  ]
  if (seedIds.includes(id) && seedNames.includes(name)) return true
  return seedNames.includes(name)
}

function wipeHabitData() {
  const removed: string[] = []
  for (const key of WIPE_KEYS) {
    try {
      const raw = readStorage(key, 'null')
      if (raw === 'null') continue
      localStorage.removeItem(key)
      removed.push(key)
    } catch { /* a storage entry we cannot read is not worth crashing over */ }
  }
  // the main state object holds a few collections too
  try {
    const st = JSON.parse(readStorage('habitOS_v4_final', '{}'))
    const next = {
      ...st,
      steaks: (Array.isArray(st.steaks) ? st.steaks : []).filter((s: any) => !isSeedRow(s)),
      tasks: (Array.isArray(st.tasks) ? st.tasks : []).filter((t: any) => !isSeedRow(t)),
      projects: (Array.isArray(st.projects) ? st.projects : []).filter((p: any) => !isSeedRow(p)),
      affirmations: (Array.isArray(st.affirmations) ? st.affirmations : []).filter((a: any) => !isSeedRow(a)),
      // split-goal defaults are gone: the water plan is derived from the Water goal setting,
      // real sessions come from the Workout page, and steaks are their own page.
      streaks: [],
      dailyLogs: [],
      skips: [],
      pauses: [],
      catchUp: [],
      reminderLog: [],
      skippedFeatures: [],
      workouts: [],
      water: 0,
      dayPhase: 'unstarted',
      dayStartedAt: null,
      ringAlarm: null,
      briefing: null
    }
    writeStorage('habitOS_v4_final', JSON.stringify(next))
  } catch {}
  return removed
}

export function runMigrations(): { from: number; to: number; wiped: string[] } {
  let from = 0
  try { from = Number(localStorage.getItem(VERSION_KEY) || 0) || 0 } catch {}
  if (from >= TARGET) return { from, to: TARGET, wiped: [] }
  const wiped = wipeHabitData()
  try { localStorage.setItem(VERSION_KEY, String(TARGET)) } catch {}
  return { from, to: TARGET, wiped }
}

/** "Data clean" in Settings: everything to zero, settings/identity/voice kept. */
export function cleanAllHabitData(): number {
  const wiped = wipeHabitData()
  try { localStorage.setItem(VERSION_KEY, String(TARGET)) } catch {}
  return wiped.length
}
