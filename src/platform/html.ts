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
 * Renders a markdown document to sanitized HTML, for a standalone exported
 * file.
 *
 * The author's own HTML is never trusted: `html: false` on the shared instance
 * keeps markdown-it from passing raw tags through, and DOMPurify catches
 * anything the plugins introduce afterwards.
 */
export function renderDocumentHtml(source: string): string {
  if (source.trim() === '') return ''
  return DOMPurify.sanitize(md.render(source), SANITIZE_CONFIG)
}
