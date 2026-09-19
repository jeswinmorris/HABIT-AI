import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Utensils, Plus, Trash2, Dumbbell } from 'lucide-react'
import { speakingModel } from '../../speaking/speakingModel'
import { dayKey, todayKey, WEEKDAYS, weekdayOf } from '../../lib/clock'

/**
 * Real-data graph: one point per logged day. No point, no line — an
 * "empty" message rather than a made-up curve.
 */
export function OrangeGraph({ data, label, empty }: { data: number[]; label: string; empty?: string }) {
  const w = 320, h = 80, pad = 20
  const has = data.length > 0 && data.some((v) => v > 0)
  const max = Math.max(...data, 100)
  const pts = data.map((v, i) => ({ x: pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2), y: h - pad - (v / max) * (h - pad * 2), v }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3">
      <div className="text-[11px] text-white/30 mb-2 flex items-center gap-1"><Activity className="w-3 h-3 text-orange-400" /> <span className="truncate">{label}</span></div>
      {has ? (
        <>
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24">
            <path d={path} fill="none" stroke="#f97316" strokeWidth="2" strokeDasharray="4 4" />
            {pts.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="4" fill="#f97316" stroke="#0e0e12" strokeWidth="2" /><text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="8" fill="#fff" opacity="0.45">{Math.round(p.v)}</text></g>)}
          </svg>
          <div className="flex justify-between text-[10px] text-white/20 mt-1">{WEEKDAYS.map((d) => <span key={d}>{d[0]}</span>)}</div>
        </>
      ) : (
        <div className="h-24 flex items-center justify-center text-[11px] text-white/25 border border-dashed border-white/10 rounded-xl">{empty || 'no logged days yet'}</div>
      )}
    </div>
  )
}

type Injury = { id: string; date: string; body: string; note: string }

/** Injury notes decide whether a session is skipped today. */
export function InjuryPanel({ segments }: { segments: any[] }) {
  const today = todayKey()
  const [injuries, setInjuries] = useState<Injury[]>(() => { try { return JSON.parse(localStorage.getItem('habitOS_injury') || '[]') } catch { return [] } })
  const [injuryNote, setInjuryNote] = useState({ body: '', note: '' })

  useEffect(() => { localStorage.setItem('habitOS_injury', JSON.stringify(injuries)) }, [injuries])

  const opts: string[] = []
  segments.forEach((s: any) => {
    if (s.name && !opts.includes(s.name)) opts.push(s.name)
    ;(s.workouts || []).forEach((w: any) => {
      const c = w.category || w.group
      if (c && !opts.includes(c)) opts.push(c)
    })
  })

  return (
    <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4 text-amber-400" /><div className="text-xs font-semibold tracking-widest text-white">INJURY REPORT • SKIP A SESSION IF NEEDED</div></div>
      <div className="flex gap-2 flex-wrap">
        <select value={injuryNote.body || opts[0] || ''} onChange={(e) => setInjuryNote({ ...injuryNote, body: e.target.value })} className="px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white shrink-0">
          {opts.length ? opts.map((o) => <option key={o}>{o}</option>) : <option>body part</option>}
        </select>
        <input value={injuryNote.note} onChange={(e) => setInjuryNote({ ...injuryNote, note: e.target.value })} onFocus={(e) => e.stopPropagation()} placeholder="Note — shoulder pain, skip chest today" className="flex-1 min-w-40 px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-xs text-white placeholder:text-white/20" />
        <button onClick={() => {
          if (!injuryNote.note.trim()) return
          const inj: Injury = { id: Date.now().toString(), date: today, body: injuryNote.body || opts[0] || 'general', note: injuryNote.note.trim() }
          setInjuries((prev) => [...prev, inj])
          setInjuryNote({ body: '', note: '' })
          speakingModel.speak(`Noted. ${inj.body} rests today.`)
        }} className="px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/20 text-amber-200 text-xs">Note it</button>
      </div>
      {injuries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {injuries.slice(-8).map((i) => (
            <span key={i.id} className={`text-[11px] px-2 py-1 rounded-full border flex items-center gap-1 ${i.date === today ? 'bg-amber-500/15 border-amber-500/25 text-amber-200' : 'bg-white/5 border-white/10 text-white/30'}`}>
              {i.date} • {i.body} • {i.note}
              <button onClick={() => setInjuries((prev) => prev.filter((x) => x.id !== i.id))} className="text-white/30"><Trash2 className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

type DietItem = { id: string; time: string; food: string; supplement: string; date: string }

export function DietPanel() {
  const today = todayKey()
  const [dietItems, setDietItems] = useState<DietItem[]>(() => { try { const raw = JSON.parse(localStorage.getItem('habitOS_diet') || '[]'); return Array.isArray(raw) ? raw : [] } catch { return [] } })
  const [newDiet, setNewDiet] = useState({ time: '08:00', food: '', supplement: '' })

  useEffect(() => { localStorage.setItem('habitOS_diet', JSON.stringify(dietItems)) }, [dietItems])

  return (
    <div className="bg-[#141418] border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2"><Utensils className="w-4 h-4 text-green-400" /><div className="text-xs font-semibold tracking-widest text-white">DIET • FOOD + SUPPLEMENTS</div></div>
        <div className="text-[11px] text-white/25">{dietItems.filter((d) => d.date === today).length} logged today</div>
      </div>
      <div className="flex gap-2 flex-wrap bg-[#0e0e12] border border-white/5 rounded-xl p-2 mb-3">
        <input type="time" value={newDiet.time} onChange={(e) => setNewDiet({ ...newDiet, time: e.target.value })} className="px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white shrink-0" />
        <input value={newDiet.food} onChange={(e) => setNewDiet({ ...newDiet, food: e.target.value })} onFocus={(e) => e.stopPropagation()} placeholder="What to eat — 100g chicken + rice" className="flex-1 min-w-40 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20" />
        <input value={newDiet.supplement} onChange={(e) => setNewDiet({ ...newDiet, supplement: e.target.value })} onFocus={(e) => e.stopPropagation()} placeholder="Supplement — whey, creatine" className="flex-1 min-w-32 px-3 py-2 rounded-xl bg-[#141418] border border-white/10 text-xs text-white placeholder:text-white/20" />
        <button onClick={() => {
          if (!newDiet.food.trim()) return
          setDietItems((prev) => [...prev, { id: Date.now().toString(), time: newDiet.time, food: newDiet.food.trim(), supplement: newDiet.supplement.trim(), date: today }])
          setNewDiet({ time: '08:00', food: '', supplement: '' })
        }} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
      </div>
      {dietItems.length === 0 ? <div className="text-[11px] text-white/25">Nothing logged.</div> : (
        <div className="space-y-2">
          {[...dietItems].reverse().slice(0, 20).map((d) => (
            <div key={d.id} className="flex items-center gap-2 p-3 rounded-xl bg-[#0e0e12] border border-white/5 min-w-0">
              <div className="text-[11px] text-white/40 w-12 shrink-0 tabular-nums">{d.time}</div>
              <div className="flex-1 text-[13px] text-white truncate">{d.food}</div>
              {d.supplement && <div className="text-[11px] px-2 py-1 rounded-full bg-green-500/20 border border-green-500/20 text-green-300 shrink-0">{d.supplement}</div>}
              <button onClick={() => setDietItems((prev) => prev.filter((x) => x.id !== d.id))} className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center shrink-0"><Trash2 className="w-3 h-3 text-white/30" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
