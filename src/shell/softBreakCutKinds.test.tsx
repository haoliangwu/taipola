import { describe, it, expect, } from 'vitest'
import {
  renderEditor,
  flush,
  caretFromDom,
  clickInRun,
  clickAtLine,
  pressShiftEnter,
  pressEnter,
  pressBackspace,
  pressUndo,
  pressRedo,
  typeText,
  type Rendering,
} from '../test/editorTestUtils'
import { invariants, putCaret } from '../test/softBreakCutHelpers'

/**
 * Cut-1 kind DATA-LAYER cells (ADR-0005 §2.1, matrix §1 rules R2/R3/R4/R5/R6/R7).
 *
 * Deliberately asserts doc + caret + `getKinds()` ONLY — no `boxes`. The target
 * box counts are fixed in the cut-2 matrix (`.scratch/soft-break-cuts/test-matrix.md`
 * §3); under cut 1's renderer they differ (structural separators and the
 * trailing blank still draw line boxes), so those cells live in the main matrix
 * file and are marked pending. The data layer itself — the identity of every
 * session-opened blank line — must be exactly right here, and green.
 *
 * `soft(r)` = the set of offsets whose kind is 's' (soft). Structural 'S' keys
 * are implied (every other blank line) and checked through `invariants` (no
 * orphans, every key a blank line start).
 */

function soft(r: Rendering): number[] {
  return [...r.getKinds()]
    .filter(([, k]) => k === 's')
    .map(([at]) => at)
    .sort((a, b) => a - b)
}

/** Assert doc, caret and the soft-offset set together, then run invariants. */
async function step(r: Rendering, label: string, op: () => Promise<void>, want: {
  doc: string
  caret: number
  soft: number[]
}): Promise<void> {
  await op()
  await flush()
  expect(r.getDoc(), `${label} doc`).toBe(want.doc)
  expect(caretFromDom(), `${label} caret`).toBe(want.caret)
  expect(soft(r), `${label} soft kinds`).toEqual(want.soft)
  await invariants(r, label)
}

describe('soft-break kind 数据层（cut 1）', () => {
  it('R7 载入即全 S：任何文件空行都无会话身份', async () => {
    const r = renderEditor('aa\n\n\n\n\nab\n')
    await flush()
    // 全部 structural：一个 s 都没有。
    expect(soft(r)).toEqual([])
    for (const [at, k] of r.getKinds()) expect(k, `@${at}`).toBe('S')
    await invariants(r)
  })

  it('R2 line-end Shift+Enter：开出的空行记 s（A-w-SE 系列）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end') // caret 4 = 行末
    await flush()
    // SE×1 → s@5
    await step(r, 'SE1', () => pressShiftEnter(r), { doc: 'aaab\n\n', caret: 5, soft: [5] })
    // SE×3（从新 caret 继续）→ s@6, s@7 累加
    await step(r, 'SE2', () => pressShiftEnter(r), { doc: 'aaab\n\n\n', caret: 6, soft: [5, 6] })
  })

  it('R2 line-start Shift+Enter：上方空行记 s（A-h-SE 系列）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    putCaret(r, 0, 0, 0, 0) // caret 0 = 行首
    await flush()
    await step(r, 'SE1', () => pressShiftEnter(r), { doc: '\naaab\n', caret: 1, soft: [0] })
    await step(r, 'SE3', () => pressShiftEnter(r), { doc: '\n\naaab\n', caret: 2, soft: [0, 1] })
  })

  it('R2 mid-line Shift+Enter：纯内容续行，无 kind 条目（A-m-SE1）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    putCaret(r, 0, 0, 0, 2) // aa|ab
    await flush()
    await step(r, 'SE1', () => pressShiftEnter(r), { doc: 'aa\nab\n', caret: 3, soft: [] })
    await step(r, 'SE2', () => pressShiftEnter(r), { doc: 'aa\n\nab\n', caret: 4, soft: [3] })
  })

  it('R3 行尾 Enter：占位空行记 s（A-w-Enter1）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await step(r, 'Enter1', () => pressEnter(r), { doc: 'aaab\n\n', caret: 5, soft: [5] })
  })

  it('R3 行首 Enter：上方新空行记 s（A-h-Enter1）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    putCaret(r, 0, 0, 0, 0)
    await flush()
    await step(r, 'Enter1', () => pressEnter(r), { doc: '\naaab\n', caret: 1, soft: [0] })
  })

  it('R3 行中 Enter：拆段空行是 S（A-m-Enter1）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    putCaret(r, 0, 0, 0, 2)
    await flush()
    await step(r, 'Enter1', () => pressEnter(r), {
      doc: 'aa\n\nab\n',
      caret: 4,
      soft: [],
    })
  })

  it('R4 BS 弹链：条目随 commit 平移，链弹尽条目不残留（A-m-BS-pop-cycle）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    putCaret(r, 0, 0, 0, 2)
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    expect(soft(r)).toEqual([3, 4, 5, 6]) // s×4（SE×5 产出 4 根链空行）
    // 逐个弹：s 集逐步缩小，偏移即被删 \n 的偏移。
    await step(r, 'BS1', () => pressBackspace(r), {
      doc: 'aa\n\n\n\nab\n',
      caret: 6,
      soft: [3, 4, 5],
    })
    await step(r, 'BS2', () => pressBackspace(r), {
      doc: 'aa\n\n\nab\n',
      caret: 5,
      soft: [3, 4],
    })
    await step(r, 'BS3', () => pressBackspace(r), { doc: 'aa\n\nab\n', caret: 4, soft: [3] })
    await step(r, 'BS4', () => pressBackspace(r), { doc: 'aa\nab\n', caret: 3, soft: [] })
  })

  it('R5 链上打字：该 s 条目清除（A-w-type-row 的打字半程）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    await pressShiftEnter(r)
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(soft(r)).toEqual([5, 6, 7])
    // 点进链中第 2 行（vline 1）并打字：该行变内容行，s 条目清除。
    await clickAtLine(r, 1, 1)
    await flush()
    await typeText(r, 'X')
    await flush()
    expect(soft(r)).not.toContain(6)
    await invariants(r, 'typed')
  })

  it('R6 undo/redo：快照含 kind，整体还原（A-w-undo-redo）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(soft(r)).toEqual([5])
    await pressUndo(r)
    await flush()
    // kind 数组随快照回滚：s 条目消失。
    expect(r.getDoc()).toBe('aaab\n')
    expect(caretFromDom()).toBe(4)
    expect(soft(r)).toEqual([])
    await invariants(r, 'undo')
    await pressRedo(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n\n')
    expect(soft(r)).toEqual([5])
    await invariants(r, 'redo')
  })

  it('R6 redo 的三份回滚：SE×3 撤销留 2 个 s，重做回 3 个（A-undo-redo(3)）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    expect(soft(r)).toEqual([5, 6, 7])
    await pressUndo(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n\n\n')
    expect(soft(r)).toEqual([5, 6])
    await pressRedo(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n\n\n\n')
    expect(soft(r)).toEqual([5, 6, 7])
    await invariants(r, 'redo3')
  })

  it('R7 重开即收敛：同一 doc 重新 load，kind 全 S（无会话视觉）', async () => {
    const r = renderEditor('aa\n\n\n\n\nab\n')
    await flush()
    expect(soft(r)).toEqual([])
    expect([...r.getKinds()].every(([, k]) => k === 'S')).toBe(true)
  })

  it('样本 B：跨分隔双段，SE/Enter 只标新行（B-w-SE1 与 B-w2-w）', async () => {
    const r = renderEditor('甲乙\n\n丙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end') // caret 2 = 甲乙 行尾
    await flush()
    await step(r, 'B-w-SE1', () => pressShiftEnter(r), {
      doc: '甲乙\n\n\n丙\n',
      caret: 3,
      soft: [3],
    })
    const s = renderEditor('甲乙\n\n丙\n')
    await flush()
    await clickInRun(s, 2, 0, 0, 'end') // caret 5 = 丙 行尾
    await flush()
    await step(s, 'B-w2-w-SE1', () => pressShiftEnter(s), {
      doc: '甲乙\n\n丙\n\n',
      caret: 6,
      soft: [6],
    })
  })

  it('样本 C：标题行末 SE 记 s，行中拆号无条目（C-w-SE1 / C-m-SE1）', async () => {
    const r = renderEditor('# 标\n\n正文\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end') // caret 3 = 标题行尾（run 1 = 文本）
    await flush()
    await step(r, 'C-w-SE1', () => pressShiftEnter(r), {
      doc: '# 标\n\n\n正文\n',
      caret: 4,
      soft: [4],
    })
    const s = renderEditor('# 标\n\n正文\n')
    await flush()
    await clickInRun(s, 0, 0, 1, 'start') // caret 2 = 空格与标之间
    await flush()
    await step(s, 'C-m-SE1', () => pressShiftEnter(s), {
      doc: '# \n标\n\n正文\n',
      caret: 3,
      soft: [],
    })
  })

  it('家族②③不进 kind：quote 与 list 的 SE 行是内容行（D/E）', async () => {
    const e = renderEditor('> 引\n\n后文\n')
    await flush()
    await clickInRun(e, 0, 0, 1, 'end') // caret 3 = 引 行尾
    await flush()
    await step(e, 'E-w-SE1', () => pressShiftEnter(e), {
      doc: '> 引\n> \n\n后文\n',
      caret: 6,
      soft: [],
    })
    const d = renderEditor('- 一\n- 二\n')
    await flush()
    await clickInRun(d, 0, 0, 1, 'end')
    await flush()
    // 现状钉桩（matrix §8）：家族② = 现状即为验收。list 行尾 SE 的 fresh 行
    // 是纯换行（只对 > 前缀复制 marker），实测钉桩 `- 一\n\n- 二\n` caret 4 —
    // 与矩阵 §4.2 草稿期望不同，已按钉桩值冻结（图钉说明见 index.md）。
    await step(d, 'D-w-SE1(钉桩)', () => pressShiftEnter(d), {
      doc: '- 一\n\n- 二\n',
      caret: 4,
      soft: [],
    })
  })
})