import { describe, it, expect, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithDoc } from '../test/appTestUtils'
import { stubSavedFolder } from '../test/platformStubs'
import { caretFromDom, placeCaretAt } from '../test/editorTestUtils'
import { readDocumentSource } from '../editor/render'

/**
 * typora-parity P1 的 ⌘]/⌘[：⌘] 列表项进一层、段落上是空操作；⌘[ 列表项退
 * 一层、段落/标题擦掉行首一个 tab 或 1-2 空格（选区覆盖几块就擦几块）。
 *
 * 键走 shell 的 shortcut 表（⌘] = indent / ⌘[ = outdent），路由在 kernel 的
 * `applyIndent`——只有内核看得见 DOM 选区。
 */

/** 段落行的第一个 run 文本节点。 */
function lineText(doc: HTMLElement, block: number): Text {
  const run = doc.querySelector(
    `[data-block="${block}"] [data-vline="0"] [data-run]`,
  )?.firstChild as Text | null
  if (!run) throw new Error(`no run text in block ${block}`)
  return run
}

/** 跨块选区：从 block 0 行首到 block `to` 的文本末尾。 */
function selectBlocks(doc: HTMLElement, toBlock: number): void {
  const start = lineText(doc, 0)
  const end = lineText(doc, toBlock)
  const range = document.createRange()
  range.setStart(start, 0)
  range.setEnd(end, end.textContent?.length ?? 0)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

describe('⌘]/⌘[（typora-parity P1）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('⌘[ 擦掉段落行首两空格，光标跟着文本走', async () => {
    const { view, doc } = await renderWithDoc('  甲乙\n')
    const user = userEvent.setup({ delay: null })
    // 光标站在「乙」上（源码列 3）：擦掉两空格后仍站在「乙」上（列 1）。
    placeCaretAt(lineText(doc, 0), 3)
    await user.keyboard('{Control>}[[{/Control}')
    expect(readDocumentSource(doc)).toBe('甲乙\n')
    expect(caretFromDom()).toBe(1)
    view.unmount()
  })

  it('⌘[ 段落行首一个 tab：删掉 tab', async () => {
    const { view, doc } = await renderWithDoc('\t甲\n')
    const user = userEvent.setup({ delay: null })
    placeCaretAt(lineText(doc, 0), 1)
    await user.keyboard('{Control>}[[{/Control}')
    expect(readDocumentSource(doc)).toBe('甲\n')
    view.unmount()
  })

  it('⌘[ 段落无行首空白：无操作，光标不动', async () => {
    const { view, doc } = await renderWithDoc('甲乙\n')
    const user = userEvent.setup({ delay: null })
    placeCaretAt(lineText(doc, 0), 1)
    await user.keyboard('{Control>}[[{/Control}')
    expect(readDocumentSource(doc)).toBe('甲乙\n')
    expect(caretFromDom()).toBe(1)
    view.unmount()
  })

  it('⌘[ 选区覆盖多块：逐块擦行首空白', async () => {
    const { view, doc } = await renderWithDoc('  甲\n\n  乙\n')
    const user = userEvent.setup({ delay: null })
    selectBlocks(doc, 2)
    await user.keyboard('{Control>}[[{/Control}')
    expect(readDocumentSource(doc)).toBe('甲\n\n乙\n')
    view.unmount()
  })

  it('⌘] 段落：空操作，不插任何东西', async () => {
    const { view, doc } = await renderWithDoc('甲乙\n')
    const user = userEvent.setup({ delay: null })
    placeCaretAt(lineText(doc, 0), 1)
    await user.keyboard('{Control>}]{/Control}')
    expect(readDocumentSource(doc)).toBe('甲乙\n')
    expect(caretFromDom()).toBe(1)
    view.unmount()
  })

  it('⌘] 列表项：嵌套进上一项（复用 Tab 语义）', async () => {
    const { view, doc } = await renderWithDoc('- 甲\n- 乙\n')
    const user = userEvent.setup({ delay: null })
    // 整个列表是一个块（块 0），两项是它的两行。
    const run = doc.querySelector('[data-block="0"] [data-vline="1"] [data-run]')
    placeCaretAt(run?.firstChild as Text, 0)
    await user.keyboard('{Control>}]{/Control}')
    expect(readDocumentSource(doc)).toBe('- 甲\n  - 乙\n')
    view.unmount()
  })

  it('⌘[ 列表项：反缩进一层', async () => {
    const { view, doc } = await renderWithDoc('- 甲\n  - 乙\n')
    const user = userEvent.setup({ delay: null })
    const run = doc.querySelector('[data-block="0"] [data-vline="1"] [data-run]')
    placeCaretAt(run?.firstChild as Text, 0)
    await user.keyboard('{Control>}[[{/Control}')
    expect(readDocumentSource(doc)).toBe('- 甲\n- 乙\n')
    view.unmount()
  })
})