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

import { FOOTNOTE_DEFINITION, isThematicBreak } from './inline'
import { readImageSize } from './imageSize'
import { isBlankLine } from './lines'
import { exportableHref, md } from './markdownIt'

interface MarkerCell {
  /** Source range of the opening marker, e.g. the `**` of `**bold**`. */
  openStart: number
  openEnd: number
  /** Source range of the closing marker. */
  closeStart: number
  closeEnd: number
}

/**
 * A collapsed image: the run is rendered as an `<img>` instead of its source
 * text. The source text stays in the DOM (hidden) so a document absorbed from the
 * DOM keeps the picture.
 */
export interface ImageMark {
  src: string
  alt: string
  /** Width in pixels, from the `{width=…}` suffix; absent when the image is unsized. */
  width?: string
}

interface Mark {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  link?: string
  /**
   * A footnote reference. The run is the LABEL (`1` of `[^1]`); its brackets are
   * drawn by CSS, because the source's own `[^` and `]` collapse as markers.
   */
  footnoteRef?: string
  img?: ImageMark
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
  /** True when the PREVIOUS line ended in a soft break (a paragraph continuation). */
  continues?: boolean
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
  kind: 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'image' | 'footnoteRef'
  start: number
  end: number
  innerStart: number
  innerEnd: number
  url?: string
  /** Image alt text, for a `kind: 'image'` token. */
  alt?: string
  /** Image width in pixels, from the `{width=…}` suffix. */
  width?: string
  /** Footnote label, for a `kind: 'footnoteRef'` token. */
  label?: string
}

const PAIRED: Array<{ kind: Token['kind']; re: RegExp }> = [
  { kind: 'bold', re: /^(\*\*|__)([\s\S]*?)\1/ },
  { kind: 'strike', re: /^(~~)([\s\S]*?)\1/ },
  { kind: 'code', re: /^(`+)([\s\S]*?)\1/ },
  { kind: 'italic', re: /^(\*|_)(?!\s)([\s\S]*?)\1/ },
]

/**
 * Finds every inline construct in one line of source.
 *
 * Two scanners, and the order is the point: the syntax scan below claims what it
 * recognises, and autolinks are then matched only in the text it did NOT claim.
 * See `withAutolinks` for why that division is markdown-it's own rule rather than
 * a convenience.
 */
function findTokens(text: string): Token[] {
  return withAutolinks(text, findSyntaxTokens(text))
}

/**
 * Finds the inline syntax this editor recognises in one line of source.
 *
 * A linear scan with balanced-pair matching, so nesting resolves into separate
 * non-overlapping tokens.
 */
function findSyntaxTokens(text: string): Token[] {
  const tokens: Token[] = []
  // A definition's `[^label]: ` is the LINE's block prefix (see
  // `blockPrefixRange`), not an inline reference, so the scan starts after it.
  // Without this the label inside it would be claimed twice and each collapsed
  // character would become its own marker run.
  let i = FOOTNOTE_DEFINITION.exec(text)?.[0].length ?? 0

  while (i < text.length) {
    const rest = text.slice(i)

    const image = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(rest)
    if (image) {
      // The size suffix is part of the picture, not text beside it: the editor
      // draws one <img> for the whole thing, and the export has to read the same
      // suffix (`core/imageSize.ts`).
      const size = readImageSize(rest.slice(image[0].length))
      const length = image[0].length + (size?.suffixLength ?? 0)
      tokens.push({
        kind: 'image',
        start: i,
        end: i + length,
        innerStart: i + 2,
        innerEnd: i + 2 + image[1].length,
        url: image[2],
        alt: image[1],
        width: size?.width,
      })
      i += length
      continue
    }

    const footnoteRef = /^\[\^([^\]]+)\]/.exec(rest)
    if (footnoteRef) {
      tokens.push({
        kind: 'footnoteRef',
        start: i,
        end: i + footnoteRef[0].length,
        innerStart: i + 2,
        innerEnd: i + 2 + footnoteRef[1].length,
        label: footnoteRef[1],
      })
      i += footnoteRef[0].length
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

/* -------------------------------------------------------------------------- */
/* autolinks                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Bare URLs are links in the exported HTML but were plain text here — the same
 * document with two truths, and the one the user cannot see is the one that
 * rewrites what they typed (`www.x.dev` gains `http://`, an address becomes a
 * `mailto:`).
 *
 * The recogniser is linkify-it — the very instance markdown-it exports through,
 * reached as `md.linkify`. Not a URL regex of our own: a second opinion about
 * where a URL ends would diverge from the export, which is the bug being fixed.
 * Where markdown-it *applies* that recogniser is reproduced below, and it is two
 * passes, not one — see `autolinksIn`.
 */

/** How far markdown-it's inline rule scans back for a scheme when it meets a `://`. */
const MAX_SCHEME_LENGTH = 10

/** RFC3986: `scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`. */
function isAsciiAlpha(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
}

function isSchemeChar(code: number): boolean {
  return (
    isAsciiAlpha(code) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b /* + */ ||
    code === 0x2d /* - */ ||
    code === 0x2e /* . */
  )
}

/** A half-open `[start, end)` range of offsets. */
interface SourceRange {
  start: number
  end: number
}

/** An autolink found in a run of plain text, as offsets into it. */
interface Autolink extends SourceRange {
  /** The href linkify-it means, before normalization (`www.x.dev` → `http://www.x.dev`). */
  url: string
}

/** What linkify-it hands back for one match. */
type LinkifyMatch = NonNullable<ReturnType<typeof md.linkify.matchAtStart>>

/** A linkify-it match as an `Autolink`, `offset` being where its text starts. */
function toAutolink(match: LinkifyMatch, offset: number): Autolink {
  return { start: offset + match.index, end: offset + match.lastIndex, url: match.url }
}

/**
 * The autolinks linkify-it finds in one run of plain text.
 *
 * markdown-it finds them in TWO passes, and following the pair is what keeps the
 * common cases identical to the export:
 *
 * 1. its inline rule fires at a literal `://`, scans BACKWARDS for the scheme
 *    (at most ten characters, and it must start with a letter) and then asks
 *    `matchAtStart`. Anchoring at the scheme is what lets a URL sit flush against
 *    a CJK character: as measured, `linkify.match('网址是https://example.com。')`
 *    finds NOTHING — `是` is not the word boundary `match()` insists on — while
 *    markdown-it exports that very URL as a link. A single `match()` over the run
 *    would therefore miss the case this editor sees most.
 * 2. its core rule then asks `match()` on the text those matches did not claim.
 *    That is where `www.example.net`, a bare `example.com` and `user@example.com`
 *    come from: none of them has a scheme to anchor on.
 */
function autolinksIn(text: string): Autolink[] {
  // Pass 1: anchored at every `://`.
  const anchored: Autolink[] = []
  for (let colon = text.indexOf('://'); colon !== -1; colon = text.indexOf('://', colon + 3)) {
    const floor = Math.max(0, colon - MAX_SCHEME_LENGTH)
    let schemeStart = colon
    while (schemeStart > floor && isSchemeChar(text.charCodeAt(schemeStart - 1))) schemeStart--
    if (schemeStart === colon || !isAsciiAlpha(text.charCodeAt(schemeStart))) continue
    // The engine decides where the URL ENDS, which is the decision worth
    // delegating: `https://example.` at the end of a line stops at `example` and
    // leaves the dot outside, exactly as the export does.
    const link = md.linkify.matchAtStart(text.slice(schemeStart))
    // markdown-it's own guard against a "match" that consumed no more than the
    // scheme it was anchored on.
    if (!link || link.url.length <= colon - schemeStart) continue

    // markdown-it then strips trailing `*` — the one special case it makes for
    // emphasis, so a `**bold**` wrapper's closing marker cannot be swallowed.
    // linkify-it has no such rule (`matchAtStart('https://x.dev/a*')` keeps the
    // star), so without this the view links a URL the export does not have.
    const autolink = toAutolink(link, schemeStart)
    while (autolink.url.endsWith('*') && autolink.end > autolink.start) {
      autolink.url = autolink.url.slice(0, -1)
      autolink.end--
    }
    if (autolink.end <= autolink.start) continue
    anchored.push(autolink)
  }

  // Two `://` inside one URL (`https://x.dev/a://b`): the parser reaches the first
  // one first and consumes through the whole URL, so the earlier match owns the
  // span and a later one that starts inside it is dropped.
  const owned: Autolink[] = []
  for (const link of [...anchored].sort((a, b) => a.start - b.start)) {
    const previous = owned[owned.length - 1]
    if (!previous || link.start >= previous.end) owned.push(link)
  }

  // Pass 2: `match()` over the stretches pass 1 did not own. The gaps are built
  // first so the tail is just the last one — no separate call for it, and an empty
  // gap costs nothing (`match('')` is null).
  const gaps: SourceRange[] = []
  let cursor = 0
  for (const link of owned) {
    gaps.push({ start: cursor, end: link.start })
    cursor = link.end
  }
  gaps.push({ start: cursor, end: text.length })

  const found = [...owned]
  for (const gap of gaps) {
    for (const match of md.linkify.match(text.slice(gap.start, gap.end)) ?? []) {
      found.push(toAutolink(match, gap.start))
    }
  }

  return found.sort((a, b) => a.start - b.start)
}

/**
 * The runs of PLAIN TEXT between the syntax tokens — the text markdown-it's CORE
 * linkify rule visits.
 *
 * That rule walks `text` tokens and skips everything else: a code span, an
 * existing link's own text and an image's alt are not text tokens, so nothing
 * inside them becomes a link, while emphasis does hold text and does. These gaps
 * are that same set, which is why the traps need no special cases — a code span's
 * inside is never a region, and a link's destination sits between an
 * already-claimed token's `innerEnd` and `end`.
 *
 * It is NOT the whole of markdown-it's rule, and the difference was measured
 * rather than assumed. markdown-it has an EARLIER inline pass that fires at a
 * `://` and hands `matchAtStart` everything from the scheme to the END OF THE
 * BLOCK — inline structure included. Bounding that pass to a gap is a deliberate
 * choice, and it leaves shapes where the two renderings still differ. Every one
 * of them is an export-side defect (`autolinks/02` has the mechanisms):
 *
 * ```
 * source                 view                 export
 * ~~example.com~~        link                 no link — pretest false negative
 * \https://x.dev         link                 no link — back-scan window
 * https://x.dev`c`       link + a code span   one link containing c
 * https://x.dev/a**b**   link + bold b        one link containing a**b
 * ```
 *
 * Chasing those four means importing warts into the editor: a code span that
 * stops rendering as code, an href the user cannot read back
 * (`https://x.dev%60c%60`), and link text that is neither what was typed nor
 * valid Markdown. The editor stays structure-first. The one export rule that is
 * deliberate — markdown-it's trailing-`*` trim — IS reproduced, in `autolinksIn`.
 */
function textRegions(from: number, to: number, tokens: readonly Token[]): SourceRange[] {
  const regions: SourceRange[] = []
  const inside = tokens
    .filter((token) => token.start >= from && token.end <= to)
    .sort((a, b) => a.start - b.start)

  let cursor = from
  for (const token of inside) {
    if (token.end <= cursor) continue
    if (token.start > cursor) regions.push({ start: cursor, end: token.start })
    // Emphasis holds text, so a URL inside one is a link; the other constructs
    // hold literal or already-structured content and are left alone.
    if (token.kind === 'bold' || token.kind === 'italic' || token.kind === 'strike') {
      regions.push(...textRegions(token.innerStart, token.innerEnd, inside))
    }
    cursor = token.end
  }
  if (cursor < to) regions.push({ start: cursor, end: to })
  return regions
}

/**
 * Adds an autolink token for every URL the syntax scan left in plain text.
 *
 * The token's inner range IS its whole range: an autolink has no markers, so
 * `buildInlineLine` collapses nothing and the run comes out carrying the href and
 * nothing else — the same shape a `[文字](url)` link produces, minus the syntax
 * that a link has and an autolink does not.
 */
function withAutolinks(text: string, syntax: Token[]): Token[] {
  const links: Token[] = []

  for (const region of textRegions(0, text.length, syntax)) {
    for (const found of autolinksIn(text.slice(region.start, region.end))) {
      // markdown-it skips a link it will not export, so the view must not show one
      // either: a link here that the export refuses would be the same two-truths
      // bug in the other direction.
      const url = exportableHref(found.url)
      if (url === null) continue
      const start = region.start + found.start
      const end = region.start + found.end
      links.push({ kind: 'link', start, end, innerStart: start, innerEnd: end, url })
    }
  }

  return [...syntax, ...links].sort((a, b) => a.start - b.start)
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
  if (isThematicBreak(raw)) return null

  // A footnote definition's `[^1]: ` is a block prefix in exactly the way a bullet
  // is: collapsed while the caret is outside the block, revealed as dim source
  // while it is inside. What is left is the note's text, and the `[1]` marker is
  // drawn by the renderer — from `LineState.footnoteLabel`, so that "which label is
  // this" has exactly one answer on a line. A view cannot supply it: the label
  // belongs to the line KIND, and a `[^1]: ` inside a code fence is not a
  // definition at all.
  const definition = FOOTNOTE_DEFINITION.exec(raw)
  if (definition) {
    const after = raw.slice(definition[0].length)
    const separator = /^[ \t]*/.exec(after)![0].length
    return { start: 0, end: definition[0].length + separator }
  }

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
  // A whitespace-only line is BLANK to Markdown, but its characters are the
  // user's source. The parser keeps them in the block's raw now, so the view has
  // to carry them too — otherwise the renderer would have to reach into
  // `block.raw` to find them and the view would stop being the DOM's only truth.
  // HOW they are carried matters: they must occupy no space at all, which is what
  // a collapsed run does. Inside a fence the spaces are laid-out columns the
  // caret has to be able to sit on, so code content keeps the normal path.
  if (!opts.inCode && isBlankLine(raw)) return blankLine(raw, sourceStart)
  if (isTableRow(raw)) return buildTableLine(raw, revealFrom, sourceStart, opts)
  return buildInlineLine(raw, revealFrom, sourceStart, opts)
}

/**
 * A blank line's view: source kept, no visible cell.
 *
 * A truly empty line stays exactly as it was (`runs: []`); a line of spaces or
 * tabs reports them as ONE COLLAPSED run. Collapsed because an "empty" line has
 * to keep looking empty, and because it is what makes the caret rules agree with
 * `.scratch/enter-backspace-smoke/issues/09`: such a line has a single caret
 * position (its start) whether or not it holds invisible characters.
 */
function blankLine(raw: string, sourceStart = 0): ViewLine {
  const line = emptyLine(raw.length, sourceStart)
  if (raw === '') return line
  return {
    ...line,
    runs: [{ text: raw, src: sourceStart, mark: {}, marker: true }],
  }
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
  /** Collapsed images: their whole range becomes one run that renders as a picture. */
  const renderedImages = new Map<number, Token>()
  for (const token of tokens) {
    if (visibleMarker.has(token.start)) continue
    if (token.kind === 'image') {
      // Nothing about it is hidden as syntax — the run replaced by an <img>
      // covers the entire construct, markers included.
      renderedImages.set(token.start, token)
      continue
    }
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
    if (raw.trim() !== '' && isThematicBreak(raw)) {
      blockMarker = { start: 0, end: raw.length }
    } else {
      blockMarker = blockPrefixRange(raw)
      // A soft-continuation line's leading whitespace is container indentation,
      // not content — it must not land in the middle of a line that now flows on
      // from the previous one. Collapsed like any other prefix, so the source
      // still comes back out of the DOM.
      if (blockMarker === null && opts.continues === true) {
        const indent = /^\s+/.exec(raw)?.[0]
        if (indent) blockMarker = { start: 0, end: indent.length }
      }
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
    const picture = renderedImages.get(i)
    if (picture) {
      // One run for the whole `![alt](url)`: the DOM renders an <img>, and the
      // source text travels along inside it (hidden) so the document can be
      // rebuilt from the DOM without losing the picture.
      const text = raw.slice(picture.start, picture.end)
      for (let k = picture.start; k < picture.end; k++) {
        sourceToVisible[k] = visibleToSource.length
        visibleToSource.push(k)
      }
      runs.push({
        text,
        src: sourceStart + picture.start,
        mark: {
          img: {
            src: picture.url ?? '',
            alt: picture.alt ?? '',
            ...(picture.width ? { width: picture.width } : {}),
          },
        },
        marker: false,
      })
      i = picture.end
      continue
    }
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
      mark: markFor(tokens, i, end, visibleMarker),
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

function markFor(tokens: Token[], start: number, end: number, visibleMarker: Set<number>): Mark {
  const mark: Mark = {}
  for (const token of tokens) {
    if (token.innerStart <= start && token.innerEnd >= end) {
      if (token.kind === 'bold') mark.bold = true
      else if (token.kind === 'italic') mark.italic = true
      else if (token.kind === 'strike') mark.strike = true
      else if (token.kind === 'code') mark.code = true
      else if (token.kind === 'link') mark.link = token.url
      else if (token.kind === 'footnoteRef') {
        // The `[1]` is DRAWN from this mark, so it has to be withdrawn while the
        // construct is open for editing — the source is showing then, and the two
        // together read as `[^[1]]`. A block marker is withdrawn the same way, by
        // the `:not(.revealed)` gate on its CSS.
        if (!visibleMarker.has(token.start)) mark.footnoteRef = token.label
      }
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
  softBreakAfter: number[] = [],
): BlockView {
  const softBreaks = new Set(softBreakAfter)
  const reveals = revealAt.map((r) => r - blockStart)
  const revealInBlock = reveals.length > 0
  const lines: ViewLine[] = []
  let base = 0
  // Only a fence with the SAME marker character closes the open one, so ``` inside
  // a ~~~ block is code content (this must match `computeLineStates`).
  let openFence: string | null = null

  const rawLines = raw === '' ? [] : raw.split('\n')
  const total = Math.max(rawLines.length, lineCount ?? (rawLines.length || 1))
  for (let li = 0; li < total; li++) {
    const line = li < rawLines.length ? rawLines[li] : ''
    const local = reveals.filter((r) => r >= base && r <= base + line.length)
    const fenceMarker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1][0] ?? null
    const closes = fenceMarker !== null && fenceMarker === openFence
    const inCode = openFence !== null && !closes
    lines.push(
      buildLine(line, local.length ? local[0] - base : null, base, {
        revealInBlock,
        inCode,
        continues: softBreaks.has(li - 1),
      }),
    )
    // A matching marker closes the open fence; with nothing open, this line opens one.
    if (closes) openFence = null
    else if (openFence === null && fenceMarker !== null) openFence = fenceMarker
    base += line.length + 1
  }
  return { lines }
}
