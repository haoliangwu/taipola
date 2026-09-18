/**
 * 空行被输入占用时，让它成为**独立段落**（`.scratch/paragraph-spacing/issues/01`）。
 *
 * 源里 `段A\n\n段B` 的空行被文字占用后是 `段A\nX\n段B` —— 单换行在 Markdown 里
 * 是**同一段**，于是三个块合并成一个软换行段：段落边界消失，段落间距（挂在段落
 * 块上的 margin）也就无处可挂，屏幕内容随之上移。修正：在该行两侧补齐段落边界，
 * 得 `段A\n\nX\n\n段B` —— 与 Typora 的块语义一致（空白处打字 = 新起一段，而不是
 * 退化成软换行）。
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

/**
 * The inserted-text correction: when a keystroke turns a whole blank line into a
 * line of text, make sure that line is fenced by blank lines on both sides —
 * it becomes a paragraph of its own, and the inter-paragraph spacing survives
 * the edit instead of being eaten by the merge.
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
