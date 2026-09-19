/**
 * commandRouter - transcript string -> structured command.
 *
 * The router is written for messy speech. Transcripts arrive as "go 2 water",
 * "tacks", "open the water tab", "hey nico what is pending", so numbers are folded back
 * into words, filler is dropped, and every screen has an alias list with singular/plural
 * forms instead of one exact-perfect string check.
 *
 * Tab ids match the app's activeTab values ('Today','Sleep','Water','Workout','Tasks',
 * 'Projects','Rituals','Analytics','Settings').
 */
export type Tab = 'Today' | 'Sleep' | 'Water' | 'Workout' | 'Tasks' | 'Projects' | 'Rituals' | 'Analytics' | 'Settings'
export type RitualTab = 'Prayer' | 'Haircare' | 'Skincare' | 'Visualization' | 'Affirmations'

export interface ParsedCommand {
  kind:
    | 'navigate' | 'ritual'
    | 'addSteak' | 'deleteSteak' | 'checkIn' | 'steaksLeft'
    | 'skip'
    | 'addTask' | 'toggleTask'
    | 'pauseDay' | 'resumeDay' | 'startDay' | 'endDay'
    | 'whatOnToday' | 'pendingNow' | 'openWorkout'
    | 'voiceSleep' | 'voiceWake' | 'music' | 'playlistMode' | 'fullscreen'
    | 'media' | 'mute' | 'unmute' | 'affirmation'
    | 'alarm' | 'stopAlarm' | 'wakeupIn' | 'bedtime'
    | 'volume' | 'help' | 'testVoice'
    | 'unknown'
  tab?: Tab
  ritual?: RitualTab
  target?: string
  days?: number
  minutes?: number
  time?: string
  amount?: number
  action?: string
  forTomorrow?: boolean
  forToday?: boolean
  /** "add daily task X" — repeats and resets every day */
  daily?: boolean
  priority?: 'high' | 'normal'
  raw: string
}

/* ------------------------------- normalisation ------------------------------- */
const DIGIT_WORDS: Array<[RegExp, string]> = [
  [/\b2\b/g, ' to '],
  [/\b4\b/g, ' for '],
  [/\bto\b/g, ' to ']
]

const FILLER = /\b(please|kindly|now|for me|would you|can you|could you|i want to|i need to|i would like to|hey|hi|hello|okay|ok)\b/g

function normalizeSpeech(input: string): string {
  let t = String(input || '').toLowerCase().replace(/[^a-z0-9\s:]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  for (const [re, to] of DIGIT_WORDS) t = t.replace(re, to)
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/\b(goto|go 2|navigate 2|switch 2|send me to|take me to)\b/g, 'go to')
  return t
}

/** "tacks" / "task" / "todays" all still mean Tasks */
function stripPlural(word: string): string { return word.replace(/s$/, '') }
function nearToken(text: string, alias: string): boolean {
  if (!alias) return false
  if (alias.includes(' ')) return text.includes(alias) || text.includes(alias.replace(/\s+/g, ''))
  const core = alias.replace(/[^a-z]/g, '')
  // accept a mis-heard prefix/suffix ("tacks" for "tasks", "workou" for "workout"):
  // compare on the first 4 characters once the alias is long enough
  const stem = core.length > 4 ? core.slice(0, core.length - 1) : core
  const re = new RegExp('\\b' + stem + '[a-z]{0,2}\\b')
  return re.test(text)
}

/* --------------------------------- the tables -------------------------------- */
const TAB_ALIASES: Array<{ tab: Tab; words: string[] }> = [
  { tab: 'Today', words: ['today', 'home', 'dashboard', 'main', 'flow', 'priority list'] },
  { tab: 'Sleep', words: ['sleep', 'wakeup', 'wake up', 'bed', 'bedtime', 'alarm', 'alarms', 'night', 'rest'] },
  { tab: 'Water', words: ['water', 'drink', 'drinks', 'hydrate', 'hydration', 'juice', 'shake', 'ml'] },
  { tab: 'Workout', words: ['workout', 'work out', 'work', 'exercise', 'exercises', 'gym', 'training', 'pushup', 'pushups', 'push ups', 'squat', 'plank', 'facial', 'massage', 'mobility', 'stretch'] },
  { tab: 'Tasks', words: ['task', 'tasks', 'tack', 'tacks', 'to do', 'todo', 'todos', 'checklist', 'daily list', 'list'] },
  { tab: 'Projects', words: ['project', 'projects', 'goal', 'goals'] },
  { tab: 'Rituals', words: ['ritual', 'rituals', 'routine', 'routines'] },
  { tab: 'Analytics', words: ['analytics', 'report', 'reports', 'graph', 'graphs', 'stats', 'statistics', 'progress', 'history'] },
  { tab: 'Settings', words: ['settings', 'setting', 'config', 'options', 'preferences'] }
]

const RITUAL_ALIASES: Array<{ tab: RitualTab; words: string[] }> = [
  { tab: 'Prayer', words: ['prayer', 'prayers', 'pray'] },
  { tab: 'Haircare', words: ['haircare', 'hair care', 'hair', 'oiling'] },
  { tab: 'Skincare', words: ['skincare', 'skin care', 'skin'] },
  { tab: 'Visualization', words: ['visualization', 'visualisation', 'visualize', 'viz', 'manifest vision'] },
  { tab: 'Affirmations', words: ['affirmation', 'affirmations', 'manifest'] }
]

/**
 * Wake-word prefixes arrive glued to the command ("hey nico water", "habi open tasks").
 * Drop "hey", the AI name and any single leading token that is not a command verb, so the
 * matchers below only ever see the intent.
 */
const COMMAND_STARTS = /^(go|goto|open|show|what|whats|add|create|start|begin|end|close|pause|resume|stop|skip|check|set|change|mute|unmute|play|next|prev|previous|full|snooze|water|tasks?|workouts?|work|settings?|sleep|analytics|rituals?|projects?|today|home|give|mark|complete|finish|remind|alarm|volume|repeat|shuffle|exit|affirmations?|is|are|am|i|my|the|a|an|to|for|on|in|how|many|much|left|pending|done|help|test|read|list|call|wake|go\b)/
export function stripWakeWord(text: string, aiName = ''): string {
  let out = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!out) return ''
  const names = Array.from(new Set(String(aiName || '').toLowerCase().split(/\s+/).map((n) => n.replace(/[^a-z]/g, '')).filter((n) => n.length > 1)))
  for (const n of names) out = (' ' + out + ' ').split(' ' + n + ' ').join(' ')
  out = out.replace(/\bhey\b/g, ' ').replace(/\s+/g, ' ').trim()
  const parts = out.split(' ')
  if (parts.length > 1 && !COMMAND_STARTS.test(parts[0])) parts.shift()
  return parts.join(' ').trim()
}

/** Longest matching alias wins, so "wakeup alarm" is not stolen by "alarm". */
function findTab(text: string): Tab | null {
  let best: { tab: Tab; score: number } | null = null
  for (const row of TAB_ALIASES) {
    for (const word of row.words) {
      if (!nearToken(text, word)) continue
      const score = word.length + (word.includes(' ') ? 4 : 0)
      if (!best || score > best.score) best = { tab: row.tab, score }
    }
  }
  return best ? best.tab : null
}
function findRitual(text: string): RitualTab | null {
  let best: { tab: RitualTab; score: number } | null = null
  for (const row of RITUAL_ALIASES) {
    for (const word of row.words) {
      if (!nearToken(text, word)) continue
      const score = word.length + (word.includes(' ') ? 4 : 0)
      if (!best || score > best.score) best = { tab: row.tab, score }
    }
  }
  return best ? best.tab : null
}

const NAV_VERB = /\b(go to|open|show|switch to|navigate to|read out|pull up|bring up|jump to|change to)\b/
const SCREEN_WORDS = /\b(page|tab|section|module|panel|screen|window|view)\b/

function pad(n: number): string { return String(n).padStart(2, '0') }
function normTime(s: string): string {
  const m = /(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?/.exec(String(s || ''))
  if (!m) return ''
  let h = Number(m[1])
  const min = Number(m[2] || 0)
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return `${pad(h)}:${pad(min)}`
}

export function parseVoiceCommand(input: string): ParsedCommand {
  const raw = String(input || '').trim()
  const t = normalizeSpeech(raw)
  const bare = t.replace(FILLER, ' ').replace(SCREEN_WORDS, ' ').replace(/\s+/g, ' ').trim()
  const mk = (kind: ParsedCommand['kind'], extra: Partial<ParsedCommand> = {}): ParsedCommand => ({ kind, raw, ...extra })

  if (!t) return mk('unknown')

  /* ---------------- help / test ---------------- */
  if (/^(what can you do|help|commands|voice commands)$/.test(t)) return mk('help')
  if (/test (the )?(voice|mic|speaking)/.test(t)) return mk('testVoice')

  /* ---------------- day control ---------------- */
  if (/pause (my |the )?day|stop (the )?day for now/.test(t)) return mk('pauseDay')
  if (/resume (my |the )?day|unpause|continue (my |the )?day/.test(t)) return mk('resumeDay')
  if (/\b(start|begin|open|kick off) (the |my )?(day|morning)\b/.test(t)) return mk('startDay')
  if (/\b(end|close|wrap up|finish) (the |my )?day\b/.test(t) || /shut (the )?day down/.test(t)) return mk('endDay')
  if (/\b(what|whats|what is|what are) (still )?(pending|outstanding|open|left|remaining|to do)\b/.test(t)
    || /how much (is|am i) left|pending list|what havem i got/.test(t)) return mk('pendingNow')
  if (/what('s| is| are)? ?(on|due|the plan|today'?s? (plan|day))/.test(t) || /brief(ing)? (me|today)|todays? (plan|briefing)|show (the )?steaks/.test(t)) return mk('whatOnToday')
  if (/what('s| is)? left (today|in the day)?/.test(t)) return mk('whatOnToday')

  /* ---------------- ear on/off ---------------- */
  if (/go to sleep|i am going to sleep|sleep mode|shut (the )?(voice|mic|ear)|voice off|stop listening|be quiet|listen later/.test(t)) return mk('voiceSleep')
  if (/wake (up )?(the )?(voice|mic|ear|ai|habi|name)|start listening|ear on|unmute (the )?(mic|voice|ear)|listen again/.test(t)) return mk('voiceWake')
  if (/^(mute|silence|quiet)( it| all| everything| the (voice|audio|sound|music))?$/.test(t) || /mute (everything|all|the (voice|audio|sound))/.test(t)) return mk('mute')
  if (/^unmute$|unmute (it|the (voice|audio|sound))|speaker on|sound on/.test(t)) return mk('unmute')

  /* ---------------- music / playlist ---------------- */
  if (/shuffle( my| the)? (playlist|songs?|music)?/.test(t) && !/play/.test(t)) return mk('playlistMode', { action: 'shuffle' })
  if (/repeat (one|this (song|track)|the same)/.test(t)) return mk('playlistMode', { action: 'repeat-one' })
  if (/repeat( all| the (playlist|songs?))?/.test(t)) return mk('playlistMode', { action: 'repeat-all' })
  if (/play (the )?playlist (in order|sequentially)|sequential/.test(t)) return mk('playlistMode', { action: 'sequential' })
  if (/\b(stop|pause|quit|resume|continue|play|next|previous|back)\b.*\b(music|playlist|songs?|track|audio)\b/.test(t) || /\b(music|playlist)\b.*\b(stop|pause|play)\b/.test(t)) {
    const act = /next/.test(t) ? 'next' : /previous|\bback\b/.test(t) ? 'prev' : /stop|pause|quit/.test(t) ? 'pause' : 'play'
    return mk('music', { action: act })
  }

  /* ---------------- full-screen ritual ---------------- */
  const fs = /full ?screen (?:the )?(prayer|visualization|visualisation|viz|affirmations?)/.exec(t)
  if (fs) return mk('fullscreen', { target: fs[1] === 'prayer' ? 'prayer' : /^affirm/.test(fs[1]) ? 'affirmation' : 'viz' })
  if (/exit full ?screen|close full ?screen|mini?mise/.test(t)) return mk('fullscreen', { target: 'exit' })

  /* ---------------- affirmations / media ---------------- */
  if (/next affirmation/.test(t)) return mk('affirmation', { action: 'next' })
  if (/prev(ious)? affirmation/.test(t)) return mk('affirmation', { action: 'prev' })
  if (/(play|read|show)( an?| the)? affirmation|affirmation now/.test(t)) return mk('affirmation', { action: 'play' })
  if (/pause (the )?(video|clip|viz|visualization)/.test(t)) return mk('media', { action: 'pauseVideo' })
  if (/play (the )?(video|clip|viz|visualization)/.test(t)) return mk('media', { action: 'playVideo' })
  if (/play (prayer|the prayer) (audio|music|track)/.test(t)) return mk('media', { action: 'playPrayerAudio' })
  if (/^(next|skip)( slide| clip)?$/.test(t)) return mk('media', { action: 'next' })

  /* ---------------- steaks ---------------- */
  if (/delete (the )?steak|remove (the )?steak/.test(t)) return mk('deleteSteak')
  if (/add (a )?(steak|streak)/.test(t) || /new steak/.test(t)) {
    const m = t.match(/(?:steak|streak)(?: named | called | for)?\s*([a-z ]+?)\s*(\d+)\s*days?/)
    if (m) return mk('addSteak', { target: m[1].trim() || undefined, days: Number(m[2]) })
    const one = t.match(/(\d+)\s*days?/)
    const nm = t.replace(/.*steak/, '').replace(/\d+\s*days?.*/, '').trim()
    return mk('addSteak', { target: nm || undefined, days: one ? Number(one[1]) : undefined })
  }
  if (/check(ed)? ?in|mark (it )?done|log (it|today)|done (for )?today|complete[ds]? (the )?(steak|today)/.test(t)) {
    const name = (/(?:check(?:ed)? in|log|mark|complete|finish|done)\s+(?:the\s+)?([a-z ]+?)\s*(?:steak|streak|for today|today|done|complete)?/).exec(t)
    return mk('checkIn', { target: name ? name[1].replace(/\b(steak|streak|today|for|done|complete)\b/g, ' ').trim() : undefined })
  }

  /* ---------------- skip (feature for N days) ---------------- */
  const skip = t.match(/skip\s+(.+?)\s+for\s+(\d+)\s+days?/) || t.match(/skip\s+(.+?)\s+(\d+)\s+days?/)
  if (skip) {
    const target = skip[1].replace(/\b(steak|streak|the|my)\b/g, ' ').trim()
    const ritual = findRitual(target)
    if (ritual) return mk('skip', { ritual, target, days: Number(skip[2]) })
    return mk('skip', { target: target || 'general', days: Number(skip[2]) })
  }
  if (/skip (today|everything|all)/.test(t)) return mk('skip', { target: 'all', days: 1 })

  /* ---------------- alarms ---------------- */
  const rel = /(?:wake me up|wakeup|wake me|remind me|alarm)\s+in\s+(\d+)\s*(minute|min|hour|hr)/.exec(t)
  if (rel) {
    const n = Number(rel[1])
    return mk('wakeupIn', { minutes: /hour|hr/.test(t) ? n * 60 : n })
  }
  if (/\b(stop|dismiss|i am|im)\b.*\balarm\b|\bi am awake\b|\bwake ?up( ed)? already\b|^\s*snooze\b|\balarm (off|done|stop)/.test(t)) {
    return mk('stopAlarm', { action: /snooze/.test(t) ? 'snooze' : 'done', minutes: Number((/snooze\s+(?:for\s+)?(\d+)/.exec(t) || [])[1]) || undefined })
  }
  const alm = /(?:set|create|make) (an? )?alarm (for |at )?(\d{1,2})[\s:]*(\d{2})?\s*(am|pm)?|(?:wake me up|alarm) at (\d{1,2})[\s:]*(\d{2})?\s*(am|pm)?/.exec(t)
  if (alm) {
    const hs = alm[3] || alm[6]
    const ms = alm[4] || alm[7]
    const ap = alm[5] || alm[8]
    let h = Number((alm[3] || alm[6] || '').trim())
    const mi = Number(ms || 0)
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return mk('alarm', { time: `${pad(h)}:${pad(mi)}`, action: alm[0].includes('wake me') ? 'wake' : 'set' })
  }
  const bt = /(?:set |change )?bedtime (at |to |for )?(\d{1,2})[\s:]*(\d{2})?\s*(am|pm)?/.exec(t)
  if (bt) {
    let h = Number(bt[2])
    const mi = Number(bt[3] || 0)
    if (bt[4] === 'pm' && h < 12) h += 12
    if (bt[4] === 'am' && h === 12) h = 0
    return mk('bedtime', { time: `${pad(h)}:${pad(mi)}` })
  }

  /* ---------------- volume ---------------- */
  if (/volume up|increase (the )?volume|louder|speak up/.test(t)) return mk('volume', { action: 'up' })
  if (/volume down|decrease (the )?volume|quieter|softer/.test(t)) return mk('volume', { action: 'down' })

  /* ---------------- task phrases ----------------
     "add high priority task gym bag for tomorrow", "remind me to call mom at 5pm",
     "add daily task meditate" — the word "task" is optional, the rest is the title.        */
  const addTask = /^\s*add\s+(?:a\s+|an\s+|to\s+my\s+)?(?:(high|normal|low)\s+priority\s+|priority\s+(high|normal|low)\s+)?(?:(daily|one[\s-]?time)\s+)?(?:task\s+(?:called\s+|named\s+|to\s+)?)?(.+)$/.exec(t)
  const isTaskIntent = /\b(add|create|new|remind me to|note down|put in)\b/.test(t) && !!addTask
  if (isTaskIntent && addTask) {
    let body = String(addTask[4] || '').trim()
    const forTomorrow = /\bfor tomorrow\b|\btomorrow\b/.test(body)
    const forToday = /\bfor today\b|\btoday\b/.test(body) && !forTomorrow
    const daily = addTask[3] === 'daily' || /\bdaily\b/.test(body)
    const priority: 'high' | 'normal' = (addTask[1] === 'high' || addTask[2] === 'high' || /\bimportant\b|\burgent\b/.test(body)) ? 'high' : 'normal'
    let time: string | undefined
    const atTime = /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/.exec(body)
    if (atTime) time = normTime(atTime[1])
    const title = body
      .replace(/\bdaily\b/g, ' ')
      .replace(/\bone[\s-]?time\b/g, ' ')
      .replace(/\bhigh priority\b|\bnormal priority\b|\bpriority (high|normal|low)\b/g, ' ')
      .replace(/\b(?:for|to|on|til|till)\s+(today|tomorrow|tmrw|tmr)\b/g, ' ')
      .replace(/\b(today|tomorrow|tmrw|tmr)\b/g, ' ')
      .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?/g, ' ')
      .replace(/^[, ]+|[, ]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    // "add a task to the water log" etc. with nothing left is not a task
    if (!title || title.split(' ').length === 1 && ['today', 'tomorrow', 'task', 'up', 'it'].includes(stripPlural(title))) return mk('unknown')
    return mk('addTask', { target: title, days: undefined, time, forTomorrow, forToday, daily, priority })
  }
  const doneTask = /^(?:mark|complete|finish|done|check(?:ed)? off|tick)\s+(.+?)\s*(?:done|as done|complete|off)?$/.exec(t)
  if (doneTask) return mk('toggleTask', { target: doneTask[1].replace(/\b(task|todo|done|complete)\b/g, ' ').trim() })

  /* ---------------- a workout/quick set by name ---------------- */
  const set = /\b(?:give me|i need|start|do|run|open)\s+(\d+\s*[a-z]*\s*(?:pushups|push ups|situps|squats|reps|plank|lunges)|full stretch|stretch|jaw release|neck massage)\b/.exec(t) || /^\s*(\d{1,3}\s*(?:pushups?|push ups|situps?|squats?|reps|lunges?))\b/.exec(t)
  if (set) return mk('openWorkout', { target: set[1].trim() })
  if (/\b(random|another|next) (workout|set|exercise)\b/.test(t) || /^workout$/.test(bare)) return mk('openWorkout')

  /* ---------------- navigation (last, so intents win first) ---------------- */
  if (NAV_VERB.test(t)) {
    const object = t.replace(NAV_VERB, ' ').replace(SCREEN_WORDS, ' ').replace(FILLER, ' ').replace(/\b(the|my|a|an|to|for|please)\b/g, ' ').replace(/\s+/g, ' ').trim()
    const ritual = object ? findRitual(object) : null
    const tab = object ? findTab(object) : null
    if (ritual && (object.includes(stripPlural(ritual).toLowerCase()) || !tab)) return mk('ritual', { tab: 'Rituals', ritual })
    if (tab) return mk('navigate', { tab })
  }
  {
    const ritual = findRitual(bare)
    const tab = findTab(bare)
    const singleWord = bare.split(' ').length <= 2
    if (tab && singleWord) {
      if (ritual && bare.includes(stripPlural(ritual).toLowerCase())) return mk('ritual', { tab: 'Rituals', ritual })
      return mk('navigate', { tab })
    }
    if (ritual && singleWord && !tab) return mk('ritual', { tab: 'Rituals', ritual })
  }

  return mk('unknown')
}

export default parseVoiceCommand
