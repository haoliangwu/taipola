import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  caretFromDom,
  flush,
  clickInRun,
  pressShiftEnter,
  pressBackspace,
  assertDomMatchesSource,
} from '../test/editorTestUtils'

// 光标落点全链检查（Typora parity）：软链上的 Backspace = 删除光标正前方那个
// `\n`，光标落在被删字符的位置；链从上方塌缩，光标始终留在下方的文本行上。
// 末次弹（链的最后一行）自然落在合并点。
function expectCaret(label: string, actual: number | null, want: number) {
  expect(actual, label).toBe(want)
}

describe('BS 后光标落点（Typora parity）', () => {
  it('行中 aa|ab：SE×5 后逐次 BS 的光标停在下方文本行', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    const run = r.runEl(0, 0, 0)!
    const sel = window.getSelection()
    const range = document.createRange()
    range.setStart(run.firstChild!, 2)
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
    r.container.focus({ preventScroll: true })
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
    // 每次弹：doc 少一个换行，光标停在删除点的偏移（保持在 ab 文本行上）；
    // 行盒逐弹少一行（链仍渲染）。
    for (let i = 1; i <= 4; i++) {
      await pressBackspace(r)
      await flush()
      expect(r.getDoc()).toBe(`aa\n${'\n'.repeat(4 - i)}ab\n`)
      expectCaret(`BS#${i}`, caretFromDom(), 7 - i)
    }
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n')
    expectCaret('BS#5 合并', caretFromDom(), 2)
    await assertDomMatchesSource(r)
  })

  it('行末 aaab|：SE×1 + BS×1 的光标', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n')
    // Typora：删掉光标正前方的 \n，光标在段末 4。
    expectCaret('行末单弹', caretFromDom(), 4)
  })

  it('行中 aa|ab：SE×1 + BS×1 的光标', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    const run = r.runEl(0, 0, 0)!
    const sel = window.getSelection()
    const range = document.createRange()
    range.setStart(run.firstChild!, 2)
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
    r.container.focus({ preventScroll: true })
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('aa\nab\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n')
    // Typora：删掉 \n 后光标在删除点 = 2
    expectCaret('行中单弹合并', caretFromDom(), 2)
  })

  it('行首 |aaab：SE×1 + BS×1 的光标', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    const run = r.runEl(0, 0, 0)!
    const sel = window.getSelection()
    const range = document.createRange()
    range.setStart(run.firstChild!, 0)
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
    r.container.focus({ preventScroll: true })
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('\naaab\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('aaab\n')
    expectCaret('行首单弹', caretFromDom(), 0)
  })
})