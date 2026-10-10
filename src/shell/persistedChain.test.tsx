import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  flush,
  clickInRun,
  clickAtLine,
  pressShiftEnter,
  pressBackspace,
  typeText,
  assertDomMatchesSource,
} from '../test/editorTestUtils'

/**
 * 会话记忆的软链（typora-parity）：Shift+Enter 创建的空白区，在光标离开后
 * 仍渲染行盒——软断在 Typora 里是段内 br 节点、恒可见；taipola 源真值无法
 * 从字节区分「Shift+Enter 打的空行」与「文件原有的空行」，所以用会话记忆
 * 记住哪些空白区是 Shift+Enter 建的，光标离场不塌缩成段落间隙。
 *
 * 本套件钉住（验收）：
 *   1. SE×5 → 4 行；点到远处段落 → 4 行仍在；
 *   2. 点回链内 BS×2 → 2 行；再离开 → 仍渲染；
 *   3. 链全部弹完 → 恢复普通渲染（无可记忆）；
 *   4. 同 doc 重新加载（新 renderEditor）→ 不渲染（文件里的空行 = 普通分隔）；
 *   5. 链内打字仍 re-home 进该行；
 *   6. 每步 DOM↔source 一致。
 */

function blankRows(r: ReturnType<typeof renderEditor>): HTMLElement[] {
  return [
    ...r.container.querySelectorAll<HTMLElement>('.blk[data-placeholder] [data-vline]'),
  ]
}

describe('软链会话记忆（typora-parity）', () => {
  it('acceptance 1: SE×5 → 4 行；光标离开 → 仍渲染', async () => {
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
    expect(blankRows(r)).toHaveLength(4)
    // 点去远处（block 2 = ab 之后…这里 ab 是同段；点到最后一行 ab 内容）。
    await clickInRun(r, 2, 0, 0, 'start')
    await flush()
    // 行盒不塌缩：4 行仍在。
    expect(blankRows(r)).toHaveLength(4)
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
    await assertDomMatchesSource(r)
  })

  it('acceptance 2: 点回链内 BS×2 → 2 行；离开仍渲染', async () => {
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
    await clickInRun(r, 2, 0, 0, 'start') // 离开
    await flush()
    // 点回链内第 3 行（block 1 的 vline 2）。
    await clickAtLine(r, 1, 2)
    await flush()
    await pressBackspace(r)
    await flush()
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('aa\n\n\nab\n')
    expect(blankRows(r)).toHaveLength(2)
    // 再离开：仍渲染。
    await clickInRun(r, 2, 0, 0, 'start')
    await flush()
    expect(blankRows(r)).toHaveLength(2)
    await assertDomMatchesSource(r)
  })

  it('acceptance 3: 链全部弹完 → 普通渲染返回', async () => {
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
    await clickInRun(r, 2, 0, 0, 'start')
    await flush()
    // 反复回到链底、弹出，直至链空。
    for (let i = 0; i < 4; i++) {
      await clickAtLine(r, 1, 0)
      await flush()
      await pressBackspace(r)
      await flush()
    }
    expect(r.getDoc()).toBe('aa\nab\n')
    // 无可记忆：普通软接续（无空白块）。
    expect(blankRows(r)).toHaveLength(0)
    await clickInRun(r, 0, 1, 0, 'start') // ab 已并入同一段（续行）
    await flush()
    expect(blankRows(r)).toHaveLength(0)
    await assertDomMatchesSource(r)
  })

  it('acceptance 4: 同一 doc 重新加载 → 普通分隔，不渲染', async () => {
    const r = renderEditor('aa\n\n\n\n\nab\n')
    await flush()
    // 文件自带的空行：无会话记忆 → 不渲染行盒。
    expect(blankRows(r)).toHaveLength(0)
    await assertDomMatchesSource(r)
  })

  it('acceptance 5: 链内打字 re-home 进该行', async () => {
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
    await clickInRun(r, 2, 0, 0, 'start') // 离开
    await flush()
    await clickAtLine(r, 1, 1) // 点回链内第二行
    await flush()
    await typeText(r, 'X')
    await flush()
    // X 落在该行：doc 里出现在第二空行的位置。
    expect(r.getDoc()).toBe('aa\n\nX\n\n\nab\n')
    await assertDomMatchesSource(r)
  })
})