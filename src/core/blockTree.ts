/**
 * 盒模型迁移第 1 步：语义化块树（`.scratch/block-model/…`）。
 *
 * 现状的 `parseDocument` 产出的是**按源平铺**的块（每个块是一个源区间切片，
 * 空行也成块），块与块之间由 `offsets` 衔接，`raw` 逐字符属于源。本模块在这层
 * 之上给每个块一个**语义类型**（heading / paragraph / blockquote / list /
 * table / fence / code / rule / footnote / blank），并用块树的形态重新打包——
 * 为第 3 步"编辑命令走块语义"提供结构，而不改变任何渲染/光标内核。
 *
 * 可逆性（核心不变量）：每个节点的 `raw` 就是它在源里的逐字符切片，所以
 * `serializeBlocks(tree)` 按 `raw` 拼接就能**字节级**重建原源；块的语义字段是
 * 附加元数据，不参与序列化。这保证"块树 ↔ 源码"双射，与 Typora"节点即真相 +
 * 写回重发"的差别只剩一步：现在写回的是原切片，将来是模板化重建（toMark）。
 */
import { parseDocument, type Block } from './markdown'
import {
  FOOTNOTE_DEFINITION,
  isThematicBreak,
  parseLine,
  type LineParts,
} from './inline'

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'blockquote'
  | 'list'
  | 'table'
  | 'fence'
  | 'rule'
  | 'footnote'
  | 'blank'

export interface BlockNode {
  kind: BlockKind
  /** The block's source slice, verbatim (same as `Block.raw`: trailing
      newline trimmed — the boundary to the next block is the join in
      `serializeBlocks`). */
  raw: string
  /** 0-based start line, inclusive. */
  startLine: number
  /** 0-based end line, exclusive. */
  endLine: number
  /** Heading depth 1–6, 0 otherwise (already parsed by `parseDocument`). */
  headingLevel: number
}

export interface BlockTree {
  blocks: BlockNode[]
}

/** Atx heading (`# `) or a setext underline (`==`, `--`) — the block's first line decides. */
const ATX_HEADING = /^#{1,6}\s/
const SETEXT_UNDERLINE = /^\s*(=+|-+)\s*$/
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/
const QUOTE_PREFIX = /^\s*>/
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s/
const TABLE_ROW = /^\s*\|/

/**
 * The semantic kind of one block, judged from its source shape.
 *
 * Markdown kind is a property of the block's first line plus, for setext
 * headings, its second. Everything else in the block follows the first line:
 * a list of items is one `list` block, a quoted passage one `blockquote`, a
 * fenced passage one `fence`, a table one `table`.
 */
export function kindOfBlock(block: Pick<Block, 'raw' | 'headingLevel'>): BlockKind {
  const raw = block.raw
  if (raw.trim() === '') return 'blank'
  if (block.headingLevel > 0) return 'heading'
  const lines = raw.split('\n')
  const first = lines[0] ?? ''
  if (ATX_HEADING.test(first)) return 'heading'
  if (isThematicBreak(first)) return 'rule'
  if (FENCE_OPEN.test(first)) return 'fence'
  if (QUOTE_PREFIX.test(first)) return 'blockquote'
  if (LIST_MARKER.test(first)) return 'list'
  if (TABLE_ROW.test(first)) return 'table'
  if (FOOTNOTE_DEFINITION.test(first)) return 'footnote'
  // Setext: `text` then `===`/`---` — markdown-it already levels these, but
  // `kindOfBlock` must not need the parser to agree.
  if (lines.length > 1 && SETEXT_UNDERLINE.test(lines[1] ?? '')) return 'heading'
  return 'paragraph'
}

/**
 * Builds the semantic block tree of a source document — the parser's tiles,
 * each labelled with its kind.
 *
 * No new parsing: `parseDocument` already tiles the source exactly (its DEV
 * assertion proves no character is dropped or duplicated), and it already
 * computed heading levels. This pass only classifies and repackages, so a
 * future change to the classification can never silently lose source.
 */
export function parseBlockTree(source: string): BlockTree {
  const parsed = parseDocument(source)
  const blocks: BlockNode[] = parsed.blocks.map((block) => ({
    kind: kindOfBlock(block),
    raw: block.raw,
    startLine: block.startLine,
    endLine: block.endLine,
    headingLevel: block.headingLevel,
  }))
  return { blocks }
}

/** What a single line's markup prefix is — the tree's line-level structure
    consumer (list items, quote layers, table rows; used by later steps). */
export function lineStructure(line: string): LineParts {
  return parseLine(line)
}