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

export interface Autosave {
  /** Records the document and (re)starts the debounce. */
  schedule(content: string, name: string): void
  /** Writes the pending draft immediately, cancelling the debounce. */
  flush(): void
  /** Drops the pending draft without writing it. */
  cancel(): void
}

export const DRAFT_DEBOUNCE_MS = 500

export function createAutosave(deps: AutosaveDeps, debounceMs = DRAFT_DEBOUNCE_MS): Autosave {
  let pending: Draft | null = null
  let timer: number | null = null

  const stopTimer = () => {
    if (timer === null) return
    deps.clearTimer(timer)
    timer = null
  }

  return {
    schedule(content, name) {
      // The `savedAt` of the edit, not of the eventual write: the record should
      // say when the document last changed.
      pending = { content, name, savedAt: deps.now() }
      stopTimer()
      timer = deps.setTimer(() => {
        timer = null
        if (pending) deps.write(pending)
      }, debounceMs)
    },

    flush() {
      stopTimer()
      if (pending) deps.write(pending)
    },

    cancel() {
      stopTimer()
      pending = null
    },
  }
}
