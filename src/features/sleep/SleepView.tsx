import { useEffect, useState, useRef } from 'react'
import { Moon, Sunrise, ZapOff, Clock, Plus, Bell, Trash2, Check, Timer, Activity, BedDouble } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { personality } from '../../speaking/personality'
import { speakingModel } from '../../speaking/speakingModel'

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

type DailyAlarm = {
  id: string
  time: string // HH:MM
  label: string
  enabled: boolean
  days: string[] // mon-sun or daily
  source: 'voice' | 'manual'
}

type SleepPoint = { hour: string, deep: number, light: number, awake: number }

// ============== BACKEND HOOKS - LEAVE ENDS ==============
const API = {
  async fetchSleepHistory(): Promise<SleepPoint[]> {
    // TODO: Connect to backend - GET /api/sleep/history
    // return await fetch('/api/sleep').then(r=>r.json())
    return []
  },
  async saveSleepSession(start: string, end: string, idleMinutes: number) {
    // TODO: POST /api/sleep/session { start, end, idleMinutes }
    console.log('[BACKEND] saveSleep', start, end, idleMinutes)
  },
  async saveAlarm(alarm: DailyAlarm | ShortTask) {
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

  // --- DAILY ALARMS (BELOW) ---
  const [dailyAlarms, setDailyAlarms] = useState<DailyAlarm[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('habitOS_dailyAlarms') || '[]')
      if (saved.length) return saved
      return [
        { id: '1', time: alarmTime || '06:00', label: 'Morning wakeup + prayer', enabled: true, days: ['daily'], source: 'manual' },
        { id: '2', time: '22:00', label: 'Bedtime wind-down', enabled: true, days: ['daily'], source: 'manual' }
      ]
    } catch { return [] }
  })

  // --- SLEEP CYCLE TRACKING (TOP GRAPHIC) ---
  const [sleepData] = useState<SleepPoint[]>([
    { hour: '11p', deep: 20, light: 10, awake: 0 },
    { hour: '12a', deep: 80, light: 20, awake: 0 },
    { hour: '1a', deep: 60, light: 30, awake: 10 },
    { hour: '2a', deep: 70, light: 20, awake: 5 },
    { hour: '3a', deep: 30, light: 60, awake: 10 },
    { hour: '4a', deep: 20, light: 70, awake: 5 },
    { hour: '5a', deep: 10, light: 50, awake: 20 },
    { hour: '6a', deep: 0, light: 30, awake: 60 },
  ])
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

  useEffect(() => {
    localStorage.setItem('habitOS_dailyAlarms', JSON.stringify(dailyAlarms))
  }, [dailyAlarms])

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

  const toggleDaily = (id: string) => {
    setDailyAlarms(prev => prev.map(a => a.id === id? {...a, enabled:!a.enabled } : a))
  }

  return (
    <div className="p-4 space-y-4 bg-[#0f0f12] min-h-full">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-widest text-white flex items-center gap-2"><Moon className="w-4 h-4 text-violet-400" /> SLEEP • ANALYSIS • ALARMS</h2>
        <button onClick={() => { setSkipTarget({ id: 'sleep', name: 'Sleep' }); setShowSkipConfirm(true) }} className={isSkipped? 'px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/20 text-xs text-amber-200' : 'px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs'}>{isSkipped? 'Skipped' : 'Skip N days'}</button>
      </div>

      {/* TOP - SLEEP ANALYSIS GRAPHIC */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0e0e12] border border-white/10 flex items-center justify-center"><BedDouble className="w-5 h-5 text-violet-400" /></div>
            <div>
              <div className="text-xs tracking-widest text-white/40">SLEEP CYCLE • LAST NIGHT • AUTO TRACK</div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">{isSleeping? <span className="flex items-center gap-1 text-green-400"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Sleeping • {idleMinutes}m idle</span> : `Awake • Idle ${idleMinutes}m`} • Bed {bedtime || '11:42 PM'} → {alarmTime || '7:42 AM'}</div>
            </div>
          </div>
          <div className="text-xs text-white/20">Source: idle state + mouse/keyboard</div>
        </div>

        {/* Graph */}
        <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2 text-xs text-white/40"><Activity className="w-3 h-3" /> Deep • Light • Awake</div>
            <div className="text-xs text-white/20">Auto tracked 11p-7a when app idle</div>
          </div>
          <div className="flex items-end gap-1 h-24">
            {sleepData.map((p, i) => (
              <div key={i} className="flex-1 flex flex-col gap-0.5 justify-end h-full">
                <div className="w-full rounded-sm bg-white/10" style={{ height: `${p.awake}%` }} />
                <div className="w-full rounded-sm bg-violet-300/60" style={{ height: `${p.light}%` }} />
                <div className="w-full rounded-sm bg-violet-600" style={{ height: `${p.deep}%` }} />
                <div className="text-xs text-white/20 mt-1 text-center">{p.hour}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs">
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-violet-600" /> Deep 42%</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-violet-300/60" /> Light 38%</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-white/10" /> Awake 20%</span>
            <span className="ml-auto text-white/20">8h auto • backend: /api/sleep/history</span>
          </div>
        </div>
      </div>

      {/* MIDDLE - SHORT ALARMS & REMINDERS (ABOVE) */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Timer className="w-4 h-4 text-amber-400" /><div className="text-xs font-semibold tracking-widest text-white">SHORT ALARMS & REMINDERS • ONE-TIME</div><div className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{shortTasks.length} active</div></div>
          <div className="text-xs text-white/20">Voice: "wakeup in 30 minutes" / "remind me to stretch in 20 minutes"</div>
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

      {/* BOTTOM - DAILY ALARMS */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2"><Sunrise className="w-4 h-4 text-violet-400" /><div className="text-xs font-semibold tracking-widest text-white">DAILY ALARMS • RECURRING</div></div>
          <button onClick={()=>{
            const time = prompt('Time HH:MM e.g. 06:30') || '06:30'
            const label = prompt('Label') || 'Daily alarm'
            setDailyAlarms(prev=>[...prev, { id: Date.now().toString(), time, label, enabled: true, days: ['daily'], source: 'manual' }])
          }} className="text-xs px-3 py-1 rounded-full bg-white/10 border border-white/10 text-white/60 flex items-center gap-1"><Plus className="w-3 h-3" /> Add daily</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {dailyAlarms.map(a=>(
            <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#0e0e12] border border-white/5">
              <button onClick={()=>toggleDaily(a.id)} className={`w-10 h-6 rounded-full p-0.5 transition ${a.enabled? 'bg-violet-600' : 'bg-white/10'}`}><div className={`w-5 h-5 rounded-full bg-white transition ${a.enabled? 'translate-x-4' : 'translate-x-0'}`} /></button>
              <div className="flex-1"><div className="text-sm font-semibold text-white">{a.time} • {a.label}</div><div className="text-xs text-white/30">{a.days.join(', ')} • {a.source} • backend: /api/alarms/daily</div></div>
              <button onClick={()=>setDailyAlarms(prev=>prev.filter(x=>x.id!==a.id))} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center"><Trash2 className="w-3 h-3 text-white/30" /></button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2 text-xs text-white/20">
          <span>Bedtime: {bedtime || '22:00'}</span><span>•</span><span>Wake: {alarmTime || '06:00'}</span><span>•</span><span>Voice: "set alarm 6 am" / "set bedtime 10 pm"</span>
        </div>
      </div>

      {isSkipped && <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-200 flex items-center gap-1"><ZapOff className="w-3 h-3" /> Sleep skipped today — not counted as failure</div>}

      <div className="text-xs text-white/10">Backend TODO: hook window.habitSleepAPI.wakeupIn(mins) to voiceEngine, connect API.saveAlarm, API.fetchSleepHistory to render real graph</div>
    </div>
  )
}