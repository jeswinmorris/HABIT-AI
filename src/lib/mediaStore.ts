/**
 * mediaStore.ts — persistent binary storage for user uploads (playlist tracks, prayer /
 * visualization images + videos, workout clips, affirmation audios).
 *
 * Why: every uploader used `URL.createObjectURL(file)` and saved that string in
 * localStorage. A blob: URL is only valid inside the document that made it, so after a
 * restart (or an alarm-triggered reload) the playlist, prayer images and workout videos
 * were all dead references — the symptom being "music / video is not playing".
 * Blob URLs are also much too big for localStorage as data: URLs, so the bytes go to
 * IndexedDB and the JSON keeps a stable `media:<id>` marker.
 */

const DB_NAME = 'habit-media'
const STORE = 'files'

let dbP: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (dbP) return dbP
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbP = p.catch((e) => {
    dbP = null
    throw e
  })
  return dbP
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export const mediaId = (prefix = 'm') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
export const isMediaRef = (src?: string | null) => !!src && src.startsWith('media:')
export const refOf = (id: string) => `media:${id}`

/** Save bytes; returns the storage id. `id` lets you overwrite in place. */
export async function putMedia(file: Blob, id: string = mediaId()): Promise<string> {
  try {
    await tx<void>('readwrite', (s) => s.put(file, id))
  } catch {
    /* IndexedDB unavailable (private mode) — fall back to a live blob URL for this session */
    return URL.createObjectURL(file)
  }
  return id
}

const urlCache = new Map<string, string>()
/** Resolve a `media:<id>` marker (or a raw id / blob: URL) to something a tag can load. */
export async function resolveMedia(src?: string | null): Promise<string> {
  if (!src) return ''
  const id = src.startsWith('media:') ? src.slice(6) : src
  if (id.startsWith('blob:') || id.startsWith('data:') || id.startsWith('http') || id.startsWith('./') || id.startsWith('/')) return id
  const cached = urlCache.get(id)
  if (cached) return cached
  try {
    const blob = await tx<Blob | undefined>('readonly', (s) => s.get(id))
    if (!blob) return ''
    const url = URL.createObjectURL(blob)
    urlCache.set(id, url)
    return url
  } catch {
    return ''
  }
}

export async function removeMedia(src?: string | null): Promise<void> {
  if (!src) return
  const id = src.startsWith('media:') ? src.slice(6) : src
  if (id.startsWith('blob:')) { try { URL.revokeObjectURL(id) } catch {} return }
  urlCache.delete(id)
  try { await tx<void>('readwrite', (s) => s.delete(id)) } catch {}
}

/** Migrate a legacy blob:/data: string written by an older build into IndexedDB. */
export async function adoptLegacy(src: string): Promise<string> {
  if (!src || !src.startsWith('blob:')) return src
  try {
    const blob = await (await fetch(src)).blob()
    return await putMedia(blob)
  } catch {
    return src
  }
}
