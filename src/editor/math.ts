import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * Inline TeX → static HTML, for the editor's own rendering.
 *
 * KaTeX's `renderToString` is synchronous (no layout pass, no async typeset),
 * which is what fits the kernel's sync DOM renderer. The caret block never
 * reaches this path — it shows the `$…$` source — so the only math drawn is
 * static content that nothing re-renders while the user types nearby.
 *
 * `throwOnError: false` renders bad TeX in red instead of throwing, so one
 * typo cannot take a whole document's rendering down.
 */
export function mathHtml(tex: string): string {
  return katex.renderToString(tex, { throwOnError: false, displayMode: false })
}

/**
 * Display TeX for a `$$…$$` math BLOCK — KaTeX display mode, and
 * `throwOnError: true` on purpose: the caller wants to distinguish a good
 * formula from a broken one, because a broken `$$…$$` block falls back to
 * showing its RAW source text (never KaTeX's red error glyphs, never blank).
 */
export function mathBlockHtml(tex: string): string {
  return katex.renderToString(tex, { throwOnError: true, displayMode: true })
}