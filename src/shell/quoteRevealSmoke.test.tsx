/**
 * 引用块的 reveal（编辑态）样式（`.scratch/blockquote/issues/02`）。
 *
 * 进入引用块后 `> ` 源码 dim 显示，内容应回到正文色——渲染态引用灰（`--text-soft`）
 * 只在光标离开时出现。明/暗两主题各验一次，且要「进→出→进」三态都走过：光标默认在
 * 文档开头（引用块内），正落在 reveal 态上。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { clickInRun, flush, renderEditor } from '../test/editorTestUtils'

const TEXT = 'rgb(31, 31, 34)'
const SOFT = 'rgb(107, 107, 115)'

describe('引用块 reveal 态', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('进引用：内容回正文色；离开：恢复引用灰（浅色）', async () => {
    const r = renderEditor('> 写作是把思绪压进纸张的过程。\n\n正文\n')
    await flush()
    const quote = r.container.querySelector('[data-block="0"] [data-vline="0"]') as HTMLElement

    // 光标默认在文档开头 = 引用块内 → reveal：`> ` 淡显、内容正文色。
    expect(quote.className).toContain('revealed')
    expect(getComputedStyle(quote).color).toBe(TEXT)

    // 点进正文段落 → 引用恢复渲染态：整行回到引用灰。
    await clickInRun(r, 2, 0, 0)
    await flush()
    expect(quote.className).not.toContain('revealed')
    expect(getComputedStyle(quote).color).toBe(SOFT)

    // 再点回引用 → 又 reveal 回来。
    await clickInRun(r, 0, 0, 1)
    await flush()
    expect(quote.className).toContain('revealed')
    expect(getComputedStyle(quote).color).toBe(TEXT)
  })

  it('深色主题同样：reveal 后为深色正文色，而非引用灰', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const r = renderEditor('> 深色引用\n\n正文\n')
    await flush()
    const quote = r.container.querySelector('[data-block="0"] [data-vline="0"]') as HTMLElement
    expect(getComputedStyle(quote).color).toBe('rgb(228, 228, 231)')
    await clickInRun(r, 2, 0, 0)
    await flush()
    expect(getComputedStyle(quote).color).toBe('rgb(157, 157, 166)')
  })

  it('嵌套引用同样生效', async () => {
    const r = renderEditor('> > 嵌套\n\n正文\n')
    await flush()
    const quote = r.container.querySelector('[data-block="0"] [data-vline="0"]') as HTMLElement
    expect(getComputedStyle(quote).color).toBe(TEXT)
  })
})