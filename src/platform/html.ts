/**
 * HTML rendering for the export path.
 *
 * This is the only place in the app that turns markdown source into HTML, and
 * the only reason `markdown-it`'s render output meets DOMPurify. It lives in
 * `platform/` because it needs a DOM: DOMPurify is a DOM API, so this module
 * cannot run in node, while everything in `core/` can.
 */
import DOMPurify from 'dompurify'
import type { Config as DOMPurifyConfig } from 'dompurify'
import { md } from '../core/markdownIt'

const SANITIZE_CONFIG: DOMPurifyConfig = {
  ADD_ATTR: ['target', 'rel', 'disabled', 'align'],
  ADD_TAGS: ['input'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
  // Guarantee a plain string rather than TrustedHTML, which the DOM APIs we
  // feed it into do not accept without a Trusted Types policy.
  RETURN_TRUSTED_TYPE: false,
}

/**
 * Renders a markdown document to sanitized HTML.
 *
 * The author's own HTML is never trusted: `html: false` on the shared instance
 * keeps markdown-it from passing raw tags through, and DOMPurify catches
 * anything the plugins introduce afterwards.
 */
export function renderDocumentHtml(source: string): string {
  if (source.trim() === '') return ''
  return DOMPurify.sanitize(md.render(source), SANITIZE_CONFIG)
}

/**
 * The whole exported file: the sanitized body plus the stylesheet that makes it
 * readable on its own. The page a reader opens has no access to our app CSS, so
 * this is the export's real presentation layer.
 */
export function renderStandaloneHtml(source: string, title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title.replace(/[<>&]/g, '')}</title>
<style>
  body { max-width: 44rem; margin: 4rem auto; padding: 0 1.5rem;
         font: 16px/1.75 -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
         color: #1c1c1e; }
  pre { background: #f6f6f4; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  code { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: .9em; }
  blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid #d8d8d6; color: #6b6b70; }
  table { border-collapse: collapse; } th, td { border: 1px solid #e2e2df; padding: .4em .8em; }
  img { max-width: 100%; }
</style>
</head>
<body>
${renderDocumentHtml(source)}
</body>
</html>`
}
