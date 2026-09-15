/**
 * List editing helpers: numbering and indentation.
 *
 * These are pure functions of the Markdown source, so they are testable without
 * a browser. The kernel calls them after structural edits (Enter, Tab, Shift+Tab,
 * Backspace).
 */

import { parseLine } from './inline'
import { lineAt, offsetForLine } from './lines'

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

/** The delimiter an ordered item uses; empty for a bullet. */
function delimiterOf(item: ListItem): string {
  return item.marker.match(/[.)]/)?.[0] ?? ''
}

/** Which list an item belongs to: changing the marker starts a NEW list. */
function markerKind(item: ListItem): string {
  const delimiter = delimiterOf(item)
  return delimiter ? `ordered${delimiter}` : item.marker[0]
}

/** One open list level: how many items it holds, and the style that opened it. */
interface OpenLevel {
  count: number
  kind: string
}

/** The lists that are open at this point in the scan. */
interface OpenLists {
  /** Keyed by the item indent, so a level is one indentation string. */
  levels: Map<string, OpenLevel>
  /** Content column of the innermost item; null when no list is open. */
  contentIndent: number | null
}

/**
 * Whether a line is content of the innermost item rather than a line beside it.
 *
 * The threshold is the item's CONTENT column (`indent + marker`), not its marker
 * indent: that is where Markdown puts the boundary. A paragraph indented one or
 * two spaces under `1. 甲` is a block of its own, so treating it as part of the
 * item both mis-numbers the list that follows and lets the renumbering glue that
 * paragraph into the next item's text (`正文2. c` — only `1.` interrupts a
 * paragraph).
 */
function insideItem(line: string, open: OpenLists): boolean {
  return open.contentIndent !== null && leadingSpaces(line) >= open.contentIndent
}

/**
 * Whether a blank line leaves the open lists open.
 *
 * A blank line between two items only makes the list LOOSE, it does not end it —
 * `1. 甲 / (blank) / 2. 乙` is one `<ol>` with two items, and so is a loose item
 * followed by its own nested list. What follows the blank decides which it is:
 * content indented into the innermost item belongs to it, an item continues the
 * list of ITS OWN level when that level's marker style matches, and anything else
 * starts a new block.
 */
function blankKeepsList(lines: string[], index: number, open: OpenLists): boolean {
  if (open.contentIndent === null) return false
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (insideItem(lines[i], open)) return true
    const item = parseListItem(lines[i], i)
    if (!item) return false
    const level = open.levels.get(item.indent)
    return level !== undefined && level.kind === markerKind(item)
  }
  return false
}

/**
 * Renumbers every ordered list in the document.
 *
 * Each indentation level is its own sequence and starts at 1, which is also what
 * the rendered state shows (a CSS counter per block that counts from 1) — so the
 * source and the picture agree. Returning to a shallower indent drops the deeper
 * sequences, so a nested list under the next parent starts at 1 again.
 *
 * What ENDS the open lists is a line that is not part of the innermost item and
 * is not an item of an open level's own style: a paragraph, a heading, a fence,
 * or a different marker, at that level. What does not end them is everything that
 * stays inside the item — its continuation lines, a fenced block indented into
 * it, and a blank line followed by more of the same list. Treating those as an
 * ending used to rewrite the next sibling to `1.` while the picture kept counting
 * it as the second item.
 *
 * One boundary this line-level rule cannot see: a LAZY continuation written flush
 * left (`1. 甲 / 续行 / 3. 丙`). Markdown keeps that line inside the item, but
 * knowing so needs the parser — a flush-left line is just as often a paragraph
 * that ends the list — so the counters restart there. Recorded in
 * `.scratch/list-renumber/issues/01-counters-reset-inside-a-list.md`.
 *
 * `5.` in the source is normalized to `1.`. That is deliberate: the rendered
 * counter could not honour a start number anyway, so keeping one in the source
 * would only make the two states disagree.
 */
export function renumberLists(text: string): string {
  const lines = text.split('\n')
  const open: OpenLists = { levels: new Map(), contentIndent: null }
  let inFence = false

  const endLists = () => {
    open.levels.clear()
    open.contentIndent = null
  }

  const out = lines.map((line, index) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      // A fence indented into the item is that item's code block; a fence at or
      // above its own level ends the list.
      if (!insideItem(line, open)) endLists()
      return line
    }
    if (inFence) return line

    const item = parseListItem(line, index)
    if (!item) {
      if (line.trim() === '') {
        if (blankKeepsList(lines, index, open)) return line
      } else if (insideItem(line, open)) {
        // A continuation line of the innermost item: the list is still open.
        return line
      }
      endLists()
      return line
    }

    // Drop levels deeper than this line: we have left them.
    for (const key of [...open.levels.keys()]) {
      if (key.length > item.indent.length) open.levels.delete(key)
    }
    // This item's own level: a different marker style at the same indent is a
    // different list, so it starts counting again (`1. a / - b / 1. c` is three).
    const kind = markerKind(item)
    const level = open.levels.get(item.indent)
    const count = level && level.kind === kind ? level.count : 0
    open.contentIndent = item.indent.length + item.marker.length
    if (!delimiterOf(item)) {
      open.levels.set(item.indent, { count: 0, kind })
      return line
    }

    open.levels.set(item.indent, { count: count + 1, kind })
    return `${item.indent}${count + 1}${delimiterOf(item)} ${item.body}`
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
  const { lines, index } = lineAt(doc, offset)
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
  const renumbered = renumberLists(lines.join('\n'))
  // Renumbering can change this line's own marker width (`1. jjj` becomes `10.
  // jjj` at its new level), so the caret is placed from its position INSIDE the
  // body rather than from an absolute offset, and read off the final text — the
  // lines above may have been renumbered too.
  const markerWidth =
    renumbered.split('\n')[index].length - indent.length - item.body.length
  const withinBody = caretColumn - item.indent.length - item.marker.length
  const column =
    withinBody >= 0
      ? indent.length + markerWidth + withinBody
      : Math.max(0, Math.min(caretColumn + delta, indent.length))
  return { doc: renumbered, caret: offsetForLine(renumbered, index + 1) + column }
}

/**
 * Backspace with the caret at a line's CONTENT start — the other half of
 * `leavingEmptyItem`, for a line that is not empty.
 *
 * Two outcomes, decided by whether the line is already at the outermost level:
 *
 * - **A nested item steps out one level and stays an item** — the move Shift+Tab
 *   already makes on it (`list-indent/02`'s T4), which is why this delegates
 *   instead of re-deriving the level. (`indentListItem` lands it at the nearest
 *   shallower item's indent; with no item above, that is column 0 and it is a
 *   top-level item.)
 * - **An item at the outermost level stops being an item.** Its text joins the
 *   block above as a continuation line, at that block's prefix width — for the
 *   usual case the previous item's marker width, which is where Markdown puts
 *   "this is still content of that item" (three columns under `2. `, six under
 *   `- [ ] `). With nothing above to continue it lands at column 0 as a
 *   paragraph, and the items below are renumbered into the list that is left.
 *
 * Neither outcome invents list syntax: the prefix comes from `parseLine` (the
 * per-line owner of block markup, shared with Enter and the line-kind pass), and
 * the counters come from `renumberLists`.
 *
 * Returns null when the keystroke is not this one: the line carries no block
 * prefix, the caret is not exactly after that prefix (a caret inside the marker is
 * editing the marker's own characters, and the browser may have it), the body is
 * empty (that is the empty-item rule's job, and it runs first), or the line is
 * inside a fence — a code block's `3. ccc` is text, not an item to leave.
 */
export function backspaceAtContentStart(doc: string, offset: number): IndentResult | null {
  const { lines, index, start, text } = lineAt(doc, offset)
  if (inFence(lines, index)) return null
  const prefix = parseLine(text).prefix
  if (prefix === '' || offset !== start + prefix.length) return null
  const body = text.slice(prefix.length)
  if (body === '') return null

  const item = parseListItem(text, index)
  if (item && item.indent !== '') return indentListItem(doc, offset, 'out')

  // The column to land on: the block above's prefix width. Blank lines are
  // stepped over, so the item above a loose list still receives the text; a
  // heading or a paragraph above has no prefix and therefore no column to
  // inherit, which is the "first item becomes a paragraph" case. A fence line's
  // `prefix` is the fence marker, not a content column, so it counts as none.
  let above = index - 1
  while (above >= 0 && lines[above].trim() === '') above--
  const aboveParts = above < 0 ? null : parseLine(lines[above])
  const column = aboveParts === null || aboveParts.isFence ? 0 : aboveParts.prefix.length
  lines[index] = ' '.repeat(column) + body
  // Renumbering can shorten the lines ABOVE (`10.` becomes `1.`), so the caret is
  // read off the final text: the line number survives, offsets do not.
  const renumbered = renumberLists(lines.join('\n'))
  return { doc: renumbered, caret: offsetForLine(renumbered, index + 1) + column }
}

/**
 * Flips a task item's check box on `offset`'s line: `[ ]` → `[x]`, `[x]` → `[ ]`.
 *
 * One character inside the marker, so the line keeps its shape and every other
 * offset keeps its meaning — which is what lets the caller commit this as an
 * ordinary edit and leave the caret where it was (a click on the decorated box
 * must not move the caret into the line).
 *
 * Returns the new document, or null when the line is not a task item (a plain
 * bullet, a paragraph, or a fence's contents).
 */
export function flipTaskCheckboxAt(doc: string, offset: number): string | null {
  const found = locate(doc, offset)
  if (!found) return null
  const { lines, index, item } = found
  // A fence's contents are text: a `- [ ]` inside one is an example, not a box
  // (the same guard `indentListItem` and `backspaceAtContentStart` use).
  if (inFence(lines, index)) return null
  const box = /\[[ xX]\]/.exec(item.marker)
  if (!box) return null
  const next = box[0] === '[ ]' ? '[x]' : '[ ]'
  lines[index] =
    item.indent +
    item.marker.slice(0, box.index) +
    next +
    item.marker.slice(box.index + box[0].length) +
    item.body
  return lines.join('\n')
}
