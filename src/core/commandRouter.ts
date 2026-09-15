/**
 * commandRouter - transcript string -> structured command.
 * Tab ids match the app's activeTab values (capitalized like their Sidebar ids:
 * 'Today','Sleep','Water','Workout','Tasks','Projects','Rituals','Analytics','Settings').
 */
export type Tab = 'Today' | 'Sleep' | 'Water' | 'Workout' | 'Tasks' | 'Projects' | 'Rituals' | 'Analytics' | 'Settings'
export type RitualTab = 'Prayer' | 'Haircare' | 'Skincare' | 'Visualization' | 'Affirmations'

export interface ParsedCommand {
  kind:
    | 'navigate'
    | 'ritual'
    | 'addSteak'
    | 'deleteSteak'
    | 'checkIn'
    | 'steaksLeft'
    | 'skip'
    | 'addTask'
    | 'pauseDay'
    | 'resumeDay'
    | 'media'
    | 'mute'
    | 'unmute'
    | 'alarm'
    | 'stopAlarm'
    | 'wakeupIn'
    | 'bedtime'
    | 'workoutTrigger'
    | 'startDay'
    | 'endDay'
    | 'whatOnToday'
    | 'voiceSleep'
    | 'voiceWake'
    | 'music'
    | 'playlistMode'
    | 'fullscreen'
    | 'volume'
    | 'affirmation'
    | 'help'
    | 'testVoice'
    | 'unknown'
  tab?: Tab
  ritual?: RitualTab
  target?: string
  days?: number
  minutes?: number
  time?: string
  amount?: number
  action?: string
  /** "add task X for tomorrow" */
  forTomorrow?: boolean
  priority?: 'high' | 'normal'
  raw: string
}

const TABS: Record<string, Tab> = {
  today: 'Today',
  sleep: 'Sleep',
  wakeup: 'Sleep',
  water: 'Water',
  workout: 'Workout',
  workouts: 'Workout',
  tasks: 'Tasks',
  task: 'Tasks',
  projects: 'Projects',
  project: 'Projects',
  analytics: 'Analytics',
  settings: 'Settings',
  rituals: 'Rituals'
}
const RITUALS: Record<string, RitualTab> = {
  prayer: 'Prayer',
  haircare: 'Haircare',
  hair: 'Haircare',
  skincare: 'Skincare',
  skin: 'Skincare',
  visualization: 'Visualization',
  viz: 'Visualization',
  affirmations: 'Affirmations',
  affirmation: 'Affirmations'
}

export function parseVoiceCommand(input: string): ParsedCommand {
  const raw = input
  const t = input.toLowerCase().replace(/[^a-z0-9\s:]/g, ' ').replace(/\s+/g, ' ').trim()
  const mk = (kind: ParsedCommand['kind'], extra: Partial<ParsedCommand> = {}): ParsedCommand => ({ kind, raw, ...extra })

  if (!t) return mk('unknown')

  if (/^(what can you do|help|commands)$/.test(t)) return mk('help')
  if (/test (the )?voice/.test(t)) return mk('testVoice')

  // ---------------- steaks / steaks-grid ----------------
  if (/add (a )?steak|new steak|create steak|add streak/.test(t)) {
    const m = t.match(/(?:steak|streak)(?: named | called )?([a-z0-9 ]+?)\s*(\d+)\s*days?/)
    if (m) return mk('addSteak', { target: m[1].trim() || undefined, days: +m[2] })
    return mk('addSteak')
  }
  if (/delete steak|remove steak|delete streak/.test(t)) return mk('deleteSteak')
  if (/check ?in|check ?in today|log today|mark complete|complete the day|checkout|complete |finish |done with /.test(t)) {
    const name = t.match(/(?:complete|check in|finish|mark|checkout|done with)\s+(?:the\s+)?([a-z ]+?)\s*(?:steak|streak|for today|today|done|complete)?$/)
    return mk('checkIn', { target: name ? name[1].replace(/(?:steak|streak|for today|today)/g, '').trim() : undefined })
  }
  if (/what is left|whats left|how many .{0,6}left|what remains|show (my )?steaks/.test(t)) return mk('steaksLeft')

  // ---------------- skip ----------------
  const skip = t.match(/skip\s+(.+?)\s+for\s+(\d+)\s+days?/) || t.match(/skip\s+(.+?)\s+(\d+)\s+days?/)
  if (skip) {
    const target = skip[1].replace(/steak|streak|the|my/g, '').trim()
    if (RITUALS[target]) return mk('skip', { ritual: RITUALS[target], target, days: +skip[2] })
    return mk('skip', { target, days: +skip[2] })
  }
  if (/skip today|skip everything/.test(t)) return mk('skip', { target: 'all', days: 1 })

  // ---------------- day control ----------------
  if (/pause (my |the )?day/.test(t)) return mk('pauseDay')
  if (/resume (my |the )?day|unpause/.test(t)) return mk('resumeDay')
  if (/start (the |my )?day|begin (the |my )?day|good morning (habi|let|start)|day (start|begins?)/.test(t)) {
    return mk('startDay', { action: /prayer|first/.test(t) ? 'primary' : 'quick' })
  }
  if (/end (the |my )?day|close (the |my )?day|wrap up|shut (the )?day/.test(t)) return mk('endDay')
  if (/what('s| is| is)? ?(on|left|due)|whats (on|left)|what do i (have to |need to )?(do|do today)|todays? plan|the plan (for|today)|brief me|briefing|show (my )?steaks|what remains/.test(t)) return mk('whatOnToday')

  // ---------------- voice ear on/off ----------------
  if (/go to sleep|i am going to sleep|sleep mode|shut (the )?(voice|mic|ear)( down)?|voice off|stop listening|be quiet/.test(t)) return mk('voiceSleep')
  if (/wake (up )?(habi|the ai|the mic|you)|start listening|ear on|unmute (the )?(mic|voice|ear)/.test(t)) return mk('voiceWake')

  // ---------------- morning playlist ----------------
  if (/play (my )?(morning )?(playlist|music|songs?)\b/.test(t)) return mk('music', { action: 'play' })
  if (/(stop|pause|quit) (the )?(music|playlist|songs?)\b/.test(t)) return mk('music', { action: 'pause' })
  if (/next (track|song)/.test(t)) return mk('music', { action: 'next' })
  if (/previous (track|song)|back one/.test(t)) return mk('music', { action: 'prev' })
  if (/shuffle/.test(t)) return mk('playlistMode', { action: 'shuffle' })
  if (/repeat (one|this song|this track)/.test(t)) return mk('playlistMode', { action: 'repeat-one' })
  if (/repeat (all|the playlist|songs?)/.test(t)) return mk('playlistMode', { action: 'repeat-all' })
  if (/play (the )?playlist in order|sequential play/.test(t)) return mk('playlistMode', { action: 'sequential' })

  // ---------------- full screen rituals ----------------
  const fsFull = t.match(/full ?screen (?:the )?(prayer|visualization|viz|affirmation)/)
  if (fsFull) {
    const which = fsFull[1] === 'prayer' ? 'prayer' : fsFull[1] === 'affirmation' ? 'affirmation' : 'viz'
    return mk('fullscreen', { target: which })
  }

  // ---------------- tasks ----------------
  const taskM =
    t.match(/^(?:add|create) (?:a )?(?:(high|normal|low) priority |priority (high|normal|low) )?task (.+)/) ||
    t.match(/^(?:add|remind|note) (.+)$/)
  if (taskM) {
    const spokenPriority = taskM[1] || taskM[2]
    let body = taskM[3] || taskM[1] || ''
    const forTomorrow = /\bfor tomorrow\b|\btomorrow\b/.test(body)
    const priority = (spokenPriority === 'high' || /\bhigh priority|priority high|important|urgent/.test(body))
      ? 'high' as const
      : 'normal' as const
    body = body
      .replace(/\bfor tomorrow\b/g, ' ')
      .replace(/\btomorrow\b/g, ' ')
      .replace(/\bhigh priority\b|\bpriority high\b|\bimportant\b|\burgent\b/g, ' ')
      .replace(/^task\b/, ' ')
      .trim()
    const atTime = body.match(/^(.+?) at (\d{1,2}(?::?\d{2})?\s*(?:am|pm)?)$/)
    return mk('addTask', {
      target: (atTime ? atTime[1] : body).trim(),
      time: atTime ? normTime(atTime[2]) : undefined,
      forTomorrow,
      priority
    })
  }

  // ---------------- media / mute ----------------
  if (/\bmute\b|mute (all|it|everything|the (audio|videos?|clips?))|global mute|stop (the )?audio/.test(t)) return mk('mute')
  if (/unmute (all|everything)/.test(t)) return mk('unmute')
  if (/pause (the )?(video|clip|viz)/.test(t)) return mk('media', { action: 'pauseVideo' })
  if (/play (the )?(video|clip|viz)/.test(t)) return mk('media', { action: 'playVideo' })
  if (/play next|next (slide|clip|prayer|viz)/.test(t)) return mk('media', { action: 'next' })
  if (/play prayer audio|play prayer (music|track)/.test(t)) return mk('media', { action: 'playPrayerAudio' })

  // ---------------- affirmations ----------------
  if (/play affirmations?/.test(t)) return mk('affirmation', { action: 'play' })
  if (/next affirmation/.test(t)) return mk('affirmation', { action: 'next' })

  // ---------------- alarms ----------------
  if (/stop (the )?alarm|dismiss alarm|i am awake|im awake|wake up already|snooze alarm|snooze$/.test(t)) return mk('stopAlarm', { action: /snooze/.test(t) ? 'snooze' : 'done' })
  const rel = t.match(/(?:wake me up|wakeup|wake me|remind me) in (\d+) min/)
  if (rel) return mk('wakeupIn', { minutes: +rel[1] })
  const alm = t.match(/(?:set alarm for|set alarm|wake me up at|alarm at)\s+(\d{1,2})[\s:]*(\d{2})?\s*(am|pm)?/)
  if (alm) {
    let h = +alm[1]
    const m = +(alm[2] || 0)
    if (alm[3] === 'pm' && h < 12) h += 12
    if (alm[3] === 'am' && h === 12) h = 0
    return mk('alarm', { time: `${pad(h)}:${pad(m)}` })
  }
  const bt = t.match(/(?:set bedtime|bedtime at)\s+(\d{1,2})[\s:]*(\d{2})?\s*(am|pm)?/)
  if (bt) {
    let h = +bt[1]
    const m = +(bt[2] || 0)
    if (bt[3] === 'pm' && h < 12) h += 12
    if (bt[3] === 'am' && h === 12) h = 0
    return mk('bedtime', { time: `${pad(h)}:${pad(m)}` })
  }

  // ---------------- workout trigger ----------------
  if (/trigger (a )?workout|random workout|workout popup|start workout/.test(t)) return mk('workoutTrigger')

  // ---------------- volume ----------------
  if (/volume up|increase volume|louder/.test(t)) return mk('volume', { action: 'up' })
  if (/volume down|decrease volume|quieter/.test(t)) return mk('volume', { action: 'down' })

  // ---------------- navigation ----------------
  const nav = t.match(/(?:go to|open|show|navigate to|switch to)\s+(?:the\s+)?([a-z ]+?)$/)
  if (nav) {
    const key = nav[1].replace(/page|tab|section|module|panel/g, '').trim()
    if (RITUALS[key] && Object.keys(RITUALS).some((r) => key.includes(r))) {
      const rkey = Object.keys(RITUALS).find((r) => key.includes(r))!
      return mk('ritual', { tab: 'Rituals', ritual: RITUALS[rkey] })
    }
    if (TABS[key]) return mk('navigate', { tab: TABS[key] })
    for (const k of Object.keys(TABS)) if (key.includes(k)) return mk('navigate', { tab: TABS[k] })
    for (const r of Object.keys(RITUALS)) if (key.includes(r)) return mk('ritual', { tab: 'Rituals', ritual: RITUALS[r] })
  }
  // bare feature word ("water", "settings")
  for (const k of Object.keys(TABS)) if (t === k) return t === 'workout' ? mk('workoutTrigger') : mk('navigate', { tab: TABS[k] })
  for (const r of Object.keys(RITUALS)) if (t === r) return mk('ritual', { tab: 'Rituals', ritual: RITUALS[r] })

  return mk('unknown')
}

function normTime(s: string): string {
  const m = s.match(/(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?/)
  if (!m) return ''
  let h = +m[1]
  const min = +(m[2] || 0)
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return `${pad(h)}:${pad(min)}`
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
