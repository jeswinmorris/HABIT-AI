import { useEffect, useState } from 'react'
import { ListTodo, Check, Trash2, Flag, Clock, Bell, CalendarDays, Sunrise } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { speakingModel } from '../../speaking/speakingModel'
import { addDaysKey, todayKey, tomorrowKey, dateLabel, weekdayOf } from '../../lib/clock'

const weekdayShort = (key: string) => `${weekdayOf(key)} ${Number(key.slice(8, 10))}`

type Task = {
  id: string
  title: string
  status: 'todo' | 'done'
  priority: 'high' | 'normal'
  time: string
  date: string
  createdAt: string
  reminderAt?: string // ISO
  reminderDone?: boolean
}

const RANK: Record<string, number> = { high: 0, normal: 1, low: 2 }
const sortTasks = (list: Task[]) => list.slice().sort((a, b) => {
  const byStatus = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)
  if (byStatus) return byStatus
  const byP = (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1)
  if (byP) return byP
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
})

function GreenDottedGraph({ data }: { data: number[] }) {
  const w = 320, h = 80, pad = 20
  const max = Math.max(...data, 100)
  const pts = data.map((v, i) => ({ x: pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2), y: h - pad - (v / max) * (h - pad * 2), v }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
      <div className="text-xs text-white/30 mb-2">DAILY TASKS COMPLETION % • FROM DB</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
        <path d={path} fill="none" stroke="#22c55e" strokeWidth="2" strokeDasharray="4 4" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="#22c55e" stroke="#141418" strokeWidth="2" />
            <circle cx={p.x} cy={p.y} r="2" fill="#fff" />
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-xs text-white/20 mt-1">
        {['earliest', '', '', 'today'].map((d, i) => <span key={i}>{d}</span>)}
      </div>
    </div>
  )
}

export default function TasksView() {
  const { setShowSkipConfirm, setSkipTarget, tasks: allTasks, setTasks } = useApp() as any

  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<'high' | 'normal'>('normal')
  const [newDate, setNewDate] = useState(todayKey())
  const [newReminder, setNewReminder] = useState('')
  const [showReminderPicker, setShowReminderPicker] = useState(false)
  const [analytics, setAnalytics] = useState<number[]>([])
  const [ringingTask, setRingingTask] = useState<Task | null>(null)

  const today = todayKey()
  const tomorrow = tomorrowKey()
  const tasks = (allTasks || []) as Task[]
  const listFor = (key: string) => sortTasks(tasks.filter((t) => (t.date || today) === key))
  const todays = listFor(today)
  const tomorrows = listFor(tomorrow)
  const yesterday = addDaysKey(today, -1)
  const prevDayTasks = tasks.filter((t) => t.date === yesterday && t.status === 'done')

  useEffect(() => {
    const grouped: Record<string, Task[]> = {}
    tasks.forEach((t) => { const k = t.date || today; (grouped[k] = grouped[k] || []).push(t) })
    const pct = Object.keys(grouped).sort().slice(-7).map((k) => {
      const arr = grouped[k]
      return Math.round((arr.filter((x) => x.status === 'done').length / (arr.length || 1)) * 100)
    })
    if (pct.length) setAnalytics(pct)
  }, [tasks, today])

  // incoming reminder lines: task rows refresh instead of re-mounting
  useEffect(() => {
    const onSync = () => setAnalytics((a) => [...a])
    window.addEventListener('habit:tasks-updated', onSync)
    return () => window.removeEventListener('habit:tasks-updated', onSync)
  }, [])

  // reminder ringing
  useEffect(() => {
    const check = setInterval(() => {
      const now = new Date()
      const due = tasks.find((t) => t.reminderAt && !t.reminderDone && new Date(t.reminderAt) <= now && t.status !== 'done')
      if (due && !ringingTask) {
        setRingingTask(due)
        speakingModel.speak(`Reminder, ${due.title}`)
      }
    }, 30000)
    return () => clearInterval(check)
  }, [tasks, ringingTask])

  const write = (next: Task[]) => setTasks(next)

  const addTask = () => {
    if (!newTitle.trim()) return
    const task: Task = {
      id: Date.now().toString(),
      title: newTitle.trim(),
      status: 'todo',
      priority: newPriority,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: newDate,
      createdAt: new Date().toISOString(),
      reminderAt: newReminder ? new Date(newReminder).toISOString() : undefined
    }
    write([task, ...tasks])
    setNewTitle('')
    setNewPriority('normal')
    setNewReminder('')
    setShowReminderPicker(false)
    speakingModel.speak(`Added for ${task.date === tomorrow ? 'tomorrow' : 'today'}`)
  }

  const toggleTask = (id: string) => {
    write(tasks.map((t) => (t.id === id
      ? { ...t, status: t.status === 'done' ? 'todo' : 'done', reminderDone: t.status === 'todo' }
      : t)))
    const t = tasks.find((x) => x.id === id)
    if (t && t.status !== 'done') speakingModel.speak('Task done, nice!')
    if (ringingTask?.id === id) setRingingTask(null)
  }

  const removeTask = (id: string) => write(tasks.filter((t) => t.id !== id))

  const snoozeReminder = (id: string, mins = 10) => {
    write(tasks.map((t) => (t.id === id ? { ...t, reminderAt: new Date(Date.now() + mins * 60000).toISOString(), reminderDone: false } : t)))
    setRingingTask(null)
    speakingModel.speak(`Snoozed for ${mins} minutes`)
  }

  return (
    <div className="p-3 md:p-4 space-y-4 bg-[#0f0f12] min-h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2"><ListTodo className="w-4 h-4 text-violet-400" /> Daily Tasks</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30 hidden sm:inline">Voice: “add task call the lab for tomorrow”</span>
          <button onClick={() => { setSkipTarget({ id: 'tasks', name: 'Tasks' }); setShowSkipConfirm(true) }} className="px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs">Skip N days</button>
        </div>
      </div>

      <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4">
        <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-2">
          <div className="flex flex-wrap gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onFocus={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask() }}
              placeholder="Add task — anything, any day"
              type="text"
              autoComplete="off"
              className="flex-1 min-w-40 px-3 py-2 rounded-xl bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none"
            />
            <button onClick={() => setNewPriority((p) => (p === 'high' ? 'normal' : 'high'))} className={`${newPriority === 'high' ? 'bg-amber-500/20 border-amber-500/30 text-amber-200' : 'bg-white/5 border-white/10 text-white/40'} px-3 py-2 rounded-full border text-xs flex items-center gap-1`}>
              <Flag className="w-3 h-3" /> Priority
            </button>
            <button onClick={() => setNewDate((d) => (d === today ? tomorrow : today))} className={`px-3 py-2 rounded-full border text-xs flex items-center gap-1 ${newDate === tomorrow ? 'bg-violet-500/20 border-violet-500/30 text-violet-200' : 'bg-white/5 border-white/10 text-white/40'}`}>
              {newDate === tomorrow ? <Sunrise className="w-3 h-3" /> : <Clock className="w-3 h-3" />} {newDate === tomorrow ? 'Tomorrow' : 'Today'}
            </button>
            <button onClick={() => setShowReminderPicker(!showReminderPicker)} className={`${newReminder ? 'bg-violet-500/20 border-violet-500/30 text-violet-200' : 'bg-white/5 border-white/10 text-white/40'} px-3 py-2 rounded-full border text-xs flex items-center gap-1`}>
              <Bell className="w-3 h-3" /> {newReminder ? new Date(newReminder).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Reminder'}
            </button>
            <button onClick={addTask} className="px-5 py-2 rounded-full bg-white text-black text-xs font-semibold">Add</button>
          </div>
          {showReminderPicker && (
            <div className="mt-2 flex flex-wrap gap-2 items-center bg-[#141418] border border-white/10 rounded-xl p-2">
              <input type="datetime-local" value={newReminder} onChange={(e) => setNewReminder(e.target.value)} className="flex-1 min-w-48 px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white" />
              <button onClick={() => setNewReminder('')} className="text-xs text-white/30">Clear</button>
              <div className="text-xs text-white/20">or quick:</div>
              {[10, 30, 60].map((m) => (
                <button key={m} onClick={() => { const d = new Date(); d.setMinutes(d.getMinutes() + m); setNewReminder(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)) }} className="px-2 py-1 rounded-full bg-white/10 text-xs text-white/60">{m}m</button>
              ))}
            </div>
          )}
        </div>

        {ringingTask && (
          <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-wrap items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500 animate-pulse flex items-center justify-center"><Bell className="w-4 h-4 text-white" /></div>
            <div className="flex-1 min-w-40"><div className="text-sm text-white">Reminder: {ringingTask.title}</div><div className="text-xs text-white/40">Set for {ringingTask.reminderAt ? new Date(ringingTask.reminderAt).toLocaleTimeString() : ''}</div></div>
            <div className="flex gap-2">
              <button onClick={() => toggleTask(ringingTask.id)} className="px-3 py-1.5 rounded-full bg-white text-black text-xs">Done</button>
              <button onClick={() => snoozeReminder(ringingTask.id, 10)} className="px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs">Snooze 10m</button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TaskColumn title={`Today • ${dateLabel()}`} count={todays.length} tasks={todays} onToggle={toggleTask} onRemove={removeTask} empty="Nothing for today yet." />
        <TaskColumn
          title={`Tomorrow • ${weekdayShort(tomorrow)}`}
          count={tomorrows.length}
          tasks={tomorrows}
          onToggle={toggleTask}
          onRemove={removeTask}
          empty="Queue tomorrow before you close the day — it appears here as soon as it is added, and becomes Today when you start the day."
          hint="appears after the alarm is stopped"
        />
      </div>

      {analytics.length > 1 && (
        <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
          <GreenDottedGraph data={analytics} />
          <div className="mt-2 text-xs text-white/20">Completion per day, newest last • history is kept per real calendar date</div>
        </div>
      )}

      <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs tracking-widest text-white/40 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> PREVIOUS DAY COMPLETED • {yesterday}</div>
          <div className="text-xs text-white/20">{prevDayTasks.length} done yesterday</div>
        </div>
        {prevDayTasks.length === 0 ? <div className="text-xs text-white/20">No completed tasks yesterday</div> : (
          <div className="space-y-2">
            {prevDayTasks.slice(-6).map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-2 rounded-xl bg-[#0e0e12] border border-white/5 opacity-60">
                <div className="w-6 h-6 rounded-full bg-green-500/20 border border-green-500/20 flex items-center justify-center"><Check className="w-3 h-3 text-green-400" /></div>
                <div className="flex-1 text-sm text-white/50 line-through truncate">{t.title}</div>
                <div className="text-xs text-white/20">{t.time}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskColumn({ title, count, tasks, onToggle, onRemove, empty, hint }: any) {
  return (
    <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white truncate">{title}</div>
        <div className="flex items-center gap-2 shrink-0">
          {hint && <span className="text-[10px] text-white/25 hidden sm:inline">{hint}</span>}
          <span className="text-[11px] bg-white/5 border border-white/10 rounded-full px-2 py-0.5 text-white/40">{count}</span>
        </div>
      </div>
      <div className="space-y-2">
        {tasks.length === 0 && <div className="p-6 text-center text-xs text-white/20">{empty}</div>}
        {tasks.map((t: Task) => (
          <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#0e0e12] border border-white/5 group">
            <button onClick={() => onToggle(t.id)} className={`${t.status === 'done' ? 'bg-white border-white' : 'bg-transparent border-white/20'} w-6 h-6 rounded-full border flex items-center justify-center shrink-0`}>
              {t.status === 'done' && <Check className="w-3 h-3 text-black" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className={`${t.status === 'done' ? 'line-through text-white/20' : 'text-white'} text-sm flex items-center gap-2 flex-wrap`}>
                <span className="truncate max-w-full">{t.title}</span>
                {t.priority === 'high' && <span className="text-xs px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/20 text-amber-300 flex items-center gap-1 shrink-0"><Flag className="w-3 h-3" /> HIGH</span>}
                {t.reminderAt && <span className="text-xs px-1.5 py-0.5 rounded-md bg-violet-500/20 border border-violet-500/20 text-violet-300 flex items-center gap-1 shrink-0"><Bell className="w-3 h-3" /> {new Date(t.reminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
              <div className="text-xs text-white/30 flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3" /> {t.time} • {t.date}</div>
            </div>
            <button onClick={() => onRemove(t.id)} className="w-8 h-8 rounded-full bg-white/5 border border-white/5 flex items-center justify-center opacity-60 group-hover:opacity-100 shrink-0"><Trash2 className="w-4 h-4 text-white/40" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
