/**
 * Table row/column entry-point probe — NOT collected by the test suite.
 *
 * Question it answers, with raw evidence: after inserting a table, is there any
 * way to add or delete a row or a column — and can the inserted table even be
 * filled?
 *
 * Run:
 *   sed "s#'./editorTestUtils'#'../test/editorTestUtils'#" \
 *     src/test/table-ops.probe.tsx > src/shell/probe.test.tsx
 *   PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers npx vitest run src/shell/probe.test.tsx
 *   rm src/shell/probe.test.tsx
 *
 * Same convention as `adr-0001-enter-caret.probe.tsx`: the name does not match
 * `*.test.tsx`, so `pnpm test` does not collect it, while `tsc -b` still checks
 * it. (The copy lands in `src/shell/` because that is what the browser project's
 * `include` globs match — a file under `src/test/` is not collected even when
 * named explicitly on the command line. The `sed` fixes the relative import for
 * the new location.)
 *
 * Findings are written up in `.scratch/table-ops/research.md`.
 */
import { describe, it } from 'vitest'
import {
  renderEditor,
  clickInRun,
  caretFromDom,
  flush,
  type Rendering,
} from './editorTestUtils'

/** A table a user could have typed, with text in every cell. */
const FILLED = '| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n'

/** Exactly what the toolbar's `▦` (⌥⌘T) inserts: `insertSnippet(b, TABLE_SNIPPET)`. */
const FRESH = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n'

function dump(label: string, r: Rendering): void {
  const caret = caretFromDom()
  const lines: string[] = []
  r.container.querySelectorAll('[data-block]').forEach((blk, bi) => {
    blk.querySelectorAll('[data-vline]').forEach((ln) => {
      const l = ln as HTMLElement
      const box = l.getBoundingClientRect()
      const runs = [...l.querySelectorAll('[data-run]')].map((el) => {
        const e = el as HTMLElement
        return `run${e.dataset.run}@src=${e.dataset.src}"${e.textContent}"`
      })
      lines.push(
        `  blk${bi}/vl${l.dataset.vline} cls="${l.className}" box[${Math.round(box.width)}x${Math.round(box.height)}] runs=[${runs.join(' ')}] html=${JSON.stringify(l.innerHTML.slice(0, 90))}`,
      )
    })
  })
  const sel = window.getSelection()
  const anchor = sel?.anchorNode as HTMLElement | null
  const anchorInfo = anchor
    ? `${anchor.nodeName}.${anchor.className ?? ''}@${sel?.anchorOffset}` +
      (anchor.getAttribute?.('data-cell-src') ? `[cell-src=${anchor.getAttribute('data-cell-src')}]` : '') +
      (anchor.getAttribute?.('data-src') ? `[src=${anchor.getAttribute('data-src')}]` : '') +
      (anchor.getAttribute?.('data-vline') ? `[vline=${anchor.getAttribute('data-vline')}]` : '')
    : 'none'
  // eslint-disable-next-line no-console
  console.log(
    `\n### ${label}\n  doc=${JSON.stringify(r.getDoc())}\n  caret=${caret}\n  selection=${anchorInfo}\n${lines.join('\n')}`,
  )
}

/** Focus the host for real — untrusted key events need a focused host. */
async function focused(r: Rendering, doc: string): Promise<void> {
  await clickInRun(r, 0, 0, 0, doc === FILLED ? 'end' : 'start')
  await flush()
}

/** A real pointer click inside the table's body row, at `fraction` of its width. */
async function clickBodyRow(r: Rendering, fraction: number): Promise<void> {
  const line = r.container.querySelector('[data-block="0"] [data-vline="2"]') as HTMLElement
  const box = line.getBoundingClientRect()
  await r.user.pointer({
    target: line,
    keys: '[MouseLeft]',
    coords: { x: box.left + box.width * fraction, y: box.top + box.height / 2 },
  })
  await flush()
}

describe('probe G: gestures on a FILLED table row (caret in the last cell)', () => {
  const GESTURES: Array<[string, string]> = [
    ['G1 Enter', '{Enter}'],
    ['G2 Shift+Enter', '{Shift>}{Enter}{/Shift}'],
    ['G3 Tab', '{Tab}'],
    ['G4 Shift+Tab', '{Shift>}{Tab}{/Shift}'],
    ['G5 Ctrl+Enter (Typora: insert row below)', '{Control>}{Enter}{/Control}'],
    [
      'G6 Ctrl+Shift+Backspace (Typora: delete row)',
      '{Control>}{Shift>}{Backspace}{/Shift}{/Control}',
    ],
    ['G7 Ctrl+L (Typora: select row)', '{Control>}l{/Control}'],
    ['G8 Ctrl+E (Typora: select cell)', '{Control>}e{/Control}'],
  ]

  for (const [label, keys] of GESTURES) {
    it(label, async () => {
      const r = renderEditor(FILLED)
      await flush()
      await clickInRun(r, 0, 2, 1, 'end')
      await flush()
      await r.user.keyboard(keys)
      await flush()
      dump(`${label} — caret at the end of the row's last cell`, r)
    })
  }

  it('G9 type " | c |" inside a cell (growing a row by hand)', async () => {
    const r = renderEditor(FILLED)
    await flush()
    await clickInRun(r, 0, 2, 1, 'end')
    await flush()
    await r.user.keyboard(' | c |')
    await flush()
    dump('G9 after typing " | c |"', r)
  })

  it('G10 paste a row of pipes inside a cell', async () => {
    const r = renderEditor(FILLED)
    await flush()
    await clickInRun(r, 0, 2, 1, 'end')
    await flush()
    await r.user.paste('| c | d |')
    await flush()
    dump('G10 after pasting "| c | d |"', r)
  })

  it('G11 select the whole row (native range) then Backspace', async () => {
    const r = renderEditor(FILLED)
    await flush()
    await clickInRun(r, 0, 2, 0, 'start')
    await flush()
    // The pipes are unaddressable, so the largest selection a human can make
    // covers the visible cell text only — from the first cell's start to the
    // last cell's end.
    const first = r.container.querySelector(
      '[data-block="0"] [data-vline="2"] [data-run="0"]',
    )?.firstChild as Node
    const last = r.container.querySelector(
      '[data-block="0"] [data-vline="2"] [data-run="1"]',
    )?.firstChild as Node
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, (last.textContent ?? '').length)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await flush()
    dump('G11 with the whole row selected', r)
    await r.user.keyboard('{Backspace}')
    await flush()
    dump('G11 after Backspace', r)
  })
})

describe('probe F: a FRESHLY inserted table (the skeleton the toolbar inserts)', () => {
  it('F1 the rendered skeleton', async () => {
    const r = renderEditor(FRESH)
    await flush()
    dump('F1 skeleton as inserted', r)
  })

  it('F2 click the data row and type one character', async () => {
    const r = renderEditor(FRESH)
    await flush()
    await focused(r, FRESH)
    await clickBodyRow(r, 0.5)
    dump('F2 after clicking the empty data row', r)
    await r.user.keyboard('x')
    await flush()
    dump('F2 after typing "x"', r)
  })

  it('F3 type a second character (does the first survive?)', async () => {
    const r = renderEditor(FRESH)
    await flush()
    await focused(r, FRESH)
    await clickBodyRow(r, 0.5)
    await r.user.keyboard('x')
    await flush()
    dump('F3 after the first "x"', r)
    await r.user.keyboard('y')
    await flush()
    dump('F3 after the second "y"', r)
  })

  it('F4 click the data row and press Backspace', async () => {
    const r = renderEditor(FRESH)
    await flush()
    await focused(r, FRESH)
    await clickBodyRow(r, 0.5)
    await r.user.keyboard('{Backspace}')
    await flush()
    dump('F4 after Backspace', r)
  })

  it('F5 type a whole row of pipes into the data row', async () => {
    const r = renderEditor(FRESH)
    await flush()
    await focused(r, FRESH)
    await clickBodyRow(r, 0.5)
    await r.user.keyboard('a | b |')
    await flush()
    dump('F5 after typing "a | b |"', r)
  })

  it('F6 fill the header cell, then click the data row and type', async () => {
    const r = renderEditor(FRESH)
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await r.user.keyboard('X')
    await flush()
    dump('F6 after typing "X" in the header cell', r)
    await clickBodyRow(r, 0.5)
    await r.user.keyboard('y')
    await flush()
    dump('F6 after clicking the data row and typing "y"', r)
  })
})
