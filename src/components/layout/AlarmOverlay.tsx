import { useEffect, useState } from 'react'
import { AlarmClock, BedDouble, Check, Play, Sunrise, X } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { clockWithSeconds, dateLabel, untilClock, dayKey as dayKeyText } from '../../lib/clock'
import type { Briefing } from '../../core/dayFlow'

/**
 * The whole wake-up surface: alarm ringing -> snooze / close -> day briefing -> start the day.
 * Nothing else in the app can nag until this is answered, and the briefing sits between the
 * alarm and the morning music exactly as asked.
 */
export default function AlarmOverlay() {
  const app = useApp() as any
  const { ringAlarm, dayPhase, briefing, alarmTime, answerAlarm, startTheDay, playlistTracks, playingPlaylist, aiName } = app
  const [now, setNow] = useState(() => new Date())
  const [minutes, setMinutes] = useState(10)

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  const ringing = !!ringAlarm || dayPhase === 'ringing'
  const showingBriefing = !ringing && dayPhase === 'briefing'
  if (!ringing && !showingBriefing) return null

  const b: Briefing | null = briefing
  const src = b?.date || dayKeyText(now)
  const shortDate = (() => {
    try { return new Date(src + 'T12:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) } catch { return src }
  })()

  return (
    <div className="fixed inset-0 z-[130] bg-[#07070a]/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 overflow-y-auto">
      {ringing ? (
        <div className="w-full max-w-lg rounded-2xl bg-[#141418] border border-white/10 p-6 md:p-8 text-center space-y-5">
          <div className="flex items-center justify-center gap-2 text-amber-300">
            <AlarmClock className="w-5 h-5 animate-pulse" />
            <span className="text-xs tracking-[0.2em]">{(ringAlarm?.label || 'ALARM').toUpperCase()}</span>
          </div>
          <div>
            <div className="text-5xl md:text-6xl font-semibold text-white tabular-nums">{clockWithSeconds(now)}</div>
            <div className="text-sm text-white/45 mt-2">{dateLabel(now)}</div>
            <div className="text-xs text-white/30 mt-1">Alarm set for {ringAlarm?.time || alarmTime}</div>
          </div>
          <div className="text-[13px] text-emerald-300/80">{aiName ? `${aiName}: ` : ''}Say “stop alarm” or “snooze {minutes} minutes” — or use the buttons.</div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {[5, 10, 20].map((m) => (
              <button key={m} onClick={() => setMinutes(m)} className={`px-3 py-1 rounded-full text-xs border ${minutes === m ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/50'}`}>{m} min</button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => answerAlarm('snooze', minutes)}
              className="px-4 py-3 rounded-xl bg-[#0e0e12] border border-white/10 text-white/70 text-sm font-semibold flex items-center justify-center gap-2 hover:border-white/25"
            >
              <BedDouble className="w-4 h-4" /> Snooze {minutes}m
            </button>
            <button
              onClick={() => answerAlarm('close')}
              className="px-4 py-3 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" /> Close alarm
            </button>
          </div>
          <div className="text-[12px] text-white/40">Closing the alarm brings up today’s briefing, then your morning playlist starts.</div>
        </div>
      ) : (
        <div className="w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl bg-[#141418] border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 md:px-7 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Sunrise className="w-4 h-4 text-amber-300" />
              <div className="text-sm font-semibold text-white truncate">Good morning {app.userName ? app.userName + ' — ' : ''}{shortDate}</div>
            </div>
            <div className="text-[11px] text-white/30 tabular-nums hidden sm:block">{clockWithSeconds(now)} • bed in {untilClock(app.bedtime)}</div>
          </div>

          <div className="px-5 md:px-7 py-5 grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0 overflow-y-auto">
            {(b?.sections || []).map((sec: any) => (
              <div key={sec.key} className="rounded-xl bg-[#0e0e12] border border-white/5 p-4">
                <div className="text-[11px] tracking-widest text-white/40 mb-2">{sec.label.toUpperCase()}</div>
                {sec.lines.length ? (
                  <ul className="space-y-1.5">
                    {sec.lines.map((l: string, i: number) => (
                      <li key={i} className="text-[13px] text-white/75 leading-snug">• {l}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12px] text-white/30">{sec.empty}</div>
                )}
              </div>
            ))}
          </div>

          <div className="px-5 md:px-7 py-4 border-t border-white/5 flex flex-wrap items-center gap-3 shrink-0 bg-[#141418]">
            <button onClick={() => startTheDay('prayer-first')} className="px-5 py-2.5 rounded-xl bg-white text-black text-sm font-semibold flex items-center gap-2">
              <Play className="w-4 h-4" /> Start the day
            </button>
            <button onClick={() => startTheDay('quick')} className="px-4 py-2.5 rounded-xl bg-[#0e0e12] border border-white/10 text-white/60 text-xs flex items-center gap-1">
              <Check className="w-3 h-3" /> Quick start (skip straight to active)
            </button>
            <div className="ml-auto text-[11px] text-white/30">
              {playingPlaylist ? `Morning playlist playing • ${(playlistTracks || []).length} tracks` : (playlistTracks || []).length ? `${(playlistTracks || []).length} tracks ready — add them in Settings` : 'No morning playlist yet — add one in Settings'}
            </div>
          </div>
          <div className="px-5 md:px-7 pb-4 text-[11px] text-white/25 flex items-center gap-1 shrink-0">
            <X className="w-3 h-3" /> This screen is where steaks, tasks and reminders arm — nothing runs before you press start.
          </div>
        </div>
      )}
    </div>
  )
}
