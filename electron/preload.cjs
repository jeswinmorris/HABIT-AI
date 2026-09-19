/**
 * HABIT.AI preload
 *
 * The renderer talks to `window.habitAI.*` (see src/lib/db.ts and src/lib/desktop.ts).
 * Everything below is a thin, validated IPC shim — no Node leakage into the page.
 */
const { contextBridge, ipcRenderer } = require('electron')

const db = {
  hydrate: () => ipcRenderer.invoke('db:hydrate'),
  write: (key, value) => ipcRenderer.invoke('db:write', { key, value }),
  export: () => ipcRenderer.invoke('db:export'),
  import: (payload) => ipcRenderer.invoke('db:import', payload),
  notify: (title, body) => ipcRenderer.invoke('db:notify', { title, body }),
  info: () => ipcRenderer.invoke('db:info'),
  reset: () => ipcRenderer.invoke('db:reset')
}

/** push a one-off list into the main process so timers outlive the window */
const reminders = {
  arm: (list) => ipcRenderer.invoke('reminders:arm', list),
  clear: () => ipcRenderer.invoke('reminders:clear'),
  status: () => ipcRenderer.invoke('reminders:status'),
  setBackground: (on) => ipcRenderer.invoke('reminders:background', !!on),
  test: (title, body) => ipcRenderer.invoke('reminders:test', { title, body }),
  onFired: (fn) => { const h = (_e, p) => fn(p); ipcRenderer.on('reminder:fired', h); return () => ipcRenderer.removeListener('reminder:fired', h) },
  onClicked: (fn) => { const h = (_e, p) => fn(p); ipcRenderer.on('reminder:clicked', h); return () => ipcRenderer.removeListener('reminder:clicked', h) },
  onMissed: (fn) => { const h = (_e, p) => fn(p); ipcRenderer.on('reminders:missed', h); return () => ipcRenderer.removeListener('reminders:missed', h) },
  onResync: (fn) => {
    const h = (_e, p) => fn(p)
    ipcRenderer.on('system:resync', h); ipcRenderer.on('system:suspend', h)
    return () => { ipcRenderer.removeListener('system:resync', h); ipcRenderer.removeListener('system:suspend', h) }
  }
}

const files = {
  saveJson: (text, name) => ipcRenderer.invoke('dialog:saveJson', { text, name }),
  openJson: () => ipcRenderer.invoke('dialog:openJson')
}

const bridge = {
  version: '5.3.0',
  platform: process.platform,
  db,
  reminders,
  files,
  // absolute/asset URL of the offline STT model, or '' when it is not installed
  getModelPath: () => ipcRenderer.invoke('voice:model-path'),
  getTtsPaths: () => ipcRenderer.invoke('tts:paths'),
  notify: (title, body) => ipcRenderer.invoke('db:notify', { title, body })
}

contextBridge.exposeInMainWorld('habitAI', bridge)
// voiceEngine.ts historically used the `habitAPI` spelling — keep both names on one bridge.
contextBridge.exposeInMainWorld('habitAPI', bridge)
contextBridge.exposeInMainWorld('electronAPI', { platform: process.platform, dbWrite: bridge.db.write })
