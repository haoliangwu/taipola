/**
 * List editing helpers: numbering and indentation.
 *
 * These are pure functions of the Markdown source, so they are testable without
 * a browser. The kernel calls them after structural edits (Enter, Tab, Shift+Tab).
 */

export interface ListItem {
  /** Line index, 0-based. */
  line: number
  /** Leading whitespace of the line. */
  indent: string
  /** Marker plus its trailing spaces, e.g. `- `, `1. `, `- [x] `. */
  marker: string
  /** Rest of the line after the marker. */
  body: string
}

const ITEM_RE = /^(\s*)((?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?\s+)(.*)$/
const FENCE_RE = /^\s*(?:`{3,}|~{3,})/

/** Parses one line as a list item, or returns null. */
export function parseListItem(line: string, index = 0): ListItem | null {
  const match = ITEM_RE.exec(line)
  if (!match) return null
  return { line: index, indent: match[1], marker: match[2], body: match[3] }
}

/**
 * Renumbers every ordered list in the document.
 *
 * Each indentation level is its own sequence and starts at 1, which is also what
 * the rendered state shows (a CSS counter per block that counts from 1) — so the
 * source and the picture agree. A blank line, a code fence, or any line that is
 * not a list item ends the current lists; returning to a shallower indent drops
 * the deeper sequences, so a nested list under the next parent starts at 1 again.
 *
 * `5.` in the source is normalized to `1.`. That is deliberate: the rendered
 * counter could not honour a start number anyway, so keeping one in the source
 * would only make the two states disagree.
 */
export function renumberLists(text: string): string {
  const lines = text.split('\n')
  const counters = new Map<string, number>()
  let inFence = false

  const out = lines.map((line, index) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      counters.clear()
      return line
    }
    if (inFence) return line

    const item = parseListItem(line, index)
    if (!item) {
      counters.clear()
      return line
    }
    // Drop sequences deeper than this line: we have left them.
    for (const key of [...counters.keys()]) {
      if (key.length > item.indent.length) counters.delete(key)
    }
    if (!/\d/.test(item.marker)) return line

    const next = (counters.get(item.indent) ?? 0) + 1
    counters.set(item.indent, next)
    const delimiter = item.marker.match(/[.)]/)?.[0] ?? '.'
    return `${item.indent}${next}${delimiter} ${item.body}`
  })

  return out.join('\n')
}

/** Width of a line's leading whitespace, in characters. */
function leadingSpaces(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0
}

/**
 * The last line that belongs to `item`.
 *
 * An item is a SPAN, not a line: a nested list, the continuation lines of a
 * multi-line item and a fenced block inside it all live on the lines below, and
 * whatever moved the item has to move them too. Rewriting only the item's own
 * line left them behind, so they were re-parented to the item above — the
 * structure the user was trying to preserve, turned inside out.
 *
 * The rule is deliberately line-level: this module is a pure function of the
 * source (`parseListItem` is a regex) and does not read the parser. A line
 * belongs to the item when it is indented DEEPER than the item's own indent — the
 * same rule Markdown uses for a nested block. A blank line belongs to the item
 * only when an indented line follows it (a loose list item), and it is never
 * included at the end of the span, where it is just the gap to the next block.
 *
 * Where the line-level rule and markdown-it's `list_item` span can part ways is
 * written down, with the measurements, in
 * `.scratch/list-indent/issues/01-indent-does-not-carry-nested-items.md`: they
 * agree on every indented shape (including a fence whose body is indented with
 * it), and a line that is only inside the item through Markdown's LAZY
 * continuation — flush left, no blank line above — is not part of the span, since
 * seeing it would mean re-implementing the parser here.
 */
function lastLineOfItem(lines: string[], item: ListItem): number {
  let end = item.line
  for (let i = item.line + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (leadingSpaces(lines[i]) <= item.indent.length) break
    end = i
  }
  return end
}

/** Moves a line `delta` columns in (positive) or out (negative). */
function shiftLine(line: string, delta: number): string {
  if (delta >= 0) return ' '.repeat(delta) + line
  // Never remove more than the line actually has: the rest of the span is at
  // least as deep as the item, but a clamped line keeps its text intact.
  return line.slice(Math.min(-delta, leadingSpaces(line)))
}

export interface IndentResult {
  /** The new document source. */
  doc: string
  /** Caret offset in the new document (the same content position). */
  caret: number
}

/** The line holding `offset`, its `ListItem`, and where that line starts. */
function locate(doc: string, offset: number) {
  const lines = doc.split('\n')
  let start = 0
  for (let i = 0; i < lines.length; i++) {
    const end = start + lines[i].length
    if (offset <= end) {
      const item = parseListItem(lines[i], i)
      return item ? { lines, index: i, item, start } : null
    }
    start = end + 1
  }
  return null
}

/** The nearest list item above `index`; a non-item line ends the search. */
function itemAbove(lines: string[], index: number): ListItem | null {
  for (let i = index - 1; i >= 0; i--) {
    const item = parseListItem(lines[i], i)
    if (!item) return null
    return item
  }
  return null
}

/** The nearest item above `index` that is shallower than `depth`. */
function shallowestAbove(lines: string[], index: number, depth: number): ListItem | null {
  for (let i = index - 1; i >= 0; i--) {
    const item = parseListItem(lines[i], i)
    if (!item) return null
    if (item.indent.length < depth) return item
  }
  return null
}

/**
 * Indents (`in`) or outdents (`out`) the list item at `offset`.
 *
 * Tab nests the item under the item above it, stepping by that item's own marker
 * width — exactly the indentation Markdown needs for a nested list to be a child
 * rather than a sibling. Shift+Tab moves the item out to the level of the nearest
 * shallower item above it. Either way the WHOLE item moves: its nested list, the
 * continuation lines of a multi-line item and an indented fenced block inside it
 * go with it (`lastLineOfItem`). Returns null when the move is impossible (no item
 * above, nothing to deepen, or already at the outermost level), which leaves the
 * key to the browser.
 */
export function indentListItem(
  doc: string,
  offset: number,
  direction: 'in' | 'out',
): IndentResult | null {
  const found = locate(doc, offset)
  if (!found) return null
  const { lines, index, item, start } = found

  let indent: string
  if (direction === 'in') {
    const above = itemAbove(lines, index)
    // Nesting under a DEEPER item would be a jump, not a step.
    if (!above || above.indent.length > item.indent.length) return null
    indent = above.indent + ' '.repeat(above.marker.length)
    if (indent.length <= item.indent.length) return null
  } else {
    if (item.indent.length === 0) return null
    const parent = shallowestAbove(lines, index, item.indent.length)
    indent = parent ? parent.indent : ''
  }
  if (indent === item.indent) return null

  const delta = indent.length - item.indent.length
  const end = lastLineOfItem(lines, item)
  for (let i = index; i <= end; i++) {
    if (i === index) {
      lines[i] = `${indent}${item.marker}${item.body}`
    } else if (lines[i].trim() !== '') {
      // A blank line inside the span carries no indentation of its own, so
      // moving it would only add trailing whitespace.
      lines[i] = shiftLine(lines[i], delta)
    }
  }

  // The caret is ALWAYS on the item's own line: `locate` refuses any other line,
  // because a continuation line is not a list item and a nested ITEM would be the
  // subject of this call instead of this one. So the only shift it can see is the
  // item's own indent — and when that indent SHRINKS, a caret sitting inside the
  // removed columns has to stick to the line start rather than run into the block
  // above. Nothing here needs clamping at 0: the columns removed are at most the
  // caret's own column, which is at least `start`, so the result is ≥ `start`.
  const column = offset - start
  const adjust = delta >= 0 ? delta : -Math.min(-delta, column)
  return { doc: renumberLists(lines.join('\n')), caret: offset + adjust }
}
