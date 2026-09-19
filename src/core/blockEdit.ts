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

/**
 * Enter at the END of a line INSIDE a multi-line (soft-broken) paragraph: the
 * paragraph breaks there — the line ends the paragraph, everything below it
 * becomes a NEW paragraph, with a blank block in between.
 *
 * 块语义：`[P('甲\n乙')]`（软换行同段两行）光标在「甲」行尾按 Enter
 * → `[P('甲'), blank, P('乙')]` —— 源 `甲\n\n乙`：甲 与 乙 各自成段，
 * 光标落在中间的空白块（新段落占位，kernel 的 Enter-标记让下一次键入成为
 * 新段落内容，`enter-backspace-smoke/01`「任何位置 Enter 都是硬换行」）。
 *
 * `local` 是块内字符偏移，必须停在某一行的行尾（行终止换行符之前）；行终止
 * 换行归 LEFT（本行仍是左段内容），`right` 从下一行承接。
 */
export function splitParagraphAtLineEnd(
  tree: BlockTree,
  index: number,
  local: number,
): { tree: BlockTree; addedChars: number; caretDelta: number } | null {
  const block = tree.blocks[index]
  if (!block || block.kind !== 'paragraph') return null
  if (local <= 0 || local >= block.raw.length) return null
  const splitAt = block.raw.indexOf('\n', local)
  if (splitAt < 0) return null // 最后一行行尾：段尾 Enter 走 growParagraphGap

  const left = block.raw.slice(0, splitAt)
  const right = block.raw.slice(splitAt + 1)
  const start = block.startLine
  const blocks: BlockNode[] = tree.blocks.slice(0, index)
  // `[A][blank][B]`：左段（含本行）、空行、右段（后续行全部承接为新段）。
  blocks.push(
    { kind: 'paragraph', raw: left, startLine: start, endLine: start + 1, headingLevel: 0 },
    { kind: 'blank', raw: '', startLine: start + 1, endLine: start + 2, headingLevel: 0 },
    { kind: 'paragraph', raw: right, startLine: start + 2, endLine: start + 3, headingLevel: 0 },
  )
  for (let i = index + 1; i < tree.blocks.length; i++) {
    const b = tree.blocks[i]
    if (!b) continue
    blocks.push({ ...b, startLine: b.startLine + 2, endLine: b.endLine + 2 })
  }
  // `甲\n乙`（3 字符）→ `甲\n\n乙`（4 字符）：+1。光标落**右段首**——中间的
  // 空白块不渲染行盒（十一审），caret 只能落在有行盒的位置。
  return { tree: { blocks }, addedChars: 1, caretDelta: 2 }
}

/** Full command: break the paragraph at the caret's line end. Caret lands on
    the fresh blank block (the new paragraph placeholder), one past the break. */
export function enterEndOfLine(
  source: string,
  index: number,
  live: number,
  local: number,
): { source: string; caret: number } | null {
  const tree = parseBlockTree(source)
  const result = splitParagraphAtLineEnd(tree, index, local)
  if (result === null) return null
  return { source: serializeBlocks(result.tree), caret: live + result.caretDelta }
}

/**
 * Backspace at a paragraph's line start moves it up onto the paragraph above —
 * ONE Blank block is consumed and the two paragraphs merge into one
 * soft-broken paragraph.
 *
 * 块语义：`[A, blank, B] → [A\nB]`。一次 Backspace 就是删一个换行；空行块
 * 恰好一行时被整体消费，A 与 B 以软换行相接。只对"空行恰好一行"的结构生效
 * （多个空行、上方不是段落 → null，回退字符串路径 —— 那里一次同样只删一个
 * 换行，几次才并完，行为一致）。
 *
 * 返回新树；caret 落在 merge 点（原空行块的起点），kernel 用自己的 offsets
 * 取，这里不预知绝对偏移。
 */
export function joinParagraphWithAbove(tree: BlockTree, index: number): BlockTree | null {
  const block = tree.blocks[index]
  if (!block || block.kind !== 'paragraph' || block.raw.includes('\n')) return null
  const blank = tree.blocks[index - 1]
  if (!blank || blank.kind !== 'blank') return null
  if (blank.endLine - blank.startLine !== 1) return null
  const above = tree.blocks[index - 2]
  if (!above || above.kind !== 'paragraph') return null

  // A(1 行) + blank(1 行) + B(1 行) = 3 行 → 合并段 A\nB = 2 行：后续整体 -1。
  const merged: BlockNode = {
    kind: 'paragraph',
    raw: `${above.raw}\n${block.raw}`,
    startLine: above.startLine,
    endLine: above.endLine + 1,
    headingLevel: 0,
  }
  const blocks: BlockNode[] = [
    ...tree.blocks.slice(0, index - 2),
    merged,
    ...tree.blocks.slice(index + 1).map((b) => ({
      ...b,
      startLine: b.startLine - 1,
      endLine: b.endLine - 1,
    })),
  ]
  return { blocks }
}

/** The full command: join, serialize — the caret lives at the old blank
    block's offset, which the kernel knows; this returns only the new source. */
export function backspaceJoinParagraphs(source: string, index: number): string | null {
  const tree = parseBlockTree(source)
  const joined = joinParagraphWithAbove(tree, index)
  return joined === null ? null : serializeBlocks(joined)
}
/**
 * Enter at a PARAGRAPH or HEADING's END opens a fresh line below it — the
 * blank block after it grows by one line, or one is appended when there is
 * none (the block is the document's last and carries no trailing newline).
 *
 * 块语义：`[P, blank(k行)] → [P, blank(k+1行)]`，或 `[P(末块)] → [P, blank(1行)]`。
 * 接受**多行软换行段**与**标题**：行尾 Enter = 硬换行（开出一个新块），
 * 光标落在这个新空块上，随后键入经段落化成为**新段落**（`enter-backspace-smoke/01`
 * 的"行尾 Enter = 硬换行"，块级表达 = 段落下方一个空块，`paragraph-spacing/01` 九审）。
 *
 * 返回新树与新增字符数（1）。光标落点 = P 的 raw 之后第一个换行后 —— kernel
 * 用自身 offsets 计算绝对位置。
 */
export function growParagraphGap(
  tree: BlockTree,
  index: number,
): { tree: BlockTree; addedChars: 1; caretDelta: number } | null {
  const block = tree.blocks[index]
  if (!block || (block.kind !== 'paragraph' && block.kind !== 'heading')) return null
  const next = tree.blocks[index + 1]
  // Enter opens ONE fresh blank line right below the paragraph. At the
  // document's end that blank serializes to nothing (the trailing newline
  // belongs to the paragraph), and the caret sits on the virtual blank line —
  // the kernel's Enter-placeholder mark turns its next keystroke into a new
  // paragraph. When a blank block already follows, the fresh one serializes
  // as a real blank line between the two.
  const fresh: BlockNode = {
    kind: 'blank',
    raw: '',
    startLine: block.endLine,
    endLine: block.endLine + 1,
    headingLevel: 0,
  }
  if (next !== undefined) {
    if (next.kind !== 'blank') return null
    const blocks: BlockNode[] = [
      ...tree.blocks.slice(0, index + 1),
      fresh,
      ...tree.blocks.slice(index + 1).map((b) => ({
        ...b,
        startLine: b.startLine + 1,
        endLine: b.endLine + 1,
      })),
    ]
    return { tree: { blocks }, addedChars: 1, caretDelta: 1 }
  }
  const blocks: BlockNode[] = [...tree.blocks, fresh]
  return { tree: { blocks }, addedChars: 1, caretDelta: 1 }
}

/** The full command: grow, serialize, and report where the caret lands —
    the paragraph's end plus `caretDelta` newlines (1 when a blank line was
    appended, 2 when an existing one grew), which the kernel adds to the
    paragraph block's own offset. */
export function enterEndParagraph(
  source: string,
  index: number,
): { source: string; caretDelta: number } | null {
  const tree = parseBlockTree(source)
  const grown = growParagraphGap(tree, index)
  return grown === null
    ? null
    : { source: serializeBlocks(grown.tree), caretDelta: grown.caretDelta }
}
