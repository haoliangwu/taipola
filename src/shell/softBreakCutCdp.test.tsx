import { describe, it, expect, beforeAll } from 'vitest'
import {
  renderEditor,
  flush,
  caretFromDom,
  pressShiftEnter,
  pressBackspace,
  pressUndo,
  pressRedo,
  type Rendering,
} from '../test/editorTestUtils'
import {
  realClickElement,
  realImeSetComposition,
  realInsertText,
  realKey,
  cdpAvailable,
} from '../test/realInput'
import { invariants } from '../test/softBreakCutHelpers'

/**
 * Matrix §7: REAL Chromium cells. Every gesture rides the trusted CDP channel
 * (`Input.dispatchMouseEvent` / `Input.imeSetComposition` / `Input.insertText`),
 * so the browser's own hit-test and composition machinery is what the assertions
 * measure. `userEvent.keyboard` is also real (Playwright's trusted keyboard).
 *
 * Green in cut 1: CLICK-3/4/5 (walk-back + drag-select + chain pop through real
 * clicks), IME-4 (composing+⌘Z is a CUT-1 FIX), ARROW-1/2/3 (real keys; the
 * 「多上移一行」 canary does not fire), and IME-1 minus the roundtrip (a
 * composing DOM is provisional BY DEFINITION; the matrix's §6 roundtrip would
 * be nonsense mid-composition — asserted after the commit instead).
 *
 * Pending (cut 2): CLICK-1/CLICK-2 (real hit-test resolution vs the pinned
 * 4/7), IME-2 (matrix: 此格先红后绿), IME-3 (committed caret parked one past
 * the composed text by the browser — the pure-function landing seam).
 */

beforeAll(() => {
  if (!cdpAvailable()) {
    throw new Error(
      'CDP unreachable from the vitest browser runner — §7 real-click/IME cells ' +
        'cannot run with trustworthy input. Probed status: unavailable.',
    )
  }
})

function midCaret(r: Rendering): void {
  const run = r.runEl(0, 0, 0)!
  const sel = window.getSelection()
  const range = document.createRange()
  range.setStart(run.firstChild!, 2)
  range.collapse(true)
  sel?.removeAllRanges()
  sel?.addRange(range)
  r.container.focus({ preventScroll: true })
}

function lineBox(r: Rendering, text: string): HTMLElement {
  const el = [...r.container.querySelectorAll<HTMLElement>('[data-vline]')].find(
    (l) => (l.textContent ?? '').trim() === text,
  )
  if (!el) throw new Error(`no line box with text ${JSON.stringify(text)}`)
  return el
}

describe('matrix §7.1 真点击穿链（CDP）', () => {
  it.fails('CLICK-1: SE×5 后真点链中第 3 行盒 → caret 落该盒', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    midCaret(r)
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
    const rows = r.container.querySelectorAll<HTMLElement>('[data-vline]')
    expect(rows.length).toBeGreaterThanOrEqual(6)
    // 真点链中第 3 行盒（第 3 个空白行盒）：browser 自身的 hit-test 决定落点。
    await realClickElement(rows[3], 0.5, 0.5)
    await flush()
    await invariants(r, 'CLICK-1')
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
    expect(caretFromDom(), 'CLICK-1 caret').toBe(4)
  }) // 现状 hit-test 落在 5（第 3 空白行行首 = 源码偏移 5）；矩阵按另一行序预写 4——cut-2 落点统一时对表

  it.fails('CLICK-2: 真点 `ab` 文本行，链不塌', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    midCaret(r)
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    await realClickElement(lineBox(r, 'ab'), 0.5, 0.5)
    await flush()
    await invariants(r, 'CLICK-2')
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
    expect(caretFromDom(), 'CLICK-2 caret').toBe(7)
    expect(r.container.querySelectorAll('[data-vline]').length).toBe(6)
  }) // 现状 hit-test 把 `ab` 行中点解析到 9（行尾后 1）；cut-2 落点接缝

  it('CLICK-3: 点回链中行后 BS×2 弹链（persistedChain acceptance 2 同款）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    midCaret(r)
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    await realClickElement(r.container.querySelectorAll<HTMLElement>('[data-vline]')[3], 0.5, 0.5)
    await flush()
    await pressBackspace(r)
    await flush()
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('aa\n\n\nab\n')
    await invariants(r, 'CLICK-3')
  })

  it('CLICK-4: 点 S 分隔行的视觉 gap → 回走规则，caret 落最近渲染块末尾', async () => {
    const r = renderEditor('甲乙\n\n丙\n')
    await flush()
    const bing = lineBox(r, '丙')
    // 点丙 行正上方（gap 区域）。
    await realClickElement(bing, 0.5, -1)
    await flush()
    await invariants(r, 'CLICK-4')
    const c = caretFromDom()
    expect(c === 2 || c === 4, `walk-back deterministic landing (got ${c})`).toBe(true)
    expect(r.getDoc()).toBe('甲乙\n\n丙\n')
  })

  it('CLICK-5: s 空行盒真拖选 → BS 消选并弹链', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    midCaret(r)
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    const row = r.container.querySelectorAll<HTMLElement>('[data-vline]')[2]
    if (!row) throw new Error('no chain row 2')
    await realClickElement(row, 0.2, 0.5)
    await flush()
    // 同盒内再点（拖选起点/终点同在盒里，构成选区）。
    await realClickElement(row, 0.8, 0.5)
    await flush()
    await pressBackspace(r)
    await flush()
    await invariants(r, 'CLICK-5')
    expect(r.getDoc(), 'one chain row popped').toBe('aa\n\n\n\nab\n')
  })
})

describe('matrix §7.2 CDP 真 IME 三态', () => {
  it('IME-1 进入合成：doc 不变、composing、undo 栈不变', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await realClickElement(lineBox(r, '乙'), 0.5, 0.5)
    await flush()
    expect(caretFromDom(), 'caret into 乙').toBe(3)
    await realImeSetComposition('拼')
    await flush()
    expect(r.isComposing(), 'composing').toBe(true)
    // composing 的 DOM 是临时形态（含拼音），roundtrip 此刻无意义——
    // 矩阵 §7.2 的验收是模型不动 + composing 标志 + undo 栈不动。
    expect(r.getDoc(), 'doc unchanged').toBe('甲\n乙\n')
    await pressUndo(r)
    await flush()
    expect(r.getDoc(), 'undo during composition is inert on the stack').toBe('甲\n乙\n')
    // 收尾：提交并验证模型与 DOM 归位。
    await realImeSetComposition('')
    await flush()
    await realInsertText('拼')
    await flush()
    expect(r.getDoc()).toBe('甲\n乙拼\n')
    expect(r.isComposing()).toBe(false)
    await invariants(r, 'IME-1')
  })

  it.fails('IME-2 合成中真点击上一行：doc 不动，caret 不漂行首', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await realClickElement(lineBox(r, '乙'), 0.5, 0.5)
    await flush()
    await realImeSetComposition('拼')
    await flush()
    // 合成未提交时真点上一行（甲 行尾附近）。
    await realClickElement(lineBox(r, '甲'), 0.9, 0.5)
    await flush()
    await invariants(r, 'IME-2')
    await realImeSetComposition('拼音')
    await flush()
    const c = caretFromDom()
    expect(c === null || c <= 2, `caret not stranded at line start (got ${c})`).toBe(true)
    expect(r.getDoc(), 'doc untouched by mid-composition click').toBe('甲\n乙\n')
  }) // 「多上移一行」对照格：合成中真点击把合成锚随光标移动——cut 1 允许红，cut 2 必须绿

  it.fails('IME-3 compositionend 落点：提交 `甲\n乙拼音\n` caret 4、composing=false', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await realClickElement(lineBox(r, '乙'), 0.5, 0.5)
    await flush()
    await realImeSetComposition('拼')
    await flush()
    await realImeSetComposition('拼音')
    await flush()
    // CDP 提交：空 composition = commit（随后 insertText 送达同一文本）。
    await realImeSetComposition('')
    await flush()
    await realInsertText('拼音')
    await flush()
    expect(r.isComposing()).toBe(false)
    expect(r.getDoc(), 'doc').toBe('甲\n乙拼音\n')
    expect(caretFromDom(), 'caret').toBe(4)
    await invariants(r, 'IME-3')
  }) // 提交后浏览器把光标停在 `乙拼音` 之后的 `\n` 上（5 vs 4）；cut-2 落点接缝

  it('IME-4 composing+⌘Z：合成期间禁 undo（第一刀修好的格，绿色）', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await realClickElement(lineBox(r, '乙'), 0.5, 0.5)
    await flush()
    await realImeSetComposition('拼')
    await flush()
    expect(r.isComposing()).toBe(true)
    await pressUndo(r)
    await flush()
    expect(r.getDoc(), '⌘Z during composition must not touch the model').toBe('甲\n乙\n')
    await pressRedo(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n乙\n')
    await realImeSetComposition('')
    await flush()
    await realInsertText('拼')
    await flush()
    expect(r.getDoc()).toBe('甲\n乙拼\n')
    await invariants(r, 'IME-4')
  })
})

describe('matrix §7.3 方向键穿链（真键盘）', () => {
  it('ARROW-1: ArrowDown 穿链逐行下落', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    midCaret(r)
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    for (let i = 1; i <= 3; i++) {
      await realKey('ArrowDown')
      await flush()
      await invariants(r, `ARROW-1 down${i}`)
    }
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
  })

  it('ARROW-2: 链内 ArrowUp 回走，不多上移（回归 3 对照）', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    midCaret(r)
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    await realKey('ArrowUp')
    await flush()
    const c1 = caretFromDom()
    await realKey('ArrowUp')
    await flush()
    const c2 = caretFromDom()
    await invariants(r, 'ARROW-2')
    expect(c2 !== null && c1 !== null && c2 < c1, `monotone up (${c1} → ${c2})`).toBe(true)
    expect(c2!, 'not drifted past paragraph end').toBeGreaterThanOrEqual(2)
  })

  it('ARROW-3: 链顶 ArrowUp 穿回 doc 顶内容行', async () => {
    const r = renderEditor('aaab\n')
    await flush()
    midCaret(r)
    await flush()
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flush()
    }
    for (let i = 0; i < 8; i++) {
      await realKey('ArrowUp')
      await flush()
    }
    await invariants(r, 'ARROW-3')
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
  })
})