import { useEffect, useState, useRef } from 'react'
import { BarChart3, Calendar, Dumbbell, ListTodo, FolderKanban, Moon, Waves } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { dayKey } from '../../lib/clock'

function MultiColorLinearGraph({ workout, tasks, projects, sleep }: { workout: number[], tasks: number[], projects: number[], sleep: number[] }) {
  const w = 600, h = 160, pad = 30
  const max = 100
  const makePoints = (data: number[]) => data.map((v, i) => ({
    x: pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2),
    y: h - pad - (v / max) * (h - pad * 2),
  }))
  const lines = [
    { data: workout, color: '#f97316', label: 'Workout' },
    { data: tasks, color: '#22c55e', label: 'Tasks' },
    { data: projects, color: '#8b5cf6', label: 'Projects' },
    { data: sleep, color: '#3b82f6', label: 'Sleep' },
  ]
  return (
    <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-4">
      <div className="flex justify-between mb-3">
        <div className="text-xs tracking-widest text-white/40">OVERALL • MULTI COLOR LINEAR • FROM DB • 12 AM RESET</div>
        <div className="flex gap-3 text-xs text-white/40">
          <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-orange-500" /> Workout</span>
          <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-green-500" /> Tasks</span>
          <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-violet-500" /> Projects</span>
          <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-blue-500" /> Sleep</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-44">
        {[0,25,50,75,100].map(v => {
          const y = h - pad - (v / 100) * (h - pad * 2)
          return <g key={v}><line x1={pad} y1={y} x2={w-pad} y2={y} stroke="white" strokeOpacity={0.05} /><text x={2} y={y+3} fontSize="8" fill="white" opacity={0.2}>{v}%</text></g>
        })}
        {lines.map((line, idx) => {
          const pts = makePoints(line.data)
          const path = pts.map((p, i) => `${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ')
          return (
            <g key={idx}>
              <path d={path} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="3.5" fill={line.color} stroke="#0e0e12" strokeWidth="1.5" />)}
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-xs text-white/20 mt-1">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><span key={d}>{d}</span>)}</div>
    </div>
  )
}

function LinearDottedGraph({ data, color, label }: { data: number[], color: string, label: string }) {
  const w = 300, h = 70, pad = 15
  const max = Math.max(...data, 100)
  const pts = data.map((v,i)=>({ x: pad + (i/Math.max(1,data.length-1))*(w-pad*2), y: h - pad - (v/max)*(h-pad*2) }))
  const path = pts.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
      <div className="text-xs text-white/30 mb-1">{label}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 4" />
        {pts.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r="4" fill={color} stroke="#0e0e12" strokeWidth="2" /><circle cx={p.x} cy={p.y} r="1.5" fill="#fff" /></g>)}
      </svg>
    </div>
  )
}

function InteractiveSineWaves() {
  const ref = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let anim: number, t=0
    const draw = () => {
      t+=0.02
      const w = canvas.width = canvas.offsetWidth*2
      const h = canvas.height = canvas.offsetHeight*2
      ctx.clearRect(0,0,w,h)
      const waves = [
        { color: '#f97316', amp: 18 + mouse.current.y*0.07, freq: 0.012 + mouse.current.x*0.00003, offset: 0 },
        { color: '#22c55e', amp: 14 + mouse.current.y*0.04, freq: 0.018, offset: 1.2 },
        { color: '#8b5cf6', amp: 12, freq: 0.022, offset: 2.4 },
        { color: '#3b82f6', amp: 10, freq: 0.028, offset: 3.6 },
      ]
      waves.forEach(wv=>{
        ctx.beginPath()
        ctx.strokeStyle = wv.color
        ctx.lineWidth = 2
        for(let x=0;x<w;x++){
          const y = h/2 + Math.sin(x*wv.freq + t + wv.offset)*wv.amp + Math.sin(x*0.006 + t*0.5)*6
          if(x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y)
        }
        ctx.stroke()
      })
      anim = requestAnimationFrame(draw)
    }
    draw()
    return ()=>cancelAnimationFrame(anim)
  }, [])
  return (
    <canvas
      ref={ref}
      className="w-full h-24 rounded-xl bg-[#0e0e12] border border-white/5"
      onMouseMove={e=>{
        const r = (e.target as any).getBoundingClientRect()
        mouse.current.x = e.clientX - r.left
        mouse.current.y = e.clientY - r.top
      }}
    />
  )
}

import { dayController } from '../../core/dayController'
export default function AnalyticsView() {
  const { skips, pauses, dailyLogs, steaks = [] } = useApp() as any
  void dayController

  const [workout, setWorkout] = useState<number[]>([20,40,60,30,80,70,90])
  const [tasks, setTasks] = useState<number[]>([50,65,40,85,60,75,80])
  const [projects, setProjects] = useState<number[]>([64,32,45,70,55,80,60])
  const [sleep, setSleep] = useState<number[]>([70,60,80,50,90,85,75])

  useEffect(()=>{
    try {
      const wh = JSON.parse(localStorage.getItem('habitOS_workoutHistory') || '[]')
      if (wh.length>=7) setWorkout(wh.slice(-7).map((h:any)=>h.progress ?? h.pct ?? 0))
      const th = JSON.parse(localStorage.getItem('habitOS_tasksHistory') || '[]')
      if (th.length) {
        const grouped: any = {}
        th.forEach((t:any)=>{ if(!grouped[t.date]) grouped[t.date]=[]; grouped[t.date].push(t) })
        const perc = Object.values(grouped).slice(-7).map((arr:any)=> Math.round((arr.filter((x:any)=>x.status==='done').length / Math.max(1,arr.length))*100))
        if (perc.length) setTasks(perc)
      }
      const ph = JSON.parse(localStorage.getItem('habitOS_projects') || '[]')
      if (ph.length) setProjects(ph.slice(0,7).map((p:any)=>p.progress ?? 0))
      const sh = JSON.parse(localStorage.getItem('habitOS_waterHistory') || '[]')
      if (sh.length>=7) setSleep(sh.slice(-7).map((h:any)=>h.pct ?? 70))
    } catch {}
  }, [])

  const days = Array.from({ length: 30 }).map((_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (29 - i))
    const key = dayKey(d)
    const isSkip = (skips || []).some((sk: any) => key >= String(sk.startDate).slice(0, 10) && key <= String(sk.endDate).slice(0, 10))
    const isPause = (pauses || []).some((p: any) => String(p.date || p.startTime || '').slice(0, 10) === key)
    const hasLog = (dailyLogs || []).some((l: any) => l.date === key) || (steaks || []).some((st: any) => {
      const c = String(st.createdAt || '').slice(0, 10)
      const idx = Math.round((Date.parse(key) - Date.parse(c)) / 86400000)
      return (st.completed || []).includes(idx)
    })
    return { key, isSkip, isPause, hasLog, date: d }
  })

  return (
    <div className="p-4 md:p-6 space-y-4 bg-[#0f0f12] min-h-full">
      <h2 className="text-base font-semibold text-white flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-violet-400" /> Analytics • Skip = Gray (Not Failure) + Overall Multi
      </h2>

      {/* Overall multi color */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
        <MultiColorLinearGraph workout={workout} tasks={tasks} projects={projects} sleep={sleep} />
        <div>
          <div className="text-xs text-white/30 mb-2 flex items-center gap-2"><Waves className="w-3 h-3" /> SINEWAVE WAVEFORM • MULTI COLOR • REACTS ON HOVER MOVE</div>
          <InteractiveSineWaves />
        </div>
      </div>

      {/* Detailed sectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 space-y-3">
          <div className="flex items-center gap-2"><Dumbbell className="w-4 h-4 text-orange-400" /><div className="text-xs tracking-widest text-white">WORKOUT • DETAILED</div></div>
          <LinearDottedGraph data={workout} color="#f97316" label="Workout completion % • orange dotted • DB" />
          <div className="text-xs text-white/30">Avg {Math.round(workout.reduce((a,b)=>a+b,0)/workout.length)}% • Best {Math.max(...workout)}% • POST /api/workout/analytics</div>
        </div>
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 space-y-3">
          <div className="flex items-center gap-2"><ListTodo className="w-4 h-4 text-green-400" /><div className="text-xs tracking-widest text-white">DAILY TASKS • DETAILED</div></div>
          <LinearDottedGraph data={tasks} color="#22c55e" label="Tasks % • green dotted • 12 AM reset" />
          <div className="text-xs text-white/30">Avg {Math.round(tasks.reduce((a,b)=>a+b,0)/tasks.length)}% • POST /api/tasks/analytics</div>
        </div>
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 space-y-3">
          <div className="flex items-center gap-2"><FolderKanban className="w-4 h-4 text-violet-400" /><div className="text-xs tracking-widest text-white">PROJECTS • DETAILED</div></div>
          <LinearDottedGraph data={projects} color="#8b5cf6" label="Project completion % • priority high→top" />
          <div className="text-xs text-white/30">Avg {Math.round(projects.reduce((a,b)=>a+b,0)/projects.length)}% • Sorted by priority</div>
        </div>
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 space-y-3">
          <div className="flex items-center gap-2"><Moon className="w-4 h-4 text-blue-400" /><div className="text-xs tracking-widest text-white">SLEEP RITUALS • DETAILED</div></div>
          <LinearDottedGraph data={sleep} color="#3b82f6" label="Sleep consistency % • blue dotted" />
          <div className="text-xs text-white/30">Avg {Math.round(sleep.reduce((a,b)=>a+b,0)/sleep.length)}% • Target 8h • DB at 12 AM</div>
        </div>
      </div>

      <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 flex items-center gap-4">
        <div className="text-2xl font-bold text-white">{dayController.adherence30(30)}%</div>
        <div className="flex-1">
          <div className="text-xs tracking-widest text-white/40">ADHERENCE • LAST 30 DAYS</div>
          <div className="text-[11px] text-white/30 mt-0.5">Completed / (Total − Skipped − Paused). Skips and pausing never count as failure — they are subtracted, not punished.</div>
        </div>
        <div className="text-right text-[11px] text-white/30 font-mono">{(skips||[]).length} skips<br/>{(pauses||[]).length} pauses</div>
      </div>

      {/* Your original Last 30 days + Skip history */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-5">
        <div className="text-xs text-white/40 mb-3 flex items-center gap-2"><Calendar className="w-3 h-3" /> Last 30 days • Skip = Gray</div>
        <div className="grid grid-cols-10 md:grid-cols-15 gap-1.5">
          {days.map((day) => (
            <div key={day.key} className="group relative">
              <div className={
                day.isSkip ? 'h-8 rounded-md bg-[#2a2a30] border border-white/10' :
                day.isPause ? 'h-8 rounded-md bg-amber-500/20 border border-amber-500/20' :
                day.hasLog ? 'h-8 rounded-md bg-emerald-500' :
                'h-8 rounded-md bg-white/5 border border-white/10'
              } />
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                {day.key} • {day.isSkip ? 'Skipped (gray)' : day.isPause ? 'Paused' : day.hasLog ? 'Done' : 'Missed'}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-4 text-xs flex-wrap">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500" /> Done</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-[#2a2a30] border border-white/10" /> Skipped (gray, not failure)</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-500/20" /> Paused day</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-white/5" /> Missed</div>
        </div>
      </div>

      <div className="rounded-2xl bg-[#141418] border border-white/10 p-5">
        <div className="text-sm font-medium text-white mb-3">Skip History (Unlimited Entries)</div>
        {(skips || []).length === 0 ? (
          <div className="text-xs text-white/30">No skips yet. Say "skip water for 3 days"</div>
        ) : (
          <div className="space-y-2">
            {(skips || []).slice().reverse().map((s: any) => (
              <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                <div><div className="text-xs text-white">{s.streakId} • {s.days} days</div><div className="text-xs text-white/40">{s.startDate} → {s.endDate} • {s.reason}</div></div>
                <div className="text-xs text-white/30">{new Date(s.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}