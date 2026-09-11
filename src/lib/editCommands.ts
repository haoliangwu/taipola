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

  buffer.value = value.slice(0, start) + marker + selected + marker + value.slice(end)
  buffer.start = start + len
  buffer.end = end + len
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

  const next = current === level ? body : `${'#'.repeat(level)} ${body}`
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

/** Inserts a newline-joined snippet, e.g. a table skeleton, at the caret. */
export function insertSnippet(buffer: EditBuffers, snippet: string): void {
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
