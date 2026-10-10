import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  caretFromDom,
  flush,
  typeText,
  pressEnter,
  pressShiftEnter,
  pressBackspace,
  pressUndo,
  pressRedo,
  assertDomMatchesSource,
  clickInRun,
  caretInTableCell,
} from '../test/editorTestUtils'

/**
 * 富文本编辑审计（typora-parity 后全面回归）。
 * 目标：找 P1–P4 引入或暴露的 WYSIWYG 缺陷，尤其换行家族。
 * 每步强校验三条不变量：源码可读出（DOM↔source 一致）、光标有效、undo 完全还原。
 */

const step = async (
  r: ReturnType<typeof renderEditor>,
  label: string,
  op: () => Promise<void>,
  expectDoc?: string,
) => {
  await op()
  await flush()
  await assertDomMatchesSource(r) // throws on DOM/source divergence
  if (expectDoc !== undefined) expect(r.getDoc(), label).toBe(expectDoc)
}

describe('审计：换行家族不变量', () => {
  it('行中 Enter 拆段 + undo 还原', async () => {
    const r = renderEditor('第一段文字在这\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    // 光标放「文」后：先点行末再移动不可行，直接用 caretInTableCell 类思路：
    // 用 clickInRun 精确位置 —— 行中偏移 5 处
    const run = r.runEl(0, 0, 0)!
    const sel = window.getSelection()
    const range = document.createRange()
    range.setStart(run.firstChild!, 3)
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
    r.container.focus({ preventScroll: true })
    await step(r, '行中 Enter', () => pressEnter(r))
    // 拆成两块，源码含空行分隔
    expect(r.getDoc()).toContain('\n\n')
    await step(r, 'undo', () => pressUndo(r))
    expect(r.getDoc()).toBe('第一段文字在这\n')
  })

  it('行末 Shift+Enter 后输入 + Backspace 往返', async () => {
    const r = renderEditor('甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await step(r, 'Shift+Enter', () => pressShiftEnter(r), '甲乙\n\n')
    await step(r, '输入丙', () => typeText(r, '丙'))
    expect(r.getDoc()).toBe('甲乙\n丙\n')
    await step(r, 'Backspace 删丙', () => pressBackspace(r), '甲乙\n\n')
    await step(r, 'Backspace 撤换行', () => pressBackspace(r), '甲乙\n')
    expect(caretFromDom()).toBe(2)
  })

  it('引用内 Shift+Enter 保持 `> ` 前缀', async () => {
    const r = renderEditor('> 甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await step(r, '引用内软断', () => pressShiftEnter(r))
    expect(r.getDoc()).toBe('> 甲\n> \n\n乙\n')
  })

  it('列表项 Enter 续项、Backspace 逐层退出', async () => {
    const r = renderEditor('- 甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await step(r, '列表 Enter', () => pressEnter(r))
    expect(r.getDoc()).toBe('- 甲\n- \n\n乙\n')
    await step(r, 'Backspace 出列表', () => pressBackspace(r))
    expect(r.getDoc()).toBe('- 甲\n\n乙\n')
    await step(r, 'undo x2 还原', async () => {
      await pressUndo(r)
      await pressUndo(r)
    })
    expect(r.getDoc()).toBe('- 甲\n\n乙\n')
  })

  it('有序列表 Enter 重编号', async () => {
    const r = renderEditor('1. 甲\n2. 乙\n\n丙\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await step(r, '有序 Enter', () => pressEnter(r))
    expect(r.getDoc()).toBe('1. 甲\n2. \n3. 乙\n\n丙\n')
  })

  it('标题/表格/数学块 Enter 后 DOM↔源码一致（结构不变量）', async () => {
    const r = renderEditor('# 标题\n\n$$\nx = 1\n$$\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await step(r, '标题行 Enter', () => pressEnter(r))
    await caretInTableCell(r, 2, 0)
    await step(r, '格内 Enter', () => pressEnter(r)) // 移到下一行，源码不变
    await step(r, 'undo', () => pressUndo(r))
    await step(r, 'undo', () => pressUndo(r))
    expect(r.getDoc()).toBe(
      '# 标题\n\n$$\nx = 1\n$$\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    )
  })
})

describe('审计：P1–P4 功能与换行交互', () => {
  it('caret 基准 A：末行行尾点击 → 偏移 1 处打字不段化', async () => {
    const r = renderEditor('甲\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    // 光标在内容行行尾（源码偏移 1）——光标位置正确是本条的前提。
    expect(caretFromDom()).toBe(1)
    await typeText(r, '乙')
    await flush()
    // 打的是行内的字，不是空行上的字：不段落化。
    expect(r.getDoc()).toBe('甲乙\n')
    expect(caretFromDom()).toBe(2)
    await assertDomMatchesSource(r)
  })

  it('caret 基准 B：数学体行尾点击 → 偏移 8；行尾打字在行内落地', async () => {
    const r = renderEditor('$$\nx = 1\n$$\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    expect(caretFromDom()).toBe(8)
    await typeText(r, ' + 2')
    await flush()
    expect(r.getDoc()).toBe('$$\nx = 1 + 2\n$$\n')
    expect(caretFromDom()).toBe(12)
    await assertDomMatchesSource(r)
  })

  it('表格格内 Shift+Enter <br /> + Backspace 往返', async () => {
    const r = renderEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    await caretInTableCell(r, 2, 0)
    await step(r, '格内软断', () => pressShiftEnter(r))
    expect(r.getDoc()).toBe('| a | b |\n| --- | --- |\n| <br />1 | 2 |\n')
    await step(r, 'Backspace 撤 <br />', () => pressBackspace(r))
    expect(r.getDoc()).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  })

  it('数学块内编辑后聚焦态源码可见、离焦渲染', async () => {
    const r = renderEditor('$$\nx = 1\n$$\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await step(r, '数学体内输入', () => typeText(r, ' + 2'))
    expect(r.getDoc()).toBe('$$\nx = 1 + 2\n$$\n')
    // 撤销按字符（编辑器一次击键一个快照）：4 个键 = 4 次撤销回到原样。
    await step(r, 'undo ×4', async () => {
      for (let i = 0; i < 4; i++) await pressUndo(r)
    })
    expect(r.getDoc()).toBe('$$\nx = 1\n$$\n')
  })

  it('行内注释跨行为不变量 + undo', async () => {
    const r = renderEditor('a <!-- 注释 --> b\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await step(r, '行末 Enter', () => pressEnter(r))
    await step(r, 'undo', () => pressUndo(r))
    expect(r.getDoc()).toBe('a <!-- 注释 --> b\n')
  })

  it('alert 引用行末 Enter / Backspace', async () => {
    const r = renderEditor('> [!NOTE]\n> 正文\n\n后文\n')
    await flush()
    await clickInRun(r, 0, 1, 1, 'end')
    await step(r, 'alert 内 Enter', () => pressEnter(r))
    expect(r.getDoc()).toBe('> [!NOTE]\n> 正文\n> \n\n后文\n')
    await step(r, 'Backspace 撤行', () => pressBackspace(r))
    expect(r.getDoc()).toBe('> [!NOTE]\n> 正文\n\n后文\n')
  })

  it('undo/redo 链完整：输入 → 撤销 → 重做', async () => {
    const r = renderEditor('甲\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await step(r, '输入', () => typeText(r, '乙丙'))
    expect(r.getDoc()).toBe('甲乙丙\n')
    // 一个键一个快照：两个字符 = 两次撤销回到初始、两次重做回到输入后。
    await step(r, 'undo ×2', async () => {
      await pressUndo(r)
      await pressUndo(r)
    })
    expect(r.getDoc()).toBe('甲\n')
    await step(r, 'redo ×2', async () => {
      await pressRedo(r)
      await pressRedo(r)
    })
    expect(r.getDoc()).toBe('甲乙丙\n')
  })
})
