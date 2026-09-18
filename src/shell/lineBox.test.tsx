/**
 * 一行源码 = 一个行盒（`.scratch/table-ops/issues/02`）。
 *
 * 这条不变量说的是：**每个源码行在屏幕上占且只占一格**，哪怕这一行此刻没有可见
 * 文字（`---`、围栏行、空的列表项）。它保证的是"下面每一行的纵向位置不会在光标进出
 * 块的时候移动"，而 `min-height: var(--doc-line)` 曾经是空操作（无单位数不是长度），
 * 于是：`---` 那行只有 1px、折叠的围栏行 12px、而**光标一进代码块整块就长高 26px**
 * （围栏标记由折叠变成文字，行盒多出一个文字行）。
 *
 * 所以这里逐个行种量高度，并且**在光标进出前后各量一次**——"稳定"才是要保的东西，
 * 单看一个状态看不出问题。
 */
import { describe, expect, it } from 'vitest'
import {
  clickInRun,
  flush,
  placeCaretAt,
  renderEditor,
  type Rendering,
} from '../test/editorTestUtils'

const DOC = [
  '一段正文',
  '',
  '# 标题',
  '',
  '- 列表项',
  '- ',
  '> 引用',
  '- [ ] 任务',
  '',
  '```ts',
  'const a = 1',
  '```',
  '',
  '| a | b |',
  '| --- | --- |',
  '| c | d |',
  '|  |  |',
  '',
  '---',
  '',
  '[^1]: 脚注',
].join('\n')

/** Every line box in the document: its classes and its height. */
function boxHeights(r: Rendering): Array<{ cls: string; height: number }> {
  return [...r.container.querySelectorAll<HTMLElement>('[data-vline]')].map((line) => ({
    cls: line.className,
    height: Math.round(line.getBoundingClientRect().height * 100) / 100,
  }))
}

/** The heights alone, in document order — `revealed` classes are not the subject. */
function heightsOnly(r: Rendering): number[] {
  return boxHeights(r).map((box) => box.height)
}

function heightOf(r: Rendering, cls: string): number[] {
  return boxHeights(r)
    .filter((box) => box.cls.split(' ').includes(cls))
    .map((box) => box.height)
}

/** The document's own line height — one line box, in pixels. */
function docLine(r: Rendering): number {
  return parseFloat(getComputedStyle(r.container).lineHeight)
}

/** Line classes whose box is exactly one line: single-line, at the doc font size. */
const ONE_LINE = [
  'vl-text',
  'vl-blank',
  'vl-list',
  'vl-quote',
  'vl-task',
  'vl-footnote',
  'vl-fence',
  'vl-code',
  'vl-rule',
]

describe('每个行种的行盒高度', () => {
  it('都恰好是一格（标题按自己的字号、表格分隔行按设计为 0）', async () => {
    const r = renderEditor(DOC)
    await flush()
    const line = docLine(r)
    for (const cls of ONE_LINE) {
      const heights = heightOf(r, cls)
      expect(heights.length, `${cls} 应当有行盒`).toBeGreaterThan(0)
      for (const height of heights) {
        expect(height, `${cls} 的行高`).toBeCloseTo(line, 1)
      }
    }
    // 标题的字号是自己的（30px），所以它的行盒是两格高——这是设计，不是漂移。
    expect(heightOf(r, 'vl-heading')).toEqual([line * 2])
    // 空行仍是正好一行（`paragraph-spacing/01` 的机制：段落间距在块底部的
    // margin，不是在空行行盒上——空行是真实光标目标，和正文行一样高）。
    for (const height of heightOf(r, 'vl-blank')) {
      expect(height).toBeCloseTo(line, 1)
    }
    // 段落间距长在**段落块自己**的底部（`paragraph-spacing/01` 十一审）：中间
    // 空行不渲染行盒，段距 = 块 margin（4px，用户在线调定的值）。
    // 空行块本身零 margin；尾空行块（若有）也是零 margin 的一格行盒。
    const textBlock = r.container.querySelector<HTMLElement>('[data-block="0"]')
    expect(parseFloat(getComputedStyle(textBlock!).marginBottom)).toBe(4)
    // 中间空行块不渲染 DOM（十一审）：空行不占行盒，段距全由段块 margin 承担。
    // 尾空行块（渲染为占位行盒的例外）零 margin。
    const blankBlock = r.container.querySelector<HTMLElement>('[data-block="1"]')
    if (blankBlock) expect(parseFloat(getComputedStyle(blankBlock).marginBottom)).toBe(0)

    // 标题折行交给浏览器匀称分配（`text-wrap-balance/01`）；正文各源码行是独立
    // 行盒，balance 对它没有跨盒意义，不启用。
    const heading = r.container.querySelector<HTMLElement>('.vl-heading')
    expect(getComputedStyle(heading!).textWrap).toBe('balance')
    const text = r.container.querySelector<HTMLElement>('.vl-text')
    expect(getComputedStyle(text!).textWrap).not.toBe('balance')
    // 表格行不是"一格"：它是一格文字加上格子的上下内边距与那条 1px 下边框。要求的是
    // **每一行都一样高**（空格子不能比有字的格子矮），而不是等于行高本身。
    const cell = r.container.querySelector<HTMLElement>('[data-block="9"] [data-cell]')!
    const cellStyle = getComputedStyle(cell)
    const rowHeight =
      line +
      parseFloat(cellStyle.paddingTop) +
      parseFloat(cellStyle.paddingBottom) +
      parseFloat(cellStyle.borderBottomWidth)
    const rows = heightOf(r, 'vl-table')
    expect(rows).toHaveLength(3)
    for (const height of rows) expect(height).toBeCloseTo(rowHeight, 1)
    // 表格的 `| --- |` 行 0 高：它代表的分隔线由表头的下边框画（见 styles.css）。
    expect(heightOf(r, 'vl-table-delim')).toEqual([0])
  })

  it('光标进出代码块，行盒高度不变（整块不会跳一下）', async () => {
    const r = renderEditor(DOC)
    await flush()
    const before = heightsOnly(r)
    await clickInRun(r, 7, 1, 0, 'start')
    await flush()
    expect(heightsOnly(r)).toEqual(before)
  })

  it('光标进出分隔线那一块，行盒高度不变', async () => {
    const r = renderEditor(DOC)
    await flush()
    const before = heightsOnly(r)
    const rule = r.container.querySelector<HTMLElement>('[data-block="11"] [data-vline="0"]')!
    placeCaretAt(rule, 0)
    await flush()
    expect(heightsOnly(r)).toEqual(before)
  })

  it('空表格行和有一行文字的表行一样高', async () => {
    const r = renderEditor(DOC)
    await flush()
    const rows = [...r.container.querySelectorAll<HTMLElement>('[data-block="9"] [data-vline]')]
    expect(rows[3].getBoundingClientRect().height).toBeCloseTo(
      rows[0].getBoundingClientRect().height,
      1,
    )
  })
})
