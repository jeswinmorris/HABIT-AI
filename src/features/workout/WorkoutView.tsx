import { useEffect, useState, useRef } from 'react'
import { Dumbbell, Play, Check, ZapOff, Plus, Trash2, Clock, Video, Image as ImageIcon, ChevronDown, ChevronUp, AlertTriangle, Utensils, X, Timer, Activity, SunMedium, Repeat } from 'lucide-react'
import { putMedia, mediaId } from '../../lib/mediaStore'
import { useMediaUrl } from '../../lib/useMedia'
import { todayKey, dayKey } from '../../lib/clock'
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)
import { useApp } from '../../store/AppContext'
import { speakingModel } from '../../speaking/speakingModel'

type Workout = {
  id: string
  name: string
  reps: string
  category: string
  mediaUrl?: string
  mediaType?: 'image' | 'video'
  completed: boolean
  streak: string
  group: string
  /** primary = the full-stretch session that runs once, after prayers + affirmations.
   *  secondary = random mid-day sets ("give me 20 pushups") between Start and End of day. */
  slot?: 'primary' | 'secondary'
}

type Segment = {
  id: string
  name: string
  workouts: Workout[]
  collapsed: boolean
}

type Injury = { id: string, date: string, body: string, note: string }
type DietItem = { id: string, time: string, food: string, supplement: string }

// BACKEND HOOKS
const API = {
  saveWorkout(w: Segment[]) { console.log('[BACKEND] POST /api/workout', w); localStorage.setItem('habitOS_workoutSegments', JSON.stringify(w)) },
  saveHistory(h: any) { console.log('[DB 12AM] POST /api/workout/archive', h) },
  saveInjury(i: Injury) { console.log('[BACKEND] POST /api/workout/injury', i) }
}

/** Renders a stored media:<id> reference (survives restarts, unlike blob: URLs). */
function WMed({ src, kind, className, controls, autoPlay, loop }: any) {
  const url = useMediaUrl(src)
  if (!url) return null
  return kind === 'video'
    ? <video src={url} className={className} controls={controls} autoPlay={autoPlay} loop={loop} muted playsInline />
    : <img src={url} className={className} alt="" />
}

function OrangeDottedGraph({ data, label }: { data: number[], label: string }) {
  const w = 320, h = 80, pad = 20
  const max = Math.max(...data, 100)
  const pts = data.map((v,i)=>{
    const x = pad + (i/(data.length-1))*(w-pad*2)
    const y = h - pad - (v/max)*(h-pad*2)
    return {x,y,v}
  })
  const path = pts.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
      <div className="text-xs text-white/30 mb-2 flex items-center gap-1"><Activity className="w-3 h-3 text-orange-400" /> {label}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24">
        <path d={path} fill="none" stroke="#f97316" strokeWidth="2" strokeDasharray="4 4" />
        {pts.map((p,i)=>(
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="#f97316" stroke="#141418" strokeWidth="2" />
            <circle cx={p.x} cy={p.y} r="2" fill="#fff" />
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-xs text-white/20 mt-1">{['M','T','W','T','F','S','S'].map((d,i)=><span key={i}>{d}</span>)}</div>
    </div>
  )
}

export default function WorkoutView({ onTriggerWorkout }: any) {
  const { setShowSkipConfirm, setSkipTarget, skips } = useApp() as any
  const isSkipped = (skips || []).some((k: any) => k.streakId === 'workout' && new Date() <= new Date(k.endDate))

  const [segments, setSegments] = useState<Segment[]>(()=>{
    try {
      const saved = JSON.parse(localStorage.getItem('habitOS_workoutSegments') || '[]')
      if (saved.length) return saved
      return [
        { id: '1', name: 'Chest', collapsed: false, workouts: [
          { id: 'w1', name: '20 pushups', reps: '12d • 20 reps • chest', category: 'chest', completed: false, streak: '12d', group: 'chest' },
          { id: 'w2', name: '30 sec plank', reps: '21d • 30s hold • core', category: 'core', completed: false, streak: '21d', group: 'chest' },
        ]},
        { id: '2', name: 'Biceps', collapsed: false, workouts: [] },
        { id: '3', name: 'Triceps', collapsed: false, workouts: [] },
        { id: '4', name: 'Neck', collapsed: true, workouts: [] },
        { id: '5', name: 'Forearms', collapsed: true, workouts: [] },
        { id: '6', name: 'Leg', collapsed: false, workouts: [
          { id: 'w3', name: '15 squats', reps: '8d • 15 reps • full-body', category: 'leg', completed: false, streak: '8d', group: 'leg' },
          { id: 'w4', name: '20 jumping jacks', reps: '5d • 20 reps • cardio', category: 'leg', completed: false, streak: '5d', group: 'leg' },
          { id: 'w5', name: '15 lunges', reps: '3d • 15 reps • glutes', category: 'leg', completed: false, streak: '3d', group: 'leg' },
        ]},
      ]
    } catch { return [] }
  })

  const [showDiet, setShowDiet] = useState(false)
  const [dietItems, setDietItems] = useState<DietItem[]>(()=>{
    try { return JSON.parse(localStorage.getItem('habitOS_diet') || '[]') } catch { return [] }
  })
  const [newDiet, setNewDiet] = useState({ time: '08:00', food: '', supplement: '' })

  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null)

  const [timer, setTimer] = useState(0)
  const timerRef = useRef<any>(null)

  const [newSegmentName, setNewSegmentName] = useState('')
  const [newWorkout, setNewWorkout] = useState({ segId: '', name: '', reps: '', slot: 'primary' as 'primary' | 'secondary' })
  const [injuries, setInjuries] = useState<Injury[]>(()=>{
    try { return JSON.parse(localStorage.getItem('habitOS_injury') || '[]') } catch { return [] }
  })
  const [injuryNote, setInjuryNote] = useState({ body: 'Chest', note: '' })

  const todayStr = todayKey()
  const allWorkouts = segments.flatMap(s=>s.workouts)
  const doneCount = allWorkouts.filter(w=>w.completed).length
  const totalCount = allWorkouts.length || 1
  const progress = Math.round((doneCount/totalCount)*100)

  // Persist + 12 AM reset
  useEffect(()=>{
    API.saveWorkout(segments)
  }, [segments])

  useEffect(()=>{
    localStorage.setItem('habitOS_diet', JSON.stringify(dietItems))
  }, [dietItems])

  useEffect(()=>{
    const interval = setInterval(()=>{
      const now = new Date()
      if (now.getHours()===0 && now.getMinutes()===0) {
        const hist = { date: dayKey(addDays(new Date(), -1)), done: doneCount, total: totalCount, progress }
        API.saveHistory(hist)
        // reset daily
        setSegments(prev=>prev.map(s=>({...s, workouts: s.workouts.map(w=>({...w, completed: false}))})))
      }
    }, 60000)
    return ()=>clearInterval(interval)
  }, [doneCount, totalCount])

  // Timer
  useEffect(()=>{
    if (activeWorkout) {
      timerRef.current = setInterval(()=>setTimer(t=>t+1), 1000)
    } else {
      clearInterval(timerRef.current)
      setTimer(0)
    }
    return ()=>clearInterval(timerRef.current)
  }, [activeWorkout])

  // Voice checkout hook
  useEffect(()=>{
    (window as any).habitWorkoutAPI = {
      checkout: (name: string) => {
        setSegments(prev=>prev.map(s=>({...s, workouts: s.workouts.map(w=> w.name.toLowerCase().includes(name.toLowerCase())? {...w, completed: true} : w)})))
        speakingModel.speak(`Checked out ${name}`)
      },
      trigger: (name: string) => {
        const w = allWorkouts.find(x=>x.name.toLowerCase().includes(name.toLowerCase()))
        if (w) setActiveWorkout(w)
      }
    }
  }, [allWorkouts])

  const handleMediaUpload = async (e: any, workoutId: string, segId: string) => {
    const file: File | undefined = e.target.files?.[0]
    if (!file) return
    const id = mediaId('wk')
    await putMedia(file, id)
    const type = file.type.startsWith('video') ? 'video' : 'image'
    setSegments(prev=>prev.map(s=> s.id===segId? {...s, workouts: s.workouts.map(w=> w.id===workoutId? {...w, mediaUrl: `media:${id}`, mediaType: type as any} : w)} : s))
  }

  const setSlot = (segId: string, wid: string, slot: 'primary' | 'secondary') =>
    setSegments(prev=>prev.map(s=> s.id===segId? {...s, workouts: s.workouts.map(w=> w.id===wid? {...w, slot} : w)} : s))

  const addSegment = () => {
    if (!newSegmentName.trim()) return
    setSegments(prev=>[...prev, { id: Date.now().toString(), name: newSegmentName.trim(), collapsed: false, workouts: [] }])
    setNewSegmentName('')
  }

  const addWorkoutToSeg = () => {
    if (!newWorkout.segId ||!newWorkout.name.trim()) return
    const w: Workout = { id: Date.now().toString(), name: newWorkout.name.trim(), reps: newWorkout.reps || 'new • custom', category: newWorkout.segId, completed: false, streak: '0d', group: newWorkout.segId }
    setSegments(prev=>prev.map(s=> s.id===newWorkout.segId? {...s, workouts: [...s.workouts, w]} : s))
    setNewWorkout({ segId: '', name: '', reps: '', slot: 'primary' })
  }

  const toggleComplete = (segId: string, wid: string) => {
    setSegments(prev=>prev.map(s=> s.id===segId? {...s, workouts: s.workouts.map(w=> w.id===wid? {...w, completed:!w.completed} : w)} : s))
  }

  const deleteWorkout = (segId: string, wid: string) => {
    setSegments(prev=>prev.map(s=> s.id===segId? {...s, workouts: s.workouts.filter(w=>w.id!==wid)} : s))
  }

  const checkoutAll = () => {
    setSegments(prev=>prev.map(s=>({...s, workouts: s.workouts.map(w=>({...w, completed: true}))})))
    speakingModel.speak('All workouts checked out, great job')
  }

  return (
    <div className="p-4 space-y-4 bg-[#0f0f12] min-h-full">
      {/* HEADER like screenshot */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Dumbbell className="w-4 h-4 text-orange-400" /> Workout • {doneCount}/{totalCount} done • {progress}%</h2>
          <div className="text-xs text-white/30 mt-1">Primary runs after prayers + affirmations. Secondary sets are nudged randomly between Start the day and End the day. Say “20 pushups” for the popup.</div>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setShowDiet(!showDiet)} className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs text-white/60 flex items-center gap-1"><Utensils className="w-3 h-3" /> {showDiet? 'Workout' : 'Diet'}</button>
          <button onClick={() => { setSkipTarget({ id: 'workout', name: 'Workout' }); setShowSkipConfirm(true) }} className={isSkipped? 'px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/20 text-xs text-amber-200' : 'px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs'}>{isSkipped? 'Skipped' : 'Skip workout today'}</button>
        </div>
      </div>

      {/* Progress bar daily */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-3">
        <div className="flex justify-between text-xs text-white/40 mb-2"><span>DAILY PROGRESS</span><span>{progress}% • {doneCount}/{totalCount}</span></div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-red-500" style={{ width: `${progress}%` }} /></div>
        <div className="mt-3 flex gap-2">
          <button onClick={checkoutAll} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Checkout all done</button>
          <div className="text-xs text-white/20 flex items-center gap-1"><Timer className="w-3 h-3" /> Active timer: {Math.floor(timer/60)}:{String(timer%60).padStart(2,'0')}</div>
        </div>
      </div>

      {/* Graphs orange dotted */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <OrangeDottedGraph data={[20,40,35,80,60,90,progress]} label="DAILY REPORT • ORANGE DOTTED • FROM DB" />
        <OrangeDottedGraph data={[50,65,70,55,80,85,75]} label="MONTHLY REPORT • ORANGE DOTTED • RESETS AT 12 AM" />
      </div>

      {!showDiet? (
        <>
          {/* Add segment */}
          <div className="flex gap-2 bg-[#141418] border border-white/10 rounded-xl p-2">
            <input value={newSegmentName} onChange={e=>setNewSegmentName(e.target.value)} onFocus={e=>e.stopPropagation()} placeholder="Add body segment - neck, forearms, biceps, triceps, chest, leg..." className="flex-1 px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-sm text-white placeholder:text-white/20 focus:outline-none" />
            <button onClick={addSegment} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Plus className="w-3 h-3" /> Add segment</button>
          </div>

          {/* Add workout inside segment selector */}
          <div className="flex gap-2 bg-[#0e0e12] border border-white/5 rounded-xl p-2">
            <select value={newWorkout.segId} onChange={e=>setNewWorkout({...newWorkout, segId: e.target.value})} className="px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white">
              <option value="">Select segment</option>
              {segments.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={newWorkout.name} onChange={e=>setNewWorkout({...newWorkout, name: e.target.value})} onFocus={e=>e.stopPropagation()} placeholder="Workout name - e.g. 20 pushups" className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20" />
            <input value={newWorkout.reps} onChange={e=>setNewWorkout({...newWorkout, reps: e.target.value})} onFocus={e=>e.stopPropagation()} placeholder="reps - e.g. 20 reps • chest" className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20" />
            <button onClick={()=>setNewWorkout({...newWorkout, slot: newWorkout.slot==='primary'?'secondary':'primary'})} className={`px-3 py-2 rounded-xl border text-xs ${newWorkout.slot==='primary'?'bg-orange-500/15 border-orange-500/25 text-orange-200':'bg-blue-500/15 border-blue-500/25 text-blue-200'}`}>{newWorkout.slot==='primary'?'Primary':'Secondary'}</button>
            <button onClick={addWorkoutToSeg} className="px-4 py-2 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 text-white text-xs font-semibold">Add workout</button>
          </div>

          {/* Segments collapsible like screenshot */}
          <div className="space-y-3">
            {segments.map(seg=>(
              <div key={seg.id} className="bg-[#141418] border border-white/10 rounded-xl p-3">
                <div className="flex justify-between items-center cursor-pointer" onClick={()=>setSegments(prev=>prev.map(s=>s.id===seg.id? {...s, collapsed:!s.collapsed} : s))}>
                  <div className="flex items-center gap-2"><div className="w-6 h-6 rounded-lg bg-orange-500/20 border border-orange-500/20 flex items-center justify-center"><Dumbbell className="w-3 h-3 text-orange-400" /></div><span className="text-sm font-semibold text-white capitalize">{seg.name}</span><span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">{seg.workouts.length}</span></div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e)=>{e.stopPropagation(); setSegments(prev=>prev.filter(s=>s.id!==seg.id))}} className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center"><Trash2 className="w-3 h-3 text-white/30" /></button>
                    {seg.collapsed? <ChevronDown className="w-4 h-4 text-white/30" /> : <ChevronUp className="w-4 h-4 text-white/30" />}
                  </div>
                </div>

                {!seg.collapsed && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {seg.workouts.length===0? <div className="text-xs text-white/20 col-span-2">No workouts - add from above. Click to add/delete</div> : seg.workouts.map(w=>(
                      <div key={w.id} className={`${w.completed? 'bg-green-500/10 border-green-500/20' : 'bg-[#0e0e12] border-white/5'} border rounded-xl p-3 flex items-center gap-3`}>
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center"><Dumbbell className="w-5 h-5 text-white" /></div>
                        <div className="flex-1">
                          <div className="text-sm text-white">{w.name}</div>
                          <div className="text-xs text-white/40 flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-orange-500/20 flex items-center justify-center">🔥</span> {w.reps}</div>
                          {w.mediaUrl && (
                            <div className="mt-2 w-full h-20 rounded-lg bg-black overflow-hidden">
                              {w.mediaType==='video'? <WMed src={w.mediaUrl} kind="video" className="w-full h-full object-cover" controls /> : <WMed src={w.mediaUrl} kind="image" className="w-full h-full object-cover" />}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center cursor-pointer">
                            <input type="file" accept="image/*,video/*" className="hidden" onChange={e=>handleMediaUpload(e,w.id,seg.id)} />
                            {w.mediaType==='video'? <Video className="w-4 h-4 text-white/40" /> : <ImageIcon className="w-4 h-4 text-white/40" />}
                          </label>
                          <button onClick={()=>setActiveWorkout(w)} className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center" title="Play session"><Play className="w-4 h-4 text-white/60" /></button>
                          <button onClick={()=>setSlot(seg.id, w.id, (w.slot||'primary')==='primary' ? 'secondary' : 'primary')} title={(w.slot||'primary')==='primary' ? 'Primary: runs once today after prayers + affirmations' : 'Secondary: nudged randomly through the day'} className={`px-2 h-8 rounded-xl border text-[10px] flex items-center gap-1 ${(w.slot||'primary')==='primary' ? 'bg-orange-500/15 border-orange-500/25 text-orange-200' : 'bg-blue-500/15 border-blue-500/25 text-blue-200'}`}>
                            {(w.slot||'primary')==='primary' ? <SunMedium className="w-3 h-3" /> : <Repeat className="w-3 h-3" />}
                            {(w.slot||'primary')==='primary' ? 'primary' : 'random'}
                          </button>
                          <button onClick={()=>toggleComplete(seg.id,w.id)} className={`w-8 h-8 rounded-xl flex items-center justify-center ${w.completed? 'bg-white text-black' : 'bg-white/5 border border-white/10'}`}><Check className="w-4 h-4" /></button>
                          <button onClick={()=>deleteWorkout(seg.id,w.id)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center"><Trash2 className="w-3 h-3 text-white/30" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Trigger popup demo like screenshot */}
          {activeWorkout && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center p-4">
              <div className="bg-[#141418] border border-white/10 rounded-2xl w-full max-w-md p-5">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2"><Dumbbell className="w-5 h-5 text-orange-400" /><span className="text-sm font-semibold text-white">{activeWorkout.name}</span></div>
                  <button onClick={()=>setActiveWorkout(null)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center"><X className="w-4 h-4 text-white/40" /></button>
                </div>
                <div className="w-full h-48 md:h-64 rounded-xl bg-[#0e0e12] border border-white/5 flex items-center justify-center overflow-hidden">
                  {activeWorkout.mediaUrl? (activeWorkout.mediaType==='video'? <WMed src={activeWorkout.mediaUrl} kind="video" autoPlay loop className="w-full h-full object-contain" /> : <WMed src={activeWorkout.mediaUrl} kind="image" className="w-full h-full object-contain" />) : <div className="text-xs text-white/20 px-4 text-center">No clip yet — upload a GIF/video for {activeWorkout.name}</div>}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-xs text-white/40 flex items-center gap-2"><Clock className="w-4 h-4" /> Timer {Math.floor(timer/60)}:{String(timer%60).padStart(2,'0')}</div>
                  <button onClick={()=>{toggleComplete(segments.find(s=>s.workouts.find(w=>w.id===activeWorkout.id))!.id, activeWorkout.id); setActiveWorkout(null)}} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Done • Checkout</button>
                </div>
                <div className="mt-3 text-xs text-white/20">Voice: "checkout {activeWorkout.name}" also works</div>
              </div>
            </div>
          )}

          {/* Injury report */}
          <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4 text-amber-400" /><div className="text-xs font-semibold tracking-widest text-white">INJURY REPORT • SKIP WORKOUT IF NEEDED</div></div>
            <div className="flex gap-2">
              <select value={injuryNote.body} onChange={e=>setInjuryNote({...injuryNote, body: e.target.value})} className="px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white">{segments.map(s=><option key={s.id}>{s.name}</option>)}</select>
              <input value={injuryNote.note} onChange={e=>setInjuryNote({...injuryNote, note: e.target.value})} onFocus={e=>e.stopPropagation()} placeholder="Note - e.g. shoulder pain, skip chest today" className="flex-1 px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white placeholder:text-white/20" />
              <button onClick={()=>{
                const inj: Injury = { id: Date.now().toString(), date: todayStr, body: injuryNote.body, note: injuryNote.note }
                setInjuries(prev=>[...prev, inj]); API.saveInjury(inj); setInjuryNote({ body: 'Chest', note: '' })
              }} className="px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/20 text-amber-200 text-xs">Report</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">{injuries.map(i=><span key={i.id} className="text-xs px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-200">{i.date} • {i.body} • {i.note}</span>)}</div>
          </div>
        </>
      ) : (
        /* DIET SWITCH */
        <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Utensils className="w-4 h-4 text-green-400" /><div className="text-xs font-semibold tracking-widest text-white">DIET • WHAT TO EAT + SUPPLEMENTS</div></div>
            <div className="text-xs text-white/20">backend: /api/diet • switches from workout</div>
          </div>
          <div className="flex gap-2 bg-[#0e0e12] border border-white/5 rounded-xl p-2 mb-3">
            <input type="time" value={newDiet.time} onChange={e=>setNewDiet({...newDiet, time: e.target.value})} className="px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white" />
            <input value={newDiet.food} onChange={e=>setNewDiet({...newDiet, food: e.target.value})} onFocus={e=>e.stopPropagation()} placeholder="What to eat - e.g. 100g chicken + rice" className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20" />
            <input value={newDiet.supplement} onChange={e=>setNewDiet({...newDiet, supplement: e.target.value})} onFocus={e=>e.stopPropagation()} placeholder="Supplement - whey, creatine" className="flex-1 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20" />
            <button onClick={()=>{
              if (!newDiet.food.trim()) return
              setDietItems(prev=>[...prev, { id: Date.now().toString(), time: newDiet.time, food: newDiet.food, supplement: newDiet.supplement }])
              setNewDiet({ time: '08:00', food: '', supplement: '' })
            }} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold">Add diet</button>
          </div>
          <div className="space-y-2">{dietItems.map(d=>(
            <div key={d.id} className="flex items-center gap-2 p-3 rounded-xl bg-[#0e0e12] border border-white/5">
              <div className="text-xs text-white/40">{d.time}</div>
              <div className="flex-1 text-sm text-white">{d.food}</div>
              <div className="text-xs px-2 py-1 rounded-full bg-green-500/20 border border-green-500/20 text-green-300">{d.supplement || 'no supp'}</div>
              <button onClick={()=>setDietItems(prev=>prev.filter(x=>x.id!==d.id))} className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center"><Trash2 className="w-3 h-3 text-white/30" /></button>
            </div>
          ))}</div>
        </div>
      )}

      {isSkipped && <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-200 flex items-center gap-1"><ZapOff className="w-3 h-3" /> Workout skipped today — gray in analytics, not failure</div>}
    </div>
  )
}