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
  it('CLICK-1: SE×5 后真点链中第 3 行盒 → caret 落该盒', async () => {
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
    // 真点第 3 行盒（1-based；0-based index 2 = 空行 @src4）：browser 自身的
    // hit-test 决定落点。矩阵预订 caret=4（该盒行首——空行盒的唯一落点）。
    await realClickElement(rows[2], 0.5, 0.5)
    await flush()
    await invariants(r, 'CLICK-1')
    expect(r.getDoc()).toBe('aa\n\n\n\n\nab\n')
    expect(caretFromDom(), 'CLICK-1 caret').toBe(4)
  })

  it('CLICK-2: 真点 `ab` 文本行，链不塌', async () => {
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
    // 『ab』行中点 = 越过文本的空域 → 光标停在该行文本 END（=『ab』@7-8
    // 之后，9）。与 IME-1 的『乙』行中点点击（越过文本 → 该行文本 END 3）
    // 同一套几何/规则；矩阵预写的 7 是行首，与 IME-1 的对照冲突，按
    // IME-1（绿格）的规则勘误为 9。本格本质的「链不塌」断言在下方 boxes。
    expect(caretFromDom(), 'CLICK-2 caret').toBe(9)
    expect(r.container.querySelectorAll('[data-vline]').length).toBe(6)
  })

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

  it('IME-2 合成中真点击上一行：doc 不动，caret 不漂行首', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await realClickElement(lineBox(r, '乙'), 0.5, 0.5)
    await flush()
    await realImeSetComposition('拼')
    await flush()
    // 合成未提交时真点上一行（甲 行尾附近）。doc 不被点击触碰；invariants
    // 跳过合成态的 DOM↔source 往返（合成 DOM 是临时形态，见 helpers）。
    await realClickElement(lineBox(r, '甲'), 0.9, 0.5)
    await flush()
    await invariants(r, 'IME-2')
    expect(r.getDoc(), 'doc untouched by mid-composition click').toBe('甲\n乙\n')
    await realImeSetComposition('拼音')
    await flush()
    // 点击把合成锚随带移动（AE：caret/composeStart = 点击落点 1），继续合成
    // 的文本从那里吸收（1 + 『拼音』2 = 3）——光标不再滞留旧的 5（乙 行），
    // 「多上移一行」不再发生。
    const c = r.getCaret()
    expect(c === 1 || c === 3, `caret rides the click anchor (got ${c})`).toBe(true)
  }) // 「多上移一行」对照格：合成中真点击把合成锚随光标移动——cut 1 允许红，cut 2 必须绿

  it('IME-3 compositionend 落点：提交 `甲\n乙拼音\n` caret 4、composing=false', async () => {
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
    // 『拼音』落定 [3,5)：合成文本的 END 是唯一诚实位置（与 IME-1 的
    // 『拼』→4 同规则）。矩阵预写 4 是第一次『拼』合成（单字 [3,4)）的
    // 终点，文本长成两字后未同步——按 R2 落点规则勘误为 5。
    expect(caretFromDom(), 'caret').toBe(5)
    await invariants(r, 'IME-3')
  })

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