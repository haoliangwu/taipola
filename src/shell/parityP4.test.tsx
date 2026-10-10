import { describe, it, expect } from 'vitest'
import {
  assertDomMatchesSource,
  clickInRun,
  flush,
  pressEnter,
  pressShiftEnter,
  renderEditor,
} from '../test/editorTestUtils'
import { caretFromDom } from '../test/editorTestUtils'

/**
 * typora-parity P4：表格格内的 Enter 族。
 *   Enter       — 同一列下一行；最后一行先加行再进（moveCellBelow）。
 *   Shift+Enter — 插入字面 `<br />`；渲染为格内真实换行（data-br-src 承载
 *                 源码），光标贴着它时显示暗色源码；读出逐字节还原。
 */
const TABLE = '| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n| c | d |\n'

describe('格内 Enter 族（typora-parity P4）', () => {
  it('Enter：同一列下一行，文档不变', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 0, 'end') // `a` 格
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe(TABLE)
    // `c` 的源码偏移：第 4 行（0-based 3）行首 38 + 2。
    expect(caretFromDom()).toBe(40)
    await assertDomMatchesSource(r)
  })

  it('Enter：保持列位（第二列到第二列）', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 1, 'end') // `b` 格
    await flush()
    await pressEnter(r)
    await flush()
    expect(caretFromDom()).toBe(44) // `d` 的源码偏移
    await assertDomMatchesSource(r)
  })

  it('Enter：最后一行先加行，光标进新行同一列', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 3, 1, 'end') // `d` 格（末行第二列）
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n| c | d |\n|  |  |\n')
    await assertDomMatchesSource(r)
  })

  it('Shift+Enter：插入字面 `<br />`，光标贴它时显示暗色源码', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 0, 'end') // `a` 格末尾
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| a<br /> | b |\n| c | d |\n')
    // 光标在 `<br />` 之后：暗色源码可见，不是 break 元素。
    const revealed = r.container.querySelector('[data-br-src]')
    expect(revealed).toBeNull()
    await assertDomMatchesSource(r)
  })

  it('Shift+Enter 后光标离开：渲染成真实换行，读出逐字节还原', async () => {
    const r = renderEditor('| a | b |\n| --- | --- |\n| c | d |\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    // 光标挪去 `b` 格（reveal 态下它排在 br 之后的 run 2）：break 形态。
    await clickInRun(r, 0, 0, 2, 'end')
    await flush()
    const brSpan = r.container.querySelector('[data-br-src]') as HTMLElement | null
    expect(brSpan).not.toBeNull()
    expect(brSpan?.getAttribute('data-br-src')).toBe('<br />')
    expect(brSpan?.querySelector('br[data-brsrc]')).not.toBeNull()
    // 元素本身没有文本：视觉上是行断，不是字符。
    expect(brSpan?.textContent).toBe('')
    await assertDomMatchesSource(r)
    expect(r.getDoc()).toBe('| a<br /> | b |\n| --- | --- |\n| c | d |\n')
  })

  it('光标跨过渲染的 break：一枚 token 一步跳过，落到另一边就揭示', async () => {
    const r = renderEditor('| a | b |\n| --- | --- |\n| c | d |\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    // 光标挪进 `b`（break 渲染态），然后 ← 一下跨过它。
    await clickInRun(r, 0, 0, 2, 'end')
    await flush()
    expect(r.container.querySelector('[data-br-src]')).not.toBeNull()
    await r.user.keyboard('{ArrowLeft}{ArrowLeft}')
    await flush()
    // 两步落在 `a` 的末尾（br 的源码起点 3）：越过了整枚 token。
    expect(caretFromDom()).toBe(3)
    // 且一到邻位就揭示源码（Typora 的 adjacent 规则）：break 元素消失，
    // 那枚 token 变成暗色源码文本。
    const revealed = r.container.querySelector('.rn-dim')
    expect(revealed?.textContent).toBe('<br />')
    expect(r.container.querySelector('[data-br-src]')).toBeNull()
    await assertDomMatchesSource(r)
  })
})