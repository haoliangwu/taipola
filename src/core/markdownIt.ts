import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/common'
import { readImageSize } from './imageSize'

/**
 * The one and only configured markdown-it instance.
 *
 * Two implementations share it, and they must not drift apart:
 *
 * - `parseDocument` (`./markdown.ts`) walks its token stream to decide where the
 *   caret-addressable blocks begin and end, so the plugin set configured here
 *   decides the editor's block layout;
 * - `renderDocumentHtml` (`../platform/html.ts`) turns the very same tokens into
 *   the exported HTML file.
 *
 * The configuration is deliberately not duplicated per caller: two instances
 * could be configured differently, and the exported HTML would then describe a
 * document the editor never showed.
 *
 * Nothing here touches the DOM — markdown-it, its plugins and highlight.js are
 * pure — which is what lets the parse side stay in the node test layer.
 */
export const md: MarkdownIt = new MarkdownIt({
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

/**
 * The href the export would write for `url`, or null when it would refuse it.
 *
 * The one answer to "is this URL allowed", asked by two callers that must not
 * disagree: the autolink scan (a URL the export drops must not render as a link)
 * and the kernel's Cmd/Ctrl+click (a URL the export drops must not be FOLLOWED —
 * following an unvalidated `[x](javascript:…)` would execute it).
 *
 * `validateLink` is markdown-it's own gate, the one the exported HTML already
 * passes through, so the editor cannot be more permissive than the file it writes.
 */
export function exportableHref(url: string): string | null {
  const href = md.normalizeLink(url)
  return md.validateLink(href) ? href : null
}

/**
 * Turns the image size suffix into a real `width`, on the export side.
 *
 * markdown-it parses `![a](x.png){width=200}` as an image followed by a text token
 * holding the suffix. Without this rule the exported HTML would show `{width=200}`
 * as text beside a picture the editor drew at 200px — the same "two truths" the
 * autolink and soft-break work had to close. `readImageSize` is the reader the
 * editor's own scan uses (`view.ts`), so the two cannot recognise different
 * suffixes.
 *
 * Runs after `inline` (so the children exist) and before rendering, and consumes
 * the suffix from the following text token rather than leaving stray characters.
 */
md.core.ruler.after('inline', 'image_size', (state) => {
  for (const token of state.tokens) {
    const children = token.type === 'inline' ? token.children : null
    if (!children) continue
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.type !== 'image') continue
      const next = children[i + 1]
      if (!next || next.type !== 'text') continue
      const size = readImageSize(next.content)
      if (!size) continue
      child.attrSet('width', size.width)
      next.content = next.content.slice(size.suffixLength)
      if (next.content === '') children.splice(i + 1, 1)
    }
  }
  return true
})
