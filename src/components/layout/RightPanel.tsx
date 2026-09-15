import { useApp } from '../../store/AppContext'
import { Pause, Droplets, Flame, Bell, BellOff, Sunrise, Music, CalendarDays } from 'lucide-react'
import { dayController } from '../../core/dayController'
import { clockNow, dateLabel, untilClock } from '../../lib/clock'
import { tasksOn } from '../../core/dayFlow'

/** Right rail: where the day stands, what is open, and what fired. No nagging from here. */
export default function RightPanel() {
  const { skips, dayPaused, water, steaks = [], reminderLog = [], catchUp = [], dayPhase, dayStartedAt, alarmTime, bedtime, playlistTracks = [], playingPlaylist, userName } = useApp() as any
  const activeSkips = (skips || []).filter((s: any) => new Date() <= new Date(s.endDate))
  const pending = dayController.pendingSteaks()
  const todays = tasksOn()
  const openTasks = todays.filter((t: any) => t.status !== 'done')

  const phaseLabel: Record<string, string> = {
    unstarted: 'Asleep · alarm ' + (alarmTime || '—'),
    snoozed: 'Snoozed',
    ringing: 'Alarm ringing',
    briefing: 'Briefing · press Start the day',
    active: 'Live since ' + (dayStartedAt ? new Date(dayStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'),
    ended: 'Closed'
  }

  return (
    <div className="w-full h-full bg-[#0c0c0e] border-l border-white/10 flex flex-col p-4 gap-4 overflow-y-auto">
      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-white flex items-center gap-2"><Sunrise className="w-3.5 h-3.5 text-amber-300" /> THE DAY</div>
          <div className="text-[11px] text-white/40 tabular-nums">{clockNow()}</div>
        </div>
        <div className="text-[11px] text-white/55 mt-2">{userName ? `${userName} • ` : ''}{dateLabel()}</div>
        <div className="text-[11px] text-white/40 mt-1">{dayPaused ? 'Paused' : phaseLabel[dayPhase] || dayPhase}</div>
        <div className="text-[10px] text-white/25 mt-2">bed {bedtime || '22:00'} • in {untilClock(bedtime || '22:00')}</div>
      </div>

      {dayPaused && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-200"><Pause className="w-3 h-3" /> DAY PAUSED</div>
          <div className="text-xs text-white/40 mt-1">No notifications. Resume to get the catch-up plan.</div>
        </div>
      )}

      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2">
          <Flame className="w-3.5 h-3.5 text-orange-400" /> STEAKS ({pending.length} open)
        </div>
        <div className="text-[10px] text-white/25 mb-2 flex items-center gap-1"><BellOff className="w-3 h-3" /> no reminders from steaks — tick them off yourself</div>
        {pending.length === 0 ? (
          <div className="text-xs text-emerald-300/80">All steaks checked in. Nothing pending.</div>
        ) : (
          <div className="space-y-1.5">
            {pending.map((p: any) => {
              const st = steaks.find((x: any) => x.id === p.id)
              const pct = st ? Math.round(((st.completed || []).length / (st.total || 1)) * 100) : 0
              return (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <div className="w-5 h-5 rounded-md bg-orange-500/10 border border-orange-500/20 shrink-0" />
                  <span className="text-white/70 flex-1 truncate">{p.name}</span>
                  <span className="text-white/35">{pct}%</span>
                </div>
              )
            })}
          </div>
        )}
        {catchUp.length > 0 && !dayPaused && (
          <div className="mt-2 text-[10px] text-amber-200/70">Catch-up after your pause: {catchUp.map((c: any) => c.name).join(', ')}</div>
        )}
      </div>

      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="text-xs font-semibold text-white mb-2 flex items-center gap-2"><CalendarDays className="w-3 h-3" /> TO DO TODAY ({openTasks.length})</div>
        {openTasks.length === 0 ? <div className="text-xs text-white/30">Nothing open.</div> : (
          <div className="space-y-1">
            {openTasks.slice(0, 6).map((t: any) => (
              <div key={t.id} className="text-[11px] text-white/55 truncate flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === 'high' ? 'bg-amber-400' : 'bg-white/20'}`} />
                <span className="truncate">{t.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="text-xs font-semibold text-white mb-2 flex items-center gap-2"><Music className="w-3 h-3 text-emerald-300" /> MORNING PLAYLIST</div>
        <div className="text-[11px] text-white/45">{playingPlaylist ? 'Playing now' : `${(playlistTracks || []).length} track(s) • plays after the briefing`}</div>
      </div>

      {reminderLog.length > 0 && (
        <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2"><Bell className="w-3 h-3" /> Fired today</div>
          <div className="space-y-1">
            {reminderLog.slice(0, 5).map((r: any, i: number) => <div key={String(r) + '-' + i} className="text-[11px] text-white/35 truncate">{String(r)}</div>)}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="text-xs font-semibold text-white mb-2 flex items-center gap-2"><Droplets className="w-3 h-3 text-blue-400" /> Water • {water || 0}ml today</div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-blue-500" style={{ width: Math.min(100, ((water || 0) / 3000) * 100) + '%' }} /></div>
      </div>

      {activeSkips.length > 0 && (
        <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
          <div className="text-xs font-semibold text-white mb-2">Active Skips ({activeSkips.length})</div>
          <div className="space-y-2">
            {activeSkips.map((s: any) => (
              <div key={s.id} className="p-2 rounded-lg bg-[#0e0e12] border border-white/5">
                <div className="text-xs text-white truncate">{s.streakId} • {s.days}d</div>
                <div className="text-xs text-white/40">till {String(s.endDate).slice(0, 10)} • {s.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
