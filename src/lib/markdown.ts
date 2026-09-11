import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import type { Config as DOMPurifyConfig } from 'dompurify'

/**
 * A block is a source-range slice of the document.
 *
 * The editor renders every block except the one holding the caret; that one is
 * rendered as raw source instead. Because both the editor's textarea and the
 * rendered layer use identical monospace metrics, keeping one slot per block
 * preserves caret/line alignment exactly.
 */
export interface Block {
  /** Index of the block within the document. */
  index: number
  /** 0-based start line, inclusive. */
  startLine: number
  /** 0-based end line, exclusive. */
  endLine: number
  /** Source characters this block occupies, including its trailing newline. */
  raw: string
  /** Heading level 1-6 for ATX/setext headings, otherwise 0. */
  headingLevel: number
  /** Plain-text heading content, for the outline. */
  headingText: string
}

export interface ParsedDocument {
  blocks: Block[]
  /** Offset in the source where each block starts; `offsets.length === blocks.length + 1`. */
  offsets: number[]
  /** Line number (1-based) each block starts on. */
  blockLines: number[]
}

const md: MarkdownIt = new MarkdownIt({
  html: false, // never execute author-supplied HTML: this is an editor, not a browser
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fall through to plain escaping */
      }
    }
    return md.utils.escapeHtml(code)
  },
})

md.use(footnote)
md.use(taskLists, { label: true, labelAfter: true })

// Open links in a new tab without handing the opened page a handle on ours.
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const SANITIZE_CONFIG: DOMPurifyConfig = {
  ADD_ATTR: ['target', 'rel', 'disabled', 'align'],
  ADD_TAGS: ['input'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
  // Guarantee a plain string rather than TrustedHTML, which the DOM APIs we
  // feed it into do not accept without a Trusted Types policy.
  RETURN_TRUSTED_TYPE: false,
}

/** Renders a chunk of markdown source to sanitized HTML. */
export function renderMarkdown(source: string): string {
  if (source.trim() === '') return ''
  return DOMPurify.sanitize(md.render(source), SANITIZE_CONFIG)
}

/** Strips markdown inline syntax down to readable plain text. */
function toPlainText(markdownFragment: string): string {
  return markdownFragment
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface MarkdownToken {
  type: string
  tag: string
  map: [number, number] | null
  content: string
  markup: string
  nesting: number
  children: MarkdownToken[] | null
}

/** Token types that start a rendered block when they sit at nesting depth 0. */
const BLOCK_TOKEN_TYPES = new Set([
  'fence',
  'code_block',
  'hr',
  'blockquote_open',
  'table_open',
  'heading_open',
  'paragraph_open',
  'bullet_list_open',
  'ordered_list_open',
])

interface RawRange {
  startLine: number
  endLine: number
  headingLevel: number
  headingText: string
}

/**
 * Source lines that must never be rendered as styled HTML in place.
 *
 * footnote definitions are relocated to the end of the rendered output by the
 * footnote plugin, but their token `map` still points at the original line
 * numbers. Slicing by `map` would therefore render such a line nowhere in the
 * document body — collapsing its height and shifting every line below it out of
 * step with the textarea. They are detected here so the editor can hold their
 * exact height open instead.
 */
function findRelocatedLines(tokens: MarkdownToken[]): Set<number> {
  const lines = new Set<number>()
  let inFootnote = false

  for (const token of tokens) {
    if (token.type === 'footnote_open') inFootnote = true
    else if (token.type === 'footnote_close') inFootnote = false
    else if (token.type === 'footnote_reference_open') inFootnote = true
    else if (token.type === 'footnote_reference_close') inFootnote = false
    else if (inFootnote && token.map && token.type === 'paragraph_open') {
      for (let line = token.map[0]; line < token.map[1]; line++) lines.add(line)
    }
  }

  return lines
}

/**
 * Collects the top-level source ranges that make up the document body.
 *
 * Depth is tracked with markdown-it's own `nesting` field rather than by pairing
 * `_open`/`_close` token names: `blockquote_open` / `table_open` /
 * `bullet_list_open` have no reliably emitted close counterpart to match
 * against, so name-pairing silently swallows every top-level paragraph. Only
 * depth-0 blocks are claimed; anything nested inside a list item, blockquote or
 * table cell is already covered by its container's range.
 */
function collectRanges(tokens: MarkdownToken[]): {
  ranges: RawRange[]
  relocated: Set<number>
} {
  const ranges: RawRange[] = []
  const relocated = findRelocatedLines(tokens)
  let depth = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const span = token.map
    const isTopLevel = depth === 0

    if (isTopLevel && span && BLOCK_TOKEN_TYPES.has(token.type)) {
      const inline = tokens[i + 1]?.content ?? ''
      ranges.push({
        startLine: span[0],
        endLine: span[1],
        headingLevel: token.type === 'heading_open' ? Number(token.tag.slice(1)) : 0,
        headingText: token.type === 'heading_open' ? toPlainText(inline) : '',
      })
    }

    depth += token.nesting
  }

  // Paragraphs that the renderer relocated (footnote definitions) hold no
  // output of their own in the body: keep a slot for their exact line span.
  const claimed = new Set<number>()
  for (const range of ranges) {
    for (let line = range.startLine; line < range.endLine; line++) claimed.add(line)
  }
  for (const line of relocated) {
    if (!claimed.has(line)) {
      ranges.push({ startLine: line, endLine: line + 1, headingLevel: 0, headingText: '' })
    }
  }

  ranges.sort((a, b) => a.startLine - b.startLine)
  return { ranges, relocated }
}

const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]]+\]:/

/**
 * Splits a markdown document into caret-addressable blocks.
 *
 * Every character of the source belongs to exactly one block (or to the
 * inter-block gap, which is emitted as a blank blockso that no line is ever
 * unaddressable).
 */
export function parseDocument(source: string): ParsedDocument {
  const lines = source.split('\n')
  const { ranges, relocated } = collectRanges(
    md.parse(source, {}) as unknown as MarkdownToken[],
  )

  // markdown-it-footnote consumes `[^x]: ...` at block time, so those lines
  // never reach the token stream and would have no slot at all — they would
  // become invisible and uneditable. Claim them explicitly as source slots
  // (including their indented continuation lines).
  const claimedLines = new Set<number>()
  for (const range of ranges) {
    for (let line = range.startLine; line < range.endLine; line++) claimedLines.add(line)
  }
  for (let line = 0; line < lines.length; line++) {
    if (claimedLines.has(line) || !FOOTNOTE_DEFINITION.test(lines[line])) continue
    let end = line + 1
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++
    ranges.push({ startLine: line, endLine: end, headingLevel: 0, headingText: '' })
    for (let l = line; l < end; l++) {
      claimedLines.add(l)
      relocated.add(l)
    }
    line = end - 1
  }
  ranges.sort((a, b) => a.startLine - b.startLine)

  const blocks: Block[] = []
  let lineCursor = 0
  /** Character offset at which each source line begins; line 1 starts at 0. */
  const lineStarts: number[] = [0]
  for (let line = 0; line < lines.length - 1; line++) {
    lineStarts.push(lineStarts[line] + (lines[line]?.length ?? 0) + 1)
  }

  const pushBlock = (startLine: number, endLine: number, headingLevel = 0, headingText = '') => {
    if (endLine <= startLine) return
    let raw = ''
    for (let line = startLine; line < endLine; line++) {
      raw += lines[line] ?? ''
      if (line < lines.length - 1) raw += '\n'
    }
    // Trailing blank lines of the slice belong to the inter-block gap, which is
    // emitted separately as spacer blocks.
    const trailing = raw.length - raw.replace(/\n+$/, '').length
    const text = trailing > 0 ? raw.slice(0, raw.length - trailing) : raw
    if (text.length === 0) return
    blocks.push({
      index: blocks.length,
      startLine,
      endLine,
      raw: text,
      headingLevel,
      headingText,
    })
    lineCursor = endLine
  }

  const pushBlank = (startLine: number, endLine: number) => {
    if (endLine <= startLine) return
    blocks.push({
      index: blocks.length,
      startLine,
      endLine,
      raw: '',
      headingLevel: 0,
      headingText: '',
    })
    lineCursor = endLine
  }

  for (const range of ranges) {
    // Gap lines between two rendered blocks: keep them as blank blocks so the
    // caret can always be addressed to a block.
    if (range.startLine > lineCursor) pushBlank(lineCursor, range.startLine)
    pushBlock(range.startLine, range.endLine, range.headingLevel, range.headingText)
  }

  // Trailing lines after the last rendered block.
  if (lineCursor < lines.length) pushBlank(lineCursor, lines.length)

  if (blocks.length === 0) pushBlank(0, 1)

  // Offsets are DERIVED from each block's start line rather than accumulated
  // while pushing. A running character cursor drifts out of step the moment a
  // block consumes fewer characters than its line span implies (blank spacers,
  // trailing newlines), and a drifting offset index silently maps the caret to
  // the neighbouring block — which shows up as the wrong block switching into
  // its source form.
  const offsets = blocks.map((block) => lineStarts[block.startLine] ?? 0)
  offsets.push(source.length)
  const blockLines = blocks.map((block) => block.startLine + 1)

  if (import.meta.env.DEV) assertSourcePreserved(source, lines, blocks)

  return { blocks, offsets, blockLines }
}

/**
 * Guards the invariant this whole editor rests on: the blocks tile the source
 * exactly, with no character silently dropped.
 *
 * A dropped range is invisible at runtime — the document simply renders one
 * paragraph short while the textarea still holds the text, so the two layers
 * drift apart with no error anywhere. Any change to range collection must keep
 * this assertion quiet.
 */
function assertSourcePreserved(source: string, lines: string[], blocks: Block[]): void {
  // Walk every block forward from the cursor and require that it matches the
  // source right there. A blank block's line span reaches to the next block's
  // start, so it may owe one terminating newline — accepting either form keeps
  // the check exact without over-constraining the line semantics.
  const sliceOf = (startLine: number, endLine: number): string => {
    let raw = ''
    for (let line = startLine; line < endLine; line++) {
      raw += lines[line] ?? ''
      if (line < lines.length - 1) raw += '\n'
    }
    return raw
  }

  let cursor = 0
  for (const block of blocks) {
    const slice = sliceOf(block.startLine, block.endLine)
    const withNewline = `${slice}\n`

    if (slice.length > 0 && slice !== '\n'.repeat(block.endLine - block.startLine)) {
      // Content-bearing block: its own text must sit exactly at the cursor.
      if (!source.startsWith(slice, cursor)) {
        console.error(
          `[taipola] block ${block.index} (lines ${block.startLine + 1}-${block.endLine}) ` +
            `expected at ${cursor}: ${JSON.stringify(slice.slice(0, 40))} ` +
            `but source has ${JSON.stringify(source.slice(cursor, cursor + 40))}`,
        )
        return
      }
      cursor += slice.length
      continue
    }

    // Blank block: consume its newlines, tolerating one owing newline.
    if (source.startsWith(withNewline, cursor)) cursor += withNewline.length
    else if (source.startsWith(slice, cursor)) cursor += slice.length
    else {
      console.error(
        `[taipola] blank block ${block.index} (lines ${block.startLine + 1}-${block.endLine}) ` +
          `does not match at ${cursor}: ${JSON.stringify(source.slice(cursor, cursor + 20))}`,
      )
      return
    }
  }

  if (cursor !== source.length) {
    console.error(
      `[taipola] blocks cover ${cursor} of ${source.length} characters; ` +
        `left over: ${JSON.stringify(source.slice(cursor, cursor + 60))}`,
    )
  }
}

export interface Heading {
  level: number
  text: string
  /** 1-based source line. */
  line: number
}

/** Extracts the document outline, ignoring pseudo-headings inside fenced code. */
export function extractHeadings(source: string): Heading[] {
  const headings: Heading[] = []
  const lines = source.split('\n')
  let fence: string | null = null

  lines.forEach((line, i) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      return
    }
    if (fence !== null) return

    const atx = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (atx) {
      headings.push({ level: atx[1].length, text: toPlainText(atx[2]) || '(空标题)', line: i + 1 })
    }
  })

  return headings
}

export interface DocumentStats {
  words: number
  chars: number
  lines: number
  readingMinutes: number
}

export function computeStats(source: string): DocumentStats {
  const chars = source.length
  const lines = source === '' ? 1 : source.split('\n').length
  const cjk = source.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0
  const latin = source
    .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .match(/[A-Za-z0-9_'-]+/g)?.length ?? 0
  const words = cjk + latin
  return { words, chars, lines, readingMinutes: Math.max(1, Math.round(cjk / 300 + latin / 200)) }
}
