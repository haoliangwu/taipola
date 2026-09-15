/**
 * The table model: where a row's cells live in its source text, and which
 * keystroke would damage that structure.
 *
 * One module answers "what are this row's cells?" because several consumers need
 * the SAME answer: `view.ts` renders a row as a grid of cells, the kernel guards
 * Enter and Backspace on a row, and the row/column commands rewrite one row at a
 * time. Private copies are how the table predicates drifted from markdown-it in
 * the first place, which cost an entire invisible data row
 * (`.scratch/table-ops/issues/01`), so the split rule lives here once.
 *
 * Pure string work over the source: no DOM, no view model, node-layer tests.
 */
import { isTableDelimiterRow, isTableRow } from './inline'
import { lineAt, offsetForLine } from './lines'

export interface TableCell {
  /** Column in the row's raw text where the cell's piece begins (after the pipe). */
  pieceStart: number
  /**
   * Column where the cell's CONTENT begins — the piece without its padding.
   *
   * This is the position a caret belongs at, and the one an empty cell has to
   * fall back on: the spaces around a cell's text are its column padding, not
   * content, so the visible text of every row starts at the same x.
   */
  contentStart: number
  /** Column one past the content, where its trailing padding begins. */
  contentEnd: number
}

/**
 * The cells of one row, in source order.
 *
 * The OUTER pipes are delimiters, not cells: `| a | b |` is two cells. A first or
 * last piece that is not blank is a cell whose outer pipe is missing (`| a | b`
 * is also two cells) — reading it as an edge used to drop that cell's text from
 * the view entirely, which is the same invisible-content failure as an empty row
 * classified as a rule row.
 */
export function tableRowCells(raw: string): TableCell[] {
  const pieces = raw.split('|')
  const cells: TableCell[] = []
  let at = 0
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]
    const pieceStart = at
    at += piece.length + 1 // this piece plus the pipe that followed it
    const isOuterPipe = (i === 0 || i === pieces.length - 1) && piece.trim() === ''
    if (isOuterPipe) continue
    const contentStart = pieceStart + (piece.length - piece.trimStart().length)
    cells.push({ pieceStart, contentStart, contentEnd: contentStart + piece.trim().length })
  }
  return cells
}

/**
 * True when a Backspace at `offset` must do NOTHING, because the character behind
 * the caret is part of a table's structure rather than the user's text.
 *
 * Deleting it does not remove a row or a column, it removes the row's identity:
 * measured, Backspace at the left edge of a cell joined the row onto the
 * `| --- |` rule line above — `| 列 1 | 列 2 |\n| --- | ---||  |  |` — and the data
 * row was simply gone (`.scratch/table-ops/issues/01`). One Backspace at the
 * start of the first cell ate the rule row's LAST PIPE the same way.
 *
 * Backspace INSIDE a cell's content is an ordinary character delete and is left
 * alone, so this only refuses the positions where the caret sits in front of a
 * pipe, of a cell's padding, or anywhere on the rule row. The rule row has no
 * cells at all, so every position on it is refused.
 */
export function blocksTableBackspace(doc: string, offset: number): boolean {
  const { text, start } = lineAt(doc, offset)
  if (!isTableRow(text)) return false
  if (isTableDelimiterRow(text)) return true
  const column = offset - start
  // `<` on the left and `<=` on the right, deliberately: AT a cell's content start
  // there is nothing of the cell's to delete, while AT its end the last character
  // is. The asymmetry is the whole rule.
  const insideCell = tableRowCells(text).some(
    (cell) => cell.contentStart < column && column <= cell.contentEnd,
  )
  return !insideCell
}

/**
 * True when `offset` sits inside a table — where a BLOCK-level command must not
 * run.
 *
 * A row is one source line, so anything that brings a newline with it (a snippet,
 * a footnote definition, a thematic break) does not make a taller cell: it splits
 * the row, and the table falls apart into pipe-shaped paragraphs with no cell
 * boxes at all — measured, `⌥⌘T` with the caret in a cell left the row as
 * `|  \n| 列 1 | …` (`.scratch/table-ops/issues/04`). Those commands decline here
 * instead of damaging the document.
 */
export function inTable(doc: string, offset: number): boolean {
  return tableAt(doc, offset) !== null
}

/* -------------------------------------------------------------------------- */
/* reading a table                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The table an offset sits in: its line span, its column count, and where the
 * offset is inside it.
 *
 * "Is this a table?" is answered by the SOURCE SHAPE, the same way GFM answers it:
 * a run of row lines whose second line is a rule row. A table is therefore found
 * from any of its lines — and a paragraph that merely starts with a pipe is not
 * one (`| a | b |` alone has no rule row).
 */
export interface TableContext {
  /** 0-based line of the header row — the table's first line. */
  headerLine: number
  /** 0-based line of the `| --- |` rule row. */
  delimiterLine: number
  /** 0-based line of the table's last row, inclusive. */
  lastLine: number
  /** Columns, counted from the header row. */
  columns: number
  /** 0-based line the offset is on. */
  line: number
  /** 0-based cell index within that line, or -1 (the rule row holds no cells). */
  cell: number
}

export function tableAt(doc: string, offset: number): TableContext | null {
  const { lines, index, start } = lineAt(doc, offset)
  if (!isTableRow(lines[index] ?? '')) return null

  let header = index
  while (header > 0 && isTableRow(lines[header - 1])) header--
  // The rule row must be the SECOND line: that is what makes this run of pipe
  // lines a table rather than a paragraph that happens to contain pipes.
  const delimiter = header + 1
  if (!isTableDelimiterRow(lines[delimiter] ?? '')) return null

  let last = index
  while (last + 1 < lines.length && isTableRow(lines[last + 1])) last++

  return {
    headerLine: header,
    delimiterLine: delimiter,
    lastLine: last,
    columns: tableRowCells(lines[header]).length,
    line: index,
    // The rule row holds no cells at all; on any other row the offset belongs to
    // the last cell whose piece starts at or before it, so a caret on a pipe, in a
    // cell's padding, or before the first pipe is still inside a real cell.
    cell:
      index === delimiter ? -1 : cellAt(tableRowCells(lines[index]), offset - start),
  }
}

/** The index of the cell whose piece contains `column` (clamped to the row). */
function cellAt(cells: TableCell[], column: number): number {
  let at = 0
  for (let i = 0; i < cells.length; i++) if (cells[i].pieceStart <= column) at = i
  return at
}

/* -------------------------------------------------------------------------- */
/* editing a table                                                            */
/* -------------------------------------------------------------------------- */

/** A table edit: the new document, and where the caret belongs in it. */
export interface TableEdit {
  doc: string
  caret: number
}

/** A row's cell contents, verbatim, with the column padding dropped. */
function contentsOf(raw: string): string[] {
  return tableRowCells(raw).map((cell) => raw.slice(cell.contentStart, cell.contentEnd))
}

/** A row in its canonical `| a | b |` shape. */
function composeRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

/** Where a caret sits at cell `cell` of `line`, in a rebuilt document. */
function caretInCell(lines: string[], line: number, cell: number): number {
  const cells = tableRowCells(lines[line] ?? '')
  const target = cells[Math.max(0, Math.min(cell, cells.length - 1))]
  return offsetForLine(lines.join('\n'), line + 1) + (target?.contentStart ?? 0)
}

/**
 * Inserts an empty row above or below the offset's row.
 *
 * The new row is as wide as the header, and the caret lands in its first cell.
 * "Above" on the rule row means the first body position, not between the header
 * and the rule: a row there would take over the rule row's slot and the table
 * would stop being a table.
 */
export function insertTableRow(
  doc: string,
  offset: number,
  where: 'above' | 'below',
): TableEdit | null {
  const table = tableAt(doc, offset)
  if (!table) return null
  // A new row is ALWAYS a body row: the header is the first line and the rule row
  // is the second, so a row inserted at either of those slots stops the table
  // being a table (measured: `⌘⏎` on the header row put `|  |  |` between the
  // header and the rule row and every pipe line became one paragraph). "Above" the
  // header has no answer at all, so it declines.
  if (table.line === table.headerLine && where === 'above') return null
  const bodyStart = table.delimiterLine + 1
  const wanted = Math.max(where === 'above' ? table.line : table.line + 1, bodyStart)
  const lines = doc.split('\n')
  lines.splice(wanted, 0, composeRow(new Array(table.columns).fill('')))
  return { doc: lines.join('\n'), caret: caretInCell(lines, wanted, 0) }
}

/**
 * Deletes the offset's row, and puts the caret in the row that takes its place.
 *
 * The header row and the rule row are refused: the header IS the table (GFM takes
 * the first row as the header), and removing the rule row turns the whole thing
 * back into pipe-shaped paragraphs. Deleting one of those is 删除表格, which is a
 * separate command on purpose.
 */
export function deleteTableRow(doc: string, offset: number): TableEdit | null {
  const table = tableAt(doc, offset)
  if (!table) return null
  if (table.line === table.headerLine || table.line === table.delimiterLine) return null
  const lines = doc.split('\n')
  const column = Math.max(0, table.cell)
  lines.splice(table.line, 1)
  // The row that took its place — except when the deleted row was the last body
  // row, where that slot is now the rule row: the header is the honest place for
  // the caret, and the rule row is not a text position at all.
  const next =
    table.line === table.lastLine && table.line === table.delimiterLine + 1
      ? table.headerLine
      : Math.min(table.line, lines.length - 1)
  return { doc: lines.join('\n'), caret: caretInCell(lines, next, column) }
}

/** Inserts an empty column left or right of the offset's cell. */
export function insertTableColumn(
  doc: string,
  offset: number,
  side: 'left' | 'right',
): TableEdit | null {
  const table = tableAt(doc, offset)
  if (!table || table.cell < 0) return null
  const at = side === 'left' ? table.cell : table.cell + 1
  const lines = doc.split('\n')
  for (let i = table.headerLine; i <= table.lastLine; i++) {
    const cells = contentsOf(lines[i])
    // The rule row gets a rule cell, so the new column keeps a delimiter (a `|`
    // with nothing between is not a delimiter cell to GFM).
    cells.splice(at, 0, i === table.delimiterLine ? '---' : '')
    lines[i] = composeRow(cells)
  }
  return { doc: lines.join('\n'), caret: caretInCell(lines, table.line, at) }
}

/**
 * Deletes the offset's column from every row.
 *
 * Refused for a table's last remaining column: a table with no columns is not a
 * table, and the honest way to remove the whole thing is 删除表格.
 *
 * A ragged row (fewer cells than the header) is left as it is rather than having
 * some other cell taken out of it.
 */
export function deleteTableColumn(doc: string, offset: number): TableEdit | null {
  const table = tableAt(doc, offset)
  if (!table || table.cell < 0 || table.columns <= 1) return null
  const lines = doc.split('\n')
  for (let i = table.headerLine; i <= table.lastLine; i++) {
    const cells = contentsOf(lines[i])
    if (cells.length > table.cell) cells.splice(table.cell, 1)
    lines[i] = composeRow(cells)
  }
  // The caret stays in its own column, or moves to the new last one when it was
  // sitting in the column that was just removed.
  const caretCell = Math.min(table.cell, table.columns - 2)
  return { doc: lines.join('\n'), caret: caretInCell(lines, table.line, caretCell) }
}

/**
 * Removes the table's own lines.
 *
 * One of the two blank lines around it goes with it when both are there, so
 * deleting a table from between two paragraphs leaves one blank line rather than
 * two — and the caret lands where the table was.
 */
export function deleteTable(doc: string, offset: number): TableEdit | null {
  const table = tableAt(doc, offset)
  if (!table) return null
  const lines = doc.split('\n')
  lines.splice(table.headerLine, table.lastLine - table.headerLine + 1)
  // Where the caret goes: the line the table's first line became — or, when a
  // blank line was collapsed, the blank line that is left, so typing starts a new
  // paragraph where the table was instead of prepending to the next one.
  let caretLine = table.headerLine
  if (lines[caretLine - 1] === '' && lines[caretLine] === '') {
    lines.splice(caretLine, 1)
    caretLine -= 1
  }
  const next = lines.join('\n')
  return {
    doc: next,
    caret: offsetForLine(next, Math.min(Math.max(caretLine, 0) + 1, lines.length)),
  }
}

/**
 * Tab / Shift+Tab inside a table: the next or previous CELL.
 *
 * Forward from the last cell of the last row appends a row — Typora's "press Tab
 * in the last cell to add a row" — which is also the only keyboard path to a new
 * row. Backward from the first cell of the header stays put (returns null, so the
 * caller leaves the key alone).
 *
 * A move inside the existing rows returns the document UNCHANGED with a new
 * caret; the caller uses that to tell a move from an edit and skip the undo
 * snapshot.
 */
export function moveTableCell(
  doc: string,
  offset: number,
  direction: 'next' | 'prev',
): TableEdit | null {
  const table = tableAt(doc, offset)
  if (!table) return null
  const lines = doc.split('\n')

  // The rule row holds no cells of its own: forward from it is the first body
  // cell, backward is the header's last cell.
  if (table.line === table.delimiterLine) {
    if (direction === 'prev') {
      return { doc, caret: caretInCell(lines, table.headerLine, table.columns - 1) }
    }
    const body = table.delimiterLine + 1
    if (body <= table.lastLine) return { doc, caret: caretInCell(lines, body, 0) }
    return appendRowAnd(insertTableRow(doc, offset, 'below'), table.lastLine + 1)
  }

  if (direction === 'next') {
    if (table.cell + 1 < table.columns) {
      return { doc, caret: caretInCell(lines, table.line, table.cell + 1) }
    }
    if (table.line < table.lastLine) {
      return { doc, caret: caretInCell(lines, table.line + 1, 0) }
    }
    // Tab in the last cell of the last row adds a row — Typora's rule, and the
    // only keyboard path to a new row.
    return appendRowAnd(insertTableRow(doc, offset, 'below'), table.lastLine + 1)
  }

  if (table.cell > 0) return { doc, caret: caretInCell(lines, table.line, table.cell - 1) }
  // Backward off the first cell of a row: the previous row's last cell. The row
  // above a body row's first is the header when it is the rule row in between.
  const above = table.line - 1 === table.delimiterLine ? table.headerLine : table.line - 1
  if (above >= table.headerLine) {
    return { doc, caret: caretInCell(lines, above, table.columns - 1) }
  }
  return null
}

/** The appended row's caret, or null when there was no row to append. */
function appendRowAnd(added: TableEdit | null, line: number): TableEdit | null {
  if (!added) return null
  return { doc: added.doc, caret: caretInCell(added.doc.split('\n'), line, 0) }
}
