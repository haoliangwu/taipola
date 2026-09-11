/**
 * ADR-0001 evidence probe — NOT collected by the test suite.
 *
 * vitest collects only `*.test.ts` / `*.test.tsx` under `src/`, and this file is
 * named `*.probe.tsx`, so `pnpm test` ignores it (while `tsc -b` still checks
 * it). To run it:
 *
 *   cp src/test/adr-0001-enter-caret.probe.tsx src/test/probe.test.tsx
 *   PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers npx vitest run src/test/probe.test.tsx
 *   rm src/test/probe.test.tsx
 *
 * Scenarios (raw output is recorded in docs/adr-0001-editor-core-native.md §5):
 *   S1 paragraph line-end Enter x2 then a real keypress -> the typed text glues
 *      onto the next paragraph (`X第二段`)
 *   S2 list item line-end Enter x2 -> the following item is rewritten as
 *      `- - 第二项` (silent structural damage)
 *   S3 heading line-end Enter then Backspace -> the heading loses a character,
 *      one blank line disappears, DOM and model diverge for good, the caret
 *      leaves every block and further keystrokes are swallowed (no error thrown)
 *   S4 mid-heading Enter (caret placed with a native Range) -> correct today;
 *      proves the suite's mid-line clicks never exercised this path
 *   S5 six line-end Enters -> the caret parks at the next paragraph instead of
 *      following the new blank lines
 *   S6 blank-line click + raw keypress (control for `typeText`, which clicks the
 *      container before typing)
 *
 * Keys are REAL (userEvent keyboard). The caret is placed through the native
 * Selection API because `clickInRun()` lands at line end for mid-text clicks.
 */
import { describe, it, vi } from 'vitest'
import {
  renderEditor,
  pressBackspace,
  pressEnter,
  clickInRun,
  clickAtLine,
  flush,
  caretFromDom,
  type Rendering,
} from './editorTestUtils'

/** Place the caret inside a run at a real character offset (native Range). */
function setCaretInRun(
  r: Rendering,
  block: number,
  vline: number,
  run: number,
  ch: number,
): void {
  const el = r.runEl(block, vline, run)
  if (!el) throw new Error(`run ${block}/${vline}/${run} not found`)
  const range = document.createRange()
  const node = el.firstChild
  if (node && node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.min(ch, node.textContent?.length ?? 0))
  } else {
    range.setStart(el, 0)
  }
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

interface Snap {
  step: string
  doc: string
  caret: number
  caretLine: number
  caretLineText: string
  domLine: string | null
  domLineText: string | null
  domTextMatches: boolean
}

function snap(step: string, r: Rendering): Snap {
  const doc = r.getDoc()
  const caret = caretFromDom()
  const c = caret ?? -1
  const lines = doc.split('\n')
  const caretLine = c >= 0 ? (doc.slice(0, c).match(/\n/g) ?? []).length : 0
  const sel = window.getSelection()
  const anc = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
  const el = anc instanceof Element ? anc : (anc?.parentElement ?? null)
  const lineEl = (el?.closest?.('[data-vline]') ?? null) as HTMLElement | null
  const domText = [...r.container.querySelectorAll('.vl')]
    .map((n) => n.textContent ?? '')
    .join('\n')
  return {
    step,
    doc: JSON.stringify(doc),
    caret: c,
    caretLine,
    caretLineText: JSON.stringify(caretLine < lines.length ? lines[caretLine] : null),
    domLine: lineEl?.getAttribute('data-vline') ?? null,
    domLineText: JSON.stringify(lineEl?.textContent ?? null),
    domTextMatches: domText === doc,
  }
}

function watchErrors(run: (record: (m: string) => void, errors: string[]) => Promise<void>) {
  return async () => {
    const errors: string[] = []
    const record = (m: string) => errors.push(m)
    const onError = (e: ErrorEvent) => record(`window.error: ${e.message || String(e.error)}`)
    const onRej = (e: PromiseRejectionEvent) => record(`unhandledrejection: ${String(e.reason)}`)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRej)
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      record(`console.error: ${a.map((x) => String(x)).join(' ')}`)
    })
    try {
      await run(record, errors)
    } finally {
      spy.mockRestore()
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }
}

type Plan = Array<[string, () => Promise<void> | void]>

async function steps(
  r: Rendering,
  trace: Snap[],
  record: (m: string) => void,
  plan: Plan,
): Promise<void> {
  for (const [label, act] of plan) {
    try {
      await act()
      await flush()
      trace.push(snap(label, r))
    } catch (e) {
      record(`thrown at ${label}: ${String(e)}`)
      break
    }
  }
}

const X = (r: Rendering) => () => r.user.keyboard('X')
const enter = (r: Rendering) => () => pressEnter(r)
const backspace = (r: Rendering) => () => pressBackspace(r)

describe('PROBE', () => {
  it(
    'S1 段落行末 Enter×2 + 键盘 X',
    watchErrors(async (record, errors) => {
      const r = renderEditor('第一段文字\n\n第二段\n')
      const trace: Snap[] = []
      await clickInRun(r, 0, 0, 0, 1.0)
      await flush()
      trace.push(snap('caret at line end', r))
      await steps(r, trace, record, [
        ['Enter#1', enter(r)],
        ['Enter#2', enter(r)],
        ['keyboard X', X(r)],
      ])
      console.log('S1 ' + JSON.stringify({ trace, errors: [...errors] }))
    }),
  )

  it(
    'S2 列表项末 Enter ×2 + 键盘 X + Backspace',
    watchErrors(async (record, errors) => {
      const r = renderEditor('- 第一项\n- 第二项\n')
      const trace: Snap[] = []
      await clickInRun(r, 0, 0, 1, 1.0)
      await flush()
      trace.push(snap('caret at item end', r))
      await steps(r, trace, record, [
        ['Enter#1', enter(r)],
        ['Enter#2', enter(r)],
        ['keyboard X', X(r)],
        ['Backspace', backspace(r)],
      ])
      console.log('S2 ' + JSON.stringify({ trace, errors: [...errors] }))
    }),
  )

  it(
    'S3 标题行末 Enter → Backspace（静默损坏）',
    watchErrors(async (record, errors) => {
      const r = renderEditor('# 标题\n\n正文\n')
      const trace: Snap[] = []
      await clickInRun(r, 0, 0, 1, 1.0)
      await flush()
      trace.push(snap('caret at line end', r))
      await steps(r, trace, record, [
        ['Enter#1', enter(r)],
        ['Backspace', backspace(r)],
        ['keyboard X', X(r)],
      ])
      console.log('S3 ' + JSON.stringify({ trace, errors: [...errors] }))
    }),
  )

  it(
    'S4 标题中间 Enter → Backspace（真中线光标）',
    watchErrors(async (record, errors) => {
      const r = renderEditor('# 标题文字\n\n正文\n')
      const trace: Snap[] = []
      setCaretInRun(r, 0, 0, 1, 2)
      await flush()
      trace.push(snap('caret mid-heading', r))
      await steps(r, trace, record, [
        ['Enter#1', enter(r)],
        ['keyboard X', X(r)],
        ['Backspace', backspace(r)],
        ['Backspace#2', backspace(r)],
      ])
      console.log('S4 ' + JSON.stringify({ trace, errors: [...errors] }))
    }),
  )

  it(
    'S5 段落行末 Enter×6',
    watchErrors(async (record, errors) => {
      const r = renderEditor('甲\n\n乙\n')
      const trace: Snap[] = []
      await clickInRun(r, 0, 0, 0, 1.0)
      await flush()
      trace.push(snap('caret at line end', r))
      await steps(
        r,
        trace,
        record,
        [1, 2, 3, 4, 5, 6].map(
          (i) => [`Enter#${i}`, enter(r)] as [string, () => Promise<void>],
        ),
      )
      console.log('S5 ' + JSON.stringify({ trace, errors: [...errors] }))
    }),
  )

  it(
    'S6 空行点击后键盘打字（对照 typeText 的容器中心点击）',
    watchErrors(async (record, errors) => {
      const r = renderEditor('- 一项\n\n补\n')
      const trace: Snap[] = []
      await clickAtLine(r, 1, 0)
      await flush()
      trace.push(snap('caret on blank line', r))
      await steps(r, trace, record, [['keyboard 字', () => r.user.keyboard('字')]])
      console.log('S6 ' + JSON.stringify({ trace, errors: [...errors] }))
    }),
  )
})
