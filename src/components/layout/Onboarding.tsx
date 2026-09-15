import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, Mic, PlayCircle, Sparkles, Trash2, Volume2, X } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { putMedia, mediaId } from '../../lib/mediaStore'
import { requestNotifyPermission } from '../../lib/db'
import { engineStatus, onStatus, type SttEngine } from '../../core/voiceEngine'
import { WEEKDAYS, type Weekday } from '../../lib/clock'

/**
 * First-run setup. Permissions come first (mic + notifications), then the questions.
 * Your name, what to call the AI and the wake word are mandatory — everything else can be
 * skipped. Old demo/seeded rows can be wiped here so the database starts clean.
 */
export default function Onboarding() {
  const app = useApp() as any
  const { completeOnboarding, enableMic, aiName, userName, wakeWord: wakeWordProp } = app
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    userName: userName || '',
    // intentionally blank on a first run: the three names must be *typed*, not silently defaulted
    aiName: app.onboarded ? aiName || 'Habi' : (aiName === 'Habi' ? '' : aiName || ''),
    wakeWord: app.onboarded ? (wakeWordProp || 'hey habi').toLowerCase() : (wakeWordProp === 'hey habi' ? '' : wakeWordProp || ''),
    alarmTime: app.alarmTime || '06:00',
    bedtime: app.bedtime || '22:00',
    voiceGender: app.voiceGender || 'female',
    alwaysOnMic: true,
    wakeMusic: true,
    affirmPlayout: true,
    secondaryNudges: true,
    activeDays: [...WEEKDAYS] as Weekday[]
  })
  const [tracks, setTracks] = useState<any[]>([])
  const [wipe, setWipe] = useState(true)
  const [micState, setMicState] = useState(app.micPermission || 'prompt')
  const [stt, setStt] = useState<SttEngine>(engineStatus().stt)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const off = onStatus((s: any) => setStt(s.stt))
    return () => { off() }
  }, [])

  const mandatoryOk = !!form.userName.trim() && !!form.aiName.trim() && !!form.wakeWord.trim()
  const steps = ['Permissions', 'Identity', 'Rhythm', 'Audio', 'Database']
  const progress = useMemo(() => Math.round(((step + 1) / steps.length) * 100), [step, steps.length])

  const addFiles = async (files: File[]) => {
    const out: any[] = []
    for (const f of files) {
      const id = mediaId('trk')
      await putMedia(f, id)
      out.push({ id, name: f.name, url: `media:${id}` })
    }
    setTracks((p) => [...p, ...out])
  }

  const finish = (skipped: boolean) => {
    completeOnboarding({
      userName: skipped ? form.userName.trim() || 'Friend' : form.userName.trim(),
      aiName: form.aiName.trim() || 'Habi',
      wakeWord: form.wakeWord.trim() || 'hey habi',
      alarmTime: form.alarmTime,
      bedtime: form.bedtime,
      voiceGender: form.voiceGender,
      alwaysOnMic: form.alwaysOnMic,
      wakeMusic: form.wakeMusic,
      affirmPlayout: form.affirmPlayout,
      secondaryNudges: form.secondaryNudges,
      activeDays: form.activeDays,
      micPermission: micState === 'granted' ? 'granted' : 'prompt'
    })
    if (tracks.length) app.addPlaylistTracks?.(tracks)
  }

  const next = () => setStep((s) => Math.min(steps.length - 1, s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="fixed inset-0 z-[200] bg-[#07070a] overflow-y-auto">
      <div className="min-h-full w-full flex items-start md:items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-3xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></div>
            <div>
              <div className="text-sm font-semibold text-white">HABIT.AI • first-time setup</div>
              <div className="text-[11px] text-white/35">Answers go straight into your database. You can skip everything except the three names.</div>
            </div>
            <div className="ml-auto text-[11px] text-white/30 tabular-nums">{progress}%</div>
          </div>
          <div className="h-1 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: progress + '%' }} /></div>

          <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 md:p-7 space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-xs tracking-[0.18em] text-white/40">STEP {step + 1} / {steps.length} • {steps[step].toUpperCase()}</div>
              {step > 0 && <button onClick={back} className="text-[11px] text-white/40 flex items-center gap-1"><ChevronLeft className="w-3 h-3" /> back</button>}
            </div>

            {step === 0 && (
              <div className="space-y-4">
                <div className="text-[13px] text-white/60">Voice OS runs on your microphone and system notifications. Nothing is stored off-device.</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={async () => { const ok = await enableMic(); setMicState(ok ? 'granted' : 'blocked') }}
                    className={`rounded-xl border p-4 text-left flex items-center gap-3 ${micState === 'granted' ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-[#0e0e12] border-white/10'}`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">{micState === 'granted' ? <Check className="w-4 h-4 text-emerald-300" /> : <Mic className="w-4 h-4 text-white/60" />}</div>
                    <div>
                      <div className="text-[13px] text-white">{micState === 'granted' ? 'Microphone allowed' : 'Enable microphone'}</div>
                      <div className="text-[11px] text-white/35">{micState === 'granted' ? 'you can talk to it' : 'tap to grant access'}</div>
                    </div>
                  </button>
                  <button
                    onClick={async () => { await requestNotifyPermission() }}
                    className="rounded-xl border p-4 text-left flex items-center gap-3 bg-[#0e0e12] border-white/10"
                  >
                    <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center"><Volume2 className="w-4 h-4 text-white/60" /></div>
                    <div>
                      <div className="text-[13px] text-white">Allow notifications</div>
                      <div className="text-[11px] text-white/35">alarms + day nudges outside the window</div>
                    </div>
                  </button>
                </div>
                <div className="text-[11px] text-white/30">Speech engine detected: <span className={stt === 'vosk' ? 'text-emerald-300' : 'text-amber-200'}>{stt}</span> — if it says error/loading, run <span className="text-white/50">npm run model</span> once.</div>
                <PrimaryBtn onClick={() => (micState === 'granted' ? next() : next())} label="Continue" />
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div className="text-[13px] text-white/60">The three mandatory answers. These are what the AI uses in every sentence it says.</div>
                <Field label="What should I call you?" value={form.userName} onChange={(v: string) => setForm({ ...form, userName: v })} placeholder="e.g. Jeswin" required />
                <Field label="Name of the AI" value={form.aiName} onChange={(v: string) => setForm({ ...form, aiName: v })} placeholder="e.g. Habi" required />
                <Field label="Wake word / phrase" value={form.wakeWord} onChange={(v: string) => setForm({ ...form, wakeWord: v.toLowerCase() })} placeholder="e.g. hey habi" required hint="2–3 words works best" />
                {!mandatoryOk && <div className="text-[11px] text-amber-200/80">All three are required — this is the minimum for the voice OS to speak to you.</div>}
                <PrimaryBtn onClick={next} label="Continue" disabled={!mandatoryOk} />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Alarm (wake-up)" type="time" value={form.alarmTime} onChange={(v: string) => setForm({ ...form, alarmTime: v })} />
                  <Field label="Bedtime (closes the day)" type="time" value={form.bedtime} onChange={(v: string) => setForm({ ...form, bedtime: v })} />
                </div>
                <div>
                  <div className="text-[11px] text-white/40 mb-2">Days you train (primary workout + steaks apply on these days)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((d) => {
                      const on = form.activeDays.includes(d)
                      return <button key={d} onClick={() => setForm({ ...form, activeDays: on ? form.activeDays.filter((x) => x !== d) : [...form.activeDays, d] })} className={`px-3 py-1.5 rounded-full text-xs border ${on ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/45'}`}>{d}</button>
                    })}
                  </div>
                </div>
                <div className="flex gap-2">
                  {(['female', 'male'] as const).map((g) => (
                    <button key={g} onClick={() => setForm({ ...form, voiceGender: g })} className={`flex-1 py-2 rounded-xl text-xs capitalize ${form.voiceGender === g ? 'bg-white text-black' : 'bg-white/10 text-white/50'}`}>{g} voice</button>
                  ))}
                </div>
                <PrimaryBtn onClick={next} label="Continue" />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="text-[13px] text-white/60">Morning music plays right after the wake-up briefing. Add your playlist now or later in Settings.</div>
                <input ref={fileRef} type="file" accept="audio/*" multiple className="hidden" onChange={(e) => addFiles(Array.from(e.target.files || []))} />
                <button onClick={() => fileRef.current?.click()} className="w-full py-3 rounded-xl bg-[#0e0e12] border border-dashed border-white/15 text-xs text-white/50">Choose audio files (multiple allowed)</button>
                {tracks.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {tracks.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-[12px] text-white/60 bg-[#0e0e12] border border-white/5 rounded-lg px-3 py-1.5">
                        <PlayCircle className="w-3.5 h-3.5 text-violet-300" />
                        <span className="truncate flex-1">{t.name}</span>
                        <button onClick={() => setTracks((p) => p.filter((x) => x.id !== t.id))} className="text-white/30"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <Toggle label="Play the playlist after I stop the alarm" value={form.wakeMusic} onChange={(v: boolean) => setForm({ ...form, wakeMusic: v })} />
                  <Toggle label="Always-on mic with wake word" value={form.alwaysOnMic} onChange={(v: boolean) => setForm({ ...form, alwaysOnMic: v })} />
                  <Toggle label="Random affirmation audio mid-day" value={form.affirmPlayout} onChange={(v: boolean) => setForm({ ...form, affirmPlayout: v })} />
                  <Toggle label="Random secondary workout sets (push-up reminders)" value={form.secondaryNudges} onChange={(v: boolean) => setForm({ ...form, secondaryNudges: v })} />
                </div>
                <PrimaryBtn onClick={next} label="Continue" />
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div className="text-[13px] text-white/60">Your database is where steaks, tasks, logs and settings live.</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {[
                    ['Steaks', (app.steaks || []).length],
                    ['Tasks', (app.tasks || []).length],
                    ['Projects', (app.projects || []).length],
                    ['Logs', (app.dailyLogs || []).length]
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
                    <span className="text-[11px] text-white/40 block mt-0.5">Wipes steaks, tasks, logs, skips and pauses so today’s data is only what you create from now on. Your settings and playlist are kept.</span>
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { if (wipe) app.resetHabitData?.(); finish(false) }} className="flex-1 min-w-40 px-5 py-3 rounded-xl bg-white text-black text-sm font-semibold">Finish setup</button>
                  <button onClick={() => { if (wipe) app.resetHabitData?.(); finish(true) }} className="px-4 py-3 rounded-xl bg-[#0e0e12] border border-white/10 text-white/50 text-xs">Skip the rest</button>
                </div>
              </div>
            )}
          </div>

          {!mandatoryOk && <div className="text-[11px] text-white/25 px-1">Setup can be skipped after the three mandatory names above.</div>}
        </div>
      </div>
    </div>
  )
}

function PrimaryBtn({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`w-full py-3 rounded-xl text-sm font-semibold ${disabled ? 'bg-white/10 text-white/30' : 'bg-gradient-to-r from-violet-500 to-blue-500 text-white'}`}>{label}</button>
  )
}
function Field({ label, value, onChange, placeholder, type = 'text', required, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] text-white/40 mb-1.5">{label}{required && <span className="text-violet-300"> *</span>}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.stopPropagation()}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full h-11 px-3 rounded-xl bg-[#0e0e12] border border-white/10 text-sm text-white outline-none focus:border-violet-500/40"
      />
      {hint && <div className="text-[10px] text-white/25 mt-1">{hint}</div>}
    </div>
  )
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="w-full flex items-center justify-between gap-3 rounded-xl bg-[#0e0e12] border border-white/10 px-4 py-2.5 text-left">
      <span className="text-[12px] text-white/70">{label}</span>
      <span className={`w-10 h-6 rounded-full relative shrink-0 transition ${value ? 'bg-violet-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${value ? 'left-5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
