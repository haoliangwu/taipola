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

/** Everything the policy needs from the outside world. */
export interface AutosaveDeps {
  write(draft: Draft): void
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
    deps.write(draft)
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
