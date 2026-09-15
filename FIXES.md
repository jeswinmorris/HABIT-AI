# HABIT.AI v5.2 — what was broken and what changed

## Blocking bugs (app was partly dead before this)

1. **Vite config never loaded.** It lived at `src/vite.config.mts`; Vite only reads the config at the
   project root. Two consequences: `base: './'` was lost, so the **packaged Electron app rendered a
   blank window** (`dist/index.html` asked for `/assets/...` from the filesystem root), and the
   cross-origin isolation headers the offline speech model needs were never sent.
   → moved to `vite.config.ts`.
2. **`optimizeDeps.exclude: ['vosk-browser']` broke `npm run dev`.** vosk-browser ships a UMD file
   behind an ESM `module` field, so without pre-bundling the browser dies on
   *"does not provide an export named 'createModel'"* and **the whole app never mounts**.
   → `include: ['vosk-browser']`. Piper/onnx left lazy (including them made the first page load
   block for tens of seconds).
3. **The Electron database bridge was never connected.** `electron/preload.cjs` exposed only
   `electronAPI = { platform }`, while the renderer talks to `window.habitAI.db.*` /
   `window.habitAPI.getModelPath()`. So SQLite persistence silently never happened, native
   notifications never fired, and the speech model path could not be resolved.
   → preload now exposes the real bridge; `main.cjs` adds a `habicore://` asset scheme plus
   `voice:model-path`, `tts:paths` and `db:reset` IPC.
4. **Voice input was mute-deaf (the reported bug).** Four causes, all fixed:
   - push-to-talk built the recognizer with a **6-phrase grammar**, so anything else decoded to
     `[unk]` and was thrown away;
   - the offline model file was missing/not resolvable (no `public/` in the project);
   - no partial transcripts, so nothing appeared while you spoke;
   - failures were silent. Now: unrestricted decode + hinted wake word, model path resolution
     (IPC → `public/habi-model.tar.gz` → custom path), **platform-speech fallback** when the
     offline model is absent, and a live engine badge in the voice bar (`VOSK READY` /
     `SYSTEM SPEECH` / `MIC BLOCKED` / `SPEECH ERROR`) plus detail text in Settings • Voice.
   - also added: `npm run model` (`download-model.js`) and a completed `download-piper.js`.
5. **`globalMuted` was ignored.** `speakingModel` checked `st.muted`; the state key is
   `globalMuted`, so muting never muted anything. Settings volume/pitch/speed/voice were also
   decorative — they are now applied to TTS.
6. **UTC vs local day.** Mix of `toISOString().slice(0,10)` (UTC) and local day keys: a steak
   created "today" read back as day 2, water logs landed on yesterday, midnight resets fired at the
   wrong wall-clock time. Everything goes through `src/lib/clock.ts` now (`dayKey`, `todayKey`,
   `localDayOf`, `weekdayOf`, `toMinutes`, `onClock`, `onNewDay`).
7. **State save clobbered the day phase.** The persistence effect stored only ~20 whitelisted keys
   and overwrote everything else (including `day`, written by the flow engine), so the day snapped
   back to "unstarted" and `userName` never survived. → single throttled merge-save; transient UI
   flags (dialogs, full screen, ringing) are never persisted or restored.
8. **Two sources of truth for tasks.** `TasksView` kept its own list filtered by `date`, while voice
   added tasks without a `date`, and TasksView then overwrote `habitOS_tasks` with today-only rows,
   deleting the rest. → one task store in context + `habitOS_tasks` (real date + priority sort).
9. **Uploaded media died on restart.** Every uploader stored `URL.createObjectURL(file)` in
   localStorage — invalid after reload (that's the "music/video/affirmations not playing"
   symptom). → bytes go to IndexedDB (`src/lib/mediaStore.ts`) and JSON keeps a `media:<id>`
   marker, resolved with `useMediaUrl()`.
10. Two ringer loops (SleepView + AppContext) nagged each other; `dayRollover.ts` was dead code;
    the 12 AM reset in TasksView wiped every date except today; dead StrictMode double-mount ran
    the mic/intervals twice. All removed/gone.

## Behaviour you asked for

- **Voice bar** shows your words live (partial transcript with a cursor), your final transcript,
  and the AI's reply, plus a stop-speaking button and the engine badge.
- **Day phases**: `unstarted → ringing → briefing → active → ended`. Until you press/say
  **Start the day**, nothing reminds, nudges or plays. Alarms still ring (that's how you wake up).
  Pause day / resume day unchanged.
- **Today page**: *Skip viz* gone; **Snooze alarm** then **Close alarm** instead; the big button is
  now **Start the day** (was Trigger Random Workout). "Morning order" strip = prayers →
  affirmations → primary workout.
- **Close alarm** → the full-screen **briefing**: steaks due on *this weekday*, the day-of-week
  water plan, today's to-dos (priority order), projects in flight, primary workout — spoken out
  loud, then your **morning playlist** starts. Then Start the day.
- **Steaks**: their column stands on its own — no reminders, no nagging, no evening sweep for them.
- **Tasks**: Today + **Tomorrow** columns side by side; add mid-day or before you close the day;
  always sorted (undone → high priority → oldest). Voice: *"add high priority task X for tomorrow"*.
- **Workout**: each session is **Primary** (full stretch, comes up once prayers + affirmations are
  ticked) or **Secondary** (random set, e.g. "20 pushups", nudged between Start and End of day,
  only on your active weekdays — never while paused, asleep, or while music/affirmations play).
- **Rituals**: Prayer and Visualization open **full screen** (big text/media, contained, no
  overflow, prev/next/dots/mute, Close button, Esc/←/→ keys); voice *"full screen prayer"*.
- **Affirmations**: random mid-day playback when nothing else is running; gap configurable.
- **Settings**: morning playlist (add tracks, play/pause/skip, **shuffle / repeat one / repeat all /
  in order**, volume, auto-play after alarm), playout toggles, active weekdays, **wake the voice
  up** / put it to sleep, clean-data and re-run-onboarding buttons.
- **Mute it / go to sleep** → mutes audio, pauses music and puts the mic to sleep; wake it in
  Settings • Voice (or say *unmute* / *wake up Habi*).
- **Onboarding** on a clean database: permissions first, then *your name*, *AI name*, *wake word*
  (all three required, Continue stays disabled), alarm/bedtime, voice gender, weekdays, playlist,
  and an opt-out "start clean" wipe. Every step after the first can be skipped.
- **Responsive**: sidebar collapses into a scrollable tab strip, right rail appears at ≥1280px,
  voice bar wraps, dialogs scroll; verified with no horizontal overflow at 390/520/560/768/900/
  1024/1280/1360/1400/1800 px, and the Electron window is resizable down to 420px wide.

## After you unzip

```bash
npm install
npm run setup     # once: offline speech model + Piper voice (skippable; speech still works
                  # through the platform engine, and TTS through the built-in voice)
npm run dev:electron
```

First launch runs onboarding. `Settings • Database` shows which driver is live (SQLite when the
Electron build has `better-sqlite3` built, JSON-file fallback, localStorage in the browser).
