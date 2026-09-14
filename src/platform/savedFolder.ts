/**
 * Remembers the last opened folder across reloads, and re-authorizes it.
 *
 * A directory handle is an ordinary structured-cloneable object, so IndexedDB
 * can hold it — the same trick VS Code's web version uses for its recent
 * folders. What IndexedDB does NOT hold is the PERMISSION: the browser forgets
 * the grant when the last tab of the origin closes, so after a reload the
 * handle asks again. A reload therefore looks one of two ways:
 *
 * - the grant still holds (Chrome 122+'s persistent permissions) — the folder
 *   comes back with no user action at all;
 * - it does not — the sidebar shows one 「恢复上次的文件夹」 button, and the
 *   click re-requests the permission inside its user gesture (the API refuses a
 *   gesture-less call).
 *
 * A DENIED re-request FORGETS the record: offering the same folder on every
 * load would be a nag, and the folder picker itself remembers its position
 * (`folder.ts`'s picker id), so re-picking stays one dialog away.
 *
 * What is remembered about the document is only its PATH inside the folder,
 * never a handle. A path is identity (the same identity the draft slots use),
 * and the file is re-read from the restored folder when the tree comes back —
 * so ADR-0004's write-back arms with a fresh `openedAt`, exactly as if the row
 * had been clicked. Content that never reached its file is not this memory's
 * business: it rides the draft slot (`draft.ts`), and that document wins the
 * screen at load over the remembered path.
 */
import type { FolderRoot } from './folder'

/** What the last session left behind. */
export type SavedFolderStatus =
  /** Nothing stored (or a stored record was denied once too often). */
  | { status: 'none' }
  /** Stored, and the permission still holds: restore without asking. */
  | { status: 'restorable'; root: FolderRoot; lastFile: string | null }
  /** Stored, but re-authorization needs one user gesture. */
  | { status: 'offered'; root: FolderRoot; lastFile: string | null }

export interface SavedFolder {
  /** What the previous session left. Never throws; a storage failure is "none". */
  probe(): Promise<SavedFolderStatus>
  /** Remembers the folder just picked; a later pick replaces it. */
  save(root: FolderRoot): Promise<void>
  /**
   * Remembers which file was open inside the folder, by its path — replaced on
   * the next tree click. Meaningless without a saved folder, so `save` (a new
   * pick) clears it too.
   */
  rememberFile(path: string): Promise<void>
  /** Forgets the record. */
  clear(): Promise<void>
  /**
   * Re-asks for read/write permission — must be called from a user gesture.
   * `true` when the folder is usable again; a denial clears the record.
   */
  authorize(root: FolderRoot): Promise<boolean>
}

/** The permission gate, injectable so tests can fake what a real handle does. */
export interface FolderPermission {
  query(handle: unknown): Promise<'granted' | 'prompt' | 'denied'>
  request(handle: unknown): Promise<'granted' | 'denied'>
}

interface HandlePermissionApi {
  queryPermission?(options: { mode: 'readwrite' }): Promise<'granted' | 'prompt' | 'denied'>
  requestPermission?(options: { mode: 'readwrite' }): Promise<'granted' | 'denied'>
}

const HANDLE_PERMISSION: FolderPermission = {
  // A handle without `queryPermission` predates the re-ask model; offering the
  // button and letting `request` decide keeps that platform honest too.
  async query(handle) {
    const api = handle as HandlePermissionApi
    if (typeof api.queryPermission !== 'function') return 'prompt'
    return api.queryPermission({ mode: 'readwrite' })
  },
  async request(handle) {
    const api = handle as HandlePermissionApi
    if (typeof api.requestPermission !== 'function') return 'denied'
    return (await api.requestPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'denied'
  },
}

const STORE = 'saved-folder'
const KEY = 'root'
/** The last opened file's path inside the folder; one key, nothing else. */
const FILE_KEY = 'last-file'
// The stored record IS a `FolderRoot`: a directory handle survives the IndexedDB
// structured clone as the same kind of object, plus a name to show.

export interface SavedFolderOptions {
  /** IndexedDB name; tests use one per file so they never meet each other. */
  dbName?: string
  permission?: FolderPermission
}

export function makeSavedFolder(options: SavedFolderOptions = {}): SavedFolder {
  const dbName = options.dbName ?? 'taipola'
  const permission = options.permission ?? HANDLE_PERMISSION

  const openDatabase = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

  /** One transaction, one request; the store is created on the first open. */
  const withStore = async (mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<unknown> => {
    const db = await openDatabase()
    try {
      return await new Promise((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  }

  const readRecord = async (): Promise<FolderRoot | null> =>
    ((await withStore('readonly', (store) => store.get(KEY))) as FolderRoot | undefined) ?? null

  const readFileKey = async (): Promise<string | null> =>
    ((await withStore('readonly', (store) => store.get(FILE_KEY))) as string | undefined) ?? null

  /**
   * The file memory is meaningless without its folder, so they are cleared
   * together — two writes, no atomicity promised, and none needed: a record
   * half-cleared by a crash is just "no folder to restore".
   */
  const clearRecord = async (): Promise<void> => {
    await withStore('readwrite', (store) => store.delete(KEY))
    await withStore('readwrite', (store) => store.delete(FILE_KEY))
  }

  return {
    async probe() {
      try {
        const record = await readRecord()
        if (!record) return { status: 'none' }
        const lastFile = await readFileKey()
        const verdict = await permission.query(record.handle)
        if (verdict === 'granted') return { status: 'restorable', root: record, lastFile }
        if (verdict === 'prompt') return { status: 'offered', root: record, lastFile }
        // Denied: forget it, so the offer does not come back on every load.
        await clearRecord()
        return { status: 'none' }
      } catch {
        // A storage or permission failure means "no folder to restore", never an
        // error to surface: the app is fully usable without the memory.
        return { status: 'none' }
      }
    },

    async save(root) {
      // A folder picked by hand is a fresh start: whatever file the PREVIOUS
      // folder remembered cannot mean anything here.
      await withStore('readwrite', (store) => store.delete(FILE_KEY))
      await withStore('readwrite', (store) => store.put(root, KEY))
    },

    async rememberFile(path) {
      await withStore('readwrite', (store) => store.put(path, FILE_KEY))
    },

    async clear() {
      await clearRecord()
    },

    async authorize(root) {
      const verdict = await permission.request(root.handle)
      if (verdict === 'granted') return true
      await clearRecord()
      return false
    },
  }
}

/** The app's one folder memory. */
export const savedFolder: SavedFolder = makeSavedFolder()