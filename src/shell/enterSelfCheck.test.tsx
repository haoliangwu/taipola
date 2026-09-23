import { describe, it, expect, beforeEach } from 'vitest'
import {
  renderEditor,
  typeText,
  pressBackspace,
  pressEnter,
  pressShiftEnter,
  clickInRun,
  assertDomMatchesSource,
  flush,
  caretFromDom,
  pressUndo,
  pressRedo,
  placeCaretAt,
  type Rendering,
} from '../test/editorTestUtils'

/**
 * Enter/Shift+Enter/Backspace 的高频操作链自测矩阵。这块的历史 bug 密度高
 * （换行/退格/IME 回归占本迁移弧线问题的大头），每个链路每步都跑
 * `assertDomMatchesSource`（DOM 重建 == model）与光标可见性检查：
 * 占位空白行若被渲染规则藏起来，光标所在行会 display:none，后续编辑肉眼
 * 失灵——正是最近几轮修的方向，这里把它们锁成不变式。
 */

const visibleRows = (r: Rendering): number =>
  [...r.container.querySelectorAll('[data-vline]')].filter(
    (el) => getComputedStyle(el).display !== 'none',
  ).length

/** 返回 caret 所在行的 DOM 行元素是否可见（最后一行 src≤caret 的 vline）。 */
function caretRowVisible(r: Rendering): boolean {
  const caret = caretFromDom()
  if (caret === null) return true // 块外（附加到末尾）不算隐藏
  let target: HTMLElement | null = null
  for (const v of r.container.querySelectorAll<HTMLElement>('[data-vline]')) {
    const block = v.closest<HTMLElement>('[data-block]')
    if (!block) continue
    const srcStart = Number(block.dataset.srcStart)
    if (srcStart + Number(v.dataset.src || 0) <= caret) target = v
  }
  return target ? getComputedStyle(target).display !== 'none' : true
}

/** 操作后统一断言：DOM-model 一致 + 光标所在行可见。 */
async function check(r: Rendering, label: string): Promise<void> {
  await flush()
  await assertDomMatchesSource(r)
  expect(caretRowVisible(r), `${label}: caret 行必须可见`).toBe(true)
}

describe('Enter/Shift+Enter 高频链自测', () => {
  let r: Rendering

  beforeEach(() => {
    r = renderEditor('')
  })

  it('A1 行首 Enter → 打字 X：字进 doc、甲乙不丢', async () => {
    r = renderEditor('甲乙')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await check(r, 'A1 行首 Enter 后')
    expect(r.getDoc()).toBe('\n甲乙')
    await typeText(r, 'X')
    await check(r, 'A1 打字 X 后')
    // GUI 实测：X 落 caret 处（甲前）→ '\nX甲乙'；占位消费后空行回隐藏。
    // userEvent 的登录焦点会让 X 落文档尾——不锁其落点，只锁不丢字且 DOM 一致。
    expect(r.getDoc()).toContain('X')
    expect(r.getDoc()).toContain('甲乙')
  })

  it('A2 行首 Enter ×2 后 Backspace ×2 逐步还原', async () => {
    r = renderEditor('甲乙')
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await check(r, 'A2 Enter1')
    await pressEnter(r)
    await check(r, 'A2 Enter2')
    expect(r.getDoc()).toBe('\n\n甲乙')
    await pressBackspace(r)
    await check(r, 'A2 Backspace1')
    expect(r.getDoc()).toBe('\n甲乙')
    await pressBackspace(r)
    await check(r, 'A2 Backspace2')
    expect(r.getDoc()).toBe('甲乙')
  })

  it('B1 软换行段第二行行首 Shift+Enter → 打字 X → 同段继续', async () => {
    r = renderEditor('第一段文\n字在这')
    await flush()
    await clickInRun(r, 0, 1, 0, 'start')
    await flush()
    await pressShiftEnter(r)
    await check(r, 'B1 Shift 行首后')
    await typeText(r, 'X')
    await check(r, 'B1 打字 X 后')
    // 原文两行都在；X 落新空行并保持段内（软换行）或成独立段——不丢字即可
    expect(r.getDoc().split('X').length >= 2).toBe(true)
    expect(r.getDoc()).toContain('第一段文')
    expect(r.getDoc()).toContain('字在这')
  })

  it('B2 行首 Shift+Enter ×3 后 Backspace ×3 还原', async () => {
    r = renderEditor('第一段文\n字在这')
    await flush()
    await clickInRun(r, 0, 1, 0, 'start')
    await flush()
    const start = r.getDoc()
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await check(r, `B2 Shift${i + 1}`)
      expect(visibleRows(r)).toBeGreaterThan(2)
    }
    for (let i = 0; i < 3; i++) {
      await pressBackspace(r)
      await check(r, `B2 Backspace${i + 1}`)
    }
    expect(r.getDoc()).toBe(start)
  })

  it('C1 Enter 与 Shift+Enter 交替混按：每步可见行递增、字不丢', async () => {
    r = renderEditor('甲\n乙\n丙')
    await flush()
    // caret 在乙行行首（第 1 行）
    await clickInRun(r, 0, 1, 0, 'start')
    await flush()
    const ops = [pressEnter, pressShiftEnter, pressEnter, pressShiftEnter] as const
    let prev = visibleRows(r)
    for (const op of ops) {
      await op(r)
      await check(r, 'C1 op')
      const now = visibleRows(r)
      expect(now).toBeGreaterThanOrEqual(prev)
      prev = now
    }
    expect(r.getDoc()).toContain('甲')
    expect(r.getDoc()).toContain('乙')
    expect(r.getDoc()).toContain('丙')
  })

  it('D1 标题行首 Enter（marker 前）：上方空行可见，标题与 caret 不动', async () => {
    r = renderEditor('# 标题')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await check(r, 'D1 标题行首 Enter')
    expect(r.getDoc()).toBe('\n# 标题')
    expect(visibleRows(r)).toBeGreaterThanOrEqual(2)
  })

  it('D2 标题行中 Enter 拆段，再行首 Enter：可见递增', async () => {
    r = renderEditor('# 标题文字')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 1, 'middle')
    await flush()
    await pressEnter(r)
    await check(r, 'D2 标题拆分')
    const split = r.getDoc()
    expect(split).toContain('\n\n')
    // 拆段后第二段是 text 块（heading 在 0，中间 blank 不渲染——文字块索引 2）
    await clickInRun(r, 2, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await check(r, 'D2 行首 Enter')
    expect(visibleRows(r)).toBeGreaterThanOrEqual(3)
  })

  it('E1 空文档 Enter（块外光标）：附加空行不崩', async () => {
    r = renderEditor('')
    r.container.focus({ preventScroll: true })
    await flush()
    await pressEnter(r)
    await check(r, 'E1 空文档 Enter')
    expect(r.getDoc().length).toBeGreaterThanOrEqual(1)
  })

  it('E2 文档末尾 Enter ×2（trailing）：每步可见递增、后退字', async () => {
    r = renderEditor('甲')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await check(r, 'E2 Enter1')
    const after1 = visibleRows(r)
    await pressEnter(r)
    await check(r, 'E2 Enter2')
    expect(visibleRows(r)).toBeGreaterThan(after1)
    await pressBackspace(r)
    await check(r, 'E2 Backspace1')
    await pressBackspace(r)
    await check(r, 'E2 Backspace2')
    expect(r.getDoc()).toBe('甲')
  })

  it('F1 列表续行：`- 甲` 行尾 Enter 复制前缀，行首 Enter 也可见', async () => {
    r = renderEditor('- 甲')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await check(r, 'F1 列表行尾 Enter')
    expect(r.getDoc()).toContain('- ')
    await pressBackspace(r)
    await check(r, 'F1 Backspace 还原')
    expect(r.getDoc()).toBe('- 甲')
  })

  it('G1 引用行尾 Enter ×2 后 Backspace ×2 还原', async () => {
    r = renderEditor('> 甲')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await check(r, 'G1 Enter1')
    await pressEnter(r)
    await check(r, 'G1 Enter2')
    await pressBackspace(r)
    await check(r, 'G1 Backspace1')
    await pressBackspace(r)
    await check(r, 'G1 Backspace2')
    expect(r.getDoc()).toBe('> 甲')
  })

  it('H1 任务项行尾 Enter 复制 `[ ] `，Backspace 整行还原', async () => {
    r = renderEditor('- [ ] 甲')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await check(r, 'H1 Enter')
    expect(r.getDoc()).toContain('- [ ] ')
    await pressBackspace(r)
    await check(r, 'H1 Backspace')
    expect(r.getDoc()).toBe('- [ ] 甲')
  })
})
describe('Enter 扩展矩阵（undo/点击/IME/结构保护）', () => {
  let r: Rendering

  beforeEach(() => {
    r = renderEditor('')
  })

  it('K1 行首 Enter ×2 → Undo ×2 → Redo ×2：方向状态恢复', async () => {
    r = renderEditor('甲乙')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await check(r, 'K1 Enter1')
    await pressEnter(r)
    await check(r, 'K1 Enter2')
    expect(r.getDoc()).toBe('\n\n甲乙')
    await pressUndo(r)
    await check(r, 'K1 Undo1')
    expect(r.getDoc()).toBe('\n甲乙')
    await pressUndo(r)
    await check(r, 'K1 Undo2')
    expect(r.getDoc()).toBe('甲乙')
    await pressRedo(r)
    await check(r, 'K1 Redo1')
    expect(r.getDoc()).toBe('\n甲乙')
    await pressRedo(r)
    await check(r, 'K1 Redo2')
    expect(r.getDoc()).toBe('\n\n甲乙')
  })

  it('K2 行首 Enter 后点击正文再点回空行：打字仍落空行', async () => {
    r = renderEditor('甲乙丙')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await check(r, 'K2 Enter')
    // 点击正文行尾，再点回空行（placeholder 块——空行无 run，直接锚 vline），打字
    await clickInRun(r, 1, 0, 0, 'middle')
    await flush()
    const blankVline = r.container.querySelector<HTMLElement>('.blk[data-placeholder] [data-vline]')
    if (!blankVline) throw new Error('no placeholder vline')
    placeCaretAt(blankVline, 0)
    await flush()
    await typeText(r, 'X')
    await check(r, 'K2 打字')
    // X 必进 doc；甲乙丙不丢
    expect(r.getDoc()).toContain('X')
    expect(r.getDoc()).toContain('甲乙丙')
  })

  it('L1 IME 组合输入后行首 Enter：段落保留（竞态复用）', async () => {
    r = renderEditor('甲')
    r.container.focus({ preventScroll: true })
    await flush()
    const doc = r.container
    const vline = doc.querySelector('[data-vline]')
    const tn = doc.ownerDocument.createTextNode('乙')
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    doc.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    if (vline) vline.appendChild(tn)
    doc.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: '乙', bubbles: true, cancelable: true }),
    )
    doc.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: '乙', bubbles: true }))
    doc.dispatchEvent(new CompositionEvent('compositionend', { data: '乙' }))
    await pressEnter(r)
    await check(r, 'L1 IME + Enter')
    expect(r.getDoc().includes('乙')).toBe(true)
    expect(r.getDoc().includes('甲')).toBe(true)
  })

  it('M1 多行软段中间行行首 Enter：空行插入且可见', async () => {
    r = renderEditor('甲\n乙\n丙')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 1, 0, 'start') // 乙行行首
    await flush()
    await pressEnter(r)
    await check(r, 'M1 中间行行首 Enter')
    expect(r.getDoc()).toContain('\n\n')
    await pressBackspace(r)
    await check(r, 'M1 Backspace 还原')
    expect(r.getDoc()).toBe('甲\n乙\n丙')
  })

  it('N1 行尾 Enter ×2（trailing 后）再行首 Enter：混合递增', async () => {
    r = renderEditor('甲\n\n乙')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 0, 'end') // 甲行尾
    await flush()
    await pressEnter(r)
    await check(r, 'N1 甲尾 Enter')
    // caret 在空行：行首要再开空行（Enter 在空行上=blank 分支）
    await pressEnter(r)
    await check(r, 'N1 空行 Enter')
    // 点乙行行首，行首 Enter
    await clickInRun(r, 2, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await check(r, 'N1 乙首 Enter')
    const doc = r.getDoc()
    expect(doc).toContain('甲')
    expect(doc).toContain('乙')
  })

  it('O1 表格格内 Enter 不动（结构保护）', async () => {
    r = renderEditor('| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n')
    r.container.focus({ preventScroll: true })
    await flush()
    const run = r.container.querySelector('.blk [data-cell]')?.querySelector('[data-run]')
    if (!run) throw new Error('no table cell run')
    const node = run.firstChild as Text | null
    const range = document.createRange()
    range.setStart(node!, 0)
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    r.container.dispatchEvent(new Event('selectionchange'))
    const before = r.getDoc()
    await pressEnter(r)
    await check(r, 'O1 表格内 Enter')
    expect(r.getDoc()).toBe(before) // 结构不动
  })

  it('O2 代码块内 Enter：加行不破坏围栏', async () => {
    r = renderEditor('```js\nconst a = 1\n```\n')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    await pressEnter(r)
    await check(r, 'O2 代码内 Enter')
    const doc = r.getDoc()
    expect(doc.startsWith('```js\n')).toBe(true)
    expect(doc.endsWith('\n```\n') || doc.includes('\n```\n')).toBe(true)
  })

  it('P1 行首 Enter 后 Backspace 回到按钮，再 Enter：方向重建', async () => {
    r = renderEditor('甲乙')
    r.container.focus({ preventScroll: true })
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await pressBackspace(r)
    await check(r, 'P1 还原')
    expect(r.getDoc()).toBe('甲乙')
    await pressEnter(r)
    await check(r, 'P1 再 Enter')
    expect(r.getDoc()).toBe('\n甲乙')
  })
})
