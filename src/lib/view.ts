/**
 * Source <-> view mapping.
 *
 * The document model is plain Markdown **source**. What the user sees is a *view*
 * of that source in which syntax markers exist as DOM text but collapse to zero
 * width once their construct is closed and the caret has left it: `**bold**`
 * occupies six source characters and only two laid-out ones.
 *
 * Every visible character remembers which source offset produced it, and every
 * source offset stays reachable from the view — markers included — so a caret can
 * never fall into a gap. Nothing here reflows text: wrapping is the browser's job.
 */

interface MarkerCell {
  /** Source range of the opening marker, e.g. the `**` of `**bold**`. */
  openStart: number
  openEnd: number
  /** Source range of the closing marker. */
  closeStart: number
  closeEnd: number
}

interface Mark {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  link?: string
}

/** A run of characters sharing one styling and one visibility. */
export interface ViewRun {
  /** The characters this run contributes to the DOM, verbatim. */
  text: string
  /** Block-local source offset of `text[0]`. */
  src: number
  mark: Mark
  /** True when this run is a syntax marker rather than content. */
  marker: boolean
  /**
   * True for a revealed block-level marker (a heading `#`, list bullet, quote
   * marker or fence line): it takes up space now, and should render dimmed so
   * the edit state reads as "source" without shouting.
   */
  dim?: boolean
}

/** Per-line build options derived by `buildBlockView` from the whole block. */
interface BuildOptions {
  /** True while the caret is anywhere inside this block. */
  revealInBlock?: boolean
  /** True while this line sits between two fence markers (code content). */
  inCode?: boolean
  /** True when this content is a table cell (skip block prefixes). */
  cell?: boolean
}

interface ViewLine {
  /**
   * Block-local source offset where this line begins.
   *
   * Collapsed prefixes mean the first VISIBLE cell can sit well after the line's
   * actual start (`- **bold**` hides four characters before its first glyph), so
   * this origin has to be recorded rather than inferred from the visible cells.
   */
  sourceStart: number
  runs: ViewRun[]
  /**
   * Table rows only: run-index ranges, one per cell (empty range = empty cell).
   * The DOM must render each CELL as one grid item — a run-per-item grid splits
   * a cell whose inline markers are revealed into several columns.
   */
  cellRuns?: number[][]
  /** `visibleToSource[i]` = block-local source offset of laid-out cell i. */
  visibleToSource: number[]
  /** `sourceToVisible[local]` = laid-out cell index, or -1 for no width. */
  sourceToVisible: number[]
  /** `sourceToMarker[local]` = index into `markers`, or -1. */
  sourceToMarker: number[]
  markers: MarkerCell[]
  /** Laid-out text of this line, collapsed markers excluded. */
  text: string
}

export interface BlockView {
  lines: ViewLine[]
}

interface Token {
  kind: 'bold' | 'italic' | 'strike' | 'code' | 'link'
  start: number
  end: number
  innerStart: number
  innerEnd: number
  url?: string
}

const PAIRED: Array<{ kind: Token['kind']; re: RegExp }> = [
  { kind: 'bold', re: /^(\*\*|__)([\s\S]*?)\1/ },
  { kind: 'strike', re: /^(~~)([\s\S]*?)\1/ },
  { kind: 'code', re: /^(`+)([\s\S]*?)\1/ },
  { kind: 'italic', re: /^(\*|_)(?!\s)([\s\S]*?)\1/ },
]

/**
 * Finds inline constructs in one line of source.
 *
 * A linear scan with balanced-pair matching, so nesting resolves into separate
 * non-overlapping tokens.
 */
function findTokens(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < text.length) {
    const rest = text.slice(i)

    const image = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(rest)
    if (image) {
      tokens.push({ kind: 'link', start: i, end: i + image[0].length, innerStart: i + 2, innerEnd: i + 2 + image[1].length, url: image[2] })
      i += image[0].length
      continue
    }

    const link = /^\[([^\]]*)\]\(([^)]*)\)/.exec(rest)
    if (link) {
      tokens.push({ kind: 'link', start: i, end: i + link[0].length, innerStart: i + 1, innerEnd: i + 1 + link[1].length, url: link[2] })
      i += link[0].length
      continue
    }

    let matched = false
    for (const { kind, re } of PAIRED) {
      const m = re.exec(rest)
      if (!m) continue
      const marker = m[1]
      const inner = m[2]
      tokens.push({
        kind,
        start: i,
        end: i + m[0].length,
        innerStart: i + marker.length,
        innerEnd: i + marker.length + inner.length,
      })
      i += m[0].length
      matched = true
      break
    }
    if (matched) continue

    i++
  }

  return tokens
}

/** Block-level prefixes that collapse when the caret is on another line. */
const BLOCK_PREFIXES: RegExp[] = [
  /^(\s{0,3})(#{1,6})(\s+)/,
  /^(\s*)([-*+]|\d+[.)])(\s+)/,
  /^(\s*)(\[[ xX]\])(\s+)/,
  /^(\s*)(>+)(\s?)/,
]

/**
 * Source range of the block-level marker at the start of a line, or null.
 *
 * Headings, list bullets, task boxes and quote markers all collapse the same way;
 * the styling they imply comes from the line's class instead.
 */
function blockPrefixRange(raw: string): { start: number; end: number } | null {
  if (raw.trim() === '') return null
  // A horizontal rule is content, not a prefix.
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) return null

  // Try every pattern at each position and keep whichever consumes the most, so
  // nested prefixes accumulate (`> - item`). Breaking on the first pattern that
  // merely fails would stop before a bare list bullet or quote marker.
  let end = 0
  for (;;) {
    let best = 0
    for (const re of BLOCK_PREFIXES) {
      const m = re.exec(raw.slice(end))
      if (m && m[0].length > best) best = m[0].length
    }
    if (best === 0) break
    end += best
  }
  return end > 0 ? { start: 0, end } : null
}

function isTableRow(raw: string): boolean {
  const t = raw.trim()
  return t.startsWith('|') && t.length > 1
}

/**
 * Builds the view of a single source line.
 *
 * Table rows take a separate path, because a grid row cannot host collapsed
 * marker runs — see `buildTableLine`.
 */
const TABLE_DELIMITER_RE = /^\|?[\s:|-]+\|[\s:|-]*$/

/** A table's `| --- |` rule line renders as an empty line box. */
function isTableDelimiter(raw: string): boolean {
  return isTableRow(raw) && TABLE_DELIMITER_RE.test(raw.trim())
}

function buildLine(raw: string, revealFrom: number | null, sourceStart = 0, opts: BuildOptions = {}): ViewLine {
  if (isTableDelimiter(raw)) return emptyLine(raw.length, sourceStart)
  if (isTableRow(raw)) return buildTableLine(raw, revealFrom, sourceStart, opts)
  return buildInlineLine(raw, revealFrom, sourceStart, opts)
}

/** A line whose characters take up no space at all. */
function emptyLine(length: number, sourceStart = 0): ViewLine {
  return {
    sourceStart,
    runs: [],
    visibleToSource: [],
    sourceToVisible: new Array(length).fill(-1) as number[],
    sourceToMarker: new Array(length).fill(-1) as number[],
    markers: [],
    text: '',
  }
}

/**
 * Builds a table row as its cells, with the pipes left out entirely.
 *
 * A delimiter row (`| --- |`) goes through the same path: every cell strips to
 * nothing, so the rule line occupies no visible space while still holding its
 * line box open.
 *
 * The pipes are deliberately NOT emitted as hidden runs: a `display: grid` row
 * blockifies its direct children, and blockification overrides `display: none`,
 * so a "collapsed" pipe still claimed a whole grid column. Emitting only the
 * cells sidesteps that and lets them line up in shared grid columns, while the
 * per-cell source offsets keep the caret mapping exact.
 */
function buildTableLine(raw: string, revealFrom: number | null, sourceStart = 0, opts: BuildOptions = {}): ViewLine {
  const pieces = raw.split('|')
  const runs: ViewRun[] = []
  const cellRuns: number[][] = []
  const visibleToSource: number[] = []
  const sourceToVisible = new Array(raw.length).fill(-1) as number[]
  const sourceToMarker = new Array(raw.length).fill(-1) as number[]
  const markers: MarkerCell[] = []

  let at = 0
  for (let pi = 0; pi < pieces.length; pi++) {
    const piece = pieces[pi]
    const pieceStart = at
    at += piece.length + 1 // this piece plus the pipe that followed it

    // The leading and trailing pieces are the two edge pipes themselves, not
    // cells; a middle piece may be an empty cell and must keep its column.
    const isEdge = pi === 0 || pi === pieces.length - 1

    const cellStart = runs.length
    const trimmed = piece.trim()
    if (trimmed !== '' && !isEdge) {
      // Surrounding spaces are padding, not content. Dropping them is what makes
      // each column's text start at the same x on every row.
      const lead = piece.length - piece.trimStart().length
      const inner = buildInlineLine(
        trimmed,
        revealFrom === null ? null : revealFrom - pieceStart - lead,
        sourceStart + pieceStart + lead,
        { revealInBlock: opts.revealInBlock, cell: true },
      )
      for (const run of inner.runs) {
        // `run.src` already includes `sourceStart + pieceStart + lead` — the
        // cell's block-relative origin — so it must NOT be shifted again. Adding
        // `pieceStart + lead` a second time double-counted the cell offset and
        // broke data-src for every cell after the first.
        runs.push(run)
        if (run.marker) {
          const cell = markers.length
          markers.push({
            openStart: run.src,
            openEnd: run.src + run.text.length,
            closeStart: run.src + run.text.length,
            closeEnd: run.src + run.text.length,
          })
          // `sourceToMarker` indexes the row's own characters, so the block
          // origin has to come back out.
          const rowLocal = run.src - sourceStart
          for (let k = 0; k < run.text.length; k++) sourceToMarker[rowLocal + k] = cell
        }
      }
      for (let k = 0; k < trimmed.length; k++) {
        const local = inner.sourceToVisible[k]
        sourceToVisible[pieceStart + lead + k] = local === -1 ? -1 : visibleToSource.length + local
      }
      for (const src of inner.visibleToSource) visibleToSource.push(src + pieceStart + lead)
    }
    if (!isEdge) {
      const indices: number[] = []
      for (let i = cellStart; i < runs.length; i++) indices.push(i)
      cellRuns.push(indices)
    }
  }

  return {
    sourceStart,
    runs,
    cellRuns,
    visibleToSource,
    sourceToVisible,
    sourceToMarker,
    markers,
    text: runs.filter((r) => !r.marker).map((r) => r.text).join(''),
  }
}

/**
 * Builds the view of one ordinary line of inline content.
 *
 * `revealFrom` is a line-local source offset; the inline construct containing
 * it keeps its markers visible so its syntax can be edited in place. Every
 * other closed construct collapses.
 *
 * Block-level markers — a fence line, or a line-leading prefix (heading `#`,
 * list bullet, task box, quote `>`) — collapse while the caret is outside the
 * block and are revealed while the caret is anywhere inside it, which is what
 * makes `# Title` behave like Typora's headings.
 */
function buildInlineLine(raw: string, revealFrom: number | null, sourceStart = 0, opts: BuildOptions = {}): ViewLine {
  const revealInBlock = opts.revealInBlock === true
  const inCode = opts.inCode === true
  const isTableCell = opts.cell === true
  const isFenceLine = !inCode && !isTableCell && /^\s*(`{3,}|~{3,})/.test(raw)

  // Code content and fence lines are literal: a `**` inside a fence is text,
  // and a fence opener must not be misread as an inline-code construct.
  const tokens = inCode || isFenceLine ? [] : findTokens(raw)
  const markers: MarkerCell[] = []

  // A marker shows while the caret is inside its construct.
  const visibleMarker = new Set<number>()
  if (revealFrom !== null) {
    for (const token of tokens) {
      if (token.innerEnd > token.innerStart && revealFrom >= token.start && revealFrom <= token.end) {
        visibleMarker.add(token.start)
      }
    }
  }

  const hidden = new Set<number>()
  for (const token of tokens) {
    if (visibleMarker.has(token.start)) continue
    for (let k = token.start; k < token.innerStart; k++) hidden.add(k)
    for (let k = token.innerEnd; k < token.end; k++) hidden.add(k)
  }

  // Block-level marker: a whole fence line, a horizontal rule, or the line's
  // leading prefix. Fence lines and rules collapse entirely (the rule keeps a
  // ruled line via CSS; the box stays so the block keeps its proportions);
  // prefixes collapse while the caret is outside the block. All of them are
  // revealed as dim source text while the caret is inside this block — a rule
  // shows as `---` again, so the caret always has visible text to anchor to.
  let blockMarker: { start: number; end: number } | null = null
  if (isFenceLine) {
    blockMarker = { start: 0, end: raw.length }
  } else if (!inCode && !isTableCell) {
    if (raw.trim() !== '' && /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      blockMarker = { start: 0, end: raw.length }
    } else {
      blockMarker = blockPrefixRange(raw)
    }
  }
  const markerShown = blockMarker !== null && revealInBlock
  if (blockMarker !== null && !markerShown) {
    for (let k = blockMarker.start; k < blockMarker.end; k++) hidden.add(k)
  }

  // Run segmentation is decided up front: token boundaries plus the block
  // marker's end. Both scans stop at these, so a collapsed prefix is never
  // merged into the marker of the construct beside it, and the hidden and
  // shown states share one segmentation — revealing toggles a CSS class, never
  // replaces a text node, so a caret anchored in the neighbouring text is
  // never dislodged.
  const boundaries = new Set<number>([0])
  for (const token of tokens) {
    boundaries.add(token.start)
    boundaries.add(token.innerStart)
    boundaries.add(token.innerEnd)
    boundaries.add(token.end)
  }
  if (blockMarker !== null) boundaries.add(blockMarker.end)

  const runs: ViewRun[] = []
  const visibleToSource: number[] = []
  const sourceToVisible = new Array(raw.length).fill(-1) as number[]
  const sourceToMarker = new Array(raw.length).fill(-1) as number[]

  let i = 0
  while (i < raw.length) {
    if (hidden.has(i)) {
      // A hidden run is simply a run of hidden characters. It must NOT be gated
      // on finding a token at this index: a closing marker sits at a token's
      // `innerEnd`, where no token *starts*, so gating on that leaks the closing
      // `**` straight back onto the screen.
      let end = i
      while (end < raw.length && hidden.has(end) && !(end > i && boundaries.has(end))) end++
      const token = tokens.find((t) => t.start === i || t.innerEnd === i)
      const marker: MarkerCell = token
        ? i < token.innerStart
          ? { openStart: i, openEnd: token.innerStart, closeStart: token.innerEnd, closeEnd: token.end }
          : { openStart: token.innerStart, openEnd: i, closeStart: i, closeEnd: end }
        : { openStart: i, openEnd: i, closeStart: i, closeEnd: end }
      const index = markers.length
      markers.push(marker)
      for (let k = i; k < end; k++) sourceToMarker[k] = index
      runs.push({ text: raw.slice(i, end), src: sourceStart + i, mark: {}, marker: true })
      i = end
      continue
    }

    // A visible run must stop where ANY marker boundary begins — not only where a
    // token starts. A closing marker sits at a token's `innerEnd`, and a revealed
    // opening marker sits at its `innerStart`; missing those boundaries merges a
    // collapsed prefix together with a revealed marker into one hidden run, which
    // is why `**` never appeared even though the reveal range was correct.
    let end = i
    while (end < raw.length && !hidden.has(end) && (end === i || !boundaries.has(end))) {
      end++
    }
    if (end === i) end = i + 1

    for (let k = i; k < end; k++) {
      sourceToVisible[k] = visibleToSource.length
      visibleToSource.push(k)
    }
    // `ViewRun.src` is a BLOCK-relative offset, so the line's own origin has to
    // be folded in. Reporting the in-line index instead worked only for
    // single-line blocks (whose first line starts at the block start) and made
    // every line of a multi-line block — code blocks, lists — claim offset 0,
    // which broke the caret mapping completely.
    const isMarkerRun =
      markerShown && blockMarker !== null && i === blockMarker.start && end === blockMarker.end
    runs.push({
      text: raw.slice(i, end),
      src: sourceStart + i,
      mark: markFor(tokens, i, end),
      marker: false,
      dim: isMarkerRun || undefined,
    })
    i = end
  }

  return {
    sourceStart,
    runs,
    visibleToSource,
    sourceToVisible,
    sourceToMarker,
    markers,
    text: runs.filter((r) => !r.marker).map((r) => r.text).join(''),
  }
}

function markFor(tokens: Token[], start: number, end: number): Mark {
  const mark: Mark = {}
  for (const token of tokens) {
    if (token.innerStart <= start && token.innerEnd >= end) {
      if (token.kind === 'bold') mark.bold = true
      else if (token.kind === 'italic') mark.italic = true
      else if (token.kind === 'strike') mark.strike = true
      else if (token.kind === 'code') mark.code = true
      else if (token.kind === 'link') mark.link = token.url
    }
  }
  return mark
}

/**
 * Builds the view of a whole block. `blockStart` is a document source offset.
 *
 * `revealAt` holds document offsets of the caret; the block is "in edit mode"
 * (`revealInBlock`) when any of them falls inside it. `revealFrom` handed to
 * each line is LINE-LOCAL — inline tokens are line-local, and comparing a
 * block-local offset against them silently turned reveal off for every line
 * after the first of a multi-line block.
 *
 * Lines between two fence markers are code content: their `inCode` flag means
 * no inline parsing and no block prefixes — a `**` inside a fence is literal.
 *
 * `lineCount` is the block's OFFICIAL line span (endLine - startLine), which
 * can exceed the raw's own line count: the parser strips trailing blank lines
 * from a block's raw (a markdown-it list range often covers the blank line
 * after its last item). Without padding, a caret on those stripped lines had
 * no box to anchor to and fell back onto the last content line — a list's
 * empty-item exit would drop the caret back into the item instead of the
 * blank line. Blank blocks carry no source at all, so their span is the only
 * measure of how many blank boxes they must render — `2\n\n\n` consecutive
 * blank lines collapsing into one invisible box made repeated Enters change
 * the source with no visible effect.
 */
export function buildBlockView(
  raw: string,
  blockStart: number,
  revealAt: number[],
  lineCount?: number,
): BlockView {
  const reveals = revealAt.map((r) => r - blockStart)
  const revealInBlock = reveals.length > 0
  const lines: ViewLine[] = []
  let base = 0
  let inFence = false

  const rawLines = raw === '' ? [] : raw.split('\n')
  const total = Math.max(rawLines.length, lineCount ?? (rawLines.length || 1))
  for (let li = 0; li < total; li++) {
    const line = li < rawLines.length ? rawLines[li] : ''
    const local = reveals.filter((r) => r >= base && r <= base + line.length)
    const fenceLine = /^\s*(`{3,}|~{3,})/.test(line)
    lines.push(
      buildLine(line, local.length ? local[0] - base : null, base, {
        revealInBlock,
        inCode: inFence && !fenceLine,
      }),
    )
    if (fenceLine) inFence = !inFence
    base += line.length + 1
  }
  return { lines }
}
