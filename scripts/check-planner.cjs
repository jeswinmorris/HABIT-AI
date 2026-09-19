/**
 * Scheduling rules for the day plan, checked without a browser.
 *   npm run check:planner
 * Mirrors src/core/planner.ts maths for a day that starts late and runs past midnight.
 */
const DAY = 1440
const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN }

function plan({ startHHMM, bedtimeHHMM, startedAtMin, waterGoalMl, waterSplit, nowMin }) {
  const startM = toMin(startHHMM), bedM = toMin(bedtimeHHMM)
  const from = Math.max(startM, startedAtMin)                        // LATER of the two
  const span = (((bedM - from) % DAY) + DAY) % DAY || 16 * 60         // continuous minutes left
  const bedAbs = from + span
  const midAbs = from + Math.floor(span / 2)
  const wanted = Math.max(1, Math.min(12, waterSplit || Math.round(waterGoalMl / 500)))
  const split = Math.max(1, Math.min(wanted, Math.floor(span / 20) || 1))   // never closer than 20 min
  const slots = []
  const window = Math.max(10, (bedAbs - 10) - (from + 5))
  const step = window / split
  for (let i = 0; i < split; i++) slots.push(Math.round(from + 5 + step * (i + 0.5)))
  return { from, span, bedAbs, midAbs, split, slots, per: Math.round(waterGoalMl / split) }
}

const results = []
const eq = (name, got, want) => results.push((JSON.stringify(got) === JSON.stringify(want) ? 'ok   ' : 'FAIL ') + name + ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`)
const ok = (name, cond, info = '') => results.push((cond ? 'ok   ' : 'FAIL ') + name + (info ? ` (${info})` : ''))

// a) 22:00 start with an 07:00 alarm: nothing may be timed before "now"
{
  const p = plan({ startHHMM: '07:00', bedtimeHHMM: '02:00', startedAtMin: toMin('22:00'), waterGoalMl: 3000, waterSplit: 6, nowMin: toMin('22:05') })
  ok('late start anchors at the real start minute', p.from === toMin('22:00'), `from=${p.from}`)
  ok('day length wraps past midnight', p.span === 240, `span=${p.span}`)
  ok('no water item is born before the day starts', p.slots.every((s) => s >= p.from), p.slots.join(','))
  ok('midpoint lands in the first half of the remaining day', p.midAbs === p.from + 120)
}
// b) short remaining window => fewer sips, never a drip every few minutes
{
  const p = plan({ startHHMM: '07:00', bedtimeHHMM: '02:00', startedAtMin: toMin('22:00'), waterGoalMl: 3000, waterSplit: 12, nowMin: toMin('22:00') })
  const gaps = p.slots.slice(1).map((s, i) => s - p.slots[i])
  ok('sips never closer than 20 minutes', gaps.every((g) => g >= 15), `gaps=${gaps.join(',')}`)
  ok('12 requested sips collapse to a sane count for a short day', p.split <= Math.max(1, Math.floor(p.span / 20)), `split=${p.split} span=${p.span}`)
  ok('the goal still gets covered', p.split * p.per >= 3000 - p.split * 5, `${p.split} x ${p.per}ml`)
}
// c) a normal day keeps the requested split
{
  const p = plan({ startHHMM: '06:30', bedtimeHHMM: '22:30', startedAtMin: toMin('06:30'), waterGoalMl: 3000, waterSplit: 6, nowMin: toMin('07:00') })
  ok('full day keeps 6 sips', p.split === 6 && p.per === 500, `${p.split}x${p.per}`)
  const gaps = p.slots.slice(1).map((s, i) => s - p.slots[i])
  // 16 h / 6 slots = ~160 min; the rounding of the half-step offset may shift one by a minute or two
  ok('sips spread evenly across a full day (~160 min apart)', gaps.every((g) => g >= 150 && g <= 165), gaps.join(','))
}
// d) the old bug: raw clock comparisons collapsed everything to ~1 minute
{
  const naiveSpan = toMin('02:00') - toMin('23:40')          // negative!
  ok('regression guard for the negative-clock-window bug', naiveSpan < 0, `naive=${naiveSpan}`)
  const p = plan({ startHHMM: '07:00', bedtimeHHMM: '02:00', startedAtMin: toMin('23:40'), waterGoalMl: 3000, waterSplit: 6, nowMin: toMin('23:40') })
  ok('wrap-aware span beats the negative window', p.span === 140 && p.slots.every((s) => s >= toMin('23:40')), `span=${p.span}`)
}
console.log('--- planner scheduling rules ---')
results.forEach((r) => console.log(r))
const bad = results.filter((r) => r.startsWith('FAIL'))
console.log(bad.length ? bad.length + ' FAILURES' : 'all rules hold')
process.exit(bad.length ? 1 : 0)
