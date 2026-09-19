/**
 * Headless smoke test for electron/main.cjs: stubs the Electron + sqlite surface, loads the
 * real module, and drives the reminder/tray/export/db paths. Catches "X is not defined" and
 * handler crashes that would otherwise only appear as an Electron error box.
 * Run: node scripts/check-main.cjs
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const Module = require('module')

const errors = []
const calls = []

const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), 'habit-main-'))
const fakeNotification = function (opts) {
  calls.push('notify:' + (opts && opts.title))
  return { on: () => {}, show: () => calls.push('shown:' + (opts && opts.title)) }
}
fakeNotification.isSupported = () => true

const fakeWin = {
  isDestroyed: () => false,
  isMinimized: () => false,
  isVisible: () => true,
  focus() {}, show() { calls.push('show'); setTimeout(readyFire, 0) }, loadURL(u) { calls.push('loadURL:' + u) },
  loadFile(p) { calls.push('loadFile:' + path.basename(p)) },
  webContents: {
    on() {}, send(_c, p) { calls.push('send:' + _c) }, openDevTools() {}, once() {},
    setWindowOpenHandler() {}, reload() { calls.push('reload') }
  },
  once(ev, fn) { if (ev === 'ready-to-show') readyHandlers.push(fn) },
  on() {},
  restore() {}, hide() {},
}
const readyHandlers = []
function readyFire() { readyHandlers.forEach((f) => { try { f() } catch (e) { errors.push('ready-to-show: ' + e.message) } }) }

class FakeBrowserWindow {
  constructor() { return fakeWin }
  static getAllWindows() { return [fakeWin] }
}
const electronStub = {
  app: {
    requestSingleInstanceLock: () => true,
    commandLine: { appendSwitch() {} },
    getPath: (k) => (k === 'userData' ? tmpUserData : tmpUserData),
    getAppPath: () => __dirname,
    getPathName: () => 'x',
    whenReady: () => Promise.resolve(),
    on() {}, quit() { calls.push('quit') }, hide() {},
    isPackaged: false,
    setAppUserModelId() { calls.push('aumid') },
    disableHardwareAcceleration() { calls.push('no-hw-accel') },
    getName: () => 'HABIT.AI'
  },
  BrowserWindow: FakeBrowserWindow,
  session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {}, webRequest: { onHeadersReceived() {} } } },
  ipcMain: { handle: (ch, fn) => { handlers.set(ch, fn); return true } },
  Notification: fakeNotification,
  shell: { openExternal() {} },
  systemPreferences: { askForMediaAccess: () => true },
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  net: { fetch: async () => ({ ok: true }) },
  Tray: function () { return { setToolTip() {}, setContextMenu() {}, on() {} } },
  Menu: { buildFromTemplate: (t) => t },
  nativeImage: { createFromBitmap: () => ({ isEmpty: () => false }), createFromPath: () => ({}) },
  powerMonitor: { on() {} },
  dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) }
}
let tmpUserData = tmpUser
const handlers = new Map()

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub
  if (request === 'better-sqlite3') throw new Error('no sqlite in the smoke test')
  return origLoad.apply(this, arguments)
}

process.on('uncaughtException', (e) => errors.push('UNCAUGHT: ' + e.message))
process.on('unhandledRejection', (e) => errors.push('REJECTION: ' + (e && e.message)))

require(path.join(__dirname, '..', 'electron', 'main.cjs'))

async function main() {
  const results = []
  const check = async (name, fn) => {
    try { const v = await fn(); results.push('ok   ' + name + (v === undefined ? '' : ' → ' + v)) }
    catch (e) { results.push('FAIL ' + name + ' → ' + (e && e.message)) }
  }
  await check('module loaded', () => [...handlers.keys()].length + ' handlers: ' + [...handlers.keys()].join(','))
  await check('db:hydrate', async () => JSON.stringify(await handlers.get('db:hydrate')()))
  await check('db:write', async () => String(await handlers.get('db:write')({}, { key: 'habitOS_t', value: '1' })))
  await check('db:info', async () => JSON.stringify(await handlers.get('db:info')()))
  await check('db:reset', async () => String(await handlers.get('db:reset')()))
  await check('db:import', async () => String(await handlers.get('db:import')({}, { data: { habitOS_x: '1' } })))
  await check('db:export', async () => Object.keys(await handlers.get('db:export')()).join(','))
  await check('reminders:arm', async () => JSON.stringify(await handlers.get('reminders:arm')({}, [{ id: 'a', at: Date.now() + 800, title: 'SOON', body: 'b' }, { id: 'b', at: Date.now() + 6e5 }]),))
  await check('reminders:status', async () => JSON.stringify(await handlers.get('reminders:status')()))
  await check('reminders:background toggle', async () => String(await handlers.get('reminders:background')({}, false)) + '/' + String(await handlers.get('reminders:background')({}, true)))
  await check('reminders:test', async () => String(await handlers.get('reminders:test')({}, { title: 'hi', body: 'there' })))
  await check('dialog:saveJson cancel', async () => String(await handlers.get('dialog:saveJson')({}, { text: '{}', name: 'x' })))
  await check('dialog:openJson cancel', async () => String(await handlers.get('dialog:openJson')()))
  await check('voice:model-path', async () => JSON.stringify(await handlers.get('voice:model-path')()))
  await check('tts:paths', async () => JSON.stringify(await handlers.get('tts:paths')()))
  await check('junk payload survives', async () => {
    await handlers.get('reminders:arm')({}, 'not-an-array')
    await handlers.get('reminders:arm')({}, [{ nope: 1 }])
    await handlers.get('db:write')({}, { key: 1 })
    await handlers.get('db:import')({}, null)
    return 'no throw'
  })
  await new Promise((r) => setTimeout(r, 1500))
  await check('due reminder fired through the timer', () => calls.filter((c) => String(c).startsWith('notify:')).join(',') || 'none')
  readyHandlers.slice().forEach((f) => { try { f() } catch (e) { errors.push('ready-to-show: ' + e.message) } })
  await new Promise((r) => setTimeout(r, 200))
  console.log('--- electron/main.cjs smoke ---')
  results.forEach((r) => console.log(r))
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no uncaught errors')
    try { fs.rmSync(tmpUser, { recursive: true, force: true }) } catch {}
    process.exit(errors.length || results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
}
main().catch((e) => { console.log('HARNESS CRASH: ' + e.message); process.exit(1) })
