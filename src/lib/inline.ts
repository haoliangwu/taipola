import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import type { Config as DOMPurifyConfig } from 'dompurify'

/**
 * Per-line inline markdown rendering.
 *
 * The editor renders **one source line as exactly one line box**. Block syntax
 * (list bullets, quote markers, fences) is stripped from the line's start and
 * expressed through styling instead of wrapping elements, because a wrapper
 * element with padding or margins would make a rendered line taller than its
 * source line — and any such difference accumulates into vertical drift between
 * the caret and the text.
 *
 * `stripLine` and `renderInline` must agree: whatever `stripLine` removes from
 * the text, `renderInline` must not produce a visible equivalent of, so that a
 * click measured against rendered text can be mapped back to a source offset.
 */

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
})

const SANITIZE: DOMPurifyConfig = {
  ADD_ATTR: ['target', 'rel'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed', 'div', 'p', 'ul', 'ol', 'li', 'pre', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr'],
  FORBID_ATTR: ['style', 'class', 'onerror', 'onload', 'onclick'],
  RETURN_TRUSTED_TYPE: false,
}

export interface LineParts {
  /** Leading block markup: list bullet, quote marker, task checkbox. */
  prefix: string
  /** How many times the line is nested (lists, quotes). */
  depth: number
  /** True when the line opens or closes a fenced code block. */
  isFence: boolean
  /** Language of a fence opener. */
  fenceLang: string
  /** True for a horizontal rule line. */
  isRule: boolean
  /** True for a table delimiter row (`| --- |`). */
  isTableDelimiter: boolean
  /** True when the line looks like a table row. */
  isTableRow: boolean
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/
const HEADING_RE = /^(\s{0,3})(#{1,6})(\s+)(.*)$/
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/
const TASK_RE = /^(\[[ xX]\])(\s+)(.*)$/
const QUOTE_RE = /^(\s*)(>+)(\s?)(.*)$/
const TABLE_DELIM_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/

/** Splits a raw line into its block markup and its content. */
export function parseLine(raw: string): LineParts {
  const parts: LineParts = {
    prefix: '',
    depth: 0,
    isFence: false,
    fenceLang: '',
    isRule: RULE_RE.test(raw),
    isTableDelimiter: false,
    isTableRow: raw.trim().startsWith('|') || (raw.includes('|') && raw.trim().endsWith('|')),
  }

  if (parts.isRule) return parts

  const fence = FENCE_RE.exec(raw)
  if (fence) {
    parts.isFence = true
    parts.fenceLang = fence[3].trim()
    parts.prefix = fence[1] + fence[2] + fence[3]
    return parts
  }

  parts.isTableDelimiter = parts.isTableRow && TABLE_DELIM_RE.test(raw)

  let rest = raw
  let prefix = ''

  // Quotes nest, then lists, then task boxes.
  for (;;) {
    const quote = QUOTE_RE.exec(rest)
    if (quote && !LIST_RE.test(rest)) {
      prefix += quote[1] + quote[2] + quote[3]
      rest = quote[4]
      parts.depth++
      continue
    }
    const list = LIST_RE.exec(rest)
    if (list) {
      prefix += list[1] + list[2] + list[3]
      rest = list[4]
      parts.depth++
      continue
    }
    const task = TASK_RE.exec(rest)
    if (task) {
      prefix += task[1] + task[2]
      rest = task[3]
      continue
    }
    break
  }

  parts.prefix = prefix
  return parts
}

/** The text a line contributes to the rendered document (markup removed). */
export function stripLine(raw: string): string {
  const parts = parseLine(raw)
  // A fence marker itself renders as nothing; the line still occupies its box.
  if (parts.isFence) return ''
  if (parts.isRule) return ''

  let rest = raw
  const heading = HEADING_RE.exec(rest)
  if (heading) rest = heading[4]

  for (;;) {
    const before = rest
    const quote = QUOTE_RE.exec(rest)
    if (quote && !LIST_RE.test(rest)) {
      rest = quote[4]
    } else {
      const list = LIST_RE.exec(rest)
      if (list) rest = list[4]
      else {
        const task = TASK_RE.exec(rest)
        if (task) rest = task[3]
      }
    }
    if (rest === before) break
  }

  return rest
}

export interface LineState {
  kind: 'blank' | 'text' | 'heading' | 'rule' | 'fence' | 'code' | 'quote' | 'list' | 'task' | 'table' | 'table-delim'
  /** 1-6 for headings. */
  level: number
  /** List/quote nesting, used for indentation. */
  depth: number
  /** Ordered or unordered, for list markers. */
  ordered: boolean
  marker: string
  checked: boolean | null
  /** Source indentation (in characters) of a list line, for nesting. */
  indent: number
  /** Language of the enclosing code fence. */
  lang: string
  /** Rendered HTML content for this line (never block-level). */
  html: string
}

/**
 * Computes the render state of every source line.
 *
 * Fence state spans lines, so this must run over the whole document in order
 * rather than line by line. Each state maps to exactly one line box.
 */
export function computeLineStates(lines: string[]): LineState[] {
  const states: LineState[] = []
  let fenceLang: string | null = null
  let prevDelimiter = false

  for (const raw of lines) {
    const parts = parseLine(raw)
    const base: LineState = {
      kind: 'text',
      level: 0,
      depth: 0,
      ordered: false,
      marker: '',
      checked: null,
      indent: 0,
      lang: '',
      html: '',
    }

    if (fenceLang !== null) {
      if (parts.isFence) {
        fenceLang = null
        states.push({ ...base, kind: 'fence' })
        continue
      }
      states.push({ ...base, kind: 'code', lang: fenceLang, html: renderCodeLine(raw, fenceLang) })
      continue
    }

    if (parts.isFence) {
      fenceLang = parts.fenceLang.split(/\s+/)[0] ?? ''
      states.push({ ...base, kind: 'fence', lang: fenceLang })
      continue
    }

    if (raw.trim() === '') {
      states.push({ ...base, kind: 'blank' })
      prevDelimiter = false
      continue
    }

    if (parts.isRule) {
      states.push({ ...base, kind: 'rule' })
      prevDelimiter = false
      continue
    }

    if (parts.isTableDelimiter || (prevDelimiter && false)) {
      states.push({ ...base, kind: 'table-delim' })
      prevDelimiter = false
      continue
    }

    const heading = HEADING_RE.exec(raw)
    if (heading) {
      states.push({
        ...base,
        kind: 'heading',
        level: heading[2].length,
        html: renderInlineText(heading[4]),
      })
      prevDelimiter = false
      continue
    }

    if (parts.isTableRow) {
      states.push({ ...base, kind: 'table', html: renderInlineText(stripLine(raw)) })
      prevDelimiter = false
      continue
    }

    const listMatch = LIST_RE.exec(stripQuotePrefix(raw))
    const taskMatch = TASK_RE.exec(stripListPrefix(listMatch?.[4] ?? raw))
    if (listMatch || taskMatch) {
      const isTask = !!taskMatch
      const marker = listMatch?.[2] ?? ''
      const content = taskMatch ? taskMatch[3] : (listMatch?.[4] ?? raw)
      states.push({
        ...base,
        kind: isTask ? 'task' : 'list',
        depth: parts.depth,
        ordered: /\d/.test(marker),
        marker,
        checked: isTask ? /[xX]/.test(taskMatch![1]) : null,
        // Source indentation in characters — drives the rendered nesting
        // offset once the list prefix collapses.
        indent: (listMatch?.[1] ?? '').length,
        html: renderInlineText(content),
      })
      prevDelimiter = false
      continue
    }

    if (/^\s*>/.test(raw)) {
      states.push({ ...base, kind: 'quote', depth: parts.depth, html: renderInlineText(stripLine(raw)) })
      prevDelimiter = false
      continue
    }

    states.push({ ...base, html: renderInlineText(stripLine(raw)) })
    prevDelimiter = false
  }

  return states
}

function stripQuotePrefix(raw: string): string {
  return raw.replace(/^\s*(?:>\s?)+/, '')
}

function stripListPrefix(raw: string): string {
  const m = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(raw)
  return m ? raw.slice(m[0].length) : raw
}

/** Inline markdown for a line whose block markup has already been removed. */
function renderInlineText(content: string): string {
  if (content.trim() === '') return ''
  return DOMPurify.sanitize(md.renderInline(content, {}), SANITIZE)
}

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Removes inline markdown syntax, returning the visible text.
 *
 * Used to map a caret position measured against rendered content back to a
 * source offset: the caret's plain-text index is compared against this string
 * and the corresponding index in the raw source is returned.
 */
export function stripInline(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)

    const image = /^!\[([^\]]*)\]\([^)]*\)/.exec(rest)
    if (image) {
      out += image[1]
      i += image[0].length
      continue
    }
    const link = /^\[([^\]]*)\]\([^)]*\)/.exec(rest)
    if (link) {
      out += link[1]
      i += link[0].length
      continue
    }
    const code = /^(`+)([\s\S]*?)\1/.exec(rest)
    if (code) {
      out += code[2]
      i += code[0].length
      continue
    }
    const strong = /^(\*\*|__)([\s\S]*?)\1/.exec(rest)
    if (strong) {
      out += stripInline(strong[2])
      i += strong[0].length
      continue
    }
    const strike = /^(~~)([\s\S]*?)\1/.exec(rest)
    if (strike) {
      out += stripInline(strike[2])
      i += strike[0].length
      continue
    }
    const em = /^(\*|_)(?!\s)([\s\S]*?)\1/.exec(rest)
    if (em) {
      out += stripInline(em[2])
      i += em[0].length
      continue
    }
    const html = /^<[^>]+>/.exec(rest)
    if (html) {
      i += html[0].length
      continue
    }

    out += text[i]
    i++
  }
  return out
}

/**
 * Index in `raw` corresponding to index `visible` in `stripInline(raw)`.
 * Clamps to the raw line when the visible index runs past its end.
 */
export function visibleToSourceIndex(raw: string, visible: number): number {
  let out = 0
  let i = 0
  while (i < raw.length && out < visible) {
    const rest = raw.slice(i)
    const skip = /^(?:!\[([^\]]*)\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)|(`+)([\s\S]*?)\3|(\*\*|__)([\s\S]*?)\5|(~~)([\s\S]*?)\7|(\*|_)(?!\s)([\s\S]*?)\9|<[^>]+>)/.exec(rest)
    if (skip) {
      const visibleText = stripInline(skip[0])
      if (out + visibleText.length > visible) {
        // The caret sits inside this construct: map linearly within it.
        const into = visible - out
        return i + Math.max(0, Math.min(into, skip[0].length))
      }
      out += visibleText.length
      i += skip[0].length
      continue
    }
    out++
    i++
  }
  return Math.min(i, raw.length)
}

/** Highlighted HTML for one line of a fenced code block. */
export function renderCodeLine(raw: string, lang: string): string {
  if (raw.trim() === '') return ''
  if (lang && hljs.getLanguage(lang)) {
    try {
      return DOMPurify.sanitize(hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value, SANITIZE)
    } catch {
      /* fall through to plain escaped text */
    }
  }
  return escapeHtml(raw)
}
