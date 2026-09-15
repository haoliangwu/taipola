import { describe, it, expect, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithDoc } from '../test/appTestUtils'
import { readDocumentSource } from '../editor/render'
import { placeCaretAt } from '../test/editorTestUtils'
import { stubSavedFolder } from '../test/platformStubs'

/**
 * paste 票据 01：粘贴路径的模型完整性与「粘贴后落点」。
 *
 * 为什么不是真剪贴板：本仓固定的 vitest browser 版本里拿不到可信输入
 * （`@vitest/browser/context` 是 stub），而粘贴的 DOM 插入是浏览器的默认动作，合成
 * `paste` 事件不会触发它。这里的模拟器按浏览器真实顺序来：
 *
 *   1. `beforeinput`（`insertFromPaste`）——内核用它把这次改动标记为「用户编辑」
 *      （`userEditPending`）；少了这一步，插入会被内核按「不是用户的编辑」忽略；
 *   2. `document.execCommand('insertText')`——**Chromium 自己的插入与光标后置**，
 *      不自己拼 DOM（这正是「落点」问题的关键：插入后光标必须停在粘贴文本之后）；
 *   3. `execCommand` 自带 `input`，内核据此全文档重读吸收。
 *
 * 近似之处：`inputType` 由 `insertText` 充当 `insertFromPaste`（内核不区分 inputType），
 * 且多行粘贴在真实浏览器里是块级元素 + `sanitizeDom`，这里只有换行文本。
 * 这两点记在票据 Comments 里。
 */
function pasteLikeTheBrowser(doc: HTMLElement, text: string): void {
  const target = (document.activeElement as HTMLElement | null) ?? doc
  const transfer = new DataTransfer()
  transfer.setData('text/plain', text)
  target.dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: 'insertFromPaste',
      data: text,
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    }),
  )
  document.execCommand('insertText', false, text)
}

/** 光标放到某块最后一行的行尾。 */
function caretToLineEnd(doc: HTMLElement, block = 0): void {
  const runs = [...doc.querySelectorAll(`[data-block="${block}"] [data-run]`)]
  const node = runs[runs.length - 1]?.lastChild as Text | null
  if (!node) throw new Error('no run text')
  placeCaretAt(node, node.textContent?.length ?? 0)
}

describe('粘贴路径（paste/01）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('粘贴含标记的文本：模型逐字一致，且继续打字落在粘贴文本之后', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    pasteLikeTheBrowser(doc, 'AB**CD**E')
    expect(readDocumentSource(doc)).toBe('借用AB**CD**E\n')

    const user = userEvent.setup({ delay: null })
    await user.keyboard('!')
    expect(readDocumentSource(doc)).toBe('借用AB**CD**E!\n')
    view.unmount()
  })

  it('粘贴行内数学：一份、不吞渲染文本', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    pasteLikeTheBrowser(doc, 'AB$x$C')
    expect(readDocumentSource(doc)).toBe('借用AB$x$C\n')
    view.unmount()
  })

  it('粘贴中文与粗体：逐字一致', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    pasteLikeTheBrowser(doc, '你好**世界**')
    expect(readDocumentSource(doc)).toBe('借用你好**世界**\n')
    view.unmount()
  })

  it('粘贴多行文本：换行进入模型', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    pasteLikeTheBrowser(doc, '第一行\n第二行')
    expect(readDocumentSource(doc)).toBe('借用第一行\n第二行\n')
    view.unmount()
  })

  it('粘贴表格源码：结构与管道符逐字一致', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    pasteLikeTheBrowser(doc, '| a | b |\n| --- | --- |')
    expect(readDocumentSource(doc)).toBe('借用| a | b |\n| --- | --- |\n')
    view.unmount()
  })

  it('粘贴后 Backspace 逐字符还原', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    pasteLikeTheBrowser(doc, 'XY')
    expect(readDocumentSource(doc)).toBe('借用XY\n')

    const user = userEvent.setup({ delay: null })
    await user.keyboard('{Backspace}')
    expect(readDocumentSource(doc)).toBe('借用X\n')
    await user.keyboard('{Backspace}')
    expect(readDocumentSource(doc)).toBe('借用\n')
    view.unmount()
  })
})