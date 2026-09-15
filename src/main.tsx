import './lib/db' // MUST be first: installs localStorage->SQLite mirror before any module reads storage
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { AppProvider } from './store/AppContext'
import { installWriteThrough, hydrateFromDB } from './lib/db'

// The whole app persists through localStorage keys (habitOS_*).
// Patch first so every write (ours + DB restore below) is mirrored into SQLite.
installWriteThrough()

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; err: any }> {
  state = { hasError: false, err: null }
  static getDerivedStateFromError(err: any) { return { hasError: true, err } }
  componentDidCatch(e: any, info: any) { console.error('App crash:', e, info) }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050507] text-white p-6">
          <h2 className="text-base font-semibold">HABIT.AI crashed — recovered</h2>
          <pre className="mt-3 text-xs text-white/50 whitespace-pre-wrap bg-white/5 p-3 rounded-xl border border-white/10">{String(this.state.err)}</pre>
          <button onClick={() => { try { localStorage.removeItem('habitOS_v4_final') } catch {} location.reload() }} className="mt-4 px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold">Reset DB & Reload</button>
        </div>
      )
    }
    return this.props.children
  }
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
