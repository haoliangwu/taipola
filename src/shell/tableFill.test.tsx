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
  caretInTableCell,
  clickInRun,
  flush,
  placeCaretAt,
  renderEditor,
  tableCellEl,
  type Rendering,
} from '../test/editorTestUtils'

/** `insertSnippet(buffer, TABLE_SNIPPET)` 的结果，一字不差。 */
const SKELETON = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n'

function rowEl(r: Rendering, vline: number): HTMLElement {
  return r.container.querySelector(
    `[data-block="0"] [data-vline="${vline}"]`,
  ) as HTMLElement
}

/** Focus the host for real (untrusted keys need it), then aim at the data row. */
async function focusEditor(r: Rendering): Promise<void> {
  await clickInRun(r, 0, 0, 0, 'start')
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
    expect(tableCellEl(r.container, 2, 0).dataset.cellSrc).toBe('31')
    expect(tableCellEl(r.container, 2, 1).dataset.cellSrc).toBe('34')
  })

  it('空格子里打字：字进这一格，再打一个字也不会丢', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    await caretInTableCell(r, 2, 0)
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
    await caretInTableCell(r, 2, 1)
    await r.user.keyboard('丙')
    await flush()
    expect(r.getDoc()).toContain('丙')
    await assertDomMatchesSource(r)
  })

  it('中文输入法往空格子里合成：字进这一格，不会另起一行', async () => {
    // 用户报的现象（截图）：打了一个字之后，表格最后一行"边框消失"——其实是那一行
    // 变成了没有管道的普通段落。空格子没有 run，输入法的拼音是直接写进 cell 的。
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    await caretInTableCell(r, 2, 0)
    const cell = tableCellEl(r.container, 2, 0)
    cell.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const composing = document.createTextNode('y')
    cell.appendChild(composing)
    cell.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    cell.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'y' }))
    await flush()
    composing.textContent = '一'
    cell.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    cell.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    cell.dispatchEvent(new InputEvent('input', { bubbles: true, data: '一' }))
    await flush()
    // The character is committed INTO the cell: nothing is lost and no line
    // appears that is not a table row.
    expect(r.getDoc()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| 一 |  |\n')
    await assertDomMatchesSource(r)
  })

  it('往格子里粘贴带换行的文字：不把这一行劈成两行', async () => {
    // 复制一行文字时剪贴板通常自带换行，而格子是 `white-space: pre-wrap`：换行会
    // 原样进到这一行的源码里。一行表格就是一个源码行，于是它被劈开、整块塌成普通
    // 段落——屏幕上就是"最后一行边框消失了"（`.scratch/table-ops/issues/04`）。
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    await caretInTableCell(r, 2, 0)
    await r.user.paste('甲\n一')
    await flush()
    expect(r.getDoc()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| 甲 一 |  |\n')
    await assertDomMatchesSource(r)
  })

  it('粘贴一整行（结尾自带换行）也只落进格子', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    await caretInTableCell(r, 2, 0)
    await r.user.paste('一\n')
    await flush()
    expect(r.getDoc()).toBe('| 列 1 | 列 2 |\n| --- | --- |\n| 一 |  |\n')
    await assertDomMatchesSource(r)
  })

  it('同一行的两个格子一样高：竖线不会在行中间断掉', async () => {
    // 分隔两列的竖线是左格自己的 border-right，所以只要左格比这一行矮（左边一行
    // 短文字，右边折成两行），竖线就在半中间断掉一小段。stretch 让每格都撑到行的
    // 全高，竖线和横线一样整（`.scratch/table-ops/issues/05`）。
    const r = renderEditor(
      '| 快捷键 | 作用 |\n| --- | --- |\n' +
        '| `Tab` / `⇧Tab` 一整行短文字 | 表格里：下一格 / 上一格（最后一格再按 `Tab` 加一行） |\n',
    )
    await flush()
    const cells = [...r.container.querySelectorAll('[data-block="0"] [data-vline="2"] [data-cell]')]
    expect(cells).toHaveLength(2)
    const [left, right] = cells.map((c) => c.getBoundingClientRect().height)
    expect(left).toBeCloseTo(right, 1)
    // 两格上沿对齐（同属一行的格子盒），下沿也是。
    const [lt, rt] = cells.map((c) => c.getBoundingClientRect().top)
    expect(lt).toBeCloseTo(rt, 1)
  })

  it('格子内容起点的退格不动表格结构', async () => {
    const r = renderEditor(SKELETON)
    await flush()
    await focusEditor(r)
    await caretInTableCell(r, 2, 0)
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
    placeCaretAt(tableCellEl(r.container, 2, 0).querySelector('[data-run]')!.firstChild as Node, 2)
    await flush()
    await r.user.keyboard('{Backspace}')
    await flush()
    expect(r.getDoc()).toContain('| a |')
  })
})
