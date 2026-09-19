import { useState } from 'react'
import { Sun, Moon, Flame, Check, ListChecks, Clock, Zap, Plus, Trash2, X, CalendarDays, Flag, Activity, Droplets, Play, AlertTriangle } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { dayController } from '../../core/dayController'
import { personality } from '../../speaking/personality'
import { ritualDoneToday } from '../../core/dayFlow'
import { readWorkoutRows } from '../../lib/workoutData'
import { dateLabel, tomorrowKey, clockNow, onClock, dayKey, minutesLeft, spanLabel } from '../../lib/clock'
import { PriorityNow } from './PriorityNow'

const sortTasks = (list: any[]) => list.slice().sort((a: any, b: any) => {
  const byStatus = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)
  if (byStatus) return byStatus
  const rank: Record<string, number> = { high: 0, normal: 1, medium: 1, low: 2 }
  const byP = (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)
  if (byP) return byP
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
})

const clockOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')

export default function TodayView() {
  const app = useApp() as any
  const {
    tasks = [], setTasks, steaks = [], toggleSteakDay, addSteak, deleteSteak,
    alarmTime, bedtime, catchUp = [], skips = [], showSteaksManager, setShowSteaksManager,
    assistantResponse, dailyLogs = [], dayPhase, dayStartedAt, startTheDay, endTheDay,
    userName, planItems = [], planDone = [], markPlanItem, planLine, desktopAlerts, water = 0
  } = app
  const [nowTick, setNowTick] = useState(0)
  const [newStreakName, setNewStreakName] = useState('')
  const [newStreakTotal, setNewStreakTotal] = useState('21')

  // one live clock for the whole page (system time is the authority)
  onClock(() => setNowTick((n: number) => n + 1))
  void nowTick

  const today = dayKey()
  const now = new Date()
  const pending = dayController.pendingSteaks()
  const isSkipped = (id: string) => (skips || []).some((k: any) => String(k.streakId).toLowerCase() === String(id).toLowerCase() && today >= dayKey(new Date(k.startDate)) && today <= dayKey(new Date(k.endDate)))
  const dayActive = dayPhase === 'active'
  const doneSet = new Set((Array.isArray(planDone) ? planDone : []).map(String))
  const openPlan = (planItems as any[]).filter((i) => !doneSet.has(i.id) && i.at > now.getTime() - 120000)
  const todayTasks = sortTasks(tasks.filter((t: any) => t.kind === 'daily' || (t.date || today) === today))
  const tomorrowTasks = sortTasks(tasks.filter((t: any) => t.date === tomorrowKey()))

  const toggleTask = (id: string) => setTasks((prev: any) => (prev || []).map((t: any) => (t.id === id ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t)))
  const addStreak = () => { if (!newStreakName.trim()) return; addSteak(newStreakName, parseInt(newStreakTotal) || 21); setNewStreakName(''); setNewStreakTotal('21') }
  const statusLine = planLine ? planLine() : ''

  return (
    <div className="p-3 md:p-4 space-y-4 bg-[#0f0f12] min-h-full">
      {/* ---------- header: what day it is, live, from the computer clock ---------- */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shrink-0"><Sun className="w-4 h-4 text-white" /></div>
          <div className="text-sm font-semibold text-white whitespace-nowrap">Today</div>
          <div className="text-xs text-white/45 hidden md:inline whitespace-nowrap">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} • <span className="tabular-nums">{clockNow(now)}</span></div>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/45">{dayActive ? `live since ${clockOf(dayStartedAt)}` : dayPhase === 'ended' ? 'day closed' : 'not started'}</span>
          {bedtime && dayActive && <span className="text-xs px-2.5 py-1 rounded-full bg-[#0e0e12] border border-white/10 text-white/45">day ends in {spanLabel(minutesLeft(bedtime, now))}</span>}
        </div>
        <div className="w-full text-[11px] text-white/30">
          {pending.length} steak(s) open • {openPlan.length} scheduled item(s) left • reminders {dayController.isPaused() ? 'PAUSED' : desktopAlerts ? 'also delivered by the OS' : 'in-app'}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* ==================== main column ==================== */}
        <div className="col-span-12 xl:col-span-8 space-y-4">
          {/* ---------- small day switch: Start / End only ---------- */}
          <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className={`w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center ${dayActive ? '' : 'opacity-60'}`}><Sun className="w-4 h-4 text-white" /></div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{dayActive ? `Day running` : 'Day not started • nothing reminds you'}</div>
                <div className="text-[11px] text-white/35 truncate">{statusLine || (dayActive ? `started ${clockOf(dayStartedAt)} • closes ${bedtime}` : `press start after your alarm • wake ${alarmTime || '—'} • bed ${bedtime || '—'}`)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!dayActive ? (
                <button onClick={() => startTheDay('quick')} className="px-4 py-2 rounded-full bg-white text-black text-xs font-semibold flex items-center gap-1.5"><Sun className="w-3.5 h-3.5" /> Start the day</button>
              ) : (
                <button onClick={() => endTheDay('manual')} className="px-4 py-2 rounded-full bg-[#0e0e12] border border-white/10 text-white/70 text-xs font-semibold flex items-center gap-1.5"><Moon className="w-3.5 h-3.5" /> End the day</button>
              )}
            </div>
          </div>

          <PriorityNow />

          {/* ---------- what the AI just said ---------- */}
          <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 shrink-0" />
              <div className="text-xs font-semibold text-white">{new Date().toLocaleDateString([], { weekday: 'long' })} • {personality.getAIName()}’s note</div>
            </div>
            <div className="text-[13px] text-white/75 break-words">{assistantResponse || `Good morning ${personality.getUserName() || 'there'} — start the day when you are up and the plan goes live.`}</div>
          </div>

          {/* ---------- today's to do (above morning order) ---------- */}
          <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 min-w-0"><ListChecks className="w-4 h-4 text-violet-400 shrink-0" /><div className="text-sm font-semibold text-white whitespace-nowrap">Today to do</div><span className="text-[10px] text-white/25 truncate">priority order</span></div>
              <button onClick={() => (document.querySelector('#nav-Tasks') as HTMLElement | null)?.click()} className="text-xs text-white/30 whitespace-nowrap shrink-0">Open checklist ›</button>
            </div>
            <div className="space-y-2">
              {todayTasks.length === 0 && <div className="text-[12px] text-white/35 py-3">There is no task for today.{" "}<span className="text-white/25">Add one on the Tasks page, or queue it for tomorrow.</span></div>}
              {todayTasks.map((t: any) => (
                <div key={t.id} className={`flex items-center gap-3 p-2.5 rounded-xl border min-w-0 ${t.status === 'done' ? 'bg-[#0e0e12] border-white/10' : 'bg-[#0e0e12]/50 border-white/5'}`} role="button" tabIndex={0}
                  onClick={() => toggleTask(t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(t.id) } }}>
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${t.status === 'done' ? 'bg-green-500 border-green-500' : 'border-white/15'}`}>{t.status === 'done' && <Check className="w-3 h-3 text-black" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] truncate ${t.status === 'done' ? 'text-white/40 line-through' : 'text-white/90'}`}>{t.title}</div>
                    <div className="text-[10px] text-white/25">{t.kind === 'daily' ? 'daily' : 'one time'}{t.time ? ` • ${t.time}` : ''}{t.reminderAt ? ` • reminds ${new Date(t.reminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
                  </div>
                  {t.priority === 'high' && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/20 text-amber-200 flex items-center gap-1 shrink-0"><Flag className="w-2.5 h-2.5" /> high</span>}
                </div>
              ))}
            </div>
            {tomorrowTasks.length > 0 && (
              <div className="mt-2.5 text-[11px] text-white/30">Queued for tomorrow ({tomorrowTasks.length}): {tomorrowTasks.slice(0, 4).map((t: any) => t.title).join(' • ')}</div>
            )}
          </div>

          <MorningOrder />
          <DayPlanCard openPlan={openPlan} dayActive={dayActive} />
        </div>

        {/* ==================== side column ==================== */}
        <div className="col-span-12 xl:col-span-4 space-y-4">
          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3"><Droplets className="w-4 h-4 text-blue-400" /><div className="text-sm font-semibold text-white">Water today</div><div className="ml-auto text-xs text-white/30">{water}ml</div></div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-blue-500 transition-all duration-300" style={{ width: Math.min(100, (water / Math.max(1, app.waterGoal || 3000)) * 100) + '%' }} /></div>
            <div className="mt-2 text-[11px] text-white/30">goal {app.waterGoal || 3000}ml • sips are scheduled through the waking day</div>
          </div>

          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2"><Activity className="w-4 h-4 text-emerald-400" /><div className="text-sm font-semibold text-white">Fired today</div><div className="ml-auto text-[10px] text-white/25">{app.reminderLog?.length || 0}</div></div>
            {!(app.reminderLog || []).length ? <div className="text-[11px] text-white/25">Nothing yet today.</div> : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(app.reminderLog || []).slice(0, 10).map((r: string, i: number) => <div key={r + i} className="text-[11px] text-white/40 truncate">{r}</div>)}
              </div>
            )}
          </div>

          {/* ---------- steaks: their own thing, no badges, no reminders ---------- */}
          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 min-w-0"><Flame className="w-4 h-4 text-orange-400 shrink-0" /><div className="text-sm font-semibold text-white whitespace-nowrap">Steaks</div></div>
              <button onClick={() => setShowSteaksManager(true)} className="text-xs px-2.5 py-1 rounded-full bg-white text-black font-medium flex items-center gap-1 shrink-0"><Plus className="w-3 h-3" /> Manage</button>
            </div>
            <div className="space-y-3">
              {steaks.map((s: any) => {
                const pct = Math.round((s.completed.length / s.total) * 100)
                const skippedNow = isSkipped(s.id)
                return (
                  <div key={s.id} className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
                    <div className="flex justify-between items-center gap-2">
                      <div className="text-[13px] font-medium text-white truncate">{s.name}{skippedNow ? ' • skipped' : ''}</div>
                      <div className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 shrink-0">{s.completed.length} / {s.total} • {pct}%</div>
                    </div>
                    <div className="mt-2 grid grid-cols-7 gap-1.5">
                      {Array.from({ length: Math.min(s.total, 14) }).map((_: any, dayIdx: number) => {
                        const checked = s.completed.includes(dayIdx)
                        return (
                          <button key={dayIdx} onClick={() => toggleSteakDay(s.id, dayIdx)} className={`h-8 rounded-lg border flex items-center justify-center transition-all ${checked ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/5 text-white/20 hover:bg-white/10'}`}>
                            {checked ? <Check className="w-4 h-4" /> : <span className="text-[11px]">{dayIdx + 1}</span>}
                          </button>
                        )
                      })}
                    </div>
                    {s.total > 14 && <div className="mt-1.5 text-[10px] text-white/20">+{s.total - 14} more days • Manage for the full grid</div>}
                  </div>
                )
              })}
              {steaks.length === 0 && <div className="text-[11px] text-white/30 py-2">No steaks yet — add one in Manage.</div>}
            </div>
          </div>
        </div>
      </div>

      {showSteaksManager && renderManager()}
    </div>
  )

  /* ---------------- morning order: prayers → affirmations → primary workout --------------- */
  function MorningOrder() {
    const rows = readWorkoutRows()
    const primary = rows.filter((w: any) => (w.slot || 'primary') === 'primary')
    const primaryDone = primary.filter((w: any) => w.done)
    const steps = [
      { key: 'prayer', label: 'Prayers', done: ritualDoneToday('prayer', dailyLogs), nav: 'Rituals' },
      { key: 'affirmations', label: 'Affirmations', done: ritualDoneToday('affirmations', dailyLogs), nav: 'Rituals' },
      {
        key: 'workout',
        label: primary.length ? `Primary • ${primaryDone.length}/${primary.length} done` : 'Primary workout',
        // only a real tick counts as done; "no rows" is "nothing added", never "finished"
        done: primary.length > 0 && primaryDone.length === primary.length,
        nav: 'Workout'
      }
    ]
    return (
      <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white">Morning order</div>
          <div className="text-[11px] text-white/30">{dayActive ? 'first half of the day' : 'armed at Start the day'}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {steps.map((s, i) => (
            <button key={s.key} onClick={() => (document.querySelector('#nav-' + s.nav) as HTMLElement | null)?.click()} className={`flex items-center gap-2 rounded-xl border p-3 text-left min-w-0 ${s.done ? 'bg-[#0e0e12] border-emerald-500/20' : 'bg-[#0e0e12]/60 border-white/5 hover:border-white/15'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] shrink-0 ${s.done ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/50'}`}>{s.done ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
              <span className="min-w-0"><span className={`block text-[12px] truncate ${s.done ? 'text-white/45 line-through' : 'text-white'}`}>{s.label}</span><span className="block text-[10px] text-white/25">tick in Rituals / Workout</span></span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  /* ---------------- the rest of the plan, in time order ---------------- */
  function DayPlanCard({ openPlan, dayActive }: any) {
    const groups = [
      { label: 'Morning block', items: openPlan.filter((i: any) => i.morning) },
      { label: 'Later today', items: openPlan.filter((i: any) => !i.morning && (i.kind === 'task' || i.kind === 'daily')) },
      { label: 'Water & drinks', items: openPlan.filter((i: any) => i.kind === 'water' || i.kind === 'drink') }
    ]
    return (
      <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-violet-400" /><div className="text-sm font-semibold text-white">{now.toLocaleDateString([], { weekday: 'long' })} • what has to happen</div></div>
          <div className="text-[11px] text-white/30">{openPlan.length} open</div>
        </div>
        {!dayActive && (
          <div className="mb-3 flex items-center gap-2 text-[11px] text-amber-200/80 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Times are computed from the moment you start the day.</div>
        )}
        {openPlan.length === 0 ? <div className="text-[11px] text-white/25 py-2">Nothing left on today's plan.</div> : (
          <div className="space-y-3">
            {groups.filter((g) => g.items.length).map((g) => (
              <div key={g.label}>
                <div className="text-[10px] tracking-widest text-white/30 mb-1.5">{g.label.toUpperCase()}</div>
                <div className="space-y-1.5">
                  {g.items.slice(0, 8).map((i: any) => (
                    <div key={i.id} className="flex items-center gap-2 text-[12px] min-w-0">
                      <span className="text-white/40 tabular-nums w-12 shrink-0">{i.time}</span>
                      <span className={`flex-1 min-w-0 break-words ${i.priority === 'high' ? 'text-white' : 'text-white/65'}`} title={i.title}>{i.title}</span>
                      <button onClick={() => (document.querySelector('#nav-' + i.goTo) as HTMLElement | null)?.click()} className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 text-white/35 shrink-0">{i.goTo}</button>
                      <button onClick={() => markPlanItem?.(i.id, true)} className="w-5 h-5 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0" title="Done"><Check className="w-3 h-3 text-white/40" /></button>
                    </div>
                  ))}
                  {g.items.length > 8 && <div className="text-[10px] text-white/20">+{g.items.length - 8} more</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        {catchUp.length > 0 && <div className="mt-2 text-[11px] text-amber-200/70">Catch-up from your pause: {catchUp.map((c: any) => c.name).join(', ')}</div>}
      </div>
    )
  }

  function renderManager() {
    return (
      <div className="fixed inset-0 z-50 bg-[#0f0f12] overflow-y-auto">
        <div className="min-h-full p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Flame className="w-5 h-5 text-orange-400" /><h2 className="text-base font-semibold text-white">Steaks Manager</h2></div>
            <button onClick={() => setShowSteaksManager(false)} className="w-10 h-10 rounded-xl bg-[#141418] border border-white/10 flex items-center justify-center"><X className="w-5 h-5 text-white/40" /></button>
          </div>
          <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
            <div className="text-sm font-medium text-white">Add new steak</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input value={newStreakName} onChange={(e: any) => setNewStreakName(e.target.value)} onFocus={(e) => e.stopPropagation()} placeholder="Steak name e.g. Morning run" className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none focus:border-violet-500/40" />
              <input value={newStreakTotal} onChange={(e: any) => setNewStreakTotal(e.target.value)} placeholder="Total days e.g. 21" type="number" className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none" />
              <button onClick={addStreak} className="h-10 rounded-xl bg-white text-black text-xs font-semibold flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Add steak</button>
            </div>
            <div className="text-[11px] text-white/25">Steaks are tracked here only — no reminders, no popup, nothing else reacts to them.</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {steaks.map((s: any) => {
              const pct = Math.round((s.completed.length / s.total) * 100)
              return (
                <div key={s.id} className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-3">
                  <div className="flex justify-between items-center gap-2">
                    <div className="text-sm font-semibold text-white truncate">{s.name}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/40">{s.completed.length} / {s.total} • {pct}%</div>
                      <button onClick={() => { if (confirm('Delete steak?')) deleteSteak(s.id) }} className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center"><Trash2 className="w-4 h-4 text-red-300" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: s.total }).map((_: any, dayIdx: number) => {
                      const checked = s.completed.includes(dayIdx)
                      return (
                        <button key={dayIdx} onClick={() => toggleSteakDay(s.id, dayIdx)} className={`h-10 rounded-xl border flex flex-col items-center justify-center gap-0.5 ${checked ? 'bg-violet-600 border-violet-500 text-white' : 'bg-[#0e0e12] border-white/10 text-white/30 hover:bg-white/5'}`}>
                          <span className="text-xs font-medium">{dayIdx + 1}</span>
                          {checked ? <Check className="w-3 h-3" /> : <div className="w-3 h-3 rounded-full border border-white/10" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {steaks.length === 0 && <div className="text-xs text-white/25">No steaks yet.</div>}
          </div>
        </div>
      </div>
    )
  }
}
