/**
 * The size an author may pin onto an image: `![alt](url){width=200}`.
 *
 * Markdown itself has no way to size an image, so the displayed size is whatever
 * the file happens to be — an icon has to be stored as a second, smaller file.
 * This is the one syntax the editor adds for it. It is a deliberate extension:
 * another editor reading the same file shows the `{width=200}` as text, which is
 * the price of not opening author HTML (`html: false` in `markdownIt.ts` is a
 * security decision, and this suffix does not touch it).
 *
 * One reader, two callers that must not drift: the editor's own inline scan
 * (`view.ts`) and the export (`markdownIt.ts`, which has to eat the same suffix —
 * otherwise the exported HTML would show the suffix as text beside a picture the
 * editor drew at 200px).
 *
 * Pixels only, for now: `{width=200}`. A bare number is what `<img width>` takes,
 * so the editor and the export agree with no unit conversion and no inline style
 * (the export's sanitizer forbids `style` anyway). A percentage would need
 * `style.width` on both sides, which is a separate decision.
 */

/** `{width=200}` — the suffix must start exactly where the image ends. */
const SIZE_RE = /^\{width=(\d+)\}/

export interface ImageSize {
  /** The width, in pixels, as the attribute value. */
  width: string
  /** How many characters the suffix occupies, so callers can skip past it. */
  suffixLength: number
}

/** Reads the `{width=…}` suffix at the start of `text`, or null when absent. */
export function readImageSize(text: string): ImageSize | null {
  const match = SIZE_RE.exec(text)
  return match ? { width: match[1], suffixLength: match[0].length } : null
}
