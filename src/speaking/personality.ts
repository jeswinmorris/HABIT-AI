// src/speaking/personality.ts - FINAL v4.2 - DB connected
// Stores aiName + userName inside habitOS_v4_final so it goes to habit.db kv table

const FINAL_KEY = 'habitOS_v4_final'
const LEGACY_AI_KEY = 'habitOS_aiName'

type FinalState = {
  aiName?: string
  userName?: string
  wakeWord?: string
  [k: string]: any
}

function readFinal(): FinalState {
  try {
    const raw = localStorage.getItem(FINAL_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeFinal(patch: Partial<FinalState>) {
  const cur = readFinal()
  const next = { ...cur, ...patch }
  const raw = JSON.stringify(next)
  localStorage.setItem(FINAL_KEY, raw)

  // Mirror to Electron SQLite (your kvWrite)
  try {
    const api = (window as any).electronAPI || (window as any).api
    if (api?.dbWrite) api.dbWrite({ key: FINAL_KEY, value: raw })
    else if (api?.write) api.write(FINAL_KEY, raw)
  } catch {}

  // Also dispatch for AppContext listeners
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: FINAL_KEY, newValue: raw } as any))
  } catch {}
}

export const personality = {
  // AI Name - reads from FINAL first, falls back to legacy key
  getAIName(): string {
    try {
      const fin = readFinal()
      if (fin.aiName) return fin.aiName
      const legacy = localStorage.getItem(LEGACY_AI_KEY)
      if (legacy) return legacy
    } catch {}
    return 'Habi'
  },

  setAIName(name: string): void {
    const clean = String(name || 'Habi').trim() || 'Habi'
    try { localStorage.setItem(LEGACY_AI_KEY, clean) } catch {}
    writeFinal({ aiName: clean })
  },

  // NEW - User Name
  getUserName(): string {
    try {
      return readFinal().userName || ''
    } catch {
      return ''
    }
  },

  setUserName(name: string): void {
    const clean = String(name || '').trim()
    writeFinal({ userName: clean })
  },

  // Helpers for speaking
  getGreeting(): string {
    const h = new Date().getHours()
    const ai = this.getAIName()
    const user = this.getUserName()
    const who = user ? `${user}` : ''
    if (h < 12) return who ? `Good morning ${who}, ${ai} here` : `Good morning, ${ai} here`
    if (h < 18) return who ? `Good afternoon ${who}, ${ai} here` : `Good afternoon, ${ai} here`
    return who ? `Good evening ${who}, ${ai} here` : `Good evening, ${ai} here`
  },

  // What AI should call you
  addressUser(): string {
    return this.getUserName() || 'there'
  },

  // For TTS
  getPersonalizedGreeting(): string {
    const user = this.getUserName()
    const ai = this.getAIName()
    if (user) return `Hey ${user}, it's ${ai} — ready to start?`
    return `Hey, it's ${ai} — ready to start?`
  },

  getMotivation(): string {
    const user = this.getUserName()
    const list = [
      user ? `You got this, ${user}` : 'You got this',
      'Stay consistent',
      'Small wins daily',
      'Progress over perfect',
      user ? `Keep pushing, ${user}` : 'Keep pushing'
    ]
    return list[Math.floor(Math.random() * list.length)]
  },

  getTimeBasedMessage(): string {
    const h = new Date().getHours()
    if (h < 9) return 'Morning routine time'
    if (h < 13) return 'Keep momentum'
    if (h < 18) return 'Afternoon push'
    return 'Wind down well'
  }
}