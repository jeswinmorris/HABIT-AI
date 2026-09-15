/**
 * HABIT.AI v4.1 Electron main
 * SQLite (kv mirror) + structured tables + notifications + export/import
 */

const { app, BrowserWindow, session, ipcMain, Notification, shell, systemPreferences, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");

let win = null;
let db = null;
let jsonFile = null;

// Prevent double instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Must be before ready
app.commandLine.appendSwitch('enable-features', 'AudioWorklet');

/**
 * habicore:// — read-only asset scheme used for the offline Vosk model + Piper voice files.
 * Must be registered before app ready. Without it the renderer (file:// in production, or
 * localhost in dev) cannot reach a model that lives in Resources/userData.
 */
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

/** First existing candidate path for the STT model / TTS voice files. */
function findCoreFile(name) {
  for (const root of coreRoots()) {
    const p = path.join(root, name);
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
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
  if (db || jsonFile) return; // already opened

  const dir = app.getPath("userData");
  const file = path.join(dir, "habit.db");
  try {
    const Better = require("better-sqlite3");
    db = new Better(file);
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    console.log("[habit.db] SQLite:", file);
    console.log("[habit.db] SQLite:", file); // keep your double log if you want
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
          stmt.run(
            String(r.id), r.streakId, r.type || "skip", r.days || 0,
            String(r.startDate || "").slice(0, 10),
            String(r.endDate || "").slice(0, 10),
            r.reason || "", r.createdAt || ""
          );
        }
      })(rows);
    }
    if (table === "pauses") {
      const stmt = db.prepare("INSERT OR REPLACE INTO pauses (id, date, startTime, endTime, active) VALUES (?,?,?,?,?)");
      db.transaction((rs) => {
        db.prepare("DELETE FROM pauses").run();
        for (const r of rs) {
          stmt.run(
            String(r.id),
            String(r.startTime || r.date || "").slice(0, 10),
            r.startTime || null,
            r.endTime || null,
            r.active ? 1 : 0
          );
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
          lg.run(`${s.id}-${di}`, d.toISOString().slice(0, 10), String(s.id), Number(di) + 1);
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

  // Unpack relational
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

function createWindow() {
  if (win && !win.isDestroyed()) {
    win.focus();
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
      sandbox: false, // needs false for better-sqlite3 in main, true for renderer is ok
    }
  });

  if (!app.isPackaged) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });

  win.on('closed', () => { win = null; });

  return win;
}

// --- Single whenReady ---
app.whenReady().then(() => {
  const ses = session.defaultSession;

  // 1. Always allow mic + media
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    // allow all for this app - you can narrow to 'media' / 'microphone' later
    callback(true);
  });
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler(() => true);

  // 2. Strip CSP so AudioWorklet blob + vosk model tar.gz can load
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['Content-Security-Policy'];
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy-Report-Only'];
    callback({ responseHeaders: headers });
  });

  // 3. macOS mic prompt
  try {
    if (process.platform === 'darwin' && systemPreferences.askForMediaAccess) {
      systemPreferences.askForMediaAccess('microphone');
    }
  } catch {}

  handleCoreScheme();
  openDb();
  createWindow();

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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- IPC ---
ipcMain.handle("db:hydrate", () => kvReadAll());
ipcMain.handle("db:write", (_e, { key, value }) => kvWrite(key, value));
ipcMain.handle("db:export", () => {
  const snap = kvReadAll();
  const stamp = new Date().toISOString().slice(0, 10);
  let file = null;
  try {
    file = path.join(app.getPath("documents"), `habit-ai-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ app: "HABIT.AI", version: "4.1", exportedAt: new Date().toISOString(), data: snap }, null, 2));
  } catch {}
  return { file, snapshot: snap };
});
ipcMain.handle("db:import", (_e, payload) => {
  const data = (payload && payload.data) || payload || {};
  for (const [k, v] of Object.entries(data)) {
    if (String(k).startsWith("habitOS_")) kvWrite(k, v);
  }
  return true;
});
ipcMain.handle("db:notify", (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  return true;
});
ipcMain.handle("db:info", () => {
  let size = 0;
  try {
    const f = db ? path.join(app.getPath("userData"), "habit.db") : jsonFile;
    if (f && fs.existsSync(f)) size = fs.statSync(f).size;
  } catch {}
  return { driver: db ? "sqlite" : "json-file", path: db ? path.join(app.getPath("userData"), "habit.db") : jsonFile, size };
});

/** Wipes every habit collection (SQLite + JSON fallback). Used by "Reset & re-onboard". */
ipcMain.handle("db:reset", () => {
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

// --- offline voice assets ---
ipcMain.handle("voice:model-path", () => {
  const p = findCoreFile("habi-model.tar.gz") || findCoreFile("vosk-model-small-en-us-0.15.tar.gz");
  if (!p) return "";
  // serve through the privileged scheme so a file:// renderer can fetch() it
  for (const root of coreRoots()) {
    if (p.startsWith(root)) return "habicore://habit" + "/" + path.relative(root, p).split(path.sep).join("/");
  }
  return "file://" + p;
});
ipcMain.handle("tts:paths", () => ({
  wasm: findCoreFile(path.join("piper", "piper_phonemize.wasm")) || "",
  data: findCoreFile(path.join("piper", "piper_phonemize.data")) || "",
  onnx: findCoreFile(path.join("piper", "en_US-lessac-medium.onnx")) || ""
}));