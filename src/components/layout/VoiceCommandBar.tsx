import { useEffect, useState } from 'react'
import { Mic, Send, Square, VolumeX } from 'lucide-react'
import { useApp } from '../../store/AppContext'
import { onStatus, type SttEngine } from '../../core/voiceEngine'

const STT_LABEL: Record<SttEngine, string> = {
  none: 'MIC IDLE',
  loading: 'LOADING MODEL',
  vosk: 'VOSK READY',
  webspeech: 'SYSTEM SPEECH',
  denied: 'MIC BLOCKED',
  error: 'SPEECH ERROR'
}

/** Live command strip: what you said (in flight + final), what the AI answered, typed fallback, mic. */
export default function VoiceCommandBar({ onCommand, onMic, listening, assistant, aiName }: any) {
  const { transcript, liveTranscript, lastAction, micPermission, dayPaused, isSpeaking, stopSpeak, voiceAsleep } = useApp() as any
  const [text, setText] = useState('')
  const [stt, setStt] = useState<SttEngine>('none')

  useEffect(() => {
    const off = onStatus((s: any) => setStt(s.stt))
    return () => { off() }
  }, [])

  const send = () => {
    const v = text.trim()
    if (!v) return
    onCommand?.(v)
    setText('')
  }

  return (
    <div className="min-h-10 shrink-0 bg-[#0f0f12] border-b border-white/[0.06] flex flex-wrap items-center gap-x-3 gap-y-1 px-3 md:px-4 py-1 text-[12px]">
      <div className="text-[11px] text-white/30 shrink-0">VOICE:</div>

      {/* what I am saying, live */}
      <div className="text-[12px] text-white/75 truncate max-w-[45%] min-w-0">
        {liveTranscript
          ? <span className="text-violet-200">{liveTranscript}<span className="animate-pulse">▍</span></span>
          : transcript
            ? <span>“{transcript}”</span>
            : <span className="text-white/35">{listening ? 'Listening…' : voiceAsleep ? 'ear asleep — wake me in Settings' : `Say "${aiName ? 'hey ' + String(aiName).toLowerCase() : 'hey habi'}…" or tap the mic`}</span>}
      </div>

      {/* what the AI answered */}
      <div className="ml-1 text-[12px] text-emerald-300/80 truncate flex-1 min-w-0" title={assistant || ''}>
        {assistant || (isSpeaking ? <span className="text-white/40">{aiName || 'Habi'} is speaking…</span> : '')}
      </div>

      <div className="text-[11px] text-violet-300/70 shrink-0 hidden xl:block">{lastAction}</div>
      <div className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 hidden md:flex items-center gap-1 ${micPermission === 'granted' ? 'bg-white/5 border-white/10 text-white/40' : 'bg-red-500/10 border-red-500/20 text-red-300'}`} title="Speech engine">
        {STT_LABEL[stt] || 'MIC IDLE'}
      </div>
      {dayPaused && <div className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-200 shrink-0">DAY PAUSED — SILENT</div>}

      <div className="flex items-center gap-1.5 shrink-0 bg-[#0e0e12] border border-white/10 rounded-full pl-2 pr-1 py-0.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          onFocus={(e) => e.stopPropagation()}
          placeholder="type a command…"
          autoComplete="off"
          className="w-28 sm:w-40 bg-transparent text-[11px] text-white placeholder:text-white/25 outline-none"
        />
        <button onClick={send} className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white" title="Run command">
          <Send className="w-3 h-3" />
        </button>
      </div>

      {isSpeaking && (
        <button onClick={() => stopSpeak?.()} title="Stop speaking" className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-white/60 shrink-0">
          <Square className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={() => onMic?.()}
        title={micPermission === 'granted' ? 'Talk once' : 'Enable microphone'}
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition ${listening ? 'bg-red-500 text-white animate-pulse' : micPermission === 'granted' ? 'bg-violet-500/20 border border-violet-500/30 text-violet-200' : 'bg-white/10 text-white/50'}`}
      >
        {listening ? <VolumeX className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
      </button>
    </div>
  )
}
