import { useEffect, useState, useRef } from 'react'
import { Sparkles, Heart, Brain, Play, Pause, Sunrise, Plus, Trash2, Image as ImageIcon, Music, Check, X, Activity, ChevronLeft, ChevronRight, Quote, SkipForward, Edit3, Volume2, VolumeX, Maximize2, Minimize2 } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { personality } from '../../speaking/personality'
import { useMediaUrl } from '../../lib/useMedia'
import { putMedia, removeMedia, mediaId, resolveMedia } from '../../lib/mediaStore'
import { todayKey, weekdayOf } from '../../lib/clock'
import { readArray, readRecord } from '../../lib/store'
import { ritualDoneToday } from '../../core/dayFlow'
import { claimLane, releaseLane } from '../../core/audioBus'

type RitualTask = {
  id: string, title: string, instructions: string, imageUrl?: string, videoUrl?: string,
  mediaType?: 'image' | 'video', done: boolean, date: string,
  /** weekdays this routine is reminded on — empty means not scheduled at all */
  days?: string[], time?: string
}
type PrayerSlide = { id: string, title: string, texts: string[], imageUrl?: string }
type VizSlide = { id: string, title: string, text: string, imageUrl?: string, videoUrl?: string, mediaType?: 'image' | 'video' }
type AffItem = { id: string, text: string }
type AudioRef = { id: string, name: string, url: string }

/** Uploads are stored in IndexedDB as media:<id> so they still exist after a restart. */
async function storeFile(file: File, prefix = 'med'): Promise<string> {
  const id = mediaId(prefix)
  await putMedia(file, id)
  return `media:${id}`
}

/** resolve several media refs at once (fixed hook count per render) */
function useMediaList(refs: (string | undefined)[]): string[] {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    Promise.all(refs.map((r) => resolveMedia(r))).then((u) => { if (alive) setUrls(u) })
    return () => { alive = false }
  }, [refs.join('|')])
  return urls
}

function SmartImg({ src, className = '' }: { src?: string; className?: string }) {
  const url = useMediaUrl(src)
  if (!url) return null
  return <img src={url} alt="" className={className} />
}
function SmartVideo({ src, className = '', controls, autoPlay, loop, muted, playsInline, ref }: any) {
  const url = useMediaUrl(src)
  if (!url) return null
  return <video key={url} src={url} className={className} controls={controls} autoPlay={autoPlay} loop={loop} muted={muted} playsInline={playsInline} ref={ref} />
}

const DAY_LIST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** a routine is due today when no day filter is set or today is ticked */
const dueToday = (t: any, wd: string) => Array.isArray(t.days) && t.days.length ? t.days.includes(wd) : (t.days === undefined && !t.time)

/** Weekday toggles for a routine: everything starts unchecked, click to pick,
 * "every day" is a shortcut. Selection state is local to the caller. */
/**
 * Weekday toggles for a routine. Everything starts UNTICKED; click to pick, click again to
 * drop. Selected days are violet-filled with a tick so they cannot be mistaken for unticked,
 * and the line under the row always says what will actually happen.
 */
function DayPicker({ value, onChange }: { value: string[]; onChange: (days: string[]) => void }) {
  const toggle = (d: string) => onChange(value.includes(d) ? value.filter((x) => x !== d) : DAY_LIST.filter((x) => value.includes(x) || x === d))
  const summary = value.length === 7 ? 'every day' : value.length ? value.join(', ') : 'no days yet'
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[11px] text-white/45 mr-1 shrink-0">Remind on</span>
        {DAY_LIST.map((d) => {
          const on = value.includes(d)
          return (
            <button
              type="button"
              key={d}
              aria-pressed={on}
              title={on ? `${d} — ticked, click to untick` : `Tick ${d} for this routine`}
              onClick={() => toggle(d)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d) } }}
              className={`px-2.5 py-1 rounded-full text-[11px] border flex items-center gap-1 transition-all focus:outline-none focus:ring-1 focus:ring-violet-400/50 ${
                on
                  ? 'bg-violet-500 text-white border-violet-400 font-semibold shadow-[0_0_10px_rgba(139,92,246,0.35)]'
                  : 'bg-transparent border-dashed border-white/20 text-white/40 hover:border-white/40 hover:text-white/70'
              }`}
            >
              {on ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-white/25 shrink-0" />}
              {d}
            </button>
          )
        })}
        <button type="button" onClick={() => onChange([...DAY_LIST])} className={`px-2 py-1 rounded-full text-[10px] border ${value.length === 7 ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-100' : 'bg-transparent border-white/15 text-emerald-200/70 hover:text-emerald-100'}`}>every day</button>
        <button type="button" onClick={() => onChange([])} className="px-2 py-1 rounded-full text-[10px] border border-white/15 text-white/35 hover:text-white/60">clear</button>
      </div>
      <div className={`text-[11px] ${value.length ? 'text-white/35' : 'text-amber-200/85'}`}>
        {value.length ? `Will remind on: ${summary}` : 'Nothing is reminded until you tick at least one day.'}
      </div>
    </div>
  )
}


function migratePrayerSlide(s: any): PrayerSlide {
  return { id: s.id || Date.now().toString(), title: s.title || 'Prayer', texts: Array.isArray(s.texts) ? s.texts : s.text ? [s.text] : ['I am guided'], imageUrl: s.imageUrl || '' }
}

function DottedGraph({ data, color, label }: { data: number[], color: string, label: string }) {
  const w = 320, h = 70, pad = 20
  const max = Math.max(...data, 100)
  const pts = data.map((v, i) => ({ x: pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2), y: h - pad - (v / max) * (h - pad * 2) }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3 min-w-0">
      <div className="text-xs text-white/30 mb-1 flex items-center gap-1"><Activity className="w-3 h-3" style={{ color }} /> <span className="truncate">{label}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20"><path d={path} fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 4" />{pts.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="4" fill={color} stroke="#0e0e12" strokeWidth="2" /></g>)}</svg>
    </div>
  )
}

export default function RitualsView() {
  const app = useApp() as any
  const { ritualTab, setRitualTab, alarmTime, setShowSkipConfirm, setSkipTarget, skips, globalMuted, setGlobalMuted, ritualFullscreen, setRitualFullscreen, setVizPlaying } = app
  const dailyLogs = app.dailyLogs || []
  const prayerDone = ritualDoneToday('prayer', dailyLogs)
  const affirmDone = ritualDoneToday('affirmations', dailyLogs)
  const tickRitual = (key: string, done: boolean) => app.markRitualDone?.(key, done)
  const isVizMuted = !!globalMuted
  const setIsVizMuted = (v: any) => setGlobalMuted(typeof v === 'function' ? !globalMuted : !!v)
  const isSkipped = (id: string) => (skips || []).some((k: any) => k.streakId === id.toLowerCase() && new Date() <= new Date(k.endDate))
  const today = todayKey()

  const [tasks, setTasks] = useState<Record<string, RitualTask[]>>(() => readRecord<RitualTask[]>('habitOS_ritualTasks'))
  const [prayerSlides, setPrayerSlides] = useState<PrayerSlide[]>(() => {
    return readArray<any>('habitOS_prayerSlides').map(migratePrayerSlide)
  })
  const [prayerAudios, setPrayerAudios] = useState<AudioRef[]>(() => {
    try { return JSON.parse(localStorage.getItem('habitOS_prayerAudios') || '[]') } catch { return [] }
  })
  const [prayerAudioIdx, setPrayerAudioIdx] = useState(0)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [newPrayerTitle, setNewPrayerTitle] = useState('')
  const [newPrayerTexts, setNewPrayerTexts] = useState<string[]>([''])
  const [newPrayerImage, setNewPrayerImage] = useState('')
  const [editSlideId, setEditSlideId] = useState<string | null>(null)
  const [editSlideTitle, setEditSlideTitle] = useState('')
  const [editSlideTexts, setEditSlideTexts] = useState<string[]>([''])

  const [vizSlides, setVizSlides] = useState<VizSlide[]>(() => {
    return readArray<VizSlide>('habitOS_vizSlides')
  })
  const [vizCurrent, setVizCurrent] = useState(0)
  const [newVizTitle, setNewVizTitle] = useState('')
  const [newVizText, setNewVizText] = useState('')
  const [newVizMedia, setNewVizMedia] = useState<{ url: string, type: 'image' | 'video' } | null>(null)
  const [editVizId, setEditVizId] = useState<string | null>(null)
  const [editVizTitle, setEditVizTitle] = useState('')
  const [editVizText, setEditVizText] = useState('')

  const [affirmations, setAffirmations] = useState<AffItem[]>(() => readArray<AffItem>('habitOS_affirmations'))
  const [affAudios, setAffAudios] = useState<AudioRef[]>(() => readArray<AudioRef>('habitOS_affAudios'))
  const [affAudioIdx, setAffAudioIdx] = useState(0)
  const [isAffPlaying, setIsAffPlaying] = useState(false)
  const [newAff, setNewAff] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const affAudioRef = useRef<HTMLAudioElement>(null)
  const prayerAudioRef = useRef<HTMLAudioElement>(null)
  const vizVideoRef = useRef<HTMLVideoElement>(null)

  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskInstr, setNewTaskInstr] = useState('')
  const [newTaskMedia, setNewTaskMedia] = useState<{ url: string, type: 'image' | 'video' } | null>(null)
  const [editTaskId, setEditTaskId] = useState<string | null>(null)
  const [editTaskTitle, setEditTaskTitle] = useState('')
  const [editTaskInstr, setEditTaskInstr] = useState('')
  const [expandedTask, setExpandedTask] = useState<RitualTask | null>(null)
  const [affirmFullscreen, setAffirmFullscreen] = useState(false)
  const [affirmIndex, setAffirmIndex] = useState(0)
  const [analytics] = useState<Record<string, number[]>>({ Haircare: [20, 40, 60], Skincare: [50, 30, 70], Prayer: [40, 60, 80], Visualization: [30, 50, 40], Affirmations: [60, 70, 80] })

  // keep the engine honest: while a visualization video is up, no affirmation playback
  useEffect(() => {
    const v = vizVideoRef.current
    if (!v) { setVizPlaying?.(false); return }
    const onPlay = () => { claimLane('video'); setVizPlaying?.(true) }
    const onPause = () => { setVizPlaying?.(false); releaseLane('video') }
    v.addEventListener('play', onPlay); v.addEventListener('pause', onPause); v.addEventListener('ended', onPause)
    return () => { v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); v.removeEventListener('ended', onPause); setVizPlaying?.(false) }
  }, [vizCurrent, ritualTab, setVizPlaying])

  useEffect(() => {
    localStorage.setItem('habitOS_ritualTasks', JSON.stringify(tasks))
    // the day plan reads haircare/skincare weekday rows, so it has to be rebuilt
    window.dispatchEvent(new CustomEvent('habit:plan-dirty'))
  }, [tasks])
  useEffect(() => { localStorage.setItem('habitOS_prayerSlides', JSON.stringify(prayerSlides)) }, [prayerSlides])
  useEffect(() => { localStorage.setItem('habitOS_prayerAudios', JSON.stringify(prayerAudios)) }, [prayerAudios])
  useEffect(() => {
    localStorage.setItem('habitOS_vizSlides', JSON.stringify(vizSlides))
    window.dispatchEvent(new CustomEvent('habit:plan-dirty'))
  }, [vizSlides])
  useEffect(() => { localStorage.setItem('habitOS_affirmations', JSON.stringify(affirmations)) }, [affirmations])
  useEffect(() => { localStorage.setItem('habitOS_affAudios', JSON.stringify(affAudios)) }, [affAudios])

  useEffect(() => {
    if (isAffPlaying && scrollRef.current) {
      const id = setInterval(() => { if (scrollRef.current) scrollRef.current.scrollTop += 1 }, 80)
      return () => clearInterval(id)
    }
  }, [isAffPlaying])

  const affAudioUrls = useMediaList(affAudios.map((a: any) => a.url))
  const prayerCurrent = prayerSlides[currentSlide]
  const vizCurrentSlide = vizSlides[vizCurrent]

  const nextPrayer = () => setCurrentSlide(s => (s + 1) % Math.max(1, prayerSlides.length))
  const prevPrayer = () => setCurrentSlide(s => (s - 1 + Math.max(1, prayerSlides.length)) % Math.max(1, prayerSlides.length))
  const nextViz = () => setVizCurrent(s => (s + 1) % Math.max(1, vizSlides.length))
  const prevViz = () => setVizCurrent(s => (s - 1 + Math.max(1, vizSlides.length)) % Math.max(1, vizSlides.length))
  const toggleAffAudio = (play?: boolean) => {
    const el = affAudioRef.current
    if (!el) { setIsAffPlaying((v: boolean) => (play === undefined ? !v : play)); return }
    const want = play === undefined ? el.paused : play
    if (want) {
      if (!claimLane('affirmation')) return
      el.currentTime = 0
      el.play().catch(() => releaseLane('affirmation'))
      setIsAffPlaying(true)
    } else {
      el.pause()
      setIsAffPlaying(false)
      releaseLane('affirmation')
    }
  }
  const nextAffAudio = () => {
    const n = (affAudioIdx + 1) % Math.max(1, affAudios.length)
    setAffAudioIdx(n)
    setTimeout(() => { if (isAffPlaying) affAudioRef.current?.play().catch(() => {}) }, 140)
  }
  const nextPrayerAudio = () => { const n = (prayerAudioIdx + 1) % Math.max(1, prayerAudios.length); setPrayerAudioIdx(n); setTimeout(() => prayerAudioRef.current?.play(), 120) }

  // voice: play/pause/next/mute reach the players
  useEffect(() => {
    const onMedia = (e: Event) => {
      const d = (e as CustomEvent).detail
      const viz = vizVideoRef.current, pr = prayerAudioRef.current
      if (d === 'play' && viz) viz.play().catch(() => {})
      if (d === 'pause' && viz) viz.pause()
      if (d === 'playPrayer' && pr) pr.play().catch(() => {})
      if (d === 'next') { if (ritualTab === 'Visualization') nextViz(); else if (ritualTab === 'Prayer') nextPrayer() }
    }
    const onAff = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d === 'play') toggleAffAudio()
      if (d === 'next' && scrollRef.current) scrollRef.current.scrollTop += 120
    }
    window.addEventListener('habit:media', onMedia)
    window.addEventListener('habit:affirmation', onAff)
    return () => { window.removeEventListener('habit:media', onMedia); window.removeEventListener('habit:affirmation', onAff) }
  }, [ritualTab, vizSlides.length, prayerSlides.length])

  const addPrayerSlide = () => {
    if (!newPrayerTitle.trim()) return
    const cleanTexts = newPrayerTexts.map(t => t.trim()).filter(Boolean)
    if (!cleanTexts.length) return
    setPrayerSlides(prev => [...prev, { id: Date.now().toString(), title: newPrayerTitle.trim(), texts: cleanTexts, imageUrl: newPrayerImage }])
    setNewPrayerTitle('')
    setNewPrayerTexts([''])
    setNewPrayerImage('')
  }

  const fullScreen = ritualFullscreen && (ritualTab === 'Prayer' || ritualTab === 'Visualization')
  if (fullScreen) {
    return (
      <RitualStage
        tab={ritualTab}
        prayer={prayerCurrent}
        prayerIndex={currentSlide}
        prayerTotal={prayerSlides.length}
        viz={vizCurrentSlide}
        vizIndex={vizCurrent}
        vizTotal={vizSlides.length}
        muted={isVizMuted}
        onMute={() => setIsVizMuted(!isVizMuted)}
        onNextPrayer={nextPrayer}
        onPrevPrayer={prevPrayer}
        onNextViz={nextViz}
        onPrevViz={prevViz}
        videoRef={vizVideoRef}
        onClose={() => setRitualFullscreen(false)}
      />
    )
  }

  return (
    <div className="p-3 md:p-6 space-y-4 bg-[#0f0f12] min-h-full">
      <h2 className="text-base font-semibold text-white flex items-center gap-2"><Sparkles className="w-5 h-5 text-fuchsia-400" /> Rituals</h2>

      <div className="flex gap-1.5 p-1 rounded-full bg-white/5 border border-white/10 w-full md:w-fit overflow-x-auto">
        {['Haircare', 'Skincare', 'Prayer', 'Visualization', 'Affirmations'].map(t => (
          <button key={t} onClick={() => setRitualTab(t)} className={ritualTab === t ? 'px-4 py-1.5 rounded-full text-xs font-medium bg-white text-black whitespace-nowrap' : 'px-4 py-1.5 rounded-full text-xs font-medium text-white/40 whitespace-nowrap'}>{t}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DottedGraph data={analytics[ritualTab] || [20, 40]} color={ritualTab === 'Prayer' ? '#f43f5e' : ritualTab === 'Visualization' ? '#8b5cf6' : ritualTab === 'Affirmations' ? '#eab308' : '#f59e0b'} label={`${ritualTab} • Slide ${ritualTab === 'Prayer' ? `${currentSlide + 1}/${prayerSlides.length}` : `${(tasks[ritualTab] || []).length} items`}`} />
        <div className="bg-[#141418] border border-white/10 rounded-xl p-3 flex items-center justify-between gap-2">
          <div className="min-w-0"><div className="text-xs text-white/30 truncate">TODAY • {ritualTab}</div><div className="text-lg font-bold text-white truncate">{ritualTab === 'Prayer' ? `${prayerSlides.length} prayers` : ritualTab === 'Visualization' ? `${vizSlides.length} viz` : `${(tasks[ritualTab] || []).length} tasks`}</div></div>
          <div className="flex items-center gap-2 shrink-0">
            {(ritualTab === 'Prayer' || ritualTab === 'Visualization') && (
              <button onClick={() => setRitualFullscreen(true)} className="px-3 py-1.5 rounded-full bg-violet-500/15 border border-violet-500/25 text-violet-200 text-xs flex items-center gap-1"><Maximize2 className="w-3 h-3" /> Full screen</button>
            )}
            <button onClick={() => { setSkipTarget({ id: ritualTab.toLowerCase(), name: ritualTab }); setShowSkipConfirm(true) }} className="px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs">{isSkipped(ritualTab) ? 'Skipped' : 'Skip N days'}</button>
          </div>
        </div>
      </div>

      {['Haircare', 'Skincare'].includes(ritualTab) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(tasks[ritualTab] || []).filter((t: any) => dueToday(t, weekdayOf())).map(t => (
            <div key={t.id} onClick={() => setExpandedTask(t)} className="rounded-xl bg-[#141418] border border-white/10 p-4 cursor-pointer">
              <div className="flex gap-3">
                <button onClick={e => { e.stopPropagation(); setTasks(prev => ({ ...prev, [ritualTab]: (prev[ritualTab] || []).map(x => x.id === t.id ? { ...x, done: !x.done } : x) })) }} className={`${t.done ? 'bg-white' : 'border-white/20'} w-5 h-5 rounded-full border flex items-center justify-center shrink-0`}><Check className={`${t.done ? 'text-black' : 'text-transparent'} w-3 h-3`} /></button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{t.title}</div>
                  <div className="text-xs text-white/30 line-clamp-2">{t.instructions}</div>
                  {(t.imageUrl || t.videoUrl) && <div className="mt-2 rounded-lg overflow-hidden aspect-video bg-[#0e0e12] border border-white/5 flex items-center justify-center">{t.mediaType === 'video' && t.videoUrl ? <SmartVideo src={t.videoUrl} className="w-full h-full object-contain" muted loop /> : <SmartImg src={t.imageUrl} className="w-full h-full object-contain" />}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {ritualTab === 'Prayer' && <PrayerBlock
        slide={prayerCurrent} index={currentSlide} total={prayerSlides.length} alarmTime={alarmTime}
        slides={prayerSlides} onPrev={prevPrayer} onNext={nextPrayer} onExpand={() => setRitualFullscreen(true)}
        done={prayerDone} onDone={(v: boolean) => tickRitual('prayer', v)}
      />}

      {ritualTab === 'Visualization' && <VizBlock
        slide={vizCurrentSlide} index={vizCurrent} total={vizSlides.length} muted={isVizMuted}
        onMute={() => setIsVizMuted(!isVizMuted)} onPrev={prevViz} onNext={nextViz}
        videoRef={vizVideoRef} onExpand={() => setRitualFullscreen(true)}
      />}

      {ritualTab === 'Affirmations' && (
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap"><Quote className="w-4 h-4 text-amber-300" /><span className="text-sm font-medium text-white">Affirmations</span>
            <button onClick={() => tickRitual('affirmations', !affirmDone)} className={`text-xs px-3 py-1.5 rounded-full border flex items-center gap-1 ${affirmDone ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-200' : 'bg-white/5 border-white/10 text-white/45'}`}>
              <Check className="w-3 h-3" /> {affirmDone ? 'Done today' : 'Done for today'}
            </button>
            <button onClick={() => setAffirmFullscreen(true)} disabled={!affirmations.length} className={`ml-auto px-3 py-1.5 rounded-full border flex items-center gap-1 text-xs ${affirmations.length ? 'bg-violet-500/15 border-violet-500/25 text-violet-200' : 'bg-white/5 border-white/10 text-white/25'}`}><Maximize2 className="w-3 h-3" /> Full screen</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <input value={newAff} onChange={e => setNewAff(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Add affirmation…" type="text" autoComplete="off" className="flex-1 min-w-48 px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none" />
            <button onClick={() => { if (!newAff.trim()) return; setAffirmations(prev => [...prev, { id: Date.now().toString(), text: newAff.trim() }]); setNewAff('') }} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold">Add</button>
          </div>
          <div ref={scrollRef} className="max-h-64 overflow-y-auto rounded-xl bg-[#0e0e12] border border-white/5 p-3 space-y-2">
            {affirmations.map((a, i) => <div key={a.id} className="group flex items-center gap-2 p-3 rounded-xl bg-[#141418] border border-white/5">
              <span className="flex-1 text-sm text-white/70 min-w-0 cursor-pointer" onClick={() => { setAffirmIndex(i); setAffirmFullscreen(true) }}>{a.text}</span><button onClick={() => { if (confirm('Delete affirmation?')) setAffirmations(prev => prev.filter(x => x.id !== a.id)) }} className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center shrink-0"><Trash2 className="w-3 h-3 text-white/30" /></button>
            </div>)}
            {affirmations.length === 0 && <div className="text-[11px] text-white/25 py-4 text-center">Nothing saved yet — an affirmation you add here appears full screen, in the right rail, and can be played as audio if you upload a clip.</div>}
          </div>
          <AudioPool
        channel="affirmation"
            title="AFFIRMATION AUDIOS"
            audios={affAudios} idx={affAudioIdx} playing={isAffPlaying}
            onAdd={async (files) => { const out: AudioRef[] = []; for (const f of files) out.push({ id: mediaId('aud'), name: f.name.replace(/\.[^.]+$/, ''), url: await storeFile(f, 'aud') }); setAffAudios(prev => [...prev, ...out]) }}
            onPick={(i) => { setAffAudioIdx(i); setIsAffPlaying(true); setTimeout(() => { claimLane('affirmation'); affAudioRef.current?.play().catch(() => releaseLane('affirmation')) }, 140) }}
            onNext={nextAffAudio}
            onToggle={() => toggleAffAudio()}
            onRemove={(id) => { const a = affAudios.find(x => x.id === id); if (a) removeMedia(a.url); setAffAudios(prev => prev.filter(x => x.id !== id)) }}
            audioRef={affAudioRef}
            onEnded={nextAffAudio}
          />
        </div>
      )}

      {affirmFullscreen && affirmations.length > 0 && (
        <AffirmStage
        items={affirmations.map((a: any) => a.text)}
        index={Math.min(affirmIndex, affirmations.length - 1)}
        onIndex={setAffirmIndex}
        playing={isAffPlaying}
        hasAudio={affAudios.length > 0}
        onPlay={() => toggleAffAudio()}
        onClose={() => setAffirmFullscreen(false)}
        audioRef={affAudioRef}
        audioIdx={affAudioIdx}
        audioUrl={affAudioUrls[affAudioIdx] || ''}
        audioName={affAudios[affAudioIdx]?.name}
        onAudioIdx={(i: number) => setAffAudioIdx(i)}
        audioCount={affAudios.length}
      />
      )}

      {expandedTask && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex justify-center p-4 overflow-y-auto">
          <div className="bg-[#141418] border border-white/10 rounded-2xl w-full max-w-2xl h-fit my-auto">
            <div className="p-5 border-b border-white/5 flex justify-between items-center gap-2"><div className="text-sm font-semibold text-white truncate">{expandedTask.title}</div><button onClick={() => setExpandedTask(null)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center shrink-0"><X className="w-4 h-4 text-white/40" /></button></div>
            <div className="p-5 space-y-4">
              <div className="text-sm text-white/70 whitespace-pre-wrap">{expandedTask.instructions}</div>
              {expandedTask.imageUrl && <div className="rounded-xl overflow-hidden aspect-video bg-[#0e0e12] border border-white/5 flex items-center justify-center"><SmartImg src={expandedTask.imageUrl} className="w-full h-full object-contain" /></div>}
              {expandedTask.videoUrl && <div className="rounded-xl overflow-hidden aspect-video bg-[#0e0e12] border border-white/5"><SmartVideo src={expandedTask.videoUrl} controls autoPlay loop muted={isVizMuted} playsInline className="w-full h-full object-contain" /></div>}
            </div>
          </div>
        </div>
      )}

      <Editors
        ritualTab={ritualTab}
        prayerSlides={prayerSlides} setPrayerSlides={setPrayerSlides}
        newPrayerTitle={newPrayerTitle} setNewPrayerTitle={setNewPrayerTitle}
        newPrayerTexts={newPrayerTexts} setNewPrayerTexts={setNewPrayerTexts}
        newPrayerImage={newPrayerImage} setNewPrayerImage={setNewPrayerImage}
        addPrayerSlide={addPrayerSlide}
        editSlideId={editSlideId} setEditSlideId={setEditSlideId}
        editSlideTitle={editSlideTitle} setEditSlideTitle={setEditSlideTitle}
        editSlideTexts={editSlideTexts} setEditSlideTexts={setEditSlideTexts}
        setCurrentSlide={setCurrentSlide}
        vizSlides={vizSlides} setVizSlides={setVizSlides}
        newVizTitle={newVizTitle} setNewVizTitle={setNewVizTitle}
        newVizText={newVizText} setNewVizText={setNewVizText}
        newVizMedia={newVizMedia} setNewVizMedia={setNewVizMedia}
        editVizId={editVizId} setEditVizId={setEditVizId}
        editVizTitle={editVizTitle} setEditVizTitle={setEditVizTitle}
        editVizText={editVizText} setEditVizText={setEditVizText}
        setVizCurrent={setVizCurrent} vizCurrent={vizCurrent}
        tasks={tasks} setTasks={setTasks}
        newTaskTitle={newTaskTitle} setNewTaskTitle={setNewTaskTitle}
        newTaskInstr={newTaskInstr} setNewTaskInstr={setNewTaskInstr}
        newTaskMedia={newTaskMedia} setNewTaskMedia={setNewTaskMedia}
        editTaskId={editTaskId} setEditTaskId={setEditTaskId}
        editTaskTitle={editTaskTitle} setEditTaskTitle={setEditTaskTitle}
        editTaskInstr={editTaskInstr} setEditTaskInstr={setEditTaskInstr}
        setExpandedTask={setExpandedTask}
        prayerAudios={prayerAudios} setPrayerAudios={setPrayerAudios}
        prayerAudioIdx={prayerAudioIdx} setPrayerAudioIdx={setPrayerAudioIdx}
        prayerAudioRef={prayerAudioRef} nextPrayerAudio={nextPrayerAudio}
        today={today}
      />
    </div>
  )
}

function PrayerBlock({ slide, index, total, alarmTime, slides, onPrev, onNext, onExpand, done, onDone }: any) {
  return (
    <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0"><Heart className="w-4 h-4 text-rose-300 shrink-0" /><span className="text-sm font-medium text-white truncate">Prayer • {alarmTime} • {personality.getAIName()}</span></div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full bg-white/10 border border-white/10 text-white/60 shrink-0 hidden sm:inline">{slide?.title || 'No prayer'}</span>
          <button onClick={() => onDone(!done)} className={`text-xs px-3 py-1.5 rounded-full border flex items-center gap-1 shrink-0 ${done ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-200' : 'bg-white/5 border-white/10 text-white/45'}`}>
            <Check className="w-3 h-3" /> {done ? 'Prayed today' : 'Done for today'}
          </button>
          <button onClick={onExpand} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/50" title="Full screen"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {slide ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-xl bg-[#0e0e12] border border-white/10 p-4 flex flex-col min-h-40 max-h-80">
            <div className="text-[10px] tracking-widest text-white/25 mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1"><Sunrise className="w-3 h-3" /> PRAYER • {index + 1}/{total}</span>
              <span className="flex gap-1">{slides.map((_: any, i: number) => <span key={i} className={`${i === index ? 'w-5 bg-white' : 'w-2 bg-white/20'} h-1 rounded-full`} />)}</span>
            </div>
            <div className="overflow-y-auto pr-1 space-y-2">
              <div className="text-base font-semibold text-white">{slide.title}</div>
              {(slide.texts || []).map((txt: string, i: number) => <p key={i} className="p-3 rounded-xl bg-[#141418] border border-white/5 text-[15px] text-white/80 leading-relaxed break-words">“{txt}”</p>)}
            </div>
          </div>
          <div className="rounded-xl bg-[#0e0e12] border border-white/10 p-3 flex flex-col">
            <div className="text-[10px] tracking-widest text-white/25 mb-2">IMAGE • CONTAINED</div>
            <div className="flex-1 min-h-40 rounded-xl bg-[#141418] border border-white/5 overflow-hidden flex items-center justify-center aspect-video">
              {slide.imageUrl ? <SmartImg src={slide.imageUrl} className="w-full h-full object-contain" /> : <div className="p-10 text-xs text-white/20 flex flex-col items-center gap-2"><ImageIcon className="w-6 h-6" /> No image</div>}
            </div>
          </div>
        </div>
      ) : <div className="p-10 text-center text-xs text-white/30">No prayers yet • add below</div>}

      <div className="flex items-center justify-between gap-2">
        <button onClick={onPrev} className="px-4 py-2 rounded-full bg-[#1c1c21] border border-white/10 text-white/60 text-xs flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Prev</button>
        <div className="text-[11px] text-white/25 text-center">Tick this and your affirmations, then the primary workout comes up</div>
        <button onClick={onNext} className="px-4 py-2 rounded-full bg-[#1c1c21] border border-white/10 text-white/60 text-xs flex items-center gap-1">Next <ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

function VizBlock({ slide, index, total, muted, onMute, onPrev, onNext, videoRef, onExpand }: any) {
  return (
    <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0"><Brain className="w-4 h-4 text-violet-300 shrink-0" /><span className="text-sm font-medium text-white truncate">Visualization • {index + 1}/{total}</span></div>
        <div className="flex items-center gap-2">
          <button onClick={onMute} className={`px-3 py-1.5 rounded-full border text-xs flex items-center gap-1.5 shrink-0 ${muted ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-white/10 border-white/10 text-white/60'}`}>
            {muted ? <><VolumeX className="w-3 h-3" /> Muted</> : <><Volume2 className="w-3 h-3" /> Audio ON</>}
          </button>
          <button onClick={onExpand} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/50 shrink-0" title="Full screen"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {slide ? (
        <>
          <div className="rounded-xl bg-[#0e0e12] border border-white/10 overflow-hidden">
            <div className="bg-[#141418] flex items-center justify-center aspect-video overflow-hidden relative max-h-[55vh]">
              {slide.mediaType === 'video' && slide.videoUrl
                ? <SmartVideo ref={videoRef} src={slide.videoUrl} autoPlay loop muted={muted} playsInline controls className="w-full h-full object-contain" />
                : slide.imageUrl
                  ? <SmartImg src={slide.imageUrl} className="w-full h-full object-contain" />
                  : <div className="text-xs text-white/20">No media</div>}
            </div>
            <div className="p-5 space-y-2 text-center">
              <div className="text-lg font-semibold text-white">{slide.title}</div>
              <div className="text-[15px] text-white/60 leading-relaxed max-w-2xl mx-auto break-words">{slide.text}</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button onClick={onPrev} className="px-4 py-2 rounded-full bg-[#1c1c21] border border-white/10 text-white/60 text-xs flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Prev</button>
            <div className="text-[11px] text-white/25 flex items-center gap-1"><Minimize2 className="w-3 h-3" /> media stays inside its box at every size</div>
            <button onClick={onNext} className="px-4 py-2 rounded-full bg-[#1c1c21] border border-white/10 text-white/60 text-xs flex items-center gap-1">Next <ChevronRight className="w-4 h-4" /></button>
          </div>
        </>
      ) : <div className="p-10 text-center text-xs text-white/30">No visualization yet</div>}
    </div>
  )
}

/**
 * Full-screen Prayer / Visualization stage: much bigger text and media for reading across
 * the room, every control present, and a close button. Media is always contained inside its
 * box, so nothing overlaps or runs off the card.
 */
function RitualStage(props: any) {
  const { tab, prayer, prayerIndex, prayerTotal, viz, vizIndex, vizTotal, muted, onMute, onNextPrayer, onPrevPrayer, onNextViz, onPrevViz, videoRef, onClose } = props
  const isPrayer = tab === 'Prayer'
  const index = isPrayer ? prayerIndex : vizIndex
  const total = isPrayer ? prayerTotal : vizTotal
  const next = isPrayer ? onNextPrayer : onNextViz
  const prev = isPrayer ? onPrevPrayer : onPrevViz

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === ' ' && isPrayer) { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, next, prev, isPrayer])

  return (
    <div className="fixed inset-0 z-[120] bg-[#07070a] flex flex-col">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          {isPrayer ? <Heart className="w-5 h-5 text-rose-300 shrink-0" /> : <Brain className="w-5 h-5 text-violet-300 shrink-0" />}
          <span className="text-sm md:text-base font-medium text-white truncate">{isPrayer ? (prayer?.title || 'Prayer') : (viz?.title || 'Visualization')}</span>
          <span className="text-[11px] text-white/35 shrink-0">{index + 1} / {total}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isPrayer && (
            <button onClick={onMute} className={`px-3 py-1.5 rounded-full border text-xs flex items-center gap-1.5 ${muted ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-white/10 border-white/10 text-white/70'}`}>
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />} {muted ? 'Muted' : 'Audio on'}
            </button>
          )}
          <button onClick={onClose} className="h-9 px-3 rounded-full bg-white text-black text-xs font-semibold flex items-center gap-1.5 shrink-0"><X className="w-3.5 h-3.5" /> Close</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-3 md:px-16 py-4 relative">
        <button onClick={prev} className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-[#141418] border border-white/10 items-center justify-center hover:bg-white/10"><ChevronLeft className="w-6 h-6 text-white" /></button>
        <button onClick={next} className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-[#141418] border border-white/10 items-center justify-center hover:bg-white/10"><ChevronRight className="w-6 h-6 text-white" /></button>

        {isPrayer ? (
          prayer ? (
            <div className={`w-full max-w-5xl grid gap-5 max-h-full ${prayer.imageUrl ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
              <div className="rounded-2xl bg-[#0e0e12] border border-white/10 p-5 md:p-7 overflow-y-auto max-h-full">
                <div className="text-2xl md:text-3xl font-semibold text-white mb-5 break-words">{prayer.title}</div>
                <div className="space-y-4">
                  {(prayer.texts || []).map((txt: string, i: number) => <p key={i} className="text-xl md:text-2xl leading-relaxed text-white/85 break-words">“{txt}”</p>)}
                </div>
              </div>
              <div className="rounded-2xl bg-[#0e0e12] border border-white/10 p-3 md:p-4 flex items-center justify-center min-h-56">
                {prayer.imageUrl
                  ? <SmartImg src={prayer.imageUrl} className="max-h-[75vh] w-auto max-w-full object-contain rounded-xl" />
                  : <div className="text-xs text-white/20 flex flex-col items-center gap-2 py-16"><ImageIcon className="w-7 h-7" /> No image on this slide</div>}
              </div>
            </div>
          ) : <div className="text-sm text-white/30">No prayers yet</div>
        ) : viz ? (
          <div className="w-full max-w-6xl flex flex-col items-center gap-4 max-h-full">
            <div className="w-full rounded-2xl bg-[#0e0e12] border border-white/10 overflow-hidden flex items-center justify-center">
              {viz.mediaType === 'video' && viz.videoUrl
                ? <SmartVideo ref={videoRef} src={viz.videoUrl} autoPlay loop muted={muted} playsInline controls className="w-full max-h-[65vh] object-contain" />
                : viz.imageUrl
                  ? <SmartImg src={viz.imageUrl} className="w-full max-h-[65vh] object-contain" />
                  : <div className="py-24 text-xs text-white/20">No media on this slide</div>}
            </div>
            <div className="px-2 text-center space-y-2 overflow-y-auto">
              <div className="text-2xl md:text-3xl font-semibold text-white break-words">{viz.title}</div>
              <div className="text-lg md:text-2xl text-white/70 leading-relaxed max-w-4xl mx-auto break-words">{viz.text}</div>
            </div>
          </div>
        ) : <div className="text-sm text-white/30">No visualization yet</div>}
      </div>

      <div className="shrink-0 flex items-center justify-center gap-3 px-4 py-3 border-t border-white/5">
        <button onClick={prev} className="md:hidden px-4 py-2 rounded-full bg-[#141418] border border-white/10 text-white/60 text-xs">‹ Prev</button>
        <div className="flex gap-1.5">{Array.from({ length: total }).map((_: any, i: number) => <button key={i} onClick={() => { const d = i - index; if (d > 0) for (let k = 0; k < d; k++) next(); if (d < 0) for (let k = 0; k < -d; k++) prev() }} className={`${i === index ? 'w-8 bg-white' : 'w-2.5 bg-white/20'} h-1.5 rounded-full transition-all`} />)}</div>
        <button onClick={next} className="md:hidden px-4 py-2 rounded-full bg-[#141418] border border-white/10 text-white/60 text-xs">Next ›</button>
      </div>
    </div>
  )
}

/** Shared audio pool (prayer universal audios + affirmation audios). */
function AudioPool({ title, channel, audios, idx, playing, onAdd, onPick, onNext, onToggle, onRemove, audioRef, onEnded }: {
  channel: 'prayer' | 'affirmation'
  title: string; audios: AudioRef[]; idx: number; playing: boolean
  onAdd: (files: File[]) => void; onPick: (i: number) => void; onNext: () => void
  onToggle: () => void; onRemove: (id: string) => void
  audioRef: React.RefObject<HTMLAudioElement>; onEnded: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const src = useMediaUrl(audios[idx]?.url)
  return (
    <div className="rounded-xl bg-[#0e0e12] border border-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] tracking-widest text-white/40 truncate">{title}</div>
        <input ref={ref} type="file" accept="audio/*" multiple className="hidden" onChange={(e) => { const f = Array.from((e.target as any).files || []) as File[]; if (f.length) onAdd(f); (e.target as any).value = '' }} />
        <button onClick={() => ref.current?.click()} className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-white/60 text-xs flex items-center gap-1 shrink-0"><Music className="w-3 h-3" /> Add audios</button>
      </div>
      <div className="flex items-center gap-2 bg-[#141418] border border-white/5 rounded-xl p-2">
        <button onClick={onToggle} className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shrink-0">{playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
        <button onClick={onNext} className="w-8 h-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center shrink-0"><SkipForward className="w-4 h-4 text-white/60" /></button>
        <div className="flex-1 text-xs text-white/50 truncate">{audios[idx]?.name || 'No audio'}</div>
        <div className="text-xs text-white/20 shrink-0">{audios.length ? `${idx + 1}/${audios.length}` : '0/0'}</div>
      </div>
      <audio
        ref={audioRef}
        src={src || undefined}
        controls
        className="w-full h-8"
        onEnded={onEnded}
        onPlay={() => { if (!claimLane(channel)) { audioRef.current?.pause() } }}
        onPause={() => releaseLane(channel)}
      />
      {audios.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {audios.map((aud: any, i: number) => (
            <div key={aud.id} className={`${i === idx ? 'border-violet-500/30 bg-violet-500/10' : 'border-white/5 bg-[#141418]'} border rounded-xl p-2 flex items-center justify-between gap-2`}>
              <div className="flex items-center gap-2 flex-1 min-w-0"><Music className="w-3 h-3 text-white/30 shrink-0" /><span className="text-xs text-white/60 truncate">{aud.name}</span></div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => onPick(i)} className="px-2 py-1 rounded-full bg-white text-black text-xs">Play</button>
                <button onClick={() => onRemove(aud.id)} className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center"><Trash2 className="w-3 h-3 text-white/30" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Editors(p: any) {
  const {
    ritualTab,
    prayerSlides, setPrayerSlides, newPrayerTitle, setNewPrayerTitle, newPrayerTexts, setNewPrayerTexts,
    newPrayerImage, setNewPrayerImage, addPrayerSlide, editSlideId, setEditSlideId, editSlideTitle,
    setEditSlideTitle, editSlideTexts, setEditSlideTexts, setCurrentSlide,
    vizSlides, setVizSlides, newVizTitle, setNewVizTitle, newVizText, setNewVizText, newVizMedia,
    setNewVizMedia, editVizId, setEditVizId, editVizTitle, setEditVizTitle, editVizText, setEditVizText,
    setVizCurrent, vizCurrent, tasks, setTasks, newTaskTitle, setNewTaskTitle, newTaskInstr,
    setNewTaskInstr, newTaskMedia, setNewTaskMedia, editTaskId, setEditTaskId, editTaskTitle,
    setEditTaskTitle, editTaskInstr, setEditTaskInstr, setExpandedTask,
    prayerAudios, setPrayerAudios, prayerAudioIdx, setPrayerAudioIdx, prayerAudioRef, nextPrayerAudio, today
  } = p
  // days start EMPTY on purpose: you tick the weekdays you actually do this routine,
  // then the time, then Add. Nothing is reminded for a day you did not pick.
  const [newTaskDays, setNewTaskDays] = useState<string[]>([])
  const [newTaskTime, setNewTaskTime] = useState('')
  const [editDays, setEditDays] = useState<string[]>([])
  const [editTime, setEditTime] = useState('')
  const [dayWarning, setDayWarning] = useState('')
  const openTaskEditor = (t: any) => {
    setEditTaskId(t.id); setEditTaskTitle(t.title); setEditTaskInstr(t.instructions)
    setEditDays(Array.isArray(t.days) ? [...t.days] : []); setEditTime(t.time || '')
    setDayWarning('')
  }
  const imgRef = useRef<HTMLInputElement>(null)
  const audioFileRef = useRef<HTMLInputElement>(null)
  const [playing, setPlaying] = useState(false)

  if (ritualTab === 'Prayer') {
    return (
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-5">
        <div className="text-sm font-medium text-white flex items-center gap-2"><Edit3 className="w-4 h-4 text-amber-300" /> Prayer slides &amp; audios</div>

        <input ref={audioFileRef} type="file" accept="audio/*" multiple className="hidden" onChange={async (e) => {
          const files = Array.from((e.target as any).files || []) as File[]
          const out: AudioRef[] = []
          for (const f of files) out.push({ id: mediaId('aud'), name: f.name.replace(/\.[^.]+$/, ''), url: await storeFile(f, 'aud') })
          setPrayerAudios((prev: AudioRef[]) => [...prev, ...out])
        }} />
        <AudioPool
        channel="prayer"
          title="UNIVERSAL AUDIOS • ADD / REMOVE"
          audios={prayerAudios} idx={prayerAudioIdx} playing={playing}
          onAdd={async (files: File[]) => { const out: AudioRef[] = []; for (const f of files) out.push({ id: mediaId('aud'), name: f.name.replace(/\.[^.]+$/, ''), url: await storeFile(f, 'aud') }); setPrayerAudios((prev: AudioRef[]) => [...prev, ...out]) }}
          onPick={(i: number) => { setPrayerAudioIdx(i); setTimeout(() => prayerAudioRef.current?.play(), 120); setPlaying(true) }}
          onNext={nextPrayerAudio}
          onToggle={() => { const a = prayerAudioRef.current; if (!a) return; if (a.paused) { claimLane('prayer'); a.play(); setPlaying(true) } else { a.pause(); setPlaying(false); releaseLane('prayer') } }}
          onRemove={(id: string) => { const a = prayerAudios.find((x: AudioRef) => x.id === id); if (a) removeMedia(a.url); setPrayerAudios((prev: AudioRef[]) => prev.filter((x: AudioRef) => x.id !== id)) }}
          audioRef={prayerAudioRef}
          onEnded={nextPrayerAudio}
        />

        <div>
          <div className="text-xs tracking-widest text-white/40 mb-3">VIEW / EDIT / DELETE PRAYER SLIDES</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {prayerSlides.map((s: PrayerSlide, i: number) => (
              <div key={s.id} className="rounded-xl bg-[#0e0e12] border border-white/5 p-3">
                {editSlideId === s.id ? (
                  <div className="space-y-2">
                    <input value={editSlideTitle} onChange={e => setEditSlideTitle(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Title" className="w-full h-8 px-2 rounded-lg bg-[#141418] border border-white/10 text-xs text-white outline-none" />
                    {editSlideTexts.map((t: string, idx: number) => (
                      <div key={idx} className="flex gap-2">
                        <input value={t} onChange={e => { const c = [...editSlideTexts]; c[idx] = e.target.value; setEditSlideTexts(c) }} onFocus={e => e.stopPropagation()} className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-[#141418] border border-white/10 text-xs text-white outline-none" />
                        <button onClick={() => setEditSlideTexts((prev: string[]) => prev.filter((_: string, j: number) => j !== idx))} className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0"><Trash2 className="w-3 h-3 text-white/40" /></button>
                      </div>
                    ))}
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setEditSlideTexts((prev: string[]) => [...prev, ''])} className="px-2 py-1 rounded-full bg-white/10 text-white/40 text-xs">+ text box</button>
                      <label className="px-2 py-1 rounded-full bg-white/10 text-white/40 text-xs flex items-center gap-1 cursor-pointer"><ImageIcon className="w-3 h-3" /> Change image
                        <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = (e.target as any).files?.[0]; if (!f) return; const refStr = await storeFile(f, 'img'); setPrayerSlides((prev: PrayerSlide[]) => prev.map(x => x.id === s.id ? { ...x, imageUrl: refStr } : x)) }} />
                      </label>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setPrayerSlides((prev: PrayerSlide[]) => prev.map(x => x.id === s.id ? { ...x, title: editSlideTitle, texts: editSlideTexts.filter(Boolean) } : x)); setEditSlideId(null) }} className="px-3 py-1.5 rounded-lg bg-white text-black text-xs">Save</button>
                      <button onClick={() => setEditSlideId(null)} className="px-3 py-1.5 rounded-lg bg-white/10 text-white/40 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="w-16 h-16 rounded-xl bg-[#141418] border border-white/5 flex items-center justify-center shrink-0 overflow-hidden">{s.imageUrl ? <SmartImg src={s.imageUrl} className="w-full h-full object-contain" /> : <ImageIcon className="w-4 h-4 text-white/20" />}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{i + 1}. {s.title}</div>
                      <div className="text-xs text-white/40 line-clamp-2">{(s.texts || []).join(' • ')}</div>
                      <div className="flex gap-1 mt-2 flex-wrap">
                        <button onClick={() => setCurrentSlide(i)} className="px-2 py-0.5 rounded-full bg-white/10 text-white/60 text-xs">View</button>
                        <button onClick={() => { setEditSlideId(s.id); setEditSlideTitle(s.title); setEditSlideTexts(s.texts || ['']) }} className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">Edit</button>
                        <button onClick={() => { if (confirm('Delete slide?')) setPrayerSlides((prev: PrayerSlide[]) => prev.filter((x: PrayerSlide) => x.id !== s.id)) }} className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-300 text-xs">Delete</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/5 pt-4 space-y-3">
          <div className="text-xs tracking-widest text-white/40">ADD NEW PRAYER • TITLE + TEXT BOXES + IMAGE</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newPrayerTitle} onChange={e => setNewPrayerTitle(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Title" className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none" />
            <button onClick={() => imgRef.current?.click()} className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white/40 flex items-center gap-1 justify-center">{newPrayerImage ? 'Image attached ✓' : 'Add image'} <ImageIcon className="w-3 h-3" /></button>
            <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = (e.target as any).files?.[0]; if (!f) return; setNewPrayerImage(await storeFile(f, 'img')) }} />
          </div>
          <div className="space-y-2">
            {newPrayerTexts.map((txt: string, idx: number) => (
              <div key={idx} className="flex gap-2">
                <input value={txt} onChange={e => { const copy = [...newPrayerTexts]; copy[idx] = e.target.value; setNewPrayerTexts(copy) }} onFocus={e => e.stopPropagation()} placeholder={`Prayer text box ${idx + 1}`} className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none" />
                <button onClick={() => setNewPrayerTexts((prev: string[]) => prev.filter((_: string, i: number) => i !== idx))} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0"><Trash2 className="w-4 h-4 text-white/30" /></button>
              </div>
            ))}
            <button onClick={() => setNewPrayerTexts((prev: string[]) => [...prev, ''])} className="px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs flex items-center gap-1"><Plus className="w-3 h-3" /> Add text box</button>
          </div>
          <button onClick={addPrayerSlide} className="px-4 h-10 rounded-xl bg-white text-black text-xs font-semibold">Add prayer slide</button>
        </div>
      </div>
    )
  }

  if (ritualTab === 'Visualization') {
    return (
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-5">
        <div className="text-sm font-medium text-white flex items-center gap-2"><Edit3 className="w-4 h-4 text-violet-300" /> Visualization slides • audio on by default</div>
        <div>
          <div className="text-xs tracking-widest text-white/40 mb-3">VIEW / EDIT / DELETE</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {vizSlides.map((s: VizSlide, i: number) => (
              <div key={s.id} className="rounded-xl bg-[#0e0e12] border border-white/5 p-3">
                {editVizId === s.id ? (
                  <div className="space-y-2">
                    <input value={editVizTitle} onChange={e => setEditVizTitle(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Title" className="w-full h-8 px-2 rounded-lg bg-[#141418] border border-white/10 text-xs text-white outline-none" />
                    <input value={editVizText} onChange={e => setEditVizText(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Text below media" className="w-full h-8 px-2 rounded-lg bg-[#141418] border border-white/10 text-xs text-white outline-none" />
                    <label className="px-2 py-1 rounded-full bg-white/10 text-white/40 text-xs flex items-center gap-1 cursor-pointer w-fit"><ImageIcon className="w-3 h-3" /> Change image/video
                      <input type="file" accept="image/*,video/*" className="hidden" onChange={async (e) => {
                        const f = (e.target as any).files?.[0]; if (!f) return
                        const refStr = await storeFile(f, 'viz')
                        const isVideo = f.type.startsWith('video/')
                        setVizSlides((prev: VizSlide[]) => prev.map(v => v.id === s.id ? { ...v, imageUrl: isVideo ? '' : refStr, videoUrl: isVideo ? refStr : '', mediaType: isVideo ? 'video' : 'image' } : v))
                      }} />
                    </label>
                    <div className="flex gap-1">
                      <button onClick={() => { setVizSlides((prev: VizSlide[]) => prev.map(v => v.id === s.id ? { ...v, title: editVizTitle, text: editVizText } : v)); setEditVizId(null) }} className="px-3 py-1.5 rounded-lg bg-white text-black text-xs">Save</button>
                      <button onClick={() => setEditVizId(null)} className="px-3 py-1.5 rounded-lg bg-white/10 text-white/40 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="w-16 h-16 rounded-xl bg-[#141418] border border-white/5 flex items-center justify-center shrink-0 overflow-hidden">{s.mediaType === 'video' && s.videoUrl ? <SmartVideo src={s.videoUrl} className="w-full h-full object-contain" loop muted /> : s.imageUrl ? <SmartImg src={s.imageUrl} className="w-full h-full object-contain" /> : <ImageIcon className="w-4 h-4 text-white/20" />}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{i + 1}. {s.title}</div>
                      <div className="text-xs text-white/40 line-clamp-2">{s.text}</div>
                      <div className="flex gap-1 mt-2 flex-wrap">
                        <button onClick={() => setVizCurrent(i)} className="px-2 py-0.5 rounded-full bg-white/10 text-white/60 text-xs">View</button>
                        <button onClick={() => { setEditVizId(s.id); setEditVizTitle(s.title); setEditVizText(s.text) }} className="px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-200 text-xs">Edit</button>
                        <button onClick={() => { if (confirm('Delete visualization?')) { setVizSlides((prev: VizSlide[]) => prev.filter((v: VizSlide) => v.id !== s.id)); if (vizCurrent >= vizSlides.length - 1) setVizCurrent(Math.max(0, vizSlides.length - 2)) } }} className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-300 text-xs">Delete</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-white/5 pt-4 space-y-3">
          <div className="text-xs tracking-widest text-white/40">ADD NEW VISUALIZATION • MEDIA ABOVE + TEXT BELOW</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newVizTitle} onChange={e => setNewVizTitle(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Title" className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none" />
            <input value={newVizText} onChange={e => setNewVizText(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Text below media…" className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <label className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-white/60 text-xs flex items-center gap-1 cursor-pointer"><ImageIcon className="w-3 h-3" /> {newVizMedia ? 'Media added ✓' : 'Add image/video'}
              <input type="file" accept="image/*,video/*" className="hidden" onChange={async (e) => { const f = (e.target as any).files?.[0]; if (!f) return; setNewVizMedia({ url: await storeFile(f, 'viz'), type: f.type.startsWith('video/') ? 'video' : 'image' }) }} />
            </label>
            <button onClick={() => {
              if (!newVizTitle.trim()) return
              setVizSlides((prev: VizSlide[]) => [...prev, {
                id: Date.now().toString(), title: newVizTitle.trim(), text: newVizText.trim(),
                imageUrl: newVizMedia?.type === 'image' ? newVizMedia.url : '', videoUrl: newVizMedia?.type === 'video' ? newVizMedia.url : '', mediaType: newVizMedia?.type || 'image'
              }])
              setNewVizTitle(''); setNewVizText(''); setNewVizMedia(null)
            }} className="px-4 h-10 rounded-xl bg-white text-black text-xs font-semibold">Add slide</button>
          </div>
        </div>
      </div>
    )
  }

  if (ritualTab === 'Haircare' || ritualTab === 'Skincare') {
    return (
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-5">
        <div className="text-sm font-medium text-white flex items-center gap-2"><Edit3 className="w-4 h-4 text-amber-300" /> {ritualTab} • view / edit / delete</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(tasks[ritualTab] || []).map((t: RitualTask, i: number) => (
            <div key={t.id} className="rounded-xl bg-[#0e0e12] border border-white/5 p-3">
              {editTaskId === t.id ? (
                <div className="space-y-2">
                  <input value={editTaskTitle} onChange={e => setEditTaskTitle(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Title" className="w-full h-8 px-2 rounded-lg bg-[#141418] border border-white/10 text-xs text-white outline-none" />
                  <input value={editTaskInstr} onChange={e => setEditTaskInstr(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Instructions" className="w-full h-8 px-2 rounded-lg bg-[#141418] border border-white/10 text-xs text-white outline-none" />
                  <label className="px-2 py-1 rounded-full bg-white/10 text-white/40 text-xs flex items-center gap-1 cursor-pointer w-fit"><ImageIcon className="w-3 h-3" /> Change image/video
                    <input type="file" accept="image/*,video/*" className="hidden" onChange={async (e) => {
                      const f = (e.target as any).files?.[0]; if (!f) return
                      const refStr = await storeFile(f, 'rt')
                      const isVideo = f.type.startsWith('video/')
                      setTasks((prev: any) => ({ ...prev, [ritualTab]: (prev[ritualTab] || []).map((x: RitualTask) => x.id === t.id ? { ...x, imageUrl: isVideo ? '' : refStr, videoUrl: isVideo ? refStr : '', mediaType: isVideo ? 'video' : 'image' } : x) }))
                    }} />
                  </label>
                  <div className="flex gap-1">
                    <button onClick={() => { setTasks((prev: any) => ({ ...prev, [ritualTab]: (prev[ritualTab] || []).map((x: RitualTask) => x.id === t.id ? { ...x, title: editTaskTitle, instructions: editTaskInstr } : x) })); setEditTaskId(null) }} className="px-3 py-1.5 rounded-lg bg-white text-black text-xs">Save</button>
                    <button onClick={() => setEditTaskId(null)} className="px-3 py-1.5 rounded-lg bg-white/10 text-white/40 text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-xl bg-[#141418] border border-white/5 flex items-center justify-center shrink-0 overflow-hidden">{t.mediaType === 'video' && t.videoUrl ? <SmartVideo src={t.videoUrl} className="w-full h-full object-contain" loop muted /> : t.imageUrl ? <SmartImg src={t.imageUrl} className="w-full h-full object-contain" /> : <ImageIcon className="w-4 h-4 text-white/20" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate flex items-center gap-1.5 flex-wrap">{i + 1}. {t.title}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${(t.days || []).length ? 'bg-violet-500/10 border-violet-500/20 text-violet-200' : 'bg-amber-500/10 border-amber-500/20 text-amber-200'}`}>
                      {(t.days || []).length === 7 ? 'every day' : ((t.days || []).join(' ') || 'no days picked')}{t.time ? ` • ${t.time}` : ''}
                    </span>
                  </div>
                    <div className="text-xs text-white/40 line-clamp-2">{t.instructions}</div>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      <button onClick={() => setExpandedTask(t)} className="px-2 py-0.5 rounded-full bg-white/10 text-white/60 text-xs">View</button>
                      <button onClick={() => openTaskEditor(t)} className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">Edit</button>
                      <button onClick={() => { if (confirm(`Delete ${ritualTab} task?`)) setTasks((prev: any) => ({ ...prev, [ritualTab]: (prev[ritualTab] || []).filter((x: RitualTask) => x.id !== t.id) })) }} className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-300 text-xs">Delete</button>
                      {(t.imageUrl || t.videoUrl) && <button onClick={() => { if (t.imageUrl) removeMedia(t.imageUrl); if (t.videoUrl) removeMedia(t.videoUrl); setTasks((prev: any) => ({ ...prev, [ritualTab]: (prev[ritualTab] || []).map((x: RitualTask) => x.id === t.id ? { ...x, imageUrl: '', videoUrl: '' } : x) })) }} className="px-2 py-0.5 rounded-full bg-white/5 text-white/30 text-xs">Delete media</button>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {(tasks[ritualTab] || []).length === 0 && <div className="text-[11px] text-white/25 col-span-2 py-4">Nothing here yet — add your {ritualTab.toLowerCase()} routine below; pick the weekdays and time for the reminder.</div>}
        </div>
        <div className="border-t border-white/5 pt-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} onFocus={e => e.stopPropagation()} placeholder={`Title • ${ritualTab}`} className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none" />
            <input value={newTaskInstr} onChange={e => setNewTaskInstr(e.target.value)} onFocus={e => e.stopPropagation()} placeholder="Instructions…" className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white outline-none" />
            <label className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white/40 flex items-center gap-1 justify-center cursor-pointer"><ImageIcon className="w-3 h-3" /> {newTaskMedia ? 'Media added ✓' : 'Add image/video'}
              <input type="file" accept="image/*,video/*" className="hidden" onChange={async (e) => { const f = (e.target as any).files?.[0]; if (!f) return; setNewTaskMedia({ url: await storeFile(f, 'rt'), type: f.type.startsWith('video/') ? 'video' : 'image' }) }} />
            </label>
            <input type="time" value={newTaskTime} onChange={(e: any) => setNewTaskTime(e.target.value)} className="h-10 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white" />
          </div>
          <DayPicker value={newTaskDays} onChange={setNewTaskDays} />
          <div className={`text-[11px] ${dayWarning ? 'text-amber-200' : 'text-white/25'}`}>
            {dayWarning || 'Nothing is reminded for a day you do not tick — start with every day unchecked.'}
          </div>
          <button onClick={() => {
            if (!newTaskTitle.trim()) return
            if (!newTaskDays.length) { setDayWarning('Pick at least one day — or tap “every day”.'); return }
            if (!newTaskTime) { setDayWarning('Pick the time you want reminding at.'); return }
            setTasks((prev: any) => ({ ...prev, [ritualTab]: [...(prev[ritualTab] || []), { id: Date.now().toString(), title: newTaskTitle.trim(), instructions: newTaskInstr.trim(), imageUrl: newTaskMedia?.type === 'image' ? newTaskMedia.url : '', videoUrl: newTaskMedia?.type === 'video' ? newTaskMedia.url : '', mediaType: newTaskMedia?.type || 'image', done: false, date: today, days: [...newTaskDays], time: newTaskTime }] }))
            setNewTaskTitle(''); setNewTaskInstr(''); setNewTaskMedia(null); setDayWarning('')
          }} className="px-4 h-10 rounded-xl bg-white text-black text-xs font-semibold">Add {ritualTab} task</button>
        </div>
      </div>
    )
  }

  return null
}



/**
 * Affirmations full screen — one line at a time, big text, left/right navigation,
 * optional clip, and a Close button. Same shape as the prayer / visualization stage
 * so nothing overlaps or runs off the card.
 */
function AffirmStage(props: any) {
  const { items, index, onIndex, playing, hasAudio, onPlay, onClose, audioRef, audioUrl, audioName, onAudioIdx, audioCount } = props
  const total = items.length
  const next = () => onIndex((index + 1) % total)
  const prev = () => onIndex((index - 1 + total) % total)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, total])

  return (
    <div className="fixed inset-0 z-[120] bg-[#07070a] flex flex-col">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <Quote className="w-5 h-5 text-amber-300 shrink-0" />
          <span className="text-sm md:text-base font-medium text-white truncate">Affirmations</span>
          <span className="text-[11px] text-white/35 shrink-0">{index + 1} / {total}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasAudio && (
            <button onClick={onPlay} className="px-3 py-1.5 rounded-full border border-white/10 bg-white/10 text-white/70 text-xs flex items-center gap-1.5">
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} {playing ? 'Pause clip' : 'Play clip'}
            </button>
          )}
          <button onClick={onClose} className="h-9 px-3 rounded-full bg-white text-black text-xs font-semibold flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Close</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-4 md:px-20 py-6 relative overflow-y-auto">
        <button onClick={prev} className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-[#141418] border border-white/10 items-center justify-center hover:bg-white/10"><ChevronLeft className="w-6 h-6 text-white" /></button>
        <button onClick={next} className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-[#141418] border border-white/10 items-center justify-center hover:bg-white/10"><ChevronRight className="w-6 h-6 text-white" /></button>
        <div className="w-full max-w-4xl text-center py-6">
          <div className="text-3xl md:text-5xl font-semibold text-white leading-tight break-words">{items[index]}</div>
          <div className="text-[11px] text-white/25 mt-8">one line at a time • arrow keys or the sides • never spoken by the AI</div>
        </div>
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-white/5 flex items-center justify-center gap-3">
        <button onClick={prev} className="md:hidden px-4 py-2 rounded-full bg-[#141418] border border-white/10 text-white/60 text-xs">‹ Prev</button>
        <div className="flex gap-1.5 max-w-[60vw] overflow-x-auto">{items.map((_: any, i: number) => <button key={i} onClick={() => onIndex(i)} className={`${i === index ? 'w-8 bg-white' : 'w-2.5 bg-white/20'} h-1.5 rounded-full transition-all shrink-0`} />)}</div>
        <button onClick={next} className="md:hidden px-4 py-2 rounded-full bg-[#141418] border border-white/10 text-white/60 text-xs">Next ›</button>
      </div>

      {audioUrl && <audio ref={audioRef} src={audioUrl} className="hidden" />}
      {audioCount > 1 && (
        <div className="shrink-0 px-4 pb-3 flex items-center gap-2 text-[11px] text-white/35 justify-center">
          <span className="truncate max-w-[40vw]">{audioName || 'clip'}</span>
          <select value={props.audioIdx ?? 0} onChange={(e: any) => onAudioIdx(Number(e.target.value))} className="bg-[#141418] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white/60">
            {Array.from({ length: audioCount }).map((_: any, i: number) => <option key={i} value={i}>clip {i + 1}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
