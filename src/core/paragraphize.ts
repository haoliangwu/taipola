/**
 * 空行被输入占用时的处置（`.scratch/paragraph-spacing/issues/01`）。
 *
 * 用户裁定（2026-09，十审）：在新设计（硬换行 = 创建新块、软换行 = 块内换行）
 * 下，**空行上打字 = 字符直接新建一个块** —— `甲\n\n乙` 打 x → `甲\n\nx\n\n乙`
 * （甲、x、乙三段）。空白行本是段落边界之间的占位，打字把它占用 = 把它变成
 * 一个新段落；段落边界与间距因此天然保持（Typora 实测语义）。
 *
 * 因此本函数只做一件事：**结构外的空行被打字占用时，补上缺失的段落边界**
 * （`甲\n` Enter 打 x → `甲\n\nx`；`\n甲` 开头打 x → `x\n\n甲`）。围栏/表格/
 * 引用/列表内部的空行由 kernel 的 kind 门控拦下，绝不补边界（不拆代码/结构）。
 *
 * 纯文本级判断与修正，不知道块树：只处理"插入前这一行整行是空白、插入后不是"
 * 这一种形状（删除、替换、段中插入一概不碰）。
 */
import { isBlankLine } from './lines'

/** 行区间 [start, end)（不含行终止换行）与文本。 */
function boundsOf(doc: string, offset: number): { start: number; end: number; text: string } {
  const start = doc.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  const newline = doc.indexOf('\n', offset)
  const end = newline < 0 ? doc.length : newline
  return { start, end, text: doc.slice(start, end) }
}

/** 在行 [lineStart, …) 之后补一个空行边界（若该行后紧贴非空行内容）。 */
function fenceAfter(doc: string, lineStart: number): string {
  const newline = doc.indexOf('\n', lineStart)
  const end = newline < 0 ? doc.length : newline
  // 行尾换行之后没有字符（end 是最后一个字符，文末虚拟空行）或已经是空行 → 已围。
  const alreadyFenced = end + 1 >= doc.length || doc[end + 1] === '\n'
  if (alreadyFenced) return doc
  return `${doc.slice(0, end)}\n${doc.slice(end)}`
}

/**
 * The inserted-text correction: when a keystroke turns a whole blank line into a
 * line of text, that line becomes a paragraph of its OWN — a blank line on each
 * side (`甲\n\n乙` + typing `x` → `甲\n\nx\n\n乙`, Typora-verified; the user's
 * rule: typing on a blank CREATES a block). Applies to every blank outside a
 * structure; the kernel's kind gate stops fences, tables, quotes and lists.
 *
 * Returns null when nothing needs doing (the usual case: every other edit).
 */
export function paragraphizeTypedBlankLine(
  before: string,
  after: string,
  caret: number,
): { doc: string; caret: number } | null {
  const inserted = after.length - before.length
  if (inserted <= 0) return null
  const insertStart = caret - inserted
  if (insertStart < 0) return null

  const wasBlank = boundsOf(before, insertStart)
  if (!isBlankLine(wasBlank.text)) return null
  const nowLine = boundsOf(after, insertStart)
  if (isBlankLine(nowLine.text)) return null

  let doc = after
  let shift = 0

  // Front fence: unless the text line already follows a blank line (or is the
  // document's first), give it one.
  const front = nowLine.start
  const alreadyFencedBefore = front === 0 || (doc[front - 1] === '\n' && doc[front - 2] === '\n')
  if (!alreadyFencedBefore) {
    doc = `${doc.slice(0, front)}\n${doc.slice(front)}`
    shift += 1
  }

  // Back fence: same on the other side, located from the (possibly shifted) line
  // start rather than from lengths.
  doc = fenceAfter(doc, front + shift)

  if (doc === after) return null
  return { doc, caret: caret + shift }
}