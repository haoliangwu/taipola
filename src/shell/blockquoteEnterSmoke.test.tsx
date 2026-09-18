/**
 * 引用块的 Enter 退出行为（`.scratch/blockquote/issues/01`）。
 *
 * 引用行末尾 Enter 续出 `> `（Typora 同款）；在空的 `> ` 行上再 Enter 应退出引用，
 * 并且**留下一个空行分隔**——否则接着输入的无 `>` 行会被 CommonMark 读成引用的
 * lazy continuation，整个引用块重新进入编辑态。
 */
import { describe, expect, it } from 'vitest'
import { clickInRun, flush, pressEnter, renderEditor, typeText } from '../test/editorTestUtils'

describe('引用块的 Enter 退出', () => {
  it('引用 + Enter × 2 + 输入：字落在独立段落，引用不再 reveal', async () => {
    const r = renderEditor('> 引用\n')
    await flush()
    // 光标放到引用行行尾。
    await clickInRun(r, 0, 0, 1, 'end')
    await pressEnter(r) // 引用延续：> 
    expect(r.getDoc()).toBe('> 引用\n> \n')
    const quoteMark = r.container.querySelector('[data-vline="1"]') as HTMLElement
    expect(quoteMark.className).toContain('vl-quote')

    await pressEnter(r) // 空 > 行：退出引用 + 空行分隔
    expect(r.getDoc()).toBe('> 引用\n\n')

    await typeText(r, '字')
    expect(r.getDoc()).toBe('> 引用\n\n字')

    await flush()
    // 新行是独立 text 块，整个引用块不在编辑态（不显示 > 源码）。
    const quoteBlock = r.container.querySelector('[data-block="0"]') as HTMLElement
    expect(quoteBlock.querySelectorAll('.revealed').length).toBe(0)
  })

  it('引用在文档末尾同样成立（无尾换行）', async () => {
    const r = renderEditor('> 引用')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await pressEnter(r)
    expect(r.getDoc()).toBe('> 引用\n> ')
    await pressEnter(r)
    expect(r.getDoc()).toBe('> 引用\n\n')
    await typeText(r, '字')
    expect(r.getDoc()).toBe('> 引用\n\n字')
  })

  it('引用内第一次 Enter 仍续出 > （回归）', async () => {
    const r = renderEditor('> 甲\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await pressEnter(r)
    expect(r.getDoc()).toBe('> 甲\n> \n')
  })
})