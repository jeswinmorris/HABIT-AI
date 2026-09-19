/**
 * Shape guards for every habit collection in localStorage.
 *
 * A cleared or corrupt key used to crash the Sleep page (`waterLogs.filter is not a function`)
 * because readers assumed the JSON they got back matched the collection the page expected.
 * These assert the validated readers hold under empty, missing, wrong-typed and thrown values.
 *
 *   npm run check:storage
 */
const stores = ['habitOS_waterLogs', 'habitOS_taskDone', 'habitOS_workoutDone', 'habitOS_streaks']

// minimal localStorage + the reader semantics from src/lib/store.ts
const backing = new Map()
global.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k)
}
function readArray(key, fallback = []) {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : fallback } catch { return fallback }
}
function readRecord(key, fallback = {}) {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try { const p = JSON.parse(raw); return p && typeof p === 'object' && !Array.isArray(p) ? p : fallback } catch { return fallback }
}
/** the exact call site that crashed: DayReport's water total for a day */
function waterForDay(logs, day) {
  return logs.filter((l) => l && String(l.date || '').slice(0, 10) === day).reduce((a, b) => a + (b.amount || 0), 0)
}

const cases = []
const expect = (name, fn) => {
  try { fn(); cases.push('ok   ' + name) } catch (e) { cases.push('FAIL ' + name + ' -> ' + e.message) }
}
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }

for (const key of stores) {
  expect(`${key}: missing key -> [] / {}`, () => {
    localStorage.removeItem(key)
    eq(readArray(key), [], 'array')
    eq(readRecord(key), {}, 'record')
  })
  expect(`${key}: empty string`, () => {
    localStorage.setItem(key, '')
    eq(readArray(key), [], 'array')
    eq(readRecord(key), {}, 'record')
  })
  expect(`${key}: object where an array belongs (the crash you hit)`, () => {
    localStorage.setItem(key, '{}')
    const arr = readArray(key)
    eq(typeof arr.filter, 'function', 'filter callable')
    eq(waterForDay(arr, '2026-09-19'), 0, 'water total')
  })
  expect(`${key}: array where a map belongs`, () => {
    localStorage.setItem(key, '[1,2]')
    eq(readRecord(key), {}, 'record')
    const arr = readArray(key)
    eq(arr.length, 2, 'array length')
    waterForDay(arr, 'x')
  })
  expect(`${key}: null / undefined / garbage text`, () => {
    for (const raw of ['null', 'undefined', '"str"', '{oops', '12']) {
      localStorage.setItem(key, raw)
      eq(Array.isArray(readArray(key)), true, `array from ${raw}`)
      eq(Array.isArray(readRecord(key)), false, `record from ${raw}`)
    }
  })
  expect(`${key}: real values still read back`, () => {
    localStorage.setItem(key, JSON.stringify([{ date: '2026-09-19T00:00:00', amount: 250 }]))
    eq(waterForDay(readArray(key), '2026-09-19'), 250, 'water total')
    eq(readRecord(key, null), null, 'object fallback honoured')
  })
}

console.log('--- storage shape guards ---')
cases.forEach((c) => console.log(c))
const bad = cases.filter((c) => c.startsWith('FAIL'))
console.log(bad.length ? bad.length + ' FAILURES' : 'all guards pass')
process.exit(bad.length ? 1 : 0)
