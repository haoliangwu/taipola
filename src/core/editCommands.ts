import { indentListItem, renumberLists } from './lists'
import { EXTRA_INLINE } from './view'
import { findMathAt } from './inline'
import { inTable } from './tables'

export interface EditBuffers {
  value: string
  start: number
  end: number
}

/**
 * Source-level editing commands.
 *
 * Every command is a pure function of (text, selectionStart, selectionEnd) and
 * mutates the buffers in place. Callers apply the result through the editor's
 * own commit path (a model update plus React state). The browser's native undo
 * stack is deliberately NOT used: contenteditable's native undo is unreliable
 * across block mount/unmount, so Cmd+Z is served by the snapshot stack in
 * `Editor.tsx` (`undoStack`/`redoStack`).
 */

export function toggleInline(buffer: EditBuffers, marker: string): void {
  const { value, start, end } = buffer
  const selected = value.slice(start, end)
  const len = marker.length

  // Already wrapped by this very marker, inside or around the selection.
  const outerStart = start - len
  if (
    outerStart >= 0 &&
    value.slice(outerStart, start) === marker &&
    value.slice(end, end + len) === marker
  ) {
    buffer.value = value.slice(0, outerStart) + selected + value.slice(end + len)
    buffer.start = outerStart
    buffer.end = outerStart + selected.length
    return
  }

  if (selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, selected.length - len)
    buffer.value = value.slice(0, start) + inner + value.slice(end)
    buffer.start = start
    buffer.end = start + inner.length
    return
  }

  if (selected.length === 0) {
    buffer.value = value.slice(0, start) + marker + marker + value.slice(end)
    buffer.start = start + len
    buffer.end = start + len
    return
  }

  // Wrapping leaves the caret AFTER the closing marker, not inside the
  // construct: the next keystroke then continues the sentence (`**bold**X`)
  // instead of burrowing into the emphasis (`**Xbold**`). Collapsing to the
  // selection start — the old behaviour — did the latter, because the kernel
  // places the caret from `buffer.start` and the browser then inserts there.
  buffer.value = value.slice(0, start) + marker + selected + marker + value.slice(end)
  buffer.start = buffer.end = end + len * 2
}

const URL_LIKE = /^(https?:\/\/|mailto:|www\.)\S+$/i

export function insertLink(buffer: EditBuffers): void {
  const { value, start, end } = buffer
  const selected = value.slice(start, end)

  // Refuse inside an image's alt text. `[alt](url)` is not a link there: wrapping
  // it produces `![[alt](url)](src)`, which markdown-it cannot parse back into an
  // image (its alt group stops at the first `]`). Doing nothing is the honest
  // outcome; the caller can still edit the source by hand.
  for (let open = value.lastIndexOf('![', start); open !== -1; open = open === 0 ? -1 : value.lastIndexOf('![', open - 1)) {
    const close = value.indexOf(']', open + 2)
    if (close === -1 || close < start) break
    if (start <= close) return
    break
  }

  // Unwrap an existing link that encloses the selection.
  const before = value.slice(0, start)
  const open = before.lastIndexOf('[')
  if (open !== -1) {
    const close = value.indexOf('](', start)
    const closeParen = value.indexOf(')', close + 2)
    if (before.slice(open - 1, open) !== '!' && close !== -1 && closeParen !== -1 && open < start) {
      const label = value.slice(open + 1, close)
      if (label === selected || selected === '') {
        buffer.value = value.slice(0, open) + label + value.slice(closeParen + 1)
        buffer.start = open
        buffer.end = open + label.length
        return
      }
    }
  }

  if (URL_LIKE.test(selected)) {
    const replacement = `[](${selected})`
    buffer.value = value.slice(0, start) + replacement + value.slice(end)
    buffer.start = start + 1
    buffer.end = start + 1
    return
  }

  const label = selected || '链接文字'
  const replacement = `[${label}](url)`
  buffer.value = value.slice(0, start) + replacement + value.slice(end)
  if (selected) {
    const urlStart = start + replacement.length - 4
    buffer.start = urlStart
    buffer.end = urlStart + 3
  } else {
    buffer.start = start + 1
    buffer.end = start + 1 + label.length
  }
}

export function toggleInlineCode(buffer: EditBuffers): void {
  const { value, start, end } = buffer
  const selected = value.slice(start, end)

  if (selected.includes('\n') || selected === '') {
    // Multi-line selections become a fenced block; empty selections get a pair
    // of backticks with the caret in between.
    if (selected === '') return toggleInline(buffer, '`')
    const block = `\`\`\`\n${selected}\n\`\`\``
    buffer.value = value.slice(0, start) + block + value.slice(end)
    buffer.start = start + 4
    buffer.end = start + 4 + selected.length
    return
  }

  return toggleInline(buffer, '`')
}

const HEADING_RE = /^(#{1,6})\s+/

export function toggleHeading(buffer: EditBuffers, level: number): void {
  const { value, start } = buffer
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEndRaw = value.indexOf('\n', start)
  const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw
  const line = value.slice(lineStart, lineEnd)

  const match = HEADING_RE.exec(line)
  const current = match ? match[1].length : 0
  const body = match ? line.slice(match[0].length) : line

  // Level 0 strips the heading back to a paragraph (Typora's ⌘0).
  const next = level === 0 || current === level ? body : `${'#'.repeat(level)} ${body}`
  const deltaChars = next.length - line.length

  buffer.value = value.slice(0, lineStart) + next + value.slice(lineEnd)
  buffer.start = Math.max(lineStart, start + deltaChars)
  buffer.end = Math.max(buffer.start, buffer.end + deltaChars)
}

export function deleteLine(buffer: EditBuffers): void {
  const { value, start } = buffer
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  let lineEnd = value.indexOf('\n', start)
  if (lineEnd === -1) {
    // Last line: also eat the preceding newline so no blank line is left behind.
    const from = lineStart > 0 ? lineStart - 1 : 0
    buffer.value = value.slice(0, from)
    buffer.start = buffer.end = Math.min(from, buffer.value.length)
    return
  }
  lineEnd += 1
  buffer.value = value.slice(0, lineStart) + value.slice(lineEnd)
  buffer.start = buffer.end = Math.min(lineStart, buffer.value.length)
}

/**
 * Inserts a newline-joined snippet, e.g. a table skeleton, at the caret.
 *
 * Declines inside a table cell: a row is one source line, so a snippet's newlines
 * would split the row and take the table apart (`inTable`).
 */
export function insertSnippet(buffer: EditBuffers, snippet: string): void {
  if (snippet.includes('\n') && inTable(buffer.value, buffer.start)) return
  const { value, start, end } = buffer
  const needsLeading = start > 0 && value[start - 1] !== '\n'
  const prefix = needsLeading ? '\n' : ''
  const text = `${prefix}${snippet}`
  buffer.value = value.slice(0, start) + text + value.slice(end)
  buffer.start = buffer.end = start + text.length
}

export const TABLE_SNIPPET = `| 列 1 | 列 2 |
| --- | --- |
|  |  |`


/* ------------------------------------------------------------------------ */
/* Typora paragraph/format parity (typora-menus spec, tickets 01/02)        */
/* ------------------------------------------------------------------------ */

/**
 * Clear Format (⌘\): strip INLINE markers from the selection, keep the text.
 *
 * Inline-only on purpose (spec Q5): block prefixes (`#`, `> `, `- `) are the
 * block-toggle commands' business, and a collapsed caret changes nothing — the
 * command must never eat literal text around the caret.
 */
export function clearFormat(buffer: EditBuffers): void {
  const { value, start, end } = buffer
  if (start === end) return
  let selected = value.slice(start, end)
  for (let round = 0; round < 8; round++) {
    let next = selected
      // Links keep their text; images survive untouched (the `!` guard).
      .replace(/(?<!!)\[([^\[\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
    // The extra families strip only when their syntax is ON: when the gate is
    // closed they are literal text, and stripping literals is eating the user's
    // writing (spec Q6b).
    if (EXTRA_INLINE.highlight) next = next.replace(/==([^=]+)==/g, '$1')
    if (EXTRA_INLINE.superscript) next = next.replace(/\^([^^\s]+)\^/g, '$1')
    if (EXTRA_INLINE.subscript) next = next.replace(/~([^~\s]+)~/g, '$1')
    // Math is always on: `$…$`, `\(…\)` and `\[…\]` lose their delimiters
    // wherever they sit in the selection — the anchored scanner has to be
    // walked, since these are start-anchored forms.
    let math = findMathAt(next)
    while (math) {
      next = next.slice(0, math.openStart) + math.inner + next.slice(math.closeEnd)
      math = findMathAt(next)
    }
    if (next === selected) break
    selected = next
  }
  buffer.value = value.slice(0, start) + selected + value.slice(end)
  buffer.end = start + selected.length
  // start unchanged: the stripped text begins where the selection began.
}

/** Change the caret line's heading by ±1; every boundary is a silent no-op. */
export function changeHeadingLevel(buffer: EditBuffers, delta: 1 | -1): void {
  const { value, start } = buffer
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEndRaw = value.indexOf('\n', start)
  const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw
  const line = value.slice(lineStart, lineEnd)

  const match = HEADING_RE.exec(line)
  const current = match ? match[1].length : 0
  // A paragraph has no level to move; h1 cannot rise, h6 cannot fall. (Typora
  // turns a paragraph into H6 on ⌘= — a quirk we deliberately do not copy.)
  if (current === 0) return
  const nextLevel = current + delta
  if (nextLevel < 1 || nextLevel > 6) return

  const body = line.slice(match![0].length)
  const next = `${'#'.repeat(nextLevel)} ${body}`
  const deltaChars = next.length - line.length
  buffer.value = value.slice(0, lineStart) + next + value.slice(lineEnd)
  buffer.start = Math.max(lineStart, start + deltaChars)
  buffer.end = Math.max(buffer.start, buffer.end + deltaChars)
}

/* ------------------------- block prefixes -------------------------------- */

/** One kind of block prefix the toggle commands add/remove. */
export type BlockPrefixKind = 'quote' | 'ul' | 'ol' | 'task'

const UL_RE = /^- /
const OL_RE = /^\d+[.)] /
const TASK_RE = /^- \[[ xX]\] /
const QUOTE_RE = /^> /

function toggleOne(line: string, kind: BlockPrefixKind): string {
  switch (kind) {
    case 'quote':
      return QUOTE_RE.test(line) ? line.replace(/^>\s?/, '') : `> ${line}`
    case 'ul': {
      if (UL_RE.test(line)) return line.slice(2)
      if (OL_RE.test(line)) return line.replace(OL_RE, '- ')
      return `- ${line}`
    }
    case 'ol': {
      if (OL_RE.test(line)) return line.replace(OL_RE, '')
      // Bullet and task lines both carry `- `: swap the marker, keep the text
      // (a task's checkbox stays put).
      if (UL_RE.test(line)) return line.replace(/^[-*+] /, '1. ')
      return `1. ${line}`
    }
    case 'task': {
      if (TASK_RE.test(line)) return line.replace(TASK_RE, '')
      if (OL_RE.test(line)) return line.replace(OL_RE, '$&[ ] ')
      if (UL_RE.test(line)) return line.replace(/^[-*+] /, '$&[ ] ')
      return '- [ ] ' + line
    }
  }
}

/**
 * Selection-aware block toggles (⌥⌘Q/U/O/X): each line the selection covers
 * (the caret line when collapsed) gets its prefix added, swapped or removed —
 * see `toggleOne`. Ordered toggles renumber the document once, so `1. 甲`
 * followed by a new `1.` becomes `1. 甲\n2.` instead of two lists.
 */
export function toggleBlockPrefix(buffer: EditBuffers, kind: BlockPrefixKind): void {
  const { value, start, end } = buffer
  const lineStartOf = (pos: number): number => value.lastIndexOf('\n', pos - 1) + 1
  const lineEndOf = (pos: number): number => {
    const i = value.indexOf('\n', pos)
    return i === -1 ? value.length : i
  }

  const firstStart = lineStartOf(start)
  const lastStart = lineStartOf(end > start ? end - 1 : end)
  const edits: Array<{ start: number; end: number; text: string }> = []
  for (let at = firstStart; at <= lastStart; ) {
    const lineEnd = lineEndOf(at)
    const line = value.slice(at, lineEnd)
    const text = toggleOne(line, kind)
    if (text !== line) edits.push({ start: at, end: lineEnd, text })
    at = lineEnd + 1
  }
  if (edits.length === 0) return

  const offsetOf = (offset: number): number => {
    let delta = 0
    for (const e of edits) {
      if (e.end <= offset) delta += e.text.length - (e.end - e.start)
      else if (e.start < offset) return offset + delta
      else break
    }
    return offset + delta
  }

  let next = ''
  let cursor = 0
  for (const e of edits) {
    next += value.slice(cursor, e.start) + e.text
    cursor = e.end
  }
  next += value.slice(cursor)
  if (kind === 'ol') next = renumberLists(next)

  buffer.value = next
  buffer.start = offsetOf(start)
  buffer.end = offsetOf(end)
}

/** ⌘]/⌘[: the kernel's list indent, exactly the semantics Tab already has. */
export function indentSelection(buffer: EditBuffers, direction: 'in' | 'out'): void {
  const result = indentListItem(buffer.value, buffer.start, direction)
  if (!result) return // fence or impossible move: the key does nothing
  buffer.value = result.doc
  buffer.start = buffer.end = result.caret
}

/* ------------------------------ inserts ---------------------------------- */

/** Next free footnote number across both refs (`[^n]`) and definitions. */
function nextFootnoteNumber(doc: string): number {
  const nums = [...doc.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]))
  return nums.length ? Math.max(...nums) + 1 : 1
}

/** How to reach the end-of-document definition from `text`: exactly one blank
 * line after it, reusing the trailing newline when there is one. */
function blankLineBeforeDefinition(text: string): string {
  return text.endsWith('\n') ? '\n' : '\n\n'
}

/**
 * Footnote (⌥⌘R): `[^n]` right after the selection (the text stays put), with
 * an empty `[^n]: ` definition at the end of the document.
 */
export function insertFootnote(buffer: EditBuffers): void {
  const { value, end } = buffer
  // The `[^n]` itself would fit in a cell; the DEFINITION would not, and a marker
  // with no definition is worse than nothing (`inTable`).
  if (inTable(value, end)) return
  const n = nextFootnoteNumber(value)
  const marker = `[^${n}]`
  const withRef = value.slice(0, end) + marker + value.slice(end)
  buffer.value = withRef + blankLineBeforeDefinition(withRef) + `[^${n}]: `
  buffer.start = end
  buffer.end = end + marker.length
}

/** Next free reference id across definitions (`[n]: `). */
function nextLinkRefNumber(doc: string): number {
  const nums = [...doc.matchAll(/^\s*\[(\d+)\]:/gm)].map((m) => Number(m[1]))
  return nums.length ? Math.max(...nums) + 1 : 1
}

/**
 * Link Reference (⌥⌘L): wrap the selection as `[text][n]` and append an empty
 * `[n]: ` definition. No selection → nothing: never leave a half-made `[][n]`.
 */
export function insertLinkReference(buffer: EditBuffers): void {
  const { value, start, end } = buffer
  if (start === end) return
  if (inTable(value, start)) return
  const n = nextLinkRefNumber(value)
  const marker = `[${value.slice(start, end)}][${n}]`
  const withRef = value.slice(0, start) + marker + value.slice(end)
  buffer.value = withRef + blankLineBeforeDefinition(withRef) + `[${n}]: `
  buffer.start = start
  buffer.end = start + marker.length
}

/** Horizontal rule (⌥⌘-): a `---` block right after the current line. */
export function insertHr(buffer: EditBuffers): void {
  if (inTable(buffer.value, buffer.start)) return
  const { value, start } = buffer
  const lineEndRaw = value.indexOf('\n', start)
  if (lineEndRaw === -1) {
    const at = value.length
    buffer.value = value + '\n---'
    buffer.start = buffer.end = at + 4
    return
  }
  const at = lineEndRaw + 1
  buffer.value = value.slice(0, at) + '---\n' + value.slice(at)
  buffer.start = buffer.end = at + 3
}

/**
 * Inline math toggle (⌃M, Typora's `toggleStyle('inline_math')`):
 *
 * - caret inside an existing math construct → strip its delimiters (the math
 *   is turned back into plain text, never nested `$$`);
 * - non-empty selection → wrap the selection;
 * - collapsed caret → grow over the word (Typora's selectWord) and wrap.
 *
 * The enclosing-construct scan shares `MATH_FORMS` with the viewer's run
 * scanner (`inline.ts`), so the command and the render never disagree about
 * what counts as math.
 */
export function toggleInlineMath(buffer: EditBuffers): void {
  const { value, start, end } = buffer

  const enclosing = findMathAt(value)
  if (enclosing && start >= enclosing.openStart && end <= enclosing.closeEnd) {
    buffer.value =
      value.slice(0, enclosing.openStart) + enclosing.inner + value.slice(enclosing.closeEnd)
    buffer.start = enclosing.openStart
    buffer.end = enclosing.openStart + enclosing.inner.length
    return
  }

  if (start === end) {
    const before = /\S+$/.exec(value.slice(0, start))
    const after = /^\S+/.exec(value.slice(start))
    if (before) buffer.start -= before[0].length
    if (after) buffer.end += after[0].length
  }
  toggleInline(buffer, '$')
}
