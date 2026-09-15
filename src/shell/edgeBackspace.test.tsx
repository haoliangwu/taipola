import { describe, it, expect, beforeEach } from 'vitest'
import { renderWithDoc } from '../test/appTestUtils'
import { readDocumentSource } from '../editor/render'
import { placeCaretAt } from '../test/editorTestUtils'
import { stubSavedFolder } from '../test/platformStubs'

/**
 * caret-assertions 票据 03：闭合标记边界上一次 Backspace 只能删一个字符。
 *
 * 为什么不用 `userEvent.keyboard('{Backspace}')`：userEvent 的事件是合成的，
 * 浏览器不会执行原生 deleteContentBackward，于是测不到本缺陷。`execCommand('delete')`
 * 触发的是 Chromium 自己的编辑命令（与真实按键同一条删除路径），能把缺陷钉住。
 */

/** 把光标放到某块最后一行的行尾（= 尾随字符之后）。 */
function caretToLineEnd(doc: HTMLElement, block = 0): void {
  const runs = [...doc.querySelectorAll(`[data-block="${block}"] [data-run]`)]
  const node = runs[runs.length - 1]?.lastChild as Text | null
  if (!node) throw new Error('no run text')
  placeCaretAt(node, node.textContent?.length ?? 0)
}

/**
 * 一次 Backspace 的忠实模拟：先派发可取消的 keydown（内核与外壳都能看到，
 * 有机会 preventDefault 接管），**未被接管时**才执行 Chromium 的原生删除。
 *
 * 为什么不用 `userEvent.keyboard('{Backspace}')`：userEvent 自己模拟删除，
 * 从不走浏览器原生 deleteContentBackward —— 而本缺陷恰恰是原生删除在
 * `display:none` 源码 run 边界上多删一个 run，用 userEvent 测不到（修复前也绿）。
 * `execCommand('delete')` 走的正是原生那条编辑命令。
 */
function pressBackspaceLikeTheBrowser(): void {
  const host = document.querySelector('.doc') as HTMLElement | null
  const target = (document.activeElement as HTMLElement | null) ?? host
  if (!target) throw new Error('no editor host')
  const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  if (!event.defaultPrevented) document.execCommand('delete')
}

const MATRIX: Array<[string, string]> = [
  ['~~a~~z', '~~a~~'],
  ['**b**z', '**b**'],
  ['*a*z', '*a*'],
  ['`c`z', '`c`'],
  ['$a$z', '$a$'],
  ['[a](u)z', '[a](u)'],
  ['plainz', 'plain'],
]

describe('闭合标记边界退格（caret-assertions/03）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  for (const [input, expected] of MATRIX) {
    it(`${input} 行尾一次 Backspace → ${expected}（只删一个字符）`, async () => {
      const { view, doc } = await renderWithDoc(input + '\n')
      caretToLineEnd(doc)
      pressBackspaceLikeTheBrowser()
      expect(readDocumentSource(doc)).toBe(expected + '\n')
      view.unmount()
    })
  }

  it('~~a~~（无尾随字符）光标在闭合标记后：一次 Backspace 只删一个 ~', async () => {
    const { view, doc } = await renderWithDoc('~~a~~\n')
    caretToLineEnd(doc)
    pressBackspaceLikeTheBrowser()
    expect(readDocumentSource(doc)).toBe('~~a~\n')
    view.unmount()
  })

  it('连续退格逐字符回收：~~a~~z → ~~a~~ → ~~a~ → ~~a', async () => {
    const { view, doc } = await renderWithDoc('~~a~~z\n')
    caretToLineEnd(doc)
    pressBackspaceLikeTheBrowser()
    expect(readDocumentSource(doc)).toBe('~~a~~\n')
    caretToLineEnd(doc)
    pressBackspaceLikeTheBrowser()
    expect(readDocumentSource(doc)).toBe('~~a~\n')
    caretToLineEnd(doc)
    pressBackspaceLikeTheBrowser()
    expect(readDocumentSource(doc)).toBe('~~a\n')
    view.unmount()
  })
})