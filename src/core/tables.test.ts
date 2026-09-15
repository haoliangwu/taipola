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
import {
  blocksTableBackspace,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  moveTableCell,
  tableAt,
  tableRowCells,
} from './tables'

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

/* -------------------------------------------------------------------------- */
/* reading and editing                                                        */
/* -------------------------------------------------------------------------- */

const TABLE = ['| 列 1 | 列 2 |', '| --- | --- |', '| a | b |', '| c | d |'].join('\n')

/** The document offset of `needle` (a unique substring of the fixture). */
function at(doc: string, needle: string, within = 0): number {
  return doc.indexOf(needle) + within
}

/** The cells of every line, spelled out so a failure reads as the table shape. */
function cellsAt(doc: string): string[] {
  return doc
    .split('\n')
    .map((line) =>
      tableRowCells(line)
        .map((cell) => line.slice(cell.contentStart, cell.contentEnd))
        .join('|'),
    )
}

/** Where the caret landed, in table terms: which line, which cell. */
function caretAt(doc: string, caret: number): { line: number; cell: number } | null {
  const found = tableAt(doc, caret)
  return found === null ? null : { line: found.line, cell: found.cell }
}

describe('tableAt：这张表在哪、光标在哪一格', () => {
  it('从任意一行都能找到整张表', () => {
    for (const line of ['| 列 1 | 列 2 |', '| --- | --- |', '| a | b |', '| c | d |']) {
      const found = tableAt(TABLE, at(TABLE, line))
      expect(found).toMatchObject({ headerLine: 0, delimiterLine: 1, lastLine: 3, columns: 2 })
    }
  })

  it('光标在哪一格：格子内容里、格子的内边距里、管道上，都算这一格', () => {
    const row = at(TABLE, '| a | b |')
    expect(tableAt(TABLE, row + 2)!.cell).toBe(0)
    expect(tableAt(TABLE, row + 4)!.cell).toBe(0)
    expect(tableAt(TABLE, row + 6)!.cell).toBe(1)
    expect(tableAt(TABLE, row + 7)!.cell).toBe(1)
  })

  it('分隔行没有格子', () => {
    expect(tableAt(TABLE, at(TABLE, '| --- | --- |') + 4)!.cell).toBe(-1)
  })

  it('只有管道、没有分隔行的段落不是表格', () => {
    expect(tableAt('| a | b |\n| c | d |', 2)).toBeNull()
    expect(tableAt('正文', 1)).toBeNull()
  })
})

describe('增删行', () => {
  it('在下方插一行：宽度跟着表头，光标落在新行第一格', () => {
    const edit = insertTableRow(TABLE, at(TABLE, '| a | b |') + 2, 'below')!
    expect(cellsAt(edit.doc)).toEqual(['列 1|列 2', '---|---', 'a|b', '|', 'c|d'])
    expect(caretAt(edit.doc, edit.caret)).toEqual({ line: 3, cell: 0 })
  })

  it('在上方插一行', () => {
    const edit = insertTableRow(TABLE, at(TABLE, '| c | d |') + 2, 'above')!
    expect(cellsAt(edit.doc).indexOf('a|b')).toBe(2)
    expect(cellsAt(edit.doc).indexOf('|')).toBe(3)
  })

  it('分隔行上插入：进的是第一行正文，不会顶掉分隔行', () => {
    const edit = insertTableRow(TABLE, at(TABLE, '| --- | --- |') + 4, 'above')!
    expect(cellsAt(edit.doc)[1]).toBe('---|---')
    expect(cellsAt(edit.doc)[2]).toBe('|')
  })

  it('表头上方插不了行（表头就是第一行）', () => {
    expect(insertTableRow(TABLE, at(TABLE, '| 列 1 | 列 2 |') + 2, 'above')).toBeNull()
  })

  it('表头下方插行：进的是第一行正文，不是分隔行的位置', () => {
    // 插在表头与分隔行之间的话，分隔行就不再是第二行，整张表会变成一个段落
    // （每一行都失去边框）。
    const edit = insertTableRow(TABLE, at(TABLE, '| 列 1 | 列 2 |') + 2, 'below')!
    expect(cellsAt(edit.doc)[1]).toBe('---|---')
    expect(cellsAt(edit.doc)[2]).toBe('|')
    expect(tableAt(edit.doc, 0)).toMatchObject({ delimiterLine: 1 })
  })

  it('删掉唯一一行正文之后，光标回到表头，不是落在分隔行上', () => {
    const one = '| 列 1 | 列 2 |\n| --- | --- |\n| a | b |'
    const edit = deleteTableRow(one, at(one, '| a | b |') + 2)!
    expect(caretAt(edit.doc, edit.caret)).toEqual({ line: 0, cell: 0 })
  })

  it('删一行：格子从表里消失，光标留在原列', () => {
    const edit = deleteTableRow(TABLE, at(TABLE, '| a | b |') + 6)!
    expect(cellsAt(edit.doc)).toEqual(['列 1|列 2', '---|---', 'c|d'])
    // The row that took its place, same column.
    expect(caretAt(edit.doc, edit.caret)).toEqual({ line: 2, cell: 1 })
  })

  it('表头行与分隔行删不掉（那是"删除表格"的事）', () => {
    expect(deleteTableRow(TABLE, at(TABLE, '| 列 1 | 列 2 |') + 2)).toBeNull()
    expect(deleteTableRow(TABLE, at(TABLE, '| --- | --- |') + 2)).toBeNull()
  })

  it('删掉最后一行正文之后，表格还在（表头 + 分隔行仍然是一张表）', () => {
    const one = '| 列 1 | 列 2 |\n| --- | --- |\n| a | b |'
    const edit = deleteTableRow(one, at(one, '| a | b |') + 2)!
    expect(edit.doc).toBe('| 列 1 | 列 2 |\n| --- | --- |')
    expect(tableAt(edit.doc, 0)).toMatchObject({ lastLine: 1, columns: 2 })
  })
})

describe('增删列', () => {
  it('在右边插一列：每一行都长出一格，分隔行长出的是一根横线', () => {
    const edit = insertTableColumn(TABLE, at(TABLE, '| a | b |') + 2, 'right')!
    expect(cellsAt(edit.doc)).toEqual([
      '列 1||列 2',
      '---|---|---',
      'a||b',
      'c||d',
    ])
    expect(caretAt(edit.doc, edit.caret)).toEqual({ line: 2, cell: 1 })
  })

  it('在左边插一列', () => {
    const edit = insertTableColumn(TABLE, at(TABLE, '| a | b |') + 2, 'left')!
    expect(cellsAt(edit.doc)[2]).toBe('|a|b')
  })

  it('删一列：每一行都少一格', () => {
    const edit = deleteTableColumn(TABLE, at(TABLE, '| a | b |') + 6)!
    expect(cellsAt(edit.doc)).toEqual(['列 1', '---', 'a', 'c'])
  })

  it('最后一列删不掉（没有列的表格不成表）', () => {
    const one = '| a |\n| --- |\n| b |'
    expect(deleteTableColumn(one, 2)).toBeNull()
  })

  it('分隔行没有格子，所以删不了列', () => {
    expect(deleteTableColumn(TABLE, at(TABLE, '| --- | --- |') + 2)).toBeNull()
  })
})

describe('删除整张表', () => {
  it('连同它两侧的一行空行一起收掉，不留双空行', () => {
    const doc = `正文\n\n${TABLE}\n\n结尾`
    const edit = deleteTable(doc, at(doc, '| a | b |') + 2)!
    expect(edit.doc).toBe('正文\n\n结尾')
    // The caret lands on the blank line the table was on, not on the paragraph.
    expect(edit.caret).toBe(3)
  })
})

describe('Tab 走格子', () => {
  it('同一行里往后走一格', () => {
    const edit = moveTableCell(TABLE, at(TABLE, '| a | b |') + 2, 'next')!
    expect(edit.doc).toBe(TABLE)
    expect(caretAt(edit.doc, edit.caret)).toEqual({ line: 2, cell: 1 })
  })

  it('一行走完进下一行的第一格', () => {
    const edit = moveTableCell(TABLE, at(TABLE, '| a | b |') + 6, 'next')!
    expect(edit.doc).toBe(TABLE)
    expect(caretAt(edit.doc, edit.caret)).toEqual({ line: 3, cell: 0 })
  })

  it('最后一格再 Tab：加一行（这是唯一能加行的键盘路径）', () => {
    const edit = moveTableCell(TABLE, at(TABLE, '| c | d |') + 6, 'next')!
    expect(edit.doc).not.toBe(TABLE)
    expect(cellsAt(edit.doc)[4]).toBe('|')
    expect(caretAt(edit.doc, edit.caret)).toEqual({ line: 4, cell: 0 })
  })

  it('Shift+Tab 往回走，从表头第一格往回就没得走', () => {
    const back = moveTableCell(TABLE, at(TABLE, '| a | b |') + 2, 'prev')!
    expect(back.doc).toBe(TABLE)
    // Over the rule row (which holds no cells) and into the header's last cell.
    expect(caretAt(back.doc, back.caret)).toEqual({ line: 0, cell: 1 })
    expect(moveTableCell(TABLE, at(TABLE, '| 列 1 | 列 2 |') + 2, 'prev')).toBeNull()
  })

  it('光标在分隔行上：往前进第一行正文，往回进表头', () => {
    const rule = at(TABLE, '| --- | --- |') + 4
    expect(caretAt(TABLE, moveTableCell(TABLE, rule, 'next')!.caret)).toEqual({ line: 2, cell: 0 })
    expect(caretAt(TABLE, moveTableCell(TABLE, rule, 'prev')!.caret)).toEqual({ line: 0, cell: 1 })
  })
})
