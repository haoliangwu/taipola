import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  caretFromDom,
  flush,
  clickInRun,
  pressShiftEnter,
  pressBackspace,
  typeText,
  assertDomMatchesSource,
} from '../test/editorTestUtils'

/**
 * typora-parity：软断链（空白链）视图。线上复现（e6bbdc1 部署）：aaab 行中
 * Shift+Enter×5 → 一屏空白行；一次 Backspace → 整链消失；再按数次才回 aaab。
 *
 * 修复后的不变量（本套件钉住）：
 *   - SE 链的每一行都是可见行盒（BPH 块，行数 = 链长 − 分隔行）；
 *   - 链内每次 Backspace = 删一个 `\n` + 移走一行盒，光标骑上一行；
 *   - 光标在链上始终可见；链清空后光标在断点（段末，或软接续行的行首），
 *     下一次 Backspace 再接续（合并两行/删断点前一字符）；
 *   - 源码逐字节往返。
 */

function stackRows(r: ReturnType<typeof renderEditor>): HTMLElement[] {
  return [
    ...r.container.querySelectorAll<HTMLElement>('.blk[data-placeholder] [data-vline]'),
  ]
}

describe('软断链视图（typora-parity）', () => {
  it('mid-line：SE×5 后每 Backspace 精确移走一行，链尾合并回原文', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    // 行中光标：aa|ab（offset 2）。
    const run = r.runEl(0, 0, 0)!
    const sel = window.getSelection()
    const range = document.createRange()
    range.setStart(run.firstChild!, 2)
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
    r.container.focus({ preventScroll: true })
    await flush()
    for (let i = 1; i <= 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
    // 4 行可见（5 个空行里 4 个是链行）。
    expect(stackRows(r).length).toBe(4)
    // 逐个弹：每一弹 doc 少一个 `\n`、可见行少一行。
    for (let i = 4; i >= 1; i--) {
      await pressBackspace(r)
      await flush()
      expect(stackRows(r).length).toBe(i - 1)
      expect(r.getDoc()).toBe(`aa\n${'\n'.repeat(i - 1)}ab\n`)
    }
    // 链清空后只剩软接续：下一次 Backspace 合并两行。
    expect(r.getDoc()).toBe('aa\nab\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n')
    expect(caretFromDom()).toBe(2)
    await assertDomMatchesSource(r)
  })

  it('line-end：SE×3 链 + 逐弹；弹完后接续/或字符删除', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    for (let i = 1; i <= 3; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    expect(r.getDoc()).toBe('甲\n\n\n\n乙\n')
    expect(stackRows(r).length).toBe(3)
    for (let i = 3; i >= 1; i--) {
      await pressBackspace(r)
      await flush()
      expect(r.getDoc()).toBe(`甲\n${'\n'.repeat(i - 1)}乙\n`)
    }
    await pressBackspace(r)
    await flush()
    // 最后一个弹清空链后回到段末（断点），这一弹仍在链语义里：合并到 甲。
    expect(r.getDoc()).toBe('甲乙\n')
    await assertDomMatchesSource(r)
  })

  it('line-start：链内打字 re-home 进该行', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 2, 0, 0, 'start')
    await flush()
    await pressShiftEnter(r)
    await flush()
    await pressShiftEnter(r)
    await flush()
    const rows = stackRows(r)
    // 3 行盒 = 2 个新行 + 1 个预存分隔（行首链隐藏首行：`data-ph-sep-after`）。
    expect(rows.length).toBe(3)
    // 点进上方旧行并打字：字符落那一行。
    const visible = rows.filter((l) => getComputedStyle(l).display !== 'none')
    const first = visible[0]!
    const s = window.getSelection()
    const rg = document.createRange()
    rg.setStart(first.firstChild ?? first, 0)
    rg.collapse(true)
    s?.removeAllRanges()
    s?.addRange(rg)
    r.container.focus({ preventScroll: true })
    await flush()
    await typeText(r, 'X')
    await flush()
    expect(r.getDoc()).toContain('X')
    await assertDomMatchesSource(r)
  })
})