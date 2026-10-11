/**
 * Trusted-input helpers for the browser project.
 *
 * The acceptance matrix (`.scratch/soft-break-cuts/test-matrix.md` §7) is
 * explicit: synthetic `dispatchEvent` input never enters Chromium's own
 * insertion-point resolution, so the click/IME cells must ride a REAL chrome
 * devtools-protocol channel. Vitest's browser mode exposes it through
 * `cdp()` (`vitest/browser`) — a `CDPSession` whose `send()` reaches
 * `Input.dispatchMouseEvent`, `Input.insertText` and `Input.imeSetComposition`.
 *
 * `userEvent.pointer` (used elsewhere) does NOT qualify: its events are
 * untrusted, so the browser runs no default action and never moves the caret to
 * the clicked glyph. `userEvent.keyboard` DOES go through Playwright's real
 * keyboard, which is why the keyboard cells need no help here.
 *
 * CDP reachability: if the provider is not Playwright or the session cannot be
 * opened, every helper throws a labelled error rather than silently degrading —
 * a test that claims "real click" and gets a fallback would be asserting its own
 * fallback. `cdpAvailable()` lets a suite skip with a printed note instead.
 */
import { cdp } from 'vitest/browser'

let cached: ReturnType<typeof cdp> | null = null

/**
 * Whether the CDP session can be opened in this runner. Callers that want to
 * SKIP rather than fail use this; the helpers themselves throw.
 */
export function cdpAvailable(): boolean {
  try {
    session()
    return true
  } catch {
    return false
  }
}

function session(): ReturnType<typeof cdp> {
  if (cached) return cached
  try {
    cached = cdp()
  } catch (error) {
    throw new Error(`CDP unavailable: ${String(error)}`)
  }
  return cached
}

/** Run a CDP command; every failure names the method so a red cell is legible. */
interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

async function send(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const s = session() as unknown as CdpLike
  try {
    return await s.send(method, params)
  } catch (error) {
    throw new Error(`CDP ${method} failed: ${String(error)}`)
  }
}

/** A REAL pointer click at viewport coordinates (CSS pixels). */
export async function realClick(x: number, y: number): Promise<void> {
  const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 })
}

/**
 * A REAL click at a fraction of an element's own box. `fx`/`fy` are 0..1 of the
 * element's width/height, so callers aim at the glyph they mean instead of an
 * absolute pixel. The element is scrolled into view first; coordinates are read
 * from the LIVE rect.
 */
export async function realClickElement(
  el: Element,
  fx = 0.5,
  fy = 0.5,
): Promise<void> {
  el.scrollIntoView({ block: 'center' })
  const rect = el.getBoundingClientRect()
  await realClick(rect.left + rect.width * fx, rect.top + rect.height * fy)
}

/**
 * REAL IME composition input (`Input.imeSetComposition`). `text` is the
 * provisional composed string; `selectionStart`/`selectionEnd` are offsets
 * inside it. An empty `text` is how a commit/cancel is announced to the page.
 */
export async function realImeSetComposition(
  text: string,
  selectionStart = text.length,
  selectionEnd = text.length,
): Promise<void> {
  // `replacementStart`/`replacementEnd` are deliberately OMITTED: Chromium then
  // anchors the composition at the current selection (the caret) instead of at
  // an explicit document range — passing (0,0) inserted at the document start.
  await send('Input.imeSetComposition', { text, selectionStart, selectionEnd })
}

/**
 * REAL text insertion (`Input.insertText`) at the current selection — the CDP
 * commit shape that fires NO further `input` after `compositionend` (see
 * `Editor.test.tsx` "IME ASCII 提交后不再有 input"). Used to pin the
 * no-input commit path through the real channel.
 */
export async function realInsertText(text: string): Promise<void> {
  await send('Input.insertText', { text })
}

/** A REAL key press via CDP (`Input.dispatchKeyEvent`) for keys whose native
    default action matters to the insertion point. */
const KEY_CODES: Record<string, { keyCode: number; code: string; text?: string }> = {
  Enter: { keyCode: 13, code: 'Enter', text: '\r' },
  Backspace: { keyCode: 8, code: 'Backspace' },
  ArrowDown: { keyCode: 40, code: 'ArrowDown' },
  ArrowUp: { keyCode: 38, code: 'ArrowUp' },
}

/** A REAL key down/up through CDP. `key` is one of the entries of `KEY_CODES`. */
export async function realKey(key: keyof typeof KEY_CODES, modifiers = 0): Promise<void> {
  const spec = KEY_CODES[key]
  if (!spec) throw new Error(`realKey: unknown key ${key}`)
  const common = {
    key,
    code: spec.code,
    windowsVirtualKeyCode: spec.keyCode,
    nativeVirtualKeyCode: spec.keyCode,
    modifiers,
  }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common })
  if (spec.text) await send('Input.dispatchKeyEvent', { type: 'char', text: spec.text, ...common })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...common })
}
