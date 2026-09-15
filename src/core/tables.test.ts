/**
 * The table model: where a row's cells are, and which Backspace is refused.
 *
 * Both rules exist because of one incident (`.scratch/table-ops/issues/01`): the
 * toolbar's own skeleton put an empty data row on screen, and the editor could
 * neither draw it nor keep a caret in it — the caret landed before the row's
 * first pipe, and one Backspace there joined the row onto the `| --- |` line
 * above, so the data row was gone.
 */
import { describe, expect, it } from 'vitest'
import { blocksTableBackspace, tableRowCells } from './tables'

describe('tableRowCells：一行的格子在哪', () => {
  it('外层的管道是分隔符，不是格子', () => {
    expect(tableRowCells('| a | b |').map((cell) => cell.contentStart)).toEqual([2, 6])
  })

  it('格子两侧的空格是列内边距，内容从文字开始', () => {
    expect(tableRowCells('|   ab   |')).toEqual([
      { pieceStart: 1, contentStart: 4, contentEnd: 6 },
    ])
  })

  it('空格子也占一格，落点在自己收尾管道之前', () => {
    const cells = tableRowCells('|  |  |')
    expect(cells.map((cell) => cell.contentStart)).toEqual([3, 6])
    expect(cells.map((cell) => cell.contentEnd)).toEqual([3, 6])
  })

  it('`||` 是一格空格子', () => {
    expect(tableRowCells('||')).toEqual([
      { pieceStart: 1, contentStart: 1, contentEnd: 1 },
    ])
  })

  it('少一根尾管道时最后一格仍然在（它曾经被当边框丢掉）', () => {
    expect(tableRowCells('| a | b').map((cell) => cell.contentStart)).toEqual([2, 6])
  })
})

describe('blocksTableBackspace：表格结构不该被退格吃掉', () => {
  const doc = '| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n'

  it('格子内容起点：什么都不做', () => {
    expect(blocksTableBackspace(doc, doc.indexOf('| a | b |') + 2)).toBe(true)
    expect(blocksTableBackspace(doc, doc.indexOf('| a | b |') + 6)).toBe(true)
  })

  it('格子内容里面：照常删字', () => {
    expect(blocksTableBackspace(doc, doc.indexOf('| a | b |') + 7)).toBe(false)
  })

  it('分隔行上任何位置：什么都不做', () => {
    const at = doc.indexOf('| --- | --- |')
    expect(blocksTableBackspace(doc, at)).toBe(true)
    expect(blocksTableBackspace(doc, at + 7)).toBe(true)
  })

  it('空数据行的两格：都挡住（正是插出来的那张表）', () => {
    const empty = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n'
    const row = empty.indexOf('|  |  |')
    expect(blocksTableBackspace(empty, row + 3)).toBe(true)
    expect(blocksTableBackspace(empty, row + 6)).toBe(true)
  })

  it('表格以外的行：不管', () => {
    expect(blocksTableBackspace('正文\n第二行', 2)).toBe(false)
    expect(blocksTableBackspace('- a\n- b', 5)).toBe(false)
  })
})
