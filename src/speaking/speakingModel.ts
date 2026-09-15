import { personality } from './personality'
import { speak as engineSpeak, stopSpeaking as engineStop } from '../core/voiceEngine'

const templates: Record<string, string[]> = {
  morning: ['Good morning, {aiName} here - ready?', 'Rise and shine {user}, {aiName} got you'],
  remaining: ['{count} steaks left today, {user}. Small number, doable.', 'You have {count} steaks open. Close the loop before the day ends.', '{count} left. Pick the easiest one first.'],
  paused: ['Day paused, take rest', 'Paused. The clock can wait. Nothing counts against you.', 'Day on ice. I will keep the schedule warm.'],
  resumed: ['Day resumed. I built a catch-up plan.', 'Welcome back. No guilt - I re-slotted what you missed.', 'Resumed. Missed steaks moved into the rest of today.'],
  checked: ['Checked in. That is the rep that counts.', 'Logged. The steak grid remembers.', 'Done. Identity reinforced.', 'Streak protected.'],
  added: ['Steak created. I will remind you like a conscience.', 'Added. Reminder schedule rebuilt.', 'New steak on the board.'],
  deleted: ['Deleted. No judgement recorded.', 'Removed. Forward is the only direction.'],
  skip: ['Skipped. Analytics will not hold it against you.', 'Skip logged.', 'Rest is also training.'],
  nav: ['Opening {tab}.', 'Right to {tab}.', 'On it - {tab}.'],
  alarm: ['Alarm set for {time}.', 'Done - {time} it is.'],
  bedtime: ['Bedtime set for {time}.'],
  task: ['Task added.', 'Noted. Task in the list.'],
  muted: ['All clips muted.', 'Muted globally — say unmute to bring sound back.'],
  unmuted: ['Audio back on.', 'Unmuted - sound restored.'],
  ring: [
    '{ai}, it is time — {label}. Say stop alarm, or snooze.',
    '{label} ringing. Say stop alarm when you are up.',
    'Up. {label}. I will keep going until you answer.'
  ],
  startDay: ['Day started. Steaks, tasks and reminders are live.', 'Let us go — the day starts now.'],
  endDay: ['Day closed. Voice is asleep until you start tomorrow.', 'That is the day. Rest well.'],
  wake: ['Yes?', 'I am listening.', 'What is up, {user}?', '{aiName} here. Speak.'],
  confused: ['I did not catch that. Say what can you do for the list.', 'Not in my command list yet, {user}.', 'Say again? Go to today works too.'],
  help: ['Voice OS ready. I can start your day, brief you, open tabs, check steaks in, run your playlist, pause the day and set alarms.', 'Try: start the day, what is on today, play my playlist, full screen prayer, pause my day, end the day.']
}

function replaceAll(str: string, find: string, repl: string): string {
  return str.split(find).join(repl)
}

function settings(): any {
  try {
    return JSON.parse(localStorage.getItem('habitOS_v4_final') || '{}')
  } catch {
    return {}
  }
}

let speakingFlag = false
const speakListeners = new Set<(b: boolean) => void>()
export const onSpeakingChange = (fn: (b: boolean) => void) => {
  speakListeners.add(fn)
  return () => speakListeners.delete(fn)
}
function setSpeaking(v: boolean) {
  speakingFlag = v
  speakListeners.forEach((f) => f(v))
}

class SpeakingModel {
  /** Speaks through the shared engine, honouring Settings (mute / voice / rate / pitch). */
  async speak(text: string) {
    try {
      let final = replaceAll(text, '{aiName}', personality.getAIName())
      final = replaceAll(final, '{user}', personality.addressUser())

      const st = settings()
      // BUG FIXED: this read `st.muted`, but the state key is `globalMuted` — so "mute
      // everything" never actually silenced the AI.
      if (st.globalMuted) return
      if (!String(final || '').trim()) return

      setSpeaking(true)
      try {
        await engineSpeak(final, st.voiceGender === 'male' ? 'en_US-lessac-medium' : 'bf_emma', {
          volume: st.volume,
          rate: st.speed,
          pitch: st.pitch,
          voiceURI: st.selectedVoiceURI,
          gender: st.voiceGender
        })
      } finally {
        setSpeaking(false)
      }
    } catch {
      setSpeaking(false)
    }
  }

  stop() {
    try {
      engineStop()
    } catch {}
    setSpeaking(false)
  }

  isSpeaking() {
    return speakingFlag
  }

  speakRandom(key: string, vars: any = {}) {
    const list = templates[key] || ['{aiName} here']
    const t = list[Math.floor(Math.random() * list.length)]
    let final = replaceAll(t, '{aiName}', personality.getAIName())
    final = replaceAll(final, '{user}', personality.addressUser())
    Object.keys(vars).forEach((k) => {
      final = replaceAll(final, '{' + k + '}', String(vars[k]))
    })
    this.speak(final)
  }
}

export const speakingModel = new SpeakingModel()