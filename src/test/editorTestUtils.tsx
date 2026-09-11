import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, expect } from 'vitest'
import { useState, useRef } from 'react'
import { Editor, type EditorHandle } from '../components/Editor'

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
  /** Current DOM caret as a document source offset, or null. */
  getCaret: () => number | null
  getActiveBlock: () => string | null
  blockEl: (index: number) => HTMLElement | null
  runEl: (block: number, vline: number, run: number) => HTMLElement | null
  /** Preconfigured userEvent instance. */
  user: ReturnType<typeof userEvent.setup>
  onChangeCount: () => number
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
    getCaret: () => caretFromDom(),
    getActiveBlock: () => {
      const active = containerOf().querySelector('.blk-active')
      return active ? (active as HTMLElement).dataset.block ?? null : null
    },
    blockEl: (index) =>
      containerOf().querySelector(`[data-block="${index}"]`) as HTMLElement | null,
    runEl: (block, vline, run) =>
      containerOf().querySelector(
        `[data-block="${block}"] [data-vline="${vline}"] [data-run="${run}"]`,
      ) as HTMLElement | null,
    user: userEvent.setup({ delay: null }),
    onChangeCount: () => count,
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

/**
 * Positions the caret by CLICKING the run's text at the given character
 * position — a real mouse click through `userEvent`, so the browser itself
 * resolves the glyph offset (no synthetic selection juggling).
 *
 * `userEvent.pointer` coordinates are RELATIVE to the target element's
 * top-left corner — passing viewport coordinates puts the click far to the
 * right of the run, and the browser's native caret then lands at END of the
 * line, silently turning every "mid-text" test into a line-end one.
 */
export async function clickInRun(
  r: Rendering,
  block: number,
  vline: number,
  run: number,
  charFraction = 0.5,
): Promise<void> {
  const el = r.runEl(block, vline, run)
  if (!el) throw new Error(`run ${block}/${vline}/${run} not found`)
  const rect = el.getBoundingClientRect()
  // A REAL mouse click at the given horizontal fraction of the run's box.
  // The browser resolves the exact glyph under the point (like a human click).
  await r.user.pointer({
    target: el,
    keys: '[MouseLeft]',
    coords: {
      x: Math.min(1, Math.max(0, charFraction)) * rect.width,
      y: rect.height / 2,
    },
  })
}

/** Positions the caret by CLICKING the line box itself (empty lines: no runs). */
export async function clickAtLine(
  r: Rendering,
  block: number,
  vline: number,
): Promise<void> {
  const blk = r.blockEl(block)
  const line = blk?.querySelector(`[data-vline="${vline}"]`) as HTMLElement | null
  if (!line) throw new Error(`line ${block}/${vline} not found`)
  const rect = line.getBoundingClientRect()
  // Coordinates are relative to the target element (see clickInRun).
  await r.user.pointer({
    target: line,
    keys: '[MouseLeft]',
    coords: { x: Math.max(6, rect.width / 2), y: rect.height / 2 },
  })
}

/** Waits until the DOM caret maps to the given source offset. */
export async function waitForCaret(_r: Rendering, expected: number | null): Promise<void> {
  await waitFor(() => expect(caretFromDom()).toBe(expected), { timeout: 3000 })
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

/** Flush pending React work. */
export async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** All runs of a line (visible + collapsed markers) as one string. */
export function sourceLineText(block: number, vline: number, r: Rendering): string {
  const blk = r.blockEl(block)
  const line = blk?.querySelector(`[data-vline="${vline}"]`)
  if (!line) return ''
  return [...line.querySelectorAll('[data-run]')].map((rn) => rn.textContent).join('')
}

/**
 * Diffs the DOM's own source reconstruction against the committed source:
 * every block's rendered lines must concatenate to the exact document text.
 */
export async function assertDomMatchesSource(r: Rendering): Promise<void> {
  const doc = r.getDoc()
  const domLines: string[] = []
  for (const blk of Array.from(r.container.querySelectorAll('[data-block]'))) {
    blk.querySelectorAll('[data-vline]').forEach((vl) => {
      domLines.push(
        [...vl.querySelectorAll('[data-run]')].map((rn) => rn.textContent).join(''),
      )
    })
  }
  expect(domLines.join('\n').replace(/\n+$/, '')).toBe(doc.replace(/\n+$/, ''))
}