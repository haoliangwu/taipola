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
import { computeLineStates, type LineState } from '../core/inline'
import { buildBlockView, type BlockView } from '../core/view'
import type { EditBuffers } from '../core/editCommands'
import { indentListItem, renumberLists } from '../core/lists'
import {
  markupSignature,
  readDocumentSource,
  readLooseText,
  renderDocument,
  sanitizeDom,
} from './render'
import { lineOfOffset, offsetForLine } from '../core/lines'
import { applyCaret, domToLocal, sourceOffsetAtPoint } from './position'

const UNDO_LIMIT = 300

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
      return buildBlockView(block.raw, start, revealed, block.endLine - block.startLine)
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
    if (!host) return null
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

    // An IME composition is mid-flight: the DOM holds provisional text. Record
    // the model (undo snapshots are suppressed) but leave the DOM untouched so
    // the composition is not destroyed under the user.
    if (!this.composing) {
      this.pushUndo({ value: this.doc, caret: this.caret })
      const delta = next.length - this.doc.length
      this.commit(next, this.caretFromDom() ?? clamp(this.caret + delta, 0, next.length))
      return
    }

    const delta = next.length - this.doc.length
    this.doc = next
    this.caret = clamp(this.caretFromDom() ?? this.caret + delta, 0, next.length)
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
      this.pushUndo({ value: this.doc, caret: this.caret })
      if (event.shiftKey) {
        const at = live ?? this.doc.length
        this.commit(this.doc.slice(0, at) + '\n' + this.doc.slice(at), at + 1)
        return
      }
      if (live === null) {
        // Outside the blocks (a click below the last line): append a newline.
        this.commit(this.doc + '\n', this.doc.length + 1)
        return
      }
      const index = this.blockAt(live)
      const block = this.blocks[index]
      if (!block) {
        this.commit(this.doc + '\n', this.doc.length + 1)
        return
      }
      const lineStart = this.doc.lastIndexOf('\n', Math.max(0, live - 1)) + 1
      const lineEndRaw = this.doc.indexOf('\n', live)
      const lineEnd = lineEndRaw === -1 ? this.doc.length : lineEndRaw
      const currentLine = this.doc.slice(lineStart, lineEnd)
      const prefix =
        /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|>\s*)/.exec(currentLine)?.[0] ?? ''
      const body = currentLine.slice(prefix.length)

      // An EMPTY item (`- ` alone on the line, caret anywhere on it) exits the
      // list: the bullet is removed but the line stays as a blank line.
      if (prefix !== '' && currentLine === prefix && body.trim() === '') {
        const withoutBullet =
          this.doc.slice(0, lineStart) + this.doc.slice(lineStart + prefix.length)
        // Leaving the list splits it in two, so the tail starts again at 1.
        this.commit(renumberLists(withoutBullet), lineStart)
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
        // Insert AFTER the line's own newline so the fresh line opens below it,
        // but put the caret at the START of that new line (`live + 1`). Using
        // the insertion point (`at + 1`) overshot by one line whenever the
        // current line was empty: the caret landed on the start of the NEXT
        // line's text, so typing glued onto the following paragraph.
        const at = lineEndRaw === -1 ? this.doc.length : lineEndRaw + 1
        this.commit(this.doc.slice(0, at) + '\n' + this.doc.slice(at), live + 1)
        return
      }
      this.commit(this.doc.slice(0, live) + '\n' + this.doc.slice(live), live + 1)
      return
    }

    if (event.key === 'Tab') {
      // Tab ALWAYS stops here. Letting it through moves focus out of the page —
      // with nothing focusable left, the browser hands it to its own chrome (the
      // address bar), which is jarring mid-edit. On a list item it nests the item
      // (Shift+Tab lifts it back out); anywhere else it does nothing.
      event.preventDefault()
      if (live === null) return
      const indented = indentListItem(this.doc, live, event.shiftKey ? 'out' : 'in')
      if (!indented) return
      this.pushUndo({ value: this.doc, caret: this.caret })
      this.commit(indented.doc, indented.caret)
      return
    }

    // Backspace at the START of a source line: join it with the previous line by
    // deleting exactly that newline. Letting the browser do it is what ate a
    // character out of the previous block's text node instead — the browser sees
    // our line boxes, not source lines, so from an empty line box it deleted the
    // last character of the nearest text it could find and then dropped a line.
    // (This also covers the old "caret at a block start" case, which is just a
    // line start at a block boundary.)
    if (event.key === 'Backspace' && live !== null && live > 0 && this.doc[live - 1] === '\n') {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        event.preventDefault()
        this.pushUndo({ value: this.doc, caret: this.caret })
        this.commit(this.doc.slice(0, live - 1) + this.doc.slice(live), live - 1)
        return
      }
    }
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
