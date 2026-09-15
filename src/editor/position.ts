/**
 * Position mapping: source offset <-> DOM position.
 *
 * The other half of the DOM layer (`render.ts`) builds the tree; this module
 * answers "where is source offset N on screen" and "which source offset is under
 * this point / this DOM range". The kernel (`kernel.ts`) makes the caret a
 * source offset precisely because everything here can derive the screen position
 * from it, markers included.
 *
 * This is where the hardest bugs have lived — line-boundary ownership, the
 * direction to snap a caret that lands inside a collapsed marker, and where a
 * caret on an empty line belongs. The rules are asserted directly against
 * `anchorForSource` / `applyCaret` / `domToLocal` in `position.test.ts`, so a
 * rule change fails its own test instead of only a whole-editor smoke test.
 *
 * It reads the DOM contract documented in `render.ts`; it renders nothing.
 */
import type { BlockView } from '../core/view'

/**
 * The `[data-cell]` a node sits in, or null — table rows only.
 *
 * A cell's box is a caret position in its own right (`data-cell-src`, its content
 * start), which is what makes a cell with no runs editable at all: an empty cell
 * renders no run to read an offset from, and falling through to the line-start
 * fallback put the caret before the row's first pipe, where typing stops the line
 * being a row.
 */
function cellAround(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement
  return el?.closest?.<HTMLElement>('[data-cell]') ?? null
}

/** A cell's content-start source offset (block-local), or null when unset. */
function cellSource(cell: HTMLElement | null): number | null {
  const raw = cell?.dataset.cellSrc
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isNaN(value) ? null : value
}

/** True when a cell holds no laid-out run — the case `data-cell-src` exists for. */
function cellIsEmpty(cell: HTMLElement): boolean {
  return cell.querySelector('[data-run]') === null
}

/**
 * The cell a run-less table row should take the caret in.
 *
 * The last cell whose content starts at or before `local`, so a caret anywhere
 * inside a cell's box lands in that cell and a caret before the first cell's
 * content lands in the first cell rather than nowhere.
 */
function cellIndexForSource(cellSrcs: number[], local: number): number {
  let best = 0
  for (let i = 0; i < cellSrcs.length; i++) if (cellSrcs[i] <= local) best = i
  return best
}

/**
 * Where a source offset lands on screen: which line box holds it, which run
 * inside that box, and how far into the run's text.
 *
 * The three travel together through every mapping rule here, and a caret is only
 * meaningful as all three at once — a run index without its line means nothing.
 */
export interface CaretAnchor {
  lineIndex: number
  runIndex: number
  offsetInRun: number
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
export function anchorForSource(
  view: BlockView,
  blockStart: number,
  source: number,
): CaretAnchor | null {
  const local = source - blockStart

  // Which line holds the caret: the LAST line whose start is at or before it.
  //
  // The tie at an exact boundary is decided by the source layout itself, which
  // is why this is not a comparison against a line's end:
  //   - blank block, lines at src 0/1/2 — a caret at local 1 is the START of the
  //     second blank line, because that line starts at 1.
  //   - list block, the `- ` line at src 6 with length 2 — a caret at local 8 is
  //     the END of `- `, because no line starts at 8; the next one starts at 9.
  // Getting this backwards is visible: the caret lands one line off, so the next
  // keystroke inserts in the wrong place (typing came out reversed, `二行第`, or
  // a second Enter wrote `- - 第二项` into the following list item).
  let lineIndex = 0
  for (let i = 1; i < view.lines.length; i++) {
    if (view.lines[i].sourceStart <= local) lineIndex = i
    else break
  }
  const line = view.lines[lineIndex]
  const lineEnd = line.sourceStart + line.sourceToVisible.length
  const target = Math.max(line.sourceStart, Math.min(local, lineEnd))

  let cursor = 0
  for (const run of line.runs) {
    const runEnd = run.src + run.text.length

    if (run.marker) {
      // Hidden marker: contributes no visible cells. If the target sits inside
      // it, anchor on the cell just before it — i.e. keep the cursor where it
      // already is rather than jumping to the marker's start.
      if (target >= run.src && target <= runEnd) {
        return runIndexAtCursor(line, cursor, lineIndex)
      }
      continue
    }

    if (target >= run.src && target <= runEnd) {
      // A target at a marker's very END belongs to the content that follows: the
      // revealed `# ` of a heading ends at offset 2, and a caret at source offset
      // 2 must anchor at the start of `标题`, not inside the `# ` run — otherwise
      // the next keystroke is inserted into the marker and the marker text
      // mutates into `# X`.
      if (target === runEnd && run.dim) {
        const next = line.runs.slice(line.runs.indexOf(run) + 1).find((c) => !c.marker)
        if (next) {
          return { lineIndex, runIndex: line.runs.indexOf(next), offsetInRun: 0 }
        }
      }
      const within = target - run.src
      const runIndex = line.runs.indexOf(run)
      return { lineIndex, runIndex, offsetInRun: Math.max(0, Math.min(within, run.text.length)) }
    }
    cursor += run.text.length
  }

  // Past the end of the line's visible text.
  return runIndexAtCursor(line, cursor, lineIndex)
}

/**
 * The run holding visible cell `cursor`, with the caret at its end.
 *
 * `runIndex: -1` means "this line has no laid-out run at all" — an empty line, or
 * one whose runs all collapse (a whitespace-only line, a fence line while it is
 * closed). There is no cell to put a caret in, so the DOM layer anchors on the
 * line BOX instead; saying so here keeps that rule in one place rather than
 * having every caller re-discover it (`applyCaret`).
 */
function runIndexAtCursor(
  line: BlockView['lines'][number],
  cursor: number,
  lineIndex: number,
): CaretAnchor {
  let seen = 0
  for (let ri = 0; ri < line.runs.length; ri++) {
    const run = line.runs[ri]
    if (run.marker) continue
    if (cursor <= seen + run.text.length) {
      return { lineIndex, runIndex: ri, offsetInRun: Math.max(0, cursor - seen) }
    }
    seen += run.text.length
  }
  const last = line.runs.map((r, i) => (r.marker ? -1 : i)).filter((i) => i >= 0).pop() ?? -1
  return { lineIndex, runIndex: last, offsetInRun: line.runs[last]?.text.length ?? 0 }
}

/**
 * Draws the caret for source offset `want` inside block `view`.
 *
 * Focuses the EDITABLE ROOT, not the block div: only the root carries
 * `contentEditable`, so keyboard input lands in the editor at all. With the
 * block focused (a plain div), typing went nowhere — the caret looked right but
 * `activeElement` stayed BODY.
 *
 * Returns false when the block has no rendered line to anchor on.
 */
export function applyCaret(
  host: HTMLElement,
  blockIndex: number,
  view: BlockView,
  blockStart: number,
  want: number,
): boolean {
  const target = anchorForSource(view, blockStart, want)
  if (!target) return false
  const lineEl = host.querySelector<HTMLElement>(
    `[data-block="${blockIndex}"] [data-vline="${target.lineIndex}"]`,
  )
  if (!lineEl) return false
  // `runIndex: -1` means "this line has no laid-out run", so there is no span to
  // put a caret in and the line box takes it (the `else` branch below). A Range
  // inside a COLLAPSED run would be clamped back by the browser instead.
  const spans = lineEl.querySelectorAll<HTMLElement>('[data-run]')
  const span = target.runIndex < 0 ? null : spans[target.runIndex]

  host.focus({ preventScroll: true })
  const range = document.createRange()
  if (span) {
    const node = span.firstChild
    if (node && node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, Math.max(0, Math.min(target.offsetInRun, node.textContent?.length ?? 0)))
    } else {
      range.selectNodeContents(span)
    }
  } else if (lineEl.querySelector(':scope > [data-cell]')) {
    // A table row whose target cell holds no runs: the cell's own BOX is the
    // caret position (see `ViewLine.cellSrcs`). Anchoring on the row element
    // instead lets the browser resolve the caret against the nearest text it can
    // find — the header row above — and the read-back then drags both the caret
    // and the next typed character out of the row, which stops the line being a
    // row at all.
    const line = view.lines[target.lineIndex]
    const cellEls = lineEl.querySelectorAll<HTMLElement>(':scope > [data-cell]')
    const index = cellIndexForSource(line?.cellSrcs ?? [], want - blockStart)
    range.setStart(cellEls[Math.min(index, cellEls.length - 1)], 0)
  } else {
    // An EMPTY or fully collapsed line (a blank block, a whitespace-only line, the
    // blank line left by exiting an empty list item) has no run span that can hold
    // a caret. Aborting here left the DOM selection clamped on the previous line by
    // the browser, and the read-back dragged the document caret back with it: the
    // "blank line disappears" bug. Anchor on the line element itself instead.
    range.setStart(lineEl, 0)
  }
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  return true
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
export function domToLocal(view: BlockView, node: Node, offset: number): number | null {
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
  const inside = offsetInsideRuns(runs, node, offset)
  if (inside !== null) return inside

  // A table cell: `data-cell-src` is the cell's content start, and the browser
  // types straight into the cell box when there is no run to type into — so the
  // caret can be anchored on the cell, on a direct text node inside it, or on the
  // line box itself. Counting from the cell's own origin keeps every one of those
  // inside the cell; the line-start fallback below would put them before the
  // row's first pipe, which stops the line being a row.
  const cell = cellAround(node)
  const cellSrc = cellSource(cell)
  if (cell !== null && cellSrc !== null) {
    let seen = 0
    for (const child of Array.from(cell.childNodes)) {
      if (child === node) return cellSrc + seen + offset
      if (child.nodeType === Node.TEXT_NODE) seen += child.textContent?.length ?? 0
      else if (child instanceof HTMLElement && child.hasAttribute('data-run')) {
        seen += child.textContent?.length ?? 0
      }
    }
    return cellSrc
  }

  // The caret sits in a DIRECT text node of the line box. That is what typing
  // into an empty line produces: the line renders no run span of its own, so the
  // browser inserts the characters straight into the box. Counting them is
  // mandatory — returning the line's start instead put the model caret back
  // before the character just typed, so the next keystroke landed in front of it
  // and input came out reversed (`二行第`).
  if (node.nodeType === Node.TEXT_NODE) {
    let seen = 0
    for (const child of Array.from(lineEl.childNodes)) {
      if (child === node) return base + seen + offset
      if (child.nodeType === Node.TEXT_NODE) {
        seen += child.textContent?.length ?? 0
      } else if (child instanceof HTMLElement && child.hasAttribute('data-run')) {
        seen += child.textContent?.length ?? 0
      }
    }
  }

  // Caret anchored on the line element itself (empty line, or past the end).
  //
  // With no LAID-OUT run the box has exactly one position — its start. That is an
  // empty line, and it is also a line whose runs all collapse (a whitespace-only
  // line): reading the end of a collapsed run there put the caret AFTER its
  // invisible spaces, where the next Backspace ate a space instead of the newline
  // (`.scratch/whitespace-round-trip/issues/01`). The question is asked of the
  // SPANS IN THE DOM rather than of the view, because those are the ones that
  // produced the caret being read back — the same reason the rest of this function
  // works from the DOM.
  const last = runs[runs.length - 1]
  const addressable = runs.some((el) => getComputedStyle(el).display !== 'none')
  if (last && addressable) {
    // The end of the last run is the end of the line's source. A trailing
    // COLLAPSED marker still counts in full: its characters occupy no width, but
    // they are source characters the line owns (`**加粗**` ends at 6, not 4).
    const src = last.dataset.src === undefined ? NaN : Number(last.dataset.src)
    if (!Number.isNaN(src)) return src + (last.textContent?.length ?? 0)
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
export function sourceOffsetAtPoint(
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
    const inside = offsetInsideRuns(runs, node, offset)
    if (inside !== null) return { block, local: inside }
  }

  // A table cell with no runs: its box IS the caret position, and the only one
  // that keeps characters inside the row. Checked against the point's own cell
  // first (the browser resolves a click on empty space to a nearby text node),
  // then against the event's target, which is the cell the user actually hit.
  const emptyCell = [cellAround(node), cellAround(fallback)].find(
    (cell): cell is HTMLElement => cell !== null && cellIsEmpty(cell),
  )
  const emptyCellSrc = cellSource(emptyCell ?? null)
  if (emptyCellSrc !== null) return { block, local: emptyCellSrc }

  // Neither the resolved node nor the event's target names a cell (a synthetic
  // click carries whatever target its dispatcher chose), so the CELL BOXES
  // decide: a row with no runs at all is a grid of boxes, and the point's own box
  // is the cell the user meant.
  const cellBoxes = [...lineEl.querySelectorAll<HTMLElement>(':scope > [data-cell]')]
  if (cellBoxes.length > 0 && cellBoxes.every(cellIsEmpty)) {
    const hit = cellBoxes.find((cell) => {
      const rect = cell.getBoundingClientRect()
      return (
        clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      )
    })
    const boxSrc = cellSource(hit ?? cellBoxes[0])
    if (boxSrc !== null) return { block, local: boxSrc }
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
  // An empty line has no laid-out runs; the caret belongs at the START of this
  // line, not at the start of the whole block.
  const src = lineEl.dataset.src
  return { block, local: src === undefined ? 0 : Number(src) }
}

/**
 * Block-local source offset of a DOM position, or null when `node` sits in none
 * of `runs`.
 *
 * This is the rule the whole mapping rests on, and it used to be written twice
 * (once for the caret read-back, once for the click hit test) — the kind of
 * duplication where the two copies drift and only one of them gets fixed:
 *
 * - a run's `data-src` is the source offset of its FIRST character, so a position
 *   inside it is that offset plus however many characters precede it;
 * - a position inside a COLLAPSED marker has no laid-out cell of its own, so it
 *   snaps to the marker's start rather than to an offset nobody can see.
 */
function offsetInsideRuns(runs: HTMLElement[], node: Node, offset: number): number | null {
  for (const el of runs) {
    if (el !== node && !el.contains(node)) continue
    const raw = el.dataset.src
    if (raw === undefined) return null
    const src = Number(raw)
    if (Number.isNaN(src)) return null
    if (getComputedStyle(el).display === 'none') return src
    const within = node.nodeType === Node.TEXT_NODE ? offset : 0
    return src + Math.min(within, el.textContent?.length ?? 0)
  }
  return null
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
