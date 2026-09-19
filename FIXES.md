# HABIT.AI — change log

## v5.3 (this build)

### 1. The computer's clock is the only clock
- `src/lib/clock.ts` extended with `systemClock()` (date, weekday, time, IANA zone, locale, UTC offset), `midpointOf`, `dayProgress`, `minutesLeft`, `localStamp`. It is read from the OS every second (`onClock`) and shown live in the title bar, the Today header and the briefing.
- Every habit record, reset and graph is keyed by the **local** calendar day now. Remaining UTC slicing (`toISOString().slice(0,10)`) is gone from the renderer *and* from the SQLite projection in `electron/main.cjs`.
- Nothing seeds a date any more: no "07:42", no "11:42 PM", no placeholder day anywhere.
- After sleep/resume or a screen unlock the main process tells the renderer to re-anchor (`system:resync`) and the plan is rebuilt against the real current time.

### 2. Reminders reach you when the app is hidden or closed (Windows + macOS)
- New main-process scheduler in `electron/main.cjs`: the renderer *arms* upcoming reminders (`reminders:arm`), the main process owns the timers and the `Notification` calls, persists them to `userData/habit-reminders.json`, and re-delivers whatever came due while the app was away (`reminders:missed` → "WHILE YOU WERE AWAY" card + a digest notification).
- Closing the window now hides to the **tray / menu bar** (default; toggle in Settings) so the scheduler keeps running; the tray menu has Open and Quit. `app.setAppUserModelId('com.habitai.app')` set to match the Windows `appId`, otherwise Windows silently drops toasts.
- `powerMonitor` handles suspend/resume, so a laptop that slept through a reminder catches up on wake.
- Everything is local timers + OS notifications: **works with no internet**.
- One place builds the list (`buildArmedList` in `src/core/planner.ts`): the day plan + Sleep's one-time alarms + the wake alarm on mornings the day hasn't started.
- To stay civil, only the *most recent* due item fires per tick; anything older is swallowed silently instead of stacking six pings at you.

### 3. The day plan (one engine, real inputs)
`src/core/planner.ts` builds today's schedule from: the moment you pressed **Start the day**, bedtime, water goal/split, the weekly drink plan with weekday filters, haircare/skincare rows with their own weekday + time, workout rows (kind, primary/secondary, priority, per-item frequency), and today's tasks (daily + one-time). It also emits the two milestones: **midpoint** and **wind-down**.
- Pacing rule you asked for: the primary workout, haircare, skincare, visualization and the fast-repeating sets all sit in the *first half* of the waking day, and at the midpoint the AI pushes if under 50 % of the workout is done.
- Pausing the day silences everything; resuming **re-slots** the remaining morning work into the time that is left instead of marking it overdue.
- Steaks produce no reminders at all and appear only on the Today page.

### 4. Today screen
- Compact day bar with only **Start the day** / **End the day** (aligned, single row), live date + time + "day ends in 3h 40m".
- **Do next • priority** card — one ranked queue (overdue → high priority → morning block → by time) with a one-tap done and a jump to the right tab.
- **Today to do** moved *above* **Morning order**; the affirmations block that used to sit below is gone (it now lives in the right rail).
- Alarm snooze/close buttons removed from the home screen; prompt chips removed; "no reminders"/"N left today" badges removed from the steaks card.

### 5. Affirmations
- Full-screen stage like Prayer/Visualization: **48 px** text, one line at a time, ‹ › navigation, dot strip, Close button, Esc / arrow keys.
- The right rail now carries the affirmation card: **shown, never spoken** by the AI. Play button toggles a single clip on/off (it no longer double-plays), and it pauses the playlist while it runs.
- Random mid-day playout puts the text on screen; only uploaded clips make sound, and never during a pause, before Start the day, after bedtime, or while something else is playing.

### 6. Audio can no longer talk over itself
`src/core/audioBus.ts` — one owner per lane (speech > affirmations/prayer/video > music). A new source suspends the previous one, and the playlist resumes by itself when the lane frees. The morning playlist starts **mild** (0.55, ducked 55 % for the first 30 s) when the day starts.

### 7. Sleep & Wakeup
- Daily recurring alarm list removed (the wake alarm in Settings + the day plan decide timing); one-time Short alarms & reminders kept exactly as they were.
- The invented "Deep 42% / Light 38%" sleep-cycle graphic is replaced by a **Day Report** built from real Start/End stamps: awake window, closed/away gap between days, tasks done/total, workout sets, litres of water, per day; refreshes every 30 s and re-measures as the day runs.

### 8. Water
- +100 ml quick-add alongside 250/500/750.
- Drinks carry weekday filters and a time; plain-water rows spread through the day, everything *not* plain water is announced in the after-wakeup block on its own fixed days (e.g. Mon/Wed/Fri).
- Goal changes rebuild the plan immediately; the weekly/monthly charts show only logged days.

### 9. Workout
- Starts empty: no Chest/Leg demo rows, no invented streak counts, no fake graph series.
- Row kinds: **Strength/cardio, Facial exercise, Massage/mobility**; each row carries priority + primary/secondary and, for quick sets, *your* frequency (30 min, 45, 1 h, 2 h, 3 h).
- "Checkout all done" bulk buttons removed; per-row Done today, group-level skip, and a per-day completion log (`habitOS_workoutDone`) now feed the graphs and analytics.
- Add/edit/retag a row and the plan re-arms within a second, so the reminder for it exists right away; the primary session is pulled forward the moment prayers *and* affirmations are ticked (Morning order chain).
- Clips/photos persist via IndexedDB (`media:<id>`), and attached media pauses when the AI speaks.

### 10. Tasks
- **Daily | Today | Tomorrow** columns. Daily tasks are stored once, ticked per calendar day, and reset on their own at midnight; the reset feeds the completion analytics. One-time tasks keep their dated behaviour.
- "add high priority task X for tomorrow", "add daily task X" both parse; reminders are armed with the OS.

### 11. Rituals
- Haircare and Skincare rows pick their weekdays (Seven-day chips incl. "every day") and a time; the reminder fires only on those days, and rows not due today are visibly tagged.
- Empty states instead of placeholder prayer/visualization/affirmation content; the ✨ decoration removed.

### 12. Talk-back policy
The AI stays quiet for navigation, tab switches, volume, playlist and layout commands (written to the command bar instead) and **speaks only** for the alarm, a reminder/task that needs doing, the day starting or closing, and the briefing. Settings states that policy instead of guessing.

### 13. Onboarding shortened
Permissions → your name + AI name (both required, Continue disabled otherwise; wake word auto-derives to "hey ‹name›") → male/female voice + training days → database. No alarm/bedtime/playlist steps.

### 14. Data
- `src/lib/migrate.ts`: one-time clean slate + `Settings • Clean data to zero` — wipes steaks, tasks, projects, workout rows, ritual slides, water logs/history, alarms, skips, pauses, plan; keeps names, voice, playlist. Also wipes the SQLite mirror through the new `db:reset` IPC.
- Export now uses the native **Save As** dialog on Windows/macOS (`dialog:saveJson`) and includes the computer's platform/time zone; Import reads through the native picker.

### 15. Layout
Rebuilt screens verified at 390, 400, 430, 520, 768, 1024, 1280, 1360, 1440, 1920 px with **zero horizontal overflow** and no clipped text; the design language (colours, radii, card structure, dark palette) is unchanged.

### Kept untouched, as requested
Pause day / Resume day behaviour, the Projects page structure, the stepper/skip modal, the prayer and visualization modules (besides the weekday/haircare additions and full-screen polish).

---

## v5.2 (previous)
Electron/preload + SQLite bridge, Vosk model resolution, unrestricted push-to-talk grammar, live partial transcripts, Web Speech STT/TTS fallbacks, `globalMuted` fix, day phases (unstarted → ringing → briefing → active → ended), IndexedDB media storage, day-boundary flow (snooze/close → briefing → playlist), task priority ordering, offline model install script, packaged-app asset paths.

## After unzipping
```bash
npm install
npm run setup      # offline speech model + Piper voice; skippable (system engines are used until then)
npm run dev:electron
npm run build:win  # or build:mac / build:win:msi
```
First launch runs onboarding. `Settings • Day boundaries & reminders` shows whether OS notifications and the background tray are live; "Send test" proves the notification path end to end.


## v5.3.1 — crash + voice fixes (this round)

### 1. "Clearing the database crashed the app" — fixed at the real cause
The Electron **main process** died with `ReferenceError: deliverMissed is not defined`. The
function had been dropped from `electron/main.cjs`, so every time a window reached
`ready-to-show` — which is exactly what `Settings • Clean data` triggers, because it reloads —
the app died with the native "A JavaScript error occurred in the main process" box.
- `deliverMissed()` restored, with its own try/catch.
- `app.disableHardwareAcceleration()`, `setAppUserModelId()` and `commandLine.appendSwitch()`
  are individually guarded (one unavailable API can no longer abort startup).
- **All 17 IPC handlers** run through `H()`, so a bad payload (`reminders:arm('not an array')`,
  `db:write({key:1})`, `db:import(null)`) logs and returns instead of throwing.
- Top-level `process.on('uncaughtException' | 'unhandledRejection')` in the main process: the
  problem is logged and reported to the renderer; the app stays open.
- Renderer side: `resetHabitData()` now rebuilds the React state from defaults (keeping
  names/voice/playlist/day settings) *before* the disk wipe, so no screen ever reads half a
  cleared store; `dayRecord()` self-heals a missing/garbled `day`; the ErrorBoundary says
  "your data is intact" with **Reload** and **Reload + rebuild the day plan** instead of a dead
  window.
- New guard script, wired to `npm run check:main`, loads the real `electron/main.cjs` with
  Electron/SQLite stubbed and drives every handler, the tray, the reminder timers and the
  "missed while away" path: `node scripts/check-main.cjs` → *no uncaught errors*, and it proves
  a due reminder really fires (`notify:` emitted from the timer).

### 2. Voice reminders now say what is pending
- `pendingVoiceLine()` in `src/core/planner.ts` turns the open plan items into one sentence with
  relative times: *"Still pending today: 4 items — 20 pushups in 6 minutes, Water • 500ml in
  about an hour, …"*
- Every fired reminder appends that recap to its spoken line and to the command bar.
- A **standing recap** repeats on its own (default every 30 min, 10–120 in Settings) once the
  day is at/past its midpoint or 4+ items remain, so nothing silently slides off the day.
- Say **"what is pending"** / "what is left today" / "remind me what's left" for it on demand.
- Right rail renamed **PENDING TODAY** with per-item time, over/late flag, count and jump-to-tab;
  Settings • Day boundaries has the toggle + interval slider.
- Only the single most recent due item fires per tick now, and items older than 3 hours are
  consumed silently — reopening the app no longer hits you with a stack of pings.

### 3. "tasks"/"water" now navigate
`commandRouter.ts` was rewritten for messy transcripts (its syntax error had also made Vite
serve a **stale** router, so earlier fixes weren't reaching the running page — that is gone).
- Wake-word stripping: "hey nico water", "habi tasks" → intent only.
- Digit folding: "go 2 water", "take me to tasks" → `go to …`.
- Near-miss aliases: `tacks`/`tack` → Tasks, `work`/`work out` → Workout, `hydrate`, `gym`,
  `todo`, `checklist`, `report`…, longest-alias-wins so "wakeup alarm" stays Sleep.
- Verified against every phrase in your log: `go to work`, `go to water`, `tasks`, `tacks`,
  `open tasks`, `show the workout page`, `go 2 water`, `what is pending`, `open prayer`,
  `rituals`, `settings`, `analytics`, `go to sleep`, plus `mark gym bag done` and
  `give me 20 pushups`, which now exist as their own intents.
- `add task` no longer accepts an empty/derived-only title (your "add a product to the project
  list" run), and the title keeps "tomorrow" out of it.
- Say "water" / "tasks" → navigates; `workout` → opens the session popup.

### 4. Piper voice actually runs (Settings used to sit on the system voice)
- The package's real API is `TtsSession.create({ voiceId, wasmPaths })` — the old code called a
  `loadVoice()` that does not exist, so TTS always fell back.
- `onnxruntime-web` was an **undeclared peer dependency**: Vite's import analysis threw and
  piper could never load. Declared in `dependencies`, and kept out of the dep optimizer
  (pre-bundling it breaks its runtime `fetch` of the `.wasm`).
- `npm run piper` now pulls the correct set from the constants inside the installed package
  (`piper_phonemize.wasm/.data/.js`, `ort-wasm-simd-threaded.wasm/.mjs`, plus the two voices)
  instead of 404-ing against a moved `rhasspy/piper` path; the onnx `.mjs` glue is copied out of
  `node_modules` because the CDN does not publish it. `wasmPaths` is handed an absolute URL
  (otherwise onnxruntime resolves it beside its own module and 404s).
- `npm run setup` order is now **model first**, and neither script can abort the other: relative
  redirects resolve properly, progress prints per 5 MB, failures report and continue.
- First-run voice downloads report percentage into Settings (`downloading voice en_US-amy-medium
  — 42%`), and `speak()` proceeds with the system voice after 4 s instead of swallowing the
  sentence while a 60 MB model streams.

### Your log, item by item
- `Request Network.enable wasn't found` ×5 and the `Emulation.*` lines are Electron's bundled
  DevTools frontend talking to a protocol it does not have — they were **not** app errors.
  DevTools now only opens with `HABIT_DEVTOOLS=1`, so `npm run dev:electron` stays readable.
- `CB got / CB ran command for` lines were my debug prints; they now log once per utterance.
- `ReferenceError: deliverMissed is not defined` — the crash, fixed above.
- `[vite] Internal server error … expected "}" line 259:26` in commandRouter — that parse failure
  is why the router kept behaving like the old version no matter what I sent you; the file now
  type-checks, parses and is served fresh (verified over HTTP).


## v5.3.2 — the Sleep-page crash from your stack trace

`DayReport.tsx:113 Uncaught TypeError: waterLogs.filter is not a function`
`buildStats` parsed every habit key with `JSON.parse(localStorage.getItem(k) || '{}')` and then
called `.filter()` on it. `habitOS_waterLogs` is an **array** collection, so as soon as that key
was absent — which is precisely what "Clean data" leaves behind — the value came back as `{}` and
the Sleep page threw, taking the whole tree into the ErrorBoundary.

- New `src/lib/store.ts`: `readArray` / `readRecord` / `readNumber` validate the shape they get
  from storage and fall back to `[]` / `{}` / the default instead of guessing.
- Every collection read now goes through them: DayReport (water logs, task-done map, workout
  history), Tasks (daily completion map), Workout (`workoutDone`, segments), Water (logs,
  history, goal, weekly plan), Rituals (slides, audios, affirmations, ritual tasks),
  Projects, Analytics, and `readJSON` inside the store, so an array fallback can never come back
  an object.
- The day report now says **“No day has been started yet”** rather than drawing an empty chart.
- Regression guards shipped as `npm run check:storage`: for every habit key it asserts missing,
  empty-string, `{}`-where-array, `[]`-where-map, `null`/`undefined`/garbage text and the real
  values all behave — including the exact `waterLogs.filter` call site that crashed. Add
  `npm run check` to typecheck + both guard suites in one command.

Verified in the browser: clear the database, then visit all nine tabs; and boot with deliberately
corrupt keys (`habitOS_waterLogs = "{}"`, `taskDone = "[]"`, `streaks = "{"id":1}"`,
`projects = "7"`, `v4_final` with `tasks: null`, `planDone: {}`, `reminderLog: null`) —
every tab renders with **zero errors**, before and after reload.


## v5.3.3 — wrong-day report, false "done", and notification spam

Your screenshot showed three separate problems behind one symptom.

**1. The day was closing hours early — and announcing it.**
The bedtime check compared clock *strings*: `"22:36" >= "02:00"` is true, so with a 02:00 bedtime the
engine decided at 10:36 pm that bedtime had passed → `HABIT.AI — SLEEP · Bedtime 02:00 — closing the
day`, `DAY CLOSED`, `DAY STARTED`, `NEW DAY` toasts, and a day that ended before it began.
- Bedtime is now wrap-safe arithmetic (`((now − bedtime) mod 1440) < 120`), so the day only closes
  inside the two hours *after* your bedtime, whichever side of midnight that is.
- Notifications reduced to what needs action only: the wake alarm, and scheduled workout / task /
  daily / drink / ritual items. Day-open, day-close, bedtime, new-day, midpoint and "missed digest"
  toasts are gone (the digest still appears as the in-app card).
- Those actionable items are now **spoken** as well as notified; milestones and the standing recap
  are spoken without a toast.

**2. Overdue work was being marked as done.**
Anything more than three minutes late — which is everything, whenever you start your day after the
plan's morning times — was committed to `planDone`. That is why the rail said "PENDING TODAY · 0
open · Day clear", the top bar said "90% of the day plan done", and the primary workout looked
finished while it wasn't.
- `planDone` (you actually completed it) and `planNotified` (the AI already said it) are now
  separate; nothing is ever marked complete by the passage of time.
- Starting or resuming the day **re-anchors** the schedule into the time that is left, so items
  are born pending, not overdue.
- Late items stay visible and are labelled *Overdue / Running late* in the spoken reminder and the
  PENDING TODAY list.

**3. "It's always Friday"** — that was your **AI name**.
The response card was headed `{aiName} • response`, which reads like a weekday. The header now
shows the real day ("Saturday • Friday's note"), and every spoken/written day line states the OS
date: *"Good morning. It is Saturday, September 19, and the day starts now. You have 1 task today:
Ship the fix. 1 project in flight: Habit OS at 45 percent. No primary workout added yet. No drinks
scheduled. There are 7 scheduled items on the plan between now and 02:00."*
- With nothing on the list it says **"There is no task on the list for today."** instead of a
  vague summary; the Today card mirrors it ("There is no task for today").
- **Daily tasks now appear on Today** — the list was filtering on the stored creation date, so a
  daily task created yesterday silently vanished. Daily, once, today and tomorrow all resolve
  against the system date.
- The Morning order strip reads the actual completion map: `Primary • 0/1 done` → `1/1` when you
  press Done in the Workout page, and "nothing added" is shown as **not finished**.
- Corrupt storage can no longer take the app down: the hydrated state is passed through
  `sanitizeState()` (arrays stay arrays, dates must parse, unknown day phases fall back, records
  without a name/title are dropped). Verified with a database where every collection was replaced
  by the wrong type (`waterLogs={}`, `taskDone=[]`, `streaks={"a":1}`, `projects=7`,
  `v4_final` with `tasks:null`, `planDone:{}`, `reminderLog:"nope"`, `day.startedAt:"not-a-date"`)
  — all nine tabs render, the plan rebuilds, and there are no console errors.


## v5.3.5 — the weekday chips you could not see yourself clicking

Screenshots showed all seven day chips looking identical, so clicking appeared to do nothing.
`bg-white/5` against the dark card was not a real difference — every state looked "selected".

- Ticked days are now **violet-filled with a check mark and a glow**; unticked days are
  **dashed and transparent with an empty ring** — unmistakable at a glance, and keyboard
  focusable with a visible ring.
- `aria-pressed` on every chip (screen readers, and this is how the click test asserts state).
- A live sentence under the row says what will happen: **“Will remind on: Tue, Sat”** or
  **“Nothing is reminded until you tick at least one day.”**
- `every day` / `clear` shortcuts, each reflected in the helper line.
- Every weekday verified: `Mon→on/off-ok`, `Tue…Sun` identical, for **Haircare and Skincare**, in
  both the Add form and the **Edit** form (Edit reopens with Tue/Fri pre-ticked from the row).
- Saved row came back exactly as `days: ["Tue","Fri"], time: "08:20"`, and saving without a time
  refuses with a visible hint. Row badges are colour-coded, e.g. `Mon Thu • 07:15` (amber
  `no days picked` when a legacy row has none).

## v5.3.4 — weekday picker and the reminder drip

### Haircare / Skincare: you could pick a time but not the day
`Editors` receives its data from the page, but the day/time state was threaded through props that
were never actually passed — so the weekday row always rendered "all selected", clicking a day did
nothing, and the value saved was the old default.
- The weekday and time state now lives **inside the editor** (`DayPicker`), so clicks register.
- **Every day starts unticked.** You tick the days you actually do the routine; `every day` is a
  shortcut and `clear` empties it. Clicking a ticked day unticks it.
- **Same picker inside Edit**, plus the time field — you can fix a routine's schedule after saving
  it, which was impossible before.
- Each row shows its schedule as a badge, e.g. `Oil and comb · Mon Thu • 07:15`, or `every day`.
- Saving without a day (or time) is refused with a visible reason and stores nothing.
- An empty day list means **never**, not "every day" — the planner agrees, so a Mon/Thu routine is
  absent from Saturday's plan (verified).

### The reminder drip (every 10–30 seconds) was arithmetic
Two compounding bugs, both fixed in `src/core/planner.ts`:
1. The plan anchored to the **earlier** of the alarm time and your actual start. Starting at 22:00
   with a 07:00 alarm therefore produced 06:00–07:00 times — every item was born overdue, and the
   engine released one per tick, forever.
2. With a bedtime past midnight, the "day length" was `02:00 − 23:40` = **negative**, so the
   spread collapsed: your six water sips landed ~1 minute apart.

- The plan is now computed on one continuous "minutes since the day started" axis, so wrapping
  across midnight is normal and nothing is scheduled behind the clock.
- Water sips are spaced **no closer than 20 minutes**; a short remaining day automatically means
  fewer, larger sips covering the same goal.
- A reminder never fires within `reminderGapMin` (Settings, default 25 min) of the previous one,
  whatever the backlog size. Overdue items stay visible on **PENDING TODAY** and are announced as
  *"Running late — …, N more items still open from earlier"*, never as a stream.
- `planDone` (you finished it) and `planNotified` (it was announced) are separate sets, so a
  pending item can never be reported complete by the clock.
- `npm run check:planner` locks the rules in: late-start anchoring, midnight wrap, ≥20-minute
  spacing, full-day 6×500 ml spread, and a named regression guard for the negative-window bug.
