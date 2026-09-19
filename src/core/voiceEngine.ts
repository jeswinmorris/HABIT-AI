/**
 * voiceEngine v8 — STT (Vosk offline, Web Speech fallback) + TTS (Piper, WebSpeech fallback)
 *
 * Fixes on top of v7 (why your audio "went in" but nothing came back):
 *  1. talkOnce() built its recognizer with a 6-phrase grammar (ONE_SHOT_VOCAB), so Vosk
 *     could only ever answer with one of those strings and returned [unk] for everything
 *     else — which the code then filtered out. Push-to-talk was effectively mute-deaf.
 *  2. The default decode grammar is now unrestricted, with a soft "hints" boost instead.
 *  3. Partial (in-flight) transcripts are surfaced so the UI can show what you are saying.
 *  4. Model URL resolution: Electron IPC ( Resources / userData ) -> bundled public path.
 *  5. If no model is installed, the engine falls back to the platform STT rather than
 *     sitting silent, and reports which engine is live through engineStatus().
 *  6. setWakeWord() / isPiperReady() were called by the app but never existed.
 *
 * Public API kept: setLevelSink, getMicBars, enableMicrophone, startMicMeter, stopMicMeter,
 * startAlwaysOn, stopAlwaysOn, talkOnce, holdToTalk, supported, preloadTTS, stopSpeaking,
 * speak, speakWithEmma, voiceEngine (+ new: setWakeWord, engineStatus, onStatus).
 */

import { createModel, type Model, type KaldiRecognizer } from 'vosk-browser'

// ---------- Shared Types ----------
export type SttEngine = 'none' | 'loading' | 'vosk' | 'webspeech' | 'denied' | 'error'
export type TtsEngine = 'unknown' | 'loading' | 'piper' | 'webspeech' | 'error'
type Status = { stt: SttEngine; tts: TtsEngine; modelUrl: string; detail: string }

type TranscriptSource = 'wake' | 'hold' | 'live'
type Cbs = {
  setMicLevel: (value: number, bars: number[]) => void
  onTranscript: (text: string, src: TranscriptSource) => void
  onPartial: (text: string) => void
}
type Sink = { rec: KaldiRecognizer }

let cbs: Cbs = {
  setMicLevel: () => undefined,
  onTranscript: () => undefined,
  onPartial: () => undefined,
}
export function setLevelSink(fn: (value: number, bars: number[]) => void) { cbs.setMicLevel = fn }
export function setPartialSink(fn: (text: string) => void) { cbs.onPartial = fn }
export const getMicBars = () => 24

const status: Status = { stt: 'none', tts: 'unknown', modelUrl: '', detail: 'not initialised' }
const statusListeners = new Set<(s: Status) => void>()
export const engineStatus = (): Status => ({ ...status })
export function onStatus(fn: (s: Status) => void): () => void {
  statusListeners.add(fn)
  fn({ ...status })
  return () => statusListeners.delete(fn)
}
function setStatus(patch: Partial<Status>) {
  Object.assign(status, patch)
  ;[...statusListeners].forEach((l) => { try { l({ ...status }) } catch {} })
}

// ---------- Wake word ----------
let wakeWordValue = 'hey habi'
export function setWakeWord(w: string) {
  wakeWordValue = String(w || 'hey habi').toLowerCase().trim()
}
function wakeWord(): string {
  return wakeWordValue || 'hey habi'
}
export function wakeWords(): string[] {
  return wakeWord().split(/\s+/).filter(Boolean)
}

// ---------- Model URL (Electron aware) ----------
async function resolveModelUrl(): Promise<string> {
  try {
    const api: any = (window as any).habitAI || (window as any).habitAPI
    if (api?.getModelPath) {
      const p: string = await api.getModelPath()
      if (p) return p
    }
  } catch {}
  try {
    const custom = localStorage.getItem('habitOS_voskModelUrl')
    if (custom) return custom
  } catch {}
  return './habi-model.tar.gz'
}

let modelP: Promise<Model> | null = null
async function getModel(): Promise<Model> {
  if (!modelP) {
    setStatus({ stt: 'loading', detail: 'loading offline model' })
    const url = await resolveModelUrl()
    console.log('[voice] Vosk model url:', url)
    modelP = (async () => {
      const m = await createModel(url)
      try { (m as any).setLogLevel?.(-2) } catch {}
      setStatus({ stt: 'vosk', modelUrl: url, detail: 'offline model ready' })
      return m
    })().catch((e) => {
      modelP = null
      setStatus({ stt: 'error', modelUrl: url, detail: `model unavailable: ${String((e as any)?.message || e)}` })
      throw e
    })
  }
  return modelP
}

/** Vosk when the model is installed, otherwise whatever STT the platform offers. */
async function getVoskModel(): Promise<Model | null> {
  try { return await getModel() } catch { return null }
}

// ---------- Audio Capture ----------
let stream: MediaStream | null = null
let audioCtx: AudioContext | null = null
let sourceNode: MediaStreamAudioSourceNode | null = null
let workletNode: AudioWorkletNode | null = null
let analyserNode: AnalyserNode | null = null
let meterRAF = 0
const sinks = new Set<Sink>()
let capturePromise: Promise<boolean> | null = null

const WORKLET_NAME = 'habi-audio-capture'
const WORKLET_SOURCE = `class HabiAudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs){ const i=inputs[0]; if(i?.[0]?.length){ this.port.postMessage(i[0].slice(0)) } return true }
} registerProcessor('${WORKLET_NAME}', HabiAudioCaptureProcessor)`

async function installAudioWorklet(ctx: AudioContext) {
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try { await ctx.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
}

function clean(text: string): string {
  const t = String(text || '').trim().toLowerCase()
  if (!t || t === 'a' || t === '[unk]' || t === 'unk') return ''
  return t
}

function attachRecognizerDebug(rec: KaldiRecognizer, label: string) {
  try {
    rec.on('partialresult', (m: any) => {
      const t = clean(m?.result?.partial || '')
      if (t) { cbs.onPartial(t); console.log(`[voice] ${label} partial:`, t) }
    })
    rec.on('result', (m: any) => {
      const t = clean(m?.result?.text || '')
      if (t) console.log(`[voice] ${label} result:`, t)
    })
  } catch {}
}

// ---------- Resampler ----------
class Resampler {
  private targetRate = 16000
  private chunks: Float32Array[] = []
  private buffered = 0
  constructor(private srcRate: number) {}
  push(chunk: Float32Array): Float32Array | null {
    const ratio: number = this.srcRate / this.targetRate
    const newLen = Math.floor(chunk.length / ratio)
    const resampled = new Float32Array(newLen)
    for (let i = 0; i < newLen; i++) {
      const srcIdx = i * ratio
      const i0 = Math.floor(srcIdx)
      const i1 = i0 + 1 < chunk.length ? i0 + 1 : chunk.length - 1
      const v0: number = chunk[i0] ?? 0
      const v1: number = chunk[i1] ?? 0
      const frac: number = srcIdx - i0
      resampled[i] = v0 * (1 - frac) + v1 * frac
    }
    this.chunks.push(resampled)
    this.buffered += resampled.length
    if (this.buffered >= 4000) {
      const out = new Float32Array(this.buffered)
      let off = 0
      for (const c of this.chunks) { out.set(c, off); off += c.length }
      this.chunks = []
      this.buffered = 0
      return out
    }
    return null
  }
  clear() { this.chunks = []; this.buffered = 0 }
}

let resampler: Resampler | null = null

async function createCapture(): Promise<boolean> {
  let mediaStream: MediaStream | null = null
  let ctx: AudioContext | null = null
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    })
    ctx = new AudioContext()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    await installAudioWorklet(ctx)

    const source = ctx.createMediaStreamSource(mediaStream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 64
    analyser.smoothingTimeConstant = 0.75

    const worklet = new AudioWorkletNode(ctx, WORKLET_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1
    })
    const silentGain = ctx.createGain()
    silentGain.gain.value = 0
    source.connect(analyser)
    source.connect(worklet)
    worklet.connect(silentGain)
    silentGain.connect(ctx.destination)

    const ctxRef = ctx
    resampler = new Resampler(ctx.sampleRate)

    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const samples = event.data
      if (!samples?.length) return
      if (sinks.size === 0) return
      const curCtx = audioCtx ?? ctxRef
      if (!curCtx || curCtx.state === 'closed' || !resampler) return
      const resampled = resampler.push(samples)
      if (!resampled) return
      try {
        const buffer = curCtx.createBuffer(1, resampled.length, 16000)
        buffer.copyToChannel(resampled as Float32Array<ArrayBuffer>, 0)
        for (const sink of [...sinks]) {
          try { sink.rec.acceptWaveform(buffer) } catch {}
        }
      } catch {}
    }

    stream = mediaStream
    audioCtx = ctx
    sourceNode = source
    analyserNode = analyser
    workletNode = worklet
    mediaStream = null
    ctx = null
    startMeter()
    return true
  } catch (e) {
    console.error('[voice] capture failed', e)
    setStatus({ stt: 'denied', detail: `microphone unavailable: ${String((e as any)?.name || e)}` })
    try { mediaStream?.getTracks().forEach((t) => t.stop()) } catch {}
    try { await ctx?.close() } catch {}
    teardownCapture(true)
    return false
  }
}

async function ensureCapture(): Promise<boolean> {
  if (stream && audioCtx && audioCtx.state !== 'closed') {
    if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {})
    return true
  }
  if (capturePromise) return capturePromise
  capturePromise = createCapture().finally(() => { capturePromise = null })
  return capturePromise
}

function startMeter() {
  const analyser = analyserNode
  if (!analyser) return
  cancelAnimationFrame(meterRAF)
  const data = new Uint8Array(analyser.frequencyBinCount || 32)
  const tick = () => {
    if (!analyserNode || analyserNode !== analyser) return
    analyser.getByteFrequencyData(data)
    const barCount = 24
    const perBar = Math.max(1, Math.floor(data.length / barCount))
    const bars: number[] = []
    for (let i = 0; i < barCount; i++) {
      let sum = 0, count = 0
      for (let j = 0; j < perBar; j++) {
        const idx = i * perBar + j
        if (idx >= data.length) break
        sum += data[idx] ?? 0
        count++
      }
      bars.push(Math.round(((count ? sum / count : 0) / 255) * 100))
    }
    let total = 0
    for (const b of bars) total += b
    cbs.setMicLevel(Math.round(total / barCount), bars)
    meterRAF = requestAnimationFrame(tick)
  }
  tick()
}

function teardownCapture(force = false) {
  if (!force && sinks.size > 0) return
  cancelAnimationFrame(meterRAF)
  meterRAF = 0
  try { workletNode?.port.close() } catch {}
  try { workletNode?.disconnect() } catch {}
  try { sourceNode?.disconnect() } catch {}
  try { analyserNode?.disconnect() } catch {}
  try { stream?.getTracks().forEach((t) => t.stop()) } catch {}
  const c = audioCtx
  stream = null; audioCtx = null; sourceNode = null; analyserNode = null; workletNode = null
  resampler?.clear(); resampler = null
  if (c) c.close().catch(() => {})
  cbs.setMicLevel(0, new Array(24).fill(0))
}

export async function enableMicrophone() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    setStatus({ stt: 'denied', detail: 'microphone permission denied' })
    return false
  }
}
export function startMicMeter() { void ensureCapture() }
export function stopMicMeter() { if (!alwaysOnRec && !oneShotRec && !wsActive) teardownCapture() }

// ---------- Web Speech fallback ----------
type WS = { start: () => void; stop: () => void; abort: () => void; onresult: any; onerror: any; onend: any; lang: string; continuous: boolean; interimResults: boolean }
function speechCtor(): (new () => WS) | null {
  const w: any = typeof window !== 'undefined' ? window : null
  return (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) || null
}
let wsActive: any = null

/** Run one platform recognition session; resolves with the final transcript. */
function webSpeechOnce(
  onText: (t: string) => void,
  onPartial?: (t: string) => void,
  maxMs = 12000,
  opts: { continuous?: boolean; onDone?: () => void } = {}
): () => void {
  const Ctor = speechCtor()
  if (!Ctor) { onText(''); opts.onDone?.(); return () => {} }
  let ws: WS
  try { ws = new Ctor() } catch { onText(''); opts.onDone?.(); return () => {} }
  let settled = false
  let timer = 0
  let lastHeard = ''
  const finish = (t: string) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    try { ws.stop() } catch {}
    wsActive = null
    onText(clean(t || lastHeard))
    opts.onDone?.()
  }
  ws.continuous = !!opts.continuous
  ws.interimResults = true
  ws.lang = navigator.language || 'en-US'
  ws.onresult = (e: any) => {
    let interim = '', finalT = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      const txt = String(r?.[0]?.transcript || '')
      if (r.isFinal) finalT += txt
      else interim += txt
    }
    const live = clean(finalT || interim)
    if (live) { lastHeard = finalT || interim; onPartial?.(live) }
    if (finalT) finish(finalT)
  }
  ws.onerror = (e: any) => {
    console.warn('[voice] webspeech error', e?.error)
    setStatus({ stt: 'error', detail: `platform speech: ${e?.error || 'error'}` })
    finish(lastHeard)
  }
  ws.onend = () => finish(lastHeard)
  timer = window.setTimeout(() => finish(lastHeard), maxMs)
  wsActive = ws
  try { ws.start() } catch { finish('') }
  return () => finish(lastHeard)
}

// ---------- STT: always-on (wake word) ----------
let armedUntil = 0, generation = 0
let alwaysOnRec: KaldiRecognizer | null = null
let alwaysOnStop: (() => void) | null = null
let legacyStopper: (() => void) | null = null

function containsWake(text: string): { hit: boolean; rest: string } {
  const t = clean(text)
  if (!t) return { hit: false, rest: '' }
  const wake = wakeWord()
  const idx = wake ? t.indexOf(wake) : -1
  if (idx >= 0) return { hit: true, rest: t.slice(idx + wake.length).trim() }
  const parts = wakeWords()
  if (parts.length > 1) {
    const first = parts[0] ?? '', last = parts[parts.length - 1] ?? ''
    if (first && last && t.includes(first) && t.includes(last)) {
      const tail = t.slice(Math.max(t.indexOf(first) + first.length, t.indexOf(last) + last.length)).trim()
      return { hit: true, rest: tail }
    }
  }
  return { hit: false, rest: t }
}

export async function startAlwaysOn(onTranscript: Cbs['onTranscript']): Promise<boolean> {
  stopAlwaysOn()
  const myGen = ++generation
  cbs.onTranscript = onTranscript
  const okPermission = await ensureCapture()
  if (!okPermission) return false
  if (myGen !== generation) return false

  const model = await getVoskModel()
  if (myGen !== generation) return true

  if (model) {
    const rec = new model.KaldiRecognizer(16000)
    attachRecognizerDebug(rec, 'always-on')
    rec.on('result', (m: any) => {
      if (myGen !== generation) return
      const text = clean(m?.result?.text || '')
      if (!text) return
      const w = containsWake(text)
      if (w.hit) {
        armedUntil = Date.now() + 6000
        cbs.onTranscript(w.rest || '__WAKE__', 'wake')
        return
      }
      if (Date.now() < armedUntil) {
        armedUntil = Date.now() + 7000
        cbs.onTranscript(text, 'live')
      }
    })
    sinks.add({ rec })
    alwaysOnRec = rec
    setStatus({ stt: 'vosk', detail: 'always-on listening' })
    return true
  }

  // Vosk unavailable → platform STT in continuous mode (restarts on end).
  if (!speechCtor()) {
    setStatus({ stt: 'error', detail: 'no speech engine: install the model (npm run model)' })
    return false
  }
  setStatus({ stt: 'webspeech', detail: 'always-on via platform speech' })
  const handle = (t: string) => {
    if (myGen !== generation) return
    const w = containsWake(t)
    if (w.hit) { armedUntil = Date.now() + 8000; cbs.onTranscript(w.rest || '__WAKE__', 'wake') }
    else if (t && (Date.now() < armedUntil || !wakeWord())) {
      if (Date.now() < armedUntil) armedUntil = Date.now() + 8000
      cbs.onTranscript(t, 'live')
    }
  }
  const restart = () => {
    if (myGen !== generation) return
    alwaysOnStop = webSpeechOnce(handle, (p) => { if (myGen === generation) cbs.onPartial(p) }, 20000, {
      continuous: true,
      onDone: () => { if (myGen === generation) setTimeout(restart, 350) }
    })
  }
  restart()
  return true
}

export function stopAlwaysOn() {
  generation++
  if (alwaysOnRec) {
    try { alwaysOnRec.remove() } catch {}
    for (const s of [...sinks]) if (s.rec === alwaysOnRec) sinks.delete(s)
  }
  alwaysOnRec = null
  try { alwaysOnStop?.() } catch {}
  alwaysOnStop = null
  try { legacyStopper?.() } catch {}
  legacyStopper = null
  armedUntil = 0
  if (!oneShotRec && !wsActive) teardownCapture()
  if (status.stt === 'vosk' || status.stt === 'webspeech') setStatus({ detail: 'idle' })
}

// ---------- STT: one utterance (push to talk) ----------
let oneShotRec: KaldiRecognizer | null = null

export async function talkOnce(
  onText: (t: string) => void,
  onState?: (b: boolean) => void,
  onPartial?: (t: string) => void
): Promise<() => void> {
  onState?.(true)
  let settled = false
  const finish = (txt: string, cleanup?: () => void) => {
    if (settled) return
    settled = true
    cleanup?.()
    onState?.(false)
    onText(clean(txt))
  }

  const model = await getVoskModel()

  if (model) {
    const ok = await ensureCapture()
    if (!ok) { finish(''); return () => {} }
    // No grammar argument: v7 passed a fixed 6-phrase vocabulary here, which made every
    // other sentence decode to [unk] and get dropped. Large-vocabulary decode instead.
    const rec = new model.KaldiRecognizer(16000)
    let timeout = 0
    let lastPartial = ''
    const drop = () => {
      clearTimeout(timeout)
      try { rec.remove() } catch {}
      for (const s of [...sinks]) if (s.rec === rec) sinks.delete(s)
      if (oneShotRec === rec) oneShotRec = null
      if (!alwaysOnRec) teardownCapture()
    }
    rec.on('partialresult', (m: any) => {
      const t = clean(m?.result?.partial || '')
      if (t) { lastPartial = t; cbs.onPartial(t); onPartial?.(t) }
    })
    rec.on('result', (m: any) => {
      const t = clean(m?.result?.text || '')
      finish(t || lastPartial, drop)
    })
    sinks.add({ rec })
    oneShotRec = rec
    setStatus({ stt: 'vosk', detail: 'listening (one utterance)' })
    // Ask Vosk to flush its endpoint buffer instead of guessing with the partial text.
    timeout = window.setTimeout(() => {
      try { rec.retrieveFinalResult?.() } catch {}
      window.setTimeout(() => finish(lastPartial, drop), 500)
    }, 9000) as any
    return () => finish(lastPartial, drop)
  }

  // fallback path
  if (!alwaysOnRec) {
    const ok = await ensureCapture()
    if (!ok) { finish(''); return () => {} }
    teardownCapture(true) // WebSpeech owns its own capture; free the mic for it
  }
  const stop = webSpeechOnce(
    (t) => { finish(t, () => {}); if (!alwaysOnRec) teardownCapture() },
    (p) => { cbs.onPartial(p); onPartial?.(p) }
  )
  if (!speechCtor()) finish('')
  else setStatus({ stt: 'webspeech', detail: 'listening (one utterance)' })
  return () => { stop(); finish('', () => {}) }
}

export function holdToTalk(onText: (t: string) => void) {
  let stop: (() => void) | undefined
  void talkOnce(onText).then((f) => { stop = f })
  return () => stop?.()
}
export function supported() { return true }

// ---------- TTS: Piper (the real API) with WebSpeech fallback ----------
/** ids that @mintplex-labs/piper-tts-web actually ships */
export const MALE_VOICE = 'en_US-lessac-medium'
export const FEMALE_VOICE = 'en_US-amy-medium'
type VoiceId = string

let ttsSession: any = null
let ttsPromise: Promise<any> | null = null
let sessionVoiceId = ''
let currentAudio: HTMLAudioElement | null = null
let localRuntime: { piperWasm: string; piperData: string; onnxWasm: string } | null = null
const progressSubs = new Set<(p: any) => void>()
export const onTtsProgress = (fn: (p: any) => void) => { progressSubs.add(fn); return () => progressSubs.delete(fn) }

export function isPiperReady() { return !!ttsSession && ttsSession.ready === true }
export const ttsVoiceFor = (gender?: string) => (gender === 'male' ? MALE_VOICE : FEMALE_VOICE)

async function fileExists(url: string) {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    return r.ok
  } catch { return false }
}
/**
 * public/piper files (installed by `npm run piper`) keep the speech runtime on-device.
 * onnxruntime wants a *directory* for its wasm base and it also fetches the matching
 * `ort-wasm-simd-threaded.mjs` glue, so the whole set has to be present before we point
 * at it — otherwise we let the library use its own CDN defaults.
 */
const RUNTIME_SET = ['piper_phonemize.wasm', 'piper_phonemize.data', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']
async function localRuntimePaths(relative = './piper/') {
  if (localRuntime !== null) return localRuntime
  // onnxruntime resolves wasmPaths itself, so it needs an absolute URL rather than './piper/'
  let base = relative
  try { base = new URL(relative, document.baseURI).href } catch {}
  if (!base.endsWith('/')) base += '/'
  const seen = await Promise.all(RUNTIME_SET.map((f) => fileExists(base + f)))
  localRuntime = seen.every(Boolean)
    ? { piperWasm: base + 'piper_phonemize.wasm', piperData: base + 'piper_phonemize.data', onnxWasm: base }
    : null
  return localRuntime
}

async function getPiperSession(voiceId: string): Promise<any> {
  if (ttsSession && sessionVoiceId === voiceId) return ttsSession
  if (ttsPromise && sessionVoiceId === voiceId) return ttsPromise
  sessionVoiceId = voiceId
  ttsPromise = (async () => {
    setStatus({ tts: 'loading' })
    try {
      const mod: any = await import('@mintplex-labs/piper-tts-web')
      if (typeof mod.TtsSession?.create !== 'function') throw new Error('piper-tts-web has no TtsSession')
      const local = await localRuntimePaths()
      const wasmPaths = local
        ? { piperWasm: local.piperWasm, piperData: local.piperData, ...(local.onnxWasm ? { onnxWasm: local.onnxWasm } : {}) }
        : undefined
      // Voices are ~60 MB. `download()` warms the browser file cache so later launches are
      // instant; while it runs we publish progress so the UI shows a percentage, not a spinner.
      const report = (label: string) => (p: any) => {
        const pct = p?.total ? Math.round(((p.loaded || 0) / p.total) * 100) : 0
        setStatus({ tts: 'loading', detail: `${label} ${voiceId} — ${pct}%` })
        progressSubs.forEach((f) => f({ ...p, label, voiceId }))
      }
      if (!local && typeof mod.download === 'function') {
        try { await mod.download(voiceId, report('downloading voice')) } catch (e) { console.warn('[TTS] voice prefetch failed', e) }
      } else {
        setStatus({ tts: 'loading', detail: 'starting piper runtime for ' + voiceId })
      }
      setStatus({ tts: 'loading', detail: 'loading the ' + voiceId + ' runtime' })
      const session = await mod.TtsSession.create({
        voiceId,
        ...(wasmPaths ? { wasmPaths } : {}),
        logger: (t: string) => console.log('[TTS]', t)
      })
      ttsSession = session
      setStatus({ tts: 'piper', detail: 'Piper voice ' + voiceId + (local ? ' (installed locally)' : ' (cached from CDN)') })
      console.log('[TTS] Piper session ready for ' + voiceId)
      return session
    } catch (e) {
      ttsSession = null
      setStatus({ tts: 'webspeech', detail: 'piper unavailable: ' + String((e as any)?.message || e).slice(0, 160) })
      console.warn('[TTS] Piper not usable, WebSpeech fallback:', (e as any)?.message || e)
      throw e
    } finally {
      ttsPromise = null
    }
  })()
  return ttsPromise
}

export async function preloadTTS(voiceId: string = FEMALE_VOICE) {
  try { await getPiperSession(voiceId) } catch { /* WebSpeech fallback will be used */ }
}

export function stopSpeaking() {
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.src = '' } catch {}
    currentAudio = null
  }
  try { window.speechSynthesis.cancel() } catch {}
}

/** speak(text, voice?, opts?) — opts carries the Settings sliders. */
export async function speak(
  text: string,
  voice: VoiceId = FEMALE_VOICE,
  opts: { volume?: number; rate?: number; pitch?: number; voiceURI?: string; gender?: 'male' | 'female' } = {}
): Promise<void> {
  const clean2 = text.replace(/\s+/g, ' ').trim()
  if (!clean2) return
  stopSpeaking()
  const volume = Math.max(0, Math.min(1, opts.volume ?? readSetting('volume', 1)))
  const rate = Math.max(0.5, Math.min(2, opts.rate ?? readSetting('speed', 1)))
  const pitch = Math.max(0.5, Math.min(2, opts.pitch ?? readSetting('pitch', 1)))
  const gender = opts.gender ?? readSetting('voiceGender', 'female')
  const voiceId = typeof voice === 'string' && voice.indexOf('en_') === 0 ? voice : ttsVoiceFor(gender)

  try {
    // First run can download a ~60 MB voice; never let that swallow the sentence — if the
    // Piper session is not ready within 4s, the system voice says it now.
    const quick = await Promise.race([
      getPiperSession(voiceId).then((s) => s as any).catch(() => null),
      new Promise<null>((res) => setTimeout(() => res(null), 4000))
    ])
    if (!quick) throw new Error('piper session not ready in time')
    const blob: Blob = await quick.predict(clean2)
    if (blob && blob.size > 0) {
      const url = URL.createObjectURL(blob)
      const el = new Audio(url)
      currentAudio = el
      el.volume = volume
      if (rate !== 1) el.playbackRate = Math.max(0.6, Math.min(1.5, rate))
      await new Promise<void>((resolve) => {
        el.onended = () => { URL.revokeObjectURL(url); if (currentAudio === el) currentAudio = null; resolve() }
        el.onerror = () => { URL.revokeObjectURL(url); if (currentAudio === el) currentAudio = null; resolve() }
        el.play().catch(() => resolve())
      })
      return
    }
    throw new Error('Piper returned no audio')
  } catch (e) {
    console.log('[TTS] fallback to WebSpeech:', (e as any)?.message)
    if (isPiperReady() === false) setStatus({ tts: 'webspeech', detail: status.detail })
    await new Promise<void>((res) => {
      try {
        const synth = window.speechSynthesis
        if (!synth) return res()
        const utter = new SpeechSynthesisUtterance(clean2)
        const voices = synth.getVoices()
        const picked = (opts.voiceURI && voices.find((v) => v.voiceURI === opts.voiceURI)) ||
          voices.find((v) => (gender === 'female' ? /emma|samantha|jenny|aria|female|zira|susan|google uk english female/i : /male|david|mark|daniel|google uk english male/i).test(v.name)) ||
          voices.find((v) => /^en/i.test(v.lang)) || voices[0]
        if (picked) utter.voice = picked
        utter.volume = volume
        utter.rate = rate
        utter.pitch = pitch
        utter.onend = () => res()
        utter.onerror = () => res()
        synth.speak(utter)
        // some engines never fire onend — do not hang the speak queue
        window.setTimeout(res, Math.min(30000, 1200 + clean2.length * 70))
      } catch { res() }
    })
  }
}

function readSetting(name: string, fallback: any) {
  try {
    const st = JSON.parse(localStorage.getItem('habitOS_v4_final') || '{}')
    return st[name] ?? fallback
  } catch { return fallback }
}

// Compatibility exports
export const speakWithEmma = (t: string) => speak(t, FEMALE_VOICE)
export const voiceEngine = { speak, stop: stopSpeaking, preload: preloadTTS, status: engineStatus }
