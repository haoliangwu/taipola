import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { stubSavedFolder } from '../test/platformStubs'
import { placeCaretAt } from '../test/editorTestUtils'

/**
 * inline-markers 票据 02 的行内数学浏览器冒烟：KaTeX 渲染往返、⌃M 三态、
 * 数学边界的光标编辑（ADR-0002 相邻 run 的边界 Backspace）。
 */

function seedDoc(content: string) {
  localStorage.setItem(
    'taipola:draft:untitled.md',
    JSON.stringify({ savedAt: 1_000, root: null, path: null, content, name: 'untitled.md' }),
  )
  localStorage.setItem('taipola:active-draft', 'untitled.md')
}

async function renderWithDoc(content: string) {
  seedDoc(content)
  const view = render(<App />)
  const doc = view.container.querySelector('.doc') as HTMLElement
  if (!doc) throw new Error('no .doc')
  doc.focus({ preventScroll: true })
  const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
  if (!run?.firstChild) throw new Error('no first run')
  return { view, doc, text: run.firstChild as Text }
}

describe('行内数学渲染（IM02 浏览器冒烟）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('光标在别处时 $…$ 渲染成 KaTeX，读回 DOM 保持源码无损', async () => {
    const view = await renderWithDoc('前 $x+1$ 后\n\n另一段\n')
    const user = userEvent.setup({ delay: null })
    // 点击第二块：内核收到 click、caret 迁移，第一块进入渲染态
    const block2 = view.doc.querySelector('[data-block="2"] [data-vline="0"] [data-run="0"]')
    if (!block2?.firstChild) throw new Error('no block2 run')
    await user.click(block2)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const katex = view.doc.querySelector('[data-block="0"] .katex')
    expect(katex).not.toBeNull()
    // 隐藏源码副本还在，DOM 吸收无损
    expect(view.doc.querySelector('[data-block="0"] .rn-src')?.textContent).toBe('x+1')
    // 点击回第一块：渲染收回、源码显形
    const block0 = view.doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
    if (!block0?.firstChild) throw new Error('no block0 run')
    await user.click(block0)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.doc.querySelector('[data-block="0"] .katex')).toBeNull()
    // 源码态整块显示原样（math 标记被撤回，.rn-src 不再存在）
    expect(view.doc.querySelector('[data-block="0"]')?.textContent).toContain('$x+1$')
    view.view.unmount()
  })

  it('⌃M 扩选光标所在词并包出 $…$', async () => {
    const { text, view, doc } = await renderWithDoc('甲=乙\n')
    const user = userEvent.setup({ delay: null })
    placeCaretAt(text, 1) // 光标落在 '甲=乙' 中间：扩选整词
    await user.keyboard('{Control>}m{/Control}')
    expect(doc.querySelector('[data-block="0"]')?.textContent).toBe('$甲=乙$')
    view.unmount()
  })

  it('⌃M 在数学内部时剥除定界符（不会插出 $$ 坏文本）', async () => {
    const { view, doc } = await renderWithDoc('前 $a+b$ 后\n')
    const user = userEvent.setup({ delay: null })
    // 光标态源码拆成 run（'前 ' / '$' / 'a+b' / '$' / ' 后'）：光标落在内容 run 起点
    const content = doc.querySelector('[data-block="0"] [data-run="2"]')?.firstChild as Text | null
    if (!content) throw new Error('no math content run')
    placeCaretAt(content, 0)
    await user.keyboard('{Control>}m{/Control}')
    expect(doc.querySelector('[data-block="0"]')?.textContent).toBe('前 a+b 后')
    view.unmount()
  })

  it('数学边界 Backspace：源码仍逐字节成立（ADR-0002 相邻 run 边界）', async () => {
    const { view, doc } = await renderWithDoc('前 $x$ 后\n')
    const user = userEvent.setup({ delay: null })
    // 光标放在内容 run 'x' 的末尾：Backspace 删掉光标前一字符（开符 $），
    // DOM 与源码必须保持逐字节一致——不能出现跨 run 的吞字或重排
    const content = doc.querySelector('[data-block="0"] [data-run="2"]')?.firstChild as Text | null
    if (!content) throw new Error('no content run')
    placeCaretAt(content, content.textContent?.length ?? 0)
    await user.keyboard('{Backspace}')
    expect(doc.querySelector('[data-block="0"]')?.textContent).toBe('前 x$ 后')
    view.unmount()
  })
})