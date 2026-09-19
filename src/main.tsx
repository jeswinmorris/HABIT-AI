import './lib/db' // MUST be first: installs localStorage->SQLite mirror before any module reads storage
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { AppProvider } from './store/AppContext'
import { installWriteThrough, hydrateFromDB } from './lib/db'
import { runMigrations } from './lib/migrate'

// The whole app persists through localStorage keys (habitOS_*).
// Patch first so every write (ours + DB restore below) is mirrored into SQLite.
installWriteThrough()
// one-time clean slate: no placeholder steaks / tasks / projects / slides anywhere
runMigrations()

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; err: any }> {
  state = { hasError: false, err: null }
  static getDerivedStateFromError(err: any) { return { hasError: true, err } }
  componentDidCatch(e: any, info: any) { console.error('App crash:', e, info) }
  private recover = (wipeState = false) => {
    if (wipeState) {
      // the last-resort reset only drops the derived habit state, never your names,
      // voice settings, playlist or the day record
      try {
        const raw = localStorage.getItem('habitOS_v4_final')
        if (raw) {
          const st = JSON.parse(raw)
          delete st.plan
          delete st.planDone
          delete st.briefing
          delete st.ringAlarm
          delete st.affirmCard
          localStorage.setItem('habitOS_v4_final', JSON.stringify(st))
        }
      } catch {}
    }
    this.setState({ hasError: false, err: null })
    setTimeout(() => window.location.reload(), 50)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050507] text-white p-6 flex flex-col items-start gap-4">
          <h2 className="text-base font-semibold">HABIT.AI hit an error — your data is intact</h2>
          <p className="text-xs text-white/45 max-w-xl">Nothing was deleted. {String(this.state.err).slice(0, 400)}</p>
          <pre className="max-w-full text-[11px] text-white/35 whitespace-pre-wrap bg-white/5 p-3 rounded-xl border border-white/10 max-h-40 overflow-auto">{String((this.state.err as any)?.stack || this.state.err || '')}</pre>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => this.recover(false)} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold">Reload</button>
            <button onClick={() => this.recover(true)} className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-white/70 text-xs">Reload + rebuild the day plan</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/* A stray render error should not leave a dead window: report it and let the boundary recover. */
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => console.error('[app] unhandled promise:', e.reason))
}

async function boot() {
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('root not found')
  // Electron: restore habitOS_* collections from habit.db before any view mounts
  await hydrateFromDB().catch(() => undefined)
  ReactDOM.createRoot(rootEl).render(
    // StrictMode is off on purpose: its intentional double-mount starts the mic, the alarm
    // interval and the Vosk recognizer twice, and the second teardown can leave the first
    // one orphaned. This app has one tree, so the double-invoke buys nothing.
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  )
}

boot().catch(() => {
  const rootEl = document.getElementById('root')
  if (rootEl) rootEl.innerHTML = '<div style="color:#fff;padding:24px;font-family:system-ui">HABIT.AI failed to start — open devtools for the error.</div>'
})
