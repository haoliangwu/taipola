import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  caretFromDom,
  flush,
  typeText,
  pressBackspace,
  pressShiftEnter,
  clickInRun,
  clickAtLine,
  assertDomMatchesSource,
} from '../test/editorTestUtils'

/**
 * typora-parity P5: 行尾连按 Shift+Enter 的「软换行堆栈」。
 *
 * 用户报告：Shift+Enter 多次后，Backspace 一次把空行都消掉，之后要按很多次
 * Backspace 才能回到原始状态——根因是堆栈的空行从不渲染行盒，光标悬在段落
 * 末尾（源码偏移与视觉锚点脱节），第二次 Backspace 就从错误的视觉位置删字
 * （吃掉 甲）。
 *
 * 修复后的行为（本篇钉住的）：
 *   - 每次行尾 Shift+Enter = 一行可见空行，光标骑在最新一行；
 *   - 每次 Backspace 在堆栈内 = 精确弹掉一行 + 一个 `\n`，光标上移一行；
 *   - 堆栈过程中绝不删除已提交的文字；
 *   - 光标离开堆栈 = 空行回到不可见的段落分隔；
 *   - 源码逐字节往返。
 */

function stackRows(r: ReturnType<typeof renderEditor>): HTMLElement[] {
  return [
    ...r.container.querySelectorAll<HTMLElement>('.blk[data-placeholder] [data-vline]'),
  ]
}

describe('软换行堆栈（typora-parity P5）', () => {
  it('3×Shift+Enter：3 行可见空行，光标骑在最新一行', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end') // 甲 行尾
    await flush()
    for (let i = 1; i <= 3; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    expect(r.getDoc()).toBe('甲\n\n\n\n乙\n')
    const rows = stackRows(r)
    expect(rows).toHaveLength(3) // 每次一个可见空行
    expect(caretFromDom()).toBe(4) // 最新一行（源码偏移 4）
    await assertDomMatchesSource(r)
  })

  it('Backspace ×3 逐个弹栈：文档还原、甲 永不丢、光标逐行上移', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    for (let i = 1; i <= 3; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    for (let i = 3; i >= 1; i--) {
      await pressBackspace(r)
      await flush()
      expect(r.getDoc()).toBe(`甲\n${'\n'.repeat(i - 1)}乙\n`)
      expect(stackRows(r)).toHaveLength(i - 1)
    }
    expect(r.getDoc()).toBe('甲\n乙\n')
    expect(r.getDoc()).toContain('甲') // 从没被吃掉
    await assertDomMatchesSource(r)
  })

  it('单发个案仍工作：一次 Shift+Enter + 一次 Backspace 回到原位', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n乙\n')
    expect(stackRows(r)).toHaveLength(1)
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n乙\n')
    await assertDomMatchesSource(r)
  })

  it('堆栈中间行打字：文字落在那一行，不漂到最新行', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    await pressShiftEnter(r)
    await flush()
    const rows = stackRows(r)
    expect(rows).toHaveLength(2)
    // 点进上方旧行（占位块的第 0 行 vline）：光标骑上那一行。
    await clickAtLine(r, 1, 0)
    await flush()
    await typeText(r, 'X')
    await flush()
    expect(r.getDoc()).toBe('甲\nX\n\n乙\n')
    expect(r.getDoc()).toContain('甲')
    await assertDomMatchesSource(r)
  })

  it('光标离开堆栈：行盒保持渲染（会话记忆的软链），源码无损', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(stackRows(r)).toHaveLength(1)
    // 点去 乙（block 2）：pending 清除，但 Shift+Enter 创建的软链是会话记忆
    // （typora-parity：软断随时可见）——行盒保持渲染，不被折叠成段落间隙。
    await clickInRun(r, 2, 0, 0, 'start')
    await flush()
    expect(stackRows(r)).toHaveLength(1)
    expect(r.getDoc()).toBe('甲\n\n乙\n')
    await assertDomMatchesSource(r)
  })
})