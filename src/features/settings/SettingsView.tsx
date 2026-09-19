import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { Settings, Mic, User, Volume2, Download, Upload, Waves, Sliders, Activity, Zap, Check, Music, Shuffle, Repeat, Repeat1, Play, Pause, SkipForward, SkipBack, Sparkles, Sunrise, ListMusic, Trash2, Brain, X, BellRing, Eraser } from 'lucide-react'
import { personality } from '../../speaking/personality'
import { dbInfo, collectAll, importDB } from '../../lib/db'
import { saveJsonBackup, pickJsonBackup, isDesktop, setBackgroundMode, reminderStatus, testNotification, platformName } from '../../lib/desktop'
import { cleanAllHabitData } from '../../lib/migrate'
import * as voiceEngine from '../../core/voiceEngine'
import { playlist } from '../../core/playlist'
import { putMedia, removeMedia, mediaId } from '../../lib/mediaStore'
import { WEEKDAYS, systemClock, onClock } from '../../lib/clock'

function CustomSlider({ value, min, max, step, onChange, label }: any) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">{label}</span>
        <span className="text-xs text-white/60 font-mono">{Number(value).toFixed(step < 1 ? 1 : 0)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-[#0e0e12] border border-white/5 overflow-hidden">
        <div className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500" style={{ width: `${pct}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow pointer-events-none" style={{ left: `calc(${pct}% - 6px)` }} />
      </div>
    </div>
  )
}

function Toggle({ label, value, onChange, hint }: any) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#141418] border border-white/5">
      <div className="min-w-0">
        <div className="text-xs text-white/60 truncate">{label}</div>
        {hint && <div className="text-[10px] text-white/25 mt-0.5">{hint}</div>}
      </div>
      <button onClick={() => onChange(!value)} className={`w-10 h-6 rounded-full relative shrink-0 transition ${value ? 'bg-violet-500' : 'bg-white/10 border border-white/10'}`}>
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${value ? 'left-5' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

function InteractiveSineWaves({ level }: { level: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let anim = 0
    let t = 0
    const draw = () => {
      t += 0.02
      const w = canvas.width = canvas.offsetWidth * 2
      const h = canvas.height = canvas.offsetHeight * 2
      ctx.clearRect(0, 0, w, h)
      const amp = 8 + level * 0.4
      ;[{ color: '#8b5cf6', freq: 0.015, offset: 0 }, { color: '#3b82f6', freq: 0.022, offset: 1.5 }].forEach((wv) => {
        ctx.beginPath()
        ctx.strokeStyle = wv.color
        ctx.lineWidth = 2
        for (let x = 0; x < w; x++) {
          const y = h / 2 + Math.sin(x * wv.freq + t + wv.offset) * amp
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      })
      anim = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(anim)
  }, [level])
  return <canvas ref={ref as any} className="w-full h-16 rounded-xl bg-[#141418] border border-white/5" />
}

const toast = (msg: string) => { try { (window as any).__habitAssistant?.(msg) } catch {} }

const MODES: { id: any; label: string; icon: any }[] = [
  { id: 'sequential', label: 'In order', icon: ListMusic },
  { id: 'shuffle', label: 'Shuffle', icon: Shuffle },
  { id: 'repeat-all', label: 'Repeat all', icon: Repeat },
  { id: 'repeat-one', label: 'Repeat one', icon: Repeat1 }
]

export default function SettingsView(props: any) {
  const { speakTest, stopSpeak } = props
  const app = useApp() as any
  const {
    alwaysOnMic, setAlwaysOnMic, wakeWord, setWakeWord, voiceAsleep, wakeVoice, sleepVoice,
    micSensitivity, setMicSensitivity, micLevel, voiceGender, setVoiceGender, pitch, setPitch,
    speed, setSpeed, volume, setVolume, speechVoices, selectedVoiceURI, setSelectedVoiceURI,
    isListening, micPermission, enableMic, dayPaused, setActiveTab,
    playlistTracks = [], addPlaylistTracks, removePlaylistTrack, playlistMode, setPlaylistMode,
    playlistVolume, playlistPlay, playlistPause, playingPlaylist, wakeMusic, setPrefs,
    affirmPlayout, secondaryNudges, activeDays, affirmGapMin, setGlobalMuted, globalMuted, voicePendingRecap, recapEveryMin, reminderGapMin, voiceWaterSips,
    aiName, userName, setAiName, setUserName, resetHabitData, restartOnboarding,
    alarmTime, bedtime, alarmEnabled, backgroundMode, setVoiceMuted, playlistVolume: pv
  } = app

  const [dbinfo, setDbinfo] = useState<any>(null)
  const [sys, setSys] = useState(() => systemClock())
  const [alertInfo, setAlertInfo] = useState<any>({ supported: false, pending: 0, backgroundMode: true })
  const [stt, setStt] = useState<any>(voiceEngine.engineStatus())
  const [ttsEngine, setTtsEngine] = useState('checking…')
  const [animLevel, setAnimLevel] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { dbInfo().then(setDbinfo) }, [])
  useEffect(() => onClock((d) => setSys(systemClock(d))), [])
  useEffect(() => { reminderStatus().then((s: any) => setAlertInfo({ supported: !!s?.supported, pending: s?.pending || 0, backgroundMode: !!s?.backgroundMode })) }, [])
  useEffect(() => {
    const off = voiceEngine.onStatus((s: any) => { setStt(s); if (s?.tts) setTtsEngine(s.tts === 'piper' ? 'Piper (natural)' : s.tts === 'loading' ? 'Loading voice…' : 'WebSpeech fallback') })
    const offProgress = voiceEngine.onTtsProgress(() => { /* status already carries the percentage */ })
    return () => { off(); offProgress() }
  }, [])
  useEffect(() => {
    voiceEngine.preloadTTS().then(() => setTtsEngine(voiceEngine.isPiperReady() ? 'Piper (natural)' : 'WebSpeech fallback'))
      .catch(() => setTtsEngine('WebSpeech fallback'))
  }, [])
  useEffect(() => {
    const iv = setInterval(() => setAnimLevel((prev: number) => prev + ((micLevel || 0) - prev) * 0.2), 50)
    return () => clearInterval(iv)
  }, [micLevel])

  const addTracks = async (files: File[]) => {
    const out: any[] = []
    for (const f of files) {
      const id = mediaId('trk')
      await putMedia(f, id)
      out.push({ id, name: f.name.replace(/\.[^.]+$/, ''), url: `media:${id}` })
    }
    addPlaylistTracks(out)
    toast(`${out.length} track(s) added to your morning playlist`)
  }

  const dropTrack = async (t: any) => {
    await removeMedia(t.url)
    removePlaylistTrack(t.id)
  }

  return (
    <div className="p-3 md:p-6 space-y-4 bg-[#0f0f12] min-h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold text-white flex items-center gap-2"><Settings className="w-5 h-5 text-violet-400" /> Settings</h2>
        <div className="text-xs text-white/20 flex items-center gap-2">
          <span className={stt.stt === 'vosk' ? 'text-emerald-400' : 'text-amber-200'}>STT: {stt.stt}</span>
          <span className="text-white/15">•</span>
          <span className={ttsEngine.startsWith('Piper') ? 'text-emerald-400' : 'text-white/30'}>{ttsEngine}</span>
        </div>
      </div>

      {/* ---------------- Visualizer + mic ---------------- */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="text-sm font-medium text-white flex items-center gap-2"><Waves className="w-4 h-4 text-emerald-400" /> Voice • mic level</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10">
              <span className={`w-1.5 h-1.5 rounded-full ${micPermission === 'granted' ? 'bg-emerald-500' : micPermission === 'blocked' ? 'bg-red-500' : 'bg-white/30'}`} />
              <span className={micPermission === 'granted' ? 'text-emerald-300' : micPermission === 'blocked' ? 'text-red-300' : 'text-white/30'}>{micPermission === 'granted' ? 'MIC READY' : micPermission === 'blocked' ? 'MIC BLOCKED' : 'MIC PROMPT'}</span>
            </div>
            {micPermission !== 'granted' && <button onClick={async () => { const ok = await enableMic(); toast(ok ? 'Microphone enabled' : 'Microphone blocked') }} className="px-2.5 py-1 rounded-full bg-white text-black text-xs font-semibold">Enable mic</button>}
            <div className={isListening ? 'px-2 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-xs text-red-200 animate-pulse' : 'px-2 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/30'}>{isListening ? '● LISTENING' : 'Idle'}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-[#0e0e12] border border-white/5 flex flex-col items-center justify-center gap-4">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center transition-all duration-100" style={{ transform: `scale(${1 + animLevel / 200})`, boxShadow: `0 0 ${20 + animLevel / 2}px rgba(124,58,237,${0.3 + animLevel / 300})` }}>
              <Mic className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <div className="text-xs text-white/60">{voiceAsleep ? 'Ear asleep — wake it below' : alwaysOnMic ? 'Always-On + wake word' : 'Push-to-talk'}</div>
              <div className="text-xs text-white/20 mt-1">Level {Math.round(animLevel)}% • Sens {micSensitivity}%</div>
            </div>
            <InteractiveSineWaves level={animLevel} />
          </div>

          <div className="p-4 rounded-xl bg-[#0e0e12] border border-white/5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-[#141418] border border-white/5">
                <div className="text-xs text-white/40 mb-2">Wake word</div>
                <input
                  value={wakeWord}
                  onChange={(e) => setWakeWord(e.target.value)}
                  onBlur={() => { voiceEngine.setWakeWord(wakeWord); toast(`Wake word: ${wakeWord}`) }}
                  type="text" autoComplete="off"
                  className="w-full h-9 px-3 rounded-lg bg-[#0e0e12] border border-white/10 text-xs text-white outline-none focus:border-violet-500/30"
                />
              </div>
              <div className="p-3 rounded-xl bg-[#141418] border border-white/5"><CustomSlider value={micSensitivity} min={0} max={100} step={1} label="Sensitivity" onChange={setMicSensitivity} /></div>
            </div>
            <Toggle label="Always-on mic (wake word armed)" value={alwaysOnMic} onChange={setAlwaysOnMic} hint="off = only the mic button listens" />
            <Toggle label={voiceAsleep ? 'Wake the voice up' : 'Put the voice to sleep'} value={!voiceAsleep} onChange={(v: boolean) => (v ? wakeVoice() : sleepVoice())} hint='“mute it” / “go to sleep” puts it to sleep; flip this to hear again' />
            <Toggle label="Global audio" value={!globalMuted} onChange={(v: boolean) => setGlobalMuted(!v)} hint="music, video and affirmations • say “mute”" />
            <div className="text-[10px] text-white/25 leading-relaxed px-1">{stt.detail}</div>
          </div>
        </div>
      </div>

      {/* ---------------- Identity ---------------- */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5">
        <div className="text-sm font-medium text-white mb-4 flex items-center gap-2"><User className="w-4 h-4 text-amber-300" /> Identity</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-[#0e0e12] border border-white/5 space-y-2">
            <div className="text-xs text-white/40">Your name</div>
            <div className="flex gap-2">
              <input defaultValue={userName || personality.getUserName()} onChange={(e) => setUserName(e.target.value)} className="flex-1 h-9 px-3 rounded-xl bg-[#141418] border border-white/10 text-xs text-white outline-none" />
              <button onClick={() => { speakTest?.(`Got it ${userName}`) }} className="px-4 h-9 rounded-xl bg-white text-black text-xs font-semibold">Test</button>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[#0e0e12] border border-white/5 space-y-2">
            <div className="text-xs text-white/40">AI name</div>
            <div className="flex gap-2">
              <input defaultValue={aiName} onChange={(e) => setAiName(e.target.value)} className="flex-1 h-9 px-3 rounded-xl bg-[#141418] border border-white/10 text-xs text-white outline-none" />
              <button onClick={() => speakTest?.()} className="px-4 h-9 rounded-xl bg-white text-black text-xs font-semibold">Test</button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- day boundaries + OS reminders ---------------- */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-medium text-white flex items-center gap-2"><Sunrise className="w-4 h-4 text-amber-300" /> Day boundaries &amp; reminders</div>
          <div className="text-[10px] text-white/25">{sys.dateLabel} • {sys.time24} • {sys.timeZone} • {platformName()}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-[#0e0e12] border border-white/5">
            <div className="text-[11px] text-white/40 mb-1.5">Wake alarm</div>
            <input type="time" value={alarmTime} onChange={(e) => setPrefs({ alarmTime: e.target.value })} className="w-full h-9 px-2 rounded-lg bg-[#141418] border border-white/10 text-xs text-white" />
            <div className="text-[10px] text-white/25 mt-1.5">rings the full-screen alarm; snooze or close it</div>
          </div>
          <div className="p-3 rounded-xl bg-[#0e0e12] border border-white/5">
            <div className="text-[11px] text-white/40 mb-1.5">Bedtime (closes the day)</div>
            <input type="time" value={bedtime} onChange={(e) => setPrefs({ bedtime: e.target.value })} className="w-full h-9 px-2 rounded-lg bg-[#141418] border border-white/10 text-xs text-white" />
            <div className="text-[10px] text-white/25 mt-1.5">midpoint of start→bedtime is the workout deadline</div>
          </div>
          <div className="p-3 rounded-xl bg-[#0e0e12] border border-white/5 space-y-2">
            <Toggle label="Wake alarm on" value={alarmEnabled !== false} onChange={(v: boolean) => setPrefs({ alarmEnabled: v })} hint="off = start the day manually" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-[#0e0e12] border border-white/5 space-y-2">
            <Toggle label="Keep running when I close the window" value={backgroundMode !== false} onChange={async (v: boolean) => { const ok = await setBackgroundMode(v); setPrefs({ backgroundMode: v || ok }) }} hint={isDesktop() ? 'Windows: tray • macOS: menu bar. Reminders keep arriving.' : 'Only in the desktop app — browser mode uses page timers.'} />
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[10px] text-white/25">{alertInfo.supported ? `OS notifications available • ${alertInfo.pending} armed` : 'OS notifications not permitted'}</span>
              <button onClick={() => testNotification('HABIT.AI — test', 'If you can see this, reminders will reach you outside the window.')} className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-white/60 text-[11px]">Send test</button>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[#0e0e12] border border-white/5 space-y-2">
            <Toggle label="Say what is still pending today" value={voicePendingRecap !== false} onChange={(v: boolean) => setPrefs({ voicePendingRecap: v })} hint="every reminder ends with the open list; also say “what is pending”" />
            <CustomSlider value={recapEveryMin || 30} min={10} max={120} step={5} label="Standing recap interval (min)" onChange={(v: number) => setPrefs({ recapEveryMin: Math.round(v) })} />
            <CustomSlider value={reminderGapMin || 25} min={5} max={120} step={5} label="Minimum gap between any two reminders (min)" onChange={(v: number) => setPrefs({ reminderGapMin: Math.round(v) })} />
            <Toggle label="Speak each water sip" value={voiceWaterSips !== false} onChange={(v: boolean) => setPrefs({ voiceWaterSips: v })} hint="off keeps sips on the pending list only — no voice, no toast" />
            <div className="text-[10px] text-white/25 leading-relaxed">Nothing is ever marked done by the clock passing. Overdue items stay listed as pending and are labelled “running late”.</div>
            <div className="text-[11px] text-white/40 mt-1">The AI speaks only for</div>
            <div className="text-[11px] text-white/55 leading-relaxed">reminders, what is still pending, the day opening or closing and the wake alarm.<div className="text-white/25 mt-1">Navigation and switches stay silent — written to the command bar. Affirmations appear on screen and are never spoken.</div></div>
          </div>
        </div>
      </div>

      {/* ---------------- Morning playlist ---------------- */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-medium text-white flex items-center gap-2"><Music className="w-4 h-4 text-emerald-300" /> Morning playlist</div>
          <div className="text-[11px] text-white/25">plays right after the wake-up briefing</div>
        </div>

        <input ref={fileRef} type="file" accept="audio/*" multiple className="hidden" onChange={(e) => addTracks(Array.from(e.target.files || []))} />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileRef.current?.click()} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1"><Download className="w-3.5 h-3.5 rotate-180" /> Add tracks</button>
          <button onClick={() => (playingPlaylist ? playlistPause() : playlistPlay())} className="px-4 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-white/70 text-xs flex items-center gap-1">
            {playingPlaylist ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} {playingPlaylist ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => playlist.prev()} className="w-9 h-9 rounded-xl bg-[#0e0e12] border border-white/10 flex items-center justify-center text-white/60"><SkipBack className="w-3.5 h-3.5" /></button>
          <button onClick={() => playlist.next()} className="w-9 h-9 rounded-xl bg-[#0e0e12] border border-white/10 flex items-center justify-center text-white/60"><SkipForward className="w-3.5 h-3.5" /></button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => setPlaylistMode(m.id)} className={`px-3 py-1.5 rounded-full text-xs border flex items-center gap-1.5 ${playlistMode === m.id ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/45'}`}>
              <m.icon className="w-3 h-3" /> {m.label}
            </button>
          ))}
        </div>

        <CustomSlider value={playlistVolume} min={0} max={1} step={0.05} label="Playlist volume" onChange={(v: number) => setPrefs({ playlistVolume: v })} />

        <Toggle label="Auto-play after I close the alarm" value={wakeMusic} onChange={(v: boolean) => app.setPrefs?.({ wakeMusic: v })} />

        {playlistTracks.length === 0 ? (
          <div className="text-xs text-white/25 py-3 text-center rounded-xl bg-[#0e0e12] border border-white/5">No tracks yet. They are stored on-device and survive restarts.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {playlistTracks.map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-[#0e0e12] border border-white/5">
                <Music className="w-3.5 h-3.5 text-white/25 shrink-0" />
                <span className="flex-1 text-xs text-white/60 truncate">{t.name}</span>
                <button onClick={() => dropTrack(t)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0"><X className="w-3.5 h-3.5 text-white/30" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------- Mid-day playouts ---------------- */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5 space-y-3">
        <div className="text-sm font-medium text-white flex items-center gap-2"><Sparkles className="w-4 h-4 text-fuchsia-300" /> During the day (never while paused or asleep)</div>
        <Toggle label="Random affirmation audio" value={affirmPlayout} onChange={(v: boolean) => app.setPrefs?.({ affirmPlayout: v })} hint="plays mid-day when nothing else is running" />
        <div className="p-3 rounded-xl bg-[#141418] border border-white/5"><CustomSlider value={affirmGapMin || 60} min={20} max={180} step={10} label="Minimum gap between affirmations (min)" onChange={(v: number) => app.setPrefs?.({ affirmGapMin: Math.round(v) })} /></div>
        <Toggle label="Random secondary workout sets" value={secondaryNudges} onChange={(v: boolean) => app.setPrefs?.({ secondaryNudges: v })} hint='e.g. “give me 20 pushups” — sessions flagged Secondary in Workout' />
        <div>
          <div className="text-[11px] text-white/40 mb-2">Active days for workout nudges</div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => {
              const on = (activeDays || []).includes(d)
              return <button key={d} onClick={() => app.setPrefs?.({ activeDays: on ? activeDays.filter((x: string) => x !== d) : [...(activeDays || []), d] })} className={`px-3 py-1.5 rounded-full text-xs border ${on ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/45'}`}>{d}</button>
            })}
          </div>
        </div>
        <button onClick={() => setActiveTab('Workout')} className="text-[11px] text-violet-300/70 flex items-center gap-1"><Brain className="w-3 h-3" /> tag sessions Primary / Secondary in the Workout tab</button>
      </div>

      {/* ---------------- Talkback ---------------- */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-medium text-white flex items-center gap-2"><Volume2 className="w-4 h-4 text-blue-400" /> Talkback • {ttsEngine}</div>
          <Sliders className="w-4 h-4 text-white/20" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-[#0e0e12] border border-white/5 space-y-3">
            <div className="text-xs text-white/40 flex justify-between"><span>Voice</span>{voiceEngine.isPiperReady() && <span className="text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" />Piper ready</span>}</div>
            <select value={selectedVoiceURI} onChange={(e) => setSelectedVoiceURI(e.target.value)} className="w-full h-9 rounded-xl bg-[#141418] border border-white/10 text-xs text-white outline-none">
              <option value="">Auto (Piper, else system voice)</option>
              {(speechVoices || []).map((v: any) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setVoiceGender('female')} className={voiceGender === 'female' ? 'flex-1 py-2 rounded-xl bg-white text-black text-xs font-semibold' : 'flex-1 py-2 rounded-xl bg-white/10 text-white/50 text-xs'}>Female</button>
              <button onClick={() => setVoiceGender('male')} className={voiceGender === 'male' ? 'flex-1 py-2 rounded-xl bg-white text-black text-xs font-semibold' : 'flex-1 py-2 rounded-xl bg-white/10 text-white/50 text-xs'}>Male</button>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[#0e0e12] border border-white/5 space-y-4">
            <CustomSlider value={pitch} min={0.5} max={2} step={0.1} label="Pitch" onChange={setPitch} />
            <CustomSlider value={speed} min={0.5} max={2} step={0.1} label="Speed" onChange={setSpeed} />
            <CustomSlider value={volume} min={0} max={1} step={0.1} label="Speech volume" onChange={setVolume} />
          </div>
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          <button onClick={() => speakTest?.(`Good morning ${personality.getUserName() || 'there'}, ${personality.getAIName()} is online`)} className="px-5 h-9 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 text-white text-xs font-semibold flex items-center gap-1"><Zap className="w-3 h-3" /> Test voice</button>
          <button onClick={() => stopSpeak?.()} className="px-4 h-9 rounded-xl bg-white/10 border border-white/10 text-xs text-white/60">Stop</button>
        </div>
      </div>

      {/* ---------------- Database ---------------- */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 md:p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium text-white">Database</div>
          <div className="text-xs font-mono px-2 py-0.5 rounded-full border border-white/10 text-white/40">{dbinfo ? (dbinfo.driver === 'sqlite' ? 'SQLite' : dbinfo.driver === 'json-file' ? 'JSON file' : 'localStorage') : '—'}</div>
        </div>
        <div className="text-[11px] text-white/25 mb-3 truncate">{dbinfo?.path || 'browser storage'} • {(dbinfo?.size || 0) > 0 ? Math.round(dbinfo.size / 1024) + ' KB' : ''} • steaks {(app.steaks || []).length} • tasks {(app.tasks || []).length}</div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={async () => {
            const payload = { app: 'HABIT.AI', version: '5.3', exportedAt: new Date().toISOString(), computer: { platform: platformName(), timeZone: sys.timeZone, locale: sys.locale }, data: collectAll() }
            const name = `habit-ai-${sys.dateKey}`
            const res = await saveJsonBackup(payload, name)
            toast(res && res !== 'downloaded' ? `Saved ${res}` : res === 'downloaded' ? 'Backup downloaded' : 'Export cancelled')
          }} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-2"><Download className="w-3 h-3" /> Export backup</button>
          <label className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-white/60 text-xs flex items-center gap-2 cursor-pointer"><Upload className="w-3 h-3" /> Import<input type="file" hidden accept=".json" onChange={async (e) => {
            const f = (e.target as any).files?.[0]
            let parsed: any = null
            if (f) { const text = await f.text(); try { parsed = JSON.parse(text) } catch { parsed = null } }
            else if (isDesktop()) { const res = await pickJsonBackup(); parsed = res ? res.data : null }
            if (!parsed) { toast('Not a readable HABIT.AI backup'); return }
            const ok = await importDB(parsed)
            toast(ok ? 'Imported — reloading' : 'File has no habit data')
            if (ok) setTimeout(() => location.reload(), 800)
          }} /></label>
          <button onClick={async () => {
            if (!confirm('Clean data: wipes steaks, tasks, logs, workout rows, ritual slides, water history and alarms. Names, voice and playlist are kept. Continue?')) return
            // state first (no half-cleared render can crash), then the SQLite mirror, then reload
            app.resetHabitData?.()
            try { const api: any = (window as any).habitAI; if (api?.db?.reset) await api.db.reset() } catch {}
            toast('Database cleared — everything starts from zero')
            setTimeout(() => location.reload(), 1200)
          }} className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-center gap-2"><Eraser className="w-3 h-3" /> Clean data to zero</button>
          <button onClick={() => { if (confirm('Run the first-time setup again?')) restartOnboarding() }} className="px-4 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-white/60 text-xs flex items-center gap-2"><Sliders className="w-3 h-3" /> Re-run onboarding</button>
          <button className="px-4 py-2 rounded-xl bg-[#0e0e12] border border-white/10 text-white/60 text-xs flex items-center gap-2"><Activity className="w-3 h-3" /> {dayPaused ? 'PAUSED' : 'Engine live'} • {alertInfo.pending} armed</button>
        </div>
        <div className="mt-3 text-[10px] text-white/20">Offline speech model missing? Run <span className="text-white/40">node download-model.js</span> once, then restart. Until then voice falls back to the system speech engine.</div>
      </div>
    </div>
  )
}
