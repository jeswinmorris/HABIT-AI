import { useEffect, useMemo, useState } from 'react'
import { useMediaUrl } from '../../lib/useMedia'
import { Dumbbell, Play, Shuffle, Volume2, VolumeX, X, Check, Timer, Zap } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { dayController } from '../../core/dayController'
import { speakingModel } from '../../speaking/speakingModel'

type W = { id: string; name: string; reps: string; category: string; group: string; mediaUrl?: string; mediaType?: 'image' | 'video'; slot?: 'primary' | 'secondary' }

function readSegments(): W[] {
  try {
    const segs = JSON.parse(localStorage.getItem('habitOS_workoutSegments') || '[]')
    return segs.flatMap((s: any) => s.workouts || []).filter((w: any) => w && w.name)
  } catch {
    return []
  }
}

/** Workout popup: either a random set, or the specific secondary set the engine nudged you with. */
export default function WorkoutPopup({ onClose, task }: any) {
  const { globalMuted, setGlobalMuted, setDailyLogs } = useApp() as any
  const pool = useMemo(() => {
    const segs = readSegments()
    return segs.length ? segs : [
      { id: 'demo1', name: '20 pushups', reps: 'chest • 3 sets', category: 'chest', group: 'chest' },
      { id: 'demo2', name: '30 sec plank', reps: 'core • hold', category: 'core', group: 'core' }
    ] as W[]
  }, [])

  const [pick, setPick] = useState<W | null>(task || null)
  useEffect(() => { if (!pick && pool.length) setPick(pool[Math.floor(Math.random() * pool.length)]) }, [pool, pick])
  useEffect(() => { if (task) setPick(task) }, [task])
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    setSeconds(0)
    const iv = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick?.id])

  useEffect(() => {
    const onMedia = (e: Event) => {
      const d = (e as CustomEvent).detail
      const v = document.getElementById('workout-popup-video') as HTMLVideoElement | null
      if (!v) return
      if (d === 'pause') v.pause()
      if (d === 'play') v.play().catch(() => undefined)
      if (d === 'next') speakingModel.speak('Next exercise')
    }
    window.addEventListener('habit:media', onMedia)
    return () => window.removeEventListener('habit:media', onMedia)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick])

  const doneSet = (w: W) => w.mediaType === 'video' && (w as any).mediaUrl
  const mediaSrc = useMediaUrl(pick && doneSet(pick) ? (pick as any).mediaUrl : '')
  const videoUrl = pick ? (doneSet(pick) ? mediaSrc : '') : ''

  const checkout = () => {
    if (!pick) return
    const today = dayController.todayKey()
    setDailyLogs((prev: any) => {
      const without = prev.filter((l: any) => !(l.streakId === 'workout' && l.date === today))
      return [...without, { id: 'workout-' + today, streakId: 'workout', date: today, amount: 100 }]
    })
    try {
      const segs = JSON.parse(localStorage.getItem('habitOS_workoutSegments') || '[]')
      const next = segs.map((s: any) => ({ ...s, workouts: (s.workouts || []).map((w: any) => (w.id === pick.id ? { ...w, completed: true } : w)) }))
      localStorage.setItem('habitOS_workoutSegments', JSON.stringify(next))
    } catch {}
    speakingModel.speakRandom('checked')
    onClose?.()
  }

  if (!pick) return null
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#141418] border border-white/10 rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-white/5">
          <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/25 flex items-center justify-center"><Dumbbell className="w-4 h-4 text-orange-300" /></div>
          <div className="flex-1">
            <div className="text-[11px] tracking-wider text-white/45">{pick.slot === 'secondary' ? 'Secondary set • random nudge' : pick.slot === 'primary' ? 'Primary workout • full stretch' : 'Random trigger'} • {(pick.group || pick.category || '').toUpperCase()}</div>
            <div className="text-sm font-semibold text-white">{pick.name} <span className="text-white/30 font-normal">• {pick.reps}</span></div>
          </div>
          <button onClick={() => setGlobalMuted(!globalMuted)} className={`px-2.5 py-1.5 rounded-full border text-[11px] flex items-center gap-1 ${globalMuted ? 'bg-red-500/10 border-red-500/25 text-red-300' : 'bg-white/10 border-white/10 text-white/60'}`}>
            {globalMuted ? <><VolumeX className="w-3 h-3" /> Muted • tap to unmute</> : <><Volume2 className="w-3 h-3" /> Audio ON • mute all</>}
          </button>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-[#0e0e12] border border-white/10 flex items-center justify-center"><X className="w-4 h-4 text-white/40" /></button>
        </div>

        {videoUrl ? (
          <div className="aspect-video bg-black">
            <video
              id="workout-popup-video"
              key={pick.id + String(globalMuted) + videoUrl}
              src={videoUrl}
              autoPlay
              loop
              playsInline
              muted={!!globalMuted}
              controls
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="aspect-video bg-gradient-to-br from-[#0e0e12] to-[#141418] flex items-center justify-center">
            <div className="text-center">
              <Timer className="w-6 h-6 text-orange-300/60 mx-auto mb-2" />
              <div className="text-[11px] text-white/30">No clip on this exercise<br />upload one on the Workout page to auto-play form guide</div>
            </div>
          </div>
        )}

        <div className="p-4 flex items-center gap-2">
          <div className="text-xs font-mono text-white/55 flex items-center gap-1.5 shrink-0"><Play className="w-3 h-3" /> {mm}:{ss}<span className="text-white/25 hidden sm:inline"> • set timer</span></div>
          <div className="flex-1" />
          <button onClick={(e) => { e.stopPropagation(); setPick(pool[Math.floor(Math.random() * pool.length)]); }} className="px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white/60 flex items-center gap-1"><Shuffle className="w-3 h-3" /> another</button>
          <button onClick={checkout} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Done • checkout workout steak</button>
          <button onClick={onClose} className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-200 text-xs"><Zap className="w-3 h-3 inline" /> later</button>
        </div>
      </div>
    </div>
  )
}
