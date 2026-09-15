/**
 * 插出来的表格必须能填（`.scratch/table-ops/issues/01`）。
 *
 * 工具栏 `▦` / ⌥⌘T 插的就是下面这个骨架，而它的数据行是**空格子**。空数据行曾经
 * 被当成 `| --- |` 分隔行：0 高度、没有格子、光标落不进去，打进去的第一个字还因为
 * 落在收尾管道之后被当成边框丢掉。这里钉死整条链：行是行、格子是盒子、字进格子、
 * 退格不吃结构。
 */
import { describe, expect, it } from 'vitest'
import {
  assertDomMatchesSource,
  clickInRun,
  flush,
  placeCaretAt,
  renderEditor,
  type Rendering,
} from '../test/editorTestUtils'

/** `insertSnippet(buffer, TABLE_SNIPPET)` 的结果，一字不差。 */
const SKELETON = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n'

function rowEl(r: Rendering, vline: number): HTMLElement {
  return r.container.querySelector(
    `[data-block="0"] [data-vline="${vline}"]`,
  ) as HTMLElement
}

function cellEl(r: Rendering, vline: number, cell: number): HTMLElement {
  return r.container.querySelector(
    `[data-block="0"] [data-vline="${vline}"] [data-cell="${cell}"]`,
  ) as HTMLElement
}

/** Focus the host for real (untrusted keys need it), then aim at the data row. */
async function focusEditor(r: Rendering): Promise<void> {
  await clickInRun(r, 0, 0, 0, 'start')
  await flush()
}

/** Put the caret in an empty cell the way a click there does. */
async function caretInCell(r: Rendering, cell: number): Promise<void> {
  placeCaretAt(cellEl(r, 2, cell), 0)
  await flush()
}

describe('插入出来的表格', () => {
  it('空数据行是真实的一行格子，不是 0 高度的分隔行', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    const row = rowEl(r, 2)
    expect(row.className).toContain('vl-table')
    expect(row.className).not.toContain('vl-table-delim')
    expect(row.querySelectorAll(':scope > [data-cell]')).toHaveLength(2)
    // 0 高度的行盒看不见也点不到，那正是插出来的表格不能填的原因。
    expect(row.getBoundingClientRect().height).toBeGreaterThan(20)
  })

  it('每一格都带着自己的内容起点', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    expect(cellEl(r, 2, 0).dataset.cellSrc).toBe('31')
    expect(cellEl(r, 2, 1).dataset.cellSrc).toBe('34')
  })

  it('空格子里打字：字进这一格，再打一个字也不会丢', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    await caretInCell(r, 0)
    await r.user.keyboard('甲')
    await flush()
    expect(r.getDoc()).toContain('甲')
    await r.user.keyboard('乙')
    await flush()
    // 逐字都在：第一次修复前，第二个字会让第一个字从模型里消失。
    expect(r.getDoc()).toContain('甲乙')
    await assertDomMatchesSource(r)
  })

  it('第二格同样能打字', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    await caretInCell(r, 1)
    await r.user.keyboard('丙')
    await flush()
    expect(r.getDoc()).toContain('丙')
    await assertDomMatchesSource(r)
  })

  it('格子内容起点的退格不动表格结构', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    await caretInCell(r, 0)
    await r.user.keyboard('{Backspace}')
    await flush()
    // 修好之前这一步会把数据行并进 `| --- |` 行：`| --- | --- ||  |  |`。
    expect(r.getDoc()).toBe(SKELETON)
    await assertDomMatchesSource(r)
  })

  it('分隔行上的退格也不动表格结构', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    placeCaretAt(rowEl(r, 1), 1)
    await flush()
    await r.user.keyboard('{Backspace}')
    await flush()
    expect(r.getDoc()).toBe(SKELETON)
  })

  it('格子里的字照常按退格删掉（只挡住结构位置）', async () => {
    const r = renderEditor('| 列 1 | 列 2 |\n| --- | --- |\n| ab |  |\n')
    await flush()
    await focusEditor(r)
    placeCaretAt(cellEl(r, 2, 0).querySelector('[data-run]')!.firstChild as Node, 2)
    await flush()
    await r.user.keyboard('{Backspace}')
    await flush()
    expect(r.getDoc()).toContain('| a |')
  })
})
