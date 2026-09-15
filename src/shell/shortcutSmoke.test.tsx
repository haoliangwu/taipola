import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { stubSavedFolder } from '../test/platformStubs'
import { placeCaretAt } from '../test/editorTestUtils'

/**
 * typora-menus 票据 04 冒烟：浏览器冲突键（⌘= / ⌘- / ⌘0 / ⌘\ 对应浏览器的缩放、
 * 隐藏书签栏）必须执行编辑器命令而不是浏览器默认行为。
 *
 * 诚实范围声明：这里的按键是合成的（`userEvent.keyboard`），所以「页面没被缩放」
 * 无法断言——无头 Chromium 对合成事件本来就不会缩放，且本套件固定版本的
 * vitest/browser context 模块是 stub，拿不到可信 CDP 输入。本文件验证可观测的
 * 那一半：命令确实触发。preventDefault 拦截可信按键的另一半留在票据 05 的
 * 真机人工清单上。
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

describe('缩放键被编辑器抢走（typora-menus/04 冒烟）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('⌘= 把 h2 升成 h1（命令生效，而不是无事发生）', async () => {
    const { text, view, doc } = await renderWithDoc('## 甲\n')
    const user = userEvent.setup({ delay: null })
    placeCaretAt(text, 3)
    await user.keyboard('{Control>}={/Control}')
    expect(doc.querySelector('[data-block="0"]')?.textContent).toBe('# 甲')
    view.unmount()
  })

  it('⌘= 在 h1 上按边界无操作（h1 不能升）', async () => {
    const { text, view, doc } = await renderWithDoc('# 甲\n')
    const user = userEvent.setup({ delay: null })
    placeCaretAt(text, 2)
    await user.keyboard('{Control>}={/Control}')
    expect(doc.querySelector('[data-block="0"]')?.textContent).toBe('# 甲')
    view.unmount()
  })

  it('⌘- 把 h2 降成 h3', async () => {
    const { text, view, doc } = await renderWithDoc('## 甲\n')
    const user = userEvent.setup({ delay: null })
    placeCaretAt(text, 3)
    await user.keyboard('{Control>}-{/Control}')
    expect(doc.querySelector('[data-block="0"]')?.textContent).toBe('### 甲')
    view.unmount()
  })

  it('⌘0 把标题还原成段落', async () => {
    const { text, view, doc } = await renderWithDoc('## 甲\n')
    const user = userEvent.setup({ delay: null })
    placeCaretAt(text, 3)
    await user.keyboard('{Control>}0{/Control}')
    expect(doc.querySelector('[data-block="0"]')?.textContent).toBe('甲')
    view.unmount()
  })

  it('⌘\\ 清除选中文字的行内标记', async () => {
    const { view, doc } = await renderWithDoc('**甲**\n')
    const user = userEvent.setup({ delay: null })
    // 光标块把源码拆成了 run（`**` / `甲` / `**`），选区必须横跨整块而不是单个 run。
    const block = doc.querySelector('[data-block="0"]') as HTMLElement
    const runs = [...block.querySelectorAll('[data-run]')]
    const first = runs[0]?.firstChild as Text | null
    const last = runs[runs.length - 1]?.lastChild as Text | null
    if (!first || !last) throw new Error('no run text')
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, last.textContent?.length ?? 0)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    await user.keyboard('{Control>}\\\\{/Control}')
    expect(doc.querySelector('[data-block="0"]')?.textContent).toBe('甲')
    view.unmount()
  })
})