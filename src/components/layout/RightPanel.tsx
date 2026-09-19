import { useEffect, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { Droplets, Bell, BellOff, Sunrise, Music, Quote, ChevronLeft, ChevronRight, Play, Square, X, CalendarClock, AlertTriangle } from 'lucide-react'
import { clockNow, dateLabel, minutesLeft, spanLabel } from '../../lib/clock'

/**
 * Right rail: where the day stands, what is coming next, the affirmation card
 * (screen only — the AI never speaks affirmations) and the OS alert state.
 */

const KIND_LABEL: Record<string, string> = {
  water: 'water', drink: 'drink', ritual: 'ritual', visualization: 'viz',
  'workout-primary': 'workout', 'workout-secondary': 'quick set', task: 'task', daily: 'daily'
}

export default function RightPanel() {
  const app = useApp() as any
  const {
    dayPaused, water, reminderLog = [], catchUp = [], dayPhase, dayStartedAt, alarmTime, bedtime,
    playlistTracks = [], playingPlaylist, userName, affirmCard, affirmations = [], nextAffirmationCard,
    prevAffirmationCard, stopAffirmation, playAffirmation, affirmPlaying = false, planItems = [], planDone = [], desktopAlerts,
    missed, clearMissed, activeTab
  } = app
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  const done = new Set((Array.isArray(planDone) ? planDone : []).map(String))
  const pending = (planItems as any[])
    .filter((i) => !done.has(i.id) && i.kind !== 'midpoint' && i.kind !== 'bedtime')
    .map((i) => ({ ...i, late: i.at < now.getTime() - 120000 }))
    .sort((a, b) => a.at - b.at)
    .slice(0, 7)
  const affirmTexts = ((Array.isArray(affirmations) ? affirmations : []).length ? affirmations : readAffirmations()).map((a: any) => (typeof a === 'string' ? a : a?.text)).filter(Boolean)
  const openAffirm = activeTab === 'Rituals' ? null : affirmCard

  const phaseLabel: Record<string, string> = {
    unstarted: 'Not started • alarm ' + (alarmTime || '—'),
    snoozed: 'Snoozed',
    ringing: 'Alarm ringing',
    briefing: 'Briefing • press Start the day',
    active: 'Live since ' + (dayStartedAt ? new Date(dayStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'),
    ended: 'Closed for the day'
  }

  return (
    <div className="w-full h-full bg-[#0c0c0e] border-l border-white/10 flex flex-col p-4 gap-3.5 overflow-y-auto">
      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-white flex items-center gap-2"><Sunrise className="w-3.5 h-3.5 text-amber-300" /> THE DAY</div>
          <div className="text-[11px] text-white/40 tabular-nums">{clockNow(now)}</div>
        </div>
        <div className="text-[11px] text-white/55 mt-1.5 truncate">{userName ? `${userName} • ` : ''}{dateLabel(now)}</div>
        <div className="text-[11px] text-white/40 mt-1">{dayPaused ? 'Paused — nothing will disturb you' : phaseLabel[dayPhase] || dayPhase}</div>
        {bedtime && dayPhase === 'active' && <div className="text-[10px] text-white/25 mt-1.5">day ends in {spanLabel(minutesLeft(bedtime, now))} • close at {bedtime}</div>}
        {catchUp.length > 0 && !dayPaused && <div className="mt-2 text-[10px] text-amber-200/70">Re-slotted after your pause: {catchUp.map((c: any) => c.name).join(', ')}</div>}
      </div>

      {missed?.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-200"><AlertTriangle className="w-3.5 h-3.5" /> WHILE YOU WERE AWAY</div>
          <div className="mt-1.5 space-y-1">
            {missed.slice(0, 4).map((m: any) => <div key={m.id} className="text-[11px] text-white/60 truncate">{m.title.replace('HABIT.AI — ', '')} • {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>)}
          </div>
          <button onClick={clearMissed} className="mt-2 text-[10px] text-white/40 hover:text-white/70">dismiss</button>
        </div>
      )}

      {/* ---------------- affirmation card: shown, never spoken ---------------- */}
      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-xs font-semibold text-white flex items-center gap-2 min-w-0"><Quote className="w-3.5 h-3.5 text-amber-300 shrink-0" /> AFFIRMATION</div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => (affirmPlaying ? stopAffirmation() : playAffirmation?.('voice'))}
              className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center text-white/45 hover:text-white"
              title={affirmPlaying ? 'Stop the affirmation clip' : 'Play an affirmation clip if one is uploaded'}
            >
              {affirmPlaying ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
            {openAffirm && <button onClick={() => stopAffirmation(true)} className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center text-white/45" title="Dismiss"><X className="w-3 h-3" /></button>}
          </div>
        </div>
        {openAffirm ? (
          <div>
            <div className="text-[14px] text-white/85 leading-snug break-words min-h-10">{openAffirm.text}</div>
            <div className="flex items-center justify-between mt-2">
              <button onClick={prevAffirmationCard} className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/45"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-[10px] text-white/25">{fmt(openAffirm.at)} • on screen only</span>
              <button onClick={nextAffirmationCard} className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/45"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        ) : affirmTexts.length ? (
          <button onClick={nextAffirmationCard} className="w-full text-left">
            <div className="text-[13px] text-white/60 leading-snug line-clamp-3">{affirmTexts[0]}</div>
            <div className="text-[10px] text-white/25 mt-2">{affirmTexts.length} saved • tap to walk through them</div>
          </button>
        ) : (
          <div className="text-[11px] text-white/25">No affirmations saved.<div className="text-white/15">Add them in Rituals • Affirmations</div></div>
        )}
      </div>

      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-white"><CalendarClock className="w-3.5 h-3.5" /> PENDING TODAY</div>
          <span className="text-[10px] text-white/30 shrink-0">{pending.length} open</span>
        </div>
        {pending.length === 0 ? <div className="text-[11px] text-emerald-300/75">{dayPhase === 'active' ? 'Nothing left on the plan. Day clear.' : 'Start the day to build the plan.'}</div> : (
          <div className="space-y-1.5">
            {pending.map((i: any) => (
              <button key={i.id} onClick={() => app.setActiveTab?.(i.goTo || 'Today')} className="w-full flex items-center gap-2 text-[11px] min-w-0 text-left rounded-lg hover:bg-white/5 px-1 py-0.5">
                <span className={`tabular-nums w-12 shrink-0 ${i.late ? 'text-amber-300' : 'text-white/40'}`}>{i.time}</span>
                <span className="text-white/70 truncate flex-1">{i.title}</span>
                {i.late ? <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-200 shrink-0">over</span> : <span className="text-white/20 shrink-0">{KIND_LABEL[i.kind] || ''}</span>}
              </button>
            ))}
            {app.voicePendingRecap !== false && <div className="text-[10px] text-white/20 pt-1">spoken recap every {app.recapEveryMin || 30} min • toggle in Settings</div>}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2"><Droplets className="w-3.5 h-3.5 text-blue-400" /> WATER • {water || 0}ml</div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-blue-500 transition-all duration-300" style={{ width: Math.min(100, ((water || 0) / Math.max(1, app.waterGoal || 3000)) * 100) + '%' }} /></div>
        <div className="text-[11px] text-white/30 mt-1.5">goal {app.waterGoal || 3000}ml • sips are scheduled through the waking day</div>
      </div>

      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2"><Music className="w-3.5 h-3.5 text-emerald-300" /> MORNING PLAYLIST</div>
        <div className="text-[11px] text-white/45">{playingPlaylist ? 'Playing • pauses for reminders automatically' : `${(playlistTracks || []).length} track(s) • starts with the day`}</div>
      </div>

      <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2">{desktopAlerts ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />} ALERTS</div>
        <div className="text-[11px] text-white/45">{desktopAlerts ? 'System notifications enabled — they arrive even when the window is hidden.' : 'In-app only right now. Enable in Settings • Reminders.'}</div>
        {dayPaused && <div className="text-[10px] text-amber-200/70 mt-1.5">paused: nothing will fire</div>}
      </div>

      {reminderLog.length > 0 && (
        <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2"><Bell className="w-3 h-3" /> FIRED TODAY</div>
          <div className="space-y-1">
            {reminderLog.slice(0, 6).map((r: any, i: number) => <div key={String(r) + '-' + i} title={String(r)} className="text-[11px] text-white/40 leading-snug break-words">{String(r)}</div>)}
          </div>
        </div>
      )}

      {activeTab === 'Today' && (
        <div className="rounded-xl bg-[#141418] border border-white/10 p-4">
          <div className="text-[10px] text-white/25">Steaks live on the Today page only — no reminders come from them.</div>
        </div>
      )}
    </div>
  )
}

const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')
function readAffirmations(): any[] {
  try { const raw = JSON.parse(localStorage.getItem('habitOS_affirmations') || '[]'); return Array.isArray(raw) ? raw.filter((a: any) => a) : [] } catch { return [] }
}
