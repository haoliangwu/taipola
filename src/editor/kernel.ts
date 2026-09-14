/**
 * Native editor kernel.
 *
 * This is ADR-0001's "A1": the kernel owns the editable DOM outright. React
 * renders the shell around it (title bar, outline, toolbar) and the host `<div>`
 * itself — but never its children, so there is no second writer to fight with.
 *
 * The consequences that matter:
 *
 * - **The model is the authority.** Every edit updates the model first, then
 *   rewrites the DOM and places the caret in the SAME synchronous frame. There
 *   is no window in which a React commit could land between the two.
 * - **No reconciliation to protect against.** The browser may delete or inject
 *   whatever it likes; the kernel rebuilds the subtree from the model afterwards
 *   instead of asking a reconciler to unmount nodes it no longer finds.
 * - **User gestures are the only way the DOM moves the model** (`beforeinput`,
 *   `keydown`, `mousedown`/`mouseup`). Selection reports produced by our own
 *   placement are ignored, so a browser-clamped caret can never feed back.
 *
 * Caret state is a **source offset** into the Markdown document; the screen
 * position is derived through the view (`core/view.ts`) on every render.
 */
import { parseDocument, type Block } from '../core/markdown'
import { computeLineStates, parseLine, type LineState } from '../core/inline'
import { buildBlockView, type BlockView } from '../core/view'
import { exportableHref } from '../core/markdownIt'
import type { EditBuffers } from '../core/editCommands'
import { backspaceAtContentStart, indentListItem, parseListItem, renumberLists } from '../core/lists'
import {
  markupSignature,
  readDocumentSource,
  readLooseText,
  renderDocument,
  sanitizeDom,
} from './render'
import { isBlankLine, lineOfOffset, offsetForLine } from '../core/lines'
import { applyCaret, domToLocal, sourceOffsetAtPoint } from './position'

const UNDO_LIMIT = 300

/** The source line holding an offset: where it starts and ends, and its text. */
interface LineBounds {
  start: number
  /** Exclusive, and the newline itself is not part of the line. */
  end: number
  text: string
}

interface Snapshot {
  value: string
  caret: number
}

export interface EditorKernelHooks {
  onChange: (value: string) => void
  onCaretLineChange?: (line: number) => void
}

export interface EditorKernelOptions extends EditorKernelHooks {
  value?: string
  readOnly?: boolean
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high))
}

/** Length of the longest common prefix of two sources. */
function sharedPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Length of the longest common suffix, never overlapping the prefix. */
function sharedSuffix(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix
  let i = 0
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

export class EditorKernel {
  private host: HTMLElement | null = null
  private hooks: EditorKernelHooks
  private readOnly: boolean

  private doc: string
  private caret = 0

  private blocks: Block[] = []
  private offsets: number[] = []
  private lineStates: LineState[] = []
  private views: BlockView[] = []
  private signature = ''
  private reportedLine = 0

  /** True while the DOM selection is one WE placed; see the class comment. */
  private placedByUs = false
  /** Set by `beforeinput`, consumed by `input`. */
  private userEditPending = false
  private composing = false
  private pendingCaret: number | null = null

  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []

  constructor(options: EditorKernelOptions) {
    this.hooks = { onChange: options.onChange, onCaretLineChange: options.onCaretLineChange }
    this.doc = options.value ?? ''
    this.readOnly = options.readOnly ?? false
    this.reportedLine = lineOfOffset(this.doc, 0)
    this.recompute()
  }

  /* ---------------------------------------------------------------------- */
  /* lifecycle                                                              */
  /* ---------------------------------------------------------------------- */

  mount(host: HTMLElement): void {
    if (this.host) this.destroy()
    this.host = host
    host.addEventListener('keydown', this.handleKeyDown)
    host.addEventListener('beforeinput', this.handleBeforeInput)
    host.addEventListener('input', this.handleInput)
    host.addEventListener('compositionstart', this.handleCompositionStart)
    host.addEventListener('compositionend', this.handleCompositionEnd)
    host.addEventListener('mousedown', this.handleMouseDown, true)
    host.addEventListener('mouseup', this.handleMouseUp)
    document.addEventListener('selectionchange', this.handleSelectionChange)
    this.render()
  }

  destroy(): void {
    const host = this.host
    if (!host) return
    host.removeEventListener('keydown', this.handleKeyDown)
    host.removeEventListener('beforeinput', this.handleBeforeInput)
    host.removeEventListener('input', this.handleInput)
    host.removeEventListener('compositionstart', this.handleCompositionStart)
    host.removeEventListener('compositionend', this.handleCompositionEnd)
    host.removeEventListener('mousedown', this.handleMouseDown, true)
    host.removeEventListener('mouseup', this.handleMouseUp)
    document.removeEventListener('selectionchange', this.handleSelectionChange)
    this.host = null
  }

  getDoc(): string {
    return this.doc
  }

  getCaret(): number {
    return this.caret
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly
  }

  focus(): void {
    this.host?.focus({ preventScroll: true })
  }

  setDocument(text: string): void {
    this.undoStack = []
    this.redoStack = []
    this.pendingCaret = null
    this.doc = text
    this.caret = 0
    this.recompute()
    this.render()
    this.reportedLine = lineOfOffset(text, 0)
    this.hooks.onChange(text)
    this.hooks.onCaretLineChange?.(1)
  }

  goToLine(line: number): void {
    const offset = offsetForLine(this.doc, line)
    const index = this.lineToBlock(line - 1)
    this.caret = offset
    this.recompute()
    this.render()
    this.placeCaret(offset)
    this.reportLine()
    window.requestAnimationFrame(() => {
      this.host
        ?.querySelector<HTMLElement>(`[data-block="${index}"]`)
        ?.scrollIntoView({ block: 'center' })
    })
  }

  /**
   * The document-edge caret move behind Cmd+Down / Ctrl+End and their start-side
   * mirrors: caret at the edge source offset, DOM rebuilt and caret placed in
   * the same frame, then the target block scrolled into view (native motion
   * scrolls too). It is a caret move, not an edit: no undo snapshot, no
   * `onChange`.
   */
  private moveCaretToEdge(edge: number): void {
    this.caret = edge
    this.recompute()
    this.render()
    this.placeCaret(edge)
    const index = this.blockAt(edge)
    window.requestAnimationFrame(() => {
      this.host
        ?.querySelector<HTMLElement>(`[data-block="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
    this.reportLine()
  }

  /** Applies a source-level edit at the current DOM selection. */
  applyEdit(mutate: (buffer: EditBuffers) => void): void {
    const index = this.blockAt(this.caret)
    if (index < 0) return
    const block = this.blocks[index]
    const view = this.views[index]
    if (!block || !view) return
    const buffer: EditBuffers = { value: block.raw, start: 0, end: 0 }
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      buffer.start = domToLocal(view, range.startContainer, range.startOffset) ?? 0
      if (range.collapsed) buffer.end = buffer.start
      else {
        const endRange = sel.getRangeAt(sel.rangeCount - 1)
        buffer.end = domToLocal(view, endRange.endContainer, endRange.endOffset) ?? buffer.start
      }
    }
    mutate(buffer)
    if (buffer.value === block.raw) return
    this.pushUndo({ value: this.doc, caret: this.caret })
    const start = this.offsets[index]
    const next = this.doc.slice(0, start) + buffer.value + this.doc.slice(start + block.raw.length)
    this.commit(next, start + buffer.start)
  }

  /* ---------------------------------------------------------------------- */
  /* model -> DOM                                                           */
  /* ---------------------------------------------------------------------- */

  private recompute(): void {
    const parsed = parseDocument(this.doc)
    this.blocks = parsed.blocks
    this.offsets = parsed.offsets
    this.lineStates = computeLineStates(this.doc.split('\n'))
    // Views are rebuilt when the source changes or the caret moves, because the
    // caret decides which constructs keep their markers visible.
    this.views = this.blocks.map((block) => {
      const start = this.offsets[block.index]
      const end = start + block.raw.length
      const revealed = this.caret >= start && this.caret <= end ? [this.caret] : []
      // A blank block's span covers possibly several source lines (raw is
      // empty); render one line box per blank line so the view mirrors the
      // document exactly.
      return buildBlockView(
        block.raw,
        start,
        revealed,
        block.endLine - block.startLine,
        block.softBreakAfter,
      )
    })
  }

  /** Rewrites the DOM when the model's rendering changed. Returns whether it did. */
  private render(): boolean {
    const host = this.host
    if (!host) return false
    // NEVER touch the DOM during an IME composition. Rewriting the line takes the
    // composing text node with it, the browser's composition region is gone, and
    // the committed characters land beside the pinyin instead of replacing it —
    // typing `w` then committing 我 left `w我` in the document.
    if (this.composing) return false
    const signature = markupSignature(this.blocks, this.views, this.lineStates, this.offsets)
    if (signature === this.signature) return false
    renderDocument(host, this.blocks, this.views, this.lineStates, this.offsets)
    this.signature = signature
    return true
  }

  private placeCaret(want: number): void {
    const host = this.host
    if (!host) return
    const index = this.blockAt(want)
    if (index < 0) return
    const view = this.views[index]
    if (!view) return
    if (applyCaret(host, index, view, this.offsets[index], want)) this.placedByUs = true
  }

  /**
   * Commits a new source to the model, then rebuilds the DOM and puts the caret
   * back — all in one synchronous frame, which is the whole point of the native
   * kernel: no reconciler can run in between, so no drift can accumulate.
   */
  private commit(next: string, caretNext: number): void {
    this.doc = next
    this.caret = clamp(caretNext, 0, next.length)
    this.pendingCaret = this.caret
    this.recompute()
    this.render()
    const want = this.pendingCaret
    this.pendingCaret = null
    if (want !== null) this.placeCaret(want)
    this.reportLine()
    this.hooks.onChange(next)
  }

  private reportLine(): void {
    const line = lineOfOffset(this.doc, this.caret)
    if (line === this.reportedLine) return
    this.reportedLine = line
    this.hooks.onCaretLineChange?.(line)
  }

  /** The block containing a document offset (`doc.length` clamps to the last). */
  private blockAt(offset: number): number {
    for (let i = 0; i < this.blocks.length; i++) {
      const end = i + 1 < this.offsets.length ? this.offsets[i + 1] : this.doc.length
      if (offset >= this.offsets[i] && offset < end) return i
    }
    return this.blocks.length - 1
  }

  /** Binary search over block start lines. */
  private lineToBlock(line: number): number {
    let low = 0
    let high = this.blocks.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (this.blocks[mid].startLine <= line) low = mid
      else high = mid - 1
    }
    return Math.max(0, low)
  }

  /* ---------------------------------------------------------------------- */
  /* DOM -> model                                                           */
  /* ---------------------------------------------------------------------- */

  /** Source offset of the current DOM selection, or null when outside. */
  private caretFromDom(): number | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const host = (
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    )?.closest?.<HTMLElement>('[data-block]')
    // The block must be OURS. `selectionchange` is a document-level event, and a
    // `[data-block]` says nothing about which editor instance owns it: a second
    // mounted kernel would read its own view against our offsets, believe the
    // caret had moved, and then place OUR caret over in the other editor. One
    // editor per page hides this, so the check is what makes it correct rather
    // than lucky.
    if (!host || !this.host?.contains(host)) return null
    const index = Number(host.dataset.block)
    const view = this.views[index]
    if (!view) return null
    const local = domToLocal(view, range.startContainer, range.startOffset)
    return local === null ? null : this.offsets[index] + local
  }

  private handleSelectionChange = (): void => {
    // Only a user gesture may move the caret. A report produced by our own
    // placement is ignored, otherwise a browser-clamped reading feeds back into
    // the model and the caret walks backwards by the length of every marker.
    if (this.placedByUs) return
    // `selectionchange` fires constantly while an IME composition is open, and
    // the reveal state around the caret changes as it grows. Reacting here would
    // rewrite the DOM mid-composition (see `render`).
    if (this.composing) return
    const source = this.caretFromDom()
    if (source === null) return
    this.caret = source
    this.recompute()
    // Revealing or collapsing markers around the new caret rewrites the DOM,
    // which would leave the browser's selection on a detached text node — so the
    // caret is re-applied in the same frame.
    if (this.render()) this.placeCaret(source)
    this.reportLine()
  }

  private handleBeforeInput = (): void => {
    this.placedByUs = false
    this.userEditPending = true
  }

  private handleCompositionStart = (): void => {
    this.placedByUs = false
    this.composing = true
  }

  private handleCompositionEnd = (): void => {
    this.composing = false
    // Deliberately no render here. The browser may fire `compositionend` BEFORE
    // the `input` that carries the committed text: at that moment the DOM already
    // holds the final characters while the model still holds the pinyin, and
    // rebuilding from the model would erase what was just committed. The
    // following `input` absorbs the committed DOM and renders as usual.
  }

  private handleInput = (): void => {
    const host = this.host
    if (!host || this.readOnly) return
    const userEdit = this.userEditPending
    this.userEditPending = false
    if (!userEdit) return

    // The browser sometimes injects ELEMENTS of its own into the editable tree
    // (native contenteditable Enter, rich-text paste). Strip them while we are
    // inside the input event; their text is salvaged into the parent line box so
    // pasted content is not lost with the wrapper element.
    sanitizeDom(host)

    // Absorb the WHOLE document. Rebuilding only the active block let cross-block
    // edits (select-all delete, multi-line delete, paste) desync the model: the
    // browser had already touched several blocks' DOM.
    const next = readDocumentSource(host) + readLooseText(host)
    if (next === this.doc) return
    const delta = next.length - this.doc.length

    // A PURE deletion leaves no inserted text: the browser is free to park the
    // caret anywhere after collapsing the deleted range — deleting a line's only
    // character often lands it at the end of the next line. The honest caret is
    // where the deleted text began, so the caret is decided from the diff instead
    // of the DOM on exactly this path.
    const prefix = sharedPrefix(this.doc, next)
    const insertedEnd = next.length - sharedSuffix(this.doc, next, prefix)
    const caretNext =
      insertedEnd <= prefix
        ? prefix
        : this.caretFromDom() ?? clamp(this.caret + delta, 0, next.length)

    // An IME composition is mid-flight: the DOM holds provisional text. Record
    // the model (undo snapshots are suppressed) but leave the DOM untouched so
    // the composition is not destroyed under the user.
    if (!this.composing) {
      this.pushUndo({ value: this.doc, caret: this.caret })
      this.commit(next, caretNext)
      return
    }

    this.doc = next
    this.caret = caretNext
    this.recompute()
    this.reportLine()
    this.hooks.onChange(next)
  }

  /* ---------------------------------------------------------------------- */
  /* keys                                                                   */
  /* ---------------------------------------------------------------------- */

  private handleKeyDown = (event: KeyboardEvent): void => {
    this.placedByUs = false
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      this.undo(event.shiftKey)
      return
    }
    // Document-edge jumps (Cmd+Down / Ctrl+End, Cmd+Up / Ctrl+Home). Chromium
    // gives these keys NO default caret motion in a contenteditable — the caret
    // stays put — so the kernel owns the jump. Shifted variants extend a
    // selection the kernel does not model; they stay untouched
    // (`.scratch/enter-backspace-smoke/issues/07`).
    if (mod && !event.shiftKey && !this.composing && !this.readOnly) {
      // The key set for each edge, like every other branch in this handler.
      if (event.key === 'ArrowDown' || event.key === 'End') {
        event.preventDefault()
        this.moveCaretToEdge(this.doc.length)
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'Home') {
        event.preventDefault()
        this.moveCaretToEdge(0)
        return
      }
    }
    if (mod || this.composing || this.readOnly) return

    // Keyed edits derive the caret from the DOM: a click or a selection the
    // browser moved may not have reached us yet, and acting on a stale caret
    // puts the newline in the wrong place. `null` means the DOM caret sits
    // outside every block (below the last line) — that case appends.
    const live = this.caretFromDom()

    if (event.key === 'Enter') {
      // Enter is ALWAYS intercepted: the browser's native contenteditable Enter
      // would inject a `<br>`/`<div>` into the DOM behind our back.
      event.preventDefault()
      if (live === null) {
        // Outside the blocks (a click below the last line): append a newline.
        this.pushUndo({ value: this.doc, caret: this.caret })
        this.insertNewlines(this.doc.length, 1, this.doc.length + 1)
        return
      }
      const index = this.blockAt(live)
      const block = this.blocks[index]
      if (!block) {
        this.pushUndo({ value: this.doc, caret: this.caret })
        this.insertNewlines(this.doc.length, 1, this.doc.length + 1)
        return
      }
      const { start: lineStart, end: lineEnd, text: currentLine } = this.lineBounds(live)
      const lineNumber = lineOfOffset(this.doc, lineStart)
      const kind = this.lineStates[lineNumber - 1]?.kind
      // A table ROW cannot take a bare newline: it would split the row into two
      // lines that no longer read as a table row, and the table falls apart.
      // There is no in-cell soft break to offer instead — the editor renders
      // inline HTML as text and the table model is one source line per row, so
      // a `<br>` would show as literal text and still not grow the cell — so
      // Enter (and its soft sibling Shift+Enter) do NOTHING inside a row or on
      // the `| --- |` rule line rather than corrupt the structure
      // (`.scratch/enter-backspace-smoke/issues/06`, decision recorded there).
      // A no-op takes no undo snapshot, exactly like the other guarded no-ops
      // (Backspace on a fence's first line): the stack stays a list of real
      // edits, so Cmd+Z never dead-steps.
      if (kind === 'table' || kind === 'table-delim') return
      this.pushUndo({ value: this.doc, caret: this.caret })
      if (event.shiftKey) {
        // Shift+Enter is the SOFT break: one plain newline, wherever the caret
        // is. Typora tells the two keys apart by the gap they leave — a soft
        // break stays inside the paragraph, so its line gap is the small one
        // (`.scratch/enter-backspace-smoke/issues/02`).
        const at = live
        this.insertNewlines(at, 1, at + 1)
        return
      }
      // Fenced code (marker or body line) has no paragraphs to split. A fence
      // line's own prefix IS the fence marker: repeating it would open a second
      // fence instead of a code line, so the fence marker stays a plain newline
      // here, exactly like a code line.
      if (kind === 'code' || kind === 'fence') {
        this.insertNewlines(live, 1, live + 1)
        return
      }
      // What a line carries in front of its content — a list marker (`- `, `2. `, a
      // task checkbox), a quote marker (`> `), or several nested (`> - `) — has ONE
      // owner: `parseLine`, which the line-kind pass reads too. Enter repeats that
      // markup on the new line, which is what makes `> ` continue a quote and a task
      // item keep its checkbox. Fence lines never reach this point: the fence
      // branch above returns first, because a fence line's `prefix` IS the fence
      // marker and repeating it would open a second fence.
      const parts = parseLine(currentLine)
      const prefix = parts.prefix

      const left = this.leavingEmptyItem(live)
      if (left) {
        this.commit(left.doc, left.caret)
        return
      }
      if (prefix !== '') {
        const nextPrefix = /^\s*\d+[.)]/.test(prefix)
          ? prefix.replace(
              /(\d+)([.)])/,
              (_m, n: string, d: string) => `${Number(n) + 1}${d}`,
            )
          : prefix
        const insert = `\n${nextPrefix}`
        const edited = this.doc.slice(0, live) + insert + this.doc.slice(live)
        // The item below keeps its own number in the source, so the new item must
        // push the rest down: renumber the lists instead of only bumping ours
        // (`1 2 3` + Enter on 2 used to give `1 2 3 3`).
        this.commit(renumberLists(edited), live + insert.length)
        return
      }
      // A plain line, caret at its very END: split AFTER the line's newline, so a
      // fresh empty line opens below. Inserting at `lineEnd` itself (just before
      // the existing '\n') produces the SAME string and made Enter a silent no-op
      // at the end of any line.
      if (live >= lineEnd) {
        if (currentLine === '') {
          // Blank line: one more blank line, exactly as before.
          const at = lineEnd < this.doc.length ? lineEnd + 1 : this.doc.length
          this.insertNewlines(at, 1, live + 1)
          return
        }
        // Enter is the HARD break: it leaves a paragraph gap, i.e. one blank
        // line MORE than Shift+Enter's plain newline — the source-level
        // difference Typora shows as "Enter 的换行距离比 Shift+Enter 大"
        // (`.scratch/enter-backspace-smoke/issues/01`). The caret lands at the
        // start of the FIRST fresh line (`at + 1`), so typing right after Enter
        // opens a paragraph of its own, an empty line above and below it. At
        // the very END of the document, when the line has NO trailing newline
        // (`lineEnd === doc.length`), both fresh lines trail the text and the
        // caret goes past them (`at + 2`): typing then starts the new paragraph
        // one blank line below.
        const at = lineEnd < this.doc.length ? lineEnd + 1 : this.doc.length
        this.insertNewlines(at, 2, lineEnd === this.doc.length ? at + 2 : at + 1)
        return
      }
      // Line START: an empty line opens above (unchanged).
      if (live === lineStart) {
        this.insertNewlines(live, 1, live + 1)
        return
      }
      // MID-line: the hard break splits the paragraph here — one blank line
      // between the two halves, caret on the second half's first character.
      this.insertNewlines(live, 2, live + 2)
      return
    }

    if (event.key === 'Tab') {
      // Tab ALWAYS stops here. Letting it through moves focus out of the page —
      // with nothing focusable left, the browser hands it to its own chrome (the
      // address bar), which is jarring mid-edit. What it DOES is the list-key
      // rule: nest the item, lift it back out, turn it into a paragraph at the
      // outermost level, or — on the list's first line, where there is nothing to
      // nest under — plain spaces at the caret (`indentListItem`). Anywhere else
      // it does nothing.
      event.preventDefault()
      if (live === null) return
      const edited = indentListItem(this.doc, live, event.shiftKey ? 'out' : 'in')
      if (!edited) return
      this.pushUndo({ value: this.doc, caret: this.caret })
      this.commit(edited.doc, edited.caret)
      return
    }

    // Backspace at a list item's CONTENT start steps the line out of its block —
    // the whole prefix at once, rather than the browser taking it one character
    // at a time. Two rules, and both have to come BEFORE the line joins below,
    // which would otherwise swallow the marker into the line above:
    //
    // 1. An EMPTY item (`2. ` alone on the line) leaves the list, the same way
    //    Enter does. Without it the browser deleted the marker's own trailing
    //    space and the line became `2.` — not an item as far as the editor's scan
    //    is concerned, an empty one as far as markdown-it is — and one more
    //    Backspace turned it into a bare `2` glued onto the item above as a lazy
    //    continuation.
    // 2. A NON-EMPTY item goes through `backspaceAtContentStart`: the marker goes
    //    and the body joins the block above (a nested item only steps out one
    //    level). Without it the browser deleted the marker's separator space
    //    (`3. ccc` → `3.ccc`), so the item's text turned into ordinary text — the
    //    list silently lost an item, and the next press or two kept eating marker
    //    characters until the caret stood at the line start, where the join rule
    //    below swallows the line into the item ABOVE. Measured
    //    keystroke-by-keystroke in `.scratch/backspace-unlist/issues/01`: the
    //    fourth press deleted the previous item's text.
    if (event.key === 'Backspace' && live !== null) {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        const left = this.leavingEmptyItem(live) ?? backspaceAtContentStart(this.doc, live)
        if (left) {
          event.preventDefault()
          this.pushUndo({ value: this.doc, caret: this.caret })
          this.commit(left.doc, left.caret)
          return
        }

        // At a source LINE START that still carries block markup in front (list
        // marker, task box, quote), Backspace steps OUT of the block — the same
        // unlist as at the content start — rather than joining the marker onto
        // the line above (`.scratch/enter-backspace-smoke/issues/03`). Reaching
        // "the start" via Home lands here (including the document's first
        // line); clicking lands at the content start, which
        // `backspaceAtContentStart` already handled. Hop the caret to the same
        // place so both paths produce the same edit.
        const line = this.lineBounds(live)
        if (line.start === live) {
          const parts = parseLine(line.text)
          const contentStart = line.start + parts.prefix.length
          if (contentStart > line.start) {
            const unlist = backspaceAtContentStart(this.doc, contentStart)
            if (unlist) {
              event.preventDefault()
              this.pushUndo({ value: this.doc, caret: this.caret })
              this.commit(unlist.doc, unlist.caret)
              return
            }
          }
        }

        // The first FENCED line's own start: the line above is the fence
        // marker, and joining would glue code onto the fence
        // (`.scratch/enter-backspace-smoke/issues/05`). Do nothing rather than
        // damage the block; other code lines still join the code line above.
        if (line.start === live) {
          const lineNumber = lineOfOffset(this.doc, line.start)
          if (this.lineStates[lineNumber - 2]?.kind === 'fence') {
            event.preventDefault()
            return
          }
        }
      }
    }

    // Backspace at the START of a source line: join it with the previous line by
    // deleting exactly that newline. Letting the browser do it is what ate a
    // character out of the previous block's text node instead — the browser sees
    // our line boxes, not source lines, so from an empty line box it deleted the
    // last character of the nearest text it could find and then dropped a line.
    // (This also covers the old "caret at a block start" case, which is just a
    // line start at a block boundary.)
    //
    // A line with an indentation has a second start, its CONTENT start, and
    // Backspace there means the same thing: the indentation is the item's
    // continuation indent rather than text, so it goes away with the break
    // (`continuationIndent` decides; `2. b` + `ccc` becomes `2. bccc`).
    if (event.key === 'Backspace' && live !== null && live > 0) {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        const line = this.lineBounds(live)
        const before = this.doc.slice(line.start, live)
        // A line start joins whatever follows it; a CONTENT start only joins when
        // the indentation in front of it is a continuation indent — otherwise
        // (`null`) this keystroke is not ours.
        const joinIndent = before === '' ? '' : this.continuationIndent(before, line)
        if (joinIndent !== null) {
          event.preventDefault()
          this.pushUndo({ value: this.doc, caret: this.caret })
          const drop = joinIndent.length + 1
          const joined = this.doc.slice(0, live - drop) + this.doc.slice(live)
          // Backspace joining a line that has TEXT to the content above: land the
          // caret at the END of that content, not at the start of the line below.
          // `live - 1` would sit on an invisible blank line, so the caret read as
          // "jumped in front of the next line's text" and typing glued itself to
          // the following block. It is also where Enter's reverse lands — Enter
          // then Backspace returns to the offset from before Enter — in THIS
          // case; Enter at the end of a blank line has its reverse in the branch
          // below; the two are not the same offset.
          //
          // A caret that was ON an empty line is a different case, and it must not
          // walk: the blank run is the user's, one Backspace takes one newline,
          // and the caret stays on what is left of it. Walking back from there put
          // the caret at the end of the paragraph above — one keystroke away from
          // deleting its last character, which is what
          // `.scratch/enter-backspace-smoke/issues/09` reports.
          let caret = live - drop
          if (!isBlankLine(line.text)) {
            while (caret > 0 && joined[caret - 1] === '\n') caret--
          }
          this.commit(joined, caret)
          return
        }
      }
    }
  }

  /**
   * Takes an EMPTY item (`- ` alone on its line, caret anywhere on it) out of its
   * list: the marker goes, the line stays as a blank line, and the rest of the
   * list is renumbered. A lone quote marker (`> `) leaves its quote the same way.
   *
   * Both keys that mean "leave this item" land here. Enter opens the next item,
   * and exits the list when this one has nothing in it. Backspace would otherwise
   * delete the marker's own trailing space and leave `2.` behind — a form the
   * editor's own scan does not read as an item (`parseListItem` wants whitespace
   * after the delimiter) while markdown-it reads it as an empty one, so the same
   * document said two different things on screen and in the export.
   *
   * Returns the new document and caret, or null when this line is not an empty
   * item. The callers push undo themselves: Enter already has.
   */
  private leavingEmptyItem(live: number): { doc: string; caret: number } | null {
    const { start: lineStart, text: line } = this.lineBounds(live)
    const lineNumber = lineOfOffset(this.doc, lineStart)
    // A fence's contents are text, not Markdown: a `- ` inside one is an example,
    // not an item to leave.
    if (this.lineStates[lineNumber - 1]?.kind === 'code') return null
    // The list case asks `parseListItem` — the one owner of list syntax — rather
    // than a second grammar. It reports an empty body exactly when the line holds
    // nothing but its marker.
    const item = parseListItem(line)
    const marker =
      item !== null && item.body === '' ? item.indent + item.marker : /^>\s*$/.test(line) ? line : null
    if (marker === null) return null
    const withoutMarker = this.doc.slice(0, lineStart) + this.doc.slice(lineStart + marker.length)
    // Leaving the list splits it in two, so the tail starts again at 1. The
    // renumbering can also SHORTEN the lines above (`10.` becomes `1.`), so the
    // caret is read off the final text instead of the old offset — the line
    // number survives, offsets do not.
    const doc = renumberLists(withoutMarker)
    return { doc, caret: offsetForLine(doc, lineNumber) }
  }

  /**
   * Insert `n` newlines at `at` and commit, caret given explicitly. Every Enter
   * branch reduces to this one shape: `n = 2` is the hard break (one blank line
   * more than the soft single newline), `n = 1` the soft one or a plain line
   * append. The caller pushes the undo snapshot first.
   */
  private insertNewlines(at: number, n: 1 | 2, caret: number): void {
    this.commit(this.doc.slice(0, at) + '\n'.repeat(n) + this.doc.slice(at), caret)
  }

  /**
   * The source line holding `live`: where it starts, where it ends (the newline
   * itself excluded), and its text.
   *
   * Enter, the empty-item rule and the line joins all need these three numbers and
   * they have to agree — one source line is one line box, so every one of these
   * decisions is made in source offsets, not in the DOM.
   */
  private lineBounds(live: number): LineBounds {
    const start = this.doc.lastIndexOf('\n', Math.max(0, live - 1)) + 1
    const endRaw = this.doc.indexOf('\n', live)
    const end = endRaw === -1 ? this.doc.length : endRaw
    return { start, end, text: this.doc.slice(start, end) }
  }

  /**
   * The indentation of the line `live` sits on, when Backspace there means "join
   * this continuation line to the line above" — null when it means anything else.
   *
   * A continuation line inside a list item (`1. aaa` / `2. b` / an indented `ccc`)
   * is ONE paragraph in the picture: the indentation is where Markdown wants the
   * item's content, not text the user typed. So Backspace at the content start
   * takes the break and the indentation together, and the source becomes
   * `2. bccc` — the same "no space is inserted" join as at a line start, one
   * keystroke earlier than the browser would manage it.
   *
   * The test is the line's KIND, so it covers the nested cases the same way:
   * `kind === 'text'` is exactly "no block markup of its own here" — not a list
   * item, a quote, a heading, a rule, a table row, a note, a fence or code. Two
   * consequences worth naming:
   *
   * - `  - bbb` in a nested list may LOOK like an indented continuation, but its
   *   indentation IS its level: joining it up would swallow the marker that makes
   *   it an item, so the kind check keeps it out.
   * - an indented code block (`    code`, no fence) is not a line kind this editor
   *   models at all — it reads as text here, exactly as it does in every other
   *   line rule, so its indentation goes with the break too.
   */
  private continuationIndent(before: string, line: LineBounds): string | null {
    if (before === '' || !isBlankLine(before)) return null
    // Exactly at the content start, and with content after it: a caret inside the
    // indentation, or on a whitespace-only line, is deleting whitespace.
    if (/^[ \t]*/.exec(line.text)?.[0] !== before) return null
    if (line.text.length === before.length) return null
    const lineNumber = lineOfOffset(this.doc, line.start)
    return this.lineStates[lineNumber - 1]?.kind === 'text' ? before : null
  }

  private handleMouseDown = (event: MouseEvent): void => {
    // A click decides the caret itself — but we must NOT preventDefault: killing
    // the mousedown default also kills the browser's native text selection, so
    // text could never be sweep-selected with the mouse.
    this.placedByUs = false
    if (this.composing) return
    const host = this.host
    if (!host || this.readOnly) return
    const hit = sourceOffsetAtPoint(event.clientX, event.clientY, event.target as Element | null)
    if (!hit) return

    // Cmd/Ctrl+click follows a link, the way it does everywhere else. It has to be
    // done by hand: a link is a `span` and not an `<a>` on purpose (a plain click in
    // edit mode has to place the caret), so the browser has nothing to follow and
    // nothing to take over. Here the default IS suppressed — the caret must not move
    // under a link the user is only visiting.
    if (event.metaKey || event.ctrlKey) {
      const href = this.linkAt(hit.block, hit.local)
      if (href !== null) {
        event.preventDefault()
        // `noopener` so the opened page gets no handle on this one; the export sets
        // the same pair on its anchors.
        window.open(href, '_blank', 'noopener,noreferrer')
        return
      }
    }

    const target = this.offsets[hit.block] + hit.local
    this.caret = target
    this.recompute()
    // Only a changed rendering invalidates the browser's own selection.
    if (this.render()) this.placeCaret(target)
    this.reportLine()
  }

  private handleMouseUp = (): void => {
    // A drag-select ends here: let the browser's final selection reach the model.
    this.placedByUs = false
  }

  /**
   * The href of the link run covering a block-local source offset, or null.
   *
   * Read from the VIEW rather than from the span's DOM attributes. The view is the
   * truth and the DOM is its reflection (ADR-0001), and the only href the DOM
   * carries today is the `title` tooltip, which merely happens to hold the same
   * string — following a tooltip is not a contract worth being built on.
   *
   * Returns null for a URL the export would refuse, so a `[x](javascript:…)` in the
   * document cannot become click-to-execute. That gate is `exportableHref`, the
   * same one the autolink scan uses, which is markdown-it's own `validateLink`.
   */
  private linkAt(block: number, local: number): string | null {
    const view = this.views[block]
    if (!view) return null
    for (const line of view.lines) {
      for (const run of line.runs) {
        if (run.marker || run.mark.link === undefined) continue
        if (local >= run.src && local < run.src + run.text.length) {
          return exportableHref(run.mark.link)
        }
      }
    }
    return null
  }

  private pushUndo(snapshot: Snapshot): void {
    // Skip only when this exact state is already on TOP of the stack (which would
    // make an undo step a no-op). A seeded placeholder value would silently eat
    // the first edit's pre-state and make that edit impossible to undo, so the
    // comparison has to be against a real pushed snapshot.
    //
    // The top of the stack, NOT a separate "last pushed" field: after an undo the
    // stack has moved, so the top is an older state and the incoming snapshot is
    // right to be pushed. A separate field that `undo()` also wrote would still
    // name the state just restored — i.e. the current document — and swallow the
    // first edit after every undo: Ctrl+Z then did nothing (empty stack) or
    // jumped an extra step back (non-empty stack).
    const top = this.undoStack[this.undoStack.length - 1]
    if (top && top.value === snapshot.value) return
    this.undoStack.push(snapshot)
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack = []
  }

  private undo(redo: boolean): void {
    const from = redo ? this.redoStack : this.undoStack
    const to = redo ? this.undoStack : this.redoStack
    const snapshot = from.pop()
    if (!snapshot) return
    to.push({ value: this.doc, caret: this.caret })
    this.commit(snapshot.value, snapshot.caret)
  }
}
