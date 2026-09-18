/**
 * 空行被输入占用时的处置（`.scratch/paragraph-spacing/issues/01`）。
 *
 * 用户在 Typora 真机对拍（2026-09，图片为证）：在**两段之间**的既有空行上打字，
 * 字符并进**前一段**（软换行，紧挨着前段渲染），但**后一段的边界与间距保留**——
 * `甲\n\n乙` 打 x → `甲\nx\n\n乙`。段落不会因此合并成一个（间距不会因为空行被
 * 占用而缩小）；x 也只是前段的续行，不是独立段落（A 方案两侧补边界的推断被证伪）。
 *
 * 需要补**前**边界的只有**新段落的占位空行**：段尾 Enter 开出的空行（后一行是
 * 空行或文档末尾）、文档开头的空行。这些是用户**开新段**的动作（`甲\n` Enter
 * 打 x → `甲\n\nx`）。既有空行（前**后**两行都非空）只保留后边界：前侧与段落
 * 软换行延续，后侧补回空行让后一段站住。
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

/** 插入行的前一行是否非空（front 是行首：front-2 是前一行行尾的最后一个字符）。 */
function prevIsText(doc: string, front: number): boolean {
  return front - 2 >= 0 && doc[front - 1] === '\n' && doc[front - 2] !== '\n'
}

/** 插入行的后一行是否非空。文末"虚拟尾空行"（文档以 `\n` 结尾）不算后一行——
 *  那是 Enter 产物的尾巴，不是段落正文。 */
function nextIsText(doc: string, end: number): boolean {
  return end + 1 < doc.length && doc[end + 1] !== '\n'
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
 * line of text, keep that keystroke's intent. A blank that a fresh Enter just
 * opened (`enterPlaceholder`) is the user starting a NEW paragraph — the text
 * gets the missing fences so it stands as its own block. A blank that already
 * sat BETWEEN two paragraphs continues the paragraph ABOVE on its own
 * soft-wrapped line and keeps the paragraph BELOW standing — `甲\n\n乙` +
 * typing `x` yields `甲\nx\n\n乙` (Typora behaviour, verified on real
 * hardware; the gap below survives, the keystroke does not merge everything).
 *
 * Returns null when nothing needs doing (the usual case: every other edit).
 */
export function paragraphizeTypedBlankLine(
  before: string,
  after: string,
  caret: number,
  enterPlaceholder = false,
): { doc: string; caret: number } | null {
  const inserted = after.length - before.length
  if (inserted <= 0) return null
  const insertStart = caret - inserted
  if (insertStart < 0) return null

  const wasBlank = boundsOf(before, insertStart)
  if (!isBlankLine(wasBlank.text)) return null
  const nowLine = boundsOf(after, insertStart)
  if (isBlankLine(nowLine.text)) return null

  // Enter 刚开出的新段占位（kernel 标记）：字符是**新段落的内容**——补上缺失
  // 的边界，让该行成为独立段落（`甲\n` Enter 打 x → `甲\n\nx`）。Typora：
  // 任何位置 Enter 都是硬换行，打字直接落在新段落里。
  if (enterPlaceholder) {
    let doc = after
    let shift = 0
    const front = nowLine.start
    const alreadyFencedBefore = front === 0 || (doc[front - 1] === '\n' && doc[front - 2] === '\n')
    if (!alreadyFencedBefore) {
      doc = `${doc.slice(0, front)}\n${doc.slice(front)}`
      shift += 1
    }
    doc = fenceAfter(doc, front + shift)
    if (doc === after) return null
    return { doc, caret: caret + shift }
  }

  // 两段之间既有空行上打字 = 字符并入前一段（软换行续行），后一段的边界与
  // 间距保留——只补后边界，绝不补前边界（Typora 真机对拍，`paragraph-spacing/01` 八审）。
  if (prevIsText(after, nowLine.start) && nextIsText(after, nowLine.end)) {
    const fenced = fenceAfter(after, nowLine.start)
    if (fenced === after) return null
    return { doc: fenced, caret }
  }

  // 其余形状（无标记时按文本判定：Enter 开出的占位空行、文档开头）：补上
  // 缺失的边界，让该行成为独立段落。
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