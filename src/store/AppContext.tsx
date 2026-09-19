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
import { parseVoiceCommand, stripWakeWord, type ParsedCommand, type RitualTab, type Tab } from '../core/commandRouter'
import * as voice from '../core/voiceEngine'
import { notify, requestNotifyPermission, writeStorage, readStorage } from '../lib/db'
import {
  dayRecord, setDay, markAlarmClosed, markSnoozed, startDay as flowStartDay, endDay as flowEndDay,
  inAwakeWindow, activeMinutes, drinksOn, workoutSlots, ritualDoneToday, markRitualDone
} from '../core/dayFlow'
export type { Phase } from '../core/dayFlow'
import { playlist, type PlayMode } from '../core/playlist'
import { buildBriefing, tasksOn, type Briefing } from '../core/dayFlow'
import { clockNow, minutesNow, todayKey, tomorrowKey, dayKey, localDayOf, weekdayOf, onClock, onNewDay, systemClock, midpointOf, toMinutes } from '../lib/clock'
import { resolveMedia } from '../lib/mediaStore'
import { buildDayPlan, summarizePlan, planStatusLine, toArmable, buildArmedList, reslotMorningItems, pendingVoiceLine, pendingItems, type PlanInput, type PlanItem } from '../core/planner'
import { cleanAllHabitData } from '../lib/migrate'
import { readWorkoutRows } from '../lib/workoutData'
import { armReminders, clearReminders, onReminderEvents, isDesktop, setBackgroundMode, reminderStatus } from '../lib/desktop'
import { audioBus } from '../core/audioBus'


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
  alarmEnabled: true,
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
  // nothing pretends to be data: the water plan comes from the Water goal setting, workouts
  // from the Workout page, steaks from the Steaks page
  streaks: [] as any[],
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
  playlistVolume: 0.55,
  wakeMusic: true,
  playingPlaylist: false,
  // ---- daytime playouts ----
  affirmPlayout: true,
  secondaryNudges: true,
  activeDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as string[],
  waterGoal: 3000,
  waterSplit: 6,
  // ---- the day plan (planner.ts) ----
  plan: [] as PlanItem[],
  planDone: [] as string[],
  planNotified: [] as string[],
  affirmCard: null as null | { text: string; at: number },
  affirmPlaying: false,
  voicePendingRecap: true,
  recapEveryMin: 30,
  reminderGapMin: 25,
  voiceWaterSips: true,
  missed: [] as any[],
  desktopAlerts: false,
  // ---- wake-up flow ----
  ringAlarm: null as null | { id: string; label: string; time: string; kind: 'daily' | 'short' },
  briefing: null as Briefing | null,
  dayPhase: 'unstarted' as string,
  dayStartedAt: null as null | string
}

/**
 * Whatever survived in localStorage / the SQLite mirror has to be coerced into the shapes the
 * screens assume, or a single corrupt collection takes the whole app into the error boundary.
 */
function sanitizeState(st: any): any {
  const arr = (v: any, fb: any[] = []) => (Array.isArray(v) ? v : fb)
  const obj = (v: any, fb: Record<string, any> = {}) => (v && typeof v === 'object' && !Array.isArray(v) ? v : fb)
  const str = (v: any, fb: string) => (typeof v === 'string' && v ? v : fb)
  const out = { ...st }
  for (const k of ['steaks', 'tasks', 'projects', 'dailyLogs', 'skips', 'pauses', 'skippedFeatures', 'affirmations', 'reminderLog', 'voiceHistory', 'plan', 'planDone', 'planNotified', 'missed', 'playlistTracks', 'activeDays', 'workouts', 'catchUp', 'speechVoices', 'micBars']) {
    out[k] = arr(out[k], (defaultDB as any)[k] ?? [])
  }
  out.profile = obj(out.profile, (defaultDB as any).profile)
  out.day = obj(out.day, {})
  out.tasks = out.tasks.filter((t: any) => t && typeof t === 'object' && typeof t.title === 'string')
  out.steaks = out.steaks.filter((x: any) => x && typeof x === 'object' && typeof x.name === 'string').map((x: any) => ({ ...x, completed: arr(x.completed) }))
  out.projects = out.projects.filter((x: any) => x && typeof x === 'object' && typeof x.name === 'string')
  out.dailyLogs = out.dailyLogs.filter((x: any) => x && typeof x === 'object')
  out.plan = out.plan.filter((x: any) => x && typeof x === 'object' && typeof x.id === 'string' && Number.isFinite(x.at))
  out.planDone = out.planDone.filter((x: any) => typeof x === 'string')
  out.planNotified = out.planNotified.filter((x: any) => typeof x === 'string')
  out.reminderLog = out.reminderLog.filter((x: any) => typeof x === 'string')
  out.playlistTracks = out.playlistTracks.filter((x: any) => x && typeof x.id === 'string')
  out.alarmTime = str(out.alarmTime, '06:00')
  out.bedtime = str(out.bedtime, '22:00')
  out.aiName = str(out.aiName, 'Habi')
  out.wakeWord = str(out.wakeWord, 'hey habi')
  out.briefing = out.briefing && typeof out.briefing === 'object' ? out.briefing : null
  out.affirmCard = out.affirmCard && typeof out.affirmCard === 'object' ? out.affirmCard : null
  out.ringAlarm = out.ringAlarm && typeof out.ringAlarm === 'object' ? out.ringAlarm : null
  const day = out.day as any
  if (day.phase && !['unstarted', 'snoozed', 'ringing', 'briefing', 'active', 'ended'].includes(day.phase)) day.phase = 'unstarted'
  if (day.startedAt && Number.isNaN(Date.parse(day.startedAt))) day.startedAt = null
  if (day.endedAt && Number.isNaN(Date.parse(day.endedAt))) day.endedAt = null
  out.dayStartedAt = day.startedAt || null
  out.dayPhase = day.phase || 'unstarted'
  return out
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<any>(() => {
    try {
      const raw = localStorage.getItem('habitOS_v4_final')
      const aiName = safeGet('habitOS_aiName', 'Habi')
      const voiceURI = safeGet('habitOS_voiceURI', '')
      const persisted = raw ? JSON.parse(raw) : {}
      const hydrated = {
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
      return sanitizeState(hydrated)
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
  const lastSpokenRef = useRef<number>(0)
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
        if ((rec.phase === 'unstarted' || rec.phase === 'snoozed') && st.alarmTime && st.alarmEnabled !== false) {
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

        // ---- 3. the day plan: one list, built by planner.ts, armed with the OS -------
        const planItems: any[] = st.plan || []
        // planDone = you actually finished it. planNotified = it was already said out loud.
        // Conflating those two is what reported overdue work as complete.
        const firedSet = new Set<string>((Array.isArray(st.planDone) ? st.planDone : []).map(String))
        const saidSet = new Set<string>((Array.isArray(st.planNotified) ? st.planNotified : []).map(String))
        const log = (line: string) => {
          const entry = `${hhmm} • ${line}`
          const prev = (readV4().reminderLog || []).filter((r: string) => r !== entry)
          const nextLog = [entry, ...prev].slice(0, 60)
          writeV4({ reminderLog: nextLog })
          setState((p: any) => ({ ...p, reminderLog: nextLog }))
        }
        const commitFired = (id: string) => {
          firedSet.add(id)
          // planNotified = "I already said this out loud", NOT "it is finished". Keeping the two
          // apart is what stopped overdue items from being reported as done.
          const list = [...new Set([...(st.planNotified || []).filter(String), id])].slice(-400)
          writeV4({ planNotified: list })
          setState((p: any) => ({ ...p, planNotified: list }))
        }
        if (rec.phase === 'active') {
          // One item per tick AND at least reminderGapMin between any two spoken reminders, so a
          // backlog of overdue sips can never drip every 20 seconds. The rest stay on screen as
          // pending/late: nothing gets marked complete by the clock.
          const notDone = planItems.filter((i: any) => !firedSet.has(i.id) && !saidSet.has(i.id))
          const due = notDone.filter((i: any) => i.at <= now.getTime() + 60000)
            .sort((a: any, b: any) => a.at - b.at)
          const gapMs = Math.max(5, Number(st.reminderGapMin) || 20) * 60000
          const throttled = due.length && (now.getTime() - lastSpokenRef.current < gapMs)
          const batch: any[] = throttled ? [] : due.slice(0, 1)
          const backlog = due.length - (batch[0] ? 1 : 0)
          if (batch.length) lastSpokenRef.current = now.getTime()
          for (const item of batch) {
            if (dayController.isPaused()) break
            const isWorkout = item.kind === 'workout-primary' || item.kind === 'workout-secondary'
            const isMilestone = item.kind === 'midpoint' || item.kind === 'bedtime'
            const skippedFeature = item.kind === 'water' || item.kind === 'drink' ? 'water' : item.kind === 'ritual' ? item.title.toLowerCase() : ''
            if (skippedFeature && dayController.isSkipped(skippedFeature)) { commitFired(item.id); continue }
            if (isMilestone) {
              // milestones are spoken, they are not system notifications
              commitFired(item.id)
              log(item.title)
              const summary = summarizePlan(planInputRef.current, planItems, firedSet)
              const workoutPct = summary.workoutTotal ? Math.round((summary.workoutDone / summary.workoutTotal) * 100) : 100
              setState((p: any) => ({ ...p, assistantResponse: item.title + ' • ' + planStatusLine(summary) }))
              speakingModel.speak(item.kind === 'midpoint'
                ? `Half of the day is gone. Your workout is ${workoutPct} percent done.${summary.morningOpen.length ? ` Still to finish from the morning set: ${summary.morningOpen.slice(0, 3).map((m: any) => m.title).join(', ')}.` : ' The morning set is clear.'}`
                : 'Twenty minutes until bedtime. Close the day when you are ready.')
              continue
            }
            const late = now.getTime() - item.at > 5 * 60000
            commitFired(item.id)
            log(item.title + (item.body ? ' • ' + item.body : ''))
            const recap = st.voicePendingRecap === false ? '' : pendingVoiceLine(planItems, firedSet, now.getTime())
            const backlogLine = backlog > 0 ? ` ${backlog} more item${backlog === 1 ? '' : 's'} still open from earlier.` : ''
            if (isWorkout) {
              setState((p: any) => ({
                ...p,
                showWorkoutPopup: true,
                workoutPopupTask: item.workout || { name: item.title, reps: item.body },
                assistantResponse: `${late ? 'Overdue — ' : ''}${item.title}. ${item.body}`
              }))
              speakingModel.speak(`${late ? 'This is overdue. ' : ''}${item.title}. ${item.body}${backlogLine}${recap ? ' ' + recap : ''}`)
              continue
            }
            const line = `${late ? 'Running late — ' : ''}${item.title}. ${item.body}`
            const quietWaterSip = item.kind === 'water'
            setState((p: any) => ({ ...p, assistantResponse: line + (recap ? ' • ' + recap : '') }))
            if (quietWaterSip && st.voiceWaterSips === false) { /* on screen + pending list only */ }
            else speakingModel.speak(`${line}${backlogLine}${recap ? ' ' + recap : ''}`)
            // only real, actionable reminders reach the OS; milestones and housekeeping do not
            if (!isDesktop() && !quietWaterSip) notify('HABIT.AI — ' + item.title, item.body)
          }
        }

        // ---- 4. affirmations: audio clip or on-screen card, never spoken by the AI ----
        if (st.affirmPlayout && rec.phase === 'active' && !audioBus.isPlaying() && !st.showWorkoutPopup) {
          const gapMin = Math.max(15, Number(st.affirmGapMin) || 60)
          const since = lastAffirmRef.current ? Date.now() - lastAffirmRef.current : Infinity
          const sinceClock = nowMin - readDayMark('habitOS_lastAffirm', 0)
          if (since > gapMin * 60000 && sinceClock >= gapMin) {
            lastAffirmRef.current = Date.now()
            writeDayMark('habitOS_lastAffirm', nowMin)
            void playAffirmation('auto')
          }
        }

        // ---- 5. morning order: primary workout pulled forward once prayers + affirmations are ticked
        if (rec.phase === 'active') {
          const logs = st.dailyLogs || []
          const primaryDue = planItems.find((i: any) => i.kind === 'workout-primary' && !firedSet.has(i.id))
          if (primaryDue && ritualDoneToday('prayer', logs) && ritualDoneToday('affirmations', logs) && primaryDue.at > now.getTime()) {
            primaryDue.at = now.getTime() + 60000   // pull it forward: the next tick fires it
            setState((p: any) => ({ ...p, plan: planItems.map((i: any) => (i.id === primaryDue.id ? { ...i, at: primaryDue.at } : i)) }))
          }
        }

        // ---- 7. bedtime closes the day and sleeps the voice -------------------------
        // Wrap-safe: comparing "22:36" >= "02:00" as strings is true, which used to close the
        // day four hours early. A day ends only inside the window that *starts* at bedtime.
        const bedM = toMinutes(st.bedtime)
        const sinceBed = Number.isNaN(bedM) ? -1 : (((minutesNow(now) - bedM) % 1440) + 1440) % 1440
        if (st.bedtime && sinceBed >= 0 && sinceBed < 120 && rec.phase === 'active' && !wasFired('bed:' + st.bedtime)) {
          markFired('bed:' + st.bedtime, 'bedtime')
          apiRef.current?.endTheDay?.('bedtime')
        }
        const w = waterToday()
        setState((s: any) => (s.water === w ? s : { ...s, water: w }))
      } finally {
        busy = false
      }
    }

    const iv = setInterval(tick, 20000)
    lastSpokenRef.current = 0
    tick()
    ;(globalThis as any).__habitEngineTick = tick
    return () => clearInterval(iv)
  }, [state.streaks])

  /* ------------------------------------------------------------------ *
   * The plan: rebuild it whenever an input changes, mirror it into state,
   * and hand the upcoming items to the OS so they still arrive when the
   * window is hidden to the tray or the app has been closed.
   * ------------------------------------------------------------------ */
  const planInputRef = useRef<PlanInput | null>(null)
  const rebuildPlanRef = useRef<(() => PlanItem[]) | null>(null)
  const armTimerRef = useRef<any>(null)
  const planInputs = [
    state.dayPhase, state.dayStartedAt, state.alarmTime, state.bedtime, state.tasks,
    state.affirmations, state.dailyLogs, state.waterGoal, state.waterSplit, state.activeDays
  ]
  useEffect(() => {
    const build = () => {
      const st = stateRef.current
      const rec = dayRecord()
      const waterGoal = Number(st.waterGoal || readJSON('habitOS_waterGoal', { amount: 3000 }).amount || 3000)
      const input: PlanInput = {
        startHHMM: rec.startedAt ? clockNow(new Date(rec.startedAt)) : (st.alarmTime || '06:00'),
        bedtimeHHMM: st.bedtime || '22:00',
        dayStartedAt: rec.startedAt,
        waterGoalMl: waterGoal,
        waterSplit: Math.max(1, Math.min(12, Number(st.waterSplit || Math.round(waterGoal / 500)) || 6)),
        drinks: readJSON('habitOS_weeklyDrinks', []),
        ritualTasks: readJSON('habitOS_ritualTasks', {}),
        workouts: readWorkoutRows(),
        tasks: planTasks(),
        vizCount: readJSON('habitOS_vizSlides', []).length,
        activeDays: st.activeDays,
        date: todayKey()
      }
      planInputRef.current = input
      const items = buildDayPlan(input)
      setState((p: any) => {
        const same = p.plan.length === items.length && p.plan.every((i: any, k: number) => i.id === items[k].id && i.at === items[k].at)
        return same ? p : { ...p, plan: items }
      })
      return items
    }
    rebuildPlanRef.current = build
    const items = build()
    // arm for the OS (also re-armed after every fire, sleep resume and day-phase change)
    clearTimeout(armTimerRef.current)
    armTimerRef.current = setTimeout(() => {
      const rec = dayRecord()
      const armed = buildArmedList(items, {
        alarmTime: stateRef.current.alarmTime,
        alarmEnabled: stateRef.current.alarmEnabled !== false,
        dayPhase: rec.phase,
        shortAlarms: readJSON('habitOS_shortAlarms', [])
      })
      armReminders(armed).then((res: any) => {
        setState((p: any) => ({ ...p, desktopAlerts: !!res?.supported, armedCount: res?.armed ?? armed.length }))
      }).catch(() => undefined)
    }, 400)
  }, [...planInputs, state.plan.length])

  /** Desktop notifications / sleep-wake resync / missed digest. */
  useEffect(() => {
    const off = onReminderEvents({
      fired: (r: any) => {
        const id = String(r?.id || '').replace(/^plan:/, '')
        setState((p: any) => {
          const doneList = (p.planDone || []).includes(id) ? p.planDone : [...(p.planDone || []), id]
          writeV4({ planDone: doneList.slice(-400) })
          return { ...p, planDone: doneList.slice(-400), lastAlert: r }
        })
      },
      clicked: (r: any) => {
        const go = r?.go
        if (go) setState((p: any) => ({ ...p, activeTab: go }))
      },
      missed: (list: any[]) => {
        setState((p: any) => ({
          ...p,
          missed: list.map((m: any) => ({ ...m, seenAt: Date.now() })),
          assistantResponse: `While you were away: ${list.map((m: any) => m.title.replace('HABIT.AI — ', '')).join(', ')}`
        }))
      },
      resync: (info: any) => {
        // OS clock is the authority: after sleep/resume, rebuild the plan against real time
        if (info?.reason === 'resume' || info?.reason === 'unlock') {
          writeV4({ clockResyncAt: Date.now() })
          window.dispatchEvent(new CustomEvent('habit:resync', { detail: info }))
        }
      }
    })
    reminderStatus().then((st: any) => setState((p: any) => ({ ...p, desktopAlerts: !!st?.supported, backgroundMode: !!st?.backgroundMode })))
    return off
  }, [])

    function startHHMMFor(st: any, rec: any): string {
    return rec.startedAt ? clockNow(new Date(rec.startedAt)) : (st.alarmTime || '06:00')
  }
  function countTasksToday(): number {
    const all = storedTasks()
    return all.filter((t: any) => t.kind === 'daily' || localDayOf(t.date || todayKey()) === todayKey()).length
  }
  /** today's queue = daily tasks not yet ticked today + one-time tasks dated today */
  function planTasks(): any[] {
    const today = todayKey()
    const doneToday = readStoredRecord('habitOS_taskDone')
    return storedTasks().filter((t: any) => {
      if (t.kind === 'daily') return doneToday[t.id] !== today
      return localDayOf(t.date || today) === today && t.status !== 'done'
    })
  }
  /** re-arm immediately when a view changes anything the plan derives from */
  useEffect(() => {
    const rebuild = () => {
      const items = rebuildPlanRef.current?.()
      if (items) {
        const armed = buildArmedList(items, { alarmTime: stateRef.current.alarmTime, alarmEnabled: stateRef.current.alarmEnabled !== false, dayPhase: dayRecord().phase, shortAlarms: readJSON('habitOS_shortAlarms', []) })
        armReminders(armed)
      }
    }
    window.addEventListener('habit:plan-dirty', rebuild)
    return () => window.removeEventListener('habit:plan-dirty', rebuild)
  }, [])

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
      // the day plan, the announced marks and the completion marks are all per calendar day
      writeV4({ plan: [], planDone: [], planNotified: [] })
      setState((p: any) => ({ ...p, dayPhase: 'unstarted', dayStartedAt: null, ringAlarm: null, briefing: null, catchUp: [], plan: [], planDone: [], planNotified: [], assistantResponse: `New day • ${today}. ${p.alarmEnabled === false ? 'No alarm set — press Start the day when you are up.' : `Alarm at ${p.alarmTime}, nothing runs until you start.`}` }))
      const rebuilt = rebuildPlanRef.current?.()
      if (rebuilt) armReminders(buildArmedList(rebuilt, { alarmTime: stateRef.current.alarmTime, alarmEnabled: stateRef.current.alarmEnabled !== false, dayPhase: 'unstarted', shortAlarms: readJSON('habitOS_shortAlarms', []) }))
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
  const affirmClipRef = useRef<HTMLAudioElement | null>(null)

  const playAffirmation = useCallback(async (source: 'auto' | 'voice' = 'voice') => {
    const st = stateRef.current
    if (st.globalMuted || dayController.isPaused()) return
    const texts: any[] = readJSON('habitOS_affirmations', [])
    const audios: any[] = readJSON('habitOS_affAudios', [])
    const pool = texts.map((t: any) => (typeof t === 'string' ? t : t?.text)).filter(Boolean)
    if (!pool.length && !audios.length) {
      setState((p: any) => ({ ...p, assistantResponse: 'No affirmations saved yet — add them in Rituals • Affirmations.' }))
      return
    }
    // the line is always shown on the right rail; a clip is played if you uploaded one
    const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''
    setState((p: any) => ({ ...p, affirmCard: { text: pick, at: Date.now() } }))
    if (!audios.length) return
    if (!audioBus.claim('affirmation')) return
    const a = audios[Math.floor(Math.random() * audios.length)]
    const url = await resolveMedia(a.url)
    if (!url) { audioBus.release('affirmation'); return }
    const el = affirmClipRef.current || new Audio()
    affirmClipRef.current = el
    el.src = url
    el.volume = Math.max(0, Math.min(1, Number(st.playlistVolume ?? 0.55)))
    el.onended = () => { audioBus.release('affirmation'); setState((p: any) => ({ ...p, affirmPlaying: false })) }
    el.onerror = () => { audioBus.release('affirmation'); setState((p: any) => ({ ...p, affirmPlaying: false })) }
    try { await el.play(); setState((p: any) => ({ ...p, affirmPlaying: true })) } catch { audioBus.release('affirmation') }
    void source
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
        // "mild": the playlist eases in under whatever the AI just finished saying
        playlist.setDuck(0.55)
        const started = await playlist.resumeOrPlay()
        if (!started) playlist.next()
        setTimeout(() => playlist.setDuck(1), 30000)
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
      // the transcript usually arrives with the wake word still glued to it ("hey nico water")
      const spoken = stripWakeWord(raw, `${stateRef.current.aiName || 'habi'} ${(stateRef.current.wakeWord || '').replace(/^hey\s+/, '')}`.trim())
      const cmd: ParsedCommand = parseVoiceCommand(spoken || raw)
      const set = (p: any) =>
        typeof p === 'function'
          ? setState((prev: any) => ({ ...prev, ...p(prev) }))
          : setState((prev: any) => ({ ...prev, ...p }))
      /**
       * Talk-back policy: the AI confirms out loud only for things that need doing
       * (a reminder, a task, the day opening/closing). Navigation and switching are
       * written to the command bar silently — speaking over every button press was noise.
       */
      const reply = (text: string, opts: { speak?: boolean; key?: string; vars?: any } = {}) => {
        set({ transcript: raw, lastAction: cmd.kind, assistantResponse: text })
        if (opts.speak) {
          if (opts.key) speakingModel.speakRandom(opts.key, opts.vars)
          else speakingModel.speak(text)
        }
        pushHistory(raw, cmd.kind, text)
      }
      const pushHistory = (t: string, action: string, res: string) =>
        set((prev: any) => ({ ...prev, voiceHistory: [{ id: Date.now().toString(), cmd: t, action, time: new Date().toLocaleTimeString(), ok: true }, ...(prev.voiceHistory || [])].slice(0, 30) }))

      switch (cmd.kind) {
        case 'navigate':
          if (cmd.tab) {
            set({ activeTab: cmd.tab })
            reply(`Opened ${cmd.tab}.`)
          }
          break
        case 'ritual':
          set({ activeTab: 'Rituals' })
          if (cmd.ritual) set({ ritualTab: cmd.ritual })
          reply(`Rituals — ${cmd.ritual}.`)
          break
        case 'steaksLeft':
        case 'pendingNow': {
          const open = pendingItems(stateRef.current.plan || [], new Set((stateRef.current.planDone || []).map(String)))
          const line = pendingVoiceLine(stateRef.current.plan || [], stateRef.current.planDone || [])
          set({ transcript: raw, lastAction: 'pendingNow', assistantResponse: line, pendingPanel: true })
          speakingModel.speak(line)
          pushHistory(raw, 'pendingNow', String(open.length))
          break
        }
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
            reply(`${target.name} logged for today.`, { speak: true })
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
            reply(flipped ? `${target.name} day ${idx + 1} un-checked.` : `${target.name} checked in for today.`, { speak: true })
          } else {
            reply('Everything is already checked in today.')
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
            reply(`Steak added: ${item.name}, ${total} days. It lives in the Steaks page — no reminders from it.`)
            set({ showSteaksManager: true })
          } else {
            set({ showSteaksManager: true, transcript: raw, lastAction: 'addSteak', assistantResponse: 'Steaks manager open — type the name and days, then Add.' })
            void 0
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
        case 'openWorkout': {
          // bare "workout" / "random set": open the popup without a specific row
          const named = String(cmd.target || '').trim()
          const rows = readWorkoutRows()
          const hit = named ? rows.find((w: any) => (`${w.name} ${w.reps}`).toLowerCase().includes(named.toLowerCase())) : null
          set({ activeTab: 'Workout', showWorkoutPopup: true, workoutPopupTask: hit ? { ...hit, slot: hit.slot || 'secondary' } : null, transcript: raw })
          reply(hit ? `${hit.name} — go.` : 'Random set ready.', { speak: !!hit })
          pushHistory(raw, 'openWorkout', named || 'random')
          break
        }
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
            act === 'play' ? 'Playing your playlist.' : act === 'pause' || act === 'stop' ? 'Music paused.' : act === 'next' ? 'Next track.' : 'Previous track.'
          )
          pushHistory(raw, 'music:' + act, 'ok')
          break
        }
        case 'fullscreen': {
          set({ activeTab: 'Rituals', ritualTab: cmd.target === 'viz' ? 'Visualization' : 'Prayer', ritualFullscreen: true })
          reply(`Full screen ${cmd.target === 'viz' ? 'visualization' : cmd.target === 'affirmation' ? 'affirmations' : 'prayer'}.`)
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
          if (cmd.action === 'next') apiRef.current?.nextAffirmationCard?.()
          else void playAffirmation('voice')
          reply(cmd.action === 'next' ? 'Next affirmation.' : 'Playing affirmation.')
          pushHistory(raw, 'affirmation', 'ok')
          break
        case 'alarm': {
          if (!cmd.time) break
          const alarms = readJSON('habitOS_dailyAlarms', [])
          const updated = [...alarms, { id: Date.now().toString(), time: cmd.time, label: 'Voice alarm', enabled: true, days: ['daily'], source: 'voice' }]
          writeStorage('habitOS_dailyAlarms', JSON.stringify(updated))
          set({ alarmTime: cmd.time })
          reply(`Alarm set for ${cmd.time}.`, { speak: true })
          break
        }
        case 'wakeupIn': {
          const mins = cmd.minutes || 30
          window.dispatchEvent(new CustomEvent('habit:wakeup-in', { detail: mins }))
          reply(`Alarm in ${mins} minutes. I will nag you until you wake up.`, { speak: true })
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
            reply(`Bedtime set for ${cmd.time}.`)
            pushHistory(raw, 'bedtime', cmd.time)
          }
          break
        case 'volume': {
          const nextV = Math.max(0, Math.min(1, (Number(stateRef.current.volume) || 1) + (cmd.action === 'up' ? 0.15 : -0.15)))
          set({ volume: Math.round(nextV * 20) / 20 })
          reply(cmd.action === 'up' ? `Volume up — ${Math.round(nextV * 100).toString()}%.` : 'Volume down.')
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
          if (!stateRef.current.globalMuted) speakingModel.speakRandom('confused')
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
    // a paused day eats its own time: the first-half items move to what is left, they do not
    // simply go overdue
    try {
      const rebuilt = reslotMorningItems(stateRef.current.plan || [], Date.now(), stateRef.current.bedtime || '22:00')
      writeV4({ planDone: stateRef.current.planDone || [] })
      setState((p: any) => ({ ...p, plan: rebuilt }))
      armReminders(buildArmedList(rebuilt, { alarmTime: stateRef.current.alarmTime, alarmEnabled: stateRef.current.alarmEnabled !== false, dayPhase: dayRecord().phase, shortAlarms: readJSON('habitOS_shortAlarms', []) }))
    } catch {}
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
      assistantResponse: startOfDayLine()
    }))
    // the plan is anchored to the real start minute, so nothing needs rewriting here
    window.dispatchEvent(new CustomEvent('habit:day-started'))
    const dayLine = startOfDayLine()
    speakingModel.speak(dayLine)
    void rec
    if (mode === 'prayer-first') setState((p: any) => ({ ...p, activeTab: 'Rituals', ritualTab: 'Prayer' }))
    void playlist // music already started with the briefing
  }, [])

  const endTheDay = useCallback((reason = 'manual') => {
    const doneToday = readStoredRecord('habitOS_taskDone')
    const all = storedTasks()
    const tasksDone = all.filter((t: any) => (t.kind === 'daily' ? doneToday[t.id] === todayKey() : t.status === 'done')).length
    const rec = flowEndDay(reason, {
      tasksDone,
      tasksTotal: countTasksToday(),
      planFired: (stateRef.current.reminderLog || []).length,
      waterMl: waterToday()
    })
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
    void reason
    window.dispatchEvent(new CustomEvent('habit:day-ended'))
  }, [])

  const completeOnboarding = useCallback((data: any) => {
    const patchObj = {
      onboarded: true,
      userName: String(data.userName || '').trim(),
      aiName: String(data.aiName || 'Habi').trim(),
      wakeWord: String(data.wakeWord || 'hey habi').toLowerCase().trim(),
      // the wizard no longer asks for times; day boundaries are a Settings concern
      alarmTime: data.alarmTime || stateRef.current.alarmTime,
      bedtime: stateRef.current.bedtime,
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
    // recurring alarm list is gone; the wake alarm is the single Settings wake time + the day plan
    setDay({ phase: 'unstarted', startedAt: null, alarmClosedAt: null, endedAt: null, snoozeUntil: null })
    if (data.alarmTime) setState((p: any) => ({ ...p, alarmTime: data.alarmTime }))
    speakingModel.speak(`Got it ${patchObj.userName || 'there'}. I am ${patchObj.aiName}. Wake me with ${patchObj.wakeWord}.`)
  }, [])

  /** the sentence spoken at Start the day: real date, real weekday, real items or "none" */
  function startOfDayLine(): string {
    const st = stateRef.current
    const now = new Date()
    const wd = now.toLocaleDateString([], { weekday: 'long' })
    const dateTxt = now.toLocaleDateString([], { day: 'numeric', month: 'long' })
    const tasks = planTasks()
    const names = tasks.slice(0, 4).map((t: any) => t.title)
    const taskLine = tasks.length
      ? `You have ${tasks.length} task${tasks.length === 1 ? '' : 's'} today: ${names.join(', ')}${tasks.length > 4 ? ', and ' + (tasks.length - 4) + ' more' : ''}.`
      : 'There is no task on the list for today.'
    const { primary } = workoutSlots()
    const wLine = primary.length ? `Primary workout queued: ${primary.slice(0, 2).map((w: any) => w.name).join(', ')}.` : 'No primary workout added yet.'
    const drinks = drinksOn(weekdayOf())
    const dLine = drinks.length ? `Drink plan: ${drinks.slice(0, 3).map((d: any) => `${d.amount}ml ${d.name} at ${d.time}`).join(', ')}.` : 'No drinks scheduled.'
    const open = stateRef.current.plan.filter((i: any) => i.kind !== 'midpoint' && i.kind !== 'bedtime').length
    const projects = (stateRef.current.projects || []).filter((p: any) => (p.progress ?? 0) < 100)
    const pLine = projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'} in flight: ${projects.slice(0, 2).map((p: any) => `${p.name} at ${p.progress ?? 0} percent`).join(', ')}.` : 'No open projects.'
    return `Good morning. It is ${wd}, ${dateTxt}, and the day starts now. ${taskLine} ${pLine} ${wLine} ${dLine} There are ${open} scheduled item${open === 1 ? '' : 's'} on the plan between now and ${st.bedtime || 'bedtime'}.`
  }

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
    setWorkoutPopupTask: (w: any) => setState((s: any) => ({ ...s, workoutPopupTask: w || null })),
    setVoiceMuted: (v: boolean) => setState((s: any) => ({ ...s, globalMuted: !!v })),
    clearMissed: () => { setState((p: any) => ({ ...p, missed: [] })); writeV4({ missed: [] }) },
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
    /* -------- day plan / priority list -------- */
    planItems: state.plan,
    planSummary: () => summarizePlan(planInputRef.current, stateRef.current.plan || [], new Set((stateRef.current.planDone || []).map(String))),
    planLine: () => planStatusLine(summarizePlan(planInputRef.current, stateRef.current.plan || [], new Set((stateRef.current.planDone || []).map(String)))),
    markPlanItem: (id: string, done = true) => {
      const list = new Set((stateRef.current.planDone || []).map(String))
      if (done) list.add(id); else list.delete(id)
      const arr = [...list]
      const notified = new Set((stateRef.current.planNotified || []).map(String))
      if (done) notified.add(id); else notified.delete(id)
      writeV4({ planDone: arr, planNotified: [...notified] })
      setState((p: any) => ({ ...p, planDone: arr, planNotified: [...notified] }))
    },
    /** bulk-complete everything that maps to one habit row */
    completePlanRefs: (match: (i: any) => boolean) => {
      const st = stateRef.current
      const ids = (st.plan || []).filter(match).map((i: any) => i.id)
      if (!ids.length) return
      const done = [...new Set([...(st.planDone || []).map(String), ...ids])]
      writeV4({ planDone: done })
      setState((p: any) => ({ ...p, planDone: done }))
    },
    armPlanNow: () => armReminders(toArmable(stateRef.current.plan || [])),
    desktop: { isDesktop: () => isDesktop(), setBackgroundMode, reminderStatus },
    setWaterPlan: (goalMl: number, split: number) => {
      writeStorage('habitOS_waterGoal', JSON.stringify({ amount: goalMl, name: 'Water' }))
      setState((p: any) => ({ ...p, waterGoal: goalMl, waterSplit: split }))
    },
    /* -------- affirmations (screen only, never spoken by the AI) -------- */
    nextAffirmationCard: () => {
      const pool: any[] = readJSON('habitOS_affirmations', [])
      if (!pool.length) return
      const texts = pool.map((t: any) => (typeof t === 'string' ? t : t?.text)).filter(Boolean)
      const idx = texts.findIndex((x: string) => x === stateRef.current.affirmCard?.text)
      setState((p: any) => ({ ...p, affirmCard: { text: texts[(idx + 1) % texts.length], at: Date.now() } }))
    },
    prevAffirmationCard: () => {
      const pool: any[] = readJSON('habitOS_affirmations', [])
      if (!pool.length) return
      const texts = pool.map((t: any) => (typeof t === 'string' ? t : t?.text)).filter(Boolean)
      const idx = texts.findIndex((x: string) => x === stateRef.current.affirmCard?.text)
      setState((p: any) => ({ ...p, affirmCard: { text: texts[(idx - 1 + texts.length) % texts.length], at: Date.now() } }))
    },
    stopAffirmation: (dismiss = true) => {
      try { affirmClipRef.current?.pause() } catch {}
      audioBus.release('affirmation')
      setState((p: any) => ({ ...p, affirmPlaying: false, affirmCard: dismiss ? null : p.affirmCard }))
    },
    clockInfo: () => systemClock(),
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
    /** Clean slate: habit data goes to zero, names/voice/playlist/day settings stay. */
    resetHabitData: () => {
      try { localStorage.setItem('habitOS_schemaVersion', String(3)) } catch {}
      cleanAllHabitData()
      setState((p: any) => ({
        ...defaultDB,
        // kept on purpose
        onboarded: p.onboarded, userName: p.userName, aiName: p.aiName, wakeWord: p.wakeWord,
        voiceGender: p.voiceGender, pitch: p.pitch, speed: p.speed, volume: p.volume,
        selectedVoiceURI: p.selectedVoiceURI, micPermission: p.micPermission, micSensitivity: p.micSensitivity,
        alwaysOnMic: p.alwaysOnMic, voiceAsleep: p.voiceAsleep,
        playlistTracks: p.playlistTracks, playlistMode: p.playlistMode, playlistVolume: p.playlistVolume,
        wakeMusic: p.wakeMusic, affirmPlayout: p.affirmPlayout, secondaryNudges: p.secondaryNudges,
        affirmGapMin: p.affirmGapMin, activeDays: p.activeDays, alarmTime: p.alarmTime, alarmEnabled: p.alarmEnabled,
        bedtime: p.bedtime, backgroundMode: p.backgroundMode,
        dayPaused: false, dayPhase: 'unstarted', dayStartedAt: null, ringAlarm: null, briefing: null, affirmCard: null
      }))
      setDay({ phase: 'unstarted', startedAt: null, alarmClosedAt: null, endedAt: null, snoozeUntil: null })
      clearReminders()
      window.dispatchEvent(new CustomEvent('habit:data-reset'))
      window.dispatchEvent(new CustomEvent('habit:plan-dirty'))
      return true
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
/** Object map straight out of storage, shape-checked. */
function readStoredRecord(key: string): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

/** Tasks: one list, one shape. Entries predate the daily/one-time split, so normalise. */
function storedTasks(): any[] {
  try {
    const raw = JSON.parse(readStorage('habitOS_tasks', '[]'))
    if (!Array.isArray(raw)) return []
    return raw.map((t: any) => ({
      ...t,
      kind: t.kind === 'daily' || /\bdaily\b/i.test(String(t.title || '')) ? (t.kind === 'once' ? 'once' : 'daily') : 'once',
      priority: t.priority === 'high' ? 'high' : 'normal',
      date: t.date || dayKey(new Date(t.reminderAt || t.createdAt || Date.now()))
    }))
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
/**
 * Shape-checked: an array fallback always returns an array and an object fallback always an
 * object, so a cleared or half-written key cannot crash a caller that is about to .filter() it.
 */
function readJSON(k: string, fb: any): any {
  const clone = (v: any) => (typeof v === 'string' ? v : JSON.parse(JSON.stringify(v)))
  try {
    const parsed = JSON.parse(readStorage(k, JSON.stringify(fb)))
    if (Array.isArray(fb)) return Array.isArray(parsed) ? parsed : fb
    if (fb && typeof fb === 'object') return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fb
    return parsed === null || parsed === undefined ? fb : parsed
  } catch { return clone(fb) }
}
function waterToday(): number {
  try {
    const logs = JSON.parse(readStorage('habitOS_waterLogs', '[]'))
    const t = todayKey()
    return logs.filter((l: any) => localDayOf(l.date) === t).reduce((a: number, b: any) => a + (b.amount || 0), 0)
  } catch { return 0 }
}