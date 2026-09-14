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
 *
 * ONE SLOT PER DOCUMENT, not one global record. A slot means "content that has
 * not reached its file yet", so two documents cannot overwrite each other's
 * unwritten work, and a slot disappears the moment its content lands on disk
 * (`forget`). What a slot still does not give is agreement between two tabs
 * editing the SAME document: that is last-write-wins, and `peek` is how the
 * policy notices and stops being silent about it.
 */

/**
 * The record the shell keeps of unsaved work.
 *
 * Domain data, so it lives here rather than in the storage adapter: `platform`
 * depends on `core`, never the other way round.
 *
 * `root`/`path` are how the slot is recognised again after a reload: a folder's
 * name plus the document's path inside it. Part of the record from the start so
 * that its shape does not have to change under a store that already has the
 * user's content in it — the folder ticket is what fills them in, and they are
 * null everywhere until then.
 */
export interface Draft {
  content: string
  name: string
  savedAt: number
  root: string | null
  path: string | null
}

export interface AutosaveDeps {
  write(key: string, draft: Draft): void
  /** The slot's current contents, or null. Read before every write. */
  peek(key: string): Draft | null
  /** Drops the slot: its content no longer has anything unwritten in it. */
  remove(key: string): void
  /**
   * Fired once, just before a draft that some other tab wrote is overwritten.
   *
   * The write still happens: two tabs on one document share one slot, which is
   * last-write-wins by definition, and refusing to write would break the
   * autosave that the rest of this module exists to provide. What is worth
   * removing is the SILENCE.
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
  root: string | null
  path: string | null
}

export interface Autosave {
  /** Records the document in `key`'s slot and (re)starts the debounce. */
  schedule(key: string, document: DraftInput): void
  /** The content reached its file: drop the slot and anything pending for it. */
  forget(key: string): void
  /**
   * The content reached its file — drop the slot only if that content is still
   * the newest thing in it.
   *
   * A write is not instantaneous, and the user keeps typing through it: the slot
   * may already hold text that is NEWER than what just landed in the file, and
   * that text has no other copy. `forget` in that situation is how a write-back
   * quietly eats the sentence typed while it ran.
   */
  forgetUnlessNewer(key: string, text: string): void
  /** Writes the pending draft immediately, cancelling the debounce. */
  flush(): void
  /** Drops the pending draft without writing it. */
  cancel(): void
}

export const DRAFT_DEBOUNCE_MS = 500

export function createAutosave(deps: AutosaveDeps): Autosave {
  let pending: { key: string; draft: Draft } | null = null
  let timer: number | null = null
  /**
   * The newest `savedAt` this session has either seen or written, PER SLOT.
   *
   * `savedAt` is when the DOCUMENT changed, not when the write happened, so a
   * stored record newer than this baseline belongs to a document this session has
   * never seen — i.e. another tab's. Per slot rather than one number: with a slot
   * per document, another tab editing a DIFFERENT document writes newer records
   * all day, and a shared baseline would report every one of them as a conflict
   * on this one.
   *
   * Established when the slot is first touched (which is when the document is
   * loaded or first edited) rather than at the first write. What the session
   * loaded on startup is the baseline, and the two-tab ordering that matters is
   * the other tab writing BEFORE this one's first write: taking the baseline
   * lazily at that write would adopt the foreign record as our own and never
   * notice.
   */
  const baselines = new Map<string, number>()
  /** Announced already. See `writePending` for why only once. */
  let announced = false

  const stopTimer = () => {
    if (timer === null) return
    deps.clearTimer(timer)
    timer = null
  }

  const baselineFor = (key: string): number => {
    const known = baselines.get(key)
    if (known !== undefined) return known
    const stored = deps.peek(key)?.savedAt ?? 0
    baselines.set(key, stored)
    return stored
  }

  /** Writes the pending draft, once. */
  const writePending = () => {
    if (!pending) return
    const { key, draft } = pending
    // Cleared BEFORE the write: one unload fires both `pagehide` and a hidden
    // `visibilitychange`, and the second one must not write the same draft again.
    pending = null

    const baseline = baselineFor(key)
    const stored = deps.peek(key)
    // Newer than anything this session has seen for THIS slot, so it is another
    // tab's.
    const foreignDraft = stored !== null && stored.savedAt > baseline
    if (foreignDraft && !announced) {
      // Announced at most ONCE per session. The other tab keeps typing, so every
      // later write would find a newer record again and re-announce it every
      // debounce window; a toast that never stops is worse than the information
      // it carries. One is enough to say "there is another tab".
      announced = true
      deps.onForeignDraft()
    }

    deps.write(key, draft)
    baselines.set(key, Math.max(baseline, draft.savedAt))
  }

  const arm = () => {
    stopTimer()
    timer = deps.setTimer(() => {
      timer = null
      writePending()
    }, DRAFT_DEBOUNCE_MS)
  }

  const forget = (key: string) => {
    if (pending?.key === key) {
      stopTimer()
      pending = null
    }
    baselines.delete(key)
    deps.remove(key)
  }

  return {
    schedule(key, document) {
      // Touched before anything is written: see `baselines` for why the baseline
      // has to be taken from what was loaded, not from what is found later.
      baselineFor(key)
      // The `savedAt` of the edit, not of the eventual write: the record should
      // say when the document last changed.
      pending = { key, draft: { ...document, savedAt: deps.now() } }
      arm()
    },

    forget,

    forgetUnlessNewer(key, text) {
      // Something newer may be waiting in the debounce rather than in storage
      // yet, and `forget` would take it with it.
      if (pending?.key === key && pending.draft.content !== text) return
      if (deps.peek(key)?.content === text) forget(key)
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
