import { useEffect, useMemo, useState } from 'react'
import { ListTodo, Check, Trash2, Flag, Clock, Bell, CalendarDays, Sunrise, Repeat, History } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { speakingModel } from '../../speaking/speakingModel'
import { dayKey, addDaysKey, todayKey, tomorrowKey, dateLabel, weekdayOf } from '../../lib/clock'

type TaskKind = 'once' | 'daily'
type Task = {
  id: string
  title: string
  status: 'todo' | 'done'
  priority: 'high' | 'normal'
  kind: TaskKind
  time: string
  date: string
  createdAt: string
  reminderAt?: string
  reminderDone?: boolean
}

const RANK: Record<string, number> = { high: 0, normal: 1, low: 2 }
const sortTasks = (list: Task[]) => list.slice().sort((a, b) => {
  const byStatus = (isDone(a) ? 1 : 0) - (isDone(b) ? 1 : 0)
  if (byStatus) return byStatus
  const byP = (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1)
  if (byP) return byP
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
})

/** completion is per calendar day for dailies; one-time tasks store their own status */
function doneMap(): Record<string, string> { try { const raw = localStorage.getItem('habitOS_taskDone'); if (!raw) return {}; const p = JSON.parse(raw); return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, string> : {} } catch { return {} } }
function isDone(t: Task, today = todayKey()): boolean {
  if (t.kind === 'daily') return doneMap()[t.id] === today
  return t.status === 'done'
}
function markDone(t: Task, done: boolean) {
  const map = doneMap()
  if (t.kind === 'daily') { if (done) map[t.id] = todayKey(); else delete map[t.id]; localStorage.setItem('habitOS_taskDone', JSON.stringify(map)) }
}

function RealisticGraph({ series }: { series: { date: string; pct: number; done: number; total: number }[] }) {
  const w = 320, h = 84, pad = 18
  const has = series.some((s) => s.total > 0)
  const max = 100
  const pts = series.map((s, i) => ({ x: pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2), y: h - pad - (s.pct / max) * (h - pad * 2), s }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
      <div className="text-[11px] text-white/30 mb-2">DAILY COMPLETION % • LOGGED DAYS ONLY</div>
      {has ? (
        <>
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
            <path d={path} fill="none" stroke="#22c55e" strokeWidth="2" strokeDasharray="4 4" />
            {pts.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="4" fill="#22c55e" stroke="#0e0e12" strokeWidth="2" /><text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="8" fill="#fff" opacity="0.45">{p.s.pct}%</text></g>)}
          </svg>
          <div className="flex justify-between text-[10px] text-white/20 mt-1">{series.map((s) => <span key={s.date}>{weekdayOf(s.date)[0]}</span>)}</div>
          <div className="text-[10px] text-white/15 mt-1">{series.filter((s) => s.total).length} day(s) with data</div>
        </>
      ) : <div className="h-20 flex items-center justify-center text-[11px] text-white/25 border border-dashed border-white/10 rounded-xl">check something off and the curve starts here</div>}
    </div>
  )
}

export default function TasksView() {
  const { setShowSkipConfirm, setSkipTarget, tasks: allTasks, setTasks, dayPhase } = useApp() as any
  const today = todayKey()
  const tomorrow = tomorrowKey()

  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<'high' | 'normal'>('normal')
  const [newKind, setNewKind] = useState<TaskKind>('once')
  const [newDate, setNewDate] = useState(today)
  const [newReminder, setNewReminder] = useState('')
  const [showReminderPicker, setShowReminderPicker] = useState(false)
  const [ringingTask, setRingingTask] = useState<Task | null>(null)
  const [, bump] = useState(0)

  const tasks = (allTasks || []) as Task[]
  const dailies = sortTasks(tasks.filter((t) => t.kind === 'daily'))
  const todays = sortTasks(tasks.filter((t) => t.kind !== 'daily' && (t.date || today) === today))
  const tomorrows = sortTasks(tasks.filter((t) => t.kind !== 'daily' && t.date === tomorrow))

  // per-day completion history for the graph + yesterday recap
  const series = useMemo(() => {
    const map = doneMap()
    const out: { date: string; pct: number; done: number; total: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const date = addDaysKey(today, -i)
      const dailyTotal = tasks.filter((t) => t.kind === 'daily').length
      const dailyDone = Object.values(map).filter((d) => d === date).length
      const once = tasks.filter((t) => t.kind !== 'daily' && (t.date || '') === date)
      const onceDone = once.filter((t) => t.status === 'done').length
      const total = dailyTotal + once.length
      const done = (date === today ? dailyDone : dailyDone) + onceDone
      out.push({ date, total, done, pct: total ? Math.round((done / total) * 100) : 0 })
    }
    return out
  }, [tasks, today])
  const yesterday = series[series.length - 2]
  const yesterdayDone = tasks.filter((t) => (t.kind === 'daily' ? false : t.date === addDaysKey(today, -1) && t.status === 'done'))

  useEffect(() => {
    const check = setInterval(() => {
      const now = new Date()
      const due = tasks.find((t) => t.reminderAt && !t.reminderDone && new Date(t.reminderAt) <= now && !isDone(t))
      if (due && !ringingTask) { setRingingTask(due); speakingModel.speak(`Reminder, ${due.title}`) }
    }, 30000)
    return () => clearInterval(check)
  }, [tasks, ringingTask])

  // dailies are "reset" simply by the date changing; this re-renders at midnight
  useEffect(() => {
    const iv = setInterval(() => bump((n) => n + 1), 60000)
    return () => clearInterval(iv)
  }, [])

  const addTask = () => {
    if (!newTitle.trim()) return
    const task: Task = {
      id: Date.now().toString(),
      title: newTitle.trim(),
      status: 'todo',
      priority: newPriority,
      kind: newKind,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: newKind === 'daily' ? today : newDate,
      createdAt: new Date().toISOString(),
      reminderAt: newReminder ? new Date(newReminder).toISOString() : undefined
    }
    setTasks([task, ...tasks])
    setNewTitle('')
    setNewReminder('')
    setShowReminderPicker(false)
    speakingModel.speak(`Added ${newKind === 'daily' ? 'a daily task' : 'a task'}.`)
    window.dispatchEvent(new CustomEvent('habit:plan-dirty'))
  }

  const toggleTask = (t: Task) => {
    if (t.kind === 'daily') {
      const next = doneMap()[t.id] !== today
      markDone(t, next)
      if (next) speakingModel.speak('Done.')
      bump((n) => n + 1)
    } else {
      setTasks(tasks.map((x) => (x.id === t.id ? { ...x, status: x.status === 'done' ? 'todo' : 'done', reminderDone: x.status === 'todo' } : x)))
      if (t.status !== 'done') speakingModel.speak('Task done.')
    }
    if (ringingTask?.id === t.id) setRingingTask(null)
    window.dispatchEvent(new CustomEvent('habit:plan-dirty'))
  }

  const removeTask = (id: string) => { setTasks(tasks.filter((t) => t.id !== id)); window.dispatchEvent(new CustomEvent('habit:plan-dirty')) }
  const snoozeReminder = (id: string, mins = 10) => {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, reminderAt: new Date(Date.now() + mins * 60000).toISOString(), reminderDone: false } : t)))
    setRingingTask(null)
    speakingModel.speak(`Snoozed ${mins} minutes`)
  }

  return (
    <div className="p-3 md:p-4 space-y-4 bg-[#0f0f12] min-h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2"><ListTodo className="w-4 h-4 text-violet-400" /> Tasks &gt; {dateLabel()}</h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-white/25 hidden sm:inline">{dayPhase === 'active' ? 'reminders are armed' : 'armed when the day starts'}</span>
          <button onClick={() => { setSkipTarget({ id: 'tasks', name: 'Tasks' }); setShowSkipConfirm(true) }} className="px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs">Skip N days</button>
        </div>
      </div>

      {/* ---------------- composer ---------------- */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-3">
        <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-2">
          <div className="flex gap-2 flex-wrap">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onFocus={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask() }}
              placeholder="Add a task — then pick daily or one-time"
              autoComplete="off"
              className="flex-1 min-w-44 px-3 py-2 rounded-xl bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none"
            />
            <button onClick={() => setNewKind((k) => (k === 'daily' ? 'once' : 'daily'))} className={`px-3 py-2 rounded-full border text-xs flex items-center gap-1 ${newKind === 'daily' ? 'bg-violet-500/20 border-violet-500/30 text-violet-200' : 'bg-white/5 border-white/10 text-white/45'}`}>
              <Repeat className="w-3 h-3" /> {newKind === 'daily' ? 'Daily' : 'One time'}
            </button>
            {newKind !== 'daily' && (
              <button onClick={() => setNewDate((d) => (d === today ? tomorrow : today))} className={`px-3 py-2 rounded-full border text-xs flex items-center gap-1 ${newDate === tomorrow ? 'bg-amber-500/20 border-amber-500/30 text-amber-200' : 'bg-white/5 border-white/10 text-white/45'}`}>
                <CalendarDays className="w-3 h-3" /> {newDate === tomorrow ? 'Tomorrow' : 'Today'}
              </button>
            )}
            <button onClick={() => setNewPriority((p) => (p === 'high' ? 'normal' : 'high'))} className={`${newPriority === 'high' ? 'bg-amber-500/20 border-amber-500/30 text-amber-200' : 'bg-white/5 border-white/10 text-white/40'} px-3 py-2 rounded-full border text-xs flex items-center gap-1`}>
              <Flag className="w-3 h-3" /> Priority
            </button>
            <button onClick={() => setShowReminderPicker((v) => !v)} className={`${newReminder ? 'bg-violet-500/20 border-violet-500/30 text-violet-200' : 'bg-white/5 border-white/10 text-white/40'} px-3 py-2 rounded-full border text-xs flex items-center gap-1`}>
              <Bell className="w-3 h-3" /> {newReminder ? new Date(newReminder).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Reminder'}
            </button>
            <button onClick={addTask} className="px-5 py-2 rounded-full bg-white text-black text-xs font-semibold">Add</button>
          </div>
          {showReminderPicker && (
            <div className="mt-2 flex flex-wrap gap-2 items-center bg-[#141418] border border-white/10 rounded-xl p-2">
              <input type="datetime-local" value={newReminder} onChange={(e) => setNewReminder(e.target.value)} className="flex-1 min-w-44 px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white" />
              <button onClick={() => setNewReminder('')} className="text-xs text-white/30">Clear</button>
              {[10, 30, 60].map((m) => (
                <button key={m} onClick={() => { const d = new Date(); d.setMinutes(d.getMinutes() + m); setNewReminder(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)) }} className="px-2 py-1 rounded-full bg-white/10 text-xs text-white/60">+{m}m</button>
              ))}
            </div>
          )}
          <div className="text-[10px] text-white/25 mt-2 px-1">Daily tasks come back every day and reset on their own; one-time tasks live on the day you gave them.</div>
        </div>

        {ringingTask && (
          <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-wrap items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500 animate-pulse flex items-center justify-center shrink-0"><Bell className="w-4 h-4 text-white" /></div>
            <div className="flex-1 min-w-32"><div className="text-sm text-white">Reminder: {ringingTask.title}</div><div className="text-xs text-white/40">{ringingTask.reminderAt ? new Date(ringingTask.reminderAt).toLocaleTimeString() : ''}</div></div>
            <div className="flex gap-2">
              <button onClick={() => toggleTask(ringingTask)} className="px-3 py-1.5 rounded-full bg-white text-black text-xs">Done</button>
              <button onClick={() => snoozeReminder(ringingTask.id, 10)} className="px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs">Snooze 10m</button>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- three lists ---------------- */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <TaskColumn icon={<Repeat className="w-3.5 h-3.5 text-violet-300" />} title="Daily" count={dailies.length} tasks={dailies} onToggle={toggleTask} onRemove={removeTask} empty="Nothing repeats yet — switch the composer to Daily." />
        <TaskColumn icon={<CalendarDays className="w-3.5 h-3.5 text-amber-300" />} title={`Today`} count={todays.length} tasks={todays} onToggle={toggleTask} onRemove={removeTask} empty="No one-time tasks today." />
        <TaskColumn icon={<Sunrise className="w-3.5 h-3.5 text-emerald-300" />} title="Tomorrow" count={tomorrows.length} tasks={tomorrows} onToggle={toggleTask} onRemove={removeTask} empty="Queue tomorrow before you close the day — it becomes Today when the day starts." />
      </div>

      {/* ---------------- analytics ---------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#141418] border border-white/10 rounded-xl p-4"><RealisticGraph series={series} /></div>
        <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs tracking-widest text-white/40 flex items-center gap-1"><History className="w-3 h-3" /> YESTERDAY • {addDaysKey(today, -1)}</div>
            <div className="text-[11px] text-white/25">{yesterday?.done || 0}/{yesterday?.total || 0} done</div>
          </div>
          {!yesterdayDone.length && !yesterday?.done ? <div className="text-[11px] text-white/25">Nothing logged for that day.</div> : (
            <div className="space-y-2">
              {yesterdayDone.slice(-6).map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 p-2 rounded-xl bg-[#0e0e12] border border-white/5 opacity-70 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-green-500/20 border border-green-500/20 flex items-center justify-center shrink-0"><Check className="w-3 h-3 text-green-400" /></div>
                  <div className="flex-1 text-[13px] text-white/50 line-through truncate">{t.title}</div>
                  <div className="text-[10px] text-white/20 shrink-0">{t.time}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TaskColumn({ icon, title, count, tasks, onToggle, onRemove, empty }: any) {
  return (
    <div className="bg-[#141418] border border-white/10 rounded-xl p-3 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-white min-w-0">{icon}<span className="truncate">{title}</span></div>
        <span className="text-[11px] bg-white/5 border border-white/10 rounded-full px-2 py-0.5 text-white/40 shrink-0">{count}</span>
      </div>
      <div className="space-y-1.5">
        {tasks.length === 0 && <div className="py-5 text-center text-[11px] text-white/20">{empty}</div>}
        {tasks.map((t: any) => {
          const done = isDone(t)
          return (
            <div key={t.id} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#0e0e12] border border-white/5 group min-w-0">
              <button onClick={() => onToggle(t)} className={`${done ? 'bg-white border-white' : 'bg-transparent border-white/20'} w-5 h-5 rounded-full border flex items-center justify-center shrink-0`}>
                {done && <Check className="w-3 h-3 text-black" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`${done ? 'line-through text-white/25' : 'text-white/90'} text-[13px] flex items-start gap-1.5`}>
                  <span className="flex-1 min-w-0 break-words" title={t.title}>{t.title}</span>
                  {t.priority === 'high' && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 border border-amber-500/20 text-amber-300 shrink-0">high</span>}
                </div>
                <div className="text-[10px] text-white/30 flex items-center gap-1 mt-0.5 truncate">
                  {t.kind === 'daily' ? <Repeat className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                  <span className="truncate">{t.kind === 'daily' ? 'every day' : (t.time || t.date)}</span>
                  {t.reminderAt && <span className="text-violet-300/70">• {new Date(t.reminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                </div>
              </div>
              <button onClick={() => onRemove(t.id)} className="w-7 h-7 rounded-full bg-white/5 border border-white/5 flex items-center justify-center opacity-50 group-hover:opacity-100 shrink-0"><Trash2 className="w-3.5 h-3.5 text-white/40" /></button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
