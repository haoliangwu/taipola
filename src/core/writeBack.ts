/**
 * When the content reaches the file it belongs to.
 *
 * The counterpart of `autosave.ts`, and the reason switching documents no longer
 * has to ask anything: while a document has a file behind it, the content gets
 * there on its own. The policy lives here, with the clock and the file arriving
 * as dependencies, so "it asked exactly once" is an assertion rather than a
 * story about a browser dialog.
 *
 * Four decisions are worth having a name for:
 *
 * - the write is DEBOUNCED: writing on every keystroke would turn typing into a
 *   stream of disk writes;
 * - before writing, the file's modification time is compared with the one
 *   recorded when it was read. A file that changed underneath is somebody else's
 *   work (`git checkout`, another editor) and is worth one question — the only
 *   prompt left in the application;
 * - a write that does not happen (permission revoked, disk full, file deleted)
 *   stops the automatic writes for this document rather than retrying forever.
 *   The content keeps its draft slot, so nothing is lost while the user decides;
 * - a text that was superseded while it was being written is written again from
 *   the newest text, never the stale one twice.
 */

export const WRITE_BACK_DEBOUNCE_MS = 1000

/** Why the automatic writes gave up. The shell turns it into a sentence. */
export type WriteBackStopReason = 'declined' | 'failed' | 'missing'

export interface WriteBackDeps {
  /** The file's modification time when the document was read. */
  readonly openedAt: number
  /**
   * The file's modification time now, or null when the file cannot be read any
   * more — deleted, moved, or its metadata gone. Null is NOT "nothing to
   * compare": see `run`, where writing through it would re-create the file.
   */
  currentModifiedAt(): Promise<number | null>
  /** Writes `text` into the file. `false` when nothing was written. */
  write(text: string): Promise<boolean>
  /** Asked once, when the file changed since it was read. */
  confirmOverwrite(): boolean
  /** The text is on disk. The shell marks the document saved and drops its slot. */
  onWritten(text: string): void
  /** The automatic writes have stopped. Fired once. */
  onStopped(reason: WriteBackStopReason): void
  setTimer(run: () => void, delayMs: number): number
  clearTimer(handle: number): void
}

export interface WriteBack {
  /** The document changed: (re)starts the debounce. */
  schedule(text: string): void
  /** Writes the pending text now — the page is going away, there is no time. */
  flush(): void
  /** The user saved by hand: there is nothing left for the policy to write. */
  savedByHand(): void
  /** A different document is current; the pending text belongs to the old one. */
  cancel(): void
}

export function createWriteBack(deps: WriteBackDeps): WriteBack {
  let pending: string | null = null
  let timer: number | null = null
  /** Whether a write is in flight — `run` must not be re-entered. */
  let running = false
  /** Gave up for this document. See `WriteBackStopReason`. */
  let stopped = false
  /** What counts as "the file changed underneath". Moved on by our own writes. */
  let baseline = deps.openedAt

  const stopTimer = () => {
    if (timer === null) return
    deps.clearTimer(timer)
    timer = null
  }

  const arm = () => {
    stopTimer()
    timer = deps.setTimer(() => {
      timer = null
      void run()
    }, WRITE_BACK_DEBOUNCE_MS)
  }

  const run = async () => {
    if (stopped || running || pending === null) return
    const text = pending
    pending = null
    running = true
    try {
      const current = await deps.currentModifiedAt()
      if (current === null) {
        // The file cannot be read any more: deleted, moved, or its metadata gone.
        // Writing anyway would quietly re-create it, which is not what "put my
        // typing back where it came from" can mean.
        stopped = true
        deps.onStopped('missing')
        return
      }
      if (current !== baseline && !deps.confirmOverwrite()) {
        // The user would rather not overwrite whatever is out there. The draft
        // slot keeps the content; asking again on every later keystroke would be
        // worse than stopping, so this document's automatic writes stop here.
        stopped = true
        deps.onStopped('declined')
        return
      }
      if (!(await deps.write(text))) {
        stopped = true
        deps.onStopped('failed')
        return
      }
      // Our own write moved the file's modification time: without this, the next
      // automatic write would read it as somebody else's change and ask.
      const after = await deps.currentModifiedAt()
      if (after !== null) baseline = after
      deps.onWritten(text)
    } finally {
      running = false
      // A newer text arrived while this one was being written.
      if (!stopped && pending !== null) arm()
    }
  }

  return {
    schedule(text) {
      if (stopped) return
      pending = text
      arm()
    },

    flush() {
      stopTimer()
      void run()
    },

    savedByHand() {
      stopTimer()
      pending = null
      // The user has just written the file by hand, so a write that failed
      // earlier is worth attempting again.
      stopped = false
    },

    cancel() {
      stopTimer()
      pending = null
    },
  }
}
