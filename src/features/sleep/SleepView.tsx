import { useEffect, useState, useRef } from 'react'
import { Moon, Sunrise, ZapOff, Clock, Plus, Bell, Trash2, Check, Timer, Activity, BedDouble } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { personality } from '../../speaking/personality'
import { speakingModel } from '../../speaking/speakingModel'
import { DayReport } from './DayReport'

// ============== TYPES ==============
type ShortTask = {
  id: string
  label: string
  type: 'alarm' | 'reminder'
  fireAt: string // ISO
  createdAt: string
  status: 'pending' | 'ringing' | 'done'
  snoozeCount: number
}

// ============== BACKEND HOOKS - LEAVE ENDS ==============
const API = {
  async saveSleepSession(start: string, end: string, idleMinutes: number) {
    // TODO: POST /api/sleep/session { start, end, idleMinutes }
    console.log('[BACKEND] saveSleep', start, end, idleMinutes)
  },
  async saveAlarm(alarm: ShortTask) {
    // TODO: POST /api/alarms
  },
  async deleteAlarm(id: string) {
    // TODO: DELETE /api/alarms/:id
  }
}

export default function SleepView({ onCommand }: any) {
  const { bedtime, alarmTime, setShowSkipConfirm, setSkipTarget, skips, ringAlarm, answerAlarm } = useApp() as any
  const isSkipped = (skips || []).some((k: any) => k.streakId === 'sleep' && new Date() <= new Date(k.endDate))

  // --- SHORT ALARMS / REMINDERS (ABOVE) ---
  const [shortTasks, setShortTasks] = useState<ShortTask[]>(() => {
    try { return JSON.parse(localStorage.getItem('habitOS_shortAlarms') || '[]') } catch { return [] }
  })
  const [newLabel, setNewLabel] = useState('')
  const [newMinutes, setNewMinutes] = useState('30')

  // --- SLEEP CYCLE TRACKING (TOP GRAPHIC) ---
  const [idleMinutes, setIdleMinutes] = useState(0)
  const [isSleeping, setIsSleeping] = useState(false)
  const lastActivityRef = useRef<number>(Date.now())

  // Idle detection for sleep tracking - PRD requirement: track when tool idle at night
  useEffect(() => {
    const onActivity = () => { lastActivityRef.current = Date.now(); setIdleMinutes(0) }
    window.addEventListener('mousemove', onActivity)
    window.addEventListener('keydown', onActivity)
    window.addEventListener('click', onActivity)

    const idleCheck = setInterval(() => {
      const idle = Math.floor((Date.now() - lastActivityRef.current) / 60000)
      setIdleMinutes(idle)
      const hour = new Date().getHours()
      const isNight = hour >= 22 || hour <= 7
      if (isNight && idle > 5) {
        if (!isSleeping) {
          setIsSleeping(true)
          // TODO: backend start sleep session
        }
      } else {
        if (isSleeping && idle < 2) {
          setIsSleeping(false)
          API.saveSleepSession(new Date(Date.now() - idle * 60000).toISOString(), new Date().toISOString(), idle)
        }
      }
    }, 10000)

    return () => {
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('click', onActivity)
      clearInterval(idleCheck)
    }
  }, [isSleeping])

  // Persist short tasks
  useEffect(() => {
    localStorage.setItem('habitOS_shortAlarms', JSON.stringify(shortTasks))
  }, [shortTasks])

  // central engine owns ringing; re-sync component when it writes
  useEffect(() => {
    const onSync = () => {
      try {
        const next = JSON.parse(localStorage.getItem('habitOS_shortAlarms') || '[]')
        setShortTasks(next)
      } catch {}
    }
    window.addEventListener('habit:alarms-updated', onSync)
    return () => window.removeEventListener('habit:alarms-updated', onSync)
  }, [])

  // The AppContext engine owns the ringing + the full-screen alarm overlay. This view only
  // lists and edits the schedule, so the nag can never double-fire from two places.
  const ringingTask = (ringAlarm && ringAlarm.kind === 'short') ? shortTasks.find((t) => t.id === ringAlarm.id) || null : null
  useEffect(() => {
    if (ringAlarm && ringAlarm.kind === 'short') {
      setShortTasks((prev) => prev.map((p) => (p.id === ringAlarm.id ? { ...p, status: 'ringing' } : p)))
    }
  }, [ringAlarm])

  // --- ACTIONS ---
  const addShortTask = (type: 'alarm' | 'reminder' = 'reminder') => {
    const minutes = Number.isNaN(parseInt(newMinutes)) ? 30 : parseInt(newMinutes)
    const label = newLabel || (type === 'alarm'? `Wakeup in ${minutes} minutes` : `Reminder in ${minutes} minutes`)
    const fireAt = new Date(Date.now() + minutes * 60000).toISOString()
    const task: ShortTask = {
      id: Date.now().toString(),
      label,
      type,
      fireAt,
      createdAt: new Date().toISOString(),
      status: 'pending',
      snoozeCount: 0
    }
    setShortTasks(prev => [...prev, task])
    API.saveAlarm(task)
    setNewLabel('')
    speakingModel.speak(`Okay, ${type} set for ${minutes} minutes`)
  }

  // Voice hook: "wakeup in 30 minutes"
  const addQuickWakeup = (minutes: number) => {
    setNewMinutes(String(minutes))
    addShortTask('alarm')
  }

  // Expose for voice commands - attach to window
  useEffect(() => {
    const api = {
      wakeupIn: addQuickWakeup,
      remindMe: (mins: number, label: string) => {
        setNewLabel(label)
        setNewMinutes(String(mins))
        setTimeout(() => addShortTask('reminder'), 100)
      }
    }
    ;(window as any).habitSleepAPI = api
    const onWake = (e: any) => api.wakeupIn(Number(e.detail) || 30)
    window.addEventListener('habit:wakeup-in', onWake)
    return () => window.removeEventListener('habit:wakeup-in', onWake)
  }, [])

  const completeTask = (id: string) => {
    if (ringAlarm?.id === id) { answerAlarm('close'); return }
    setShortTasks(prev => prev.filter(t => t.id !== id))
    API.deleteAlarm(id)
    speakingModel.speak('Done, clearing it')
  }

  const postponeTask = (id: string, addMins = 10) => {
    if (ringAlarm?.id === id) { answerAlarm('snooze', addMins); return }
    setShortTasks(prev => prev.map(t => t.id === id ? { ...t, fireAt: new Date(Date.now() + addMins * 60000).toISOString(), status: 'pending', snoozeCount: t.snoozeCount + 1 } : t))
    speakingModel.speak(`Postponed for ${addMins} minutes`)
  }

  return (
    <div className="p-4 space-y-4 bg-[#0f0f12] min-h-full">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-widest text-white flex items-center gap-2"><Moon className="w-4 h-4 text-violet-400" /> SLEEP • ANALYSIS • ALARMS</h2>
        <button onClick={() => { setSkipTarget({ id: 'sleep', name: 'Sleep' }); setShowSkipConfirm(true) }} className={isSkipped? 'px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/20 text-xs text-amber-200' : 'px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs'}>{isSkipped? 'Skipped' : 'Skip N days'}</button>
      </div>

      {/* ---------- real report: derived from the day you actually started and closed ---------- */}
      <DayReport idleMinutes={idleMinutes} isSleeping={isSleeping} />

      {/* MIDDLE - SHORT ALARMS & REMINDERS (ABOVE) */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0"><Timer className="w-4 h-4 text-amber-400 shrink-0" /><div className="text-xs font-semibold tracking-widest text-white whitespace-nowrap">SHORT ALARMS &amp; REMINDERS • ONE-TIME</div><div className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 shrink-0">{shortTasks.length} active</div></div>
          <div className="text-[11px] text-white/25">say “wakeup in 30 minutes” or “remind me to stretch in 20 minutes”</div>
        </div>

        {/* Add new */}
        <div className="flex gap-2 mb-3 bg-[#0e0e12] border border-white/5 rounded-xl p-2">
          <input value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="Label - e.g. wakeup, drink water, call..." className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-sm text-white placeholder:text-white/20 focus:outline-none" />
          <input value={newMinutes} onChange={e=>setNewMinutes(e.target.value)} type="number" className="w-20 px-2 py-2 rounded-xl bg-[#141418] border border-white/10 text-sm text-white" />
          <span className="py-2 text-xs text-white/30">min</span>
          <button onClick={()=>addShortTask('reminder')} className="px-3 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Bell className="w-3 h-3" /> Remind</button>
          <button onClick={()=>addShortTask('alarm')} className="px-3 py-2 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white text-xs font-semibold flex items-center gap-1"><Clock className="w-3 h-3" /> Alarm</button>
        </div>

        {/* List */}
        <div className="space-y-2">
          {shortTasks.length===0? <div className="text-xs text-white/20 py-4 text-center">No short alarms — try voice "wakeup in 30 minutes"</div> : shortTasks.map(t=>(
            <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border ${t.status==='ringing'? 'bg-amber-500/10 border-amber-500/30 animate-pulse' : 'bg-[#0e0e12] border-white/5'}`}>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${t.type==='alarm'? 'bg-violet-500/20' : 'bg-white/5'}`}><Clock className="w-4 h-4 text-white/60" /></div>
              <div className="flex-1">
                <div className="text-sm text-white flex items-center gap-2">{t.label} {t.status==='ringing' && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500 text-white">RINGING</span>}</div>
                <div className="text-xs text-white/30">Fires: {new Date(t.fireAt).toLocaleTimeString()} • {t.snoozeCount? `snoozed ${t.snoozeCount}x` : 'one-time'} • {t.type}</div>
              </div>
              {t.status==='ringing'? (
                <div className="flex gap-2">
                  <button onClick={()=>completeTask(t.id)} className="px-3 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Done</button>
                  <button onClick={()=>postponeTask(t.id, 10)} className="px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white/60">Snooze 10m</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={()=>postponeTask(t.id, 10)} className="text-xs text-white/30 hover:text-white">Postpone</button>
                  <button onClick={()=>completeTask(t.id)} className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center"><Trash2 className="w-4 h-4 text-white/40" /></button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Ringing Modal */}
        {ringingTask && (
          <div className="mt-3 p-3 rounded-xl bg-gradient-to-br from-amber-500/20 to-red-500/20 border border-amber-500/30 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500 animate-ping flex items-center justify-center"><Bell className="w-5 h-5 text-white" /></div>
            <div><div className="text-sm font-semibold text-white">{personality.getAIName()} says: {ringingTask.label} — use the full-screen alarm to snooze or close.</div><div className="text-xs text-white/50">Voice: “stop alarm” / “snooze 10 minutes”</div></div>
          </div>
        )}
      </div>

      {/* Daily recurring alarms were removed: the wake alarm from Settings plus the day plan
          (water, drinks, rituals, workouts, tasks) decide what fires and when. */}

      {isSkipped && <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-200 flex items-center gap-1"><ZapOff className="w-3 h-3" /> Sleep skipped today — not counted as failure</div>}

    </div>
  )
}