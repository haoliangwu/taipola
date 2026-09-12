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

export interface IndentResult {
  /** The new document source. */
  doc: string
  /** Caret offset in the new document (the same content position). */
  caret: number
}

/** The line holding `offset`, and its `ListItem` (null when it is not one). */
function locate(doc: string, offset: number) {
  const lines = doc.split('\n')
  let start = 0
  let index = lines.length - 1
  for (let i = 0; i < lines.length; i++) {
    const end = start + lines[i].length
    if (offset <= end) {
      index = i
      break
    }
    start = end + 1
  }
  const item = parseListItem(lines[index], index)
  return item ? { lines, index, item } : null
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
 * shallower item above it. Returns null when the move is impossible (no item
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
  const { lines, index, item } = found

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
  lines[index] = `${indent}${item.marker}${item.body}`
  return { doc: renumberLists(lines.join('\n')), caret: Math.max(0, offset + delta) }
}
