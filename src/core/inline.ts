/**
 * Per-line render-state computation.
 *
 * The editor renders **one source line as exactly one line box**. Block syntax
 * (list bullets, quote markers, fences) is stripped from the line's start and
 * expressed through styling instead of wrapping elements, because a wrapper
 * element with padding or margins would make a rendered line taller than its
 * source line — and any such difference accumulates into vertical drift between
 * the caret and the text.
 */

export interface LineParts {
  /** Leading block markup: list bullet, quote marker, task checkbox. */
  prefix: string
  /** True when the line opens or closes a fenced code block. */
  isFence: boolean
  /** The fence character (`` ` `` or `~`) when `isFence`. */
  fenceMarker?: string
  /** True for a horizontal rule line. */
  isRule: boolean
  /** True for a table delimiter row (`| --- |`). */
  isTableDelimiter: boolean
  /** True when the line looks like a table row. */
  isTableRow: boolean
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/
const HEADING_RE = /^(\s{0,3})(#{1,6})(\s+)(.*)$/
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

/**
 * Three or more `-`, `*` or `_` alone on a line: a thematic break.
 *
 * Exported because this rule has to be the SAME wherever it is asked, and three
 * modules were carrying their own copy of the regex: the outline (is the line
 * under this paragraph a `---` heading underline, or a rule?), the view's
 * block-prefix scan (a rule is content, not a prefix), and this one.
 */
export function isThematicBreak(raw: string): boolean {
  return RULE_RE.test(raw)
}
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/
const TASK_RE = /^(\[[ xX]\])(\s+)(.*)$/
const QUOTE_RE = /^(\s*)(>+)(\s?)(.*)$/
/**
 * True when a line is a table ROW — `| a | b |`.
 *
 * Two pipes minimum, because a single pipe has no cell between them and the line
 * would render as a row with nothing in it. It used to accept any line that
 * merely ENDED in a pipe (`a | b |`), which made an ordinary paragraph a "table
 * row": the line kind said `table` while the view drew it as plain text, and
 * `computeLineStates` treats a table row as un-splittable, so Enter on that
 * paragraph was a silent no-op. One predicate now, and `view.ts` imports it
 * instead of keeping the near-copy that had already drifted from this one.
 */
export function isTableRow(raw: string): boolean {
  const t = raw.trim()
  return t.startsWith('|') && (t.match(/\|/g)?.length ?? 0) >= 2
}

/** One cell of a GFM delimiter row: `---`, `:--`, `--:`, `:-:`. */
const TABLE_DELIM_CELL_RE = /^:?-+:?$/

/**
 * True when a line IS a table's `| --- | --- |` rule row.
 *
 * GFM spells a delimiter cell `:?-+:?`, so **the dash is not optional**. The
 * regex this replaces (`/^\|?[\s:|-]+\|[\s:|-]*$/`) accepted any run of pipes,
 * spaces and colons — which includes the empty data row the toolbar's own
 * skeleton inserts, `|  |  |`. That row was therefore classified as the rule row
 * and rendered as one: a zero-height line with no cells in it, unreachable by the
 * caret, where the first character typed (landing after the trailing pipe) was
 * dropped rather than drawn (`.scratch/table-ops/issues/01`).
 */
export function isTableDelimiterRow(raw: string): boolean {
  if (!isTableRow(raw)) return false
  const cells = raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.length > 0 && cells.every((cell) => TABLE_DELIM_CELL_RE.test(cell.trim()))
}

/** Splits a raw line into its block markup and its content. */
export function parseLine(raw: string): LineParts {
  const isRow = isTableRow(raw)
  const parts: LineParts = {
    prefix: '',
    isFence: false,
    isRule: isThematicBreak(raw),
    isTableDelimiter: false,
    isTableRow: isRow,
  }

  if (parts.isRule) return parts

  const fence = FENCE_RE.exec(raw)
  if (fence) {
    parts.isFence = true
    parts.fenceMarker = fence[2][0]
    parts.prefix = fence[1] + fence[2] + fence[3]
    return parts
  }

  parts.isTableDelimiter = isRow && isTableDelimiterRow(raw)

  let rest = raw
  let prefix = ''

  // Quotes nest, then lists, then task boxes.
  for (;;) {
    const quote = QUOTE_RE.exec(rest)
    if (quote && !LIST_RE.test(rest)) {
      prefix += quote[1] + quote[2] + quote[3]
      rest = quote[4]
      continue
    }
    const list = LIST_RE.exec(rest)
    if (list) {
      prefix += list[1] + list[2] + list[3]
      rest = list[4]
      continue
    }
    const task = TASK_RE.exec(rest)
    if (task) {
      prefix += task[1] + task[2]
      rest = task[3]
      continue
    }
    break
  }

  parts.prefix = prefix
  return parts
}

/**
 * A footnote definition line: `[^label]: …`, with up to three leading spaces.
 *
 * A definition is more than one line, and both halves of that grammar live here.
 * Three modules in this layer need the same answer, and a private copy each is how
 * they would drift: `markdown.ts` claims the definition's lines as source slots
 * (markdown-it-footnote eats them at block time, so without that they would be
 * invisible and uneditable), `computeLineStates` gives them a line kind, and
 * `view.ts` treats the `[^label]: ` as the line's block prefix rather than as an
 * inline reference. The mismatch this prevents is not cosmetic: if the span walk
 * and the line kind disagreed, a note would be styled as one thing and addressed
 * as another.
 */
export const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]]+)\]:/

/**
 * Math delimiters this editor recognises, one shared source of truth.
 *
 * `view.ts` (the run scanner) and `editCommands.ts` (⌃M, clearFormat) both
 * need the same rules; two private copies would drift. The dollar rule is
 * Pandoc verbatim (`internals.md` §3): no whitespace after the opener, `\$`
 * inside, the closer may not follow a space or a backslash, no digit after
 * the closer. `$…$` content can never contain a raw `$`, so `$$…$$` display
 * math never matches — it stays literal (out of scope).
 */
export const DOLLAR_MATH_RE = /^\$(?!\s)((?:\\\$|[^$])*?[^\\\s])\$(?!\d)/
export const PAREN_MATH_RE = /^\\\((?!\s)((?:(?!\\\))[\s\S])*?[^\\\s])\\\)/
export const BRACKET_MATH_RE = /^\\\[(?!\s)((?:(?!\\\])[\s\S])*?[^\\\s])\\\]/

/**
 * The three math forms as one table: scanner, opener/closer and their widths.
 * The run scanner (view.ts), the ⌃M toggle and clearFormat all walk this same
 * table, so "what counts as math" can never disagree between them.
 */
export const MATH_FORMS: Array<{
  re: RegExp
  openLen: number
  closeLen: number
}> = [
  { re: DOLLAR_MATH_RE, openLen: 1, closeLen: 1 },
  { re: PAREN_MATH_RE, openLen: 2, closeLen: 2 },
  { re: BRACKET_MATH_RE, openLen: 2, closeLen: 2 },
]

/** Finds one math construct anywhere in `text`; returns the content and where
 * its delimiters sit, for the commands that add or remove them. */
export function findMathAt(text: string, from = 0):
  | { openStart: number; openEnd: number; closeStart: number; closeEnd: number; inner: string }
  | null {
  for (let i = from; i < text.length; i++) {
    const rest = text.slice(i)
    for (const form of MATH_FORMS) {
      const m = form.re.exec(rest)
      if (!m) continue
      const closeStart = i + m[0].length - form.closeLen
      return {
        openStart: i,
        openEnd: i + form.openLen,
        closeStart,
        closeEnd: closeStart + form.closeLen,
        inner: m[1],
      }
    }
  }
  return null
}

/**
 * A line indented onto the definition above it — the rest of the note.
 *
 * `markdown-it-footnote` ends a definition at the first line that is not indented
 * onto it, so this single test is what both the span walk in `markdown.ts` and the
 * line-kind pass below have to agree on.
 */
export const FOOTNOTE_CONTINUATION = /^\s+\S/

export interface LineState {
  kind:
    | 'blank'
    | 'text'
    | 'heading'
    | 'rule'
    | 'fence'
    | 'code'
    | 'quote'
    | 'list'
    | 'task'
    | 'table'
    | 'table-delim'
    | 'footnote'
  /** Heading depth (1-6) for `kind === 'heading'`, so the six levels can differ. */
  level?: number
  /**
   * Nesting depth (0-based) of a list item, derived from the indent stack. The
   * rendered numbering is per level, so a nested list restarts at 1 and the outer
   * list carries on after it.
   */
  listLevel?: number
  /** Ordered or unordered, for list markers. */
  ordered: boolean
  checked: boolean | null
  /** Source indentation (in characters) of a list line, for nesting. */
  indent: number
  /**
   * The label of a `kind === 'footnote'` line's definition, for its first line
   * only.
   *
   * The source's own `[^1]: ` collapses as that line's block prefix, so `[1]` has
   * to be DRAWN — and a continuation line must not draw a second marker, which is
   * why this is present on the first line and absent on the rest.
   */
  footnoteLabel?: string
}

/**
 * Computes the render state of every source line.
 *
 * Fence state spans lines, so this must run over the whole document in order
 * rather than line by line. Each state maps to exactly one line box.
 */
export function computeLineStates(lines: string[]): LineState[] {
  const states: LineState[] = []
  /** Indent stack of the list we are inside, for `listLevel`. */
  const indents: number[] = []
  /**
   * The fence character of the open fence, or null. Tracking WHICH marker opened
   * it matters: ```inside a ~~~ block is code content, not a closer (CommonMark),
   * and the view must agree with the outline about that.
   */
  let openFence: string | null = null
  /** True while the current line is inside a footnote definition's span. */
  let inFootnote = false
  /** True while a blockquote is open, including its lazy continuations. */
  let openQuote = false

  for (const raw of lines) {
    const parts = parseLine(raw)
    const base: LineState = {
      kind: 'text',
      ordered: false,
      checked: null,
      indent: 0,
    }

    if (openFence !== null) {
      if (parts.fenceMarker === openFence) {
        openFence = null
        states.push({ ...base, kind: 'fence' })
        continue
      }
      states.push({ ...base, kind: 'code' })
      continue
    }

    if (parts.isFence) {
      openFence = parts.fenceMarker ?? null
      states.push({ ...base, kind: 'fence' })
      continue
    }

    if (raw.trim() === '') {
      inFootnote = false
      openQuote = false
      states.push({ ...base, kind: 'blank' })
      continue
    }

    const quoted = /^\s*>/.test(raw)
    // CommonMark lets a blockquote's content continue onto a line with no `>` of
    // its own, and a line-local scan cannot see the container it is continuing.
    // It matters for exactly one rule here: a definition MAY interrupt a paragraph
    // or a list, but NOT a lazily continued blockquote — measured, `> 引用里` then
    // an un-prefixed `[^1]: …` exports as ONE quoted paragraph, text and all.
    const lazyQuote = openQuote && !quoted
    if (quoted) openQuote = true

    // A definition and its indented continuations are one note. markdown-it stops
    // the definition at the first line that is not indented onto it, so the same
    // test decides the end here (`markdown.ts` claims the identical span).
    const definition = lazyQuote ? null : FOOTNOTE_DEFINITION.exec(raw)
    if (definition) {
      inFootnote = true
      states.push({ ...base, kind: 'footnote', footnoteLabel: definition[1] })
      continue
    }
    if (inFootnote && FOOTNOTE_CONTINUATION.test(raw)) {
      states.push({ ...base, kind: 'footnote' })
      continue
    }
    inFootnote = false

    if (parts.isRule) {
      states.push({ ...base, kind: 'rule' })
      continue
    }

    if (parts.isTableDelimiter) {
      states.push({ ...base, kind: 'table-delim' })
      continue
    }

    const heading = HEADING_RE.exec(raw)
    if (heading) {
      states.push({ ...base, kind: 'heading', level: heading[2].length })
      continue
    }

    if (parts.isTableRow) {
      states.push({ ...base, kind: 'table' })
      continue
    }

    const listMatch = LIST_RE.exec(stripQuotePrefix(raw))
    const taskMatch = TASK_RE.exec(stripListPrefix(listMatch?.[4] ?? raw))
    if (listMatch || taskMatch) {
      const isTask = !!taskMatch
      const marker = listMatch?.[2] ?? ''
      // Source indentation in characters — drives the rendered nesting offset
      // once the list prefix collapses, and the nesting level below.
      const indent = (listMatch?.[1] ?? '').length
      while (indents.length > 0 && indents[indents.length - 1] > indent) indents.pop()
      if (indents.length === 0 || indents[indents.length - 1] < indent) indents.push(indent)
      states.push({
        ...base,
        kind: isTask ? 'task' : 'list',
        ordered: /\d/.test(marker),
        checked: isTask ? /[xX]/.test(taskMatch![1]) : null,
        indent,
        listLevel: indents.length - 1,
      })
      continue
    }
    indents.length = 0

    if (/^\s*>/.test(raw)) {
      states.push({ ...base, kind: 'quote' })
      continue
    }

    states.push({ ...base })
  }

  return states
}

function stripQuotePrefix(raw: string): string {
  return raw.replace(/^\s*(?:>\s?)+/, '')
}

function stripListPrefix(raw: string): string {
  const m = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(raw)
  return m ? raw.slice(m[0].length) : raw
}

/**
 * Removes inline markdown syntax, returning the visible text.
 *
 * Used to map a caret position measured against rendered content back to a
 * source offset: the caret's plain-text index is compared against this string
 * and the corresponding index in the raw source is returned.
 */
export function stripInline(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)

    const image = /^!\[([^\]]*)\]\([^)]*\)/.exec(rest)
    if (image) {
      out += image[1]
      i += image[0].length
      continue
    }
    const link = /^\[([^\]]*)\]\([^)]*\)/.exec(rest)
    if (link) {
      out += link[1]
      i += link[0].length
      continue
    }
    const math = DOLLAR_MATH_RE.exec(rest)
    if (math) {
      out += math[1]
      i += math[0].length
      continue
    }
    const code = /^(`+)([\s\S]*?)\1/.exec(rest)
    if (code) {
      out += code[2]
      i += code[0].length
      continue
    }
    const strong = /^(\*\*|__)([\s\S]*?)\1/.exec(rest)
    if (strong) {
      out += stripInline(strong[2])
      i += strong[0].length
      continue
    }
    const strike = /^(~~)([\s\S]*?)\1/.exec(rest)
    if (strike) {
      out += stripInline(strike[2])
      i += strike[0].length
      continue
    }
    const em = /^(\*|_)(?!\s)([\s\S]*?)\1/.exec(rest)
    if (em) {
      out += stripInline(em[2])
      i += em[0].length
      continue
    }
    const html = /^<[^>]+>/.exec(rest)
    if (html) {
      i += html[0].length
      continue
    }

    out += text[i]
    i++
  }
  return out
}

/**
 * Index in `raw` corresponding to index `visible` in `stripInline(raw)`.
 * Clamps to the raw line when the visible index runs past its end.
 */
export function visibleToSourceIndex(raw: string, visible: number): number {
  let out = 0
  let i = 0
  while (i < raw.length && out < visible) {
    const rest = raw.slice(i)
    const skip = /^(?:!\[([^\]]*)\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)|(`+)([\s\S]*?)\3|(\*\*|__)([\s\S]*?)\5|(~~)([\s\S]*?)\7|(\*|_)(?!\s)([\s\S]*?)\9|<[^>]+>)/.exec(rest)
    if (skip) {
      const visibleText = stripInline(skip[0])
      if (out + visibleText.length > visible) {
        // The caret sits inside this construct: map linearly within it.
        const into = visible - out
        return i + Math.max(0, Math.min(into, skip[0].length))
      }
      out += visibleText.length
      i += skip[0].length
      continue
    }
    out++
    i++
  }
  return Math.min(i, raw.length)
}

