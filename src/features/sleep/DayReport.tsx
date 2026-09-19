import { useEffect, useState } from 'react'
import { Activity, Moon, Sun, Droplets, ListChecks, Dumbbell, Flame } from 'lucide-react'
import { readSessions, type DaySession } from '../../core/dayFlow'
import { dayKey, todayKey, weekdayOf, spanLabel } from '../../lib/clock'
import { useApp } from '../../store/AppContext'

import { readArray, readRecord } from '../../lib/store'

// Shape-checked reads: a cleared or missing key is an empty array/map, never the wrong type,
// which is exactly what used to crash the Sleep page after Settings • Clean data.
const readArrayOnly = <T,>(key: string): T[] => readArray<T>(key)
const readMapOnly = <T,>(key: string): Record<string, T> => readRecord<T>(key)

type DayStat = DaySession & { awayMin: number; tasksTotal: number; workoutDone: number; waterMl: number }

/**
 * The day report — nothing in here is invented.
 *
 * Awake time and away time are derived from the Start the day / End the day stamps
 * (habitOS_daySessions), completion counts from the plan log and the workout rows, water
 * from the drink log. A day you never started simply has no bar.
 */
export function DayReport({ idleMinutes = 0, isSleeping = false }: { idleMinutes?: number; isSleeping?: boolean }) {
  const app = useApp() as any
  const [, force] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 30000)
    return () => clearInterval(iv)
  }, [])

  const rows = buildStats(app)
  const started = rows.filter((r) => r.startedAt)
  const nothingYet = rows.every((r) => !r.startedAt)
  const maxAwake = Math.max(1, ...rows.map((r) => r.minutes))
  const maxAway = Math.max(1, ...rows.map((r) => r.awayMin))
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.minutes, 0) / rows.length) : 0
  const closeRate = rows.length ? Math.round((started.length / rows.length) * 100) : 0

  return (
    <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-[#0e0e12] border border-white/10 flex items-center justify-center"><Activity className="w-4 h-4 text-violet-400" /></div>
          <div>
            <div className="text-xs tracking-widest text-white/40">DAY REPORT • REAL START / END STAMPS</div>
            <div className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">
              {isSleeping ? <span className="flex items-center gap-1 text-green-400"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> idle {idleMinutes}m</span> : <span>awake • idle {idleMinutes}m</span>}
              <span className="text-white/30 font-normal">• avg {spanLabel(avg)} • days closed {closeRate}%</span>
            </div>
          </div>
        </div>
        <div className="text-[10px] text-white/25">7 sessions • {started.length} started</div>
      </div>

      {nothingYet ? (
        <div className="rounded-xl bg-[#0e0e12] border border-white/5 p-4 text-[12px] text-white/30">
          No day has been started yet, so there is nothing to report. Press <span className="text-white/55">Start the day</span> and this fills in from the real timestamps.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* awake + away bars */}
          <div className="lg:col-span-2 rounded-xl bg-[#0e0e12] border border-white/5 p-3">
            <div className="flex items-center justify-between text-[10px] tracking-widest text-white/30 mb-2">
              <span>AWAKE (blue) vs AWAY (violet)</span>
              <span className="tabular-nums">max {spanLabel(Math.max(maxAwake, maxAway))}</span>
            </div>
            <div className="flex items-end gap-1.5 h-28">
              {rows.map((r) => (
                <div key={r.day} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${r.day} • awake ${spanLabel(r.minutes)}${r.awayMin ? ` • away ${spanLabel(r.awayMin)}` : ''}`}>
                  <div className="w-full flex flex-col justify-end gap-0.5 h-full">
                    <div className={`w-full rounded-sm ${r.awayMin ? 'bg-violet-400/70' : 'bg-transparent'}`} style={{ height: `${(r.awayMin / Math.max(maxAwake, maxAway)) * 100}%`, minHeight: 2 }} />
                    <div className={`w-full rounded-sm ${r.startedAt ? 'bg-blue-500' : 'bg-white/10'}`} style={{ height: `${(r.minutes / Math.max(maxAwake, maxAway)) * 100}%`, minHeight: 2 }} />
                  </div>
                  <span className="text-[9px] text-white/25">{weekdayOf(r.day)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-white/30">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500" /> awake window</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-400/70" /> closed / away</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-white/10" /> day not started</span>
            </div>
          </div>

          {/* per-day numbers */}
          <div className="rounded-xl bg-[#0e0e12] border border-white/5 p-3 space-y-1.5">
            <div className="text-[10px] tracking-widest text-white/30 mb-1">LAST DAYS</div>
            {rows.slice(-4).reverse().map((r) => (
              <div key={r.day} className="text-[11px] flex items-center gap-2 min-w-0">
                <span className="text-white/40 w-16 shrink-0 tabular-nums">{r.day.slice(5)}</span>
                <span className="flex items-center gap-1 text-white/60 tabular-nums"><Sun className="w-3 h-3 text-blue-400/70" />{r.minutes}m</span>
                <span className="flex items-center gap-1 text-white/50 tabular-nums"><Moon className="w-3 h-3" />{r.awayMin}m</span>
                <span className="flex items-center gap-1 text-white/50 tabular-nums ml-auto" title="tasks done / total"><ListChecks className="w-3 h-3" />{r.tasksDone}/{r.tasksTotal}</span>
                <span className="flex items-center gap-1 text-white/50 tabular-nums" title="workout sets"><Dumbbell className="w-3 h-3" />{r.workoutDone}</span>
                <span className="flex items-center gap-1 text-white/50 tabular-nums" title="water"><Droplets className="w-3 h-3" />{(r.waterMl / 1000).toFixed(1)}L</span>
              </div>
            ))}
            <div className="pt-1 text-[10px] text-white/25 flex items-center gap-1"><Flame className="w-3 h-3" /> plan items reminded: {app.reminderLog?.length || 0} today</div>
          </div>
        </div>
      )}
    </div>
  )
}

function buildStats(app: any): DayStat[] {
  const sessions = readSessions()
  const taskLog = readMapOnly<string>('habitOS_taskDone')
  const workoutMap = readMapOnly<string[]>('habitOS_workoutDone')
  const waterLogs = readArrayOnly<any>('habitOS_waterLogs')
  const planLog: string[] = (app.reminderLog || [])

  const byDay = new Map<string, DayStat>()
  for (const s of sessions) {
    const day = s.day
    const tasksTotal = (app.tasks || []).filter((t: any) => (t.date || day) === day).length
    byDay.set(day, {
      ...s,
      awayMin: 0,
      tasksTotal: s.tasksTotal || tasksTotal || Object.keys(taskLog).filter((k) => taskLog[k] === day).length,
      tasksDone: s.tasksDone || Object.values(taskLog).filter((d) => d === day).length,
      workoutDone: Object.values(workoutMap).filter((list: any) => Array.isArray(list) && list.includes(day)).length,
      waterMl: waterLogs.filter((l: any) => dayKeyOf(l.date) === day).reduce((a: number, b: any) => a + (b.amount || 0), 0)
    })
  }
  // today from live state so the graph moves during the day
  const t = todayKey()
  const liveTasks = (app.tasks || []).filter((x: any) => (x.date || t) === t)
  if (!byDay.has(t)) byDay.set(t, { day: t, startedAt: app.dayStartedAt || null, endedAt: null, endReason: null, minutes: 0, tasksDone: 0, planFired: 0, waterMl: 0, awayMin: 0, tasksTotal: liveTasks.length, workoutDone: 0 })
  const today = byDay.get(t)!
  today.minutes = app.dayStartedAt ? Math.max(0, Math.round((Date.now() - Date.parse(app.dayStartedAt)) / 60000)) : 0
  today.tasksDone = liveTasks.filter((x: any) => x.status === 'done').length
  today.tasksTotal = liveTasks.length || today.tasksTotal
  today.waterMl = Number(app.water || 0) || today.waterMl
  today.workoutDone = Object.values(workoutMap).filter((list: any) => Array.isArray(list) && list.includes(t)).length
  today.planFired = planLog.length

  const list = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-7)
  // away = gap between one day's close and the next day's start (real time the app was shut/hidden)
  for (let i = 0; i < list.length - 1; i++) {
    const end = list[i].endedAt ? Date.parse(list[i].endedAt!) : null
    const next = list[i + 1].startedAt ? Date.parse(list[i + 1].startedAt!) : null
    if (end && next) list[i].awayMin = Math.max(0, Math.round((next - end) / 60000))
    else if (end && !list[i + 1].startedAt) list[i].awayMin = Math.max(0, Math.round((Date.now() - end) / 60000))
  }
  return list
}

function dayKeyOf(value: any): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : dayKey(d)
}
export default DayReport
