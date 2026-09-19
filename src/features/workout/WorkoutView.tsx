import { useEffect, useMemo, useState } from 'react'
import { Dumbbell, Play, Check, Plus, Trash2, Clock, Video, Image as ImageIcon, ChevronDown, ChevronUp, AlertTriangle, Utensils, X, Timer, Activity, SunMedium, Repeat, Smile, Hand, Flag, Sparkles } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { speakingModel } from '../../speaking/speakingModel'
import { putMedia, removeMedia, mediaId } from '../../lib/mediaStore'
import { useMediaUrl } from '../../lib/useMedia'
import { readSegments, writeSegments, readWorkoutRows, setWorkoutDone, workoutHistory, WORKOUT_KINDS, type WorkoutKind } from '../../lib/workoutData'
import { todayKey, dayKey, weekdayOf } from '../../lib/clock'
import { OrangeGraph, DietPanel, InjuryPanel } from './WorkoutPanels'

type Segment = { id: string; name: string; collapsed: boolean; workouts: any[] }

const KIND_ICON: Record<WorkoutKind, any> = { workout: Dumbbell, facial: Smile, massage: Hand }
const FREQ_CHOICES = [30, 45, 60, 90, 120, 180]

/**
 * Workout page.
 *  • nothing is pre-filled — the first row you add is the first row that exists
 *  • every row has a kind (strength/cardio, facial exercise, massage), a slot
 *    (primary = the morning full-stretch session, driven by the Morning order chain)
 *    and a priority
 *  • secondary rows repeat on *your* frequency (every 30 m … 3 h) between Start and End of day
 *  • graphs only draw logged days
 */
export default function WorkoutView({ onTriggerWorkout }: any) {
  const app = useApp() as any
  const { setShowSkipConfirm, setSkipTarget, skips, planItems = [], planDone = [], dayPhase, dayStartedAt } = app
  const isSkipped = (skips || []).some((k: any) => String(k.streakId).toLowerCase() === 'workout' && new Date() <= new Date(k.endDate))

  const [segments, setSegments] = useState<Segment[]>(() => readSegments())
  const [showDiet, setShowDiet] = useState(false)
  const [activeWorkout, setActiveWorkout] = useState<any | null>(null)
  const [timer, setTimer] = useState(0)
  const [newSegmentName, setNewSegmentName] = useState('')
  const [newWorkout, setNewWorkout] = useState({ segId: '', name: '', reps: '', kind: 'workout' as WorkoutKind, slot: 'primary' as 'primary' | 'secondary', priority: 'high' as 'high' | 'normal', everyMin: 90 })
  const [uploadFor, setUploadFor] = useState<string | null>(null)

  const rows = useMemo(() => readWorkoutRows(), [segments, dayKey()])
  const primary = rows.filter((r) => r.slot === 'primary')
  const secondary = rows.filter((r) => r.slot === 'secondary')
  const doneCount = rows.filter((r) => r.done).length
  const totalCount = rows.length
  const progress = totalCount ? Math.round((doneCount / totalCount) * 100) : 0
  const history = workoutHistory(7)
  const planTimes = new Map((planItems as any[]).filter((i) => i.kind === 'workout-primary' || i.kind === 'workout-secondary').map((i: any) => [String(i.id).split(':').slice(1, 2)[0], i.time]))
  const doneSet = new Set((planDone || []).map(String))

  useEffect(() => { writeSegments(segments) }, [segments])
  // re-arm the plan so a newly added / retagged session is scheduled immediately
  useEffect(() => { app.armPlanNow?.(); window.dispatchEvent(new CustomEvent('habit:plan-dirty')) }, [segments])

  useEffect(() => {
    if (!activeWorkout) return
    const iv = setInterval(() => setTimer((t) => t + 1), 1000)
    return () => clearInterval(iv)
  }, [activeWorkout])

  useEffect(() => {
    ;(window as any).habitWorkoutAPI = {
      checkout: (name: string) => {
        const hit = rows.find((w) => w.name.toLowerCase().includes(name.toLowerCase()))
        if (hit) { setWorkoutDone(hit.id, true); refresh() ; speakingModel.speak(`Checked ${hit.name}`) }
      },
      trigger: (name: string) => {
        const hit = rows.find((w) => w.name.toLowerCase().includes(name.toLowerCase()))
        if (hit) setActiveWorkout(hit)
      }
    }
  }, [rows])

  const refresh = () => setSegments([...readSegments()])

  const addSegment = () => {
    if (!newSegmentName.trim()) return
    setSegments((prev) => [...prev, { id: Date.now().toString(), name: newSegmentName.trim(), collapsed: false, workouts: [] }])
    setNewSegmentName('')
  }

  const addWorkout = () => {
    if (!newWorkout.segId || !newWorkout.name.trim()) return
    const seg = segments.find((s) => s.id === newWorkout.segId)
    if (!seg) return
    const row = {
      id: Date.now().toString(),
      name: newWorkout.name.trim(),
      reps: newWorkout.reps.trim() || (newWorkout.kind === 'facial' ? '5 min • face' : newWorkout.kind === 'massage' ? '10 min • mobility' : '1 set'),
      category: seg.name.toLowerCase(),
      group: seg.name.toLowerCase(),
      kind: newWorkout.kind,
      slot: newWorkout.slot,
      priority: newWorkout.priority,
      everyMin: newWorkout.slot === 'secondary' ? newWorkout.everyMin : 0,
      completed: false
    }
    seg.workouts.push(row)
    setSegments((prev) => prev.map((s) => (s.id === seg.id ? { ...s, workouts: [...s.workouts, row] } : s)))
    setNewWorkout({ ...newWorkout, name: '', reps: '' })
    speakingModel.speak(`${row.name} added as ${row.slot === 'primary' ? 'a morning session' : 'a quick set every ' + row.everyMin + ' minutes'}.`)
  }

  const patchWorkout = (segId: string, wid: string, patch: any) => {
    setSegments((prev) => prev.map((s) => (s.id !== segId ? s : { ...s, workouts: (s.workouts || []).map((w: any) => (String(w.id) === wid ? { ...w, ...patch } : w)) })))
  }

  const toggleComplete = (segId: string, wid: string) => {
    const row = rows.find((r) => r.id === wid)
    const next = !(row?.done)
    setWorkoutDone(wid, next)
    patchWorkout(segId, wid, { completed: next })
    if (next) {
      const planHit = (planItems as any[]).find((i: any) => String(i.id).includes(wid))
      if (planHit && !doneSet.has(planHit.id)) app.markPlanItem?.(planHit.id, true)
      speakingModel.speak('Logged.')
    }
  }

  const removeWorkout = (segId: string, wid: string) => {
    const row = segments.find((s) => s.id === segId)?.workouts?.find((w: any) => String(w.id) === wid)
    if (row?.mediaUrl) removeMedia(row.mediaUrl)
    setSegments((prev) => prev.map((s) => (s.id !== segId ? s : { ...s, workouts: (s.workouts || []).filter((w: any) => String(w.id) !== wid) })))
  }

  return (
    <div className="p-3 md:p-4 space-y-4 bg-[#0f0f12] min-h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Dumbbell className="w-4 h-4 text-orange-400" /> Workout • {doneCount}/{totalCount} done • {progress}%</h2>
          <div className="text-[11px] text-white/30 mt-1">
            {dayPhase === 'active' ? `Day live since ${dayStartedAt ? new Date(dayStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}` : 'Start the day to arm reminders'} •
            primary sessions are prompted in the morning block, quick sets repeat on their own frequency
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowDiet(!showDiet)} className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs text-white/60 flex items-center gap-1"><Utensils className="w-3 h-3" /> {showDiet ? 'Training' : 'Diet'}</button>
          <button onClick={() => { setSkipTarget({ id: 'workout', name: 'Workout' }); setShowSkipConfirm(true) }} className={isSkipped ? 'px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/20 text-xs text-amber-200' : 'px-3 py-1.5 rounded-full bg-white/10 text-white/60 text-xs'}>{isSkipped ? 'Skipped' : 'Skip today'}</button>
        </div>
      </div>

      {/* ---------------- the queue for today, in priority order ---------------- */}
      <div className="bg-[#141418] border border-white/10 rounded-xl p-3">
        <div className="flex justify-between text-xs text-white/40 mb-2"><span>TODAY&apos;S QUEUE • {weekdayOf()} • sorted by priority</span><span>{progress}%</span></div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all duration-300" style={{ width: `${progress}%` }} /></div>
        {rows.length === 0 ? (
          <div className="mt-3 text-[11px] text-white/30">Nothing added yet. Add a segment and a row below — facial exercises and massages count the same way as lifts.</div>
        ) : (
          <div className="mt-3 space-y-1">
            {[...primary.sort(byPriority), ...secondary.sort(byPriority)].slice(0, 6).map((r) => (
              <button key={r.id} onClick={() => { const seg = segments.find((s) => s.workouts?.some((w: any) => String(w.id) === r.id)); if (seg) toggleComplete(seg.id, r.id) }}
                className="w-full flex items-center gap-2 text-[12px] min-w-0 rounded-lg hover:bg-white/5 px-1 py-1 text-left">
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${r.done ? 'bg-green-500 border-green-500' : 'border-white/20'}`}>{r.done && <Check className="w-2.5 h-2.5 text-black" />}</span>
                <span className={`truncate flex-1 ${r.done ? 'text-white/35 line-through' : 'text-white/80'}`}>{r.name}</span>
                <span className="text-[10px] text-white/25 shrink-0">{planTimes.get(r.id) || (r.slot === 'secondary' ? `every ${r.everyMin}m` : 'morning')}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${r.slot === 'primary' ? 'bg-orange-500/15 text-orange-200' : 'bg-blue-500/15 text-blue-200'}`}>{r.slot === 'primary' ? 'primary' : 'quick set'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!showDiet ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <OrangeGraph data={history.map((h) => h.pct)} label="DAILY REPORT • LOGGED DAYS ONLY" empty={history.every((h) => !h.total) ? 'add workouts to see a curve' : ''} />
            <OrangeGraph data={history.map((h, i) => (history.slice(0, i + 1).reduce((a, b) => a + b.done, 0)))} label="CUMULATIVE SETS DONE • REAL COUNT" empty={history.every((h) => !h.done) ? 'no sets logged yet' : ''} />
          </div>

          {/* add segment */}
          <div className="flex gap-2 flex-wrap bg-[#141418] border border-white/10 rounded-xl p-2">
            <input value={newSegmentName} onChange={(e) => setNewSegmentName(e.target.value)} onFocus={(e) => e.stopPropagation()} placeholder="Add group — chest, legs, face, neck, mobility..." className="flex-1 min-w-40 px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-sm text-white placeholder:text-white/20 focus:outline-none" />
            <button onClick={addSegment} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Plus className="w-3 h-3" /> Add group</button>
          </div>

          {/* add workout */}
          <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-2 space-y-2">
            <div className="flex gap-2 flex-wrap">
              <select value={newWorkout.segId} onChange={(e) => setNewWorkout({ ...newWorkout, segId: e.target.value })} className="px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white">
                <option value="">Select group</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input value={newWorkout.name} onChange={(e) => setNewWorkout({ ...newWorkout, name: e.target.value })} onFocus={(e) => e.stopPropagation()} placeholder="Name — 20 pushups, jaw release, neck massage" className="flex-1 min-w-40 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20" />
              <input value={newWorkout.reps} onChange={(e) => setNewWorkout({ ...newWorkout, reps: e.target.value })} onFocus={(e) => e.stopPropagation()} placeholder="reps / duration" className="w-36 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20" />
              <button onClick={addWorkout} className="px-4 py-2 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 text-white text-xs font-semibold">Add</button>
            </div>
            <div className="flex gap-2 flex-wrap items-center text-xs">
              {WORKOUT_KINDS.map((k) => {
                const Icon = KIND_ICON[k.id]
                return <button key={k.id} onClick={() => setNewWorkout({ ...newWorkout, kind: k.id })} className={`px-2.5 py-1.5 rounded-full border flex items-center gap-1 ${newWorkout.kind === k.id ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/45'}`}><Icon className="w-3 h-3" /> {k.label}</button>
              })}
              <span className="w-2" />
              <button onClick={() => setNewWorkout({ ...newWorkout, slot: newWorkout.slot === 'primary' ? 'secondary' : 'primary' })} className={`px-2.5 py-1.5 rounded-full border flex items-center gap-1 ${newWorkout.slot === 'primary' ? 'bg-orange-500/15 border-orange-500/25 text-orange-200' : 'bg-blue-500/15 border-blue-500/25 text-blue-200'}`}>
                {newWorkout.slot === 'primary' ? <SunMedium className="w-3 h-3" /> : <Repeat className="w-3 h-3" />} {newWorkout.slot === 'primary' ? 'primary (morning)' : 'quick set (repeating)'}
              </button>
              <button onClick={() => setNewWorkout({ ...newWorkout, priority: newWorkout.priority === 'high' ? 'normal' : 'high' })} className={`px-2.5 py-1.5 rounded-full border flex items-center gap-1 ${newWorkout.priority === 'high' ? 'bg-amber-500/15 border-amber-500/25 text-amber-200' : 'bg-white/5 border-white/10 text-white/45'}`}><Flag className="w-3 h-3" /> {newWorkout.priority === 'high' ? 'High priority' : 'Normal priority'}</button>
              {newWorkout.slot === 'secondary' && (
                <span className="flex items-center gap-1 text-[11px] text-white/40">every
                  <select value={newWorkout.everyMin} onChange={(e) => setNewWorkout({ ...newWorkout, everyMin: Number(e.target.value) })} className="px-2 py-1 rounded-lg bg-[#141418] border border-white/10 text-[11px] text-white">
                    {FREQ_CHOICES.map((f) => <option key={f} value={f}>{f < 60 ? `${f} min` : `${f / 60} h`}</option>)}
                  </select>
                </span>
              )}
            </div>
          </div>

          {/* groups */}
          {segments.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
              <Sparkles className="w-5 h-5 text-white/20 mx-auto mb-2" />
              <div className="text-[12px] text-white/40">No groups yet.</div>
              <div className="text-[11px] text-white/25 mt-1">Add a group (chest, legs, face, neck, mobility), then add rows and pick primary or quick set — the reminder plan updates the moment you do.</div>
            </div>
          )}
          <div className="space-y-3">
            {segments.map((seg) => (
              <div key={seg.id} className="bg-[#141418] border border-white/10 rounded-xl p-3">
                <div className="flex justify-between items-center cursor-pointer gap-2" onClick={() => setSegments((prev) => prev.map((s) => (s.id === seg.id ? { ...s, collapsed: !s.collapsed } : s)))}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-lg bg-orange-500/20 border border-orange-500/20 flex items-center justify-center shrink-0"><Dumbbell className="w-3 h-3 text-orange-400" /></div>
                    <span className="text-sm font-semibold text-white capitalize truncate">{seg.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 shrink-0">{(seg.workouts || []).length}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete group ${seg.name}?`)) setSegments((prev) => prev.filter((s) => s.id !== seg.id)) }} className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center"><Trash2 className="w-3 h-3 text-white/30" /></button>
                    {seg.collapsed ? <ChevronDown className="w-4 h-4 text-white/30" /> : <ChevronUp className="w-4 h-4 text-white/30" />}
                  </div>
                </div>

                {!seg.collapsed && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(seg.workouts || []).length === 0 && <div className="text-[11px] text-white/25 col-span-2">Empty group — add a row above.</div>}
                    {(seg.workouts || []).map((w: any) => (
                      <div key={w.id} className={`${w.completed ? 'bg-green-500/10 border-green-500/20' : 'bg-[#0e0e12] border-white/5'} border rounded-xl p-3 flex gap-3`} data-wid={w.id}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${(w.kind || 'workout') === 'facial' ? 'bg-fuchsia-500/15' : (w.kind || 'workout') === 'massage' ? 'bg-teal-500/15' : 'bg-gradient-to-br from-orange-500 to-red-500'}`}>
                          {(() => { const Icon = KIND_ICON[(w.kind || 'workout') as WorkoutKind] || Dumbbell; return <Icon className="w-4 h-4 text-white" /> })()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-white truncate">{w.name}</div>
                          <div className="text-[11px] text-white/40 truncate">{w.reps}</div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            <button onClick={() => patchWorkout(seg.id, w.id, { slot: (w.slot || 'primary') === 'primary' ? 'secondary' : 'primary' })} className={`px-1.5 py-0.5 rounded text-[10px] border ${(w.slot || 'primary') === 'primary' ? 'bg-orange-500/15 border-orange-500/25 text-orange-200' : 'bg-blue-500/15 border-blue-500/25 text-blue-200'}`}>{(w.slot || 'primary') === 'primary' ? 'primary' : 'quick set'}</button>
                            <button onClick={() => patchWorkout(seg.id, w.id, { priority: w.priority === 'high' ? 'normal' : 'high' })} className={`px-1.5 py-0.5 rounded text-[10px] border ${w.priority === 'high' ? 'bg-amber-500/15 border-amber-500/25 text-amber-200' : 'bg-white/5 border-white/10 text-white/40'}`}>{w.priority === 'high' ? 'high' : 'normal'}</button>
                            {(w.slot || 'primary') === 'secondary' && (
                              <select value={Number(w.everyMin) || 90} onChange={(e) => patchWorkout(seg.id, w.id, { everyMin: Number(e.target.value) })} className="px-1 py-0.5 rounded text-[10px] bg-[#141418] border border-white/10 text-white/60">
                                {FREQ_CHOICES.map((f) => <option key={f} value={f}>every {f < 60 ? f + 'm' : f / 60 + 'h'}</option>)}
                              </select>
                            )}
                            <select value={w.kind || 'workout'} onChange={(e) => patchWorkout(seg.id, w.id, { kind: e.target.value })} className="px-1 py-0.5 rounded text-[10px] bg-[#141418] border border-white/10 text-white/55">
                              {WORKOUT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                            </select>
                            {planTimes.get(String(w.id)) && <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-white/35 tabular-nums">{planTimes.get(String(w.id))}</span>}
                          </div>
                          {w.mediaUrl && <RowMedia src={w.mediaUrl} kind={w.mediaType === 'video' ? 'video' : 'image'} />}
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <label className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center cursor-pointer" title="Attach clip or photo">
                            <input type="file" accept="image/*,video/*" className="hidden" onChange={async (e) => {
                              const f: File | undefined = (e.target as any).files?.[0]
                              if (!f) return
                              const id = mediaId('wk')
                              await putMedia(f, id)
                              patchWorkout(seg.id, w.id, { mediaUrl: `media:${id}`, mediaType: f.type.startsWith('video') ? 'video' : 'image' })
                            }} />
                            {w.mediaType === 'video' ? <Video className="w-3.5 h-3.5 text-white/40" /> : <ImageIcon className="w-3.5 h-3.5 text-white/40" />}
                          </label>
                          <button onClick={() => setActiveWorkout({ ...w, segment: seg.name })} className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center" title="Open"><Play className="w-3.5 h-3.5 text-white/60" /></button>
                          <button onClick={() => toggleComplete(seg.id, w.id)} className={`w-7 h-7 rounded-lg flex items-center justify-center ${w.completed ? 'bg-white text-black' : 'bg-white/5 border border-white/10'}`} title="Done today"><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => removeWorkout(seg.id, w.id)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center" title="Delete"><Trash2 className="w-3 h-3 text-white/30" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <InjuryPanel segments={segments} />
        </>
      ) : (
        <DietPanel />
      )}

      {isSkipped && <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-200 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Workout skipped today — grey in the report, not a failure</div>}

      {/* single-session popup */}
      {activeWorkout && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setActiveWorkout(null)}>
          <div className="w-full max-w-md bg-[#141418] border border-white/10 rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center gap-2 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Dumbbell className="w-4 h-4 text-orange-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{activeWorkout.name}</div>
                  <div className="text-[11px] text-white/40">{activeWorkout.reps} • {activeWorkout.slot || 'primary'} {activeWorkout.slot === 'secondary' ? `• every ${activeWorkout.everyMin || 90}m` : '• morning block'}</div>
                </div>
              </div>
              <button onClick={() => setActiveWorkout(null)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center shrink-0"><X className="w-4 h-4 text-white/40" /></button>
            </div>
            <div className="w-full h-48 md:h-60 rounded-xl bg-[#0e0e12] border border-white/5 flex items-center justify-center overflow-hidden">
              {activeWorkout.mediaUrl ? <RowMedia src={activeWorkout.mediaUrl} kind={activeWorkout.mediaType === 'video' ? 'video' : 'image'} big /> : <div className="text-[11px] text-white/25 px-6 text-center">No clip attached — add one on this row for a form guide.</div>}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="text-[11px] font-mono text-white/50 flex items-center gap-1"><Timer className="w-3 h-3" /> {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</div>
              <div className="flex-1" />
              <button onClick={() => onTriggerWorkout?.()} className="px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-[11px] text-white/55">another</button>
              <button onClick={() => { const seg = segments.find((s) => s.workouts?.some((w: any) => String(w.id) === activeWorkout.id)); if (seg) toggleComplete(seg.id, activeWorkout.id); setActiveWorkout(null) }} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Done today</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function byPriority(a: any, b: any) {
    const p = (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
    if (p) return p
    return String(a.name).localeCompare(String(b.name))
  }
}

function RowMedia({ src, kind, big }: { src: string; kind: 'video' | 'image'; big?: boolean }) {
  const url = useMediaUrl(src)
  if (!url) return null
  return (
    <div className={`mt-2 rounded-lg bg-black overflow-hidden flex items-center justify-center ${big ? 'w-full h-full' : 'w-full h-20'}`}>
      {kind === 'video' ? <video src={url} className="w-full h-full object-contain" controls autoPlay loop muted playsInline /> : <img src={url} className="w-full h-full object-contain" alt="" />}
    </div>
  )
}
