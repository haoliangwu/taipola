import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { buildBlockView, type BlockView, type ViewRun } from '../lib/view'
import { computeLineStates } from '../lib/inline'
import { parseDocument } from '../lib/markdown'
import type { EditBuffers } from '../lib/editCommands'

export interface EditorHandle {
  /** Moves the caret to the given 1-based source line and scrolls it into view. */
  goToLine: (line: number) => void
  focus: () => void
  /** Applies a source-level edit at the current selection. */
  applyEdit: (mutate: (buffer: EditBuffers) => void) => void
  /** Replaces the whole document (opening a file, creating a new one). */
  setDocument: (text: string) => void
}

interface EditorProps {
  value: string
  onChange: (value: string) => void
  onCaretLineChange?: (line: number) => void
  readOnly?: boolean
}

const UNDO_LIMIT = 300

interface Snapshot {
  value: string
  caret: number
}

/**
 * Instant-rendering markdown editor.
 *
 * The model is plain Markdown **source**; the screen shows a *view* of it where
 * syntax markers still exist as DOM text but collapse to zero width once their
 * construct is closed and the caret has left it. `**bold**` therefore occupies
 * six source characters and only two laid-out ones.
 *
 * Keeping markers in the DOM — rather than re-synthesising the text — is what
 * makes three things true at once: the browser always sees a full, stable
 * character sequence (so wrapping, column layout and arrow-key movement behave
 * natively), hidden constructs contribute no width, and the caret can always be
 * mapped between source and screen.
 *
 * Caret state is a **source offset**. Its screen position is derived through the
 * view, and a caret that lands "inside" a collapsed marker is drawn at the
 * nearest visible cell so it never disappears into a zero-width box.
 */
export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { value, onChange, onCaretLineChange, readOnly = false },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null)

  const [doc, setDoc] = useState(value)
  const [caret, setCaret] = useState(0)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  /** Source offset to re-apply to the DOM after the next render. */
  const pending = useRef<number | null>(null)
  const composing = useRef(false)
  const undoStack = useRef<Snapshot[]>([])
  const redoStack = useRef<Snapshot[]>([])
  const lastSnapshot = useRef<Snapshot | null>(null)

  const parsed = useMemo(() => parseDocument(doc), [doc])
  const blocks = parsed.blocks
  const lines = useMemo(() => doc.split('\n'), [doc])
  const lineStates = useMemo(() => computeLineStates(lines), [lines])
  const offsets = parsed.offsets

  // Views are rebuilt when the source changes or the caret moves, because the
  // caret decides which constructs keep their markers visible.
  const views = useMemo<BlockView[]>(
    () =>
      blocks.map((block) => {
        const start = offsets[block.index]
        const end = start + block.raw.length
        const revealed = caret >= start && caret <= end ? [caret] : []
        return buildBlockView(block.raw, start, revealed)
      }),
    [blocks, caret, offsets],
  )

  const lineToBlock = useCallback(
    (line: number): number => {
      let low = 0
      let high = blocks.length - 1
      while (low < high) {
        const mid = (low + high + 1) >> 1
        if (blocks[mid].startLine <= line) low = mid
        else high = mid - 1
      }
      return low
    },
    [blocks],
  )

  const commit = useCallback(
    (next: string, caretNext: number) => {
      pending.current = caretNext
      placedByUs.current = true
      setDoc(next)
      onChange(next)
      setCaret(caretNext)
      const line = lineOfOffset(next, caretNext)
      setActiveIndex(lineToBlock(line - 1))
      onCaretLineChange?.(line)
    },
    [lineToBlock, onChange, onCaretLineChange],
  )

  const pushUndo = useCallback((snapshot: Snapshot) => {
    // Skip only when this exact state was already the last pushed snapshot.
    // A seeded placeholder value would silently eat the first edit's pre-state
    // and make that edit impossible to undo.
    if (lastSnapshot.current !== null && lastSnapshot.current.value === snapshot.value) return
    undoStack.current.push(snapshot)
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
    redoStack.current = []
    lastSnapshot.current = snapshot
  }, [])

  // --- caret placement -------------------------------------------------------
  /**
   * True while the DOM selection is one WE placed.
   *
   * Re-rendering the view replaces text nodes, and the browser then clamps and
   * re-reports the selection. Measuring that report would overwrite the offset we
   * deliberately placed with one derived from a half-updated DOM — the cause of
   * the caret drifting to the start of the line. So a report is only trusted once
   * a real user gesture has happened since our last placement.
   */
  const placedByUs = useRef(false)
  /**
   * Set by `beforeinput`, cleared by `input`.
   *
   * Only a user edit fires `beforeinput`. A re-render that rewrites the visible
   * text also fires `input`, and reconstructing the Markdown source from that
   * DOM would drop every collapsed marker it no longer contains — observed as
   * characters silently disappearing from the document.
   */
  const userEditPending = useRef(false)

  const placeCaret = useCallback(() => {
    const want = pending.current
    if (want === null || activeIndex === null) return
    const host = rootRef.current?.querySelector<HTMLElement>(`[data-block="${activeIndex}"]`)
    const view = views[activeIndex]
    const block = blocks[activeIndex]
    if (!host || !view || !block) return
    pending.current = null

    const target = anchorForSource(view, offsets[activeIndex], want)
    if (!target) return
    const lineEl = host.querySelector<HTMLElement>(`[data-vline="${target.lineIndex}"]`)
    if (!lineEl) return
    const span = lineEl.querySelectorAll<HTMLElement>('[data-run]')[target.runIndex]
    if (!span) return

    // Focus the EDITABLE ROOT, not the block div: only the root carries
    // `contentEditable`, so keyboard input lands in the editor at all. With the
    // block focused (a plain div), typing went nowhere — the caret looked right
    // but `activeElement` stayed BODY.
    rootRef.current?.focus({ preventScroll: true })
    const node = span.firstChild
    const range = document.createRange()
    if (node && node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, Math.max(0, Math.min(target.offsetInRun, node.textContent?.length ?? 0)))
    } else {
      range.selectNodeContents(span)
    }
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    placedByUs.current = true
  }, [activeIndex, blocks, offsets, views])

  useLayoutEffect(() => {
    if (pending.current !== null) placeCaret()
  })

  /** Source offset of the current DOM selection, or null when outside. */
  const readCaret = useCallback((): number | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const host = (range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
    )?.closest?.<HTMLElement>('[data-block]')
    if (!host) return null
    const index = Number(host.dataset.block)
    const view = views[index]
    const block = blocks[index]
    if (!view || !block) return null
    const local = domToLocal(view, range.startContainer, range.startOffset)
    if (local === null) return null
    return offsets[index] + local
  }, [blocks, offsets, views])

  useEffect(() => {
    const handler = () => {
      // Only a user gesture may move the caret. A report produced by our own
      // re-render is ignored, otherwise the measurement feeds back into the state
      // and the caret walks backwards by the length of every revealed marker.
      if (placedByUs.current) return
      const source = readCaret()
      if (source === null) return
      const host = (window.getSelection()?.getRangeAt(0).startContainer instanceof Element
        ? (window.getSelection()!.getRangeAt(0).startContainer as Element)
        : window.getSelection()!.getRangeAt(0).startContainer.parentElement
      )?.closest?.<HTMLElement>('[data-block]')
      if (host) setActiveIndex(Number(host.dataset.block))
      setCaret(source)
      onCaretLineChange?.(lineOfOffset(doc, source))
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [doc, onCaretLineChange, readCaret])

  // --- input -----------------------------------------------------------------
  const onInput = useCallback(() => {
    // Ignore DOM mutations we caused ourselves (re-render, programmatic caret).
    // Rebuilding the source from such a DOM would delete the collapsed markers it
    // is not currently showing.
    if (!userEditPending.current) return
    userEditPending.current = false
    if (activeIndex === null) return
    const host = rootRef.current?.querySelector<HTMLElement>(`[data-block="${activeIndex}"]`)
    const block = blocks[activeIndex]
    if (!host || !block) return

    const nextRaw = readBlockSource(host)
    if (nextRaw === block.raw) return
    if (!composing.current) pushUndo({ value: doc, caret })

    const next =
      doc.slice(0, offsets[activeIndex]) + nextRaw + doc.slice(offsets[activeIndex] + block.raw.length)
    // The edit landed at the caret we already hold, so the new caret follows the
    // change in length. Reading it back from the DOM would measure a view that is
    // still switching between its collapsed and revealed forms.
    const delta = nextRaw.length - block.raw.length
    const caretNext = Math.max(offsets[activeIndex], caret + delta)
    pending.current = caretNext
    placedByUs.current = true
    setDoc(next)
    onChange(next)
    setCaret(caretNext)
    onCaretLineChange?.(lineOfOffset(next, caretNext))
  }, [activeIndex, blocks, caret, doc, offsets, onChange, onCaretLineChange, pushUndo])

  const undo = useCallback(
    (redo: boolean) => {
      const from = redo ? redoStack : undoStack
      const to = redo ? undoStack : redoStack
      const snapshot = from.current.pop()
      if (!snapshot) return
      to.current.push({ value: doc, caret })
      lastSnapshot.current = snapshot
      pending.current = snapshot.caret
      setDoc(snapshot.value)
      onChange(snapshot.value)
      setCaret(snapshot.caret)
      const line = lineOfOffset(snapshot.value, snapshot.caret)
      setActiveIndex(lineToBlock(line - 1))
      onCaretLineChange?.(line)
    },
    [caret, doc, lineToBlock, onChange, onCaretLineChange],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo(event.shiftKey)
        return
      }
      if (mod || composing.current || activeIndex === null) return
      const block = blocks[activeIndex]
      if (!block) return

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        const lineStart = doc.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
        const lineEndRaw = doc.indexOf('\n', caret)
        const lineEnd = lineEndRaw === -1 ? doc.length : lineEndRaw
        const currentLine = doc.slice(lineStart, lineEnd)
        const prefix = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|>\s*)/.exec(currentLine)?.[0] ?? ''
        const body = currentLine.slice(prefix.length)
        pushUndo({ value: doc, caret })
        if (prefix !== '' && body.trim() === '' && caret >= lineEnd) {
          commit(doc.slice(0, lineStart) + doc.slice(lineEnd), lineStart)
          return
        }
        const nextPrefix = /^\s*\d+[.)]/.test(prefix)
          ? prefix.replace(/(\d+)([.)])/, (_m, n: string, d: string) => `${Number(n) + 1}${d}`)
          : prefix
        const insert = `\n${nextPrefix}`
        commit(doc.slice(0, caret) + insert + doc.slice(caret), caret + insert.length)
        return
      }

      if (event.key === 'Backspace' && caret === offsets[activeIndex] && activeIndex > 0) {
        const prevEnd = offsets[activeIndex - 1] + blocks[activeIndex - 1].raw.length
        const separator = doc[prevEnd] === '\n' ? 1 : 0
        event.preventDefault()
        pushUndo({ value: doc, caret })
        commit(doc.slice(0, prevEnd) + doc.slice(prevEnd + separator), prevEnd)
      }
    },
    [activeIndex, blocks, caret, commit, doc, offsets, pushUndo, undo],
  )

  // --- imperative API --------------------------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        rootRef.current?.focus({ preventScroll: true })
      },
      goToLine: (line: number) => {
        const offset = offsetForLine(doc, line)
        const index = lineToBlock(line - 1)
        pending.current = offset
        setCaret(offset)
        setActiveIndex(index)
        onCaretLineChange?.(line)
        window.requestAnimationFrame(() => {
          placeCaret()
          rootRef.current?.querySelector<HTMLElement>(`[data-block="${index}"]`)?.scrollIntoView({ block: 'center' })
        })
      },
      applyEdit: (mutate) => {
        if (activeIndex === null) return
        const block = blocks[activeIndex]
        const view = views[activeIndex]
        if (!block || !view) return
        const buffer: EditBuffers = { value: block.raw, start: 0, end: 0 }
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0)
          const start = domToLocal(view, range.startContainer, range.startOffset)
          buffer.start = start ?? 0
          if (range.collapsed) buffer.end = buffer.start
          else {
            const endRange = sel.getRangeAt(sel.rangeCount - 1)
            buffer.end = domToLocal(view, endRange.endContainer, endRange.endOffset) ?? buffer.start
          }
        }
        mutate(buffer)
        if (buffer.value === block.raw) return
        pushUndo({ value: doc, caret })
        const next = doc.slice(0, offsets[activeIndex]) + buffer.value + doc.slice(offsets[activeIndex] + block.raw.length)
        commit(next, offsets[activeIndex] + buffer.start)
      },
      setDocument: (text) => {
        undoStack.current = []
        redoStack.current = []
        lastSnapshot.current = null
        pending.current = null
        setActiveIndex(null)
        setDoc(text)
        setCaret(0)
        onCaretLineChange?.(1)
        onChange(text)
      },
    }),
    [
      activeIndex, blocks, caret, commit, doc, lineToBlock, offsets, onChange,
      onCaretLineChange, placeCaret, pushUndo, views,
    ],
  )

  // --- render ----------------------------------------------------------------
  return (
    <div
      className="doc"
      ref={rootRef}
      onMouseDownCapture={(event) => {
        // A click decides the caret itself. Letting the browser place it instead
        // loses the click's position entirely, because the block re-renders from
        // source the moment it becomes active.
        placedByUs.current = false
        if (readOnly) return
        const hit = sourceOffsetAtPoint(event.clientX, event.clientY, event.target as Element | null)
        if (hit === null) return
        event.preventDefault()
        // The hit test works in block-local coordinates (that is what `data-src`
        // and the view both use); the caret model works in document coordinates.
        // Convert once, here, and nowhere else.
        const target = offsets[hit.block] + hit.local
        pending.current = target
        placedByUs.current = true
        setActiveIndex(hit.block)
        setCaret(target)
        onCaretLineChange?.(lineOfOffset(doc, target))
      }}
      onKeyDownCapture={() => {
        placedByUs.current = false
      }}
      onBeforeInput={() => {
        placedByUs.current = false
        userEditPending.current = true
      }}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={() => {
        composing.current = false
      }}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Markdown 编辑器"
      spellCheck={false}
    >
      {blocks.map((block, index) => {
        const view = views[index]
        const firstState = lineStates[block.startLine]
        return (
          <div
            key={`${index}:${block.startLine}`}
            data-block={index}
            data-src-start={offsets[index]}
            className={`blk${activeIndex === index ? ' blk-active' : ''}`}
            data-kind={firstState?.kind ?? 'text'}
          >
            {view.lines.map((line, li) => {
              const state = lineStates[block.startLine + li]
              const renderRun = (run: ViewRun, ri: number) => (
                <span
                  key={ri}
                  data-run={ri}
                  data-src={run.src}
                  className={runClass(run, state)}
                  title={run.mark.link && !run.marker ? run.mark.link : undefined}
                >
                  {run.text}
                </span>
              )
              return (
                <div key={li} data-vline={li} className={lineClass(state)}>
                  {line.runs.length === 0 ? (
                    <br />
                  ) : line.cellRuns ? (
                    // A table row is a grid of CELLS, not of runs: one cell per
                    // grid item, so revealed inline markers inside a cell stay
                    // inside its column instead of each becoming a column.
                    line.cellRuns.map((cell, ci) => (
                      <span key={ci} className="cell" data-cell={ci}>
                        {cell.length === 0 ? <br /> : cell.map((ri) => renderRun(line.runs[ri], ri))}
                      </span>
                    ))
                  ) : (
                    line.runs.map((run, ri) => renderRun(run, ri))
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
})

function lineClass(state: ReturnType<typeof computeLineStates>[number] | undefined): string {
  if (!state) return 'vl'
  return `vl vl-${state.kind}`
}

function runClass(
  run: ViewRun,
  state: ReturnType<typeof computeLineStates>[number] | undefined,
): string {
  const cls = ['rn']
  if (run.marker) cls.push('rn-marker')
  // A revealed block-level marker (heading `#`, list bullet, quote marker,
  // fence line) takes up space but reads as syntax: dim it.
  if (run.dim) cls.push('rn-dim')
  if (run.mark.bold) cls.push('rn-bold')
  if (run.mark.italic) cls.push('rn-italic')
  if (run.mark.strike) cls.push('rn-strike')
  if (run.mark.code) cls.push('rn-code')
  if (run.mark.link !== undefined) cls.push('rn-link')
  if (state?.kind === 'code' && !run.marker) cls.push('rn-codeblock')
  return cls.join(' ')
}

/**
 * Where to draw a caret whose source offset is `source`.
 *
 * Walks the view tracking a **visible cursor** — the number of laid-out cells
 * seen so far — and stops at the first cell whose source range reaches the
 * target. Comparing visible-cursor positions rather than looking each offset up
 * in `sourceToVisible` is what makes this correct across collapsed markers: a
 * hidden character has no visible index of its own (`sourceToVisible` is -1), and
 * an index-based lookup therefore snapped the caret to the start of the line.
 *
 * A caret whose offset lands inside a collapsed marker is drawn on the nearest
 * visible cell, so it never disappears into a zero-width box.
 */
function anchorForSource(
  view: BlockView,
  blockStart: number,
  source: number,
): { lineIndex: number; runIndex: number; offsetInRun: number } | null {
  const local = source - blockStart

  for (let li = 0; li < view.lines.length; li++) {
    const line = view.lines[li]
    // `lineEnd` is the offset just past this line's last character. A target
    // EQUAL to it belongs to the NEXT line — that is where the newline sits — so
    // the comparison must be `>=`. With `>` the caret fell into the previous
    // line, which for a code block meant the collapsed fence line (visible
    // length 0) swallowed every click on the first code line below it.
    const lineEnd = line.sourceStart + line.sourceToVisible.length
    const isLast = li === view.lines.length - 1
    if (local >= lineEnd && !isLast) continue

    const target = Math.max(line.sourceStart, Math.min(local, lineEnd))

    let cursor = 0
    for (const run of line.runs) {
      const runEnd = run.src + run.text.length

      if (run.marker) {
        // Hidden marker: contributes no visible cells. If the target sits inside
        // it, anchor on the cell just before it — i.e. keep the cursor where it
        // already is rather than jumping to the marker's start.
        if (target >= run.src && target <= runEnd) {
          return runIndexAtCursor(line, cursor, li)
        }
        continue
      }

      if (target >= run.src && target <= runEnd) {
        const within = target - run.src
        const runIndex = line.runs.indexOf(run)
        return { lineIndex: li, runIndex, offsetInRun: Math.max(0, Math.min(within, run.text.length)) }
      }
      cursor += run.text.length
    }

    // Past the end of the line's visible text.
    return runIndexAtCursor(line, cursor, li)
  }
  return null
}

/** The run holding visible cell `cursor`, with the caret at its end. */
function runIndexAtCursor(
  line: BlockView['lines'][number],
  cursor: number,
  lineIndex: number,
): { lineIndex: number; runIndex: number; offsetInRun: number } {
  let seen = 0
  for (let ri = 0; ri < line.runs.length; ri++) {
    const run = line.runs[ri]
    if (run.marker) continue
    if (cursor <= seen + run.text.length) {
      return { lineIndex, runIndex: ri, offsetInRun: Math.max(0, cursor - seen) }
    }
    seen += run.text.length
  }
  const last = line.runs.map((r, i) => (r.marker ? -1 : i)).filter((i) => i >= 0).pop() ?? 0
  return { lineIndex, runIndex: last, offsetInRun: line.runs[last]?.text.length ?? 0 }
}

/**
 * Block-local source offset for a DOM position.
 *
 * Derived from the DOM itself: every run span carries `data-src`, the source
 * offset of its first character, and a collapsed marker has no width so it is
 * skipped entirely. Reading the structure directly — rather than mapping through
 * a `ViewLine` — keeps this correct even when the view is mid-update, since the
 * spans present in the DOM are the ones that produced the caret's position.
 */
function domToLocal(view: BlockView, node: Node, offset: number): number | null {
  const element = node instanceof Element ? node : node.parentElement
  const lineEl = element?.closest?.<HTMLElement>('[data-vline]')
  if (!lineEl) return null
  const lineIndex = Number(lineEl.dataset.vline)
  const line = view.lines[lineIndex]
  if (!line) return null

  // Baseline: source offset where this line starts.
  let base = 0
  for (let i = 0; i < lineIndex; i++) base += view.lines[i].sourceToVisible.length + 1

  const runs = [...lineEl.querySelectorAll<HTMLElement>('[data-run]')]
  const srcOf = (el: HTMLElement): number | null => {
    const raw = el.dataset.src
    return raw === undefined ? null : Number(raw)
  }

  // Find the run that holds the caret.
  for (const el of runs) {
    const width = getComputedStyle(el).display === 'none' ? 0 : (el.textContent?.length ?? 0)
    const holds = el === node || el.contains(node)

    if (holds) {
      const within = node.nodeType === Node.TEXT_NODE ? offset : 0
      const src = srcOf(el)
      if (src === null) break
      if (width === 0) {
        // The caret is anchored inside a collapsed marker: snap to its start.
        return src
      }
      // Only laid-out characters inside this run count towards the offset.
      return src + Math.min(within, el.textContent?.length ?? 0)
    }
    void width
  }

  // Caret anchored on the line element itself (empty line, or past the end).
  const last = runs[runs.length - 1]
  if (last) {
    const src = srcOf(last)
    if (src !== null) return src + (last.textContent?.length ?? 0)
  }
  return base
}

/**
 * Source offset under a point, resolved from the DOM the browser hit.
 *
 * Two things this must get right, both of which silently produced a no-op click:
 *
 * 1. `data-src` on a run is **block-relative**, so the block's own start offset
 *    has to be added — otherwise the value points into the wrong block entirely.
 * 2. Coordinate hit-testing cannot be the only path: `elementFromPoint` returns
 *    the block box beside a short line, and `caretRangeFromPoint` returns null
 *    there. The element handed to us by the event is used as the primary source,
 *    with a point-based fallback.
 */
function sourceOffsetAtPoint(
  clientX: number,
  clientY: number,
  fallback: Element | null,
): { block: number; local: number } | null {
  const host = (fallback ?? document.elementFromPoint(clientX, clientY))
    ?.closest?.<HTMLElement>('[data-block]')
  if (!host) return null
  const block = Number(host.dataset.block)

  const lineFrom = (node: Node | null): HTMLElement | null =>
    (node instanceof Element ? node : node?.parentElement)?.closest?.<HTMLElement>('[data-vline]') ?? null

  // Preferred: ask the browser where the point falls in the text.
  const probe = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let lineEl: HTMLElement | null = null
  let node: Node | null = null
  let offset = 0

  const pos = probe.caretPositionFromPoint?.(clientX, clientY)
  if (pos && host.contains(pos.offsetNode)) {
    lineEl = lineFrom(pos.offsetNode)
    node = pos.offsetNode
    offset = pos.offset
  } else {
    const range = probe.caretRangeFromPoint?.(clientX, clientY)
    if (range && host.contains(range.startContainer)) {
      lineEl = lineFrom(range.startContainer)
      node = range.startContainer
      offset = range.startOffset
    }
  }

  if (!lineEl) lineEl = lineFrom(fallback)
  if (!lineEl) return null

  const runs = [...lineEl.querySelectorAll<HTMLElement>('[data-run]')]

  if (node) {
    for (const el of runs) {
      if (el === node || el.contains(node)) {
        const src = Number(el.dataset.src)
        if (Number.isNaN(src)) break
        // A collapsed marker has no width; snap to its start.
        if (getComputedStyle(el).display === 'none') return { block, local: src }
        const within = node.nodeType === Node.TEXT_NODE ? offset : 0
        return { block, local: src + Math.min(within, el.textContent?.length ?? 0) }
      }
    }
  }

  // Fallback: measure horizontally against the line's runs.
  const laidOut = runs.filter((el) => getComputedStyle(el).display !== 'none')
  for (const el of laidOut) {
    const rect = el.getBoundingClientRect()
    if (clientY < rect.top || clientY > rect.bottom) continue
    if (clientX < rect.left) return { block, local: Number(el.dataset.src) }
    if (clientX <= rect.right) {
      return { block, local: Number(el.dataset.src) + glyphOffsetAtX(el, clientX) }
    }
  }
  const last = laidOut[laidOut.length - 1]
  if (last) {
    return { block, local: Number(last.dataset.src) + (last.textContent?.length ?? 0) }
  }
  return { block, local: 0 }
}

/** Character index within an element's text nearest to a viewport x. */
function glyphOffsetAtX(el: HTMLElement, clientX: number): number {
  const node = el.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) return 0
  const text = node.textContent ?? ''
  if (text === '') return 0
  const range = document.createRange()
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = (low + high) >> 1
    range.setStart(node, mid)
    range.setEnd(node, Math.min(mid + 1, text.length))
    const rect = range.getBoundingClientRect()
    if (rect.left + rect.width / 2 < clientX) low = mid + 1
    else high = mid
  }
  return low
}

/** Rebuilds a block's Markdown source from its rendered DOM. */
function readBlockSource(host: HTMLElement): string {
  const out: string[] = []
  host.querySelectorAll<HTMLElement>('[data-vline]').forEach((lineEl) => {
    let text = ''
    lineEl.querySelectorAll<HTMLElement>('[data-run]').forEach((span) => {
      text += span.textContent ?? ''
    })
    out.push(text)
  })
  return out.join('\n')
}

/** Character offset of the start of a 1-based line. */
export function offsetForLine(text: string, line: number): number {
  if (line <= 1) return 0
  let seen = 1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      seen++
      if (seen === line) return i + 1
    }
  }
  return text.length
}

/** 1-based line number containing a character offset. */
export function lineOfOffset(text: string, offset: number): number {
  let line = 1
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) if (text[i] === '\n') line++
  return line
}
