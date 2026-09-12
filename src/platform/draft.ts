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
 */
import type { Draft } from '../core/autosave'

const DRAFT_KEY = 'taipola:draft'

export interface DraftStore {
  /** The last draft, or null when there is none (or it is unusable). */
  load(): Draft | null
  /** Records the draft, synchronously. */
  save(draft: Draft): void
}

/**
 * The draft store, backed by localStorage.
 *
 * A plain object rather than a factory: there is one implementation and nothing
 * varies across it, so a `create…()` with no injection point would only invite
 * the reader to look for the second one.
 */
export const localStorageDraft: DraftStore = {
  load() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Draft
      if (typeof parsed?.content !== 'string') return null
      return parsed
    } catch {
      return null
    }
  },
  save(draft) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      /* quota exceeded or private mode — drafts are best-effort */
    }
  },
}
