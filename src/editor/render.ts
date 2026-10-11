/**
 * Imperative DOM layer: the model -> DOM half.
 *
 * Everything here is framework-free: it builds the rendered tree from the view
 * model, and rebuilds the model's source text back out of that tree. The kernel
 * (`kernel.ts`) owns state and events; React is not involved at all.
 *
 * The other half — mapping a source offset to a caret and a DOM position back to
 * a source offset — lives in `position.ts`. The two share no state; the only
 * thing between them is the DOM contract below, which this module PRODUCES and
 * `position.ts` consumes.
 *
 * DOM contract (kept stable — the caret maths depends on it):
 *   `[data-block]`  one per source block, carries `data-src-start` and `data-kind`
 *   `[data-vline]`  one per source line inside a block, carries `data-src`
 *   `[data-run]`    one per non-empty run of view characters, carries `data-src`
 *   `[data-cell]`   one per table cell, holding that row's run spans, and carrying
 *                   `data-cell-src` — the cell's content start. A cell with no
 *                   runs has no `data-src` to read a caret position from, and
 *                   without one the caret fell to the ROW's start, i.e. in front
 *                   of the first pipe, where the next typed character stopped the
 *                   line being a row at all.
 *
 * Empty lines render a single `<br data-br>`: without a text position inside the
 * line box, the browser resolves a caret anchored there back to the end of the
 * previous text node and the next keystroke lands a line too high.
 */
import type { Block } from '../core/markdown'
import type { BlockView, ImageMark, ViewRun } from '../core/view'
import type { LineState } from '../core/inline'
import { MATH_BOTH_RE } from '../core/inline'
import { isBlankLine } from '../core/lines'
import type { BreakKind } from './kernel'
import { mathBlockHtml, mathHtml } from './math'

/* -------------------------------------------------------------------------- */
/* building                                                                   */
/* -------------------------------------------------------------------------- */

function lineClass(state: LineState | undefined): string {
  if (!state) return 'vl'
  const cls = ['vl', `vl-${state.kind}`]
  if (state.level) cls.push(`vl-h${state.level}`)
  // Alert blockquote: the type names the drawn title and the bar's colour.
  if (state.alert) cls.push('vl-alert', `vl-alert-${state.alert}`)
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
  if (run.mark.highlight) cls.push('rn-highlight')
  if (run.mark.superscript) cls.push('rn-sup')
  if (run.mark.subscript) cls.push('rn-sub')
  if (run.mark.code) cls.push('rn-code')
  if (run.mark.comment) cls.push('rn-comment')
  if (run.mark.link !== undefined) cls.push('rn-link')
  if (run.mark.footnoteRef !== undefined) cls.push('rn-footnote-ref')
  if (run.mark.math !== undefined) cls.push('rn-math')
  if (state?.kind === 'code' && !run.marker) cls.push('rn-codeblock')
  // highlight.js token classes, appended whole: a tiered scope arrives as several
  // classes at once (`hljs-title function_`), not as one class name.
  if (run.mark.hl) cls.push(run.mark.hl)
  return cls.join(' ')
}

function runElement(
  existing: HTMLElement | null,
  run: ViewRun,
  index: number,
  state: LineState | undefined,
): HTMLElement {
  if (run.mark.br && run.marker) return breakElement(existing, run, index)
  if (run.mark.img) return imageElement(existing, run, index, state)
  if (run.mark.math !== undefined && !run.dim) return mathElement(existing, run, index, state)

  const span = existing && existing.hasAttribute('data-run') ? existing : document.createElement('span')
  // An element reused from a RENDERED break (the caret flipped the token back
  // to source) keeps its `data-br-src` — shed it, or the readback would emit
  // the source twice (attribute + text).
  if (span.hasAttribute('data-br-src')) span.removeAttribute('data-br-src')
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
  // an in-flight IME composition) for no reason. A run that ACCUMULATED extra
  // text nodes (a composition's provisional shape — the browser types the
  // composing text beside the existing run text) reads the same `textContent`
  // but keeps several nodes: folding them back into one keeps later caret
  // anchoring (`span.firstChild`) from clamping to the first node's length.
  if (span.textContent !== run.text || span.childNodes.length > 1) {
    span.textContent = run.text
  }
  return span
}

/**
 * A block-level display-math element: the KaTeX output for the `$$…$$` block's
 * body, absolutely centred over the block's (hidden) source lines. The body
 * travels along in `data-tex`, exactly like an inline math run's `.rn-src` —
 * the DOM read never touches this element, it is decoration only.
 *
 * A broken formula (`mathBlockHtml` throws) falls back to the RAW body text,
 * so a bad `$$…$$` is readable and editable, never blank.
 */
function mathBlockElement(
  existing: HTMLElement | null,
  tex: string,
): HTMLElement {
  const usable = existing && existing.hasAttribute('data-math-render')
  const div = usable ? (existing as HTMLElement) : document.createElement('div')
  setAttr(div, 'data-math-render', '')
  if (div.className !== 'math-render') div.className = 'math-render'
  if (div.dataset.tex !== tex) {
    div.dataset.tex = tex
    try {
      div.innerHTML = mathBlockHtml(tex)
      div.classList.remove('math-fallback')
    } catch {
      div.textContent = tex
      div.classList.add('math-fallback')
    }
  }
  return div
}

/**
 * The body source of a `$$…$$` math block: everything between the delimiter
 * lines, newlines preserved (a display formula may span lines). The single-
 * line `$$ x $$` form reads its body from the regex, not from slicing (the
 * trailing `$$` is not the last two characters when spaces follow it).
 */
function mathBodySource(block: Block, view: BlockView): string {
  const lines = view.lines
  if (lines.length === 1) return MATH_BOTH_RE.exec(block.raw)?.[1] ?? ''
  const parts: string[] = []
  for (let li = 1; li < lines.length - 1; li++) {
    const line = lines[li]
    parts.push(block.raw.slice(line.sourceStart, line.sourceStart + line.sourceToVisible.length))
  }
  return parts.join('\n')
}

/**
 * A table cell's literal soft break: the run is replaced by a REAL `<br>` —
 * Typora's Shift+Enter effect in a cell. `data-br-src` keeps the exact source
 * (`<br>`, `<BR />`, …) so the readback re-emits the variant the user typed;
 * the element contributes no textContent, and the caret mapping counts its
 * source length through `data-br-src` (`offsetInBox`).
 */
function breakElement(
  existing: HTMLElement | null,
  run: ViewRun,
  index: number,
): HTMLElement {
  const usable =
    existing &&
    existing.hasAttribute('data-run') &&
    existing.querySelector(':scope > br[data-brsrc]') !== null
  const span = usable ? (existing as HTMLElement) : document.createElement('span')
  setAttr(span, 'data-run', String(index))
  setAttr(span, 'data-src', String(run.src))
  setAttr(span, 'data-br-src', run.text)
  const className = 'rn rn-break'
  if (span.className !== className) span.className = className
  let br = span.querySelector<HTMLElement>(':scope > br[data-brsrc]')
  if (!br) {
    br = document.createElement('br')
    br.setAttribute('data-brsrc', '')
    span.appendChild(br)
  }
  return span
}

/**
 * A rendered inline-math expression.
 *
 * The same shape as a rendered image: KaTeX's static HTML replaces the source
 * on screen, while the `$…$` SOURCE rides along in a hidden span — without
 * that copy, absorbing the document from the DOM would delete the math line
 * outright. `run.text` here is the expression WITHOUT the delimiters (the `$`
 * markers are their own marker runs), so the KaTeX output is rebuilt whenever
 * the expression itself changes.
 */
function mathElement(
  existing: HTMLElement | null,
  run: ViewRun,
  index: number,
  state: LineState | undefined,
): HTMLElement {
  const usable =
    existing &&
    existing.hasAttribute('data-run') &&
    existing.querySelector(':scope > .katex') !== null
  const span = usable ? (existing as HTMLElement) : document.createElement('span')
  setAttr(span, 'data-run', String(index))
  setAttr(span, 'data-src', String(run.src))
  // `runClass` already carries `rn-math`; nothing extra to append.
  const className = runClass(run, state)
  if (span.className !== className) span.className = className

  const source = span.querySelector<HTMLElement>(':scope > .rn-src')
  const sourceEl = source ?? document.createElement('span')
  if (!source) {
    sourceEl.className = 'rn-src'
    sourceEl.setAttribute('aria-hidden', 'true')
    span.insertBefore(sourceEl, span.firstChild)
  }
  if (sourceEl.textContent !== run.text) sourceEl.textContent = run.text

  const math = span.querySelector<HTMLElement>(':scope > .katex-container')
  if (!math) {
    const fresh = document.createElement('span')
    fresh.className = 'katex-container'
    fresh.innerHTML = mathHtml(run.text)
    span.appendChild(fresh)
  } else if (math.dataset.tex !== run.text) {
    math.dataset.tex = run.text
    math.innerHTML = mathHtml(run.text)
  }
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
  const img = run.mark.img as ImageMark
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
  // Decode off the main thread: the default (synchronous) decode can stall the
  // frame while a large image arrives. `loading="lazy"` deliberately does NOT
  // follow — images are rebuilt whenever the source reveal / collapse re-renders
  // a line (the stale-img cleanup above), so the "only fetch near the viewport"
  // semantics would be re-triggered by every rebuild for ~no gain.
  if (picture.decoding !== 'async') picture.decoding = 'async'
  if (picture.getAttribute('src') !== img.src) picture.setAttribute('src', img.src)
  if (picture.getAttribute('alt') !== img.alt) picture.setAttribute('alt', img.alt)
  // The width attribute is dropped when the suffix is, or a removed size would
  // stay on the reused element and the picture would keep a size the source no
  // longer asks for.
  const width = img.width ?? ''
  if (width === '') {
    if (picture.hasAttribute('width')) picture.removeAttribute('width')
  } else {
    setAttr(picture, 'width', width)
  }
  return span
}

/** A run that carries source text without occupying any space. */
function hiddenRun(text: string, src: number): HTMLElement {
  const span = document.createElement('span')
  span.setAttribute('data-run', '0')
  // Block-local source offset of the run's first character — the same contract
  // every visible run keeps. The delimiter row's single hidden run spans the
  // whole `| --- |` line, so the line's own start is the honest value; a
  // hardcoded 0 made every caret readback on the row land at the header row's
  // first cell instead.
  span.setAttribute('data-src', String(src))
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
  softBreakNext = false,
): HTMLElement {
  const el = existing && existing.hasAttribute('data-vline') ? existing : document.createElement('div')
  setAttr(el, 'data-vline', String(index))
  setAttr(el, 'data-src', String(line.sourceStart))
  const classes = [lineClass(state)]
  if (line.runs.some((run) => run.dim)) classes.push('revealed')
  const className = classes.join(' ')
  if (el.className !== className) el.className = className
  // A definition's `[1]`: the prefix that would have shown it collapsed as this
  // line's block prefix, so the renderer has to draw it. The label comes from the
  // line's STATE rather than from the view, because the state is what knows the
  // line is a definition — a `[^1]: ` inside a code fence is not one, and reading
  // the raw line here would have marked it anyway. Only a definition's first line
  // has a label, so a continuation draws no second `[1]`.
  const label = state?.footnoteLabel ?? ''
  if (label !== '') setAttr(el, 'data-footnote', label)
  else if (el.hasAttribute('data-footnote')) el.removeAttribute('data-footnote')

  // The alert type this quote line draws as its title (`.vl-alert::before`).
  const alert = state?.alert ?? ''
  if (alert !== '') setAttr(el, 'data-alert', alert)
  else if (el.hasAttribute('data-alert')) el.removeAttribute('data-alert')

  const indent = String(state?.indent ?? 0)
  if (el.style.getPropertyValue('--vl-indent') !== indent) {
    el.style.setProperty('--vl-indent', indent)
  }

  // A line inside a NESTED quote indents to its own level and draws its own
  // bar there (`> > 甲` sits one step deeper than `> 甲`; the block's bar is
  // level 1 and stays continuous across the whole quote, `blockquote/03`).
  // Revealed lines show the dim `> > ` source instead and need no bar of
  // their own, so the marker test is the one honest sign of nesting depth.
  if (state?.kind === 'quote') {
    const level = (line.runs[0]?.text.match(/>/g) ?? []).length || 1
    if (level > 1) {
      el.style.setProperty('--vl-lvl', String(level))
      setAttr(el, 'data-nest', '')
    } else {
      el.style.removeProperty('--vl-lvl')
      el.removeAttribute('data-nest')
    }
  }

  // A table's `| --- |` row: an EMPTY line box in both states (the view never
  // emits runs for it). In Typora it is not a visible row at all — it collapses so
  // the table has no blank band in the middle, and the separator it stands for is
  // drawn by the header row's border. Its SOURCE must still be recoverable from
  // the DOM: with no trace of `| --- |` there, absorbing the document deleted the
  // row outright — type one character in a table and the delimiter vanished, so
  // the table stopped being a table. `normalizeTables` blanked the row on BOTH
  // sides of the comparison, which is why nothing caught it.
  //
  // That hidden run has to FOLLOW the source, not just exist. It used to be
  // written once and reused as it was, so any edit to the rule row was read back
  // as the text from before the edit — adding a column writes a rule cell per
  // column, and the row came back with the old cells
  // (`.scratch/table-ops/issues/03`).
  if (state?.kind === 'table-delim') {
    syncChildren(el, 1, (_index, current) => {
      const run = current?.hasAttribute('data-run') ? current : hiddenRun(raw, line.sourceStart)
      if (run.textContent !== raw) run.textContent = raw
      setAttr(run, 'data-src', String(line.sourceStart))
      return run
    })
    return el
  }

  // A BLANK line — nothing on it, or nothing but spaces and tabs — has no text of
  // its own, so it needs a real `<br>`: without one the browser resolves a caret
  // anchored on the box back to the end of the previous text node, and characters
  // typed on the line land at the end of the line above (`…内容ZZZQY`). The `<br>`
  // comes first; a whitespace-only blank line carries its spaces after it, in
  // collapsed runs that occupy no width (`blankLine` in core/view). Rendering no
  // child at all and leaning on `min-height` was the old workaround for React
  // fighting over a `<br>` it had not created — the kernel owns this DOM now.
  //
  // The judgement is "blank", NOT "lays out no cell": a collapsed fence line, a
  // thematic break or an empty list item lays out no cell either, but it is
  // content with a box of its own, and a `<br>` inside it gives it a SECOND line
  // (measured: a `---` line went from 1px to a full line box).
  if (isBlankLine(raw) && line.runs.every((run) => run.marker)) {
    syncChildren(el, 1 + line.runs.length, (index, current) => {
      if (index === 0) return current && current.hasAttribute('data-br') ? current : brElement()
      return runElement(current, line.runs[index - 1], index - 1, state)
    })
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
      // The cell's CONTENT start, so that a cell with no runs is still an
      // addressable position (see `ViewLine.cellSrcs`). Without it a click on an
      // empty cell fell through to the line-start fallback and the next typed
      // character landed BEFORE the row's first pipe, which stops the line being
      // a row at all.
      setAttr(cellEl, 'data-cell-src', String(line.cellSrcs?.[cellIndex] ?? line.sourceStart))
      const cell = line.cellRuns![cellIndex] ?? []
      syncChildren(cellEl, cell.length, (i, runEl) => runElement(runEl, line.runs[cell[i]], cell[i], state))
      return cellEl
    })
    return el
  }
  // A SOFT BREAK inside the block is a real `<br>` at the line's end — the
  // next line is this paragraph's continuation (`lines[i+1].continues`),
  // Typora renders it that way and so does the markdown-it output: the
  // paragraph keeps its lines inside ONE block, the break lives in the line
  // box. The `<br>` comes AFTER the runs; it carries no source offset, exactly
  // like a blank line's. The line box's fixed `min-height` keeps the box one
  // line tall either way. Fenced code lines, table rows and blank lines never
  // take this path (they return above), so no break appears inside structures.
  syncChildren(el, line.runs.length + (softBreakNext ? 1 : 0), (runIndex, current) => {
    if (runIndex === line.runs.length) {
      return current && current.hasAttribute('data-br') ? current : brElement()
    }
    return runElement(current, line.runs[runIndex], runIndex, state)
  })
  return el
}

/**
 * 一个空白块的渲染态：全部由 kind 数组决定（ADR-0005 §2.2）——`s` 行渲染行盒、
 * `S` 行不渲染。旧的三态（placeholder 机器）已删除，见 ADR-0005 第三刀。
 */

/** True when a blank block's view line (block-relative `sourceStart`) is keyed
    `soft` in the session's kind map — the one question R1 lets the renderer
    ask (ADR-0005 §3.1: visibility is decided by `(src, kind)` alone). */
function isSoftLine(
  kinds: Map<number, BreakKind>,
  start: number,
  line: BlockView['lines'][number],
): boolean {
  return kinds.get(start + line.sourceStart) === 's'
}

function blockElement(
  existing: HTMLElement | null,
  block: Block,
  view: BlockView,
  lineStates: LineState[],
  start: number,
  gap = 0,
  kinds: Map<number, BreakKind>,
  soleBlankBlock = false,
): HTMLElement {
  const el = existing && existing.hasAttribute('data-block') ? existing : document.createElement('div')
  // The `blk` class is a CSS contract, not decoration: every block-level rule is
  // written as `.blk[data-kind='table'] …` (table grid, header row, hairlines) or
  // `.blk[data-kind='list']` (per-list counter reset). Without it those rules
  // never match and tables render as stacked text.
  if (el.className !== 'blk') el.className = 'blk'
  setAttr(el, 'data-block', String(block.index))
  setAttr(el, 'data-src-start', String(start))
  setAttr(el, 'data-gap', String(gap))
  // The VIEW's line count, unconditional: the read-back of a partially rendered
  // blank block reconstructs its skipped (structural) lines from this span.
  setAttr(el, 'data-vlines', String(view.lines.length))
  // A COMPLETE `$$…$$` region inside this block makes it a math block: it
  // opens on the first line (or opens+closes on one line) and closes on the
  // last. The view already hides the region's lines for that case (`blockMath`
  // in `buildBlockView`); the block kind here is what the KaTeX overlay and
  // its CSS contract attach to.
  const firstState = lineStates[block.startLine]
  const lastState = lineStates[block.startLine + view.lines.length - 1]
  const isMathBlock =
    firstState?.kind === 'math-fence' &&
    (view.lines.length === 1
      ? firstState.mathDelim === 'both'
      : firstState.mathDelim === 'open' && lastState?.mathDelim === 'close')
  const mathRevealed = view.lines.some((line) => line.runs.some((run) => run.dim))
  setAttr(el, 'data-kind', isMathBlock ? 'math-block' : (firstState?.kind ?? 'text'))
  // Alert type of the block's first line, for the per-type bar colour. The
  // line itself carries the same attribute for its drawn title (`vl-alert`).
  const blockAlert = lineStates[block.startLine]?.alert ?? ''
  if (blockAlert !== '') setAttr(el, 'data-alert', blockAlert)
  else el.removeAttribute('data-alert')
  // A blank block renders only its SOFT rows (kind `s`) plus any row that
  // CARRIES characters (a whitespace-only line is content, not a separator —
  // see `blankLine` in core/view): the R1 identity (ADR-0005 §2.2; matrix
  // §6.4) counts a blank line's box iff it is keyed `s`. A structural `S` row
  // produces no node at all — its newline is carried by the block's own
  // read-back, not by a hidden box. The ONE exception: the document's ONLY
  // block (the empty document, or one made of bare newlines) renders every row
  // — that box is the whole editing surface and the caret's only anchor. Only
  // BLANK blocks filter lines; a blank line inside a quote/list/table span is
  // part of the structure and keeps its row (family ②③, status quo).
  const blankBlock = firstState?.kind === 'blank'
  const blankLines = blankBlock && !soleBlankBlock
    ? Array.from({ length: view.lines.length }, (_, li) => li).filter(
        (li) =>
          isSoftLine(kinds, start, view.lines[li]) ||
          // A whitespace-only line carries a collapsed marker run — content
          // that must survive the round trip, so its box renders.
          view.lines[li].runs.length > 0,
      )
    : Array.from({ length: view.lines.length }, (_, li) => li)
  // `data-placeholder` marks a blank block that renders session-soft rows: a
  // soft CHAIN stays visible after the caret leaves (the kind state owns this
  // now — ADR-0005 §2.2), and the legacy persisted-chain suites count these
  // boxes through the same selector. The old hide-a-separator-row attributes
  // (`data-ph-sep`/`data-ph-sep-after`) are gone with the machinery.
  if (blankBlock && blankLines.length > 0) setAttr(el, 'data-placeholder', '')
  else el.removeAttribute('data-placeholder')
  // While the caret is OUTSIDE a math block, one extra child renders the
  // KaTeX display over the hidden source lines; focused, the child is gone
  // and the lines show their raw source.
  const mathChild = isMathBlock && !mathRevealed ? 1 : 0
  syncChildren(el, blankLines.length + mathChild, (index, current) => {
    if (index === blankLines.length) {
      return mathBlockElement(current, mathBodySource(block, view))
    }
    const lineIndex = blankLines[index]
    const line = view.lines[lineIndex]
    const raw = block.raw.slice(line.sourceStart, line.sourceStart + line.sourceToVisible.length)
    return lineElement(
      current,
      line,
      lineIndex,
      lineStates[block.startLine + lineIndex],
      raw,
      view.lines[lineIndex + 1]?.continues === true,
    )
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

/** Renders the model into `host`, updating in place. The renderer reads ONLY
    the source and the session's kind map — the pure `(src, kind) → expandedDoc
    → DOM` pipeline of ADR-0005 §2.2. It never looks at the caret, at any
    pending-break state or at chain memory: whether a blank line draws a box is
    a decision the kind map answers alone. */
export function renderDocument(
  host: HTMLElement,
  blocks: Block[],
  views: BlockView[],
  lineStates: LineState[],
  offsets: number[],
  kinds: Map<number, BreakKind>,
): void {
  // A blank block BETWEEN two blocks is a paragraph SEPARATOR, not a visible
  // row: it renders no DOM node unless the session opened a SOFT row inside it
  // (`kind == 's'` — the box Typora's soft break owns), and the gap between the
  // surrounding blocks is carried by their margins (Typora renders
  // `甲\n\n乙` as two <p> with a gap and no blank box). A blank block that
  // CARRIES characters (a whitespace-only line) is content, not a separator: it
  // keeps its row so the spaces survive the round trip.
  //
  // The LAST block still always gets a block element, even when every one of
  // its rows is structural (renders no line box): the read-back needs its
  // `data-vlines`/`data-gap` to reconstruct the document's trailing newlines,
  // and the empty document needs its one editable line. The boxes themselves
  // follow R1 (matrix §6.4) — a trailing structural blank draws none.
  const lastIndex = blocks.length - 1
  const renderable = blocks.filter(
    (block, i) =>
      views[i] &&
      (lineStates[block.startLine]?.kind !== 'blank' ||
        block.raw !== '' ||
        i === lastIndex ||
        views[i]!.lines.some((line) => isSoftLine(kinds, offsets[i], line))),
  )
  // The document that IS a single blank block: its rows are the whole editing
  // surface (the empty document, or one made of bare newlines), so every row
  // renders regardless of kind.
  const soleBlankBlock =
    blocks.length === 1 && lineStates[blocks[0]!.startLine]?.kind === 'blank'
  syncChildren(host, renderable.length, (i, current) => {
    const block = renderable[i]
    // `views`/`offsets` are indexed by the block's ORIGINAL index, which jumps
    // when a blank separator is filtered out — indexing them by the filtered
    // position handed the paragraph after a blank the blank's own view
    // (`paragraph-spacing/01` 十一审).
    const srcStart = offsets[block.index]
    // The characters between this block and the previous RENDERED block —
    // unfiltered blank separators — are baked into the DOM as `data-gap`, a
    // constant that does not move when the block's own text is edited. The
    // read-back trusts it, so typing inside a paragraph can never drift the
    // blank separator that follows it (its value is a property of the source,
    // not of the current text length).
    const prev = i > 0 ? renderable[i - 1] : null
    // The previous block's rendered text also covers the blank lines its span
    // absorbs (a list's trailing blank), so the gap is measured from the end
    // of the VIEW, not from `raw`'s own length.
    const prevEnd =
      prev !== null
        ? offsets[prev.index] +
          prev.raw.length +
          Math.max(0, views[prev.index].lines.length - prev.raw.split('\n').length)
        : 0
    const gap = prev !== null ? srcStart - prevEnd : srcStart
    return blockElement(current, block, views[block.index], lineStates, srcStart, gap, kinds, soleBlankBlock)
  })
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
  kinds: Map<number, BreakKind>,
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
          `${run.mark.comment ? 'C' : ''}` +
          `${run.mark.br !== undefined ? `B${run.mark.br}` : ''}` +
          `${run.mark.highlight ? 'h' : ''}${run.mark.superscript ? 'p' : ''}${run.mark.subscript ? 'q' : ''}` +
          `${run.mark.link !== undefined ? `l${run.mark.link}` : ''}` +
          `${run.mark.math !== undefined ? `M${run.mark.math}` : ''}` +
          `${run.mark.hl ? `H${run.mark.hl}` : ''}` +
          `${run.mark.img ? `g${run.mark.img.src}` : ''}`
        parts.push(`${run.src}${flags}=${run.text}`)
      }
      if (line.cellRuns) parts.push(`c${line.cellRuns.map((c) => c.join('.')).join(';')}`)
    }
  }
  // The kind map decides what renders (R1) — it belongs in the render signature,
  // or a caret move that only changed session soft identity would skip the redraw.
  for (const [at, kind] of kinds) parts.push(`K${at}${kind === 's' ? 's' : 'S'}`)
  return parts.join('\n')
}

/* -------------------------------------------------------------------------- */
/* reading the DOM back into source                                           */
/* -------------------------------------------------------------------------- */

/**
 * Rebuilds a block's Markdown source from its rendered DOM.
 *
 * A BLANK block renders only its SOFT (`s`) rows and its whitespace-carrying
 * rows — the structural (`S`) rows of the same block produce no node. The block
 * therefore cannot be read by joining the rendered lines: the missing rows are
 * real newlines in the source. Each line element carries its block-local index
 * (`data-vline`) and the block carries its full line count (`data-vlines`), so
 * the source is reconstructed by slotting each rendered row's text into its
 * index and joining all `V` slots with `\n` — a structural empty row
 * contributes an empty slot and with it exactly one newline. The block's own
 * final newline is the one the read-back leaves to the NEXT block's `data-gap`
 * (the join emits `V − 1` newlines between `V` slots); a trailing row's own
 * newline is covered by that same gap / the document end instead.
 * Every other block renders every line; its plain `\n` join is unchanged
 * (tables re-pad cells, so only the DOM-distance form is safe there).
 */
function readBlockSource(host: HTMLElement): string {
  const lines = [...host.querySelectorAll<HTMLElement>('[data-vline]')]
  if (host.getAttribute('data-kind') !== 'blank') {
    return lines.map(textOfLine).join('\n')
  }
  const total = Number(host.getAttribute('data-vlines') ?? '0')
  if (total <= 0) return ''
  const slots = new Array<string>(total).fill('')
  for (const el of lines) {
    const li = Number(el.dataset.vline)
    if (li >= 0 && li < total) slots[li] = textOfLine(el)
  }
  return slots.join('\n')
}

/**
 * Rebuilds the WHOLE document source from the rendered DOM.
 *
 * Blocks tile the document, but a blank SEPARATOR between two blocks renders
 * no node (`paragraph-spacing/01` 十一审): its rows are purely a source
 * construct, and the gap is carried by the blocks' margins. Their place is
 * recovered from the block offsets — the characters between one block's end
 * and the next block's `data-src-start` are exactly the missing blank lines,
 * so the reconstruction pads them back in. A trailing blank block still
 * renders (it is the paragraph placeholder Enter opened), so the document
 * tail needs no padding.
 *
 * Absorbing the browser's edit this way (rather than guessing a delta) is what
 * keeps a cross-block edit — select-all delete, paste, multi-line drag-delete —
 * from losing the blocks the edit did not touch.
 */
export function readDocumentSource(root: HTMLElement): string {
  const parts: string[] = []
  root.querySelectorAll<HTMLElement>('[data-block]').forEach((host) => {
    // The gap BEFORE this block is a rendered constant (`data-gap`): the
    // unrendered blank separators between it and the previous block. It does
    // not depend on the block's current text length, so typing inside a
    // paragraph cannot drift it.
    const gap = Number(host.getAttribute('data-gap') ?? '')
    if (gap > 0) parts.push('\n'.repeat(gap))
    parts.push(readBlockSource(host))
  })
  return parts.join('')
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
 * The SOURCE text of one rendered run.
 *
 * Most runs are their own text, but two rendered forms keep their source in a
 * hidden `.rn-src` beside what they DRAW: an image (the `<img>`, no text of its
 * own) and inline math (KaTeX's output, which carries text — `$a$` renders an
 * `a`, and more than once, since the MathML and the visual spans both hold it).
 * Reading `textContent` on those runs absorbs the source AND the rendering, so
 * the model grew on every keystroke (`inline-markers/03`). Whenever the hidden
 * span exists it is the run's truth; the picture and the formula are decoration.
 */
function runSource(run: HTMLElement): string {
  // A rendered soft break holds no text of its own; its source rides in
  // `data-br-src` and is the only byte-true record of the variant typed.
  const br = run.getAttribute('data-br-src')
  if (br !== null) return br
  const hidden = run.querySelector<HTMLElement>(':scope > .rn-src')
  return (hidden ?? run).textContent ?? ''
}

/**
 * The characters a box holds, in DOM order: its run spans plus any DIRECT text
 * node the browser inserted into it.
 *
 * Both sources are mandatory. A box with runs is the normal case, but the browser
 * types straight into the box when there is no run to type into — an empty line,
 * and an empty table CELL — and skipping those silently ate the keystroke.
 */
function boxSource(box: HTMLElement): string {
  let text = ''
  for (const node of box.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
    else if (node instanceof HTMLElement && node.hasAttribute('data-run')) text += runSource(node)
  }
  return text
}

/**
 * A table CELL's text.
 *
 * A cell is one source line by construction — a row IS a line — so text that
 * arrives with a newline in it is flattened to spaces instead of being written
 * into the row. Pasting a copied line is the everyday case: the clipboard carries
 * the newline with it, and `white-space: pre-wrap` puts it in the cell verbatim.
 * A newline there does not make a taller cell, it splits the ROW: the row's source
 * gains `\n`, the block reports two lines, and the table falls apart into
 * pipe-shaped paragraphs with no cell boxes at all — which is what "the last
 * row's border disappeared" turned out to be
 * (`.scratch/table-ops/issues/04`).
 */
function cellSource(cell: HTMLElement): string {
  // A newline run and the spaces around it become ONE space, and the cell's own
  // padding goes: the spaces beside a cell's text are the column's padding, not
  // its content — `tableRowCells` trims exactly the same characters on the way
  // back in, so this is the same rule and not a second opinion.
  return boxSource(cell)
    .replace(/[ \t]*\r?\n[ \t]*/g, ' ')
    .trim()
}

/**
 * The characters a line box currently holds, in DOM order.
 *
 * TABLE lines are different from every other line: the DOM renders a grid of
 * CELLS whose pipes are deliberately not present as text (blockified grid
 * children would each claim a column). To rebuild the SOURCE from the DOM they
 * must be re-inserted — the canonical `| a | b |` form.
 */
function textOfLine(lineEl: HTMLElement): string {
  const cells = [...lineEl.querySelectorAll<HTMLElement>(':scope > [data-cell]')]
  if (cells.length > 0) return `| ${cells.map(cellSource).join(' | ')} |`
  return boxSource(lineEl)
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
