import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/common'

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
