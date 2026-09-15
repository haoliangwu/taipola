/**
 * 表格的行列入口（`.scratch/table-ops/issues/03`）。
 *
 * 调研的结论是"一个入口都没有"：Enter / Shift+Enter / Tab / ⌘⏎ 全是空操作，
 * ⇧⌘⌫ 落到浏览器手里还会把格子里的字删掉，增列只能靠在格子里打竖线。
 *
 * 这里钉的是入口本身，分两层：Tab 走格子属于编辑内核（`renderEditor`），
 * ⌘⏎ / ⇧⌘⏎ / ⇧⌘⌫ 属于外壳的快捷键表（`renderWithDoc` 才挂得上）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithDoc } from '../test/appTestUtils'
import { stubSavedFolder } from '../test/platformStubs'
import {
  clickInRun,
  flush,
  placeCaretAt,
  renderEditor,
  type Rendering,
} from '../test/editorTestUtils'
import { readDocumentSource } from '../editor/render'

const TABLE = '| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n| c | d |\n'

/** The caret's cell, read from the DOM's own anchors. */
function caretCell(): { vline: string; cell: string } | null {
  const sel = window.getSelection()
  const el = (sel?.anchorNode instanceof Element
    ? sel.anchorNode
    : sel?.anchorNode?.parentElement) as HTMLElement | null
  const cell = el?.closest?.('[data-cell]') as HTMLElement | null
  const line = el?.closest?.('[data-vline]') as HTMLElement | null
  return cell && line ? { vline: line.dataset.vline!, cell: cell.dataset.cell! } : null
}

/** Puts the caret in a cell of the rendered table. */
function cellNode(container: HTMLElement, vline: number, cell: number): Node {
  const el = container.querySelector(
    `[data-vline="${vline}"] [data-cell="${cell}"]`,
  ) as HTMLElement
  return el.querySelector('[data-run]')?.firstChild ?? el
}

describe('Tab 走格子（编辑内核）', () => {
  async function caretIn(r: Rendering, vline: number, cell: number): Promise<void> {
    placeCaretAt(cellNode(r.container, vline, cell), 0)
    await flush()
  }

  it('Tab 进下一格，Shift+Tab 退回上一格', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 0, 'start')
    await caretIn(r, 2, 0)
    await r.user.keyboard('{Tab}')
    await flush()
    expect(caretCell()).toEqual({ vline: '2', cell: '1' })
    await r.user.keyboard('{Tab}')
    await flush()
    expect(caretCell()).toEqual({ vline: '3', cell: '0' })
    await r.user.keyboard('{Shift>}{Tab}{/Shift}')
    await flush()
    expect(caretCell()).toEqual({ vline: '2', cell: '1' })
  })

  it('最后一格再 Tab：加一行，光标落在新行的第一格', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 3, 1, 'start')
    await caretIn(r, 3, 1)
    await r.user.keyboard('{Tab}')
    await flush()
    expect(r.getDoc().trimEnd().split('\n')).toHaveLength(5)
    expect(caretCell()).toEqual({ vline: '4', cell: '0' })
  })

  it('表头第一格 Shift+Tab 不会再往回走', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await caretIn(r, 0, 0)
    await r.user.keyboard('{Shift>}{Tab}{/Shift}')
    await flush()
    expect(r.getDoc()).toBe(TABLE)
    expect(caretCell()).toEqual({ vline: '0', cell: '0' })
  })

  it('走格子不动文档，也不该占一格撤销', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 0, 'start')
    await caretIn(r, 2, 0)
    await r.user.keyboard('{Tab}')
    await flush()
    await r.user.keyboard('{Control>}z{/Control}')
    await flush()
    // 撤销栈里没有"移动光标"这种条目：文档原样。
    expect(r.getDoc()).toBe(TABLE)
  })
})

describe('⌘⏎ / ⇧⌘⏎ / ⇧⌘⌫（外壳快捷键）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  async function withTable() {
    const rendered = await renderWithDoc(TABLE)
    const user = userEvent.setup({ delay: null })
    return { ...rendered, user, source: () => readDocumentSource(rendered.doc) }
  }

  it('⌘⏎ 在下方插一行', async () => {
    const { doc, user, source, view } = await withTable()
    placeCaretAt(cellNode(doc, 2, 0), 0)
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n|  |  |\n| c | d |\n')
    view.unmount()
  })

  it('⇧⌘⏎ 在上方插一行', async () => {
    const { doc, user, source, view } = await withTable()
    placeCaretAt(cellNode(doc, 3, 0), 0)
    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n|  |  |\n| c | d |\n')
    view.unmount()
  })

  it('⇧⌘⌫ 删掉光标所在的行（以前这一步会把格子里的字删掉）', async () => {
    const { doc, user, source, view } = await withTable()
    placeCaretAt(cellNode(doc, 2, 0), 0)
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| c | d |\n')
    view.unmount()
  })

  it('表头行删不掉：文档不动', async () => {
    const { doc, user, source, view } = await withTable()
    placeCaretAt(cellNode(doc, 0, 0), 0)
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n| c | d |\n')
    view.unmount()
  })

  it('这些键在表格外面什么都不做（不误伤正文）', async () => {
    const { doc, view } = await renderWithDoc('正文一段\n\n第二段')
    const user = userEvent.setup({ delay: null })
    const first = doc.querySelector('[data-block="0"] [data-run="0"]')?.firstChild as Node
    placeCaretAt(first, 1)
    await user.keyboard('{Control>}{Enter}{/Control}')
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    expect(readDocumentSource(doc)).toBe('正文一段\n\n第二段')
    view.unmount()
  })
})
