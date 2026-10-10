import { describe, it, expect } from 'vitest'
import {
  assertDomMatchesSource,
  clickInRun,
  flush,
  placeCaretAt,
  renderEditor,
} from '../test/editorTestUtils'

/**
 * typora-parity P2：`<!-- -->` 行内 comment、`> [!TYPE]` alert 引用、嵌套引用
 * 单条左栏。全部是视图层行为——源码逐字节往返（`assertDomMatchesSource`）。
 */

describe('comment（typora-parity P2）', () => {
  it('注释渲染为 rn-comment 整体；内部语法不解析；读写往返无损', async () => {
    const r = renderEditor('前 <!-- 藏 **字** --> 后\n')
    await flush()
    const commentRuns = [...r.container.querySelectorAll('.rn-comment')]
    expect(commentRuns.map((el) => el.textContent).join('')).toBe('<!-- 藏 **字** -->')
    expect(r.container.querySelector('.rn-bold')).toBeNull()
    await assertDomMatchesSource(r)
  })

  it('光标进注释打字：源码逐字进模型，往返仍无损', async () => {
    const r = renderEditor('前 <!-- 藏 **字** --> 后\n')
    await flush()
    const content = r.container.querySelectorAll('.rn-comment')[1] as HTMLElement
    placeCaretAt(content.firstChild as Text, 2)
    // 搭载 placeCaretAt 的光标键盘输入需要宿主已聚焦（测试助手不自动聚焦）。
    r.container.focus({ preventScroll: true })
    await flush()
    await r.user.keyboard('X')
    await flush()
    expect(r.getDoc()).toBe('前 <!-- 藏X **字** --> 后\n')
    await assertDomMatchesSource(r)
  })
})

describe('alert 引用（typora-parity P2）', () => {
  it('未聚焦：画大写字标题、引用栏着色；聚焦：显示 `> [!NOTE]` 源码', async () => {
    const r = renderEditor('> [!NOTE] 保持\n\n> 普通引用\n')
    await flush()
    // 光标先离开第一块（初始在块 0，它是揭示态）。
    await clickInRun(r, 2, 0, 1)
    await flush()

    const line0 = r.container.querySelector('[data-block="0"] [data-vline="0"]') as HTMLElement
    const block0 = r.container.querySelector('[data-block="0"]') as HTMLElement
    expect(line0.classList.contains('vl-alert')).toBe(true)
    expect(line0.getAttribute('data-alert')).toBe('note')
    expect(block0.getAttribute('data-alert')).toBe('note')
    // 标题由 CSS 画：data-alert 大写在行首；栏色是 note 蓝（亮/暗主题两值）。
    const title = getComputedStyle(line0, '::before')
    expect(title.content).toContain('note')
    expect(title.textTransform).toBe('capitalize')
    const bar = getComputedStyle(block0).borderLeftColor
    expect(['rgb(9, 105, 218)', 'rgb(47, 129, 247)']).toContain(bar)
    // 折叠态：`> [!NOTE] ` 不可见，只剩正文。
    const visible = [...line0.querySelectorAll('[data-run]:not(.rn-marker)')]
      .map((el) => el.textContent)
      .join('')
    expect(visible).toBe('保持')

    // 光标进第一块：暗色源码 reveal，伪元素标题让位。
    await clickInRun(r, 0, 0, 1)
    await flush()
    expect(getComputedStyle(line0, '::before').content).toBe('none')
    const marker = line0.querySelector('[data-run="0"]')
    expect(marker?.textContent).toBe('> [!NOTE] ')
    expect(marker?.className).toContain('rn-dim')
    await assertDomMatchesSource(r)
  })

  it('五种类型各设各的栏色（TIP 变体冒烟）', async () => {
    const r = renderEditor('> [!TIP] 贴士\n')
    await flush()
    const line0 = r.container.querySelector('[data-block="0"] [data-vline="0"]') as HTMLElement
    expect(line0.getAttribute('data-alert')).toBe('tip')
    const bar = getComputedStyle(
      r.container.querySelector('[data-block="0"]') as HTMLElement,
    ).borderLeftColor
    expect(['rgb(31, 136, 61)', 'rgb(63, 185, 80)']).toContain(bar)
  })
})

describe('嵌套引用单栏（typora-parity P2）', () => {
  it('`> > 内层` 不缩进、不画自己的竖线；data-nest 契约保留', async () => {
    const r = renderEditor('> 外层\n> > 内层\n')
    await flush()
    const rows = [...r.container.querySelectorAll<HTMLElement>('[data-block="0"] [data-vline]')]
    // 读取端契约（嵌套源）还在……
    expect(rows[1]?.getAttribute('data-nest')).toBe('')
    // ……但视觉上只有引用块的一条左栏：内层行没有自己的边框，也没有缩进。
    const style = getComputedStyle(rows[1] as HTMLElement)
    expect(style.borderLeftWidth).toBe('0px')
    expect(style.marginLeft).toBe('0px')
    const outer = getComputedStyle(
      r.container.querySelector('[data-block="0"]') as HTMLElement,
    ).borderLeftWidth
    expect(outer).toBe('3px')
    await assertDomMatchesSource(r)
  })
})