import { describe, it, expect, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithDoc } from '../test/appTestUtils'
import { readDocumentSource } from '../editor/render'
import { placeCaretAt } from '../test/editorTestUtils'
import { stubSavedFolder } from '../test/platformStubs'

/**
 * caret-assertions 票据 02：手打行内标记（`**` 等）或格式命令（⌘B）之后继续打字，
 * 字符必须落在用户看到的位置——标记 run 出现不该把光标锚到标记之前，
 * 命令包装也不该把光标留在构造内部。
 */

/** 把光标放到某块最后一个 run 的文本末尾（= 该行可见内容的行尾）。 */
function caretToBlockEnd(doc: HTMLElement, block = 0): void {
  const runs = [...doc.querySelectorAll(`[data-block="${block}"] [data-run]`)]
  const node = runs[runs.length - 1]?.lastChild as Text | null
  if (!node) throw new Error('no run text')
  placeCaretAt(node, node.textContent?.length ?? 0)
}

/** 逐字符输入，并在每步之后回报模型——错位发生在哪一键一目了然。 */
async function typeChars(
  user: ReturnType<typeof userEvent.setup>,
  doc: HTMLElement,
  text: string,
): Promise<string[]> {
  const sources: string[] = []
  for (const ch of text) {
    await user.keyboard(ch)
    sources.push(readDocumentSource(doc))
  }
  return sources
}

describe('手打行内标记与格式命令后的打字落点（caret-assertions/02）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('逐字符打 **b**：每一步模型都与按键逐字一致', async () => {
    const { view, doc } = await renderWithDoc('段落\n')
    const user = userEvent.setup({ delay: null })
    caretToBlockEnd(doc)
    const sources = await typeChars(user, doc, '**b**')
    expect(sources).toEqual(['段落*\n', '段落**\n', '段落**b\n', '段落**b*\n', '段落**b**\n'])
    view.unmount()
  })

  it('逐字符打 **bold** 后继续打 X：X 在构造之后', async () => {
    const { view, doc } = await renderWithDoc('段落\n')
    const user = userEvent.setup({ delay: null })
    caretToBlockEnd(doc)
    await typeChars(user, doc, '**bold**')
    await user.keyboard('X')
    expect(readDocumentSource(doc)).toBe('段落**bold**X\n')
    view.unmount()
  })

  it('标题行尾逐字符打 **b**：不拆行、不落错位', async () => {
    const { view, doc } = await renderWithDoc('# 未命名\n')
    const user = userEvent.setup({ delay: null })
    caretToBlockEnd(doc)
    const sources = await typeChars(user, doc, '**b**')
    expect(sources[sources.length - 1]).toBe('# 未命名**b**\n')
    view.unmount()
  })

  it('逐字符打 *a*（斜体）与 ~~a~~（删除线）同样逐字一致', async () => {
    const italic = await renderWithDoc('段落\n')
    const user = userEvent.setup({ delay: null })
    caretToBlockEnd(italic.doc)
    await typeChars(user, italic.doc, '*a*')
    expect(readDocumentSource(italic.doc)).toBe('段落*a*\n')
    italic.view.unmount()

    const strike = await renderWithDoc('段落\n')
    const user2 = userEvent.setup({ delay: null })
    caretToBlockEnd(strike.doc)
    await typeChars(user2, strike.doc, '~~a~~')
    expect(readDocumentSource(strike.doc)).toBe('段落~~a~~\n')
    strike.view.unmount()
  })

  it('⌘B 包装后继续打字：字符落在构造之后', async () => {
    const { view, doc, text } = await renderWithDoc('bold\n')
    const user = userEvent.setup({ delay: null })
    const range = document.createRange()
    range.selectNodeContents(text)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    await user.keyboard('{Control>}b{/Control}')
    expect(readDocumentSource(doc)).toBe('**bold**\n')
    await user.keyboard('X')
    expect(readDocumentSource(doc)).toBe('**bold**X\n')
    view.unmount()
  })

  it('对照组：普通文本逐字符输入不回归', async () => {
    const { view, doc } = await renderWithDoc('段落\n')
    const user = userEvent.setup({ delay: null })
    caretToBlockEnd(doc)
    await typeChars(user, doc, 'aaa')
    expect(readDocumentSource(doc)).toBe('段落aaa\n')
    view.unmount()
  })
})