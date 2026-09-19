import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, Mic, Sparkles, Trash2, Volume2, CalendarDays } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { requestNotifyPermission } from '../../lib/db'
import { engineStatus, onStatus, setWakeWord, type SttEngine } from '../../core/voiceEngine'
import { WEEKDAYS, type Weekday, dateLabel, clockNow } from '../../lib/clock'

/**
 * First-run setup, kept deliberately short:
 *   1. permissions (mic + notifications) — nothing voice related works without them
 *   2. the two names that matter: what to call you, and what to call the AI
 *      (the wake word is derived: "hey <AI name>" — no separate step)
 *   3. voice: male or female, and which weekdays you train
 *   4. database: start from zero
 * The date and time come from the computer; there is nothing to set.
 * Steps 2 and 3 can be skipped, but the two names are required before it will close.
 */
export default function Onboarding() {
  const app = useApp() as any
  const { completeOnboarding, enableMic, aiName, userName, micPermission } = app
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    userName: userName || '',
    aiName: app.onboarded ? (aiName || 'Habi') : (aiName === 'Habi' ? '' : aiName || ''),
    voiceGender: app.voiceGender || 'female',
    activeDays: (app.activeDays?.length ? app.activeDays : WEEKDAYS) as Weekday[],
    alwaysOnMic: true,
    wakeMusic: true,
    affirmPlayout: true,
    secondaryNudges: true
  })
  const [wipe, setWipe] = useState(true)
  const [micState, setMicState] = useState(micPermission || 'prompt')
  const [stt, setStt] = useState<SttEngine>(engineStatus().stt)

  useEffect(() => { const off = onStatus((s: any) => setStt(s.stt)); return () => { off() } }, [])
  useEffect(() => { setMicState(micPermission) }, [micPermission])

  const steps = ['Permissions', 'Names', 'Voice & days', 'Database']
  const mandatoryOk = !!form.userName.trim() && !!form.aiName.trim()
  const progress = useMemo(() => Math.round(((step + 1) / steps.length) * 100), [step, steps.length])
  const derivedWake = `hey ${form.aiName.trim().toLowerCase() || 'habi'}`

  const finish = (skipped: boolean) => {
    const name = form.aiName.trim() || (skipped ? 'Habi' : '')
    completeOnboarding({
      userName: form.userName.trim() || (skipped ? 'there' : ''),
      aiName: name || 'Habi',
      wakeWord: `hey ${(name || 'habi').toLowerCase()}`,
      voiceGender: form.voiceGender,
      alwaysOnMic: form.alwaysOnMic,
      wakeMusic: form.wakeMusic,
      affirmPlayout: form.affirmPlayout,
      secondaryNudges: form.secondaryNudges,
      activeDays: form.activeDays,
      micPermission: micState === 'granted' ? 'granted' : 'prompt'
    })
    setWakeWord(derivedWake)
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[#07070a] overflow-y-auto">
      <div className="min-h-full w-full flex items-start md:items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-2xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-white" /></div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">HABIT.AI • first-time setup</div>
              <div className="text-[11px] text-white/35 truncate">{dateLabel()} • {clockNow()} • {Intl.DateTimeFormat().resolvedOptions().timeZone || 'system clock'}</div>
            </div>
            <div className="ml-auto text-[11px] text-white/30 tabular-nums shrink-0">{progress}%</div>
          </div>
          <div className="h-1 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: progress + '%' }} /></div>

          <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-6 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs tracking-[0.18em] text-white/40 truncate">STEP {step + 1} / {steps.length} • {steps[step].toUpperCase()}</div>
              {step > 0 && <button onClick={() => setStep((s) => Math.max(0, s - 1))} className="text-[11px] text-white/40 flex items-center gap-1 shrink-0"><ChevronLeft className="w-3 h-3" /> back</button>}
            </div>

            {/* ---------------------------- 1. permissions ---------------------------- */}
            {step === 0 && (
              <div className="space-y-4">
                <p className="text-[13px] text-white/60">Voice mode needs your microphone and system notifications so reminders reach you when the window is hidden. Nothing leaves the device.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={async () => { const ok = await enableMic(); setMicState(ok ? 'granted' : 'blocked') }}
                    className={`rounded-xl border p-4 text-left flex items-center gap-3 ${micState === 'granted' ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-[#0e0e12] border-white/10'}`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">{micState === 'granted' ? <Check className="w-4 h-4 text-emerald-300" /> : <Mic className="w-4 h-4 text-white/60" />}</div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-white">{micState === 'granted' ? 'Microphone allowed' : 'Enable microphone'}</div>
                      <div className="text-[11px] text-white/35 truncate">speech engine: {stt}</div>
                    </div>
                  </button>
                  <button onClick={() => requestNotifyPermission()} className="rounded-xl border p-4 text-left flex items-center gap-3 bg-[#0e0e12] border-white/10">
                    <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0"><Volume2 className="w-4 h-4 text-white/60" /></div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-white">Allow notifications</div>
                      <div className="text-[11px] text-white/35">reminders arrive outside the window</div>
                    </div>
                  </button>
                </div>
                {stt === 'error' && (
                  <div className="text-[11px] text-amber-200/80 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                    Offline model not installed — voice falls back to the system engine. Run <span className="text-white/70">npm run model</span> once for offline recognition.
                  </div>
                )}
                <PrimaryBtn onClick={() => next()} label="Continue" />
              </div>
            )}

            {/* ------------------------------ 2. names ------------------------------- */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-[13px] text-white/60">Both are required — every sentence the AI says uses them.</p>
                <Field label="What should I call you?" value={form.userName} onChange={(v: string) => setForm({ ...form, userName: v })} placeholder="e.g. Jeswin" required />
                <Field label="Name of the AI" value={form.aiName} onChange={(v: string) => setForm({ ...form, aiName: v })} placeholder="e.g. Habi" required />
                <div className="text-[11px] text-white/30 flex items-center gap-2">
                  <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/50">{derivedWake}</span>
                  wake word, derived from the AI name
                </div>
                {!mandatoryOk && <div className="text-[11px] text-amber-200/80">Fill both names to continue.</div>}
                <PrimaryBtn onClick={() => next()} label="Continue" disabled={!mandatoryOk} />
              </div>
            )}

            {/* --------------------------- 3. voice & days --------------------------- */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <div className="text-[11px] text-white/40 mb-2">Voice</div>
                  <div className="flex gap-2">
                    {(['female', 'male'] as const).map((g) => (
                      <button key={g} onClick={() => setForm({ ...form, voiceGender: g })} className={`flex-1 py-2.5 rounded-xl text-xs capitalize ${form.voiceGender === g ? 'bg-white text-black font-semibold' : 'bg-white/5 border border-white/10 text-white/50'}`}>{g}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-white/40 mb-2 flex items-center gap-1.5"><CalendarDays className="w-3 h-3" /> Training days — workout reminders only land on these</div>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((d) => {
                      const on = form.activeDays.includes(d)
                      return <button key={d} onClick={() => setForm({ ...form, activeDays: on ? form.activeDays.filter((x) => x !== d) : [...form.activeDays, d] })} className={`px-3 py-1.5 rounded-full text-xs border ${on ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/45'}`}>{d}</button>
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Toggle label="Always-on mic with the wake word" value={form.alwaysOnMic} onChange={(v: boolean) => setForm({ ...form, alwaysOnMic: v })} hint="off = only the mic button listens" />
                </div>
                <PrimaryBtn onClick={() => next()} label="Continue" />
              </div>
            )}

            {/* ----------------------------- 4. database ----------------------------- */}
            {step === 3 && (
              <div className="space-y-4">
                <p className="text-[13px] text-white/60">Everything starts at zero — no demo steaks, tasks, workouts, prayer slides or graphs.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {[
                    ['Steaks', (app.steaks || []).length],
                    ['Tasks', (app.tasks || []).length],
                    ['Projects', (app.projects || []).length],
                    ['Workouts', countWorkouts()]
                  ].map(([l, n]: any) => (
                    <div key={l} className="rounded-xl bg-[#0e0e12] border border-white/5 py-3">
                      <div className="text-lg font-semibold text-white">{n}</div>
                      <div className="text-[10px] tracking-widest text-white/30">{l.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
                <label className="flex items-start gap-3 rounded-xl bg-[#0e0e12] border border-white/10 p-3 cursor-pointer">
                  <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} className="mt-0.5 accent-violet-500" />
                  <span>
                    <span className="text-[13px] text-white flex items-center gap-1"><Trash2 className="w-3.5 h-3.5 text-red-300" /> Start clean</span>
                    <span className="text-[11px] text-white/40 block mt-0.5">Clears steaks, tasks, logs, steaks, workout rows, ritual slides and water history. Names, voice and playlist are kept.</span>
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { if (wipe) app.resetHabitData?.(); finish(false) }} className="flex-1 min-w-40 px-5 py-3 rounded-xl bg-white text-black text-sm font-semibold">Finish setup</button>
                  <button onClick={() => { if (wipe) app.resetHabitData?.(); finish(true) }} className="px-4 py-3 rounded-xl bg-[#0e0e12] border border-white/10 text-white/50 text-xs">Finish with defaults</button>
                </div>
              </div>
            )}
          </div>

          <div className="text-[11px] text-white/25 px-1">
            {mandatoryOk || step > 1
              ? 'Alarm time and bedtime are set later in Settings — the day plan uses the computer clock.'
              : 'The two names are the only mandatory answers.'}
          </div>
        </div>
      </div>
    </div>
  )

  function next() { setStep((s) => Math.min(steps.length - 1, s + 1)) }
}

function countWorkouts(): number {
  try {
    const segs = JSON.parse(localStorage.getItem('habitOS_workoutSegments') || '[]')
    return Array.isArray(segs) ? segs.reduce((a: number, s: any) => a + ((s.workouts || []).length), 0) : 0
  } catch { return 0 }
}

function PrimaryBtn({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`w-full py-3 rounded-xl text-sm font-semibold ${disabled ? 'bg-white/10 text-white/30' : 'bg-gradient-to-r from-violet-500 to-blue-500 text-white'}`}>{label}</button>
  )
}
function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-white/40 mb-1.5">{label}{required && <span className="text-violet-300"> *</span>}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.stopPropagation()}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full h-11 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-sm text-white outline-none focus:border-violet-500/40"
      />
    </div>
  )
}
function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button onClick={() => onChange(!value)} className="w-full flex items-center justify-between gap-3 rounded-xl bg-[#0e0e12] border border-white/10 px-4 py-2.5 text-left">
      <span className="min-w-0"><span className="text-[12px] text-white/70 block truncate">{label}</span>{hint && <span className="text-[10px] text-white/30">{hint}</span>}</span>
      <span className={`w-10 h-6 rounded-full relative shrink-0 transition ${value ? 'bg-violet-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${value ? 'left-5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
