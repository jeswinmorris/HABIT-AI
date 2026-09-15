import { useState } from 'react'
import { Sun, Sunrise, Moon, Flame, Check, ListChecks, Clock  , Headphones, Play, Pause, Zap, Mic, Plus, Trash2, X, CalendarDays } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { dayController } from '../../core/dayController'
import { personality } from '../../speaking/personality'
import { speakingModel } from '../../speaking/speakingModel'
import { buildBriefing, ritualDoneToday, workoutSlots } from '../../core/dayFlow'
import { dateLabel, tomorrowKey, weekdayOf, clockNow, localDayOf } from '../../lib/clock'

/** high first, then done-ness, then creation order — the shared task sort */
const sortTasks = (list: any[]) => list.slice().sort((a: any, b: any) => {
  const byStatus = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)
  if (byStatus) return byStatus
  const rank: Record<string, number> = { high: 0, normal: 1, medium: 1, low: 2 }
  const byP = (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)
  if (byP) return byP
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
})
const clockOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')

export default function TodayView({ onTriggerWorkout }: any) {
  const {
    tasks = [], setTasks, steaks = [], toggleSteakDay, addSteak, deleteSteak,
    alarmTime, bedtime, catchUp = [], skips = [],
      showSteaksManager, setShowSteaksManager, assistantResponse,
    dailyLogs = [], dayPhase, dayStartedAt, startTheDay, endTheDay, answerAlarm, ringAlarm, briefing,
    playAffirmation
  } = useApp() as any
  const [affirmIdx, setAffirmIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [newStreakName, setNewStreakName] = useState('')
  const [newStreakTotal, setNewStreakTotal] = useState('21')

  const today = dayController.todayKey()
  const pending = dayController.pendingSteaks()
  const isSkipped = (id: string) => (skips || []).some((k: any) => String(k.streakId).toLowerCase() === String(id).toLowerCase() && today >= localDayOf(k.startDate) && today <= localDayOf(k.endDate))
  const dayActive = dayPhase === 'active'
  const shortDate = new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  const todayTasks = sortTasks(tasks.filter((t: any) => (t.date || today) === today))
  const tomorrowTasks = sortTasks(tasks.filter((t: any) => t.date === tomorrowKey()))

  const affirmations = (function () {
    try { const a = JSON.parse(localStorage.getItem('habitOS_affirmations') || '[]'); return a.length ? a.map((x: any) => x.text || x.title) : ['I am becoming my best self'] } catch { return ['I am becoming my best self'] }
  })()

  const toggleTask = (id: string) => {
    setTasks((prev: any) => (prev || []).map((t: any) => (t.id === id ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t)))
  }

  const addStreak = () => {
    if (!newStreakName.trim()) return
    addSteak(newStreakName, parseInt(newStreakTotal) || 21)
    setNewStreakName('')
    setNewStreakTotal('21')
  }
  const deleteStreak = (id: string) => {
    if (confirm('Delete steak?')) deleteSteak(id)
  }
  const toggleDay = (streakId: string, dayIdx: number) => toggleSteakDay(streakId, dayIdx)

  return (
    <div className="p-4 space-y-4 bg-[#0f0f12] min-h-full">
      {/* Top Bar - v3 style */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center"><Sun className="w-4 h-4 text-white" /></div>
          <div className="text-sm font-semibold text-white">Wakeup • Today • <span className="hidden md:inline">{dateLabel()}</span><span className="md:hidden">{shortDate}</span></div>
          <div className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/40">Steaks open: {pending.length}</div>
          <div className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/40">Alarm {alarmTime || '06:00'}</div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button
            onClick={() => answerAlarm('snooze', 10)}
            className="text-xs px-3 py-1 rounded-full bg-[#0e0e12] border border-white/10 text-white/50 hover:text-white/80"
            title="Push the alarm 10 minutes back"
          >
            Snooze alarm
          </button>
          <button
            onClick={() => answerAlarm('close')}
            className={`text-xs px-3 py-1 rounded-full border font-semibold ${ringAlarm || dayPhase === 'ringing' ? 'bg-white text-black border-white' : 'bg-[#0e0e12] border-white/10 text-white/50 hover:text-white/80'}`}
            title="Stop ringing, then hear today's briefing"
          >
            Close alarm
          </button>
          <div className="text-xs px-3 py-1 rounded-full bg-[#0e0e12] border border-white/10 text-white/50 flex items-center gap-1"><Moon className="w-3 h-3" /> Sleep {bedtime || '22:00'}</div>
        </div>
        <div className="w-full text-xs text-white/30">Sleep {bedtime || '22:00'} → {alarmTime || '06:00'} • auto 8h from sleep • reminders {dayController.isPaused() ? 'PAUSED' : 'LIVE'} ({pending.length} steaks tracked)</div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left Column - Orb + Stats + Tasks */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex gap-4">
              <div className="flex-1 flex flex-col items-center justify-center py-6 bg-[#0e0e12] rounded-xl border border-white/5">
                <div className="relative w-24 h-24">
                  <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-xl animate-pulse" />
                  <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center border border-white/10">
                    <Mic className="w-8 h-8 text-white" />
                  </div>
                </div>
                <div className="mt-4 flex gap-2 flex-wrap justify-center">
                  {!dayActive ? (
                    <button onClick={() => startTheDay('prayer-first')} className="px-4 py-2 rounded-full bg-white text-black text-xs font-semibold flex items-center gap-1.5"><Sunrise className="w-3.5 h-3.5" /> Start the day</button>
                  ) : (
                    <button onClick={endTheDay} className="px-4 py-2 rounded-full bg-[#141418] border border-white/10 text-xs text-white/70 flex items-center gap-1.5"><Moon className="w-3.5 h-3.5" /> End the day</button>
                  )}
                  <button onClick={() => setShowSteaksManager(true)} className="px-4 py-2 rounded-full bg-[#141418] border border-white/10 text-xs text-white/60">Steaks</button>
                </div>
                <div className="mt-3 text-xs text-white/25">{dayActive ? `Day live since ${clockOf(dayStartedAt)} • prayers → affirmations → primary workout` : `Day not started • alarms and reminders are silent until you press start`}</div>
                <button onClick={() => playAffirmation('voice')} className="mt-3 px-4 py-2 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white text-xs font-semibold flex items-center gap-2"><Zap className="w-3 h-3" /> Affirmation now</button>
              </div>

              <div className="flex-1 space-y-3">
                <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2"><div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-blue-500" /><div className="text-xs font-semibold text-white">HABIT.AI • {personality.getAIName()} • voice OS</div><div className="ml-auto text-xs text-white/20 tabular-nums">{clockNow()} • alarm {alarmTime || '06:00'}</div></div>
                  <div className="text-sm text-white/80 break-words">{assistantResponse || `Good morning ${personality.getUserName() || 'there'} — press Start the day, or say “what is on today”.`}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {['start the day', 'what is on today', 'stop alarm', 'play my playlist', 'full screen prayer', 'go to water', 'add task call the lab for tomorrow', 'open tasks', 'go to analytics', 'pause my day', 'end the day'].map((c) => (
                      <button key={c} onClick={() => (window as any).__habitRunCommand?.(c)} className="text-left text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/40 hover:text-white/80">› {c}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <MorningOrder />
          <DayPlanCard briefing={briefing || buildBriefing({ projects: undefined })} dayActive={dayActive} />

          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2"><ListChecks className="w-4 h-4 text-violet-400" /><div className="text-sm font-semibold text-white">Today to do • {todayTasks.length}</div><span className="text-[10px] text-white/25">priority order</span></div>
              <button onClick={() => (document.querySelector('#nav-Tasks') as HTMLElement | null)?.click()} className="text-xs text-white/30 flex items-center gap-1">Open checklist ›</button>
            </div>
            <div className="space-y-2">
              {todayTasks.length === 0 && <div className="text-xs text-white/30 py-3">Nothing yet. Add on the Tasks page or say “add task …”, anything you queue for tomorrow lands here once the day starts.</div>}
              {todayTasks.map((t: any) => (
                <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${t.status === 'done' ? 'bg-[#0e0e12] border-white/10' : 'bg-[#0e0e12]/50 border-white/5'}`} onClick={() => toggleTask(t.id)}>
                  <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${t.status === 'done' ? 'bg-green-500 border-green-500' : 'border-white/10'}`}>{t.status === 'done' && <Check className="w-4 h-4 text-black" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm truncate ${t.status === 'done' ? 'text-white/40 line-through' : 'text-white'}`}>{t.title}</div>
                    <div className="flex items-center gap-2 mt-1"><span className={`text-xs px-2 py-0.5 rounded-full ${t.priority === 'high' ? 'bg-amber-500/20 text-amber-200' : 'bg-white/5 text-white/30'}`}>{t.priority || 'normal'}</span><span className="text-xs text-white/20">{t.time || 'today'}</span></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-white/20">Try voice: &quot;what can you do&quot; • &quot;add task&quot; • &quot;set alarm for 7 30 AM&quot; • &quot;play video&quot; • &quot;volume up&quot;</div>
          </div>
        </div>

        {/* PLACEHOLDER-RIGHT */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3"><Clock className="w-4 h-4 text-violet-400" /><div className="text-sm font-semibold text-white">Next alarms</div></div>
            <div className="space-y-2">
              <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3"><div className="text-sm font-semibold text-white">{alarmTime || '06:00'}</div><div className="text-xs text-white/40">Wake + breathe</div><div className="mt-2 w-2 h-2 rounded-full bg-green-500" /></div>
              <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3"><div className="text-sm font-semibold text-white">{bedtime || '22:00'}</div><div className="text-xs text-white/40">Sleep reminder</div><div className="mt-2 w-2 h-2 rounded-full bg-green-500" /></div>
            </div>
            <div className="mt-3 text-xs text-white/20">Voice: &quot;set alarm for 6 45 AM&quot; → adds a daily alarm below in Sleep</div>
          </div>

          {/* STEAKS column */}
          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><Flame className="w-4 h-4 text-orange-400" /><div className="text-sm font-semibold text-white">Steaks</div><span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/30">no reminders</span><div className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/30">{pending.length ? pending.length : '0'} left today</div></div>
              <button onClick={() => setShowSteaksManager(true)} className="text-xs px-2.5 py-1 rounded-full bg-white text-black font-medium flex items-center gap-1 shrink-0 whitespace-nowrap"><Plus className="w-3 h-3" /> Manage</button>
            </div>

            <div className="space-y-3">
              {steaks.map((s: any) => {
                const pct = Math.round((s.completed.length / s.total) * 100)
                const skippedNow = isSkipped(s.id)
                return (
                  <div key={s.id} className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-medium text-white">{s.name}{skippedNow ? ' • skipped' : ''}</div>
                      <div className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300">{s.completed.length} / {s.total} • {pct}%</div>
                    </div>
                    <div className="mt-2 grid grid-cols-7 gap-1.5">
                      {Array.from({ length: Math.min(s.total, 14) }).map((_: any, dayIdx: number) => {
                        const checked = s.completed.includes(dayIdx)
                        return (
                          <button key={dayIdx} onClick={() => toggleDay(s.id, dayIdx)} className={`h-8 rounded-lg border flex items-center justify-center transition-all ${checked ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/5 text-white/20 hover:bg-white/10'}`}>
                            {checked ? <Check className="w-4 h-4" /> : <span className="text-xs">{dayIdx + 1}</span>}
                          </button>
                        )
                      })}
                    </div>
                    {s.total > 14 && <div className="mt-2.5 text-xs text-white/20">+{s.total - 14} more days • open Manage for the full steak</div>}
                  </div>
                )
              })}
              {steaks.length === 0 && <div className="text-xs text-white/30 text-center py-4">No steaks yet • add below (or say “add steak reading 30 days”)</div>}
            </div>

            <div className="mt-3 flex gap-3 text-xs"><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-white/10" />0</span><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-violet-900" />partial</span><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-violet-600" />checked</span></div>
          </div>

          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3"><Headphones className="w-4 h-4 text-violet-400" /><div className="text-sm font-semibold text-white">Affirmations &amp; Manifesting Audios</div><button className="ml-auto text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/40" onClick={() => (document.querySelector('#nav-Rituals') as HTMLElement | null)?.click()}>+ Upload audio</button></div>
            <div className="space-y-2">
              {affirmations.slice(0, 3).map((a: any, i: number) => (
                <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${i === affirmIdx ? 'bg-violet-500/10 border-violet-500/20' : 'bg-[#0e0e12] border-white/5'}`}>
                  <button onClick={() => { setAffirmIdx(i); speakingModel.speak(typeof a === 'string' ? a : a.text || ''); setIsPlaying(true); setTimeout(() => setIsPlaying(false), 1500) }} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">{isPlaying && i === affirmIdx ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white" />}</button>
                  <div><div className="text-sm text-white">{typeof a === 'string' ? a : a.text}</div><div className="text-xs text-white/20">0:42 • Manifest</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* PLACEHOLDER-MANAGER */}
      {showSteaksManager && renderManager()}
    </div>
  )

  /** prayers → affirmations → primary workout, in that order, once the day is started */
  function MorningOrder() {
    const logs = dailyLogs
    const { primary } = workoutSlots()
    const steps = [
      { key: 'prayer', label: 'Prayers', done: ritualDoneToday('prayer', logs), tab: 'Rituals' as any, go: () => { (document.querySelector('#nav-Rituals') as HTMLElement | null)?.click() } },
      { key: 'affirmations', label: 'Affirmations', done: ritualDoneToday('affirmations', logs), go: () => { (document.querySelector('#nav-Rituals') as HTMLElement | null)?.click() } },
      { key: 'workout', label: primary.length ? `Primary workout • ${primary[0].name}` : 'Primary workout', done: ritualDoneToday('workout', logs) || primary.length === 0, go: () => { (document.querySelector('#nav-Workout') as HTMLElement | null)?.click() } }
    ]
    return (
      <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white">Morning order</div>
          <div className="text-[11px] text-white/30">{dayActive ? 'runs in sequence today' : 'starts when you press Start the day'}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {steps.map((s, i) => (
            <button key={s.key} onClick={s.go} className={`flex items-center gap-2.5 rounded-xl border p-3 text-left ${s.done ? 'bg-[#0e0e12] border-emerald-500/20' : 'bg-[#0e0e12]/60 border-white/5 hover:border-white/15'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] shrink-0 ${s.done ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/50'}`}>{s.done ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
              <span className="min-w-0"><span className={`block text-[13px] truncate ${s.done ? 'text-white/45 line-through' : 'text-white'}`}>{s.label}</span><span className="block text-[10px] text-white/25">{i === 0 ? 'tick in Rituals' : i === 1 ? 'tick in Rituals' : 'full stretch'}</span></span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  function DayPlanCard({ briefing, dayActive }: any) {
    const weekday = weekdayOf()
    const due = buildBriefing({ projects: undefined }).sections
    return (
      <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-violet-400" /><div className="text-sm font-semibold text-white">{weekday} • what has to happen today</div></div>
          <div className="text-xs text-white/30">{dayActive ? 'live' : 'armed at Start the day'}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {due.map((sec: any) => (
            <div key={sec.key} className="rounded-xl bg-[#0e0e12] border border-white/5 p-3">
              <div className="text-[10px] tracking-widest text-white/35 mb-1.5">{sec.label.toUpperCase()}</div>
              {sec.lines.length ? (
                <ul className="space-y-1">{sec.lines.slice(0, 5).map((l: string, i: number) => <li key={i} className="text-[12px] text-white/70 leading-snug truncate">• {l}</li>)}</ul>
              ) : (
                <div className="text-[11px] text-white/25">{sec.empty}</div>
              )}
            </div>
          ))}
        </div>
        {catchUp.length > 0 && (
          <div className="mt-2 text-[11px] text-amber-200/80">Catch-up queue from your pause: {catchUp.map((c: any) => c.name).join(', ')}</div>
        )}
        {tomorrowTasks.length > 0 && (
          <div className="mt-2 text-[11px] text-white/35">Queued for tomorrow ({tomorrowTasks.length}): {tomorrowTasks.slice(0, 4).map((t: any) => t.title).join(' • ')}</div>
        )}
      </div>
    )
  }

  function renderManager() {
    return (
      <div className="fixed inset-0 z-50 bg-[#0f0f12] overflow-y-auto">
        <div className="min-h-full p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Flame className="w-5 h-5 text-orange-400" /><h2 className="text-base font-semibold text-white">Steaks Manager • Full Page • Add / Delete Steaks</h2></div>
            <button onClick={() => setShowSteaksManager(false)} className="w-10 h-10 rounded-xl bg-[#141418] border border-white/10 flex items-center justify-center"><X className="w-5 h-5 text-white/40" /></button>
          </div>

          <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
            <div className="text-sm font-medium text-white">Add new steak</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input value={newStreakName} onChange={(e: any) => setNewStreakName(e.target.value)} placeholder="Steak name e.g. Morning run" className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none focus:border-violet-500/40" />
              <input value={newStreakTotal} onChange={(e: any) => setNewStreakTotal(e.target.value)} placeholder="Total days e.g. 21" type="number" className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none focus:border-violet-500/40" />
              <button onClick={addStreak} className="h-10 rounded-xl bg-white text-black text-xs font-semibold flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Add steak</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {steaks.map((s: any) => {
              const pct = Math.round((s.completed.length / s.total) * 100)
              return (
                <div key={s.id} className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="text-sm font-semibold text-white">{s.name}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/40">{s.completed.length} / {s.total} • {pct}% completed</div>
                      <button onClick={() => deleteStreak(s.id)} className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center"><Trash2 className="w-4 h-4 text-red-300" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: s.total }).map((_: any, dayIdx: number) => {
                      const checked = s.completed.includes(dayIdx)
                      return (
                        <button key={dayIdx} onClick={() => toggleDay(s.id, dayIdx)} className={`h-10 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-all ${checked ? 'bg-violet-600 border-violet-500 text-white' : 'bg-[#0e0e12] border-white/10 text-white/30 hover:bg-white/5'}`}>
                          <span className="text-xs font-medium">{dayIdx + 1}</span>
                          {checked ? <Check className="w-3 h-3" /> : <div className="w-3 h-3 rounded-full border border-white/10" />}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex gap-2 text-xs text-white/20"><span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-violet-600" /> checked = done</span><span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-[#0e0e12] border border-white/10" /> not done</span></div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }
}
