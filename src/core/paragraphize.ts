/**
 * 空行被输入占用时的处置（`.scratch/paragraph-spacing/issues/01`）。
 *
 * 用户真机对拍 Typora（2026-09）：在**两段之间**的既有空行上打字，字符就落在
 * 那一行——`甲\n\n乙` 打 x → `甲\nx\n乙`：两侧空行不补、按 Markdown 语义合并成
 * 软换行段（相邻段落并成一段，段落间距随之消失——这是 Typora 语义本身，不是
 * 缺陷，`paragraph-spacing/01` 七审）。
 *
 * 需要补边界的只有**新段落的占位空行**：段尾 Enter 开出的空行（后一行是空行或
 * 文档末尾）、文档开头的空行（无前行）。这些是用户**开新段**的动作，补上缺少的
 * 边界让该行成为独立段落（`甲\n` Enter 打 x → `甲\n\nx`），段落边界与间距保留。
 *
 * 判定"独立空行"：插入行**前后两行都非空**（夹在两段之间），此时不补边界。
 * 其他形状走原有补边界逻辑。
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

/** 插入行是否夹在两段之间（前后两行都非空）——Typora 里这是"独立空行"，
 *  打字只占据该行、不补边界（`甲\n\n乙` 打 x → `甲\nx\n乙`）。 */
function betweenParagraphs(doc: string, line: { start: number; end: number }): boolean {
  const front = line.start
  const prevIsText = front - 2 >= 0 && doc[front - 1] === '\n' && doc[front - 2] !== '\n'
  // 后一行存在（end+1 不越界）且首字符非换行符。文末"虚拟尾空行"（文档以
  // `\n` 结尾）不算后一行——它是 Enter 产物，不是两段之间的独立空行。
  const nextIsText = line.end + 1 < doc.length && doc[line.end + 1] !== '\n'
  return prevIsText && nextIsText
}

/**
 * The inserted-text correction: when a keystroke turns a whole blank line into a
 * line of text, keep that keystroke's intent. Typing on the blank BETWEEN two
 * paragraphs keeps the character there (`甲\n\n乙` → `甲\nx\n乙`, Typora
 * behaviour, neighbours merge into one soft-wrapped paragraph). Only a blank
 * line that a fresh Enter opened (next line blank / end of document / document
 * head) gets fenced into a paragraph of its own, so the new paragraph survives.
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

  // Typora（真机对拍）：两段之间既有空行上打字 = 字符落回那一行，什么都不补
  // （`甲\n\n乙` → `甲\nx\n乙`，邻段按 Markdown 语义合并成软换行段）。只有
  // Enter 开出的占位空行（后行是空/文末、文档开头无前行）才需要补边界。
  if (betweenParagraphs(after, nowLine)) return null

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
  const lineStart = front + shift
  const newline = doc.indexOf('\n', lineStart)
  const end = newline < 0 ? doc.length : newline
  const alreadyFencedAfter = end === doc.length || doc[end + 1] === '\n'
  if (!alreadyFencedAfter) doc = `${doc.slice(0, end)}\n${doc.slice(end)}`

  // Both fences already stood (the blank line carried its own surroundings):
  // nothing to correct, so the caller keeps its own result untouched.
  if (doc === after) return null
  return { doc, caret: caret + shift }
}
