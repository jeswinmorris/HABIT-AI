/**
 * HABIT.AI preload
 *
 * BUG FIXED: this file only exposed `electronAPI = { platform }`, but the renderer
 * talks to `window.habitAI.db.*` (src/lib/db.ts) and `window.habitAPI.getModelPath()`
 * (src/core/voiceEngine.ts). Neither existed, so:
 *   - SQLite persistence never happened (the app silently stayed on localStorage)
 *   - native notifications never fired (the code thought it was running in a browser)
 *   - the Vosk model path could not be resolved, so voice input was dead
 * The bridge below implements exactly the shape db.ts/voiceEngine.ts expect.
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

const bridge = {
  version: '5.2.0',
  platform: process.platform,
  db,
  // absolute/asset URL of the offline STT model, or '' when it is not installed
  getModelPath: () => ipcRenderer.invoke('voice:model-path'),
  getTtsPaths: () => ipcRenderer.invoke('tts:paths'),
  notify: (title, body) => ipcRenderer.invoke('db:notify', { title, body })
}

contextBridge.exposeInMainWorld('habitAI', bridge)
// voiceEngine.ts used the `habitAPI` spelling — keep both names pointing at one bridge.
contextBridge.exposeInMainWorld('habitAPI', bridge)
contextBridge.exposeInMainWorld('electronAPI', { platform: process.platform, dbWrite: bridge.db.write })
