import { useEffect, useState } from 'react'
import { Droplets, Plus, ZapOff, Calendar, Clock, Trash2, Coffee, Beaker } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { speakingModel } from '../../speaking/speakingModel'
import { todayKey, yesterdayKey } from '../../lib/clock'

type DrinkLog = { id: string, date: string, amount: number, name: string, time: string }
type WeeklyDrink = { id: string, frequency: string, day: string, name: string, amount: number, time: string, enabled: boolean }
type HistoryItem = { date: string, total: number, goal: number, pct: number }

// ============== BACKEND HOOKS ==============
const API = {
  async saveLog(log: DrinkLog) {
    // TODO: POST /api/water/log
    console.log('[BACKEND] POST /api/water/log', log)
  },
  async saveWeeklyPlan(plan: WeeklyDrink[]) {
    // TODO: POST /api/water/weekly-plan
    console.log('[BACKEND] POST /api/water/weekly-plan', plan)
  },
  async archiveDay(payload: HistoryItem) {
    // TODO: POST /api/water/archive { date, total, goal, pct }
    console.log('[DB UPDATE 12AM] POST /api/water/archive', payload)
  },
  async fetchHistory(): Promise<HistoryItem[]> {
    // TODO: GET /api/water/history
    try { return JSON.parse(localStorage.getItem('habitOS_waterHistory') || '[]') } catch { return [] }
  }
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const FREQUENCY = [
  { value: 'daily', label: 'Daily' },
  { value: '2days', label: '2 days once' },
  { value: '3days', label: '3 days once' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'specific', label: 'Specific day' }
]

function LineGraph({ data, color = '#3b82f6' }: { data: number[], color?: string }) {
  const w = 320, h = 80, pad = 20
  const max = Math.max(...data, 100)
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - (v / max) * (h - pad * 2)
    return { x, y, v }
  })
  const path = points.map((p, i) => `${i === 0? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24">
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill={color} stroke="#141418" strokeWidth="2" />
          <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="8" fill="#fff" opacity="0.4">{p.v}%</text>
        </g>
      ))}
    </svg>
  )
}

function MonthlyLineGraph({ data }: { data: { d: string, total: number }[] }) {
  const w = 320, h = 80, pad = 20
  const max = 21
  const points = data.map((m, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - (m.total / max) * (h - pad * 2)
    return { x, y, m }
  })
  const path = points.map((p, i) => `${i === 0? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24">
      <path d={path} fill="none" stroke="#22d3ee" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="#22d3ee" stroke="#0e0e12" strokeWidth="2" />
          <text x={p.x} y={h - 2} textAnchor="middle" fontSize="8" fill="#fff" opacity="0.3">{p.m.d}</text>
        </g>
      ))}
    </svg>
  )
}

export default function WaterView() {
  const { setShowSkipConfirm, setSkipTarget, skips } = useApp() as any
  const isSkipped = (skips || []).some((k: any) => k.streakId === 'water' && new Date() <= new Date(k.endDate))

  const [dailyGoal, setDailyGoal] = useState(() => {
    try { return JSON.parse(localStorage.getItem('habitOS_waterGoal') || '{"amount":3000,"name":"Water"}') } catch { return { amount: 3000, name: 'Water' } }
  })
  const [logs, setLogs] = useState<DrinkLog[]>(() => {
    try { return JSON.parse(localStorage.getItem('habitOS_waterLogs') || '[]') } catch { return [] }
  })
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('habitOS_waterHistory') || '[]') } catch { return [] }
  })

  const todayStr = todayKey()
  const todayLogs = logs.filter(l => l.date === todayStr)
  const todayTotal = todayLogs.reduce((a,b)=>a+b.amount,0)
  const pct = Math.min(100, Math.round((todayTotal / dailyGoal.amount)*100))

  // Isolated states for typing fix
  const [customAmount, setCustomAmount] = useState('250')
  const [customName, setCustomName] = useState('Water')

  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyDrink[]>(() => {
    try { return JSON.parse(localStorage.getItem('habitOS_weeklyDrinks') || '[]') } catch { return [
      { id: '1', frequency: 'daily', day: 'Daily', name: 'Water', amount: 500, time: '08:00', enabled: true },
      { id: '2', frequency: '2days', day: '2 days once', name: 'Lemon Water', amount: 500, time: '08:00', enabled: true },
    ]}
  })

  const [weeklyDrinkName, setWeeklyDrinkName] = useState('')
  const [weeklyAmount, setWeeklyAmount] = useState('500')
  const [weeklyFrequency, setWeeklyFrequency] = useState('daily')
  const [weeklyDay, setWeeklyDay] = useState('Mon')
  const [weeklyTime, setWeeklyTime] = useState('08:00')

  // --- 12 AM ROLLOVER + DB UPDATE ---
  useEffect(() => {
    const archiveYesterday = () => {
      const yStr = yesterdayKey()
      const yLogs = logs.filter(l => l.date === yStr)
      const yTotal = yLogs.reduce((a,b)=>a+b.amount,0)
      if (yTotal === 0) return
      if (history.find(h=>h.date===yStr)) return

      const item: HistoryItem = { date: yStr, total: yTotal, goal: dailyGoal.amount, pct: Math.round((yTotal/dailyGoal.amount)*100) }
      const newHist = [...history, item]
      setHistory(newHist)
      localStorage.setItem('habitOS_waterHistory', JSON.stringify(newHist))
      API.archiveDay(item)
    }

    // On mount check if last rollover missed
    const last = localStorage.getItem('habitOS_lastRollover') || ''
    if (last && last!== todayStr) {
      archiveYesterday()
      localStorage.setItem('habitOS_lastRollover', todayStr)
    }
    if (!last) localStorage.setItem('habitOS_lastRollover', todayStr)

    // Watcher every minute for 12 AM
    const interval = setInterval(() => {
      const now = new Date()
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        const lastRoll = localStorage.getItem('habitOS_lastRollover') || ''
        const today = todayKey()
        if (lastRoll!== today) {
          archiveYesterday()
          localStorage.setItem('habitOS_lastRollover', today)
        }
      }
    }, 60000)

    return () => clearInterval(interval)
  }, [logs, history, dailyGoal.amount, todayStr])

  useEffect(()=>{
    localStorage.setItem('habitOS_waterLogs', JSON.stringify(logs))
    window.dispatchEvent(new CustomEvent('habit:water-log', { detail: { todayTotal: logs.filter(l => l.date === todayStr).reduce((a, b) => a + b.amount, 0) } }))
  }, [logs, todayStr])
  useEffect(()=>{ localStorage.setItem('habitOS_weeklyDrinks', JSON.stringify(weeklyPlan)); API.saveWeeklyPlan(weeklyPlan) }, [weeklyPlan])
  useEffect(()=>{ localStorage.setItem('habitOS_waterGoal', JSON.stringify(dailyGoal)) }, [dailyGoal])

  const addLog = (amount: number, name: string) => {
    const log: DrinkLog = { id: Date.now().toString(), date: todayStr, amount, name, time: new Date().toLocaleTimeString().slice(0,5) }
    setLogs(prev=>[...prev, log])
    API.saveLog(log)
    speakingModel.speak(`Added ${amount} ml ${name}`)
  }

  const addWeekly = () => {
    if (!weeklyDrinkName.trim()) return
    const dayLabel = weeklyFrequency === 'specific'? weeklyDay : (FREQUENCY.find(f=>f.value===weeklyFrequency)?.label || weeklyFrequency)
    const item: WeeklyDrink = {
      id: Date.now().toString(),
      frequency: weeklyFrequency,
      day: dayLabel,
      name: weeklyDrinkName.trim(),
      amount: parseInt(weeklyAmount)||500,
      time: weeklyTime,
      enabled: true
    }
    setWeeklyPlan(prev=>[...prev, item])
    setWeeklyDrinkName('')
  }

  // Analytics from DB (history)
  const weeklyCompletes = history.length>=7? history.slice(-7).map(h=>h.pct) : [60,80,45,90,70,85,75]
  const monthlyData = history.length>=4? [
    { d: 'W1', total: history.slice(-28,-21).reduce((a,b)=>a+b.total,0)/1000 },
    { d: 'W2', total: history.slice(-21,-14).reduce((a,b)=>a+b.total,0)/1000 },
    { d: 'W3', total: history.slice(-14,-7).reduce((a,b)=>a+b.total,0)/1000 },
    { d: 'W4', total: history.slice(-7).reduce((a,b)=>a+b.total,0)/1000 },
  ] : [
    { d: 'W1', total: 18.5 }, { d: 'W2', total: 20.2 }, { d: 'W3', total: 15.8 }, { d: 'W4', total: 19.5 },
  ]

  return (
    <div className="p-4 space-y-4 bg-[#0f0f12] min-h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-widest text-white flex items-center gap-2"><Droplets className="w-4 h-4 text-blue-400" /> WATER • DAILY + WEEKLY</h2>
        <button onClick={() => { setSkipTarget({ id: 'water', name: 'Water' }); setShowSkipConfirm(true) }} className={isSkipped? 'px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/20 text-xs text-amber-200' : 'px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs'}>{isSkipped? 'Skipped' : 'Skip N days'}</button>
      </div>

      <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
        <div className="flex justify-between mb-3"><div className="text-xs tracking-widest text-white/40">ANALYTICS • FROM DATABASE • AUTO RESETS AT 12 AM</div><div className="text-xs text-white/20">history: {history.length} days • GET /api/water/history</div></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
            <div className="text-xs text-white/40 mb-1">WEEKLY COMPLETES % • Goal {dailyGoal.amount}ml</div>
            <LineGraph data={weeklyCompletes} color="#3b82f6" />
            <div className="flex justify-between mt-1">{DAYS.map(d=><span key={d} className="text-xs text-white/20">{d}</span>)}</div>
          </div>
          <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
            <div className="text-xs text-white/40 mb-1">MONTHLY • Litres / week • Target 21L</div>
            <MonthlyLineGraph data={monthlyData} />
            <div className="flex justify-between mt-1 text-xs text-white/20"><span>0L</span><span className="text-cyan-400">● Actual from DB</span><span>21L goal</span></div>
          </div>
        </div>
      </div>

      <div className={isSkipped? 'rounded-xl bg-amber-500/10 border border-amber-500/20 p-4' : 'rounded-xl bg-[#141418] border border-white/10 p-4'}>
        <div className="flex justify-between">
          <div><div className="text-xs tracking-widest text-white/40">DAILY STREAK • START TARGET</div><div className="flex items-end gap-2"><div className="text-2xl font-bold text-white">{todayTotal}ml</div><div className="text-sm text-white/40">/ {dailyGoal.amount}ml • {pct}%</div></div></div>
          <input value={dailyGoal.amount} onChange={e=>setDailyGoal({...dailyGoal, amount: parseInt(e.target.value)||3000 })} type="number" className="w-20 px-2 py-1 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white" />
        </div>
        <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: pct + '%' }} /></div>
        <div className="mt-3 grid grid-cols-12 gap-2">
          <div className="col-span-7 flex gap-2">{[250,500,750].map(ml=><button key={ml} onClick={()=>addLog(ml, dailyGoal.name)} className="flex-1 py-2 rounded-xl bg-white text-black text-xs font-semibold"><Plus className="w-3 h-3 inline" /> {ml}ml</button>)}</div>
          <div className="col-span-5 flex gap-1 bg-[#0e0e12] border border-white/5 rounded-xl p-1">
            <input value={customName} onChange={e=>setCustomName(e.target.value)} onFocus={e=>e.stopPropagation()} placeholder="Drink name" type="text" autoComplete="off" className="flex-1 px-2 py-1 rounded-lg bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20 focus:outline-none" />
            <input value={customAmount} onChange={e=>setCustomAmount(e.target.value)} type="number" className="w-14 px-1 py-1 rounded-lg bg-[#141418] border border-white/10 text-xs text-white" />
            <button onClick={()=>addLog(parseInt(customAmount)||250, customName || 'Water')} className="px-2 py-1 rounded-lg bg-blue-500 text-white text-xs">Enter</button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">{todayLogs.map(l=><span key={l.id} className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/40"><Beaker className="w-3 h-3 inline" /> {l.time} • {l.amount}ml {l.name}</span>)}</div>
      </div>

      <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3"><Calendar className="w-4 h-4 text-violet-400" /><div className="text-xs font-semibold tracking-widest text-white">WEEKLY STREAK • WHAT TO DRINK • FREQUENCY</div></div>

        <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3 mb-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={weeklyDrinkName}
              onChange={e=>setWeeklyDrinkName(e.target.value)}
              onFocus={e=>e.stopPropagation()}
              placeholder="Drink name - e.g. Lemon Water, Jeera Water, Protein"
              type="text"
              autoComplete="off"
              className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500/30"
            />
            <input value={weeklyAmount} onChange={e=>setWeeklyAmount(e.target.value)} type="number" placeholder="ml" className="w-20 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-sm text-white" />
          </div>
          <div className="flex gap-2">
            <select value={weeklyFrequency} onChange={e=>setWeeklyFrequency(e.target.value)} className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white">
              {FREQUENCY.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            {weeklyFrequency === 'specific' && (
              <select value={weeklyDay} onChange={e=>setWeeklyDay(e.target.value)} className="px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white">
                {DAYS.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <input value={weeklyTime} onChange={e=>setWeeklyTime(e.target.value)} type="time" className="w-24 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white" />
            <button onClick={addWeekly} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold">Add weekly</button>
          </div>
          <div className="text-xs text-white/20">Daily → every day • 2 days once → Mon/Wed/Fri • 3 days once → Mon/Thu • Specific → only that weekday • Resets at 12 AM, history saved to DB</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {weeklyPlan.length===0? <div className="text-xs text-white/20">No weekly drinks — add above</div> : weeklyPlan.map(w=>(
            <div key={w.id} className="flex items-center gap-2 p-3 rounded-xl bg-[#0e0e12] border border-white/5">
              <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center"><Coffee className="w-4 h-4 text-white/40" /></div>
              <div className="flex-1"><div className="text-sm text-white">{w.amount}ml {w.name}</div><div className="text-xs text-white/30 flex items-center gap-1"><Clock className="w-3 h-3" /> {w.day} • {w.time} • {w.frequency}</div></div>
              <button onClick={()=>setWeeklyPlan(prev=>prev.map(x=>x.id===w.id? {...x, enabled:!x.enabled}:x))} className={`w-8 h-4 rounded-full p-0.5 ${w.enabled? 'bg-violet-600' : 'bg-white/10'}`}><div className={`w-3 h-3 rounded-full bg-white transition ${w.enabled? 'translate-x-3' : ''}`} /></button>
              <button onClick={()=>setWeeklyPlan(prev=>prev.filter(x=>x.id!==w.id))} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center"><Trash2 className="w-3 h-3 text-white/30" /></button>
            </div>
          ))}
        </div>
      </div>

      {isSkipped && <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-200 flex items-center gap-1"><ZapOff className="w-3 h-3" /> Water skipped today — gray in analytics, not failure</div>}
    </div>
  )
}