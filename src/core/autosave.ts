/**
 * When the draft gets written.
 *
 * The POLICY only: debounce while typing, and a way to write NOW for the paths
 * that have no time to wait. Storage, timers and the clock arrive as
 * dependencies, so the whole thing runs in the node layer.
 *
 * Why the policy is worth its own module: a draft write deferred by a timer dies
 * with the page. An edit made just before a refresh could still be sitting in
 * that timer, and reloading then restored the STALE draft — observed as deleted
 * text "coming back" after a refresh. Keeping the deferral and the escape hatch
 * in one place is what lets a test pin that.
 */

/**
 * The record the shell keeps of unsaved work.
 *
 * Domain data, so it lives here rather than in the storage adapter: `platform`
 * depends on `core`, never the other way round.
 */
export interface Draft {
  content: string
  name: string
  savedAt: number
}

/**
 * A draft is ONE global record, not one per tab — deliberately, so two tabs are
 * two views of the same draft rather than two documents. The cost is that a write
 * from either tab destroys whatever the other left there, and the tab it happens
 * to has no way to see it. `peek` is what lets the policy notice.
 */
export interface AutosaveDeps {
  write(draft: Draft): void
  /** The draft currently in storage, or null. Read before every write. */
  peek(): Draft | null
  /**
   * Fired once, just before a draft that some other tab wrote is overwritten.
   *
   * The write still happens: a global draft is last-write-wins by definition, and
   * refusing to write would break the autosave that the rest of this module
   * exists to provide. What is worth removing is the SILENCE.
   */
  onForeignDraft(): void
  /** Schedules `run` and returns a handle for `clearTimer`. */
  setTimer(run: () => void, delayMs: number): number
  clearTimer(handle: number): void
  now(): number
}

/** The document as the policy sees it: what to write, and what to call it. */
export interface DraftInput {
  content: string
  name: string
}

export interface Autosave {
  /** Records the document and (re)starts the debounce. */
  schedule(document: DraftInput): void
  /** Writes the pending draft immediately, cancelling the debounce. */
  flush(): void
  /** Drops the pending draft without writing it. */
  cancel(): void
}

export const DRAFT_DEBOUNCE_MS = 500

export function createAutosave(deps: AutosaveDeps): Autosave {
  let pending: Draft | null = null
  let timer: number | null = null
  /**
   * The newest `savedAt` this session has either seen or written.
   *
   * `savedAt` is when the DOCUMENT changed, not when the write happened, so a
   * stored record newer than this baseline belongs to a document this session has
   * never seen — i.e. another tab's.
   *
   * Established at CONSTRUCTION rather than at the first write. What the session
   * loaded on startup is the baseline, and the two-tab ordering that matters is
   * the other tab writing BEFORE this one's first write: taking the baseline
   * lazily at that write would adopt the foreign record as our own and never
   * notice.
   */
  let baseline = deps.peek()?.savedAt ?? 0
  /** Announced already. See `writePending` for why only once. */
  let announced = false

  const stopTimer = () => {
    if (timer === null) return
    deps.clearTimer(timer)
    timer = null
  }

  /** Writes the pending draft, once. */
  const writePending = () => {
    if (!pending) return
    const draft = pending
    // Cleared BEFORE the write: one unload fires both `pagehide` and a hidden
    // `visibilitychange`, and the second one must not write the same draft again.
    pending = null

    const stored = deps.peek()
    if (!announced && stored !== null && stored.savedAt > baseline) {
      // Announced at most ONCE per session. The other tab keeps typing, so every
      // later write would find a newer record again and re-announce it every
      // debounce window; a toast that never stops is worse than the information
      // it carries. One is enough to say "there is another tab".
      announced = true
      deps.onForeignDraft()
    }

    deps.write(draft)
    baseline = Math.max(baseline, draft.savedAt)
  }

  return {
    schedule(document) {
      // The `savedAt` of the edit, not of the eventual write: the record should
      // say when the document last changed.
      pending = { ...document, savedAt: deps.now() }
      stopTimer()
      timer = deps.setTimer(() => {
        timer = null
        writePending()
      }, DRAFT_DEBOUNCE_MS)
    },

    flush() {
      stopTimer()
      writePending()
    },

    cancel() {
      stopTimer()
      pending = null
    },
  }
}
