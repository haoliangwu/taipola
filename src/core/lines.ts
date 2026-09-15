/**
 * Line arithmetic over a document's source text.
 *
 * Pure string work: a line number in, a character offset out (and back). No DOM,
 * no view model — so it lives in `core/` and runs in the node layer, which is
 * also where its test lives.
 *
 * These used to sit at the bottom of `editor/position.ts`, a module whose whole
 * premise is "browser-bound". The kernel's caret-to-line reporting is the only
 * reason they exist, but nothing about them needs a browser; parking them there
 * made a pure function only testable in Chromium.
 */

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

/**
 * Whether a line's text has nothing on it but space or tabs.
 *
 * A line of spaces IS a blank line to this editor: markdown-it reads it that way
 * and the views draw it as an empty line box, so the caret rules have to agree.
 * The distinction matters wherever a rule asks "is the caret on a blank line?" —
 * counting `   ` as content put the caret back on the path that walks up to the
 * paragraph above (`.scratch/enter-backspace-smoke/issues/09`).
 */
export function isBlankLine(text: string): boolean {
  return /^[ \t]*$/.test(text)
}

/** A document split into lines, with the line an offset fell on. */
export interface LineHit {
  lines: string[]
  /** 0-based index of the line holding the offset. */
  index: number
  /** Character offset where that line starts. */
  start: number
  /** That line's text. */
  text: string
}

/**
 * The line an offset falls on, as one of `LineHit`.
 *
 * An offset exactly AT a line's end (the newline's own position) belongs to that
 * line, which is what makes "where does this caret sit?" have one answer at a
 * boundary. It moved here from `lists.ts`, where a private copy served the list
 * rules; `tables.ts` needs the same answer about the same kind of offset, and a
 * second copy is how the table row predicates drifted in the first place.
 */
export function lineAt(doc: string, offset: number): LineHit {
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
  return { lines, index, start, text: lines[index] }
}
