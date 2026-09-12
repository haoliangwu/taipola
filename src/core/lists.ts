/**
 * List editing helpers: numbering and indentation.
 *
 * These are pure functions of the Markdown source, so they are testable without
 * a browser. The kernel calls them after structural edits (Enter, Tab, Shift+Tab).
 */

import { offsetForLine } from './lines'

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
 * Whether line `index` sits inside a fenced code block.
 *
 * A fence's contents are text, not Markdown: `1. 甲` inside one is not a list
 * item, so Tab must not renumber it and Shift+Tab must not take it out of a list
 * it was never in (that would rewrite the code block). `renumberLists` already
 * refuses to touch fences — this is the same rule, asked before the move instead
 * of during it.
 */
function inFence(lines: string[], index: number): boolean {
  let open = false
  for (let i = 0; i < index; i++) if (FENCE_RE.test(lines[i])) open = !open
  return open
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

/** The nearest list item above `item`.
 *
 * Blank lines and lines indented DEEPER than the item do not end the search: a
 * loose item (`1. 甲 / (blank) / 2. 乙`) and an item that follows another item's
 * continuation line are both still "somewhere below the first line of their
 * list", so Tab has an item to nest under. Only a line at or above the item's own
 * indent that is not itself a list item ends the list — a paragraph, a heading, a
 * fence — and means this item is where the list starts.
 */
function itemAbove(lines: string[], item: ListItem): ListItem | null {
  for (let i = item.line - 1; i >= 0; i--) {
    if (lines[i].trim() === '') continue
    const found = parseListItem(lines[i], i)
    if (found) return found
    if (leadingSpaces(lines[i]) > item.indent.length) continue
    return null
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

/** What a Tab with nothing to nest under inserts — an ordinary keystroke. */
const PLAIN_INDENT = '  '

/** Tab on the list's first line: two spaces at the caret, no list operation. */
function plainIndent(doc: string, offset: number): IndentResult {
  return {
    doc: doc.slice(0, offset) + PLAIN_INDENT + doc.slice(offset),
    caret: offset + PLAIN_INDENT.length,
  }
}

/**
 * Takes the item out of its list: the marker goes away, the body stays as a
 * paragraph. Called only for an item at the OUTERMOST level — that is the rule,
 * since there is no shallower level left to move out to.
 *
 * Blank lines are written around it on purpose. A paragraph line directly under a
 * list item is only a lazy continuation — `1. 甲\n乙\n3. 丙` renders as
 * `<li>甲乙</li>` — so without them the item would be swallowed by the item above
 * instead of leaving the list. With them the list above and the list below are
 * two lists, and the one below starts again at 1.
 *
 * The item's own line is all that changes; a nested list below it stays where it
 * is, exactly like the level moves above.
 */
function unlistItem(lines: string[], item: ListItem, caretColumn: number): IndentResult {
  const blankBefore = item.line > 0 && lines[item.line - 1].trim() !== ''
  const blankAfter = item.line + 1 < lines.length && lines[item.line + 1].trim() !== ''
  const next = [
    ...lines.slice(0, item.line),
    ...(blankBefore ? [''] : []),
    item.body,
    ...(blankAfter ? [''] : []),
    ...lines.slice(item.line + 1),
  ]
  const paragraphLine = item.line + (blankBefore ? 1 : 0)
  const doc = renumberLists(next.join('\n'))
  return {
    doc,
    // Line numbers survive renumbering, offsets do not (a `10.` above can become
    // `1.`), so the caret is read off the FINAL text. The marker is gone, so a
    // caret that sat inside it lands at the line start.
    caret:
      offsetForLine(doc, paragraphLine + 1) + Math.max(0, caretColumn - item.marker.length),
  }
}

/**
 * The list keys: what Tab and Shift+Tab do on the list item holding `offset`.
 *
 * - Tab nests the item under the item above it, stepping by that item's own
 *   marker width — exactly the indentation Markdown needs for a nested list to be
 *   a child rather than a sibling. On the list's FIRST line there is nothing above
 *   to nest under, so Tab is not a list operation at all: two spaces at the caret,
 *   the ordinary keystroke. The level does not change, so nothing is renumbered.
 * - Shift+Tab moves the item out to the level of the nearest shallower item above
 *   it. At the OUTERMOST level there is nowhere left to go, so the item leaves the
 *   list and becomes a paragraph (`unlistItem`), which is what splits the list in
 *   two.
 *
 * ONLY THE ITEM'S OWN LINE MOVES. Its nested list and the continuation lines of a
 * multi-line item stay where they are, and `renumberLists` then re-synchronises
 * the numbering. That is Typora's model, measured against it: the operation is
 * line-level, so the parent/child relationship stays out of this arithmetic and
 * the only promise is that the final index sequence comes out right. Moving the
 * sub-tree along was tried and reverted (`78707ee`); leaving the children behind
 * can hand them to the item above, and that is the intended outcome, not a defect.
 *
 * Returns null when the caret is not on a list item, when it is inside a fenced
 * code block (a code block's text is not a list), or when the move is impossible
 * (nesting under a DEEPER item would be a jump, not a step), which leaves the key
 * to the browser.
 */
export function indentListItem(
  doc: string,
  offset: number,
  direction: 'in' | 'out',
): IndentResult | null {
  const found = locate(doc, offset)
  if (!found) return null
  const { lines, index, item } = found
  if (inFence(lines, index)) return null
  const caretColumn = offset - offsetForLine(doc, index + 1)

  let indent: string
  if (direction === 'in') {
    const above = itemAbove(lines, item)
    if (!above) return plainIndent(doc, offset)
    // Nesting under a DEEPER item would be a jump, not a step.
    if (above.indent.length > item.indent.length) return null
    indent = above.indent + ' '.repeat(above.marker.length)
    if (indent.length <= item.indent.length) return null
  } else {
    if (item.indent.length === 0) return unlistItem(lines, item, caretColumn)
    const parent = shallowestAbove(lines, index, item.indent.length)
    indent = parent ? parent.indent : ''
  }
  if (indent === item.indent) return null

  const delta = indent.length - item.indent.length
  lines[index] = `${indent}${item.marker}${item.body}`
  return { doc: renumberLists(lines.join('\n')), caret: Math.max(0, offset + delta) }
}
