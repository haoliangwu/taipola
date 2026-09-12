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
