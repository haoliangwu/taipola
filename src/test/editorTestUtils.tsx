import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, expect } from 'vitest'
import { useState, useRef } from 'react'
import { Editor, type EditorHandle } from '../shell/components/Editor'
import { readDocumentSource, normalizeTables } from '../editor/render'

/**
 * Real-browser operation helpers.
 *
 * Tests run inside a real Chromium via vitest browser mode, so `userEvent.*`
 * performs REAL typing/clicking/keyboard through the native pipeline:
 * `keydown → beforeinput → browser mutates the DOM → input`. The editor's
 * `onBeforeInput`/`onInput` handlers therefore execute exactly as they do for
 * a human, with no jsdom shims.
 */

export interface Rendering {
  container: HTMLElement
  /** The latest committed source (whatever onChange delivered). */
  getDoc: () => string
  blockEl: (index: number) => HTMLElement | null
  runEl: (block: number, vline: number, run: number) => HTMLElement | null
  /** Preconfigured userEvent instance. */
  user: ReturnType<typeof userEvent.setup>
}

export function renderEditor(source: string): Rendering {
  const onChange = vi.fn()
  const onCaretLineChange = vi.fn()
  let latest = source
  let count = 0
  onChange.mockImplementation((next: string) => {
    latest = next
    count++
  })

  function Harness() {
    const [value, setValue] = useState(source)
    const ref = useRef<EditorHandle>(null)
    return (
      <Editor
        ref={ref}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
        onCaretLineChange={onCaretLineChange}
      />
    )
  }

  const view = render(<Harness />)
  // The `.doc` node is REPLACED when the editor force-remounts itself
  // (DOM/model divergence). A captured reference would point at the stale,
  // detached node — query live every time.
  const containerOf = () => view.container.querySelector('.doc') as HTMLElement

  return {
    get container(): HTMLElement {
      return containerOf()
    },
    getDoc: () => latest,
    blockEl: (index) =>
      containerOf().querySelector(`[data-block="${index}"]`) as HTMLElement | null,
    runEl: (block, vline, run) =>
      containerOf().querySelector(
        `[data-block="${block}"] [data-vline="${vline}"] [data-run="${run}"]`,
      ) as HTMLElement | null,
    user: userEvent.setup({ delay: null }),
  }
}

/** Document-level source offset of the current DOM caret, or null. */
export function caretFromDom(): number | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const startEl = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement
  const host = startEl?.closest?.('[data-block]') as HTMLElement | null
  if (!host) return null
  const blockStart = Number(host.dataset.srcStart)
  if (startEl?.hasAttribute?.('data-vline')) {
    // Caret anchored on an EMPTY line element itself (no run spans).
    return blockStart + Number((startEl as HTMLElement).dataset.src)
  }
  const run = startEl?.closest?.('[data-run]') as HTMLElement | null
  if (!run) return null
  const within = range.startContainer.nodeType === Node.TEXT_NODE ? range.startOffset : 0
  return blockStart + Number(run.dataset.src) + within
}

/** Where in a run's text a click should land. */
export type RunPoint = 'start' | 'middle' | 'end' | number

/** `at` as an index into the run's text, clamped to it. */
function charIndexOf(text: string, at: RunPoint): number {
  if (typeof at === 'number') return Math.max(0, Math.min(at, text.length))
  if (at === 'start') return 0
  if (at === 'end') return text.length
  return Math.round(text.length / 2)
}

/**
 * The viewport box of the character at `index` — for an index AT the end
 * (`text.length`) there is no character, so the last one's box is used and the
 * caller aims at its right edge.
 */
function characterBox(node: Node | null, index: number): DOMRect | null {
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const length = node.textContent?.length ?? 0
  if (length === 0) return null
  const start = Math.min(index, length - 1)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + 1)
  return range.getBoundingClientRect()
}

/**
 * Puts the caret at an offset inside a node and announces it with
 * `selectionchange` — the only signal through which the editor learns where the
 * caret went.
 *
 * Exported for tests whose subject is NOT the click: `userEvent`'s pointer
 * events are untrusted, so the browser runs no default action for them and a
 * caret that merely has to BE somewhere has to be placed. A test that aims a
 * synthetic click at a coordinate and then asserts where the caret ended up is
 * asserting its own fallback, not the browser's hit test.
 */
export function placeCaretAt(node: Node, offset: number): void {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

/**
 * Positions the caret by CLICKING the run — a real mouse event sequence through
 * `userEvent`, so the editor's own hit test (`sourceOffsetAtPoint`) runs exactly
 * as it does for a human.
 *
 * `at` names the position in the run's TEXT — `'start'`, `'middle'`, `'end'`, or
 * an exact character index — because that is what the caller means. It replaces
 * a `charFraction` parameter that could not keep its promise: `0.5` landed at
 * the line end for every call, so each "mid-text" case (splitting a heading with
 * Enter, a soft break in the middle of a line) silently tested a line-end click
 * instead (ADR-0001 §5, §6).
 *
 * Three separate facts made that happen, and all three are handled here:
 *
 * 1. `userEvent.pointer`'s `coords` are ABSOLUTE viewport coordinates, not
 *    offsets inside the target element. `rect.width * 0.5` put every click near
 *    the top-left of the page — outside the line — where the editor's
 *    point-to-offset fallback correctly answers "end of line".
 * 2. Those events are untrusted, so the browser runs no default action for them
 *    and never moves the selection to the clicked glyph.
 * 3. Even a real point is not a precise character: at a run's edges the
 *    browser's own resolution is off by one either way (`rect.right` resolves to
 *    the last character as often as to the end).
 *
 * So the click supplies the gesture and the hit test, and the caret is then
 * placed at the requested character — exactly what the browser's default action
 * would do for a point aimed at that character.
 */
export async function clickInRun(
  r: Rendering,
  block: number,
  vline: number,
  run: number,
  at: RunPoint = 'middle',
): Promise<void> {
  const el = r.runEl(block, vline, run)
  if (!el) throw new Error(`run ${block}/${vline}/${run} not found`)
  const node = el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE ? el.firstChild : null
  const text = node?.textContent ?? ''
  const index = charIndexOf(text, at)

  const elRect = el.getBoundingClientRect()
  const box = characterBox(node, index)
  const x = box ? (index >= text.length ? box.right : box.left + box.width / 2) : elRect.left + elRect.width / 2
  const y = elRect.top + elRect.height / 2

  await r.user.pointer({ target: el, keys: '[MouseLeft]', coords: { x, y } })
  if (node) placeCaretAt(node, index)
}

/**
 * Positions the caret by CLICKING the line box itself — empty lines render no
 * run, so there is no character to aim at and the caret belongs at the start of
 * that line (the same place the editor anchors it).
 */
export async function clickAtLine(
  r: Rendering,
  block: number,
  vline: number,
): Promise<void> {
  const blk = r.blockEl(block)
  const line = blk?.querySelector(`[data-vline="${vline}"]`) as HTMLElement | null
  if (!line) throw new Error(`line ${block}/${vline} not found`)
  const rect = line.getBoundingClientRect()
  // Viewport coordinates, like clickInRun — `coords` is not relative to the
  // target element.
  await r.user.pointer({
    target: line,
    keys: '[MouseLeft]',
    coords: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
  })
  const text = [...line.childNodes].find((child) => child.nodeType === Node.TEXT_NODE)
  placeCaretAt(text ?? line, 0)
}

/**
 * A table cell's element, wherever the table is on the page.
 *
 * No block index on purpose: a table is not always the document's first block
 * (deleting one from between two paragraphs is a case that has to be tested), and
 * a test that owns the whole document never has two of them.
 */
export function tableCellEl(container: HTMLElement, vline: number, cell: number): HTMLElement {
  return container.querySelector(
    `[data-vline="${vline}"] [data-cell="${cell}"]`,
  ) as HTMLElement
}

/**
 * Puts the caret in a table cell — where a click there leaves it.
 *
 * The cell ELEMENT, not a run: an empty cell renders no run at all, and that is
 * the whole point of the cell carrying its own `data-cell-src`.
 */
export async function caretInTableCell(
  r: Rendering,
  vline: number,
  cell: number,
): Promise<void> {
  placeCaretAt(tableCellEl(r.container, vline, cell), 0)
  await flush()
}

/** Type text at the current caret — a REAL keystroke sequence. */
export async function typeText(r: Rendering, text: string): Promise<void> {
  await r.user.type(r.container, text)
}

/** Press Backspace at the current caret — REAL key. */
export async function pressBackspace(r: Rendering): Promise<void> {
  await r.user.keyboard('{Backspace}')
}

/** Press Enter — REAL key. */
export async function pressEnter(r: Rendering): Promise<void> {
  await r.user.keyboard('{Enter}')
}

/** Press Shift+Enter (soft break) — REAL key. */
export async function pressShiftEnter(r: Rendering): Promise<void> {
  await r.user.keyboard('{Shift>}{Enter}{/Shift}')
}

/**
 * Press Ctrl+Z — the editor's own snapshot stack, not the browser's.
 *
 * Control rather than Meta: the kernel accepts either (`metaKey || ctrlKey`), and
 * Control is the one the test runner can send portably.
 */
export async function pressUndo(r: Rendering): Promise<void> {
  await r.user.keyboard('{Control>}z{/Control}')
}

/** Press Ctrl+Shift+Z — redo on the same snapshot stack. */
export async function pressRedo(r: Rendering): Promise<void> {
  await r.user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
}

/** Flush pending React work. */
export async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Diffs the DOM's own source reconstruction against the committed source:
 * every block's rendered lines must concatenate to the exact document text.
 * Uses the EDITOR's own rebuild/normalize functions so the comparison is
 * exactly the integrity check the editor runs — table rows included.
 */
export async function assertDomMatchesSource(r: Rendering): Promise<void> {
  const doc = r.getDoc()
  const dom = readDocumentSource(r.container)
  // Both sides go through the same canonicalization: table cell text is rebuilt
  // from the DOM without its original padding, and delimiter rows collapse.
  expect(normalizeTables(dom).replace(/\n+$/, '')).toBe(
    normalizeTables(doc).replace(/\n+$/, ''),
  )
}