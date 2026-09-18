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
import { paragraphizeTypedBlankLine } from '../core/paragraphize'
import { computeLineStates, parseLine, type LineState } from '../core/inline'
import { buildBlockView, type BlockView } from '../core/view'
import { exportableHref } from '../core/markdownIt'
import {
  enterMidParagraph,
  backspaceJoinParagraphs,
  enterEndParagraph,
  enterEndOfLine,
  enterBlankLine,
} from '../core/blockEdit'
import type { EditBuffers } from '../core/editCommands'
import {
  backspaceAtContentStart,
  flipTaskCheckboxAt,
  indentListItem,
  parseListItem,
  renumberLists,
} from '../core/lists'
import {
  markupSignature,
  readDocumentSource,
  readLooseText,
  renderDocument,
  sanitizeDom,
} from './render'
import { isBlankLine, lineOfOffset, offsetForLine } from '../core/lines'
import { blocksTableBackspace, inTable, moveTableCell, pasteTableCell, tableAt, type TableContext } from '../core/tables'
import { applyCaret, domToLocal, sourceOffsetAtPoint } from './position'

const UNDO_LIMIT = 300

/**
 * True when a COLLAPSED source run ends at or before the collapsed caret, inside
 * the caret's own line box — the geometry Chromium's native delete-backward
 * mishandles: at a boundary that touches a `display: none` run it deletes that
 * whole run as well, so one Backspace at the end of `~~a~~z` removed `z` AND the
 * closing `~~` (`caret-assertions/03`). `offsetParent === null` is the layout
 * fact (not a class name) that says the run contributes no visible text.
 */
function hiddenSourceBeforeCaret(sel: Selection): boolean {
  const anchor = sel.anchorNode
  const line = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('[data-vline]')
  if (!line) return false
  const caret = sel.getRangeAt(0)
  for (const run of line.querySelectorAll<HTMLElement>('[data-run]')) {
    if (run.offsetParent !== null) continue
    if (!run.textContent) continue
    const range = document.createRange()
    range.selectNodeContents(run)
    // The run's END at or before the caret's start: the browser would walk over it.
    if (range.compareBoundaryPoints(Range.END_TO_START, caret) <= 0) return true
  }
  return false
}

/**
 * The source offset of the grapheme before `at`, so Backspace never cuts an
 * emoji or a combining sequence in half. (`Intl.Segmenter` is in every browser
 * this editor targets; the fallback keeps older engines on one code unit.)
 */
function previousGraphemeStart(doc: string, at: number): number {
  if (typeof Intl.Segmenter !== 'function') return at - 1
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(doc.slice(0, at))]
  const last = segments[segments.length - 1]
  return last ? last.index : at - 1
}

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
  /**
   * True on the input that CARRIES a composition's commit (set at
   * `compositionend`, consumed by the next input). The DOM still holds the
   * composition's provisional shape then — see `handleInput` and `handleCompositionEnd`.
   */
  private composed = false
  /**
   * Model offset where the composition started (`compositionstart`). The one
   * reliable anchor across a composition: the DOM is in its provisional shape
   * the whole time, so every DOM-based read is off by a line or two; the
   * committed caret is this, plus the composed text's LENGTH (tracked from each
   * `insertCompositionText` input's `data`).
   */
  private composeStart = 0
  private composeLength = 0
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
    host.addEventListener('copy', this.handleCopy)
    host.addEventListener('paste', this.handlePaste)
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
    host.removeEventListener('copy', this.handleCopy)
    host.removeEventListener('paste', this.handlePaste)
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

  /**
   * Applies an edit to the WHOLE document, at document offsets, or does nothing
   * when the edit declines.
   *
   * `applyEdit` is block-scoped — its buffer is the caret's block, which is what
   * every formatting command wants. A TABLE command is not quite: a table is one
   * block, but the blank lines around it are not, so DELETING a table has to be
   * able to take one of them with it or it leaves a hole
   * (`.scratch/table-ops/issues/03`). The kernel owns the document, the caret and
   * the undo stack, so this is one method rather than a new layer.
   */
  applyDocumentEdit(
    mutate: (doc: string, caret: number) => { doc: string; caret: number } | null,
  ): void {
    const result = mutate(this.doc, this.caret)
    if (!result) return
    this.pushUndo({ value: this.doc, caret: this.caret })
    this.commit(result.doc, result.caret)
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
      // A blank block's span covers possibly several source lines (its raw holds
      // only the whitespace those lines carry, if any); render one line box per
      // blank line so the view mirrors the document exactly.
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
    // A keystroke that turns a whole blank line into a line of text gives that
    // line a paragraph of its OWN — a blank line on each side — so the
    // paragraph boundary, and the spacing hanging on it, survives the edit
    // (`paragraph-spacing/01` 十审: typing on a blank CREATES a block).
    // Everything else is untouched.
    //
    // The gate is the OLD line's kind: only a true blank line (outside any
    // structure) triggers. A blank line INSIDE a fence, table, quote or list
    // keeps its old editor behaviour — fencing paragraphs there would break
    // code, rows and items.
    const clamped = clamp(caretNext, 0, next.length)
    const inserted = next.length - this.doc.length
    if (inserted > 0) {
      const insertStart = clamped - inserted
      if (insertStart >= 0) {
        const lineStart = lineOfOffset(this.doc, insertStart)
        const kind = this.lineStates[lineStart - 1]?.kind
        if (kind === 'blank' || kind === undefined) {
          const paragraphized = paragraphizeTypedBlankLine(this.doc, next, clamped)
          if (paragraphized !== null) {
            next = paragraphized.doc
            caretNext = paragraphized.caret
          }
        }
      }
    }
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

  /**
   * `offset`, unless it sits on a table's `| --- |` rule row — then the first body
   * cell of that table, which is the nearest real text position (see the caller).
   */
  private offRuleRow(offset: number): number {
    const table = tableAt(this.doc, offset)
    if (!table || table.line !== table.delimiterLine) return offset
    return moveTableCell(this.doc, offset, 'next')?.caret ?? offset
  }

  /**
   * The table the caret is in, or null — what the shell's table menu asks before
   * offering anything. The KERNEL answers it because it owns both halves of the
   * question (the document and the caret); the shell only decides where to draw.
   */
  tableAtCaret(): TableContext | null {
    return tableAt(this.doc, this.caret)
  }

  /** Source offset of a DOM position, or null when it is not inside our document. */
  private domSourceOffset(container: Node, offset: number): number | null {
    // The root itself is a position only at its two edges — a select-all's
    // range END sits exactly there (`endContainer` = the host, `endOffset` =
    // its child count). Anywhere else on the root there is no character to
    // speak of, so only the edges map to the document's own edges.
    if (container === this.host) {
      if (offset === 0) return 0
      if (offset >= container.childNodes.length) return this.doc.length
      return null
    }
    const host = (
      container instanceof Element ? container : container.parentElement
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
    const local = domToLocal(view, container, offset)
    return local === null ? null : this.offsets[index] + local
  }

  /** Source offset of the current DOM selection's start, or null when outside. */
  private caretFromDom(): number | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    return this.domSourceOffset(range.startContainer, range.startOffset)
  }

  /** Source offset of the current DOM selection's end, or null when outside. */
  private caretEndFromDom(): number | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    return this.domSourceOffset(range.endContainer, range.endOffset)
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
    // A caret that lands on a table's `| --- |` row is not a text position: the row
    // is the table's structure, and TYPING there wrote into it — the rule row came
    // back as `一| --- | --- |` and the table stopped being a table at all. Arrow
    // down from the header row is enough to get there. The row's own first body
    // cell is where the caret belongs instead.
    const safe = this.offRuleRow(source)
    this.caret = safe
    this.recompute()
    // Revealing or collapsing markers around the new caret rewrites the DOM,
    // which would leave the browser's selection on a detached text node — so the
    // caret is re-applied in the same frame. A REDIRECTED caret is re-applied even
    // when the rendering did not change: the browser types at its own selection,
    // so leaving it on the rule row would put the next character there anyway.
    if (this.render() || safe !== source) this.placeCaret(safe)
    this.reportLine()
  }

  /**
   * Copy and cut hand the SELECTION over as markdown SOURCE, not as the
   * browser's own payload. The browser serializes the selection as the plain
   * text OF THE RENDERED VIEW: `#`s, `**` markers, list dashes and table
   * pipes gone, inline math in fragments (`E\n=\nm\nc\n2`). Copy→paste inside
   * the editor would then lose the document's structure, and so would pasting
   * into any other app. `text/plain` is rewritten to the source slice between
   * the selection's edges, and the default action is canceled (it would clear
   * the data store and write the rendered serialization back) — the clipboard
   * carries exactly the markdown source. The paste side never reads `text/html`.
   */
  private handleCopy = (event: ClipboardEvent): void => {
    if (this.readOnly) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const startMapped = this.caretFromDom()
    const endMapped = this.caretEndFromDom()
    if (startMapped === null || endMapped === null) return
    let from = Math.min(startMapped, endMapped)
    let to = Math.max(startMapped, endMapped)
    // A selection that begins at a line's first VISIBLE character or ends at
    // its last one is missing the COLLAPSED markers beside it — a rendered
    // `# 标题` hides its `# `, and Chromium's select-all CANNOT include it
    // (the range starts at the first laid-out character). Copying a whole
    // document would therefore drop the first line's markers. Extend each such
    // end to its line boundary, so the slice keeps the markdown the user is
    // looking at. The expansion is keyed to which range end maps to `from`
    // (reversed selections swap the containers).
    const forwards = startMapped <= endMapped
    from =
      (forwards
        ? this.copyLineEdge(range.startContainer, from, 'start')
        : this.copyLineEdge(range.endContainer, from, 'start')) ?? from
    to =
      (forwards
        ? this.copyLineEdge(range.endContainer, to, 'end')
        : this.copyLineEdge(range.startContainer, to, 'end')) ?? to
    if (from === to) return
    const data = event.clipboardData
    if (!data) return
    data.setData('text/plain', this.doc.slice(from, to))
    // The browser's own copy default action CLEARS the data store and replaces
    // it with the selection's serialization — a handler-set text/plain survives
    // only when the default is canceled (`handleCopy` in a real Chromium read
    // the payload back as the rendered text until this line was added). The
    // clipboard then carries exactly what we wrote: the markdown source.
    event.preventDefault()
  }

  /**
   * The line boundary a range end touches, when every run on that side of its
   * run is COLLAPSED — null when the selection is not at a line's visible edge.
   *
   * `start` returns the line's source start (so the hidden markers BEFORE the
   * first visible run join the slice); `end` returns the line's source end
   * (the hidden markers AFTER the last visible run). A run's `display` is the
   * layout fact that says whether it contributes visible text.
   */
  private copyLineEdge(container: Node, offset: number, side: 'start' | 'end'): number | null {
    const run = (
      container instanceof Element ? container : container.parentElement
    )?.closest?.<HTMLElement>('[data-run]')
    if (!run) return null
    const vline = run.closest<HTMLElement>('[data-vline]')
    if (!vline) return null
    const runs = [...vline.querySelectorAll<HTMLElement>(':scope > [data-run]')]
    const idx = runs.indexOf(run)
    if (idx < 0) return null
    const visible = (el: HTMLElement) => getComputedStyle(el).display !== 'none'
    const lineNo = lineOfOffset(this.doc, offset)
    if (side === 'start') {
      if (runs.slice(0, idx).some(visible)) return null
      return offsetForLine(this.doc, lineNo)
    }
    if (runs.slice(idx + 1).some(visible)) return null
    return Math.min(offsetForLine(this.doc, lineNo + 1) - 1, this.doc.length)
  }

  /**
   * Paste inserts the clip's PLAIN TEXT as a MODEL edit — the HTML is never
   * inserted.
   *
   * A clip from this editor carries the RENDERED DOM as `text/html` (the
   * browser serializes the selection as its `[data-block]`/`[data-vline]`/
   * `[data-run]` elements, inline styles and all). Inserting that would hand
   * `sanitizeDom` a fragment wearing OUR attributes: it is trusted as the
   * document tree, the insert-point nesting re-parents it INSIDE the active
   * block's line box, and the whole copied document comes back merged into
   * that one block — a full welcome document, pasted onto a heading, returns
   * as one giant heading. The model edit dodges that entirely: the source
   * `handleCopy` writes is replaced into the selection's source range and the
   * kernel re-renders — one source line stays one line box, and a row stays a
   * row. Foreign rich text (Word, a web page) flattens to its `text/plain`,
   * the same way the old sanitize-flattening did, only with the text intact.
   */
  private handlePaste = (event: ClipboardEvent): void => {
    if (this.readOnly) return
    const data = event.clipboardData
    if (!data || !Array.from(data.types).includes('text/plain')) return
    const text = data.getData('text/plain').replace(/\r\n?/g, '\n')
    if (text === '') return
    event.preventDefault()

    // The paste is a MODEL edit, not a DOM edit: replace the selection's source
    // range with the clip's plain text and let `commit` re-render. The DOM is
    // never touched, so none of the browser's insertion quirks can reach the
    // document — Chromium's `insertHTML` would hand the editor a fragment of
    // ITS OWN rendered DOM (the copied `[data-block]`/`[data-run]` elements),
    // which `sanitizeDom` trusts and the insert-point nesting buries inside the
    // active block's line box: a copied welcome document pasted onto a heading
    // came back as one giant heading (`clipboard/01`). Even `insertText` splits
    // a table ROW on `\n` — and a row is one source line (`table-ops/04`).
    const start = this.caretFromDom()
    const end = this.caretEndFromDom()
    if (start === null || end === null) return
    const rawFrom = Math.min(start, end)
    const rawTo = Math.max(start, end)

    // Pasting inside a table ROW: the clip's newlines must not split the row,
    // so — like `cellSource` on read — newline runs and their surrounding
    // spaces become ONE space and the cell padding goes. A single-cell range
    // is then rebuilt as the row (`pasteTableCell` re-pads every cell), so the
    // caret sitting on an empty cell's padding cannot leave the padding inside
    // the content. Outside a row the text keeps its newlines and re-parses
    // into the blocks they make.
    if (inTable(this.doc, rawFrom)) {
      const flattened = text.replace(/[ \t]*\n[ \t]*/g, ' ').trim()
      const cellPaste = pasteTableCell(this.doc, rawFrom, rawTo, flattened)
      if (cellPaste) {
        this.pushUndo({ value: this.doc, caret: this.caret })
        this.commit(cellPaste.doc, cellPaste.caret)
        return
      }
      this.pushUndo({ value: this.doc, caret: this.caret })
      this.commit(
        this.doc.slice(0, rawFrom) + flattened + this.doc.slice(rawTo),
        rawFrom + flattened.length,
      )
      return
    }

    // Replace the selection's source range — extended to the line edges the way
    // the COPY side does (`copyLineEdge`; clipboard/01). Chromium's ⌘A starts
    // its range at the first VISIBLE run, leaving a collapsed line marker (`# `
    // on the document's first line) OUTSIDE the range; without the same
    // extension here, replacing the whole document would keep that marker and
    // the pasted first line would come back as a heading (clipboard/02). The
    // range ends are only extended when their run sits at a line's collapsed
    // edge — the same judgement the copy side relies on.
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    // A collapsed range is a caret, not a selection: extending it would make a
    // paste at the end of a line replace the WHOLE line.
    const hasSelection = range !== null && !range.collapsed
    const from = hasSelection
      ? (this.copyLineEdge(range.startContainer, start, 'start') ?? rawFrom)
      : rawFrom
    const to = hasSelection
      ? (this.copyLineEdge(range.endContainer, end, 'end') ?? rawTo)
      : rawTo

    this.pushUndo({ value: this.doc, caret: this.caret })
    this.commit(this.doc.slice(0, from) + text + this.doc.slice(to), from + text.length)
  }

  private handleBeforeInput = (): void => {
    this.placedByUs = false
    this.userEditPending = true
  }

  private handleCompositionStart = (): void => {
    this.placedByUs = false
    this.composing = true
    this.composeStart = this.caret
    this.composeLength = 0
  }

  private handleCompositionEnd = (): void => {
    this.composing = false
    if (!this.host) {
      this.composed = true
      return
    }
    // Split the commit into its two shapes with ONE DOM read:
    //
    // - DOM matches the model (an ASCII commit — pinyin `ABC` lands as `ABC`):
    //   the browser may then fire NO further input at all (CDP's
    //   `Input.insertText` commits this way; `.scratch/enter-backspace-smoke/11`),
    //   leaving the caret where the browser parked it — some line below the text,
    //   because the composition's provisional shape still holds. Normalize the
    //   DOM right here and place the caret at `composeStart + composeLength` —
    //   the one position that survives every shape.
    //
    // - DOM differs from the model (a CJK commit: the DOM already holds the final
    //   characters while the model still holds the pinyin): rebuilding now would
    //   erase what was just committed, so set `composed` and let the commit input
    //   that follows absorb it and decide the caret from the diff (`insertedEnd`).
    const next = readDocumentSource(this.host) + readLooseText(this.host)
    if (next === this.doc) {
      this.composed = false
      if (this.render()) this.placeCaret(this.composeStart + this.composeLength)
    } else {
      this.composed = true
    }
  }

  private handleInput = (event: Event): void => {
    const host = this.host
    if (!host || this.readOnly) return
    // Track the composition's current text: its LENGTH is the committed caret's
    // offset from `composeStart`, computed rather than read (the DOM is in the
    // composition's provisional shape the whole time).
    if (this.composing && event instanceof InputEvent && event.data !== null) {
      this.composeLength = event.data.length
    }
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
    if (next === this.doc) {
      // Backstop for a commit input that arrives after a same-content
      // `compositionend`: the model has nothing to absorb, but the DOM may still
      // hold the composition's provisional shape — a bare text node inside the
      // line box, not a run. Skipping entirely would leave that shape for the
      // NEXT edit to misread (`.scratch/enter-backspace-smoke/issues/11`), so
      // normalize the DOM and re-anchor the caret by the same computed offset
      // `compositionend` would have used.
      if (this.composed) {
        this.composed = false
        if (this.render()) this.placeCaret(this.composeStart + this.composeLength)
      }
      return
    }
    const delta = next.length - this.doc.length

    // A PURE deletion leaves no inserted text: the browser is free to park the
    // caret anywhere after collapsing the deleted range — deleting a line's only
    // character often lands it at the end of the next line. The honest caret is
    // where the deleted text began, so the caret is decided from the diff instead
    // of the DOM on exactly this path.
    const prefix = sharedPrefix(this.doc, next)
    const insertedEnd = next.length - sharedSuffix(this.doc, next, prefix)
    // A composition's COMMIT decides its caret from the diff too, for the same
    // reason: the DOM the browser left is still the provisional shape, so a DOM
    // read is off by a line or two, and the pinyin↔final delta makes
    // `caret + delta` wrong as well. The end of the committed text is the one
    // honest position (`insertedEnd`).
    const committing = this.composed
    this.composed = false
    const caretNext =
      insertedEnd <= prefix
        ? prefix
        : committing
          ? insertedEnd
          : this.caretFromDom() ?? clamp(this.caret + delta, 0, next.length)

    // An IME composition is mid-flight: the DOM holds provisional text. Record
    // the model (undo snapshots are suppressed) but leave the DOM untouched so
    // the composition is not destroyed under the user.
    //
    // The caret NEVER comes from the DOM here: every recompute reshapes the
    // views while the DOM keeps the provisional form, so the read is fine the
    // FIRST time and off from the second input on — composing `ABC` then `ABCD`
    // flew the caret away (`.scratch/enter-backspace-smoke/issues/11`).
    // `composeStart + composeLength` is always the composed text's end in the
    // model.
    if (!this.composing) {
      this.pushUndo({ value: this.doc, caret: this.caret })
      this.commit(next, caretNext)
      return
    }

    this.doc = next
    this.caret = this.composeStart + this.composeLength
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

      // Enter on the LAST empty quote line LEAVES the quote — and has to leave a
      // blank separator line behind it. Typing straight below the quote would
      // otherwise be read by CommonMark as the quote's lazy continuation (a bare
      // line, no `>`, that still belongs to the block) and the whole quote would
      // slip back into its editing state (`.scratch/blockquote/issues/01`).
      const quoteGap = this.leaveQuoteWithGap(live)
      if (quoteGap) {
        this.commit(quoteGap.doc, quoteGap.caret)
        return
      }

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
      // A plain TEXT line, caret at its very END: Enter is a HARD break — the
      // paragraph ends here and a NEW paragraph starts below it
      // (`enter-backspace-smoke/01`: any-position Enter is a hard break, the
      // one case the /10 revision walked back is restored — at the BLOCK
      // level, a hard break is "a fresh block", not "two more newlines", so
      // the two-Backspaces complaint that motivated /10 no longer applies).
      //
      // Block-tree commands do the work:
      // - caret on the paragraph's LAST line end — `enterEndParagraph` (3c)
      //   opens a fresh blank block below it; at the document's end that blank
      //   serializes to nothing and the caret sits on the virtual blank line;
      // - caret on a line INSIDE a soft-broken paragraph — `enterEndOfLine`
      //   splits the block there (`[A\nB] → [A][blank][B]`, the rest of the
      //   paragraph becomes a new paragraph below the blank).
      // Both land the caret on a fresh blank line; the next keystroke turns
      // that blank into a NEW paragraph (the paragraphizer fences it —
      // `paragraph-spacing/01` 十审), never a soft continuation.
      if (live >= lineEnd) {
        if (currentLine === '') {
          // Blank line: one more blank line — the blank block's span grows by
          // a line (box-model migration 3d), same source as the string path,
          // caret on the newly added line.
          const blankIndex = this.blockAt(live)
          const grownBlank = enterBlankLine(this.doc, blankIndex)
          if (grownBlank !== null) {
            this.pushUndo({ value: this.doc, caret: this.caret })
            this.commit(grownBlank.source, live + grownBlank.caretDelta)
            return
          }
          const at = lineEnd < this.doc.length ? lineEnd + 1 : this.doc.length
          this.insertNewlines(at, 1, live + 1)
          return
        }
        const enterLine = lineOfOffset(this.doc, live)
        const enterKind = this.lineStates[enterLine - 1]?.kind
        if (enterKind === 'text') {
          const ground = this.blockAt(live)
          const myBlock = this.blocks[ground]
          if (myBlock !== undefined) {
            const local = live - this.offsets[ground]
            const inside = myBlock.raw.indexOf('\n', local) >= 0
            if (inside) {
              // Line INSIDE the paragraph: split here — this line ends the
              // paragraph, everything below becomes the new paragraph.
              const split = enterEndOfLine(this.doc, ground, live, local)
              if (split !== null) {
                this.pushUndo({ value: this.doc, caret: this.caret })
                this.commit(split.source, split.caret)
                return
              }
            } else {
              // Paragraph's LAST line end: fresh blank block below (3c).
              const grown = enterEndParagraph(this.doc, ground)
              if (grown !== null) {
                this.pushUndo({ value: this.doc, caret: this.caret })
                this.commit(
                  grown.source,
                  this.offsets[ground] + myBlock.raw.length + grown.caretDelta,
                )
                return
              }
            }
          }
        }
        const at = lineEnd < this.doc.length ? lineEnd + 1 : this.doc.length
        // Caret on the FRESH line. A line that already has its trailing newline
        // starts the fresh one at `at`; a doc-final line without one gains its
        // terminator with the insert, so the fresh line starts one past it.
        // (Non-text lines — headings, prefixed lines, fences — keep the single
        // newline fallback; their Enter semantics are owned elsewhere.)
        this.insertNewlines(at, 1, lineEnd === this.doc.length ? at + 1 : at)
        return
      }
      // Line START: an empty line opens above (unchanged).
      if (live === lineStart) {
        this.insertNewlines(live, 1, live + 1)
        return
      }
      // MID-line: the hard break splits the paragraph here — one blank line
      // between the two halves, caret on the second half's first character.
      // A single-line PARAGRAPH goes through the block-tree command first
      // (box-model migration, `.scratch/block-model/issues/02`): the tree
      // splits the paragraph block into two with a blank block between, and
      // `serializeBlocks` rebuilds the source — byte-identical to the string
      // insert below. Everything else (headings, multi-line soft-broken
      // paragraphs) falls back to the string form until its slice lands.
      const myLine = lineOfOffset(this.doc, live)
      const lineKind = this.lineStates[myLine - 1]?.kind
      if (lineKind === 'text' && !currentLine.includes('\n')) {
        const edited = enterMidParagraph(
          this.doc,
          this.blockAt(live),
          live,
          live - this.offsets[this.blockAt(live)],
        )
        if (edited) {
          this.pushUndo({ value: this.doc, caret: this.caret })
          this.commit(edited.source, edited.caret)
          return
        }
      }
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
      // Inside a TABLE, Tab is cell navigation — and forward from the last cell it
      // appends a row, which is the only keyboard path to a new row at all
      // (`.scratch/table-ops/issues/03`). It has to come first: the list rule
      // declines a table row, so without this branch the key did nothing.
      const cell = moveTableCell(this.doc, live, event.shiftKey ? 'prev' : 'next')
      if (cell) {
        // A move inside the existing rows returns the document UNCHANGED, and a
        // snapshot for it would put a dead entry on the undo stack.
        if (cell.doc !== this.doc) this.pushUndo({ value: this.doc, caret: this.caret })
        this.commit(cell.doc, cell.caret)
        return
      }
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
        // A TABLE's structure is not the caret's to delete. Backspace inside a
        // cell's own text is an ordinary character delete and falls through, but
        // at a cell's content start — and anywhere in the pipes, the padding, or
        // the `| --- |` rule row — it would delete the source the row is made of
        // rather than a row or a column: measured, one Backspace at a cell's left
        // edge joined the row onto the rule line above and the data row was gone
        // (`.scratch/table-ops/issues/01`). A no-op takes no undo snapshot,
        // exactly like the other guarded no-ops, so Cmd+Z never dead-steps.
        if (blocksTableBackspace(this.doc, live)) {
          event.preventDefault()
          return
        }
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
          // A paragraph whose line start joins a paragraph above, ONE blank
          // line between: the block-tree command merges `[A, blank, B]` into
          // `[A\nB]` (box-model migration 3b) — same source as the string
          // path below, with the caret at the old blank block's offset. Any
          // other shape falls back to the string path.
          if (before === '') {
            const bi = this.blockAt(live)
            const joined = backspaceJoinParagraphs(this.doc, bi)
            if (joined !== null) {
              event.preventDefault()
              this.pushUndo({ value: this.doc, caret: this.caret })
              this.commit(joined, this.offsets[bi - 1] ?? 0)
              return
            }
          }
          event.preventDefault()
          this.pushUndo({ value: this.doc, caret: this.caret })
          const drop = joinIndent.length + 1
          const joined = this.doc.slice(0, live - drop) + this.doc.slice(live)
          // The caret lands where the deleted newline stood — the join point — and
          // STAYS there. It keeps the caret glued to the text below, so the join
          // reads as "the line below was pulled up to me"; walking it back to the
          // end of the content above reads as "the caret was thrown up there",
          // and the next keystroke writes into the wrong line.
          //
          // Measured from a real caret (a click / Home at the start of the line
          // below), in `a\n\nb` with the caret before `b`, this used to land one
          // newline short — at the end of `a`, i.e. on the paragraph above — and
          // `backspace-join/01` (`3e91537`) is where that normalisation came from.
          // It was written to make this path agree with the one where the caret
          // sits ON the blank line — but that path deletes the newline ABOVE its
          // caret, so its raw join point is already the end of the previous
          // content and never needed the loop. Removing it costs nothing there
          // (`enter-backspace-smoke/09`) and gives this path the join point the
          // user asks for (`.scratch/backspace-join/issues/04`).
          this.commit(joined, live - drop)
          return
        }
      }
    }

    // Backspace inside a line that carries COLLAPSED source runs: the browser
    // deletes by DOM node, and at a boundary touching one of those hidden runs
    // it takes the whole run with the character (`~~a~~z` lost `z` AND the
    // closing `~~` — `caret-assertions/03`). One source character, deleted by
    // the kernel, is what the key means; the native path stays for lines with
    // nothing hidden in front of the caret, where it behaves.
    if (event.key === 'Backspace' && live !== null && live > 0) {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && sel.isCollapsed && hiddenSourceBeforeCaret(sel)) {
        event.preventDefault()
        const cut = previousGraphemeStart(this.doc, live)
        this.pushUndo({ value: this.doc, caret: this.caret })
        this.commit(this.doc.slice(0, cut) + this.doc.slice(live), cut)
        return
      }
    }
  }

  /**
   * Enter on an EMPTY quote line that is the quote's LAST line: leaves the quote
   * AND guarantees a blank line between it and whatever is typed next. Without
   * the blank, the next line (no `>`) would be the quote's lazy continuation and
   * the whole block would re-enter its editing state with the new text absorbed
   * (`.scratch/blockquote/issues/01`). A quote line with more quote lines below
   * is NOT the tail — leaving a middle item keeps the old semantics (the line
   * becomes blank, no gap inserted), which is what `leavingEmptyItem` does.
   */
  private leaveQuoteWithGap(live: number): { doc: string; caret: number } | null {
    const { start: lineStart, end: lineEnd, text: line } = this.lineBounds(live)
    if (!/^>\s*$/.test(line)) return null
    // The next line decides: a quoted line right below means the quote continues,
    // this is a middle item, not the tail. (The terminator of THIS line is the
    // first character of the rest.)
    if (/^\n?[ \t]*>/.test(this.doc.slice(lineEnd + 1))) return null
    const stripped = this.doc.slice(0, lineStart) + this.doc.slice(lineStart + line.length)
    // `stripped` ends with the blank line just created (its `\n`). One more `\n`
    // makes that blank a real separator line, and the caret lands past it — a
    // fresh line that typing will NOT attach to the quote.
    const doc = stripped.endsWith('\n\n') ? stripped : `${stripped}\n`
    return { doc, caret: doc.length }
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

    // A click on a rendered task item's check box TOGGLES it instead of placing
    // the caret (Typora does the same). It has to be decided before the hit
    // test below: the box is a pseudo-element with no text of its own, so the
    // hit test would drop the caret into the line and reveal the source.
    const flipped = this.checkboxFlipAt(event)
    if (flipped !== null) {
      event.preventDefault()
      this.pushUndo({ value: this.doc, caret: this.caret })
      this.commit(flipped, this.caret)
      return
    }

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
   * The document with a task item's check box flipped, when the click landed on
   * the box's decoration — null for every other click.
   *
   * The box is drawn by CSS (`.vl-task:not(.revealed)::before`), so there is no
   * element to hit-test: the band between the line box's left edge and its first
   * visible text IS the box. That also dates the interaction: only in the
   * RENDERED state — with the source revealed the `[ ]` is editable text, and a
   * click there means "put the caret in it", like every other line.
   */
  private checkboxFlipAt(event: MouseEvent): string | null {
    const target = event.target instanceof Element ? event.target : null
    const lineEl = target?.closest<HTMLElement>('[data-vline]')
    const blockEl = lineEl?.closest<HTMLElement>('[data-block]')
    if (!lineEl || !blockEl) return null
    const blockIndex = Number(blockEl.dataset.block)
    const lineIndex = Number(lineEl.dataset.vline)
    const block = this.blocks[blockIndex]
    const viewLine = this.views[blockIndex]?.lines[lineIndex]
    if (!block || !viewLine) return null
    // Rendered state: the line's prefix (`- [ ] `) is a COLLAPSED marker run.
    // Revealed, it is dim source text and the caret belongs in the line.
    if (!viewLine.runs.some((run) => run.marker)) return null
    if (this.lineStates[block.startLine + lineIndex]?.checked == null) return null

    const textLeft = this.firstVisibleTextLeft(lineEl, viewLine)
    if (textLeft === null) return null
    const rect = lineEl.getBoundingClientRect()
    if (event.clientY < rect.top || event.clientY > rect.bottom) return null
    if (event.clientX >= textLeft) return null

    return flipTaskCheckboxAt(this.doc, this.offsets[blockIndex] + viewLine.sourceStart)
  }

  /** Left edge of a line's first run that draws text, or null when it has none. */
  private firstVisibleTextLeft(
    lineEl: HTMLElement,
    viewLine: BlockView['lines'][number],
  ): number | null {
    const first = viewLine.runs.findIndex((run) => !run.marker && run.text.length > 0)
    if (first < 0) return null
    const runEl = lineEl.querySelector<HTMLElement>(`[data-run="${first}"]`)
    if (!runEl) return null
    const range = document.createRange()
    range.selectNodeContents(runEl)
    const rect = range.getBoundingClientRect()
    return rect.width > 0 ? rect.left : null
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
