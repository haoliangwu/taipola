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
  caretInTableCell,
  clickInRun,
  flush,
  placeCaretAt,
  renderEditor,
  tableCellEl,
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

describe('Tab 走格子（编辑内核）', () => {
  it('Tab 进下一格，Shift+Tab 退回上一格', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 0, 'start')
    await caretInTableCell(r, 2, 0)
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
    await caretInTableCell(r, 3, 1)
    await r.user.keyboard('{Tab}')
    await flush()
    expect(r.getDoc().trimEnd().split('\n')).toHaveLength(5)
    expect(caretCell()).toEqual({ vline: '4', cell: '0' })
  })

  it('Tab 从有字的格子进空格子：光标真的进去了，接着打字的字也落在那里', async () => {
    // 行的 run 属于各自的格子，而空格子一个 run 都没有：光标回落到"前一个 run 的末
    // 尾"就会留在上一格，Tab 看起来毫无反应，下一个字还写进上一格
    // （`| 甲 |  |` 打字变成 `| 甲一 |  |`）。
    const r = renderEditor('| 列 1 | 列 2 |\n| --- | --- |\n| 甲 |  |\n')
    await flush()
    await clickInRun(r, 0, 2, 0, 'start')
    await caretInTableCell(r, 2, 0)
    await r.user.keyboard('{Tab}')
    await flush()
    expect(caretCell()).toEqual({ vline: '2', cell: '1' })
    await r.user.keyboard('一')
    await flush()
    expect(r.getDoc()).toContain('| 甲 | 一 |')
  })

  it('光标落到分隔行上：打字进的是正文格子，不是分隔行本身', async () => {
    // 从表头按方向键下就到这里。以前在这里打字会把分隔行写成 `一| --- | --- |`，
    // 于是第二行不再是分隔行，整张表变成一个段落。
    const r = renderEditor('| 列 1 | 列 2 |\n| --- | --- |\n| 甲 | 乙 |\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    placeCaretAt(r.container.querySelector('[data-block="0"] [data-vline="1"]') as Node, 0)
    await flush()
    await r.user.keyboard('一')
    await flush()
    const doc = r.getDoc()
    expect(doc).not.toContain('一| ---')
    expect(doc.split('\n')[1]).toBe('| --- | --- |')
    expect(doc).toContain('一')
  })

  it('表头第一格 Shift+Tab 不会再往回走', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await caretInTableCell(r, 0, 0)
    await r.user.keyboard('{Shift>}{Tab}{/Shift}')
    await flush()
    expect(r.getDoc()).toBe(TABLE)
    expect(caretCell()).toEqual({ vline: '0', cell: '0' })
  })

  it('走格子不动文档，也不该占一格撤销', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 0, 'start')
    await caretInTableCell(r, 2, 0)
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
    placeCaretAt(tableCellEl(doc, 2, 0), 0)
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n|  |  |\n| c | d |\n')
    view.unmount()
  })

  it('⇧⌘⏎ 在上方插一行', async () => {
    const { doc, user, source, view } = await withTable()
    placeCaretAt(tableCellEl(doc, 3, 0), 0)
    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n|  |  |\n| c | d |\n')
    view.unmount()
  })

  it('⇧⌘⌫ 删掉光标所在的行（以前这一步会把格子里的字删掉）', async () => {
    const { doc, user, source, view } = await withTable()
    placeCaretAt(tableCellEl(doc, 2, 0), 0)
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| c | d |\n')
    view.unmount()
  })

  it('⇧⌘⌫ 在表头上：删的是整张表（表头不能单独删，这一按就删到表为止）', async () => {
    const { doc, user, source, view } = await withTable()
    placeCaretAt(tableCellEl(doc, 0, 0), 0)
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    expect(source()).toBe('')
    view.unmount()
  })

  it('⇧⌘⌫ 连按：一行行删掉，最后表头那一按把整张表删掉', async () => {
    const { doc, user, source, view } = await withTable()
    placeCaretAt(tableCellEl(doc, 2, 0), 0) // 第一行正文
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| c | d |\n')
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    // 唯一一行正文也删掉：光标回到表头，表格只剩表头 + 分隔行。
    expect(source()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n')
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    // 表头上没有"行"可删，这一按删掉整张表——连按 ⇧⌘⌫ 终于可以消到什么都没有。
    expect(source()).toBe('')
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    expect(source()).toBe('') // 表已经不在，什么都不做
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
