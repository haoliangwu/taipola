/**
 * Imperative DOM layer of the editor.
 *
 * Everything here is framework-free: it builds the rendered tree from the view
 * model, and maps positions between the Markdown source and the DOM. The kernel
 * (`kernel.ts`) owns state and events; React is not involved at all.
 *
 * DOM contract (kept stable — tests and the caret maths depend on it):
 *   `[data-block]`  one per source block, carries `data-src-start` and `data-kind`
 *   `[data-vline]`  one per source line inside a block, carries `data-src`
 *   `[data-run]`    one per non-empty run of view characters, carries `data-src`
 *   `[data-cell]`   one per table cell, holding that row's run spans
 *
 * Empty lines render a single `<br data-br>`: without a text position inside the
 * line box, the browser resolves a caret anchored there back to the end of the
 * previous text node and the next keystroke lands a line too high.
 */
import type { Block } from '../lib/markdown'
import type { BlockView, ViewRun } from '../lib/view'
import type { LineState } from '../lib/inline'

/* -------------------------------------------------------------------------- */
/* building                                                                   */
/* -------------------------------------------------------------------------- */

function lineClass(state: LineState | undefined): string {
  if (!state) return 'vl'
  const cls = ['vl', `vl-${state.kind}`]
  if (state.level) cls.push(`vl-h${state.level}`)
  // One class per nesting level: the rendered numbering is counted per level, so
  // a nested list restarts at 1 instead of continuing the outer list.
  if (state.listLevel !== undefined) cls.push(`vl-l${Math.min(state.listLevel, 5)}`)
  if (state.ordered) cls.push('vl-ordered')
  if (state.checked === true) cls.push('vl-checked')
  else if (state.checked === false) cls.push('vl-unchecked')
  return cls.join(' ')
}

function runClass(run: ViewRun, state: LineState | undefined): string {
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

function runElement(
  existing: HTMLElement | null,
  run: ViewRun,
  index: number,
  state: LineState | undefined,
): HTMLElement {
  if (run.mark.img) return imageElement(existing, run, index, state)

  const span = existing && existing.hasAttribute('data-run') ? existing : document.createElement('span')
  // An element rebuilt as a plain text run (the caret moved into the image) must
  // shed the picture markup, or the stale <img> would linger in the line.
  if (span.querySelector(':scope > img')) span.replaceChildren()
  setAttr(span, 'data-run', String(index))
  setAttr(span, 'data-src', String(run.src))
  const className = runClass(run, state)
  if (span.className !== className) span.className = className
  const title = run.mark.link !== undefined && !run.marker ? run.mark.link : ''
  if (span.title !== title) span.title = title
  // Only touch the text when it actually differs: assigning `textContent`
  // replaces the text node, which would throw away the browser's selection (and
  // an in-flight IME composition) for no reason.
  if (span.textContent !== run.text) span.textContent = run.text
  return span
}

/**
 * A rendered image.
 *
 * The picture is an `<img>`; the `![alt](url)` SOURCE rides along in a hidden
 * span. Without that copy, absorbing the document from the DOM would delete the
 * image line outright — the same failure mode the table's `| --- |` row had.
 */
function imageElement(
  existing: HTMLElement | null,
  run: ViewRun,
  index: number,
  state: LineState | undefined,
): HTMLElement {
  const img = run.mark.img as { src: string; alt: string }
  const usable =
    existing &&
    existing.hasAttribute('data-run') &&
    existing.querySelector(':scope > img') !== null
  const span = usable ? (existing as HTMLElement) : document.createElement('span')
  setAttr(span, 'data-run', String(index))
  setAttr(span, 'data-src', String(run.src))
  const className = `${runClass(run, state)} rn-image`
  if (span.className !== className) span.className = className

  const source = span.querySelector<HTMLElement>(':scope > .rn-src')
  const sourceEl = source ?? document.createElement('span')
  if (!source) {
    sourceEl.className = 'rn-src'
    sourceEl.setAttribute('aria-hidden', 'true')
    span.insertBefore(sourceEl, span.firstChild)
  }
  if (sourceEl.textContent !== run.text) sourceEl.textContent = run.text

  let picture = span.querySelector<HTMLImageElement>(':scope > img')
  if (!picture) {
    picture = document.createElement('img')
    span.appendChild(picture)
  }
  if (picture.getAttribute('src') !== img.src) picture.setAttribute('src', img.src)
  if (picture.getAttribute('alt') !== img.alt) picture.setAttribute('alt', img.alt)
  return span
}

/** A run that carries source text without occupying any space. */
function hiddenRun(text: string): HTMLElement {
  const span = document.createElement('span')
  span.setAttribute('data-run', '0')
  span.setAttribute('data-src', '0')
  span.className = 'rn rn-marker'
  span.textContent = text
  return span
}

/** The filler that gives an empty line a real editing position. */
function brElement(): HTMLElement {
  const br = document.createElement('br')
  br.setAttribute('data-br', '')
  return br
}

function lineElement(
  existing: HTMLElement | null,
  line: BlockView['lines'][number],
  index: number,
  state: LineState | undefined,
  raw: string,
): HTMLElement {
  const el = existing && existing.hasAttribute('data-vline') ? existing : document.createElement('div')
  setAttr(el, 'data-vline', String(index))
  setAttr(el, 'data-src', String(line.sourceStart))
  const revealed = line.runs.some((run) => run.dim)
  const className = revealed ? `${lineClass(state)} revealed` : lineClass(state)
  if (el.className !== className) el.className = className
  const indent = String(state?.indent ?? 0)
  if (el.style.getPropertyValue('--vl-indent') !== indent) {
    el.style.setProperty('--vl-indent', indent)
  }

  if (line.runs.length === 0) {
    // A table's `| --- |` row renders as an EMPTY line box in both states (the
    // view never emits runs for it), and in Typora it is not a visible row at
    // all: it collapses so the table has no blank band in the middle, and the
    // separator it stands for is drawn by the header row's border.
    if (state?.kind === 'table-delim') {
      // The row shows nothing (Typora has no visible delimiter row) but its
      // SOURCE must stay recoverable from the DOM. With no trace of `| --- |` in
      // the DOM, absorbing the document deleted that row outright: type one
      // character in a table and the delimiter vanished, so the table stopped
      // being a table. `normalizeTables` blanked the row on BOTH sides of the
      // comparison, which is why nothing caught it.
      syncChildren(el, 1, (_index, current) =>
        current && current.hasAttribute('data-run') ? current : hiddenRun(raw),
      )
      return el
    }
    // Every other empty line gets a real `<br>` so the browser has a text
    // position INSIDE it. Without one, a caret anchored on the empty line box is
    // resolved back to the end of the previous text node when the user types:
    // the characters then land at the end of the line above (`…内容ZZZQY`).
    // The old implementation rendered no child and relied on `min-height`, only
    // because React's reconciliation fought over a `<br>` it had not created —
    // the kernel owns this DOM, so the workaround is obsolete.
    syncChildren(el, 1, (_index, current) =>
      current && current.hasAttribute('data-br') ? current : brElement(),
    )
    return el
  }
  if (line.cellRuns) {
    // A table row is a grid of CELLS, not of runs: one cell per grid item, so
    // revealed inline markers inside a cell stay inside its column instead of
    // each becoming a column.
    syncChildren(el, line.cellRuns.length, (cellIndex, current) => {
      const cellEl = current && current.hasAttribute('data-cell') ? current : document.createElement('span')
      if (cellEl.className !== 'cell') cellEl.className = 'cell'
      setAttr(cellEl, 'data-cell', String(cellIndex))
      const cell = line.cellRuns![cellIndex] ?? []
      syncChildren(cellEl, cell.length, (i, runEl) => runElement(runEl, line.runs[cell[i]], cell[i], state))
      return cellEl
    })
    return el
  }
  syncChildren(el, line.runs.length, (runIndex, current) =>
    runElement(current, line.runs[runIndex], runIndex, state),
  )
  return el
}

function blockElement(
  existing: HTMLElement | null,
  block: Block,
  view: BlockView,
  lineStates: LineState[],
  start: number,
): HTMLElement {
  const el = existing && existing.hasAttribute('data-block') ? existing : document.createElement('div')
  // The `blk` class is a CSS contract, not decoration: every block-level rule is
  // written as `.blk[data-kind='table'] …` (table grid, header row, hairlines) or
  // `.blk[data-kind='list']` (per-list counter reset). Without it those rules
  // never match and tables render as stacked text.
  if (el.className !== 'blk') el.className = 'blk'
  setAttr(el, 'data-block', String(block.index))
  setAttr(el, 'data-src-start', String(start))
  setAttr(el, 'data-kind', lineStates[block.startLine]?.kind ?? 'text')
  syncChildren(el, view.lines.length, (index, current) => {
    const line = view.lines[index]
    const raw = block.raw.slice(line.sourceStart, line.sourceStart + line.sourceToVisible.length)
    return lineElement(current, line, index, lineStates[block.startLine + index], raw)
  })
  return el
}

/** Writes an attribute only when its value changed (attribute writes recalc style). */
function setAttr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value)
}

/**
 * Brings `parent`'s children to `count` items, reusing the elements already
 * there. Identity is preserved on purpose: a re-render that swapped elements
 * would detach whatever the browser's selection, drag or IME was anchored on.
 */
function syncChildren(
  parent: Element,
  count: number,
  make: (index: number, existing: HTMLElement | null) => HTMLElement,
): void {
  for (let i = 0; i < count; i++) {
    // `childNodes` also holds text nodes (the browser types into the root, and
    // paste leaves residue). Only an element of the right kind can be reused;
    // anything else is replaced.
    const node = parent.childNodes[i] ?? null
    const current = node instanceof HTMLElement ? node : null
    const next = make(i, current)
    if (next === current) continue
    if (node) parent.replaceChild(next, node)
    else parent.appendChild(next)
  }
  while (parent.childNodes.length > count) {
    parent.removeChild(parent.lastChild as Node)
  }
}

/** Renders the model into `host`, updating in place. */
export function renderDocument(
  host: HTMLElement,
  blocks: Block[],
  views: BlockView[],
  lineStates: LineState[],
  offsets: number[],
): void {
  const renderable = blocks.filter((_block, i) => views[i])
  syncChildren(host, renderable.length, (i, current) =>
    blockElement(current, renderable[i], views[i], lineStates, offsets[i]),
  )
}

/**
 * Everything the rendered DOM depends on, in one string.
 *
 * The kernel skips DOM writes when this is unchanged, so moving the caret
 * inside a block (which changes nothing visible) does not destroy text nodes —
 * and with them the browser's selection, drag state and IME composition.
 */
export function markupSignature(
  blocks: Block[],
  views: BlockView[],
  lineStates: LineState[],
  offsets: number[],
): string {
  const parts: string[] = []
  for (let i = 0; i < blocks.length; i++) {
    const view = views[i]
    const block = blocks[i]
    parts.push(`#${i}@${offsets[i]}+${block.startLine}~${lineStates[block.startLine]?.kind ?? 'text'}`)
    for (let li = 0; li < view.lines.length; li++) {
      const line = view.lines[li]
      const state = lineStates[block.startLine + li]
      const revealed = line.runs.some((run) => run.dim) ? '!' : ''
      parts.push(`${lineClass(state)}${revealed}:${state?.indent ?? 0}:${line.sourceStart}`)
      for (const run of line.runs) {
        const flags =
          `${run.marker ? 'm' : ''}${run.dim ? 'd' : ''}${run.mark.bold ? 'b' : ''}` +
          `${run.mark.italic ? 'i' : ''}${run.mark.strike ? 's' : ''}${run.mark.code ? 'c' : ''}` +
          `${run.mark.link !== undefined ? `l${run.mark.link}` : ''}` +
          `${run.mark.img ? `g${run.mark.img.src}` : ''}`
        parts.push(`${run.src}${flags}=${run.text}`)
      }
      if (line.cellRuns) parts.push(`c${line.cellRuns.map((c) => c.join('.')).join(';')}`)
    }
  }
  return parts.join('\n')
}

/* -------------------------------------------------------------------------- */
/* source <-> DOM mapping                                                     */
/* -------------------------------------------------------------------------- */

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
): { lineIndex: number; runIndex: number; offsetInRun: number } | null {
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
  const span = lineEl.querySelectorAll<HTMLElement>('[data-run]')[target.runIndex]

  host.focus({ preventScroll: true })
  const range = document.createRange()
  if (span) {
    const node = span.firstChild
    if (node && node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, Math.max(0, Math.min(target.offsetInRun, node.textContent?.length ?? 0)))
    } else {
      range.selectNodeContents(span)
    }
  } else {
    // An EMPTY line (a blank block, or the blank line left by exiting an empty
    // list item) has no run spans. Aborting here left the DOM selection clamped
    // on the previous line by the browser, and the read-back dragged the
    // document caret back with it: the "blank line disappears" bug. Anchor on
    // the line element itself instead.
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
  // An empty line has no laid-out runs; the caret belongs at the START of this
  // line, not at the start of the whole block.
  const src = lineEl.dataset.src
  return { block, local: src === undefined ? 0 : Number(src) }
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

/* -------------------------------------------------------------------------- */
/* reading the DOM back into source                                           */
/* -------------------------------------------------------------------------- */

/** Rebuilds a block's Markdown source from its rendered DOM. */
function readBlockSource(host: HTMLElement): string {
  const out: string[] = []
  host.querySelectorAll<HTMLElement>('[data-vline]').forEach((lineEl) => {
    out.push(textOfLine(lineEl))
  })
  return out.join('\n')
}

/**
 * Rebuilds the WHOLE document source from the rendered DOM.
 *
 * Blocks tile the document without gaps: every block contributes its lines
 * joined by newlines, and the blocks themselves are joined by one more newline.
 * Absorbing the browser's edit this way (rather than guessing a delta) is what
 * keeps a cross-block edit — select-all delete, paste, multi-line drag-delete —
 * from losing the blocks the edit did not touch.
 */
export function readDocumentSource(root: HTMLElement): string {
  const parts: string[] = []
  root.querySelectorAll<HTMLElement>('[data-block]').forEach((host) => {
    parts.push(readBlockSource(host))
  })
  return parts.join('\n')
}

/** Characters typed while the caret sat outside every block (below the last one). */
export function readLooseText(root: HTMLElement): string {
  let text = ''
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) text += node.textContent
  }
  return text
}

/**
 * The characters a line box currently holds, in DOM order.
 *
 * Span text is the common case. A line box can also hold DIRECT text nodes: the
 * browser inserts typing into an empty line (which renders no child of its own)
 * straight into the box, before any run span exists. Skipping them silently ate
 * every keystroke typed into an empty line, so both sources are read.
 *
 * TABLE lines are different: the DOM renders a grid of CELLS whose pipes are
 * deliberately not present as text (blockified grid children would each claim a
 * column). To rebuild the SOURCE from the DOM they must be re-inserted — the
 * canonical `| a | b |` form.
 */
function textOfLine(lineEl: HTMLElement): string {
  const cells = [...lineEl.querySelectorAll<HTMLElement>(':scope > [data-cell]')]
  if (cells.length > 0) {
    const parts = cells.map((cell) =>
      [...cell.querySelectorAll<HTMLElement>('[data-run]')].map((run) => run.textContent ?? '').join(''),
    )
    return `| ${parts.join(' | ')} |`
  }

  let text = ''
  for (const node of lineEl.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    } else if (node instanceof HTMLElement) {
      if (node.hasAttribute('data-run')) text += node.textContent ?? ''
      // `<br>` and other foreign elements contribute no characters.
    }
  }
  return text
}

/**
 * Normalizes table rows in a SOURCE string to the canonical form the DOM
 * rebuild produces, so a model and a DOM can be compared.
 *
 * Delimiter rows collapse to one canonical row rather than to nothing: the DOM
 * DOES carry their source (in a hidden run) and a blank placeholder would hide a
 * real difference.
 */
export function normalizeTables(text: string): string {
  const DELIMITER = /^\|?[\s:|-]+\|[\s:|-]*$/
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (t.startsWith('|') && t.length > 1 && DELIMITER.test(t)) return '| --- |'
      if (t.startsWith('|') && t.length > 1) {
        const inner = line.split('|').slice(1, -1).map((c) => c.trim())
        return `| ${inner.join(' | ')} |`
      }
      return line
    })
    .join('\n')
}

/**
 * Removes text nodes sitting directly in a line box.
 *
 * All real characters live inside `[data-run]` spans; a direct text node can
 * only be residue of a browser edit that the model has already absorbed.
 */
export function stripForeignText(root: HTMLElement | null): void {
  if (!root) return
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent !== '') node.remove()
  }
  root.querySelectorAll<HTMLElement>('[data-vline]').forEach((line) => {
    for (const node of Array.from(line.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent !== '') node.remove()
    }
  })
}

/**
 * Removes DOM nodes the browser inserted on its own.
 *
 * The editable root and its line boxes may accumulate stray elements (a `br` or
 * `div` from a native contenteditable Enter, rich-text fragments from a paste).
 * Everything the editor renders is a `[data-block]` holding `[data-vline]` lines
 * holding `[data-run]`/`[data-cell]` spans (empty lines render NO child of their
 * own).
 *
 * A foreign element's TEXT is salvaged into its parent line box (a pasted
 * `<div>` loses its wrapper, not its characters): `readDocumentSource` picks
 * direct text nodes back up, so pasted content lands in the model instead of
 * evaporating with the stripped element.
 */
export function sanitizeDom(root: HTMLElement | null): void {
  if (!root) return
  for (const child of Array.from(root.children)) {
    if (child instanceof HTMLElement && child.hasAttribute('data-block')) continue
    const text = child.textContent ?? ''
    if (text) child.replaceWith(document.createTextNode(text))
    else child.remove()
  }
  root.querySelectorAll<HTMLElement>('[data-vline]').forEach((line) => {
    for (const node of Array.from(line.childNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      const el = node as HTMLElement
      if (el.hasAttribute('data-run') || el.hasAttribute('data-cell') || el.hasAttribute('data-br')) continue
      const text = el.textContent ?? ''
      if (text) el.replaceWith(document.createTextNode(text))
      else el.remove()
    }
  })
}

/* -------------------------------------------------------------------------- */
/* line arithmetic                                                            */
/* -------------------------------------------------------------------------- */

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
