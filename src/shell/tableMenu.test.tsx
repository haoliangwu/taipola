/**
 * 表格右键菜单（`.scratch/table-ops/issues/03`）。
 *
 * 这是"加一列"唯一的入口（Typora 也把列的命令只放在右键里），也是本仓库第一个
 * context menu —— 所以它要回答的第一个问题是"光标在表里吗"：不在表里就什么都不
 * 画，让浏览器自己的菜单照常出现。
 *
 * 菜单本身是外壳的（`src/shell/components/TableMenu.tsx`），所以这里用真 App 挂载。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithDoc } from '../test/appTestUtils'
import { stubSavedFolder } from '../test/platformStubs'
import { placeCaretAt } from '../test/editorTestUtils'
import { readDocumentSource } from '../editor/render'

const TABLE = '| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n| c | d |\n'

function cellNode(container: HTMLElement, vline: number, cell: number): Node {
  // No block index: the whole point of one of these tests is a table that is NOT
  // the document's first block, and there is only ever one table here.
  const el = container.querySelector(
    `[data-vline="${vline}"] [data-cell="${cell}"]`,
  ) as HTMLElement
  return el.querySelector('[data-run]')?.firstChild ?? el
}

/** Right-clicks a cell: the caret lands there, then the menu opens. */
async function rightClickCell(
  doc: HTMLElement,
  vline: number,
  cell: number,
): Promise<HTMLElement[]> {
  placeCaretAt(cellNode(doc, vline, cell), 0)
  const target = doc.querySelector(
    `[data-vline="${vline}"] [data-cell="${cell}"]`,
  ) as HTMLElement
  fireEvent.contextMenu(target, { clientX: 120, clientY: 200 })
  return [...doc.ownerDocument.querySelectorAll<HTMLElement>('.table-menu button')]
}

function menuItems(doc: HTMLElement): HTMLElement[] {
  return [...doc.ownerDocument.querySelectorAll<HTMLElement>('.table-menu button')]
}

describe('表格右键菜单', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('在格子里右键：菜单出现，列的命令齐全', async () => {
    const { doc, view } = await renderWithDoc(TABLE)
    const items = await rightClickCell(doc, 2, 0)
    expect(items.map((item) => item.textContent)).toEqual([
      '在上方插入行',
      '在下方插入行',
      '删除本行',
      '在左侧插入列',
      '在右侧插入列',
      '删除本列',
      '删除表格',
    ])
    view.unmount()
  })

  it('在表格外面右键：不画菜单，浏览器自己的菜单照常', async () => {
    const { doc, view } = await renderWithDoc('正文一段\n')
    const text = doc.querySelector('[data-block="0"] [data-run="0"]') as HTMLElement
    placeCaretAt(text.firstChild as Node, 1)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    text.dispatchEvent(event)
    expect(menuItems(doc)).toHaveLength(0)
    // 没被接管：preventDefault 没被调用。
    expect(event.defaultPrevented).toBe(false)
    view.unmount()
  })

  it('在表头行：删本行是灰的（表头就是这张表）', async () => {
    const { doc, view } = await renderWithDoc(TABLE)
    const items = await rightClickCell(doc, 0, 0)
    expect((items.find((item) => item.textContent === '删除本行') as HTMLButtonElement).disabled).toBe(true)
    view.unmount()
  })

  it('只有一列时：删本列是灰的', async () => {
    const { doc, view } = await renderWithDoc('| a |\n| --- |\n| b |\n')
    const items = await rightClickCell(doc, 2, 0)
    expect((items.find((item) => item.textContent === '删除本列') as HTMLButtonElement).disabled).toBe(true)
    view.unmount()
  })

  it('点"在右侧插入列"：每一行都多一格，菜单关掉', async () => {
    const { doc, view } = await renderWithDoc(TABLE)
    const user = userEvent.setup({ delay: null })
    const items = await rightClickCell(doc, 2, 0)
    await user.click(items.find((item) => item.textContent === '在右侧插入列')!)
    expect(readDocumentSource(doc)).toBe(
      '| 列 1 |  | 列 2 |\n| --- | --- | --- |\n| a |  | b |\n| c |  | d |\n',
    )
    expect(menuItems(doc)).toHaveLength(0)
    view.unmount()
  })

  it('点"删除本行"：行没了', async () => {
    const { doc, view } = await renderWithDoc(TABLE)
    const user = userEvent.setup({ delay: null })
    const items = await rightClickCell(doc, 2, 0)
    await user.click(items.find((item) => item.textContent === '删除本行')!)
    expect(readDocumentSource(doc)).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| c | d |\n')
    view.unmount()
  })

  it('点"删除表格"：整张表和它两侧的一行空行一起收掉', async () => {
    const { doc, view } = await renderWithDoc(`正文\n\n${TABLE}\n结尾\n`)
    const user = userEvent.setup({ delay: null })
    const items = await rightClickCell(doc, 2, 0)
    await user.click(items.find((item) => item.textContent === '删除表格')!)
    expect(readDocumentSource(doc)).toBe('正文\n\n结尾\n')
    view.unmount()
  })

  it('点别处、按 Escape：菜单关掉', async () => {
    const { doc, view } = await renderWithDoc(TABLE)
    const user = userEvent.setup({ delay: null })
    await rightClickCell(doc, 2, 0)
    await user.keyboard('{Escape}')
    expect(menuItems(doc)).toHaveLength(0)
    await rightClickCell(doc, 2, 0)
    fireEvent.pointerDown(doc.ownerDocument.body)
    expect(menuItems(doc)).toHaveLength(0)
    view.unmount()
  })
})
