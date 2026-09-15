/**
 * AppContext v5.2 — state + engine wiring for the day flow.
 *
 * What changed on top of v4.3:
 *  - the day is driven by dayFlow phases (nothing reminds you before "Start the day")
 *  - steaks no longer nag; the steaks grid just sits in its column
 *  - tasks have ONE source of truth (habitOS_tasks, with a real local date + priority order)
 *  - one wake-up sequence: alarm -> stop/snooze -> briefing -> morning playlist
 *  - live voice: partial transcripts + assistant reply in the command bar
 *  - voice can be put to sleep ("mute it" / "go to sleep") and woken from Settings
 *  - no demo steaks/tasks/projects are invented on first boot any more: onboarding fills the DB
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { dayController } from '../core/dayController'
import { scheduler } from '../core/scheduler'
import { personality } from '../speaking/personality'
import { speakingModel } from '../speaking/speakingModel'
import { parseVoiceCommand, type ParsedCommand, type RitualTab, type Tab } from '../core/commandRouter'
import * as voice from '../core/voiceEngine'
import { notify, requestNotifyPermission, writeStorage, readStorage } from '../lib/db'
import {
  dayRecord, setDay, markAlarmClosed, markSnoozed, startDay as flowStartDay, endDay as flowEndDay,
  inAwakeWindow, activeMinutes, drinksOn, workoutSlots, ritualDoneToday, markRitualDone
} from '../core/dayFlow'
export type { Phase } from '../core/dayFlow'
import { playlist, type PlayMode } from '../core/playlist'
import { buildBriefing, tasksOn, type Briefing } from '../core/dayFlow'
import { clockNow, minutesNow, todayKey, tomorrowKey, localDayOf, weekdayOf, onClock, onNewDay } from '../lib/clock'
import { resolveMedia } from '../lib/mediaStore'

const Ctx = createContext<any>(null)
export const useApp = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}

const safeGet = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

const saveSteaks = (list: any[]) => {
  const clean = list.map((s: any) => { const arr: number[] = (s.completed || []).map(Number); return { ...s, completed: [...new Set(arr)].sort((a, b) => a - b) } })
  writeStorage('habitOS_streaks', JSON.stringify(clean))
  writeStorage('habitOS_streaksCustom', JSON.stringify(clean))
}
/** A clean install starts empty — the old build seeded 3 fake steaks you never created. */
const storedSteaks = (): any[] => {
  try {
    const raw = JSON.parse(readStorage('habitOS_streaks', 'null'))
    if (Array.isArray(raw)) return raw
    const legacy = JSON.parse(readStorage('habitOS_streaksCustom', 'null'))
    return Array.isArray(legacy) ? legacy : []
  } catch { return [] }
}

const defaultDB = {
  affirmGapMin: 60,
  activeTab: 'Today' as Tab,
  ritualTab: 'Prayer' as RitualTab,
  onboarded: false,
  dayPaused: false,
  isListening: false,
  isSpeaking: false,
  bedtime: '22:00',
  alarmTime: '06:00',
  alarmSource: 'System',
  alwaysOnMic: false,
  voiceAsleep: false,
  wakeWord: 'hey habi',
  micLevel: 0,
  micBars: new Array(24).fill(0) as number[],
  micPermission: 'prompt' as 'prompt' | 'granted' | 'blocked',
  micSensitivity: 60,
  audioTalkback: true,
  transcript: '',
  liveTranscript: '',
  lastAction: '',
  assistantResponse: '',
  affirmations: [] as any[],
  tasks: [] as any[],
  projects: [] as any[],
  water: 0,
  workouts: [] as any[],
  streaks: [
    { id: 'water', name: 'Water', dailyGoal: 3000, unit: 'ml', split: 6 },
    { id: 'workout', name: 'Workout', dailyGoal: 100, unit: 'reps', split: 4 }
  ] as any[],
  dailyLogs: [] as any[],
  skips: [] as any[],
  pauses: [] as any[],
  skippedFeatures: [] as string[],
  vizPlaying: false,
  aiName: 'Habi',
  userName: '',
  profile: { name: '', routine: { wake: '06:00', sleep: '22:00' } },
  speechVoices: [] as any[],
  selectedVoiceURI: '',
  voiceGender: 'female' as 'male' | 'female',
  pitch: 1,
  speed: 1,
  volume: 1,
  showSkipConfirm: null as any,
  voiceHistory: [] as any[],
  skipTarget: null as any,
  showWorkoutPopup: false,
  workoutPopupTask: null as any,
  globalMuted: false,
  steaks: [] as any[],
  catchUp: [] as any[],
  reminderLog: [] as string[],
  // ---- morning music ----
  playlistTracks: [] as any[],
  playlistMode: 'shuffle' as PlayMode,
  playlistVolume: 0.8,
  wakeMusic: true,
  playingPlaylist: false,
  // ---- daytime playouts ----
  affirmPlayout: true,
  secondaryNudges: true,
  activeDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as string[],
  // ---- wake-up flow ----
  ringAlarm: null as null | { id: string; label: string; time: string; kind: 'daily' | 'short' },
  briefing: null as Briefing | null,
  dayPhase: 'unstarted' as string,
  dayStartedAt: null as null | string
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<any>(() => {
    try {
      const raw = localStorage.getItem('habitOS_v4_final')
      const aiName = safeGet('habitOS_aiName', 'Habi')
      const voiceURI = safeGet('habitOS_voiceURI', '')
      const persisted = raw ? JSON.parse(raw) : {}
      return {
        ...defaultDB,
        ...persisted,
        micPermission: persisted.micPermission || 'prompt',
        aiName,
        userName: persisted.userName || '',
        selectedVoiceURI: persisted.selectedVoiceURI || voiceURI,
        dayPaused: !!persisted.dayPaused,
        micLevel: 0,
        micBars: defaultDB.micBars,
        isListening: false,
        isSpeaking: false,
        liveTranscript: '',
        // transient UI flags: never restored, or a dialog left open last session reopens on boot
        showSteaksManager: false,
        showWorkoutPopup: false,
        workoutPopupTask: null,
        ritualFullscreen: false,
        ringAlarm: null,
        steaks: storedSteaks(),
        tasks: persisted.tasks && persisted.tasks.length ? persisted.tasks : storedTasks(),
        pauses: persisted.pauses || [],
        dayPhase: dayRecord().phase,
        dayStartedAt: dayRecord().startedAt
      }
    } catch {
      return { ...defaultDB }
    }
  })

  const stateRef = useRef(state)
  stateRef.current = state

  // preload TTS on start (Piper) - does not block
  useEffect(() => {
    voice.preloadTTS().catch(() => {})
  }, [])

  useEffect(() => {
    voice.setLevelSink((v: number, bars: number[]) => {
      const sens = Math.max(20, Number(stateRef.current.micSensitivity) || 60) / 60
      setState((s: any) => ({ ...s, micLevel: Math.min(100, Math.round(v * sens)), micBars: bars }))
    })
    // in-flight speech goes straight to the command bar
    voice.setPartialSink((text: string) => setState((s: any) => (s.liveTranscript === text ? s : { ...s, liveTranscript: text })))
  }, [])

  /**
   * Persistence. The old version listed ~20 state keys as dependencies, so anything not in
   * that list (userName, playlistTracks, phase, …) never reached disk and — worse — the next
   * save of a listed key silently overwrote it. Now: mark dirty on any change, flush at most
   * every 1.5s, and always write the full non-transient state.
   */
  const dirtyRef = useRef(false)
  const lastSavedRef = useRef<string>('')
  useEffect(() => { dirtyRef.current = true }, [state])
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      try {
        const {
          speechVoices, isListening, isSpeaking, micLevel, micBars, liveTranscript, transcript,
          showSkipConfirm, skipTarget, showSteaksManager, showWorkoutPopup, workoutPopupTask,
          ritualFullscreen, briefing, day, ...toSave
        } = stateRef.current
        const json = JSON.stringify(toSave)
        if (json === lastSavedRef.current) return
        lastSavedRef.current = json
        // Merge over what is on disk: dayFlow writes `{...cur, day}` from its own module, and a
        // blanket overwrite here used to silently reset the day phase back to "unstarted".
        const cur = readV4()
        writeStorage('habitOS_v4_final', JSON.stringify({ ...cur, ...toSave, day: cur.day }))
        if (toSave.aiName) localStorage.setItem('habitOS_aiName', toSave.aiName)
      } catch {}
    }
    const iv = setInterval(flush, 1500)
    window.addEventListener('beforeunload', flush)
    return () => { clearInterval(iv); flush(); window.removeEventListener('beforeunload', flush) }
  }, [])

  /** Tasks live in habitOS_tasks so TasksView / voice / Today all read one list. */
  useEffect(() => {
    try { writeStorage('habitOS_tasks', JSON.stringify(state.tasks || [])) } catch {}
  }, [state.tasks])

  useEffect(() => {
    const loadVoices = () => {
      try {
        const voices = window.speechSynthesis?.getVoices() || []
        if (voices.length) setState((s: any) => ({ ...s, speechVoices: voices }))
      } catch {}
    }
    loadVoices()
    try {
      window.speechSynthesis.onvoiceschanged = loadVoices
      setTimeout(loadVoices, 500)
    } catch {}
    const off = speakingModelIsSpeaking()
    return off
  }, [])

  function speakingModelIsSpeaking() {
    let un: any
    const sub = (b: boolean) => setState((s: any) => ({ ...s, isSpeaking: b }))
    un = subscribeSpeaking(sub)
    return () => un && un()
  }

  /** Feed the playlist engine from state, and mirror its play state back. */
  useEffect(() => {
    playlist.configure({
      tracks: state.playlistTracks || [],
      mode: state.playlistMode || 'shuffle',
      volume: typeof state.playlistVolume === 'number' ? state.playlistVolume : 0.8,
      muted: !!state.globalMuted || !!state.dayPaused
    })
  }, [state.playlistTracks, state.playlistMode, state.playlistVolume, state.globalMuted, state.dayPaused])
  useEffect(() => playlist.subscribe((s: any) => setState((p: any) => (p.playingPlaylist === s.playing ? p : { ...p, playingPlaylist: s.playing }))), [])

  // ---------- always-on mic ----------
  // voiceAsleep: "mute it" / "go to sleep" takes the ear offline too, woken from Settings.
  useEffect(() => {
    let stopped = false
    const wake = (stateRef.current.wakeWord || 'hey habi').toLowerCase()
    voice.setWakeWord(wake)

    const listen = () => {
      voice.startAlwaysOn((text: string) => {
        if (stopped) return
        if (text === '__WAKE__') {
          speakingModel.speakRandom('wake')
          setState((s: any) => ({ ...s, assistantResponse: `${s.aiName || 'Habi'} here — yes?` }))
          return
        }
        if (text && text.trim().length > 2) {
          setState((s: any) => ({ ...s, liveTranscript: text }))
          api.runCommandRef.current?.(text)
        }
      })
    }

    if (state.voiceAsleep || state.dayPaused) {
      voice.stopAlwaysOn()
      setState((s: any) => ({ ...s, isListening: false }))
    } else if (state.alwaysOnMic && state.micPermission === 'granted') {
      listen()
    } else if (state.alwaysOnMic && state.micPermission !== 'granted') {
      voice.enableMicrophone().then((ok: any) => {
        setState((s: any) => ({ ...s, micPermission: ok ? 'granted' : 'blocked' }))
        if (ok) { voice.startMicMeter(); listen() }
      })
    } else {
      voice.stopAlwaysOn()
    }
    return () => {
      stopped = true
      voice.stopAlwaysOn()
    }
  }, [state.alwaysOnMic, state.micPermission, state.wakeWord, state.voiceAsleep, state.dayPaused])
  /* ------------------------------------------------------------------ *
   * The clock engine: one interval, real wall-clock driven, phase gated.
   *  - alarms ring only through the overlay, and only until you answer them
   *  - steaks never nag (they live in their own column now)
   *  - water / workout / affirmation nudges run only between "Start the day" and bedtime
   * ------------------------------------------------------------------ */
  const firedRef = useRef<Set<string>>(new Set())
  const nextNudgeRef = useRef<number>(0)
  const lastAffirmRef = useRef<number>(0)
  useEffect(() => {
    requestNotifyPermission()
    const today = () => todayKey()
    const firedKey = (k: string) => today() + '#' + k
    const wasFired = (k: string) => firedRef.current.has(firedKey(k))
    const markFired = (k: string, label?: string) => {
      firedRef.current.add(firedKey(k))
      if (!label) return
      const entry = `${clockNow()} • ${label}`
      const prev = (readV4().reminderLog || []).filter((r: string) => r !== entry)
      const log = [entry, ...prev].slice(0, 24)
      writeV4({ reminderLog: log })
      setState((p: any) => ({ ...p, reminderLog: log }))
    }

    let busy = false
    const tick = () => {
      if (busy) return
      busy = true
      try {
        if (dayController.isPaused()) return // PAUSE DAY: everything is silent, alarms included
        const st = stateRef.current
        const rec = dayRecord()
        const now = new Date()
        const nowMin = minutesNow(now)
        const hhmm = clockNow(now)
        const wake = String(rec.phase === 'unstarted' || rec.phase === 'snoozed' ? st.alarmTime || '' : '')

        // ---- 1. wake-up alarm -> ringing overlay ------------------------------------
        if ((rec.phase === 'unstarted' || rec.phase === 'snoozed') && st.alarmTime) {
          const dueNow = rec.phase === 'snoozed'
            ? (rec.snoozeUntil || 0) <= Date.now()
            : hhmm >= wake && !wasFired('wake:' + wake)
          if (dueNow) {
            markFired('wake:' + wake)
            setDay({ phase: 'ringing' })
            setState((p: any) => ({ ...p, dayPhase: 'ringing', ringAlarm: { id: 'wake', label: 'Wake up', time: st.alarmTime, kind: 'daily' as const } }))
          }
        }
        if (rec.phase === 'ringing') {
          const label = st.ringAlarm?.label || 'Alarm'
          if (!wasFired('nag:' + Math.floor(Date.now() / 45000))) {
            markFired('nag:' + Math.floor(Date.now() / 45000))
            notify('HABIT.AI — ' + label, `${label} • say "stop alarm" or "snooze"`)
            speakingModel.speakRandom('ring', { ai: st.aiName || 'Habi', label })
          }
          return // nothing else runs until you answer the alarm
        }

        // ---- 2. one-time short alarms (Sleep tab / "wakeup in 30 minutes") ----------
        const shorts = readJSON('habitOS_shortAlarms', [])
        const dueShort = shorts.find((t: any) => t.status === 'pending' && new Date(t.fireAt) <= now)
        if (dueShort && !st.ringAlarm) {
          writeStorage('habitOS_shortAlarms', JSON.stringify(shorts.map((t: any) => (t.id === dueShort.id ? { ...t, status: 'ringing' } : t))))
          setState((p: any) => ({ ...p, ringAlarm: { id: dueShort.id, label: dueShort.label || 'Alarm', time: hhmm, kind: 'short' as const } }))
          window.dispatchEvent(new CustomEvent('habit:alarms-updated', { detail: { id: dueShort.id } }))
        }

        // ---- 2b. extra recurring daily alarms (Sleep tab) ---------------------------
        if (rec.phase === 'briefing' || rec.phase === 'active') {
          const daily = readJSON('habitOS_dailyAlarms', [])
          for (const a of daily) {
            // the wake alarm itself is owned by the phase machine above; a second entry at the
            // same minute (the Sleep tab mirrors it) must not re-ring the overlay straight away
            if (!a.enabled || a.time !== hhmm || st.ringAlarm) continue
            if (a.id === 'wake' || a.time === st.alarmTime || /wakeup|wake up|morning wakeup/i.test(String(a.label || ''))) continue
            if (wasFired('daily:' + a.id + hhmm)) continue
            markFired('daily:' + a.id + hhmm, a.label || 'Alarm')
            setState((p: any) => ({ ...p, ringAlarm: { id: a.id, label: a.label || 'Alarm', time: a.time, kind: 'daily' as const } }))
          }
        }

        // ---- 3. day-of-week water plan ----------------------------------------------
        if (inAwakeWindow(st.bedtime, now)) {
          for (const drink of drinksOn(weekdayOf())) {
            if (drink.time !== hhmm || wasFired('drink:' + drink.id + hhmm)) continue
            markFired('drink:' + drink.id + hhmm, `${drink.amount}ml ${drink.name}`)
            if (dayController.isSkipped('water')) continue
            notify('HABIT.AI — WATER', `${drink.amount}ml ${drink.name} • ${drink.time}`)
            speakingModel.speak(`Water time — ${drink.amount} millilitres of ${drink.name}`)
          }
        }

        // ---- 4. split goals (water / reps) from the smart schedule -------------------
        const plan = scheduler.getSchedule(st.streaks && st.streaks.length ? st.streaks : [])
        const logs = st.dailyLogs || []
        if (inAwakeWindow(st.bedtime, now)) {
          for (const item of plan) {
            const done = logs.filter((l: any) => l.streakId === item.streakId).reduce((a: number, b: any) => a + (b.amount || 0), 0) ||
              (item.streakId === 'water' ? waterToday() : 0)
            const [h, m] = item.time.split(':').map(Number)
            const sm = h * 60 + m
            if (done < item.amount && nowMin >= sm && nowMin - sm <= 90 && !wasFired('plan:' + item.streakId + item.time)) {
              markFired('plan:' + item.streakId + item.time, item.label)
              if (!dayController.isSkipped(item.streakId)) {
                notify('HABIT.AI — SCHEDULE', item.label + ' • now')
                speakingModel.speak(item.label + ' is due')
              }
            }
          }
        }

        // ---- 5. random mid-day affirmation audio ------------------------------------
        if (st.affirmPlayout && inAwakeWindow(st.bedtime, now) && !playlist.isBusy() && !speakingModel.isSpeaking() && !st.showWorkoutPopup && !st.vizPlaying) {
          const gapMin = Math.max(15, Number(st.affirmGapMin) || 60)
          const since = lastAffirmRef.current ? Date.now() - lastAffirmRef.current : Infinity
          const sinceClock = nowMin - readDayMark('habitOS_lastAffirm', 0)
          if (since > gapMin * 60000 && sinceClock >= gapMin) {
            lastAffirmRef.current = Date.now()
            writeDayMark('habitOS_lastAffirm', nowMin)
            void playAffirmation('auto')
          }
        }

        // ---- 5b. primary workout unlocks once prayers + affirmations are ticked ------
        if (inAwakeWindow(st.bedtime, now) && !wasFired('primary-workout')) {
          const { primary } = workoutSlots()
          const prayed = ritualDoneToday('prayer', logs)
          const affirmed = ritualDoneToday('affirmations', logs)
          if (primary.length && prayed && affirmed) {
            markFired('primary-workout', `primary workout • ${primary[0].name}`)
            setState((p: any) => ({ ...p, showWorkoutPopup: true, workoutPopupTask: { ...primary[0], slot: 'primary' }, assistantResponse: `Prayers and affirmations done — primary workout next: ${primary[0].name}` }))
            speakingModel.speak(`Prayers and affirmations are done. Your primary workout is ${primary[0].name}. Full stretch, no rushing.`)
            notify('HABIT.AI — PRIMARY WORKOUT', primary.map((w: any) => w.name).join(', '))
          }
        }

        // ---- 6. random secondary workout nudge ("give me 20 pushups") ---------------
        if (st.secondaryNudges && (st.activeDays || []).includes(weekdayOf()) && inAwakeWindow(st.bedtime, now) && activeMinutes() >= 20) {
          if (!nextNudgeRef.current) nextNudgeRef.current = Date.now() + (45 + Math.floor(Math.random() * 60)) * 60000
          if (Date.now() >= nextNudgeRef.current) {
            nextNudgeRef.current = Date.now() + (45 + Math.floor(Math.random() * 60)) * 60000
            const { secondary } = workoutSlots()
            const pool = secondary.length ? secondary : []
            if (pool.length && !playlist.isBusy() && !st.showWorkoutPopup) {
              const pick = pool[Math.floor(Math.random() * pool.length)]
              markFired('nudge:' + pick.id, `secondary workout • ${pick.name}`)
              setState((p: any) => ({ ...p, showWorkoutPopup: true, workoutPopupTask: pick, assistantResponse: `Secondary workout — ${pick.name}` }))
              speakingModel.speak(`Time for a set. ${pick.name}. Do it now.`)
            }
          }
        }

        // ---- 7. bedtime closes the day and sleeps the voice -------------------------
        if (st.bedtime && hhmm >= st.bedtime && rec.phase === 'active' && !wasFired('bed:' + st.bedtime)) {
          markFired('bed:' + st.bedtime, 'bedtime')
          notify('HABIT.AI — SLEEP', `Bedtime ${st.bedtime} — closing the day.`)
          apiRef.current?.endTheDay?.('bedtime')
        }
        const w = waterToday()
        setState((s: any) => (s.water === w ? s : { ...s, water: w }))
      } finally {
        busy = false
      }
    }

    const iv = setInterval(tick, 20000)
    tick()
    ;(globalThis as any).__habitEngineTick = tick
    return () => clearInterval(iv)
  }, [state.streaks])

  /** Keeps the React copy of the day phase honest even when a view flips it directly. */
  useEffect(() => {
    const sync = () => {
      const rec = dayRecord()
      setState((p: any) => (p.dayPhase === rec.phase && p.dayStartedAt === rec.startedAt ? p : { ...p, dayPhase: rec.phase, dayStartedAt: rec.startedAt }))
    }
    sync()
    const off = onClock(sync)
    window.addEventListener('habit:day-updated', sync)
    const onWater = (e: any) => {
      const v = typeof e?.detail?.todayTotal === 'number' ? e.detail.todayTotal : waterToday()
      setState((p: any) => (p.water === v ? p : { ...p, water: v }))
    }
    window.addEventListener('habit:water-log', onWater)
    return () => { off(); window.removeEventListener('habit:day-updated', sync); window.removeEventListener('habit:water-log', onWater) }
  }, [])

  /**
   * Midnight boundary, driven by the real calendar: yesterday's water totals are archived,
   * one-shot alarms and fired-reminder marks are cleared, and the day goes back to
   * "not started" so the new day waits for your alarm + Start the day.
   */
  useEffect(() => {
    return onNewDay((today, previous) => {
      firedRef.current = new Set()
      nextNudgeRef.current = 0
      lastAffirmRef.current = 0
      try {
        const logs = readJSON('habitOS_waterLogs', [])
        const goal = readJSON('habitOS_waterGoal', { amount: 3000 }).amount || 3000
        const yTotal = logs.filter((l: any) => localDayOf(l.date) === previous).reduce((a: number, b: any) => a + (b.amount || 0), 0)
        const history = readJSON('habitOS_waterHistory', [])
        if (yTotal > 0 && !history.some((h: any) => h.date === previous)) {
          writeStorage('habitOS_waterHistory', JSON.stringify([...history, { date: previous, total: yTotal, goal, pct: Math.round((yTotal / goal) * 100) }]))
        }
        const shorts = readJSON('habitOS_shortAlarms', []).filter((t: any) => t.status === 'pending' && new Date(t.fireAt) > new Date())
        writeStorage('habitOS_shortAlarms', JSON.stringify(shorts))
      } catch {}
      setDay({ phase: 'unstarted', startedAt: null, alarmClosedAt: null, endedAt: null, snoozeUntil: null })
      setState((p: any) => ({ ...p, dayPhase: 'unstarted', dayStartedAt: null, ringAlarm: null, briefing: null, catchUp: [], assistantResponse: `New day • ${today}. Alarm at ${p.alarmTime}, nothing runs until you start.` }))
      notify('HABIT.AI — NEW DAY', `${today} — the day starts when you stop the alarm.`)
      window.dispatchEvent(new CustomEvent('habit:day-updated'))
    })
  }, [])


  useEffect(() => {
    if (state.dayPaused) return
    try {
      const st = readV4()
      const plan = (st.catchUp || []).map((c: any) => ({ ...c }))
      if (plan.length) setState((s: any) => ({ ...s, catchUp: plan }))
    } catch {}
  }, [state.dayPaused])

  useEffect(() => {
    if (state.micPermission !== 'granted' || state.alwaysOnMic) return
    if (voice.startMicMeter) voice.startMicMeter()
    return () => voice.stopAlwaysOn()
  }, [state.micPermission, state.alwaysOnMic])

  /* ------------------------- wake-up flow controllers ------------------------- */
  const apiRef = useRef<any>(null)

  const playAffirmation = useCallback(async (source: 'auto' | 'voice' = 'voice') => {
    const st = stateRef.current
    if (st.globalMuted || dayController.isPaused()) return
    const texts: any[] = readJSON('habitOS_affirmations', [])
    const audios: any[] = readJSON('habitOS_affAudios', [])
    if (source === 'auto' && !audios.length) return // auto-play only makes sense with real clips
    if (audios.length) {
      const a = audios[Math.floor(Math.random() * audios.length)]
      const url = await resolveMedia(a.url)
      if (!url) return
      const el = new Audio(url)
      el.volume = Math.max(0, Math.min(1, Number(st.volume ?? 1)))
      setState((p: any) => ({ ...p, assistantResponse: `Playing affirmation — ${a.name || ''}` }))
      try { await el.play() } catch { /* autoplay blocked; the text track still reads out */ }
      return
    }
    const t = texts[Math.floor(Math.random() * (texts.length || 1))]
    const line = typeof t === 'string' ? t : t?.text
    if (line) speakingModel.speak(source === 'auto' ? `Affirmation time. ${line}` : line)
  }, [])

  /** Alarm answered. mode=close -> briefing out loud, then morning music. mode=snooze -> quiet. */
  const answerAlarm = useCallback((mode: 'close' | 'snooze', minutes = 10) => {
    const st = stateRef.current
    const ring = st.ringAlarm
    const rec = dayRecord()
    // The wake alarm is the one that gates the day; everything else is just a notification.
    const isWake = rec.phase === 'ringing' || (!ring && (rec.phase === 'unstarted' || rec.phase === 'snoozed'))
    speakingModel.stop()

    const clearShort = (snooze: boolean) => {
      if (!ring || ring.kind !== 'short') return
      const list = readJSON('habitOS_shortAlarms', [])
      const next = snooze
        ? list.map((t: any) => (t.id === ring.id
          ? { ...t, status: 'pending', fireAt: new Date(Date.now() + minutes * 60000).toISOString(), snoozeCount: (t.snoozeCount || 0) + 1 }
          : t))
        : list.filter((t: any) => t.id !== ring.id)
      writeStorage('habitOS_shortAlarms', JSON.stringify(next))
      window.dispatchEvent(new CustomEvent('habit:alarms-updated', { detail: { id: ring.id } }))
    }

    if (mode === 'snooze') {
      clearShort(true)
      if (!isWake && !ring) { setState((p: any) => ({ ...p, ringAlarm: null })); return { ok: false, reason: 'Nothing was ringing — say stop alarm only when the alarm goes off.' } }
      // snoozing an extra alarm re-arms it as a one-shot; snoozing the wake alarm parks the day
      if (isWake) {
        markSnoozed(Date.now() + minutes * 60000)
        setState((p: any) => ({ ...p, ringAlarm: null, dayPhase: 'snoozed', assistantResponse: `Snoozed ${minutes} minutes — back to bed.` }))
      } else {
        if (!ring) return
        if (ring.kind === 'daily') {
          const list = readJSON('habitOS_shortAlarms', [])
          writeStorage('habitOS_shortAlarms', JSON.stringify([...list, {
            id: Date.now().toString(), label: ring.label, type: 'alarm', fireAt: new Date(Date.now() + minutes * 60000).toISOString(),
            createdAt: new Date().toISOString(), status: 'pending', snoozeCount: 1
          }]))
        }
        setState((p: any) => ({ ...p, ringAlarm: null, assistantResponse: `Snoozed ${ring.label} for ${minutes} minutes.` }))
      }
      speakingModel.speak(`Snoozed ${minutes} minutes.`)
      return { ok: true }
    }

    clearShort(false)
    if (!isWake) {
      if (!ring) return { ok: false, reason: 'Nothing was ringing.' }
      const label = ring?.label
      setState((p: any) => ({ ...p, ringAlarm: null, assistantResponse: label ? `${label} cleared.` : 'Nothing was ringing.' }))
      speakingModel.speak(label ? `${label} cleared.` : 'Nothing was ringing.')
      return { ok: !!label }
    }

    const next = markAlarmClosed()
    const brief = buildBriefing({ alarmTime: st.alarmTime, bedtime: st.bedtime, projects: st.projects })
    setState((p: any) => ({
      ...p,
      ringAlarm: null,
      dayPhase: next.phase,
      briefing: brief,
      assistantResponse: brief.spoken
    }))
    void (async () => {
      await speakingModel.speak(brief.spoken)
      if (stateRef.current.wakeMusic && (stateRef.current.playlistTracks || []).length) {
        const started = await playlist.resumeOrPlay()
        if (!started) playlist.next()
      }
    })()
    return { ok: true }
  }, [])

  const runCommandRef = useRef<(raw: string, opts?: { fromOrb?: boolean }) => void>()
  const runCommand = useCallback(
    (rawInput: string) => {
      const raw = String(rawInput || '').trim()
      if (!raw) {
        speakingModel.speakRandom('wake')
        return
      }
      const cmd: ParsedCommand = parseVoiceCommand(raw)
      const set = (p: any) =>
        typeof p === 'function'
          ? setState((prev: any) => ({ ...prev, ...p(prev) }))
          : setState((prev: any) => ({ ...prev, ...p }))
      const reply = (text: string, key?: string, vars?: any) => {
        set({ transcript: raw, lastAction: cmd.kind, assistantResponse: text })
        speakingModel.speak(key ? '' : text)
        if (key) speakingModel.speakRandom(key, vars)
        pushHistory(raw, cmd.kind, text)
      }
      const pushHistory = (t: string, action: string, res: string) =>
        set((prev: any) => ({ ...prev, voiceHistory: [{ id: Date.now().toString(), cmd: t, action, time: new Date().toLocaleTimeString(), ok: true }, ...(prev.voiceHistory || [])].slice(0, 30) }))

      switch (cmd.kind) {
        case 'navigate':
          if (cmd.tab) {
            set({ activeTab: cmd.tab })
            reply(`Opening ${cmd.tab}.`, 'nav', { tab: cmd.tab })
          }
          break
        case 'ritual':
          set({ activeTab: 'Rituals' })
          if (cmd.ritual) set({ ritualTab: cmd.ritual })
          reply(`Rituals — ${cmd.ritual}.`, 'nav', { tab: cmd.ritual })
          break
        case 'steaksLeft':
        case 'whatOnToday': {
          const brief = buildBriefing({ alarmTime: stateRef.current.alarmTime, bedtime: stateRef.current.bedtime, projects: stateRef.current.projects })
          set({ transcript: raw, lastAction: cmd.kind, briefing: brief, assistantResponse: brief.spoken })
          speakingModel.speak(brief.spoken)
          pushHistory(raw, cmd.kind, brief.spoken.slice(0, 60))
          break
        }
        case 'checkIn': {
          const today = todayKey()
          const steaks = storedSteaks()
          const pending = dayController.pendingSteaks()
          const wanted = cmd.target
          let target: any = null
          if (wanted) {
            const norm = wanted.toLowerCase().replace(/[^a-z]/g, '')
            target = steaks.find((st: any) => st.name.toLowerCase().replace(/[^a-z]/g, '').includes(norm)) ||
                     (['water'].includes(norm) ? { id: 'water', name: 'Water', grid: false } : norm.includes('workout') ? { id: 'workout', name: 'Workout', grid: false } : null)
          } else {
            target = pending[0] ? { id: pending[0].id, name: pending[0].name } : null
          }
          if (target && target.grid === false) {
            const logs: any[] = readV4().dailyLogs || []
            const water = target.id === 'water'
            const next = [...logs.filter((l: any) => !(l.streakId === target.id && localDayOf(l.date) === today)), { id: target.id + '-' + today, streakId: target.id, date: today, amount: water ? 3000 : 100 }]
            writeV4({ dailyLogs: next })
            set({ dailyLogs: next })
            reply(`${target.name} logged for today.`, 'checked')
          } else if (target) {
            const createdAt = localDayOf(target.createdAt || today)
            const idx = dayController.dayIndexOf(createdAt, today)
            const steaks2 = storedSteaks()
            const updated = steaks2.map((st2: any) => {
              if (st2.id !== target.id) return st2
              const has = (st2.completed || []).includes(idx)
              return { ...st2, completed: has ? st2.completed.filter((d: number) => d !== idx) : [...new Set([...(st2.completed || []), idx])].sort((a, b) => a - b) }
            })
            saveSteaks(updated)
            set({ steaks: updated })
            const flipped = (target.completed || []).includes(idx)
            reply(flipped ? `${target.name} day ${idx + 1} un-checked.` : `${target.name} checked in for today.`, flipped ? undefined : 'checked')
          } else {
            reply('Everything is already checked in today.', undefined)
          }
          break
        }
        case 'addSteak':
          if (cmd.target && cmd.days) {
            const total = Math.max(1, Math.min(365, cmd.days))
            const item = { id: Date.now().toString(), name: cmd.target, total, completed: [], createdAt: new Date().toISOString() }
            const updated = [...storedSteaks(), item]
            saveSteaks(updated)
            set({ steaks: updated })
            speakingModel.speakRandom('added')
            reply(`Steak added: ${item.name}, ${total} days. I will remind you between 08:00 and 21:00.`, undefined)
            set({ showSteaksManager: true })
          } else {
            set({ showSteaksManager: true, transcript: raw, lastAction: 'addSteak', assistantResponse: 'Steaks manager open — type the name and days, then Add.' })
            speakingModel.speak('Tell me the steak name and days, or use the manager.')
            pushHistory(raw, 'addSteak', 'manager')
          }
          break
        case 'deleteSteak':
          set({ showSteaksManager: true, transcript: raw, lastAction: 'deleteSteak', assistantResponse: 'Steaks manager open — trash icon on any steak deletes it.' })
          speakingModel.speak('Steaks manager open. Use the trash button to delete.')
          pushHistory(raw, 'deleteSteak', 'manager')
          break
        case 'skip': {
          const days = cmd.days || 1
          const target = cmd.target || 'general'
          set({ showSkipConfirm: true, skipTarget: { id: target, name: target.toUpperCase() + ' streak', voice: { days, reason: 'Voice' } } })
          set({ transcript: raw, lastAction: 'skip', assistantResponse: `How many days to skip ${target}? Pick in the modal.` })
          speakingModel.speak('Skip modal open — pick the days and reason.')
          pushHistory(raw, 'skip', target + ' ' + days)
          break
        }
        case 'addTask': {
          if (!cmd.target) break
          const date = cmd.forTomorrow ? tomorrowKey() : todayKey()
          const item = {
            id: Date.now().toString(),
            title: cmd.target,
            status: 'todo',
            priority: cmd.priority || 'normal',
            date,
            time: cmd.time || '',
            createdAt: new Date().toISOString()
          }
          const cur = [item, ...storedTasks()]
          writeStorage('habitOS_tasks', JSON.stringify(cur))
          set({ tasks: cur, transcript: raw, lastAction: 'addTask', assistantResponse: `Task added for ${cmd.forTomorrow ? 'tomorrow' : 'today'}: ${item.title}` })
          speakingModel.speakRandom('task')
          pushHistory(raw, 'addTask', cmd.target)
          window.dispatchEvent(new CustomEvent('habit:tasks-updated'))
          break
        }
        case 'pauseDay':
          api.pauseDay()
          pushHistory(raw, 'pauseDay', 'ok')
          break
        case 'resumeDay':
          api.resumeDay()
          pushHistory(raw, 'resumeDay', 'ok')
          break
        case 'workoutTrigger':
          set({ activeTab: 'Workout', showWorkoutPopup: true, workoutPopupTask: null, transcript: raw })
          speakingModel.speak('Random workout loaded. Let us move.')
          pushHistory(raw, 'workout', 'trigger')
          break
        case 'mute':
          // "mute it" silences output AND puts the mic to sleep — wake it from Settings • Voice
          set({ globalMuted: true, voiceAsleep: true, assistantResponse: 'Muted, and my ear is off. Wake me in Settings • Voice.' })
          speakingModel.stop()
          playlist.pause()
          pushHistory(raw, 'mute', 'muted+voice asleep')
          break
        case 'unmute':
          set({ globalMuted: false, voiceAsleep: false })
          speakingModel.speakRandom('unmuted')
          reply('Audio is back on and I am listening again.', undefined)
          break
        case 'voiceSleep':
          set({ voiceAsleep: true, assistantResponse: 'Going quiet. Say the wake word after waking me in Settings.' })
          speakingModel.speak('Sleep mode. Wake me in Settings when you need me.')
          pushHistory(raw, 'voiceSleep', 'ok')
          break
        case 'voiceWake':
          set({ voiceAsleep: false, alwaysOnMic: true })
          reply('Ear back on — say the wake word.', undefined)
          break
        case 'startDay':
          apiRef.current?.startTheDay?.(cmd.action === 'primary' ? 'prayer-first' : 'quick')
          pushHistory(raw, 'startDay', 'ok')
          break
        case 'endDay':
          apiRef.current?.endTheDay?.('voice')
          pushHistory(raw, 'endDay', 'ok')
          break
        case 'playlistMode': {
          const mode = (cmd.action || 'shuffle') as PlayMode
          set({ playlistMode: mode })
          playlist.configure({ mode })
          reply(`Playlist mode: ${mode.replace('-', ' ')}.`, undefined)
          pushHistory(raw, 'playlistMode', mode)
          break
        }
        case 'music': {
          const act = cmd.action
          if (act === 'play') void playlist.resumeOrPlay()
          if (act === 'pause' || act === 'stop') playlist.pause()
          if (act === 'next') playlist.next()
          if (act === 'prev') playlist.prev()
          reply(
            act === 'play' ? 'Playing your playlist.' : act === 'pause' || act === 'stop' ? 'Music paused.' : act === 'next' ? 'Next track.' : 'Previous track.',
            undefined
          )
          pushHistory(raw, 'music:' + act, 'ok')
          break
        }
        case 'fullscreen': {
          set({ activeTab: 'Rituals', ritualTab: cmd.target === 'viz' ? 'Visualization' : 'Prayer', ritualFullscreen: true })
          reply(`Full screen ${cmd.target === 'viz' ? 'visualization' : 'prayer'}.`, undefined)
          pushHistory(raw, 'fullscreen', String(cmd.target))
          break
        }
        case 'media': {
          if (cmd.action === 'pauseVideo') window.dispatchEvent(new CustomEvent('habit:media', { detail: 'pause' }))
          if (cmd.action === 'playVideo') window.dispatchEvent(new CustomEvent('habit:media', { detail: 'play' }))
          if (cmd.action === 'next') window.dispatchEvent(new CustomEvent('habit:media', { detail: 'next' }))
          if (cmd.action === 'playPrayerAudio') window.dispatchEvent(new CustomEvent('habit:media', { detail: 'playPrayer' }))
          reply(cmd.action === 'next' ? 'Next slide.' : cmd.action === 'pauseVideo' ? 'Paused.' : 'Playing.', undefined)
          pushHistory(raw, 'media:' + cmd.action, 'ok')
          break
        }
        case 'affirmation':
          window.dispatchEvent(new CustomEvent('habit:affirmation', { detail: cmd.action }))
          reply(cmd.action === 'next' ? 'Next affirmation.' : 'Playing affirmations.', undefined)
          pushHistory(raw, 'affirmation', 'ok')
          break
        case 'alarm': {
          if (!cmd.time) break
          const alarms = readJSON('habitOS_dailyAlarms', [])
          const updated = [...alarms, { id: Date.now().toString(), time: cmd.time, label: 'Voice alarm', enabled: true, days: ['daily'], source: 'voice' }]
          writeStorage('habitOS_dailyAlarms', JSON.stringify(updated))
          set({ alarmTime: cmd.time })
          reply(`Alarm set for ${cmd.time}.`, 'alarm', { time: cmd.time })
          break
        }
        case 'wakeupIn': {
          const mins = cmd.minutes || 30
          window.dispatchEvent(new CustomEvent('habit:wakeup-in', { detail: mins }))
          reply(`Alarm in ${mins} minutes. I will nag you until you wake up.`, 'alarm', { time: `${mins} minutes` })
          break
        }
        case 'stopAlarm': {
          const outcome = apiRef.current?.answerAlarm?.(cmd.action === 'snooze' ? 'snooze' : 'close', cmd.minutes || 10)
          if (outcome && !outcome.ok) reply(outcome.reason || 'Nothing was ringing.', undefined)
          else if (cmd.action === 'snooze') reply(`Snoozed for ${cmd.minutes || 10} minutes.`, undefined)
          else reply('Alarm closed. Here is today.', undefined)
          break
        }
        case 'bedtime':
          if (cmd.time) {
            set({ bedtime: cmd.time })
            reply(`Bedtime set for ${cmd.time}.`, 'bedtime')
            pushHistory(raw, 'bedtime', cmd.time)
          }
          break
        case 'volume': {
          const nextV = Math.max(0, Math.min(1, (Number(stateRef.current.volume) || 1) + (cmd.action === 'up' ? 0.15 : -0.15)))
          set({ volume: Math.round(nextV * 20) / 20 })
          reply(cmd.action === 'up' ? `Volume up — ${Math.round(nextV * 100).toString()}%.` : `Volume down.`, undefined)
          pushHistory(raw, 'volume', cmd.action || '')
          break
        }
        case 'help':
          set({ transcript: raw, assistantResponse: 'Say: start the day • what is on today • stop alarm • snooze • add task <name> for tomorrow • check in • go to water/prayer/tasks • play my playlist • next track • full screen prayer • pause my day • resume my day • end the day • go to sleep • volume up.' })
          speakingModel.speakRandom('help')
          pushHistory(raw, 'help', 'list')
          break
        case 'testVoice':
          speakingModel.speakRandom('wake')
          set({ transcript: raw, lastAction: 'testVoice', assistantResponse: `Testing voice. ${personality.getAIName()} here, listening.` })
          pushHistory(raw, 'testVoice', 'ok')
          break
        default:
          set({ transcript: raw, lastAction: 'unknown', assistantResponse: `"${raw}" — I did not catch that. Say: what can you do?` })
          speakingModel.speakRandom('confused')
          pushHistory(raw, 'unknown', raw)
      }
    },
    []
  )

  const pauseDay = useCallback(() => {
    dayController.pauseDay()
    setState((s: any) => ({ ...s, dayPaused: true, pauses: readV4().pauses || [], catchUp: [] }))
    speakingModel.speakRandom('paused')
    setState((s: any) => ({ ...s, assistantResponse: 'Day paused. Alarms, reminders and voice are all silent.' }))
  }, [])

  const resumeDay = useCallback(() => {
    const r: any = dayController.resumeDay()
    const missed = r?.missed || []
    const plan = scheduler.catchUpSlots(missed.map((m: any) => ({ id: m.streakId, name: m.name })))
    const catchUp = plan.map((p) => ({ ...p, name: `Catch-up: ${p.name}` }))
    writeV4({ catchUp })
    setState((s: any) => ({ ...s, dayPaused: false, catchUp, pauses: readV4().pauses || [] }))
    speakingModel.speakRandom('resumed')
    setState((s: any) => ({ ...s, assistantResponse: missed.length ? `Day resumed — Catch-up: ${missed.length} missed steaks re-slotted today.` : 'Day resumed. Schedule restored.' }))
  }, [])

  /**
   * "Start the day" — the single switch that begins everything: the steak grid goes live,
   * today's task list becomes the working list, water/workout/affirmation nudges arm, and
   * the prayer -> affirmations -> primary workout sequence is announced in that order.
   */
  const startTheDay = useCallback((mode: 'quick' | 'prayer-first' = 'quick') => {
    const rec = flowStartDay()
    const st = stateRef.current
    const brief = st.briefing || buildBriefing({ projects: st.projects })
    setState((p: any) => ({
      ...p,
      dayPhase: rec.phase,
      dayStartedAt: rec.startedAt,
      briefing: brief,
      activeTab: p.activeTab,
      assistantResponse: `Day started. ${weekdayOf()} plan: ${brief.sections.map((s: any) => `${s.label} — ${s.lines.length ? s.lines.length + ' item(s)' : 'clear'}`).join(' • ')}`
    }))
    window.dispatchEvent(new CustomEvent('habit:day-started'))
    const order = ['Prayers first, then affirmations, then your primary workout.', 'Steaks and tasks are live from now on.']
    speakingModel.speak(`${personality.getAIName()} — day started. ${order[0]} ${order[1]}`)
    notify('HABIT.AI — DAY STARTED', `${rec.day} • steaks, tasks and reminders live`)
    if (mode === 'prayer-first') setState((p: any) => ({ ...p, activeTab: 'Rituals', ritualTab: 'Prayer' }))
    void playlist // music already started with the briefing
  }, [])

  const endTheDay = useCallback((reason = 'manual') => {
    const rec = flowEndDay()
    playlist.pause()
    speakingModel.stop()
    speakingModel.speak(`Day closed — ${reason === 'bedtime' ? 'bedtime' : 'you called it'}. Tomorrow starts fresh at ${stateRef.current.alarmTime}.`)
    setState((p: any) => ({
      ...p,
      dayPhase: rec.phase,
      voiceAsleep: true,
      assistantResponse: 'Day closed and voice is asleep. Start the day tomorrow with your alarm.',
      ringAlarm: null
    }))
    notify('HABIT.AI — DAY CLOSED', `Day closed at ${clockNow()} (${reason})`)
    window.dispatchEvent(new CustomEvent('habit:day-ended'))
  }, [])

  const completeOnboarding = useCallback((data: any) => {
    const patchObj = {
      onboarded: true,
      userName: String(data.userName || '').trim(),
      aiName: String(data.aiName || 'Habi').trim(),
      wakeWord: String(data.wakeWord || 'hey habi').toLowerCase().trim(),
      alarmTime: data.alarmTime || stateRef.current.alarmTime,
      bedtime: data.bedtime || stateRef.current.bedtime,
      voiceGender: data.voiceGender || stateRef.current.voiceGender,
      alwaysOnMic: data.alwaysOnMic !== false,
      wakeMusic: data.wakeMusic !== false,
      affirmPlayout: data.affirmPlayout !== false,
      secondaryNudges: data.secondaryNudges !== false,
      activeDays: Array.isArray(data.activeDays) && data.activeDays.length ? data.activeDays : stateRef.current.activeDays,
      micPermission: data.micPermission || stateRef.current.micPermission
    }
    personality.setAIName(patchObj.aiName)
    personality.setUserName(patchObj.userName)
    voice.setWakeWord(patchObj.wakeWord)
    setState((p: any) => ({ ...p, ...patchObj }))
    const alarms = readJSON('habitOS_dailyAlarms', [])
    if (!alarms.length) {
      writeStorage('habitOS_dailyAlarms', JSON.stringify([
        { id: 'wake', time: patchObj.alarmTime, label: 'Morning wakeup + prayer', enabled: true, days: ['daily'], source: 'onboarding' },
        { id: 'bed', time: patchObj.bedtime, label: 'Bedtime wind-down', enabled: true, days: ['daily'], source: 'onboarding' }
      ]))
    }
    setDay({ phase: 'unstarted', startedAt: null, alarmClosedAt: null, endedAt: null, snoozeUntil: null })
    speakingModel.speak(`Got it ${patchObj.userName || 'there'}. I am ${patchObj.aiName}. Wake me with ${patchObj.wakeWord}.`)
  }, [])

  const api: any = {
    ...state,
    runCommand,
    runCommandRef,
    pauseDay,
    resumeDay,
    setSteaks: (fn: any) => {
      const next = typeof fn === 'function' ? fn(storedSteaks()) : fn
      saveSteaks(next)
      setState((s: any) => ({ ...s, steaks: next }))
    },
    toggleSteakDay: (streakId: string, dayIdx: number) => {
      const next = storedSteaks().map((s2: any) => {
        if (s2.id !== streakId) return s2
        const has = (s2.completed || []).includes(dayIdx)
        return { ...s2, completed: has ? s2.completed.filter((d: number) => d !== dayIdx) : [...new Set([...(s2.completed || []), dayIdx])].sort((a, b) => a - b) }
      })
      saveSteaks(next)
      setState((s: any) => ({ ...s, steaks: next }))
    },
    addSteak: (name: string, total: number) => {
      const next = [...storedSteaks(), { id: Date.now().toString(), name: name.trim(), total: Math.max(1, total), completed: [], createdAt: new Date().toISOString() }]
      saveSteaks(next)
      setState((s: any) => ({ ...s, steaks: next }))
      speakingModel.speakRandom('added')
    },
    deleteSteak: (id: string) => {
      const next = storedSteaks().filter((x: any) => x.id !== id)
      saveSteaks(next)
      setState((s: any) => ({ ...s, steaks: next }))
      speakingModel.speakRandom('deleted')
    },
    markRitualDone: (key: string, done = true) => {
      const next = markRitualDone(key, done)
      setState((p: any) => ({ ...p, dailyLogs: next }))
      window.dispatchEvent(new CustomEvent('habit:ritual-done', { detail: { key, done } }))
    },
    clearCatchUp: () => {
      writeV4({ catchUp: [] })
      setState((s: any) => ({ ...s, catchUp: [] }))
    },
    setShowWorkoutPopup: (v: any) => setState((s: any) => ({ ...s, showWorkoutPopup: !!v })),
    showWorkoutPopup: state.showWorkoutPopup,
    globalMuted: state.globalMuted,
    setGlobalMuted: (v: any) => setState((s: any) => ({ ...s, globalMuted: !!v })),
    skipTarget: state.skipTarget,
    setSkipTarget: (v: any) => setState((s: any) => ({ ...s, skipTarget: v })),
    setShowSkipConfirm: (v: any) => setState((s: any) => ({ ...s, showSkipConfirm: typeof v === 'function' ? v(s.showSkipConfirm) : v })),
    showSteaksManager: !!state.showSteaksManager,
    setShowSteaksManager: (v: any) => setState((s: any) => ({ ...s, showSteaksManager: !!v })),
    setMicPermission: (v: any) => setState((s: any) => ({ ...s, micPermission: v })),
    enableMic: async () => {
      const ok = await voice.enableMicrophone()
      setState((s: any) => ({ ...s, micPermission: ok ? 'granted' : 'blocked', voiceAsleep: ok ? s.voiceAsleep : true }))
      if (ok && voice.startMicMeter) voice.startMicMeter()
      return ok
    },
    speak: (t: string) => speakingModel.speak(t),
    speakRandom: (k: string, vars?: any) => speakingModel.speakRandom(k, vars),
    stopSpeak: () => speakingModel.stop(),
    tapToTalk: (onText: (t: string) => void, onState?: (b: boolean) => void) => voice.talkOnce(onText, onState),
    setActiveTab: (v: any) => setState((s: any) => ({ ...s, activeTab: typeof v === 'function' ? v(s.activeTab) : v })),
    setRitualTab: (v: any) => setState((s: any) => ({ ...s, ritualTab: typeof v === 'function' ? v(s.ritualTab) : v })),
    setDayPaused: (v: any) => {
      const val = typeof v === 'function' ? v(stateRef.current.dayPaused) : v
      if (val === stateRef.current.dayPaused) return
      if (val) pauseDay()
      else resumeDay()
    },
    setIsListening: (v: any) => setState((s: any) => ({ ...s, isListening: typeof v === 'function' ? v(s.isListening) : v })),
    setIsSpeaking: (v: any) => setState((s: any) => ({ ...s, isSpeaking: typeof v === 'function' ? v(s.isSpeaking) : v })),
    setTranscript: (v: any) => setState((s: any) => ({ ...s, transcript: typeof v === 'function' ? v(s.transcript) : v })),
    setAssistantResponse: (v: any) => setState((s: any) => ({ ...s, assistantResponse: typeof v === 'function' ? v(s.assistantResponse) : v })),
    setLastAction: (v: any) => setState((s: any) => ({ ...s, lastAction: typeof v === 'function' ? v(s.lastAction) : v })),
    setVoiceHistory: (fn: any) => setState((s: any) => ({ ...s, voiceHistory: typeof fn === 'function' ? fn(s.voiceHistory) : fn })),
    setTasks: (v: any) => {
      const next = typeof v === 'function' ? v(stateRef.current.tasks) : v
      try { writeStorage('habitOS_tasks', JSON.stringify(next)) } catch {}
      setState((s: any) => ({ ...s, tasks: next }))
      window.dispatchEvent(new CustomEvent('habit:tasks-updated'))
    },
    setProjects: (v: any) => setState((s: any) => ({ ...s, projects: typeof v === 'function' ? v(s.projects) : v })),
    setWater: (v: any) => setState((s: any) => ({ ...s, water: typeof v === 'function' ? v(s.water) : v })),
    setDailyWater: (v: any) => setState((s: any) => ({ ...s, water: typeof v === 'function' ? v(s.water) : v })),
    setSkips: (v: any) => setState((s: any) => ({ ...s, skips: typeof v === 'function' ? v(s.skips) : v })),
    setSkippedFeatures: (v: any) => setState((s: any) => ({ ...s, skippedFeatures: typeof v === 'function' ? v(s.skippedFeatures) : v })),
    setAffirmations: (fn: any) => setState((s: any) => ({ ...s, affirmations: typeof fn === 'function' ? fn(s.affirmations) : fn })),
    setAlwaysOnMic: (v: any) => {
      const val = typeof v === 'function' ? v(stateRef.current.alwaysOnMic) : v
      setState((s: any) => ({ ...s, alwaysOnMic: val }))
    },
    setWakeWord: (v: any) => {
      const clean = String(v || 'hey habi').toLowerCase().trim()
      voice.setWakeWord(clean)
      setState((s: any) => ({ ...s, wakeWord: clean }))
    },
    setMicSensitivity: (v: any) => setState((s: any) => ({ ...s, micSensitivity: v })),
    setSelectedVoiceURI: (v: any) => {
      try { localStorage.setItem('habitOS_voiceURI', v) } catch {}
      setState((s: any) => ({ ...s, selectedVoiceURI: v }))
    },
    setVoiceGender: (v: any) => setState((s: any) => ({ ...s, voiceGender: v })),
    setPitch: (v: any) => setState((s: any) => ({ ...s, pitch: v })),
    setSpeed: (v: any) => setState((s: any) => ({ ...s, speed: v })),
    setVolume: (v: any) => setState((s: any) => ({ ...s, volume: v })),
    setVizPlaying: (v: any) => setState((s: any) => ({ ...s, vizPlaying: v })),
    setAiName: (v: any) => {
      try { localStorage.setItem('habitOS_aiName', v) } catch {}
      personality.setAIName(v)
      voice.setWakeWord((stateRef.current.wakeWord || 'hey habi').replace(/hey\s+\w+/, 'hey ' + String(v).toLowerCase()))
      setState((s: any) => ({ ...s, aiName: v }))
    },
    setDailyLogs: (fn: any) => setState((s: any) => ({ ...s, dailyLogs: typeof fn === 'function' ? fn(s.dailyLogs) : fn })),
    setPauses: (fn: any) => setState((s: any) => ({ ...s, pauses: typeof fn === 'function' ? fn(s.pauses) : fn })),
    setStreaks: (fn: any) => setState((s: any) => ({ ...s, streaks: typeof fn === 'function' ? fn(s.streaks) : fn })),
    reminderLog: state.reminderLog,
    // ---- wake-up flow ----
    answerAlarm,
    startTheDay,
    endTheDay,
    playAffirmation,
    completeOnboarding,
    flowStartDay,
    flowEndDay,
    dayRecord,
    briefingFor: (projects?: any[]) => buildBriefing({ projects: projects || stateRef.current.projects }),
    todayTasks: (date?: string) => tasksOn(date || todayKey()),
    // ---- playlist ----
    playlistPlay: () => playlist.resumeOrPlay(),
    playlistPause: () => playlist.pause(),
    playlistNext: () => playlist.next(),
    playlistPrev: () => playlist.prev(),
    setPlaylistMode: (m: PlayMode) => setState((p: any) => ({ ...p, playlistMode: m })),
    addPlaylistTracks: (tracks: any[]) => setState((p: any) => ({ ...p, playlistTracks: [...(p.playlistTracks || []), ...tracks] })),
    removePlaylistTrack: (id: string) => setState((p: any) => ({ ...p, playlistTracks: (p.playlistTracks || []).filter((t: any) => t.id !== id) })),
    // ---- ritual full screen ----
    setRitualFullscreen: (v: boolean) => setState((p: any) => ({ ...p, ritualFullscreen: !!v })),
    // ---- identity (kept in React state so saves cannot clobber it) ----
    setUserName: (v: string) => {
      personality.setUserName(v)
      setState((p: any) => ({ ...p, userName: v, profile: { ...(p.profile || {}), name: v.toUpperCase() } }))
    },
    /** generic settings writes (playlists, playouts, active days) */
    setPrefs: (patchObj: any) => setState((p: any) => ({ ...p, ...patchObj })),
    wakeVoice: () => setState((p: any) => ({ ...p, voiceAsleep: false, alwaysOnMic: true })),
    sleepVoice: () => setState((p: any) => ({ ...p, voiceAsleep: true })),
    /** Clean-slate for onboarding: habits + logs go, settings + audio stay. */
    resetHabitData: () => {
      saveSteaks([])
      writeStorage('habitOS_tasks', JSON.stringify([]))
      writeStorage('habitOS_waterLogs', JSON.stringify([]))
      writeStorage('habitOS_waterHistory', JSON.stringify([]))
      writeStorage('habitOS_shortAlarms', JSON.stringify([]))
      writeStorage('habitOS_workoutSegments', JSON.stringify([]))
      writeStorage('habitOS_ritualTasks', JSON.stringify('{}'))
      writeV4({ steaks: [], tasks: [], dailyLogs: [], skips: [], pauses: [], catchUp: [], reminderLog: [], skippedFeatures: [], projects: [], workouts: [] })
      setState((p: any) => ({ ...p, steaks: [], tasks: [], dailyLogs: [], skips: [], pauses: [], catchUp: [], reminderLog: [], skippedFeatures: [], projects: [], workouts: [] }))
      window.dispatchEvent(new CustomEvent('habit:data-reset'))
    },
    restartOnboarding: () => setState((p: any) => ({ ...p, onboarded: false }))
  }
  runCommandRef.current = runCommand
  apiRef.current = api
  if (typeof window !== 'undefined') {
    ;(window as any).__habitRunCommand = runCommand
    ;(window as any).__habitAssistant = (m: string) => setState((s2: any) => ({ ...s2, assistantResponse: m }))
    ;(window as any).__habitApp = () => apiRef.current
  }

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

function subscribeSpeaking(fn: (b: boolean) => void) {
  return (speakingModel as any).__subscribe ? (speakingModel as any).__subscribe(fn) : onSpeakingBridge(fn)
}
function onSpeakingBridge(fn: (b: boolean) => void) {
  let off: any
  import('../speaking/speakingModel').then((m) => {
    off = m.onSpeakingChange(fn)
  })
  return () => off && off()
}
function readV4(): any {
  try { return JSON.parse(readStorage('habitOS_v4_final', '{}')) } catch { return {} }
}
function writeV4(patch: any) {
  const cur = readV4()
  writeStorage('habitOS_v4_final', JSON.stringify({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }))
}
/** Tasks: one list, every entry stamped with its local date, priority-ordered on read. */
function storedTasks(): any[] {
  try {
    const raw = JSON.parse(readStorage('habitOS_tasks', '[]'))
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}
/** A single numeric day-mark (minutes of day) used to pace mid-day playouts. */
function readDayMark(key: string, fallback: number): number {
  try {
    const raw = JSON.parse(readStorage(key, 'null'))
    return typeof raw === 'number' && !Number.isNaN(raw) ? raw : fallback
  } catch { return fallback }
}
function writeDayMark(key: string, value: number) {
  try { writeStorage(key, JSON.stringify(value)) } catch {}
}
function readJSON(k: string, fb: any): any {
  try { return JSON.parse(readStorage(k, JSON.stringify(fb))) } catch { return fb }
}
function waterToday(): number {
  try {
    const logs = JSON.parse(readStorage('habitOS_waterLogs', '[]'))
    const t = todayKey()
    return logs.filter((l: any) => localDayOf(l.date) === t).reduce((a: number, b: any) => a + (b.amount || 0), 0)
  } catch { return 0 }
}