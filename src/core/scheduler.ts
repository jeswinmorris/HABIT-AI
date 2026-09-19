// src/core/scheduler.ts - FINAL v4.2
import { dayKey, todayKey, toMinutes, minutesNow } from '../lib/clock'
// Daily slot spreading (08:00-21:00, max 2/hour) + steak reminder scheduling.
export type ScheduledItem = {
  time: string
  label: string
  streakId: string
  amount: number
}

type Steaks = { id: string; name: string }

const START = 8 * 60
const END = 21 * 60

class SmartScheduler {
  /** PRD: 100 reps split=4 => 25x4 spread 08:00-21:00, max 2/hour. */
  getSchedule(streaks: any[] = [], date = new Date()): ScheduledItem[] {
    if (!streaks || streaks.length === 0) return []
    const items: ScheduledItem[] = []
    const startHour = 8
    const endHour = 21
    const slots = (endHour - startHour) * 2
    let slotIndex = 0

    streaks.forEach((s: any) => {
      const split = s.split || 1
      const per = Math.ceil((s.dailyGoal || 0) / split)
      for (let i = 0; i < split; i++) {
        if (slotIndex >= slots) slotIndex = 0
        const hour = startHour + Math.floor(slotIndex / 2)
        const min = (slotIndex % 2) * 30
        items.push({
          time: String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0'),
          label: s.name + ' ' + per + (s.unit || ''),
          streakId: s.id,
          amount: per
        })
        slotIndex++
      }
    })
    return items.sort((a, b) => a.time.localeCompare(b.time))
  }

  /** n evenly spread HH:MM slots inside the day window, max 2/hour. */
  spreadSlots(n: number): string[] {
    const slots: string[] = []
    for (let h = START; h < END; h += 60) {
      slots.push(fmt(h))
      slots.push(fmt(h + 30))
    }
    if (n <= 0) return []
    if (n >= slots.length) return slots
    const out: string[] = []
    const stride = slots.length / n
    for (let i = 0; i < n; i++) out.push(slots[Math.floor(i * stride)])
    return out
  }

  /** One reminder slot per pending steak today, spread + optional 30-min sweep. */
  steakReminderSlots(pending: Steaks[]): { time: string; streakId: string; name: string }[] {
    const times = this.spreadSlots(pending.length)
    return pending.map((p, i) => ({ time: times[i] || '09:30', streakId: p.id, name: p.name }))
  }

  /** Catch-up re-slots from "now + 15min" to 20:30, max 2/hour. */
  catchUpSlots(missed: Steaks[]): { time: string; streakId: string; name: string }[] {
    if (!missed.length) return []
    const now = new Date()
    const nowM = Math.max(START, Math.min(now.getHours() * 60 + now.getMinutes() + 15, END - 30 * missed.length))
    const span = Math.max(1, Math.floor((END - 30 - nowM) / missed.length))
    return missed.map((m, i) => ({ time: fmt(Math.min(END - 30, nowM + i * span)), streakId: m.id, name: m.name }))
  }

  isDue(slotTime: string, graceMinutes = 100): boolean {
    const nowM = minutesNow()
    const sm = toMinutes(slotTime)
    if (Number.isNaN(sm)) return false
    return nowM >= sm && nowM - sm <= graceMinutes && nowM <= END
  }

  /** past the evening line every ~30min while steaks are open */
  eveningSweep(): boolean {
    const now = new Date()
    const nowM = now.getHours() * 60 + now.getMinutes()
    return nowM >= 18 * 60 && nowM <= END && nowM % 30 < 3
  }

  dayOver(): boolean {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes() > END
  }

  alias(streaks: any[] = [], logs: any[] = []) {
    return this.getSchedule(streaks)
  }

  generatePlan(streaks: any[] = [], logs: any[] = []) {
    return this.getSchedule(streaks)
  }

  getRemaining(dailyLogs: any[] = [], streaks: any[] = []) {
    const today = todayKey()
    if (!streaks) return []
    return streaks.filter((s: any) => {
      const logged = dailyLogs
        .filter((l: any) => dayKey(new Date(l.date)) === today && l.streakId === s.id)
        .reduce((a: number, b: any) => a + (b.amount || 0), 0)
      return logged < (s.dailyGoal || 0)
    })
  }
}

function fmt(mins: number) {
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0')
}

export const scheduler = new SmartScheduler()
export const SmartSchedulerClass = SmartScheduler
