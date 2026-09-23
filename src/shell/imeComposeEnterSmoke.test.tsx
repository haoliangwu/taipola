import { describe, it, expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderEditor } from '../test/editorTestUtils'
import { readDocumentSource } from '../editor/render'

/**
 * IME 组合提交与 Enter 的竞态：组合文本上屏后若输入法不再派发提交 input
 * （`compositionend` 置起的 `composed` 悬挂），紧接着的 Enter 会基于还没有
 * 组合文本的 model 处理 —— render 重写 DOM 把文字清掉，`composed` 的后续
 * 提交 input 再把空 DOM 读回，段落永久丢失，只剩一个空行。
 *
 * 实测（真实 Chromium + 事件模拟）：空文档 → 组合输入「一些文字」→
 * compositionend → Enter → 修复前 model 变 `\n`、DOM 只剩两行空白
 * （与用户报告逐字节一致）；修复后 model 为 `一些文字\n`，段落保留。
 */
describe('IME 组合提交后 Enter（空文档丢字竞态）', () => {
  it('空 doc + 组合输入 + Enter（无提交 input）：段落不消失', async () => {
    const r = renderEditor('')
    const doc = r.container
    const user = userEvent.setup({ delay: null })
    doc.focus({ preventScroll: true })

    // 组合开始；文本落地 DOM（空行上的组合输入）——组合 input 被
    // onBlankLine 门拒绝吸收（设计：等组合提交走段落化路径），model 仍空。
    const vline = doc.querySelector('[data-vline]')
    if (!vline) throw new Error('no vline in empty doc')
    const br = vline.querySelector('br')
    if (br) br.remove()
    vline.appendChild(doc.ownerDocument.createTextNode('一些文字'))
    doc.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    doc.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertCompositionText',
        data: '一些文字',
        bubbles: true,
        cancelable: true,
      }),
    )
    doc.dispatchEvent(
      new InputEvent('input', { inputType: 'insertCompositionText', data: '一些文字', bubbles: true }),
    )
    // compositionend 发现 DOM 与 model 不一致 → `composed` 置起，等提交 input
    doc.dispatchEvent(new CompositionEvent('compositionend', { data: '一些文字' }))
    // 该输入法不再派发提交 input；用户直接按 Enter
    await user.keyboard('{Enter}')

    const model = r.getDoc()
    expect(model).toBe('一些文字\n')
    expect(model.includes('一些文字')).toBe(true)
    const dom = readDocumentSource(doc)
    expect(dom.includes('一些文字')).toBe(true)
  })

  it('组合提交正常伴随 input 时（原路径）：行为不变', async () => {
    const r = renderEditor('')
    const doc = r.container
    const user = userEvent.setup({ delay: null })
    doc.focus({ preventScroll: true })

    const vline = doc.querySelector('[data-vline]')
    const br = vline?.querySelector('br')
    if (br) br.remove()
    vline?.appendChild(doc.ownerDocument.createTextNode('一些文字'))
    doc.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    doc.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertCompositionText',
        data: '一些文字',
        bubbles: true,
        cancelable: true,
      }),
    )
    doc.dispatchEvent(
      new InputEvent('input', { inputType: 'insertCompositionText', data: '一些文字', bubbles: true }),
    )
    doc.dispatchEvent(new CompositionEvent('compositionend', { data: '一些文字' }))
    // 提交 input 正常到达：吸收进 model（空行的 `onBlankLine` 门已在
    // compositionend 判定后由 committed 路径接管）
    doc.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: '一些文字', bubbles: true }),
    )
    await user.keyboard('{Enter}')

    expect(r.getDoc().includes('一些文字')).toBe(true)
    expect(readDocumentSource(doc).includes('一些文字')).toBe(true)
  })
})
