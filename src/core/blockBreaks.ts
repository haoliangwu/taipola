/**
 * Keeps the block break a write onto a blank line would delete.
 *
 * A blank source line is a *separator*: it is what makes two paragraphs two
 * paragraphs. Filling that separator in with a character therefore deletes the
 * block break — the source keeps every newline, but Markdown reads a paragraph's
 * single newline as a soft break, so the written line is swallowed into the
 * paragraph above (or below) and the view lays them out on ONE visual line
 * (`soft-line-breaks/01`). Measured in a real browser, `甲\n\n乙\n` plus a typed
 * `x` on the blank line rendered `甲x乙`.
 *
 * The repair is one rule: a line that was blank when the edit started, and that
 * now holds text, keeps one blank line between itself and every non-blank
 * neighbour. Nothing else moves — Enter's own newline, and text written into a
 * line that already had content, are both untouched. (A soft break IS one of the
 * two ways a line can be blank, and it is the exception: see `softBreakAt`.)
 *
 * The "was blank" question has to be asked of the source from BEFORE the browser's
 * insertion, and "blank" has to mean what the line-kind pass in `inline.ts` means:
 * a blank line inside a fence is CODE, and padding it would edit the code. Pure
 * string work: no DOM, so it runs in the node layer.
 */
import { computeLineStates, type LineState } from './inline'
import { lineOfOffset, offsetForLine } from './lines'

/** A source with its block break restored, and where the caret ends up in it. */
export interface BlockBreakResult {
  doc: string
  caret: number
}

interface LineBounds {
  start: number
  /** Offset of the line's own `\n`, or `text.length` for the last line. */
  end: number
  /** The line's characters, without the terminator. */
  text: string
}

/** The line containing an offset, in the same sense `lineOfOffset` reports it. */
function lineBoundsAt(text: string, offset: number): LineBounds {
  const start = offsetForLine(text, lineOfOffset(text, offset))
  const breakAt = text.indexOf('\n', start)
  const end = breakAt === -1 ? text.length : breakAt
  return { start, end, text: text.slice(start, end) }
}

/** Markdown's own reading of a blank line (`computeLineStates` uses the same test). */
const isBlank = (line: string): boolean => line.trim() === ''

/** The kind `computeLineStates` gives the line an offset falls in. */
function kindAt(text: string, offset: number): LineState['kind'] | undefined {
  return computeLineStates(text.split('\n'))[lineOfOffset(text, offset) - 1]?.kind
}

/** Length of the longest common prefix. */
function sharedPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Length of the longest common suffix, never overlapping the prefix. */
function sharedSuffix(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix
  let i = 0
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

/**
 * Restores the break this edit deleted, or returns null when none was deleted.
 *
 * `before` is the source as it stood when the edit started, `after` is the source
 * the browser produced, and `caret` is the caret in `after`. The edit is located
 * by diffing, so a keystroke, an IME commit and a paste all take this path.
 *
 * `caret` only PLACES the result: it is not what the repair is decided on. When the
 * reading is not inside the text this edit wrote, the end of that text is used —
 * an IME commit renumbers a document's blocks mid-composition (the model records
 * the provisional text while the DOM keeps the old structure), so `data-block`
 * indices read at that moment can name a different block than the one on screen.
 *
 * `softBreakAt` is the start offset of a line the user opened with Shift+Enter, or
 * null. Such a line is a soft-break CONTINUATION of the line above on purpose, so
 * it must not be padded. The source cannot tell the two apart — Enter and
 * Shift+Enter leave the same `甲\n` behind — so the caller, who saw the gesture,
 * says which line this is.
 */
export function keepBlockBreak(
  before: string,
  after: string,
  caret: number,
  softBreakAt: number | null = null,
): BlockBreakResult | null {
  if (before === after) return null
  const start = sharedPrefix(before, after)
  const end = after.length - sharedSuffix(before, after, start)
  // Nothing was written (a deletion, or a replacement with nothing).
  if (end <= start) return null
  const inserted = after.slice(start, end)
  // Whitespace alone writes no line: a space, Enter's newline and Shift+Enter's
  // soft break all leave the caret's line blank, so there is nothing to keep apart.
  if (!/\S/.test(inserted)) return null
  // The line only just stopped being blank; a line that already had content is
  // reported by the browser the same way, and it must not be touched.
  if (!isBlank(lineBoundsAt(before, start).text)) return null
  // Inside a fence a blank line is code content, not a separator.
  if (kindAt(before, start) !== 'blank') return null

  // The written text may span lines (a multi-line paste): its FIRST and LAST line
  // are the two that can end up glued to a neighbour.
  const first = lineBoundsAt(after, start)
  if (softBreakAt !== null && first.start === softBreakAt) return null
  const last = lineBoundsAt(after, Math.max(start, end - 1))
  const above = first.start > 0 ? lineBoundsAt(after, first.start - 1) : null
  const below = last.end < after.length ? lineBoundsAt(after, last.end + 1) : null
  const padAbove = above !== null && !isBlank(above.text)
  const padBelow = below !== null && !isBlank(below.text)
  if (!padAbove && !padBelow) return null

  // Below first: it sits at a higher offset, so the offsets above stay valid.
  let doc = after
  let next = caret >= start && caret <= end ? caret : end
  if (padBelow) {
    doc = doc.slice(0, last.end) + '\n' + doc.slice(last.end)
    // A caret at the end of the written text stays BEFORE the new blank line.
    if (last.end < next) next++
  }
  if (padAbove) {
    doc = doc.slice(0, first.start) + '\n' + doc.slice(first.start)
    // The whole line moved down, caret included.
    if (first.start <= next) next++
  }
  return { doc, caret: next }
}
