/**
 * HABIT.AI v4.1 Electron main
 * SQLite (kv mirror) + structured tables + notifications + export/import
 */

const { app, BrowserWindow, session, ipcMain, Notification, shell, systemPreferences, protocol, net,
  Tray, Menu, nativeImage, powerMonitor, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// Windows raises toasts only for a packaged app identity, and the id must match the
// appId in package.json (com.habitai.app) or nothing shows up at all.
try { app.setAppUserModelId('com.habitai.app') } catch (e) { console.warn('[main] setAppUserModelId unavailable:', e && e.message) }

// Fix black screen on old Intel HD Graphics (2014 Mac). Guarded: on a headless/partial
// Electron this API has been absent, and an exception here used to abort before any
// window existed.
try { app.disableHardwareAcceleration() } catch (e) { console.warn('[main] disableHardwareAcceleration unavailable:', e && e.message) }

let win = null;
let db = null;
let jsonFile = null;

// Prevent double instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/* A bug in the reminder layer must never take the whole app down with it. Every handler below
   runs through safe()/safeHandler(), and these two catches are the last line of defence: the
   problem is written to the log and, where possible, reported to the renderer. */
process.on('uncaughtException', (e) => {
  console.error('[main] uncaught exception:', (e && e.stack) || e);
  try { if (win && !win.isDestroyed()) win.webContents.send('main:error', { message: String((e && e.message) || e) }); } catch {}
});
process.on('unhandledRejection', (e) => {
  console.error('[main] unhandled rejection:', (e && e.stack) || e);
});

function safe(label, fn) {
  return function () {
    try { return fn.apply(null, arguments) }
    catch (e) { console.error('[main] ' + label + ' failed:', (e && e.message) || e); return undefined }
  };
}
function safeAsync(label, fn) {
  return async function () {
    try { return await fn.apply(null, arguments) }
    catch (e) { console.error('[main] ' + label + ' failed:', (e && e.message) || e); return null }
  };
}

// Must be before ready
try { app.commandLine.appendSwitch('enable-features', 'AudioWorklet') } catch {}

function registerCoreScheme() {
  try {
    protocol.registerSchemesAsPrivileged([
      { scheme: 'habicore', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } }
    ]);
  } catch {}
}
registerCoreScheme();

function coreRoots() {
  return [
    app.getPath('userData'),
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'public'),
    app.getAppPath()
  ].filter(Boolean);
}

function handleCoreScheme() {
  protocol.handle('habicore', async (request) => {
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
      for (const root of coreRoots()) {
        const abs = path.join(root, rel);
        if (abs.startsWith(path.resolve(root)) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          return net.fetch('file://' + abs.split(path.sep).join('/'));
        }
      }
      return new Response('not found', { status: 404 });
    } catch (e) {
      return new Response(String(e && e.message), { status: 500 });
    }
  });
}

function findCoreFile(name) {
  for (const root of coreRoots()) {
    const p = path.join(root, name);
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

/** All IPC handlers run guarded: a throw inside one returns a rejected promise the renderer
 *    already swallows, instead of surfacing as an Electron "unreadable window" error box. */
const ipcMap = new Map();
function H(channel, fn) {
  ipcMap.set(channel, fn)
  const wrapped = (event, ...args) => {
    try { return Promise.resolve(fn(event, ...args)) }
    catch (e) { console.error('[ipc] ' + channel + ' failed:', (e && e.message) || e); return Promise.reject(e) }
  }
  const isAsync = fn.constructor.name === 'AsyncFunction'
  ipcMain.handle(channel, isAsync ? (event, ...args) => fn(event, ...args).catch((e) => { console.error('[ipc] ' + channel + ' failed:', (e && e.message) || e); throw e }) : (event, ...args) => { try { return fn(event, ...args) } catch (e) { console.error('[ipc] ' + channel + ' failed:', (e && e.message) || e); throw e } })
}

/* ------------------------------------------------------------------ *
 * Reminders that survive the window.
 * The renderer is the brain (it knows the plan), but it stops existing when you
 * hide the window to the tray or quit. So the renderer *arms* the upcoming
 * reminders here; the main process owns setTimeout() for each one, writes them to
 * disk, and on the next launch hands back everything that fell due while it slept.
 * ------------------------------------------------------------------ */
const REMINDER_FILE = () => path.join(app.getPath("userData"), "habit-reminders.json");
let armed = [];            // [{ id, at, title, body, go }]
let armTimer = null;
let backgroundMode = true; // close button hides to tray so reminders keep firing
let isQuitting = false;
let tray = null;

function readArmed() {
  try {
    const raw = JSON.parse(fs.readFileSync(REMINDER_FILE(), "utf8"));
    if (Array.isArray(raw.reminders)) armed = raw.reminders.filter((r) => r && r.id && r.at);
    if (typeof raw.backgroundMode === "boolean") backgroundMode = raw.backgroundMode;
  } catch { armed = []; }
  return armed;
}
function saveArmed() {
  try { fs.writeFileSync(REMINDER_FILE(), JSON.stringify({ savedAt: Date.now(), backgroundMode, reminders: armed })); } catch {}
}
function send(channel, payload) {
  try { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); } catch {}
}
function showNotification(r) {
  try {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: r.title || "HABIT.AI", body: r.body || "", silent: false });
    n.on("click", () => {
      revealWindow();
      send("reminder:clicked", { id: r.id, go: r.go || null });
    });
    n.show();
    return true;
  } catch (e) {
    console.warn("[notify] failed", e && e.message);
    return false;
  }
}
function armTimers() {
  if (armTimer) { clearTimeout(armTimer); armTimer = null; }
  const now = Date.now();
  armed = armed.filter((r) => !r.fired);
  const upcoming = armed.filter((r) => r.at > now).sort((a, b) => a.at - b.at);
  if (!upcoming.length) return;
  const next = upcoming[0];
  armTimer = setTimeout(() => {
    const due = armed.filter((r) => r.at <= Date.now() && !r.fired);
    for (const r of due) {
      r.fired = true;
      showNotification(r);
      send("reminder:fired", r);
    }
    saveArmed();
    armTimers();
  }, Math.max(500, next.at - now));
}
/** Everything that came due while the app was closed/hidden. */
function collectMissed() {
  const now = Date.now();
  const missed = armed.filter((r) => r.at <= now && !r.fired);
  missed.forEach((r) => { r.fired = true; });
  if (missed.length) saveArmed();
  return missed;
}
function revealWindow() {
  try {
    if (!win || win.isDestroyed()) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } catch {}
}
function makeTray() {
  try {
    // 16x16 BGRA bitmap -> no binary asset needed, works on Win and mac
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      const inside = d < 6.4;
      buf[i + 0] = 225; buf[i + 1] = 92; buf[i + 2] = 139; // BGR: violet
      buf[i + 3] = inside ? (d > 5.6 ? 120 : 255) : 0;
    }
    const icon = nativeImage.createFromBitmap(buf, { width: size, height: size });
    tray = new Tray(icon);
    tray.setToolTip("HABIT.AI — reminders are live");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open HABIT.AI", click: revealWindow },
      { label: backgroundMode ? "Running in background (reminders on)" : "Background off (no reminders)", enabled: false },
      { type: "separator" },
      { label: "Quit HABIT.AI", click: () => { isQuitting = true; app.quit(); } }
    ]));
    tray.on("click", revealWindow);
  } catch (e) {
    console.warn("[tray] unavailable:", e && e.message);
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updatedAt TEXT);
CREATE TABLE IF NOT EXISTS streaks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, total INTEGER DEFAULT 0,
  unit TEXT DEFAULT 'days', dailyGoal INTEGER DEFAULT 1, split INTEGER DEFAULT 1,
  createdAt TEXT, archived INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, streakId TEXT, dayIndex INTEGER,
  amount INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS skips (
  id TEXT PRIMARY KEY, streakId TEXT, type TEXT, days INTEGER,
  startDate TEXT, endDate TEXT, reason TEXT, createdAt TEXT
);
CREATE TABLE IF NOT EXISTS pauses (
  id TEXT PRIMARY KEY, date TEXT, startTime TEXT, endTime TEXT, active INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

function openDb() {
  if (db || jsonFile) return;
  const dir = app.getPath("userData");
  const file = path.join(dir, "habit.db");
  try {
    const Better = require("better-sqlite3");
    db = new Better(file);
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    console.log("[habit.db] SQLite:", file);
  } catch (err) {
    db = null;
    jsonFile = path.join(dir, "habit-store.json");
    if (!fs.existsSync(jsonFile)) fs.writeFileSync(jsonFile, "{}");
    console.warn("[habit.db] falling back to JSON file", err.message);
  }
}

const readStore = () => {
  try { return JSON.parse(fs.readFileSync(jsonFile, "utf8")); } catch { return {}; }
};
const writeStore = (o) => fs.writeFileSync(jsonFile, JSON.stringify(o));

function unpackCollection(table, rows) {
  if (!db || !Array.isArray(rows)) return;
  try {
    if (table === "skips") {
      const stmt = db.prepare("INSERT OR REPLACE INTO skips (id, streakId, type, days, startDate, endDate, reason, createdAt) VALUES (?,?,?,?,?,?,?,?)");
      db.transaction((rs) => {
        db.prepare("DELETE FROM skips").run();
        for (const r of rs) {
          stmt.run(String(r.id), r.streakId, r.type || "skip", r.days || 0, String(r.startDate || "").slice(0, 10), String(r.endDate || "").slice(0, 10), r.reason || "", r.createdAt || "");
        }
      })(rows);
    }
    if (table === "pauses") {
      const stmt = db.prepare("INSERT OR REPLACE INTO pauses (id, date, startTime, endTime, active) VALUES (?,?,?,?,?)");
      db.transaction((rs) => {
        db.prepare("DELETE FROM pauses").run();
        for (const r of rs) {
          stmt.run(String(r.id), String(r.startTime || r.date || "").slice(0, 10), r.startTime || null, r.endTime || null, r.active ? 1 : 0);
        }
      })(rows);
    }
  } catch (e) {
    console.warn(`[habit.db] unpack ${table} failed`, e.message);
  }
}

function unpackStreaks(list) {
  if (!db || !Array.isArray(list)) return;
  try {
    const st = db.prepare("INSERT OR REPLACE INTO streaks (id, name, total, unit, dailyGoal, split, createdAt, archived) VALUES (?,?,?,?,?,?,?,0)");
    const lg = db.prepare("INSERT OR REPLACE INTO daily_logs (id, date, streakId, dayIndex, amount) VALUES (?,?,?,?,1)");
    const today = new Date();
    db.transaction((rs) => {
      db.prepare("DELETE FROM streaks").run();
      db.prepare("DELETE FROM daily_logs").run();
      for (const s of rs) {
        st.run(String(s.id), s.name || 'Untitled', s.total || 0, "days", 1, 1, String(s.createdAt || "").slice(0, 10));
        for (const di of s.completed || []) {
          const base = s.createdAt ? new Date(s.createdAt) : today;
          const d = new Date(base);
          d.setDate(d.getDate() + Number(di));
          // local calendar day, matching how the renderer keys every habit record
          const localDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          lg.run(`${s.id}-${di}`, localDay, String(s.id), Number(di) + 1);
        }
      }
    })(list);
  } catch (e) {
    console.warn('[habit.db] unpackStreaks failed', e.message);
  }
}

function kvWrite(key, rawValue) {
  const now = new Date().toISOString();
  if (db) {
    db.prepare("INSERT OR REPLACE INTO kv (key, value, updatedAt) VALUES (?, ?, ?)").run(key, String(rawValue), now);
  } else {
    const s = readStore();
    s[key] = String(rawValue);
    writeStore(s);
  }
  try {
    if (key === "habitOS_v4_final") {
      const st = JSON.parse(String(rawValue));
      unpackCollection("skips", st.skips || []);
      unpackCollection("pauses", st.pauses || []);
    }
    if (key === "habitOS_streaksCustom") {
      unpackStreaks(JSON.parse(String(rawValue)));
    }
    if (key === "habitOS_dailyAlarms" && db) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dailyAlarms', ?)").run(String(rawValue));
    }
  } catch {}
  return true;
}

function kvReadAll() {
  const out = {};
  if (db) {
    for (const r of db.prepare("SELECT key, value FROM kv").all()) out[r.key] = r.value;
    out.__meta = JSON.stringify({ driver: "sqlite", path: path.join(app.getPath("userData"), "habit.db") });
  } else {
    Object.assign(out, readStore());
    out.__meta = JSON.stringify({ driver: "json-file", path: jsonFile });
  }
  return out;
}

/** Anything that came due while the window was hidden or the app was shut. */
function deliverMissed() {
  try {
    const missed = collectMissed();
    armTimers();
    if (!missed.length) return;
    const list = missed.slice(0, 8);
    setTimeout(() => send('reminders:missed', list), 1500);
    showNotification({
      title: list.length === 1 ? 'HABIT.AI — while you were away' : 'HABIT.AI — ' + list.length + ' missed reminders',
      body: list.map((m) => String(m.title || '').replace('HABIT.AI — ', '')).join(', ').slice(0, 180)
    });
  } catch (e) {
    console.error('[main] deliverMissed failed:', (e && e.message) || e);
  }
}

function createWindow() {
  try {
    if (win && !win.isDestroyed()) {
      win.focus();
      if (!win.isVisible()) win.show();
      return win;
    }

    win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 420,
      minHeight: 640,
      backgroundColor: "#050507",
      show: false,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      }
    });

    if (!app.isPackaged) {
      win.loadURL("http://localhost:5173");
      // DevTools only when explicitly asked for: the bundled DevTools frontend spams
      // "Network.enable wasn't found" against Electron's CDP and looks like app errors.
      if (process.env.HABIT_DEVTOOLS === '1') win.webContents.openDevTools({ mode: "detach" });
    } else {
      win.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
    }

    win.once('ready-to-show', () => { try { win.show() } catch {}; deliverMissed(); });
    win.webContents.setWindowOpenHandler(({ url }) => { try { shell.openExternal(url) } catch {}; return { action: "deny" } });

    // Rendering died? Reload once instead of leaving a white window.
    let reloads = 0;
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[main] renderer gone:', details && details.reason);
      if (reloads++ < 2) setTimeout(() => { try { win.webContents.reload() } catch {} }, 800);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[main] load failed', code, desc, url);
      if (code !== -3 && reloads++ < 2) setTimeout(() => { try { win.webContents.reload() } catch {} }, 1500);
    });

    // Closing the window keeps the reminder engine alive (tray / menu bar).
    win.on('close', (e) => {
      try {
        if (!isQuitting && backgroundMode) {
          e.preventDefault();
          win.hide();
          if (process.platform === 'darwin') app.hide && app.hide();
        } else {
          win = null;
        }
      } catch (err) {
        console.error('[main] close handler failed:', (err && err.message) || err);
      }
    });
    win.on('closed', () => { win = null; });
    return win;
  } catch (e) {
    console.error('[main] createWindow failed:', (e && e.stack) || e);
    return win;
  }
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback) => callback(true));
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler(() => true);
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['Content-Security-Policy'];
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy-Report-Only'];
    callback({ responseHeaders: headers });
  });
  try {
    if (process.platform === 'darwin' && systemPreferences.askForMediaAccess) {
      systemPreferences.askForMediaAccess('microphone');
    }
  } catch {}
  safe('handleCoreScheme', handleCoreScheme)();
  safe('openDb', openDb)();
  safe('readArmed', readArmed)();
  safe('createWindow', createWindow)();
  safe('makeTray', makeTray)();
  safe('armTimers', armTimers)();

  // Sleep or a clock change: the OS clock is the authority, so re-anchor everything on resume
  // and deliver whatever fell due while the machine was asleep.
  try {
    powerMonitor.on('resume', safe('powerMonitor:resume', () => { send('system:resync', { reason: 'resume', at: Date.now() }); deliverMissed(); }));
    powerMonitor.on('unlock-screen', safe('powerMonitor:unlock', () => { send('system:resync', { reason: 'unlock', at: Date.now() }); armTimers(); }));
    powerMonitor.on('suspend', safe('powerMonitor:suspend', () => send('system:suspend', { at: Date.now() })));
  } catch {}
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('before-quit', () => { isQuitting = true; saveArmed(); });

app.on("window-all-closed", () => {
  // with background mode the window is hidden rather than closed, so this only fires on a real quit
  if (process.platform !== "darwin" && !backgroundMode) app.quit();
});

H("db:hydrate", () => kvReadAll());
H("db:write", (_e, { key, value }) => kvWrite(key, value));
H("db:export", () => {
  const snap = kvReadAll();
  const stamp = new Date().toISOString().slice(0, 10);
  let file = null;
  try {
    file = path.join(app.getPath("documents"), `habit-ai-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ app: "HABIT.AI", version: "4.1", exportedAt: new Date().toISOString(), data: snap }, null, 2));
  } catch {}
  return { file, snapshot: snap };
});
H("db:import", (_e, payload) => {
  const data = (payload && payload.data) || payload || {};
  for (const [k, v] of Object.entries(data)) {
    if (String(k).startsWith("habitOS_")) kvWrite(k, v);
  }
  return true;
});
H("db:notify", (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  return true;
});
/* -------------------------------- reminders -------------------------------- */
H("reminders:arm", (_e, list) => {
  const now = Date.now();
  const incoming = (Array.isArray(list) ? list : [])
    .filter((r) => r && r.id && Number.isFinite(Number(r.at)) && Number(r.at) > now - 60000)
    .map((r) => ({ id: String(r.id), at: Number(r.at), title: String(r.title || "HABIT.AI"), body: String(r.body || ""), go: r.go || null }));
  const keepFired = armed.filter((r) => r.fired && r.at > now - 6 * 3600000);
  const ids = new Set(incoming.map((r) => r.id));
  armed = [...incoming, ...keepFired.filter((r) => !ids.has(r.id))];
  saveArmed();
  armTimers();
  return { armed: incoming.length, supported: Notification.isSupported(), backgroundMode };
});
H("reminders:clear", () => { armed = []; saveArmed(); armTimers(); return true; });
H("reminders:status", () => ({
  supported: Notification.isSupported(),
  backgroundMode,
  pending: armed.filter((r) => !r.fired && r.at > Date.now()).length,
  nextAt: (armed.filter((r) => !r.fired).sort((a, b) => a.at - b.at)[0] || {}).at || null
}));
H("reminders:background", (_e, on) => {
  backgroundMode = !!on;
  saveArmed();
  try { tray && tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open HABIT.AI", click: revealWindow },
    { label: backgroundMode ? "Running in background (reminders on)" : "Background off (no reminders)", enabled: false },
    { type: "separator" },
    { label: "Quit HABIT.AI", click: () => { isQuitting = true; app.quit(); } }
  ])); } catch {}
  return backgroundMode;
});
H("reminders:test", (_e, { title, body }) => showNotification({ title, body }));

/* ------------------------------ native save/load ---------------------------- */
H("dialog:saveJson", async (_e, { text, name }) => {
  try {
    const stamp = new Date().toLocaleDateString('en-CA');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export HABIT.AI database",
      defaultPath: path.join(app.getPath("documents"), (name || `habit-ai-${stamp}`) + ".json"),
      filters: [{ name: "HABIT.AI backup", extensions: ["json"] }]
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, String(text || ""), "utf8");
    return filePath;
  } catch (e) {
    console.warn("[export] save dialog failed", e && e.message);
    return null;
  }
});
H("dialog:openJson", async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Import HABIT.AI backup",
      properties: ["openFile"],
      filters: [{ name: "HABIT.AI backup", extensions: ["json"] }]
    });
    if (canceled || !filePaths.length) return null;
    return { path: filePaths[0], text: fs.readFileSync(filePaths[0], "utf8") };
  } catch { return null; }
});
/** Lets the app ask the OS for notification permission (macOS especially). */
H("system:notifyPermission", () => {
  try { return Notification.isSupported() && (typeof Notification.requestPermission === "function" ? true : true); } catch { return false; }
});

H("db:info", () => {
  let size = 0;
  try {
    const f = db ? path.join(app.getPath("userData"), "habit.db") : jsonFile;
    if (f && fs.existsSync(f)) size = fs.statSync(f).size;
  } catch {}
  return { driver: db ? "sqlite" : "json-file", path: db ? path.join(app.getPath("userData"), "habit.db") : jsonFile, size };
});

H("db:reset", () => {
  try {
    if (db) {
      db.prepare("DELETE FROM kv").run();
      db.prepare("DELETE FROM streaks").run();
      db.prepare("DELETE FROM daily_logs").run();
      db.prepare("DELETE FROM skips").run();
      db.prepare("DELETE FROM pauses").run();
      db.prepare("DELETE FROM settings").run();
    } else {
      writeStore({});
    }
    return true;
  } catch (e) {
    console.warn("[habit.db] reset failed", e && e.message);
    return false;
  }
});

H("voice:model-path", () => {
  const p = findCoreFile("habi-model.tar.gz") || findCoreFile("vosk-model-small-en-us-0.15.tar.gz");
  if (!p) return "";
  for (const root of coreRoots()) {
    if (p.startsWith(root)) return "habicore://habit" + "/" + path.relative(root, p).split(path.sep).join("/");
  }
  return "file://" + p;
});
H("tts:paths", () => {
  const wasmFile = findCoreFile(path.join("piper", "piper_phonemize.wasm"));
  const dir = wasmFile ? path.dirname(wasmFile) : "";
  const needed = ["piper_phonemize.wasm", "piper_phonemize.data", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];
  const missing = needed.filter((f) => !dir || !fs.existsSync(path.join(dir, f)));
  return { dir, complete: dir !== "" && missing.length === 0, missing };
});