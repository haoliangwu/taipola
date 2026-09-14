/**
 * Draft persistence: the "you refreshed and your edit was still there" net.
 *
 * A draft is best-effort by nature — private mode and a full quota are normal
 * outcomes, not failures — so every path here absorbs its exception instead of
 * reporting one. The write is SYNCHRONOUS on purpose: the unload path
 * (`pagehide`) has no time to await anything, and a debounce that dies with the
 * page is exactly how a deleted chunk of text "came back" after a refresh (the
 * regression `App.test.tsx` pins).
 *
 * When to write — debounced while typing, flushed when the page goes away — is
 * the shell's policy and lives in `core/autosave.ts`; this module only performs
 * the write, so `save` has no timer in it.
 *
 * ONE SLOT PER DOCUMENT (`taipola:draft:<key>`) plus a pointer to the slot that
 * was written last. A slot is content that has not reached its file yet, so the
 * pointer is what a reload reads to know which document to put back on screen.
 * Slots are capped: a long session browsing a folder must not be able to fill the
 * origin's storage with copies of documents the user only looked at.
 */
import type { Draft } from '../core/autosave'

const SLOT_PREFIX = 'taipola:draft:'
/** Deliberately outside `SLOT_PREFIX`: the pointer is not itself a document. */
const ACTIVE_KEY = 'taipola:active-draft'
/** The one global record this store used before slots existed. */
const LEGACY_KEY = 'taipola:draft'

/** How many documents can have unwritten content at once. */
export const DRAFT_SLOT_LIMIT = 20

export interface DraftStore {
  /** The slot for `key`, or null when there is none (or it is unusable). */
  load(key: string): Draft | null
  /** Records the slot, synchronously, and marks it as the active one. */
  save(key: string, draft: Draft): void
  /** Drops the slot: its content has nothing unwritten left in it. */
  remove(key: string): void
  /**
   * Whether a slot exists for `key`.
   *
   * Asked by the folder tree, which marks the documents that have content still
   * to be written back — a broken record does not count as one.
   */
  has(key: string): boolean
  /** The document whose slot was written last, or null. */
  active(): string | null
}

/** The document's slot keys, oldest-first by `savedAt` when asked for that. */
function slotKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(SLOT_PREFIX)) keys.push(key.slice(SLOT_PREFIX.length))
  }
  return keys
}

function readSlot(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + key)
    if (!raw) return null
    return normalize(JSON.parse(raw) as Partial<Draft>)
  } catch {
    return null
  }
}

/**
 * The record as this module guarantees it, whatever was actually stored.
 *
 * Only `content` is load-bearing — a record without it is not a draft at all.
 * The rest is filled in so that callers can read `root`/`path` without checking,
 * including for records written before those fields existed.
 */
function normalize(parsed: Partial<Draft>): Draft | null {
  if (typeof parsed?.content !== 'string') return null
  return {
    content: parsed.content,
    name: typeof parsed.name === 'string' ? parsed.name : '',
    savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    root: typeof parsed.root === 'string' ? parsed.root : null,
    path: typeof parsed.path === 'string' ? parsed.path : null,
  }
}

/**
 * Adopts the pre-slot global record, once.
 *
 * Whoever was writing in this editor before the upgrade has a draft at
 * `taipola:draft` and nothing else. Silently ignoring it would look exactly like
 * the editor losing their text, so it is moved into the slot its own name
 * implies and made the active one. The old key is removed on the way, which is
 * what makes "once" true without keeping a flag.
 */
function adoptLegacyDraft(): void {
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return
  localStorage.removeItem(LEGACY_KEY)
  try {
    const parsed = normalize(JSON.parse(raw) as Partial<Draft>)
    if (parsed) localStorageDraft.save(parsed.name || 'untitled.md', parsed)
  } catch {
    /* unusable — the record is gone either way */
  }
}

/**
 * The draft store, backed by localStorage.
 *
 * A plain object rather than a factory: there is one implementation and nothing
 * varies across it, so a `create…()` with no injection point would only invite
 * the reader to look for the second one.
 */
export const localStorageDraft: DraftStore = {
  load: readSlot,

  save(key, draft) {
    try {
      const existing = slotKeys()
      if (!existing.includes(key) && existing.length >= DRAFT_SLOT_LIMIT) {
        // Oldest first: the slot whose content has been sitting unwritten the
        // longest is the one least likely to be missed.
        const oldest = existing
          .map((other) => ({ other, savedAt: readSlot(other)?.savedAt ?? 0 }))
          .sort((a, b) => a.savedAt - b.savedAt)[0]
        if (oldest) localStorage.removeItem(SLOT_PREFIX + oldest.other)
      }
      localStorage.setItem(SLOT_PREFIX + key, JSON.stringify(draft))
      localStorage.setItem(ACTIVE_KEY, key)
    } catch {
      /* quota exceeded or private mode — drafts are best-effort */
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(SLOT_PREFIX + key)
      if (localStorage.getItem(ACTIVE_KEY) === key) localStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* best-effort, as above */
    }
  },

  has: (key) => readSlot(key) !== null,

  active() {
    try {
      adoptLegacyDraft()
      return localStorage.getItem(ACTIVE_KEY)
    } catch {
      return null
    }
  },
}
