/**
 * Position mapping, asserted as an interface.
 *
 * These rules are where the hardest bugs have lived (ADR-0001 §2.1, §7): which
 * line owns an offset that sits exactly on a boundary, which direction a caret
 * inside a collapsed marker snaps, and where a caret on an empty line belongs.
 * Before this file they were only reachable through the whole editor kernel, so
 * a rule change had no test of its own — only a smoke test a long way away.
 *
 * Each assertion below is meant to fail on its own if its rule is changed back.
 * The line-ownership case in particular: reverting `anchorForSource` to a
 * `local >= lineEnd` boundary makes "行尾归属本行" red.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Block } from '../core/markdown'
import { buildBlockView, type BlockView } from '../core/view'
import { renderDocument } from './render'
import { anchorForSource, applyCaret, domToLocal, sourceOffsetAtPoint } from './position'

/**
 * One block, rendered into a real editable host.
 *
 * `caret` is the document offset the view treats as "in edit mode" (which
 * reveals block-level markers); `null` means the caret is outside the block.
 */
function mount(raw: string, caret: number | null, lineCount?: number) {
  const view = buildBlockView(raw, 0, caret === null ? [] : [caret], lineCount)
  const host = document.createElement('div')
  host.contentEditable = 'true'
  host.dataset.testHost = ''
  document.body.appendChild(host)
  const block: Block = {
    index: 0,
    startLine: 0,
    endLine: raw === '' ? 1 : raw.split('\n').length,
    raw,
    headingLevel: 0,
    headingText: '',
  }
  renderDocument(host, [block], [view], [], [0])
  return { host, view }
}

/** Where the browser's own selection currently sits, as a block-local offset. */
function caretOffset(view: BlockView): number | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  return domToLocal(view, range.startContainer, range.startOffset)
}

afterEach(() => {
  document.querySelectorAll('[data-test-host]').forEach((el) => el.remove())
})

const LIST = '- 第一项\n- 第二项'
const listView = (caret: number) => buildBlockView(LIST, 0, [caret], 2)

describe('anchorForSource：offset → (line, run, offsetInRun)', () => {
  it('普通行内文本：偏移落在它所属的 run 里', () => {
    const view = buildBlockView('第一段文字', 0, [0], 1)
    expect(anchorForSource(view, 0, 3)).toEqual({ lineIndex: 0, runIndex: 0, offsetInRun: 3 })
  })

  it('行首归属该行：列表第二项的起始偏移属于第二行', () => {
    expect(anchorForSource(listView(8), 0, 6)).toEqual({ lineIndex: 1, runIndex: 0, offsetInRun: 0 })
  })

  it('行尾归属本行：偏移 5 是第一行行尾，不能推到第二行', () => {
    // 第一行 `- 第一项` 占 0..5，第二行起始于 6。偏移 5 处没有任何行起始，
    // 所以它属于第一行的行尾——按 `local >= lineEnd` 推给下一行会让下一次
    // 按键插到 `- ` 前面，写出 `- - 第二项`。
    expect(anchorForSource(listView(8), 0, 5)).toEqual({ lineIndex: 0, runIndex: 1, offsetInRun: 3 })
  })

  it('显现中的块级标记，其末端属于后面的内容', () => {
    // `## ` 占 0..3。光标在 3 必须锚在 `标题` 上；若锚进标记里，下一次按键
    // 会把源码改成 `## X标题`。
    const view = buildBlockView('## 标题', 0, [0], 1)
    expect(anchorForSource(view, 0, 3)).toEqual({ lineIndex: 0, runIndex: 1, offsetInRun: 0 })
  })

  it('折叠标记内的偏移吸附到最近的可见字符', () => {
    const view = buildBlockView('**加粗**', 0, [], 1)
    // 开标记 `**` 占 0..2：里面的 0/1 都吸附到 `加粗` 的开头。
    expect(anchorForSource(view, 0, 0)).toEqual({ lineIndex: 0, runIndex: 1, offsetInRun: 0 })
    expect(anchorForSource(view, 0, 1)).toEqual({ lineIndex: 0, runIndex: 1, offsetInRun: 0 })
    // 闭标记 `**` 占 4..6：里面的 5 吸附到 `加粗` 的末尾。
    expect(anchorForSource(view, 0, 5)).toEqual({ lineIndex: 0, runIndex: 1, offsetInRun: 2 })
  })
})

describe('anchorForSource：空行（没有 run）', () => {
  it('空块的三行各自起始于 0/1/2，偏移归起始不大于它的最后一行', () => {
    const view = buildBlockView('', 0, [], 3)
    expect(view.lines.map((line) => line.sourceStart)).toEqual([0, 1, 2])
    for (const [offset, lineIndex] of [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 2],
    ] as const) {
      expect(anchorForSource(view, 0, offset)?.lineIndex).toBe(lineIndex)
    }
  })
})

describe('applyCaret + domToLocal：offset → anchor → offset 往返', () => {
  it('普通段落逐偏移恒等', () => {
    const { host, view } = mount('第一段文字', 0)
    for (const want of [0, 2, 5]) {
      expect(applyCaret(host, 0, view, 0, want)).toBe(true)
      expect(caretOffset(view)).toBe(want)
    }
  })

  it('空行：落点是行盒本身，读回仍是该行行首', () => {
    const { host, view } = mount('', 0, 3)
    expect(applyCaret(host, 0, view, 0, 1)).toBe(true)
    // 空行的可编辑落点：没有它，浏览器会把光标解析回上一个文本节点末尾。
    expect(host.querySelector('[data-vline="1"] br[data-br]')).not.toBeNull()
    expect(caretOffset(view)).toBe(1)
  })

  it('光标锚在行盒上（行尾之外）时，取该行的源码末尾', () => {
    // 末尾是折叠标记的行：`**加粗**` 占 6 个源码字符、只排 2 个字。
    // 锚在行盒本身＝行尾之外，读回来的必须是 6（行末），不是最后一个标记的起点 4。
    const { host, view } = mount('**加粗**', null)
    const lineEl = host.querySelector<HTMLElement>('[data-vline="0"]')!
    expect(domToLocal(view, lineEl, 0)).toBe(6)
  })

  it('行盒里的直接文本节点按字数计入偏移', () => {
    // 往空行里打字时，浏览器把字符插进行盒（而不是任何 run span）。
    // 不计这些字符，模型光标会停在刚打的字之前，输入逐字逆序（`二行第`）。
    const { host, view } = mount('', 0, 3)
    const lineEl = host.querySelector<HTMLElement>('[data-vline="1"]')!
    const typed = document.createTextNode('二')
    lineEl.appendChild(typed)
    expect(domToLocal(view, typed, 1)).toBe(2)
  })
})

describe('sourceOffsetAtPoint', () => {
  it('空行上没有排布中的 run 时，落点算作该行行首', () => {
    const { host } = mount('第一行\n\n第三行', null, 3)
    const lineEl = host.querySelector<HTMLElement>('[data-vline="1"]')!
    const rect = lineEl.getBoundingClientRect()
    const hit = sourceOffsetAtPoint(rect.left + 1, rect.top + rect.height / 2, lineEl)
    expect(hit).toEqual({ block: 0, local: 4 })
  })
})
