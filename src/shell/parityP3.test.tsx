import { describe, it, expect } from 'vitest'
import {
  assertDomMatchesSource,
  clickInRun,
  flush,
  renderEditor,
} from '../test/editorTestUtils'

/**
 * typora-parity P3：`$$…$$` 显示数学块。未聚焦 = 整块渲染 KaTeX 显示数学
 * （居中、无 `$$`、无正文）；聚焦 = 源码可见（同围栏的揭示机制）；
 * 源码逐字节往返。坏公式回退显示原始正文，绝不空白。
 */

/** 构造「数学块 + 空行 + 后文」，光标先挪到后文使数学块未聚焦。 */
async function renderMathUnfocused(body: string) {
  const r = renderEditor(`$$\n${body}\n$$\n\n后文\n`)
  await flush()
  await clickInRun(r, 2, 0, 0)
  await flush()
  return r
}

function mathBlock(r: ReturnType<typeof renderEditor>): HTMLElement {
  const el = r.container.querySelector('[data-kind="math-block"]') as HTMLElement
  if (!el) throw new Error('no math block')
  return el
}

describe('$$…$$ 显示数学块（typora-parity P3）', () => {
  it('未聚焦：KaTeX 显示输出在、`$$` 与正文都不可见', async () => {
    const r = await renderMathUnfocused('E = mc^2')
    const block = mathBlock(r)
    expect(block.getAttribute('data-kind')).toBe('math-block')
    const render = block.querySelector('.math-render') as HTMLElement
    expect(render).not.toBeNull()
    expect(render.dataset.tex).toBe('E = mc^2')
    expect(render.querySelector('.katex-display')).not.toBeNull()
    // 正文行是隐藏 run；块内没有任何可见的 `$` 文本（隐藏 run 除外）。
    const bodyLine = block.querySelector('[data-vline="1"] [data-run]') as HTMLElement
    expect(bodyLine.classList.contains('rn-marker')).toBe(true)
    const visibleRuns = [...block.querySelectorAll('[data-run]:not(.rn-marker)')]
    expect(visibleRuns).toHaveLength(0)
    await assertDomMatchesSource(r)
  })

  it('聚焦：`$$` 暗色源码 + 正文可编辑，KaTeX 让位', async () => {
    const r = await renderMathUnfocused('x^2 + y^2 = z^2')
    const block = mathBlock(r)
    // 借用 clickInRun 的光标路径：它的 mousedown 重置 placedByUs，随后的
    // placeCaretAt 才会被 selectionchange 吸收（直接 placeCaretAt 会被内核
    // 当成「自己刚放的光标」跳过）。目标：正文行（vline 1）。
    await clickInRun(r, 0, 1, 0)
    await flush()
    // 揭示：`$$` 行暗色源码、正文可见、渲染让位。
    const openLine = block.querySelector('[data-vline="0"]') as HTMLElement
    expect(openLine.classList.contains('revealed')).toBe(true)
    const openRun = openLine.querySelector('[data-run]') as HTMLElement
    expect(openRun.textContent).toBe('$$')
    expect(openRun.classList.contains('rn-dim')).toBe(true)
    const bodyRun = block.querySelector('[data-vline="1"] [data-run]') as HTMLElement
    expect(bodyRun.classList.contains('rn-marker')).toBe(false)
    expect(block.querySelector('.math-render')).toBeNull()
    await assertDomMatchesSource(r)
  })

  it('光标进正文打字：源码逐字进模型，往返无损', async () => {
    const r = await renderMathUnfocused('E = mc^2')
    await clickInRun(r, 0, 1, 0, 4) // 正文行 `E = ` 之后
    await flush()
    await r.user.keyboard('AB')
    await flush()
    expect(r.getDoc()).toBe('$$\nE = ABmc^2\n$$\n\n后文\n')
    await assertDomMatchesSource(r)
  })

  it('坏公式：回退显示原始正文，绝不空白', async () => {
    const r = await renderMathUnfocused('\\frac{broken')
    const render = mathBlock(r).querySelector('.math-render') as HTMLElement
    expect(render.classList.contains('math-fallback')).toBe(true)
    expect(render.textContent).toBe('\\frac{broken')
    await assertDomMatchesSource(r)
  })

  it('单行 `$$ x $$`：一整行是一个空身块，显示该行数学', async () => {
    const r = renderEditor('$$ E = mc^2 $$\n\n后文\n')
    await flush()
    await clickInRun(r, 2, 0, 0)
    await flush()
    const block = mathBlock(r)
    const render = block.querySelector('.math-render') as HTMLElement
    expect(render.dataset.tex).toBe(' E = mc^2 ')
    expect(render.querySelector('.katex-display')).not.toBeNull()
    await assertDomMatchesSource(r)
  })

  it('空块 `$$\n$$` 与 `$$$$`：渲染元素在，源码往返无损', async () => {
    const r = renderEditor('$$\n$$\n\n$$$$\n\n后文\n')
    await flush()
    await clickInRun(r, 4, 0, 0)
    await flush()
    const blocks = [...r.container.querySelectorAll<HTMLElement>('[data-kind="math-block"]')]
    expect(blocks.length).toBe(2)
    for (const block of blocks) {
      expect(block.querySelector('.math-render')).not.toBeNull()
    }
    await assertDomMatchesSource(r)
  })
})