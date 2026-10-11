import { describe, it } from 'vitest'
import {
  renderEditor,
  flush,
  clickInRun,
  pressShiftEnter,
  pressEnter,
  pressBackspace,
  caretInTableCell,
  type Rendering,
} from '../test/editorTestUtils'
import { expectTriple, invariants } from '../test/softBreakCutHelpers'

/**
 * Matrix §4/§5: family ② (quote/list) and ③ (table) — CURRENT behavior is the
 * acceptance (`维持现状即为验收`, test-matrix §4 门槛). The triples below are
 * 钉桩 values frozen from a measurement run on the untouched kernel
 * (`.scratch/soft-break-cuts/index.md` records the session); after cut 2 they
 * must stay byte-identical. Where the frozen value differs from the matrix
 * §4/§5 table's prose, the frozen value wins (test-matrix §8: 写回实测值并冻结).
 *
 * 钉桩 deltas vs the §4/§5 prose cells, all FROZEN as current behavior:
 * - `D-w-SE1`: SE at a list line end inserts a PLAIN `\n` (no `- ` copy) —
 *   `- 一\n\n- 二\n` caret 4 (prose predicted `- 一\n- \n- 二\n` caret 6).
 * - `E-h-SE1`: SE at a quote line START re-repeats the marker on the pushed
 *   line — `\n> > 引\n` caret 3 (prose predicted `\n> 引` caret 1).
 * - `F-SE(a)`: `<br />` lands BEFORE the cell text (`| <br />a |`), matching
 *   the cell's documented content-start caret.
 * - `F-Enter(a)`: caret lands at 26, not the prose's 22.
 * - `F-Enter-last` / `F-BS(a)`: caret not inside a run at read time (null);
 *   recorded honestly.
 */

function putCaret(r: Rendering, block: number, vline: number, run: number, at: number): void {
  const el = r.runEl(block, vline, run)!
  const sel = window.getSelection()
  const range = document.createRange()
  range.setStart(el.firstChild!, at)
  range.collapse(true)
  sel?.removeAllRanges()
  sel?.addRange(range)
  r.container.focus({ preventScroll: true })
}

async function se(r: Rendering, n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await pressShiftEnter(r)
    await flush()
  }
}
async function bs(r: Rendering, n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await pressBackspace(r)
    await flush()
  }
}

describe('matrix §4.1 家族② quote（样本 E，钉桩·现状为验收）', () => {
  it('E-w-SE1 / E-w-SE3 / E-w-BS×3 逐弹（钉桩）', async () => {
    const r = renderEditor('> 引\n\n后文\n')
    await flush()
    putCaret(r, 0, 0, 1, 1) // `> 引` 行尾 = 3
    await flush()
    await se(r)
    expectTriple(r, 'E-w-SE1', { doc: '> 引\n> \n\n后文\n', caret: 6, boxes: 4 })
    await invariants(r, 'E-w-SE1')
    await se(r, 2)
    expectTriple(r, 'E-w-SE3', { doc: '> 引\n> \n> \n> \n\n后文\n', caret: 12, boxes: 7 })
    await invariants(r, 'E-w-SE3')
    await bs(r)
    expectTriple(r, 'E-w-BS1', { doc: '> 引\n> \n> \n\n\n后文\n', caret: 10, boxes: 7 })
    await invariants(r, 'E-w-BS1')
    await bs(r)
    expectTriple(r, 'E-w-BS2', { doc: '> 引\n> \n> \n\n后文\n', caret: 9, boxes: 6 })
    await invariants(r, 'E-w-BS2')
    await bs(r)
    expectTriple(r, 'E-w-BS3', { doc: '> 引\n> \n\n\n后文\n', caret: 4, boxes: 4 })
    await invariants(r, 'E-w-BS3')
  })

  it('E-w-Enter1（钉桩）', async () => {
    const r = renderEditor('> 引\n\n后文\n')
    await flush()
    putCaret(r, 0, 0, 1, 1)
    await flush()
    await pressEnter(r)
    await flush()
    expectTriple(r, 'E-w-Enter1', { doc: '> 引\n> \n\n后文\n', caret: 6, boxes: 4 })
    await invariants(r, 'E-w-Enter1')
  })

  it('E-h-SE1 / E-h-BS1（钉桩：前缀行上方 SE 重复 `> `）', async () => {
    const r = renderEditor('> 引\n\n后文\n')
    await flush()
    putCaret(r, 0, 0, 0, 0)
    await flush()
    await se(r)
    expectTriple(r, 'E-h-SE1', { doc: '\n> > 引\n\n后文\n', caret: 3, boxes: 3 })
    await invariants(r, 'E-h-SE1')
    await bs(r)
    expectTriple(r, 'E-h-BS1', { doc: '\n>> 引\n\n后文\n', caret: 2, boxes: 3 })
    await invariants(r, 'E-h-BS1')
  })
})

describe('matrix §4.2 家族② list（样本 D，钉桩·现状为验收）', () => {
  it('D-w-SE1 / D-w-SE3 / D-w-BS×3 逐弹（钉桩）', async () => {
    const r = renderEditor('- 一\n- 二\n')
    await flush()
    putCaret(r, 0, 0, 1, 1) // `- 一` 行尾 = 3
    await flush()
    await se(r)
    expectTriple(r, 'D-w-SE1', { doc: '- 一\n\n- 二\n', caret: 4, boxes: 4 })
    await invariants(r, 'D-w-SE1')
    await se(r, 2)
    expectTriple(r, 'D-w-SE3', { doc: '- 一\n\n\n\n- 二\n', caret: 6, boxes: 6 })
    await invariants(r, 'D-w-SE3')
    await bs(r)
    expectTriple(r, 'D-w-BS1', { doc: '- 一\n\n\n- 二\n', caret: 5, boxes: 5 })
    await invariants(r, 'D-w-BS1')
    await bs(r)
    expectTriple(r, 'D-w-BS2', { doc: '- 一\n\n- 二\n', caret: 4, boxes: 4 })
    await invariants(r, 'D-w-BS2')
    await bs(r)
    expectTriple(r, 'D-w-BS3', { doc: '- 一\n- 二\n', caret: 3, boxes: 3 })
    await invariants(r, 'D-w-BS3')
  })

  it('D-w-Enter1 / D-w-Enter2 退出（钉桩）', async () => {
    const r = renderEditor('- 一\n- 二\n')
    await flush()
    putCaret(r, 0, 0, 1, 1)
    await flush()
    await pressEnter(r)
    await flush()
    expectTriple(r, 'D-w-Enter1', { doc: '- 一\n- \n- 二\n', caret: 6, boxes: 4 })
    await invariants(r, 'D-w-Enter1')
    await pressEnter(r)
    await flush()
    expectTriple(r, 'D-w-Enter2', { doc: '- 一\n\n- 二\n', caret: 4, boxes: 4 })
    await invariants(r, 'D-w-Enter2')
  })

  it('D-h-SE1（钉桩：上方新空行，不进 kind）', async () => {
    const r = renderEditor('- 一\n- 二\n')
    await flush()
    putCaret(r, 0, 0, 0, 0)
    await flush()
    await se(r)
    expectTriple(r, 'D-h-SE1', { doc: '\n- 一\n- 二\n', caret: 1, boxes: 3 })
    await invariants(r, 'D-h-SE1')
  })
})

describe('matrix §5 家族③ table（样本 F，钉桩·现状为验收）', () => {
  it('F-SE(a) / F-Enter(a)：格内软断为字面 `<br />`，Enter 同列移动（钉桩）', async () => {
    const r = renderEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    await caretInTableCell(r, 0, 0)
    r.container.focus({ preventScroll: true })
    await flush()
    await pressShiftEnter(r)
    await flush()
    expectTriple(r, 'F-SE(a)', { doc: '| <br />a | b |\n| --- | --- |\n| 1 | 2 |\n', caret: 8, boxes: 4 })
    await invariants(r, 'F-SE(a)')

    const s = renderEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    await caretInTableCell(s, 0, 0)
    s.container.focus({ preventScroll: true })
    await flush()
    await pressEnter(s)
    await flush()
    expectTriple(s, 'F-Enter(a)', { doc: '| a | b |\n| --- | --- |\n| 1 | 2 |\n', caret: 26, boxes: 4 })
    await invariants(s, 'F-Enter(a)')
  })

  it('F-Enter-last：末格 Enter 加一行（钉桩）', async () => {
    const r = renderEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    await caretInTableCell(r, 2, 1)
    r.container.focus({ preventScroll: true })
    await flush()
    await pressEnter(r)
    await flush()
    expectTriple(r, 'F-Enter-last', {
      doc: '| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n',
      caret: null,
      boxes: 5,
    })
    await invariants(r, 'F-Enter-last')
  })

  it('F-BS(a)：格内容起点 BS（钉桩：不改 doc）', async () => {
    const r = renderEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    await caretInTableCell(r, 0, 0)
    r.container.focus({ preventScroll: true })
    await flush()
    await pressBackspace(r)
    await flush()
    expectTriple(r, 'F-BS(a)', { doc: '| a | b |\n| --- | --- |\n| 1 | 2 |\n', caret: null, boxes: 4 })
    await invariants(r, 'F-BS(a)')
  })
})

// Re-export nothing; keep the click helper import lint-clean.
void clickInRun