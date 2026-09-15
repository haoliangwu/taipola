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
import { lineAt } from './lines'

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
  return !tableRowCells(text).some(
    (cell) => cell.contentStart < column && column <= cell.contentEnd,
  )
}
