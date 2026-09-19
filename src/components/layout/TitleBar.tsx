import { useEffect, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { Zap, Pause, Play, Volume2, VolumeX, Mic, MicOff } from 'lucide-react'
import { clockWithSeconds, dateLabel, onClock, systemClock, spanLabel, minutesLeft } from '../../lib/clock'

export default function TitleBar() {
  const { dayPaused, setDayPaused, globalMuted, setGlobalMuted, voiceAsleep, wakeVoice, sleepVoice, bedtime, dayPhase, isSpeaking, desktopAlerts } = useApp() as any
  const [now, setNow] = useState(() => new Date())

  useEffect(() => onClock((d) => setNow(d)), [])
  const sys = systemClock(now)

  const pill = (on: boolean) => `w-8 h-7 rounded-lg flex items-center justify-center shrink-0 border transition ${on ? 'bg-white/10 border-white/10 text-white/70 hover:text-white' : 'bg-transparent border-white/5 text-white/30 hover:text-white/60'}`

  return (
    <div className="h-[44px] shrink-0 w-full bg-[#0c0c0e] border-b border-white/10 flex items-center justify-between gap-2 px-2 md:px-4">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shrink-0"><Zap className="w-4 h-4 text-white" /></div>
        <span className="text-xs font-bold tracking-[0.14em] text-white">HABIT.AI</span>
        <span className="text-xs text-white/30 ml-1 hidden lg:inline">v5.3 • {sys.timeZone}</span>
      </div>

      {/* the computer's own date + time, live — every schedule in the app reads this */}
      <div className="flex items-center gap-2 text-[11px] min-w-0 overflow-hidden">
        <span className="text-white/70 tabular-nums whitespace-nowrap">{clockWithSeconds(now)}</span>
        <span className="text-white/35 hidden sm:inline truncate whitespace-nowrap">{dateLabel(now)}</span>
        {dayPhase === 'active' && bedtime && <span className="text-white/25 hidden md:inline whitespace-nowrap">day ends in {spanLabel(minutesLeft(bedtime, now))}</span>}
        {isDesktopOn() && <span className="text-white/25 hidden xl:inline whitespace-nowrap">{desktopAlerts ? 'OS alerts on' : 'OS alerts off'}</span>}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={() => setGlobalMuted(!globalMuted)} title={globalMuted ? 'Sound off — click to unmute the AI' : 'AI will speak reminders out loud'} className={pill(!globalMuted)}>
          {globalMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <button onClick={() => (voiceAsleep ? wakeVoice() : sleepVoice())} title={voiceAsleep ? 'Wake the mic up' : 'Stop listening (speech keeps working)'} className={pill(!voiceAsleep)}>
          {voiceAsleep ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button onClick={() => setDayPaused(!dayPaused)} className={dayPaused ? 'px-2.5 md:px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-1' : 'px-2.5 md:px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs text-white/60 flex items-center gap-1 hover:border-white/25'}>
          {dayPaused ? <><Play className="w-3 h-3" /> <span className="hidden sm:inline">RESUME DAY</span></> : <><Pause className="w-3 h-3" /> <span className="hidden sm:inline">PAUSE DAY</span></>}
        </button>
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      </div>
    </div>
  )
}

function isDesktopOn() { try { return !!(window as any).habitAI } catch { return false } }
