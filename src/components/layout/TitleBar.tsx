import { useEffect, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { Zap, Pause, Play, AlarmClock } from 'lucide-react'
import { clockWithSeconds, dateLabel, untilClock, onClock } from '../../lib/clock'

export default function TitleBar() {
  const { dayPaused, setDayPaused, alarmTime, bedtime, dayPhase } = useApp() as any
  const [now, setNow] = useState(() => new Date())

  useEffect(() => onClock((d) => setNow(d)), [])

  return (
    <div className="h-[44px] shrink-0 w-full bg-[#0c0c0e] border-b border-white/10 flex items-center justify-between gap-2 px-3 md:px-4">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shrink-0"><Zap className="w-4 h-4 text-white" /></div>
        <span className="text-xs font-bold tracking-[0.14em] text-white">HABIT.AI</span>
        <span className="text-xs text-white/30 ml-1 hidden sm:inline">v5.2 • VOICE OS</span>
      </div>

      {/* real clock + calendar, so every schedule in the app reads from the same time */}
      <div className="flex items-center gap-2 text-[11px] text-white/45 min-w-0">
        <span className="hidden lg:inline truncate">{dateLabel(now)}</span>
        <span className="tabular-nums text-white/70">{clockWithSeconds(now)}</span>
        {alarmTime && dayPhase !== 'active' && (
          <span className="hidden md:flex items-center gap-1 text-white/35"><AlarmClock className="w-3 h-3" />{dayPhase === 'ended' ? 'closed' : 'wake ' + alarmTime}</span>
        )}
        {bedtime && <span className="hidden xl:inline text-white/25">bed in {untilClock(bedtime, now)}</span>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => setDayPaused(!dayPaused)} className={dayPaused ? 'px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-1' : 'px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs text-white/60 flex items-center gap-1 hover:border-white/25' }>
          {dayPaused ? <><Play className="w-3 h-3" /> RESUME DAY</> : <><Pause className="w-3 h-3" /> PAUSE DAY</>}
        </button>
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      </div>
    </div>
  )
}
