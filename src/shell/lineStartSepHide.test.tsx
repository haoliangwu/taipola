import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  pressEnter,
  pressShiftEnter,
  clickInRun,
  flush,
  caretFromDom,
} from '../test/editorTestUtils'

/**
 * SPEC 轴验证：code-review 报的两个候选 bug。
 * c1: phDirection 跨键泄漏 —— 行首 Enter（'none' 残留）后移动到别处
 *     in-between blank 上 Enter，多显示一行预存分隔。
 * c2: 引用行首 Shift+Enter caret 位移（fresh vs at+1）。
 */

describe('lineStartSepHide', () => {
  it('c1 行首 Enter 后跨块移动，再在中间空行 Enter：不多显示分隔行', async () => {
    const r = renderEditor('甲\n\n乙')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    expect(r.getDoc()).toBe('\n甲\n\n乙')
    await clickInRun(r, 3, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    const rows = [...r.container.querySelectorAll<HTMLElement>('.blk[data-placeholder] [data-vline]')].map(
      (v) => `${v.dataset.src}:${getComputedStyle(v).display}`,
    )
    console.log('c1 doc:', JSON.stringify(doc), 'phRows:', rows.join('|'))
    expect(doc).toBe('\n甲\n\n\n乙')
    // R1：前导空行（行首 Enter 开出的 s 行）与乙上的新 s 行是两个不同
    // placeholder 块，各渲染 1 行盒；预存分隔行（S）不产生节点——不再有
    // 「靠 display:none 藏起的分隔行」。故可见行盒 = 2（各自的会话行盒），
    // 没有多余的隐藏行。（旧断言 <=1 基于旧的「分隔行渲染后再隐藏」模型。）
    expect(rows.length).toBeLessThanOrEqual(2)
    expect(rows.filter((s) => !s.includes('none')).length).toBeLessThanOrEqual(2)
  })

  it('c2 引用行首 Shift+Enter（marker 前 caret=0）：不进标记分支、无 caret 位移', async () => {
    const r = renderEditor('> 甲')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressShiftEnter(r)
    await flush()
    const doc = r.getDoc()
    console.log('c2 doc:', JSON.stringify(doc), 'caret:', caretFromDom())
    // 前缀行行首 soft 走旧逻辑（引用延续），标记分支不适用
    expect(r.container.querySelector('.blk[data-placeholder]')).toBeNull()
    expect(doc).toContain('> ')
  })
})
