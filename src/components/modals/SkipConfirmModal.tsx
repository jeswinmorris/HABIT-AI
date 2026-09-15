import { useState } from 'react'
import { X, Calendar, Clock } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { dayController } from '../../core/dayController'

export default function SkipConfirmModal() {
  const { showSkipConfirm, setShowSkipConfirm, skipTarget, setSkips, setSkippedFeatures, skips } = useApp() as any
  const [days, setDays] = useState(skipTarget?.voice?.days || 3)
  const [customDays, setCustomDays] = useState('')
  const [reason, setReason] = useState(skipTarget?.voice?.reason || 'Rest')
  const [customReason, setCustomReason] = useState('')

  if (!showSkipConfirm) return null

  const handleConfirm = () => {
    const finalDays = customDays? parseInt(customDays) : days
    const finalReason = reason === 'Custom'? customReason : reason
    const streakId = skipTarget?.streakId || skipTarget?.id || 'general'

    const skip = dayController.createSkip(streakId, finalDays, finalReason)
    const extraSkips: any[] = []
    if (streakId === 'all' || streakId === 'Everything' || streakId === 'everything') {
      const names = ['water', 'workout', 'sleep', ...(dayController.readSteaks().map((x: any) => String(x.id)))]
      for (const n of names) if (n !== streakId) extraSkips.push(dayController.createSkip(n, finalDays, finalReason))
    }
    setSkips((prev: any) => [...(prev || []), skip, ...extraSkips])
    setSkippedFeatures((prev: any) => [...new Set([...(prev || []), streakId.toLowerCase(), ...extraSkips.map((x) => String(x.streakId).toLowerCase())])])

    // Save to localStorage immediately
    try {
      const current = JSON.parse(localStorage.getItem('habitOS_v4_final') || '{}')
      current.skips = [...(current.skips || []), skip, ...extraSkips]
      localStorage.setItem('habitOS_v4_final', JSON.stringify(current))
    } catch {}

    setShowSkipConfirm(false)
    setCustomDays('')
    setCustomReason('')
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#141418] border border-white/10 rounded-xl w-full max-w-sm p-5">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/20 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-sm font-semibold text-white">Skip {skipTarget?.name || 'Habit'}</div>
          </div>
          <button onClick={() => setShowSkipConfirm(false)} className="w-8 h-8 rounded-xl bg-[#0e0e12] border border-white/10 flex items-center justify-center">
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs tracking-widest text-white/40 mb-2">HOW MANY DAYS?</div>
            <div className="grid grid-cols-4 gap-2">
              {[1,2,3,7,14,30].map(d => (
                <button
                  key={d}
                  onClick={() => { setDays(d); setCustomDays('') }}
                  className={`py-2 rounded-xl border text-xs font-semibold ${days === d &&!customDays? 'bg-white text-black border-white' : 'bg-[#0e0e12] border-white/10 text-white/60'}`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <input
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              placeholder="Custom days"
              type="number"
              className="mt-2 w-full px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500/50"
            />
          </div>

          <div>
            <div className="text-xs tracking-widest text-white/40 mb-2">REASON</div>
            <div className="grid grid-cols-2 gap-2">
              {['Travel','Sick','Rest','Custom'].map(r => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`py-2 rounded-xl border text-xs ${reason === r? 'bg-white text-black border-white' : 'bg-[#0e0e12] border-white/10 text-white/60'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === 'Custom' && (
              <input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Enter reason"
                className="mt-2 w-full px-3 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-sm text-white placeholder:text-white/20"
              />
            )}
          </div>

          <div className="bg-[#0e0e12] border border-white/5 rounded-xl p-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-white/20" />
            <div className="text-xs text-white/30">Active skips: {skips?.length || 0} • Shows gray in Analytics, not red • Unlimited</div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setShowSkipConfirm(false)} className="flex-1 py-2.5 rounded-xl bg-[#0e0e12] border border-white/10 text-xs font-semibold text-white/60">Cancel</button>
            <button onClick={handleConfirm} className="flex-1 py-2.5 rounded-xl bg-white text-black text-xs font-semibold">Skip {customDays || days} Days</button>
          </div>
        </div>
      </div>
    </div>
  )
}