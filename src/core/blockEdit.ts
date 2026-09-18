/**
 * 盒模型迁移第 3 步：第一个走块语义的编辑命令 —— 段落中段硬换行
 * （`.scratch/block-model/issues/02`）。
 *
 * 原实现（kernel Enter 的中段分支）在源字符串上插 `\n\n`。这里以块树为操作
 * 对象：把光标所在的段落块一拆为二，中间补一个空白块，然后 `serialize` 回源
 * —— 命令不再关心"插几个换行"，只描述"这个段落从这里断成两段"。
 *
 * 块树编辑的真实代价在这一步暴露：块携带 `startLine/endLine`（序列化依赖
 * 跨度恢复空行数），拆一块 = 后面的块全部平移行号。本文件把它做成唯一一个
 * 会动行号的地方。
 */
import type { BlockNode, BlockTree } from './blockTree'
import { parseBlockTree } from './blockTree'
import { serializeBlocks } from './serialize'

export interface SplitParagraphResult {
  tree: BlockTree
  /** How many source CHARACTERS the split added — the caret shift. */
  addedChars: number
}

/**
 * Splits the single-line paragraph block containing `index` at `local`
 * characters into two paragraphs with one blank block between them.
 *
 * 块语义：一个段落从中间断成两个段落 —— 树是拆块（`[P] → [A, blank, B]`），
 * 而不是插入字符串。只接受同层单行段落（`raw` 不含换行）：软换行段的多行拆分
 * 涉及"该行内断 + 下半段承接"，留待后续命令切片；本命令先立住"拆块 + 行号
 * 平移 + 序列化回源"这条管线。
 *
 * 返回新树，以及新增源码字符数（原实现中段 Enter 固定加 `\n\n` = 2 个字符，
 * 光标从 `live` 移到 `live + 2`）。后续块的行号平移在这里一次完成。
 */
export function splitParagraphAtMid(
  tree: BlockTree,
  index: number,
  local: number,
): SplitParagraphResult | null {
  const block = tree.blocks[index]
  if (!block || block.kind !== 'paragraph' || block.raw.includes('\n')) return null
  if (local <= 0 || local >= block.raw.length) return null

  const left = block.raw.slice(0, local)
  const right = block.raw.slice(local)
  const start = block.startLine
  const blocks: BlockNode[] = tree.blocks.slice(0, index)

  // `[A][blank][B]` — three lines where one stood: A(span 1), the blank
  // separator (span 1: exactly the `\n\n` between two paragraphs), B(span 1).
  // A paragraph split puts the caret on B's first character (the source shifted
  // by the two newline characters the split added).
  blocks.push(
    { kind: 'paragraph', raw: left, startLine: start, endLine: start + 1, headingLevel: 0 },
    { kind: 'blank', raw: '', startLine: start + 1, endLine: start + 2, headingLevel: 0 },
    { kind: 'paragraph', raw: right, startLine: start + 2, endLine: start + 3, headingLevel: 0 },
  )
  // Every block AFTER the split shifts down by the two lines it gained.
  for (let i = index + 1; i < tree.blocks.length; i++) {
    const b = tree.blocks[i]
    if (!b) continue
    blocks.push({ ...b, startLine: b.startLine + 2, endLine: b.endLine + 2 })
  }

  return { tree: { blocks }, addedChars: 2 }
}

/** The full command: split, serialize, and report the caret to land on. */
export function enterMidParagraph(
  source: string,
  index: number,
  live: number,
  local: number,
): { source: string; caret: number } | null {
  const tree = parseBlockTree(source)
  const result = splitParagraphAtMid(tree, index, local)
  if (result === null) return null
  return { source: serializeBlocks(result.tree), caret: live + result.addedChars }
}