import { useApp } from '../../store/AppContext'
import { Check, Clock, Flag, PlayCircle, ChevronRight } from 'lucide-react'
import { minutesNow, toMinutes, dayKey } from '../../lib/clock'

/**
 * Today's priority list — one ranked queue instead of five separate reminders.
 * Rank: overdue first-half items, then high priority, then whatever is due within the hour,
 * then the rest by time. Tick a line to mark that scheduled item done.
 */
const KIND_LABEL: Record<string, string> = {
  water: 'water', drink: 'drink', ritual: 'ritual', visualization: 'visualization',
  'workout-primary': 'primary workout', 'workout-secondary': 'quick set',
  task: 'task', daily: 'daily task', midpoint: 'milestone', bedtime: 'wind down'
}

export function PriorityNow() {
  const app = useApp() as any
  const { planItems = [], planDone = [], markPlanItem, dayPhase, setActiveTab, setShowWorkoutPopup, setWorkoutPopupTask } = app
  const done = new Set((planDone || []).map(String))
  const now = new Date()
  const nowM = minutesNow(now)
  const open = (planItems as any[])
    .filter((i) => !done.has(i.id))
    .filter((i) => i.kind !== 'midpoint' && i.kind !== 'bedtime')
    .map((i) => {
      const dueIn = toMinutes(i.time) - nowM
      const score = (i.at < now.getTime() ? -100000 + (now.getTime() - i.at) / 60000 : dueIn)
        + (i.priority === 'high' ? -50 : 0) + (i.morning ? -25 : 0)
      return { ...i, dueIn, score }
    })
    .sort((a, b) => a.score - b.score)

  const top = open.slice(0, 6)
  const act = (item: any) => {
    if (item.kind === 'workout-primary' || item.kind === 'workout-secondary') {
      setWorkoutPopupTask?.(item.workout || { name: item.title, reps: item.body, slot: item.kind === 'workout-primary' ? 'primary' : 'secondary' })
      setShowWorkoutPopup?.(true)
      return
    }
    setActiveTab?.(item.goTo || 'Today')
  }

  return (
    <div className="bg-[#141418] border border-white/10 rounded-xl p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Flag className="w-4 h-4 text-amber-300 shrink-0" />
          <div className="text-sm font-semibold text-white whitespace-nowrap">Do next • priority</div>
        </div>
        <div className="text-[11px] text-white/30 shrink-0">{dayPhase === 'active' ? `${open.length} open` : 'starts when you start the day'}</div>
      </div>

      {top.length === 0 ? (
        <div className="text-[12px] text-emerald-300/80 py-2">{dayPhase === 'active' ? 'Nothing pending — everything for today is done or nothing is scheduled. Add tasks on the Tasks page.' : 'Start the day to load today’s plan.'}</div>
      ) : (
        <div className="space-y-1.5">
          {top.map((i) => {
            const overdue = i.dueIn < 0
            return (
              <div key={i.id} className="flex items-center gap-2 p-2 rounded-xl bg-[#0e0e12] border border-white/5 min-w-0">
                <button onClick={() => act(i)} className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0 hover:bg-white/10" title="Open">
                  <PlayCircle className="w-4 h-4 text-white/55" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-white/85 truncate flex items-center gap-1.5">
                    <span className="truncate">{i.title}</span>
                    {i.priority === 'high' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 shrink-0">high</span>}
                  </div>
                  <div className="text-[10px] text-white/30 truncate flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    <span className="tabular-nums">{i.time}</span>
                    <span className="text-white/15">•</span>
                    <span>{KIND_LABEL[i.kind] || i.kind}</span>
                    {overdue && <span className="text-amber-200/80">• {Math.abs(Math.round(i.dueIn))}m over</span>}
                    {!overdue && i.dueIn > 0 && <span className="text-white/25">• in {Math.round(i.dueIn)}m</span>}
                  </div>
                </div>
                <button onClick={() => markPlanItem?.(i.id, true)} className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0" title="Mark done">
                  <Check className="w-3.5 h-3.5 text-white/45" />
                </button>
                <button onClick={() => (document.querySelector('#nav-' + (i.goTo || 'Today')) as HTMLElement | null)?.click()} className="w-6 h-6 flex items-center justify-center text-white/25 shrink-0 hover:text-white/60" title={`Go to ${i.goTo}`}>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {open.length > top.length && <div className="mt-2 text-[10px] text-white/20">+{open.length - top.length} more scheduled later today</div>}
    </div>
  )
}

export default PriorityNow
