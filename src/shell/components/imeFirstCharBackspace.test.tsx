import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import App from '../App'
import { readDocumentSource } from '../../editor/render'
import { placeCaretAt, flush } from '../../test/editorTestUtils'
import userEvent from '@testing-library/user-event'

/**
 * 用户实测（2026-09）：空文档/新段落，IME 打第一个汉字，立即退格——
 * 汉字不消失、光标退了一格。根因：真实输入法的**提交 input 不伴随
 * `beforeinput`**，`handleInput` 的 `userEdit` 门把它吞掉，组合提交的汉字
 * 从未进模型（`composed` 挂起）；光标停在汉字前，退格走行首 join 逻辑，
 * 汉字因此「删不掉」。
 *
 * 修复：`userEdit` 门放行 `composed` 挂起期间的提交 input。
 */
describe('空文档首个 IME 字符 + 立即退格（用户实测）', () => {
  async function renderEmpty() {
    localStorage.clear()
    localStorage.setItem(
      'taipola:draft:untitled.md',
      JSON.stringify({ savedAt: 1_000, root: null, path: null, content: '\n', name: 'untitled.md' }),
    )
    localStorage.setItem('taipola:active-draft', 'untitled.md')
    const view = render(<App />)
    const doc = view.container.querySelector('.doc') as HTMLElement
    if (!doc) throw new Error('no doc')
    doc.focus({ preventScroll: true })
    await flush()
    return { view, doc }
  }

  it('IME 打第一个字：汉字进模型、光标在字后；退格删除它', async () => {
    const { view, doc } = await renderEmpty()
    const line = doc.querySelector('[data-vline="0"]')
    if (!line) throw new Error('no line 0')
    placeCaretAt(line, 0)
    await flush()

    // 完整 IME 序列：拼音 chi → 上屏「吃」（replace 形态）。提交 input
    // 无 beforeinput（真实输入法行为）。
    doc.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const layer = document.createTextNode('chi')
    line.appendChild(layer)
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(layer, 3)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    line.dispatchEvent(new InputEvent('input', { data: 'chi', inputType: 'insertCompositionText', bubbles: true, composed: true }))
    await flush()
    layer.textContent = '吃'
    const r2 = document.createRange()
    r2.setStart(layer, 1)
    r2.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r2)
    line.dispatchEvent(new InputEvent('beforeinput', { data: null, inputType: 'deleteCompositionText', bubbles: true, cancelable: true, composed: true }))
    line.dispatchEvent(new InputEvent('input', { data: null, inputType: 'deleteCompositionText', bubbles: true, composed: true }))
    line.dispatchEvent(new InputEvent('beforeinput', { data: '吃', inputType: 'insertCompositionText', bubbles: true, cancelable: true, composed: true }))
    line.dispatchEvent(new InputEvent('input', { data: '吃', inputType: 'insertCompositionText', bubbles: true, composed: true }))
    await flush()
    doc.dispatchEvent(new CompositionEvent('compositionend', { data: '吃', bubbles: true }))
    await flush()
    // 提交 input —— 无 beforeinput，正是修复放行的那一条。
    line.dispatchEvent(new InputEvent('input', { data: '吃', inputType: 'insertCompositionText', bubbles: true, composed: true }))
    await flush()

    const afterCommit = readDocumentSource(doc)
    // 汉字必须在模型里（修复前：停在 '\n'）。
    expect(afterCommit === '吃' || afterCommit === '吃\n').toBe(true)

    // 立即退格：删掉「吃」，回到空文档（修复前：汉字残留、光标退一格）。
    const user = userEvent.setup({ delay: null })
    await user.keyboard('{Backspace}')
    await flush()
    expect(readDocumentSource(doc)).toBe('\n')
    view.unmount()
  })
})