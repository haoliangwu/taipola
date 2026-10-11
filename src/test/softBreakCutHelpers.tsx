/**
 * Helpers for the soft-break acceptance matrix
 * (`.scratch/soft-break-cuts/test-matrix.md`, the cut-1/cut-2 shared oracle).
 *
 * The matrix pins `{doc, caret, boxes}` triples exactly. These helpers supply
 * the primitives the cells share:
 *
 * - `boxes(r)`            — visible line boxes: `[data-vline]` count. Structural
 *                           separators render no node, so the count is correct
 *                           by construction (`kind == 'S'` → no node).
 * - `invariants(r)`       — after EVERY step: DOM↔source roundtrip, caret in
 *                           `[0, len]`, and the `kind` lifecycle (no orphan
 *                           keys; every key a blank line start).
 * - `assertUntouchedPrefix` — the machine form of ADR-0005 §2.4 (a): bytes
 *                           outside the session's edited lines are identity.
 * - `clickAtBox(r, k)`    — a REAL pointer click on the k-th line box (CDP).
 */
import { expect } from 'vitest'
import {
  assertDomMatchesSource,
  caretFromDom,
  flush,
  type Rendering,
} from './editorTestUtils'
import { realClickElement } from './realInput'

export type CutRendering = Rendering

/** Visible line boxes: structural separators contribute no `[data-vline]`. */
export function boxes(r: CutRendering): number {
  return r.container.querySelectorAll('[data-vline]').length
}

/** Whether `at` is the start offset of a blank source line in `doc`. */
function isBlankLineStart(doc: string, at: number): boolean {
  if (at < 0 || at > doc.length) return false
  if (at !== 0 && doc[at - 1] !== '\n') return false
  const end = doc.indexOf('\n', at)
  const text = doc.slice(at, end === -1 ? doc.length : end)
  return /^[ \t]*$/.test(text)
}

/** A compact one-block debug trace, printed in the failure message (`§9`). */
function trace(r: CutRendering): string {
  return [
    `doc=${JSON.stringify(r.getDoc())}`,
    `caret=${caretFromDom()}`,
    `boxes=${boxes(r)}`,
    `kinds=${JSON.stringify([...r.getKinds()])}`,
  ].join(' ')
}

/**
 * The `§6` invariant bundle, run after EVERY step.
 *
 * 1. DOM↔source roundtrip (`assertDomMatchesSource`).
 * 2. caret ∈ [0, len].
 * 3. `kind` lifecycle: every key resolves to a blank line start; values are
 *    `s`|`S`; no key points at a content line or off the document.
 *
 * R1 (the `boxes == content + s` rendering identity) is deliberately NOT here:
 * it is a cut-2 property — until the kind-driven renderer lands, `boxes` is
 * still produced by `pendingBreak`/`softChains`, and asserting the identity now
 * would fail for reasons that have nothing to do with the data layer.
 */
export async function invariants(r: CutRendering, label = ''): Promise<void> {
  const doc = r.getDoc()
  const kinds = r.getKinds()
  const fail = (what: string) => `${label ? `[${label}] ` : ''}${what} — ${trace(r)}`

  await assertDomMatchesSource(r).catch((error) => {
    throw new Error(fail(`DOM↔source roundtrip failed: ${String(error)}`))
  })

  const c = caretFromDom()
  // A freshly mounted, unfocused editor has no caret; the range check applies
  // once an interaction placed one.
  if (c !== null) {
    expect(c, fail('caret >= 0')).toBeGreaterThanOrEqual(0)
    expect(c, fail('caret <= len')).toBeLessThanOrEqual(doc.length)
  }

  for (const [at, kind] of kinds) {
    expect(kind === 's' || kind === 'S', fail(`kind value @${at}`)).toBe(true)
    expect(isBlankLineStart(doc, at), fail(`orphan kind key @${at}`)).toBe(true)
  }
}

/** Assert the given pins exactly, with a legible trace on mismatch. */
export function expectTriple(
  r: CutRendering,
  label: string,
  want: { doc: string; caret: number | null; boxes: number },
): void {
  const got = { doc: r.getDoc(), caret: caretFromDom(), boxes: boxes(r) }
  if (got.doc !== want.doc || got.caret !== want.caret || got.boxes !== want.boxes) {
    throw new Error(
      `[${label}] triple mismatch\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`,
    )
  }
}

/**
 * The machine form of ADR-0005 §2.4 (a): the session edited ONLY some lines, so
 * every line it did not touch must still be byte-identical to `before`. Lines
 * are compared positionally; a line is "edited" when its text changed. Returns
 * the indices it treated as edited so a caller can assert the edit landed where
 * it meant to.
 */
export function assertUntouchedPrefix(
  doc: string,
  before: string,
  label = 'R8',
): number[] {
  const after = doc.split('\n')
  const prev = before.split('\n')
  const edited: number[] = []
  for (let i = 0; i < prev.length; i++) {
    if (i >= after.length || after[i] !== prev[i]) edited.push(i)
  }
  const editedSet = new Set(edited)
  for (let i = 0; i < prev.length; i++) {
    if (editedSet.has(i)) continue
    expect(after[i], `[${label}] untouched line ${i} changed`).toBe(prev[i])
  }
  return edited
}

/**
 * A REAL pointer click on the k-th visible line box (0-based), asserting the
 * browser's own hit-test resolution. The caret is left wherever the browser put
 * it — `invariants` then checks the model agrees.
 */
export async function clickAtBox(r: CutRendering, k: number): Promise<void> {
  const line = r.container.querySelectorAll<HTMLElement>('[data-vline]')[k]
  if (!line) throw new Error(`no line box at index ${k}`)
  await realClickElement(line, 0.5, 0.5)
  await flush()
}
