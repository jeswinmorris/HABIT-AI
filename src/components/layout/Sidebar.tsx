
import { LayoutDashboard, Moon, Droplets, Dumbbell, ClipboardList, FolderKanban, Sparkles, BarChart3, Settings, Zap, User, ZapOff, PlayCircle, PauseCircle, Heart, Wind, Smile, Brain } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { personality } from '../../speaking/personality'
import { todayKey, tomorrowKey, dateLabel } from '../../lib/clock'
import { tasksOn } from '../../core/dayFlow'

const NAV = [
  { id: 'Today', icon: LayoutDashboard, label: 'Today', badge: 'FLOW' },
  { id: 'Sleep', icon: Moon, label: 'Sleep & Wakeup' },
  { id: 'Water', icon: Droplets, label: 'Water', suffix: '3L' },
  { id: 'Workout', icon: Dumbbell, label: 'Workout' },
  { id: 'Tasks', icon: ClipboardList, label: 'Daily Tasks' },
  { id: 'Projects', icon: FolderKanban, label: 'Projects' },
  { id: 'Rituals', icon: Sparkles, label: 'Rituals' },
  { id: 'Analytics', icon: BarChart3, label: 'Analytics' },
  { id: 'Settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  const { activeTab, setActiveTab, ritualTab, setRitualTab, tasks, dayPaused, setDayPaused, alwaysOnMic, wakeWord, alarmTime, alarmSource, skippedFeatures, projects } = useApp() as any
  const isSkipped = (f: string) => (skippedFeatures || []).includes(f.toLowerCase())
  const openTasks = (tasks && tasks.length ? tasks : tasksOn(todayKey())).filter((t: any) => t.status !== 'done' && (!t.date || t.date === todayKey())).length
  const tomTasks = tasksOn(tomorrowKey()).length
  const openProjects = (projects || []).filter((p: any) => (p.progress ?? 0) < 100).length

  return (
    <div className="w-[240px] shrink-0 border-r border-white/[0.06] bg-[#0c0c0e]/60 flex-col p-3 hidden md:flex">
      <div className="px-2 pt-1 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center"><Zap className="w-4 h-4 text-white" /></div>
          <div>
            <div className="text-[13px] font-semibold tracking-[0.14em] text-white">HABIT.AI</div>
            <div className="text-[10px] text-white/40 -mt-0.5">VOICE OS • v5.3</div>
          </div>
        </div>
        <div className="mt-3 rounded-[10px] bg-gradient-to-br from-violet-500/10 to-blue-500/10 border border-white/[0.06] p-2.5">
          <div className="flex items-center gap-2 text-[11px] text-white/60 truncate"><User className="w-3 h-3 shrink-0" /> {personality.getUserName() || 'You'}{alwaysOnMic ? ' • Voice+' : ''}</div>
          <div className="text-[10px] text-white/30 mt-2 truncate">{dateLabel()}</div>
          <div className="text-[10px] text-white/30 mt-1">Alarm {alarmTime} • {alarmSource} • {alwaysOnMic ? 'Mic ON' : 'Mic OFF'}</div>
          <div className="text-[10px] text-white/25 mt-1">{openTasks} today • {tomTasks} queued for tomorrow</div>
        </div>
        {(skippedFeatures || []).length > 0 && (
          <div className="mt-2 rounded-[8px] bg-amber-500/10 border border-amber-500/15 p-2">
            <div className="text-[10px] text-amber-200/70 flex items-center gap-1"><ZapOff className="w-3 h-3" /> Skipped: {skippedFeatures.join(', ')}</div>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto pr-1">
        {NAV.map((item: any) => {
          const active = activeTab === item.id
          const skipped = isSkipped(item.id)
          const count = item.id === 'Tasks' ? openTasks : item.id === 'Projects' ? openProjects : undefined
          return (
            <button key={item.id} id={'nav-' + item.id} onClick={() => setActiveTab(item.id)}
              className={active ? 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13px] bg-white/[0.08] text-white' : skipped ? 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13px] text-white/25 bg-amber-500/5' : 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13px] text-white/45 hover:text-white/80 hover:bg-white/[0.04]'}>
              <item.icon className="w-[18px] h-[18px]" /><span className="flex-1 text-left truncate">{item.label}</span>
              {item.suffix && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-white/40">{item.suffix}</span>}
              {item.badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/30">{item.badge}</span>}
              {count !== undefined && count > 0 && <span className="text-[11px] bg-white text-black font-medium px-1.5 rounded-full">{count}</span>}
            </button>
          )
        })}
        <div className="pt-3 mt-3 border-t border-white/[0.06] space-y-1">
          <div className="text-[10px] text-white/20 px-2.5 pb-1">RITUAL SUB-NAV</div>
          {[{ id: 'Prayer', icon: Heart }, { id: 'Haircare', icon: Wind }, { id: 'Skincare', icon: Smile }, { id: 'Visualization', icon: Brain }].map((r: any) => {
            const active = activeTab === 'Rituals' && ritualTab === r.id
            return <button key={r.id} onClick={() => { setActiveTab('Rituals'); setRitualTab(r.id) }}
              className={active ? 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[12px] bg-violet-500/10 text-violet-200 border border-violet-500/20' : 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[12px] text-white/35 hover:text-white/60'}>
              <r.icon className="w-4 h-4" /> {r.id}</button>
          })}
        </div>
      </nav>
      <div className="mt-auto pt-3 space-y-2">
        <button onClick={() => setDayPaused(!dayPaused)}
          className={dayPaused ? 'w-full flex items-center justify-center gap-2 py-2.5 rounded-[12px] border text-[12px] font-semibold bg-emerald-500 text-black border-emerald-400' : 'w-full flex items-center justify-center gap-2 py-2.5 rounded-[12px] border text-[12px] font-semibold bg-gradient-to-br from-amber-500/15 to-orange-500/10 text-amber-200 border-amber-500/20'}>
          {dayPaused ? <><PlayCircle className="w-4 h-4" /> RESUME DAY</> : <><PauseCircle className="w-4 h-4" /> PAUSE DAY</>}
        </button>
        <div className="text-[10px] text-white/20 px-1">Wake word • {wakeWord}</div>
      </div>
    </div>
  )
}

/** Narrow screens: the sidebar collapses into a scrollable tab strip under the voice bar. */
export function MobileTabs() {
  const { activeTab, setActiveTab } = useApp() as any
  return (
    <div className="md:hidden shrink-0 border-b border-white/[0.06] bg-[#0c0c0e] flex gap-1 overflow-x-auto px-2 py-1.5">
      {NAV.map((item: any) => {
        const active = activeTab === item.id
        const Icon = item.icon
        return (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] whitespace-nowrap ${active ? 'bg-white text-black font-medium' : 'bg-white/5 text-white/45 border border-white/[0.06]'}`}>
            <Icon className="w-3.5 h-3.5" /> {item.label}
          </button>
        )
      })}
    </div>
  )
}
