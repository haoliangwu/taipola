import { describe, it, expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderEditor } from '../test/editorTestUtils'

/**
 * 句中（行首）连续 Enter/Shift+Enter 的可见性：拆出的段落分隔 blank 默认
 * 不渲染行盒（段落间距模型，`paragraph-spacing/01`），光标落在右段行首后
 * 再按 Enter，模型里新增的换行会全部塞进那个不可见的分隔里——页面纹丝
 * 不动（实测：`第一段文\n\n` 再 Enter 两次，html 变 `\n\n\n\n`，渲染仍
 * 只有两段）。Enter 行首分支与 Shift+Enter 行首分支现在把新空行标记为
 * placeholder，空白行按 Enter 占位渲染，每次按键都多出一行可见。
 */
describe('行首连续 Enter / Shift+Enter：每次都产生可见换行', () => {
  function caretAt(r: { runEl: (b: number, v: number, run: number) => HTMLElement | null }, index: number) {
    const el = r.runEl(0, 0, 0)
    const node = el?.firstChild as Text | null
    if (!node) throw new Error('no run text')
    const range = document.createRange()
    range.setStart(node, Math.min(index, node.textContent?.length ?? 0))
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    el?.closest('.doc')?.dispatchEvent(new Event('selectionchange'))
  }

  const vlines = (r: { container: HTMLElement }) =>
    [...r.container.querySelectorAll('[data-vline]')].filter(
      (el) => getComputedStyle(el).display !== 'none',
    ).length

  it('句中 Enter 拆段后，光标在右段行首继续 Enter：每次多一行可见', async () => {
    const r = renderEditor('第一段文字在这')
    const user = userEvent.setup({ delay: null })
    r.container.focus({ preventScroll: true })
    caretAt(r, 4)
    await user.keyboard('{Enter}')
    const afterSplit = vlines(r)
    await user.keyboard('{Enter}')
    const afterSecond = vlines(r)
    await user.keyboard('{Enter}')
    const afterThird = vlines(r)
    expect(r.getDoc()).toBe('第一段文\n\n\n\n字在这')
    // 拆段本身就产生两行；第二、三次 Enter 各加一行可见空行
    expect(afterSplit).toBe(2)
    // 行首 Enter 的全新空行全显（可能含拆段遗留的分隔行），每次按键
    // 可见行数必须严格递增
    expect(afterSecond).toBeGreaterThan(afterSplit)
    expect(afterThird).toBeGreaterThan(afterSecond)
  })

  it('Shift+Enter 行首连续按：每次多一行可见', async () => {
    const r = renderEditor('第一段文字在这')
    const user = userEvent.setup({ delay: null })
    r.container.focus({ preventScroll: true })
    caretAt(r, 4)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    const afterFirst = vlines(r)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    const afterSecond = vlines(r)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    const afterThird = vlines(r)
    expect(afterFirst).toBe(2) // 第一次软换行：同段两行
    expect(afterSecond).toBeGreaterThan(afterFirst)
    expect(afterThird).toBeGreaterThan(afterSecond)
  })

  it('句首 Enter 后一次 Backspace 还原（placeholder 不改变还原语义）', async () => {
    const r = renderEditor('甲乙')
    const user = userEvent.setup({ delay: null })
    r.container.focus({ preventScroll: true })
    caretAt(r, 0)
    await user.keyboard('{Enter}')
    expect(r.getDoc()).toBe('\n甲乙')
    await user.keyboard('{Backspace}')
    expect(r.getDoc()).toBe('甲乙')
  })
})