import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  renderEditor,
  typeText,
  pressBackspace,
  pressEnter,
  pressShiftEnter,
  pressUndo,
  pressRedo,
  clickInRun,
  clickAtLine,
  assertDomMatchesSource,
  flush,
  caretFromDom,
  placeCaretAt,
  type Rendering,
} from '../../test/editorTestUtils'

import { WELCOME_DOC } from '../../core/welcome'

const WELCOME = `# 欢迎使用 taipola

一个极简但强大的 Markdown 编辑器。**光标所在的那一行显示 Markdown 源码，光标一离开就渲染成最终的样子** —— 没有左右分栏，也不需要预览按钮。

## 它现在能做什么

- **即时渲染**：段落、标题、列表、引用、代码块、表格全部就地渲染
- **中文输入法友好**：沿用原生输入框，拼音候选、联想词都正常
- **自动保存草稿**：关掉页面也不丢内容
`

describe('标题（block 级标记）', () => {
  let r: Rendering

  beforeEach(() => {
    r = renderEditor(WELCOME)
  })

  it('点击标题文本中间后按 Enter，标题从光标处拆成两段', async () => {
    await clickInRun(r, 0, 0, 1, 'middle')
    const heading = WELCOME.split('\n')[0]
    // 这次点击真的落在文字中间（修复前助手一律落行尾，用例名不副实）：
    // 光标既不在 `# ` 之后的行首，也不在行尾。
    const caret = caretFromDom() ?? -1
    expect(caret).toBeGreaterThan(2)
    expect(caret).toBeLessThan(heading.length)
    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    const lines = doc.split('\n')
    expect(lines.length).toBeGreaterThan(3)
    // 硬换行（Enter）在光标处拆段：两半之间隔一个空行，拼回去正好还是那行标题
    // （`enter-backspace-smoke/01`）。
    expect(lines[1]).toBe('')
    expect(lines[0] + lines[2]).toBe(heading)
    await assertDomMatchesSource(r)
  })

  it('点击标题行末按 Enter：标题下只开一个空行（普通断行）', async () => {
    await clickInRun(r, 0, 0, 1, 'end')
    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    // 行尾 Enter = 硬换行（块级）：标题下开新空块。标题 14 字，回车后光标
    // 吸附在标题行尾（新空行是中间空白，不渲染行盒，十一审）。
    expect(doc).toMatch(/^# 欢迎使用 taipola\n\n\n/)
    expect(caretFromDom()).toBe(14)
    await assertDomMatchesSource(r)
  })

  it('段落行末按 Enter 也能换行（行末不再是 no-op）', async () => {
    const p = renderEditor('一段文字\n\n第二段\n')
    await clickInRun(p, 0, 0, 0, 'end')
    await pressEnter(p)
    await flush()
    expect(p.getDoc()).toBe('一段文字\n\n\n第二段\n')
    // 段落 4 字：Enter 开的新空行是中间空白（不渲染），光标吸附在段尾（偏移 4）。
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(p)
  })

  it('列表退出空 bullet 后光标停在空行上（不往回跳）', async () => {
    await clickInRun(r, 6, 2, 4, 'end')
    await pressEnter(r)
    await flush()
    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    expect(doc).toContain('内容\n\n')
    // 光标应当落在退出后留下的空行上（文档末尾），而不是被钳回内容行。
    expect(caretFromDom()).toBe(doc.length - 1)
    await assertDomMatchesSource(r)
  })

  it('空行上打字不丢字', async () => {
    const p = renderEditor('- 一项\n\n')
    await clickAtLine(p, 1, 0)
    await typeText(p, '补')
    await flush()
    // 落在文档末尾的空行/幽灵行：字符进入模型，DOM 与模型一致。
    expect(p.getDoc()).toBe('- 一项\n\n补')
    await assertDomMatchesSource(p)
  })

  it('Shift+Enter 在标题产生软换行且不触发 React 异常', async () => {
    // 中线落点：run 1 起始于 2、长 12，middle 取 6，所以光标在 8。
    await clickInRun(r, 0, 0, 1, 'middle')
    expect(caretFromDom()).toBe(8)
    const linesBefore = r.getDoc().split('\n').length
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc().split('\n').length).toBeGreaterThan(linesBefore)
    // 软换行只在光标处插一个换行，光标跟着走一格（8 → 9）。
    expect(caretFromDom()).toBe(9)
    await assertDomMatchesSource(r)
  })

  it('标题文本被选中时视图重渲染不摧毁选区（拖选不变式）', async () => {
    // userEvent 的合成指针事件无法驱动 Chromium 的原生拖选（untrusted
    // 事件不进入鼠标拖选管线），所以直接构造真实选区，再沿"拖选路径"
    // 走：每次移动选区 → selectionchange → setCaret → 视图重渲染。重渲染
    // 必须保留选区（节点只换 class、不换节点），否则真实拖选会在 reveal
    // 翻转的瞬间断裂。
    const el = r.runEl(0, 0, 1)!
    const text = el.firstChild!
    const range = document.createRange()
    range.setStart(text, 1)
    range.setEnd(text, 3)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // 模拟拖到行尾：selectionchange 由浏览器在真实拖选中触发，这里手动
    // 派发，让 caret 状态更新走同一条路径。
    range.setEnd(text, text.textContent?.length ?? 0)
    document.dispatchEvent(new Event('selectionchange'))
    await flush()
    expect(sel?.isCollapsed).toBe(false)
    expect((sel?.toString() ?? '').length).toBeGreaterThan(0)
    await assertDomMatchesSource(r)
  })
})

describe('列表', () => {
  let r: Rendering

  beforeEach(() => {
    r = renderEditor(WELCOME)
  })

  it('列表末项按 Enter 新增一个空 bullet 行', async () => {
    await clickInRun(r, 6, 2, 4, 'end')
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toContain('内容\n- ')
    await assertDomMatchesSource(r)
  })

  it('空 bullet 行再次 Enter：bullet 消失但保留一个空行（不吞换行）', async () => {
    await clickInRun(r, 6, 2, 4, 'end')
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toContain('内容\n- ')

    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    expect(doc).not.toContain('内容\n- \n')
    expect(doc).toContain('内容\n\n')
    await assertDomMatchesSource(r)
  })
})

/**
 * 行首前缀只有一个主人（`parseLine`）：Enter 抄它来续下一行，Backspace 拿它算"正文从哪开始"。
 *
 * 这两条钉住 Enter 那一侧。围栏那条尤其重要：围栏行自己的"前缀"就是围栏标记，
 * 照抄一遍等于在代码块里又开一个围栏——所以 Enter 在围栏行上只当普通换行。
 */
describe('Enter 续写的前缀和 Backspace 认的是同一套', () => {
  it('引用里的列表项：续上的是 `> - `，不是空的 `> `', async () => {
    const r = renderEditor('> - aaa\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('> - aaa\n> - \n')
    await assertDomMatchesSource(r)
  })

  it('围栏那一行回车：只在围栏里开一个新行，不会把围栏标记抄一遍', async () => {
    const r = renderEditor('```ts\ncode\n```\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('```ts\n\ncode\n```\n')
    await assertDomMatchesSource(r)
  })
})

describe('撤销 / 数据完整性（回归）', () => {
  it('backspace 删除标题中的一段文本后源码持久化', async () => {
    const r = renderEditor('# 它FINA==现在能做什么\n\n正文\n')
    await clickInRun(r, 0, 0, 1, 'end')
    for (let i = 0; i < 4; i++) await pressBackspace(r)
    await flush()
    // 光标在行末，4 次 Backspace 删掉结尾 4 个字符。
    expect(r.getDoc()).toBe('# 它FINA==现在\n\n正文\n')
    // 每退一格光标跟着退一格：`# ` 之后 13 字，4 次退格后落在 11。
    expect(caretFromDom()).toBe(11)
    await assertDomMatchesSource(r)
  })

  it('backspace 后继续 typing，不产生异常且源码一致', async () => {
    const r = renderEditor('# 标题\n\n正文\n')
    await clickInRun(r, 0, 0, 1, 'end')
    await pressBackspace(r)
    await flush()
    await typeText(r, 'X')
    await flush()
    const doc = r.getDoc()
    expect(doc).toContain('标')
    await assertDomMatchesSource(r)
  })

  it('撤销之后的第一次编辑仍然可以撤销', async () => {
    const r = renderEditor('一段文字\n\n第二段\n')
    await clickInRun(r, 0, 0, 0, 'end')
    await r.user.keyboard('A')
    await flush()
    expect(r.getDoc()).toBe('一段文字A\n\n第二段\n')

    await pressUndo(r)
    await flush()
    expect(r.getDoc()).toBe('一段文字\n\n第二段\n')

    await r.user.keyboard('B')
    await flush()
    expect(r.getDoc()).toBe('一段文字B\n\n第二段\n')

    // 撤销之后的第一笔编辑同样要进撤销栈。修复前 pushUndo 拿 lastSnapshot 去重，
    // 而 undo 刚把 lastSnapshot 写成"恢复后的状态"＝当前文档，于是这次编辑的
    // pre-state 被当成重复丢掉；栈已空，Ctrl+Z 静默无反应，文档停在 `一段文字B`。
    await pressUndo(r)
    await flush()
    expect(r.getDoc()).toBe('一段文字\n\n第二段\n')
  })

  it('撤销后再编辑再撤销：只退一步，不多吃一层历史', async () => {
    const r = renderEditor('一段文字\n\n第二段\n')
    await clickInRun(r, 0, 0, 0, 'end')
    await r.user.keyboard('A')
    await flush()
    await r.user.keyboard('B')
    await flush()
    expect(r.getDoc()).toBe('一段文字AB\n\n第二段\n')

    await pressUndo(r)
    await flush()
    expect(r.getDoc()).toBe('一段文字A\n\n第二段\n')

    await r.user.keyboard('C')
    await flush()
    expect(r.getDoc()).toBe('一段文字AC\n\n第二段\n')

    // 必须只退这一步。修复前上面那一笔的 pre-state 被丢掉，栈顶还是更早的快照，
    // 一次撤销吃掉两层历史，直接回到 `一段文字`。
    await pressUndo(r)
    await flush()
    expect(r.getDoc()).toBe('一段文字A\n\n第二段\n')
  })

  it('重做之后的第一次编辑也只退一步（同一规则的另一半）', async () => {
    const r = renderEditor('一段文字\n\n第二段\n')
    await clickInRun(r, 0, 0, 0, 'end')
    await r.user.keyboard('A')
    await flush()
    await pressUndo(r)
    await flush()
    expect(r.getDoc()).toBe('一段文字\n\n第二段\n')

    await pressRedo(r)
    await flush()
    expect(r.getDoc()).toBe('一段文字A\n\n第二段\n')

    await r.user.keyboard('B')
    await flush()
    await pressUndo(r)
    await flush()
    // 退掉的应该是刚打的 B；修复前 redo 也写 lastSnapshot，B 的 pre-state 被丢，
    // 这一次撤销连重做一起退回空文档。
    expect(r.getDoc()).toBe('一段文字A\n\n第二段\n')
  })
})

describe('跨块编辑（回归：DOM 与模型必须同步）', () => {
  it('全选删除：内容全部消失且模型一致', async () => {
    const r = renderEditor('# 标题\n\n- 甲\n- 乙\n')
    const docEl = r.container
    docEl.focus({ preventScroll: true })
    const sel = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(docEl)
    sel.removeAllRanges()
    sel.addRange(range)
    await r.user.keyboard('{Delete}')
    await flush()
    expect(r.getDoc().trim()).toBe('')
    await assertDomMatchesSource(r)
  })

  it('跨块选区删除一段：前后拼接正确，不残留也不丢字', async () => {
    const r = renderEditor('# 头条\n\n正文甲\n正文乙\n')
    const titleText = r.runEl(0, 0, 1)!.firstChild!
    const paraText = r.runEl(2, 0, 0)!.firstChild!
    r.container.focus({ preventScroll: true })
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(titleText, 1) // 「条」之后
    range.setEnd(paraText, 0) // 「正文甲」之前（跨块选区）
    sel.removeAllRanges()
    sel.addRange(range)
    await r.user.keyboard('{Delete}')
    await flush()
    // 浏览器删除跨块选区后保留段落边界（标题行与正文之间仍有一行换行）；
    // 关键断言是模型与 DOM 完全同步，不残留也不丢字。
    expect(r.getDoc()).toBe('# 头\n\n正文甲\n正文乙\n')
    await assertDomMatchesSource(r)
  })

  it('跨块选区删除后继续打字，后续编辑正常', async () => {
    const r = renderEditor('# 标题\n\n正文甲\n正文乙\n')
    const titleText = r.runEl(0, 0, 1)!.firstChild!
    const paraText = r.runEl(2, 0, 0)!.firstChild!
    r.container.focus({ preventScroll: true })
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(titleText, 1)
    range.setEnd(paraText, 0)
    sel.removeAllRanges()
    sel.addRange(range)
    await r.user.keyboard('{Delete}')
    await flush()
    // 合成点击（untrusted）的编辑内部光标与 DOM selection 可能不同步，
    // 具体插入点由浏览器决定——断言只守"后续输入不炸、不丢字、DOM 一致"。
    await typeText(r, 'X')
    await flush()
    expect(r.getDoc()).toContain('X')
    expect(r.getDoc()).toContain('正文乙')
    await assertDomMatchesSource(r)
  })
})

describe('渲染态装饰（列表 / 任务 / 分割线）', () => {
  it('列表与任务行的渲染态 class 就位', async () => {
    const r = renderEditor('# t\n\n1. 甲\n2. 乙\n\n- 丙\n\n- [x] 丁\n')
    await flush()
    const ol = r.container.querySelector('.vl-list.vl-ordered')
    expect(ol?.className).toContain('vl-ordered')
    const ul = r.container.querySelector('.vl-list:not(.vl-ordered)')
    expect(ul?.className).toContain('vl-list')
    expect(ul?.className).not.toContain('vl-ordered')
    const task = r.container.querySelector('.vl-task')
    expect(task?.className).toContain('vl-task')
    expect(task?.className).toContain('vl-checked')
    await assertDomMatchesSource(r)
  })

  it('光标进入分割线块时源码显现（光标不再消失）', async () => {
    const r = renderEditor('文本\n\n---\n')
    await flush()
    const rule = r.container.querySelector('[data-block="2"] [data-vline="0"]')
    expect(rule?.className).toContain('vl-rule')
    expect(rule?.className).not.toContain('revealed')
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(rule as Node, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await flush()
    expect(rule?.className).toContain('revealed')
    const run = r.container.querySelector('[data-block="2"] [data-vline="0"] [data-run]')
    expect(run?.textContent).toBe('---')
    await assertDomMatchesSource(r)
  })
})

describe('表格与完整文档（DOM 重建须与模型可比较）', () => {
  it('完整欢迎文档（含全部语法示例）渲染稳定且不循环', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const r = renderEditor(WELCOME_DOC)
      await flush()
      await assertDomMatchesSource(r)
      await clickInRun(r, 0, 0, 1, 'middle')
      await pressEnter(r)
      await flush()
      await assertDomMatchesSource(r)
      expect(errSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe('NotFoundError 回归（换行时不应该有 React removeChild 异常）', () => {
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errSpy.mockRestore()
  })

  it('在各位置反复 Enter 不触发 React 异常且源码一致', async () => {
    const r = renderEditor(WELCOME)
    // 从后往前改：每次回车都会改变块的分段，先动后面的块，前面写死的块索引
    // 才不会被顶掉（先前这里一路落行尾，回车不改变分段，所以顺序看不出来）。
    await clickInRun(r, 6, 1, 4, 'middle')
    await pressEnter(r)
    await flush()
    await assertDomMatchesSource(r)
    await clickInRun(r, 4, 0, 1, 'middle')
    await pressEnter(r)
    await flush()
    await assertDomMatchesSource(r)
    await clickInRun(r, 0, 0, 1, 'middle')
    await pressEnter(r)
    await flush()
    await assertDomMatchesSource(r)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('在文档底部（块外）点一下再回车、再打字，都不崩不丢字', async () => {
    const r = renderEditor('第一行\n\n')
    const box = r.container.getBoundingClientRect()
    await r.user.pointer({
      target: r.container,
      keys: '[MouseLeft]',
      // Viewport coordinates, which is what `coords` means (see clickInRun).
      // The point is inside the container's bottom-left padding: below the last
      // line and outside every block, which is the case this test is about.
      coords: { x: box.left + 4, y: box.bottom - 4 },
    })
    await pressEnter(r)
    await flush()
    await typeText(r, '底')
    await flush()
    const doc = r.getDoc()
    expect(doc).toContain('第一行')
    expect(doc).toContain('底')
    await assertDomMatchesSource(r)
    expect(errSpy).not.toHaveBeenCalled()
  })
})

describe('换行与退格（A1 后残留的算术 / 映射类）', () => {
  it('段落行末连按两次回车后光标停在新空行上（打字不粘进下一段）', async () => {
    const r = renderEditor('第一段文字\n\n第二段\n')
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // 行尾 Enter 是普通断行（`enter-backspace-smoke/10`）：每次只开一个新行。
    expect(r.getDoc()).toBe('第一段文字\n\n\n第二段\n')
    // 中间空白不渲染行盒，光标吸附在段尾（十一审）。
    expect(caretFromDom()).toBe(5)
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('第一段文字\n\n\n\n第二段\n')
    // 第二个新空行同样是中间空白：光标仍吸附在段尾（第二个 Enter 的占位
    // 标记会把下一次键入归位成新段落）。
    expect(caretFromDom()).toBe(5)
    // 键盘输入，不用 typeText：user.type 会先点一次容器，光标会被点走。
    await r.user.keyboard('X')
    await flush()
    // X 被归位成新段落：占位空行 + 原有空行在 X 两侧（补边界只补缺失的一侧，
    // 已有的空行保留）。关键性质是 X 不粘进下一段——修复前这里是 'X第二段'。
    expect(r.getDoc()).toBe('第一段文字\n\nX\n\n\n第二段\n')
    await assertDomMatchesSource(r)
  })

  it('列表项回车后光标落在新 bullet 上；再次回车退出列表且不改动下一项', async () => {
    const r = renderEditor('- 第一项\n- 第二项\n')
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('- 第一项\n- \n- 第二项\n')
    // 新 bullet 行是 `- `（源码偏移 6..8），光标应当停在它的行尾。
    expect(caretFromDom()).toBe(8)
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('- 第一项\n\n- 第二项\n')
    await assertDomMatchesSource(r)
  })

  it('文档末尾带空行时，回车后打字落在新行上（不并回上一行）', async () => {
    // 复现自真实浏览器：草稿 '标题行\n\n' 的末尾是两个空行（同一个空块的两行），
    // 回车后光标必须锚在"新建的那一行"，而不是空块的第一行。
    const r = renderEditor('标题行\n\n')
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await r.user.keyboard('测试')
    await flush()
    await pressEnter(r)
    await flush()
    // 行尾 Enter 是普通断行（`enter-backspace-smoke/10`）：只插一个换行，
    // 光标落在新行行首。
    expect(r.getDoc()).toBe('标题行测试\n\n\n')
    await r.user.keyboard('第二行')
    await flush()
    // Enter 开出的空行是新段占位：补上前空行边界成独立段，间距不随输入消失。
    expect(r.getDoc()).toBe('标题行测试\n\n第二行\n\n')
    // 光标还在刚打的那一行正文末尾：`标题行测试` 5 字 + 两个换行 + `第二行` 3 字 = 10。
    expect(caretFromDom()).toBe(10)
    const tops = [...r.container.querySelectorAll<HTMLElement>('[data-vline]')]
      .filter((el) => (el.textContent ?? '') !== '')
      .map((el) => Math.round(el.getBoundingClientRect().top))
    expect(new Set(tops).size).toBe(2)
    await assertDomMatchesSource(r)
  })

  it('块元素带 blk 类，表格才拿到网格样式（CSS 契约）', async () => {
    const r = renderEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    const block = r.blockEl(0)
    expect(block?.className.split(/\s+/)).toContain('blk')
    expect(block?.getAttribute('data-kind')).toBe('table')
    // 计算样式才是真正的验收：`.blk[data-kind='table'] .vl-table` 命中时行才是网格。
    const row = block?.querySelector('.vl-table') as HTMLElement | null
    expect(row).not.toBeNull()
    expect(getComputedStyle(row as HTMLElement).display).toBe('grid')
    // 单元格自带右边线与下边线，外框由块上的 top/left 提供 —— 相邻行不会叠出 2px。
    const cell = block?.querySelector('.cell') as HTMLElement | null
    expect(getComputedStyle(cell as HTMLElement).borderRightWidth).toBe('1px')
    expect(getComputedStyle(block as HTMLElement).borderTopWidth).toBe('1px')
    // `| --- |` 行在渲染态不占高度（Typora 里它不是一个可见行）。
    const delim = block?.querySelector('.vl-table-delim') as HTMLElement | null
    expect(delim).not.toBeNull()
    expect((delim as HTMLElement).getBoundingClientRect().height).toBeLessThanOrEqual(1)
  })

  it('Tab 在非列表位置也被拦截（焦点不会跑到浏览器地址栏）', async () => {
    const r = renderEditor('普通段落\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    let prevented = false
    const watch = (event: KeyboardEvent) => {
      if (event.key === 'Tab') prevented = event.defaultPrevented
    }
    document.addEventListener('keydown', watch)
    await r.user.keyboard('{Tab}')
    await flush()
    document.removeEventListener('keydown', watch)
    expect(prevented).toBe(true)
    // 不缩进也不换行：只是吃掉这次 Tab。
    expect(r.getDoc()).toBe('普通段落\n')
  })

  it('IME 合成期间不重写 DOM（否则提交后会残留拼音字母）', async () => {
    const r = renderEditor('~~删除线~~\n')
    await flush()
    const line = r.container.querySelector('.vl') as HTMLElement
    const run = [...line.querySelectorAll<HTMLElement>('[data-run]')].find(
      (el) => el.textContent === '删除线',
    ) as HTMLElement

    // 合成开始，浏览器把拼音写进 DOM。
    line.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const composing = document.createTextNode('w')
    run.appendChild(composing)
    line.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    line.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'w' }))
    await flush()
    expect(r.getDoc()).toBe('~~删除线w~~\n')

    // 合成期间光标/选区变化很频繁，且随着文本增长会改变显现状态。
    const range = document.createRange()
    range.setStart(composing, 1)
    range.collapse(true)
    const sel = window.getSelection() as Selection
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await flush()

    // 关键不变量：合成期间 DOM 一个节点都不能被换掉。
    expect(line.isConnected).toBe(true)
    expect(run.isConnected).toBe(true)
    expect(run.lastChild).toBe(composing)

    // 提交：合成文本被最终字符替换。
    composing.textContent = '我'
    line.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    line.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    line.dispatchEvent(new InputEvent('input', { bubbles: true, data: '我' }))
    await flush()

    const doc = r.getDoc()
    expect(doc).toBe('~~删除线我~~\n')
    expect(doc).not.toContain('w')
    await assertDomMatchesSource(r)
  })

  /**
   * ASCII 输入法的合成（拼音 `ABC` → 提交 `ABC`，内容一个字符都不变）在提交那条路上
   * 的回归。坏掉时：提交后 DOM 仍是合成形态的裸文本节点、没有 run，模型又以为没变化
   * 直接早退，于是**下一次按键**在脏 DOM 上算光标，字符落点整体错位
   * （`.scratch/enter-backspace-smoke/issues/11`，用户实测 CJK 输入法复现）。
   */
  it('IME ASCII 提交（内容不变）：提交后接着打字，字符落点紧跟光标', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    // 光标在「甲」行尾：浏览器把拼音作为裸文本放进行盒（空行不再渲染行盒，
    // 合成点直接落在段内文本之后，`paragraph-spacing/01` 十一审）。
    const doc = r.container
    const fresh = (() => {
      const sel = window.getSelection()!
      const n = sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
      return (n instanceof Element ? n : n?.parentElement) as HTMLElement
    })()
    doc.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const composing = document.createTextNode('ABC')
    fresh.appendChild(composing)
    const range = document.createRange()
    range.setStart(composing, 3)
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    doc.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    doc.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ABC' }))
    await flush()
    expect(r.getDoc()).toBe('甲ABC\n\n乙\n')

    // ASCI 提交：合成文本原样落定（内容不变，但 DOM 形态要恢复正常）。
    doc.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ABC' }))
    doc.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    doc.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ABC' }))
    await flush()
    expect(r.getDoc()).toBe('甲ABC\n\n乙\n')
    // 提交后的光标在 ABC 末尾（`甲ABC` 的尽头 = 偏移 4）。
    // eslint-disable-next-line no-console
    console.log('SEL-DEBUG', (() => { const sel = window.getSelection()!; const r = sel.rangeCount ? sel.getRangeAt(0) : null; return r ? r.startContainer.nodeType + '@' + r.startOffset + ' paren=' + (r.startContainer.parentElement?.getAttribute('data-src') ?? '?') : 'none' })())
    expect(caretFromDom()).toBe('甲'.length + 3)

    // 接着打字：字符必须落在 ABC 之后，光标跟走——坏掉时落点和光标都会错位。
    await r.user.keyboard('D')
    await flush()
    expect(r.getDoc()).toBe('甲ABCD\n\n乙\n')
    expect(caretFromDom()).toBe('甲'.length + 4)
    await assertDomMatchesSource(r)
  })

  /**
   * 同一条路的「无 input 提交」形态：`compositionend` 之后浏览器一个 input 都不发
   * （CDP 的 `Input.insertText` 提交就是这样），紧接着的普通按键必须不受影响。
   * 坏掉时：`compositionend` 的归一化不做，光标被浏览器留在别处，下一个字符掉到
   * 别的行上（`.scratch/enter-backspace-smoke/issues/11` 的真机实测）。
   */
  it('IME ASCII 提交后不再有 input（CDP 那类）：下一个字符仍落在合成文本之后', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    const doc = r.container
    const fresh = (() => {
      const sel = window.getSelection()!
      const n = sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
      return (n instanceof Element ? n : n?.parentElement) as HTMLElement
    })()
    doc.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const composing = document.createTextNode('ABC')
    fresh.appendChild(composing)
    const range = document.createRange()
    range.setStart(composing, 3)
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    doc.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    doc.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ABC' }))
    await flush()
    // 提交只以 compositionend 到达——没有后续 input。
    doc.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ABC' }))
    await flush()
    expect(r.getDoc()).toBe('甲ABC\n\n乙\n')
    // 光标当场停在 ABC 末尾（`甲ABC` = 偏移 4）。
    expect(caretFromDom()).toBe('甲'.length + 3)

    await r.user.keyboard('D')
    await flush()
    expect(r.getDoc()).toBe('甲ABCD\n\n乙\n')
    expect(caretFromDom()).toBe('甲'.length + 4)
    await assertDomMatchesSource(r)
  })

  /**
   * 合成**逐步增长**（输入法联想：`ABC` → 继续键入 `D` 变 `ABCD`）时，第二个
   * `insertCompositionText` 的输入把光标从 DOM 读——而上一次的 `recompute()` 已经把
   * 视图换成新形状、DOM 却还是合成的临时形态，读出来的偏移就飞走了
   * （`.scratch/enter-backspace-smoke/issues/11` 的用户实测：摄取后光标飞掉）。
   */
  it('IME 合成逐步增长（ABC → ABCD）：光标始终跟在合成文本末尾', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    const doc = r.container
    const fresh = (() => {
      const sel = window.getSelection()!
      const n = sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
      return (n instanceof Element ? n : n?.parentElement) as HTMLElement
    })()
    doc.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const composing = document.createTextNode('ABC')
    fresh.appendChild(composing)
    const place = (at: number) => {
      const range = document.createRange()
      range.setStart(composing, at)
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    }
    place(3)
    doc.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    doc.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ABC' }))
    await flush()
    // 合成继续：浏览器把合成文本扩成 ABCD、光标在末尾。
    composing.textContent = 'ABCD'
    place(4)
    doc.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    doc.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ABCD' }))
    await flush()
    expect(r.getDoc()).toBe('甲ABCD\n\n乙\n')
    // 第二个合成输入之后模型光标仍指向合成文本末尾。这里不能直接断言
    // `caretFromDom()`：合成中 DOM 保持临时形态（裸文本节点，不渲染），助手的
    // 行盒读法只会看到行盒起始；模型值由提交后的落点和继续打字验证。
    expect(r.getDoc()).toBe('甲ABCD\n\n乙\n')

    // 提交后继续打字：字符跟光标走。
    doc.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ABCD' }))
    await flush()
    await r.user.keyboard('E')
    await flush()
    expect(r.getDoc()).toBe('甲ABCDE\n\n乙\n')
    expect(caretFromDom()).toBe('甲'.length + 5)
    await assertDomMatchesSource(r)
  })

  /**
   * 「ABC → space → D → space」的两种真实输入法形态（用户实测场景，可能二选一）：
   *
   * - space **并入**合成（真机 CDP 实测：合成中按 Space，`insertCompositionText` 的 data
   *   变成 `'ABC '`）——合成一路长到 `'ABC D '`，提交后光标在末尾；
   * - 输入法把整个合成**替换**成新内容（`deleteCompositionText` + `insertCompositionText`）
   *   ——删除输入的 data 为 null，`composeLength` 不能依赖它。
   *
   * 两条都不允许光标在提交后飞走。
   */
  it('IME 合成中按 Space（并入合成）：提交后光标仍跟合成文本', async () => {
    const r = renderEditor('甲\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    const doc = r.container
    const sel = window.getSelection()!
    const n = sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
    const box = (n instanceof Element ? n : n?.parentElement) as HTMLElement
    const place = (t: Text, at: number) => {
      const range = document.createRange()
      range.setStart(t, at)
      range.collapse(true)
      const s = window.getSelection()!
      s.removeAllRanges()
      s.addRange(range)
    }
    const fire = (inputType: string, data: string | null) => {
      const opts = { inputType, data, bubbles: true, cancelable: true, composed: true } as InputEventInit
      doc.dispatchEvent(new InputEvent('beforeinput', opts))
      doc.dispatchEvent(new InputEvent('input', opts))
    }
    doc.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const t = document.createTextNode('ABC')
    box.appendChild(t)
    place(t, 3)
    fire('insertCompositionText', 'ABC')
    await flush()
    t.textContent = 'ABC D '
    place(t, 6)
    fire('insertCompositionText', 'ABC D ')
    await flush()
    expect(r.getDoc()).toBe('甲ABC D \n')
    doc.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ABC D ' }))
    await flush()
    await r.user.keyboard('E')
    await flush()
    expect(r.getDoc()).toBe('甲ABC D E\n')
    expect(caretFromDom()).toBe('甲'.length + 7)
    await assertDomMatchesSource(r)
  })

  it('IME 输入法把合成整体替换成新文本（deleteCompositionText）：光标不飞', async () => {
    const r = renderEditor('甲\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    const doc = r.container
    const sel = window.getSelection()!
    const n = sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
    const box = (n instanceof Element ? n : n?.parentElement) as HTMLElement
    const place = (t: Text, at: number) => {
      const range = document.createRange()
      range.setStart(t, at)
      range.collapse(true)
      const s = window.getSelection()!
      s.removeAllRanges()
      s.addRange(range)
    }
    const fire = (inputType: string, data: string | null) => {
      const opts = { inputType, data, bubbles: true, cancelable: true, composed: true } as InputEventInit
      doc.dispatchEvent(new InputEvent('beforeinput', opts))
      doc.dispatchEvent(new InputEvent('input', opts))
    }
    doc.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const t = document.createTextNode('ABC ')
    box.appendChild(t)
    place(t, 4)
    fire('insertCompositionText', 'ABC ')
    await flush()
    // 输入法把整个合成替换成 D：先删（data 为 null，composeLength 不能停滞在旧值
    // 之外），再插。
    t.textContent = ''
    place(t, 0)
    fire('deleteCompositionText', null)
    await flush()
    t.textContent = 'D'
    place(t, 1)
    fire('insertCompositionText', 'D')
    await flush()
    expect(r.getDoc()).toBe('甲D\n')
    doc.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'D' }))
    await flush()
    await r.user.keyboard('E')
    await flush()
    expect(r.getDoc()).toBe('甲DE\n')
    expect(caretFromDom()).toBe('甲'.length + 2)
    await assertDomMatchesSource(r)
  })

  it('有序列表中间回车：后面的编号顺延，不再出现重复编号', async () => {
    const r = renderEditor('1. 甲\n2. 乙\n3. 丙\n')
    await clickInRun(r, 0, 1, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // 回车插在第二项之后：新项拿 3，原来的第三项被推到 4（修复前是 1 2 3 3）。
    expect(r.getDoc()).toBe('1. 甲\n2. 乙\n3. \n4. 丙\n')
    await r.user.keyboard('X')
    await flush()
    expect(r.getDoc()).toBe('1. 甲\n2. 乙\n3. X\n4. 丙\n')
    await assertDomMatchesSource(r)
  })

  it('Tab 缩进列表项、Shift+Tab 退回（有序与无序都支持）', async () => {
    const ordered = renderEditor('1. 甲\n2. 乙\n')
    await clickInRun(ordered, 0, 1, 1, 'end')
    await flush()
    await ordered.user.keyboard('{Tab}')
    await flush()
    expect(ordered.getDoc()).toBe('1. 甲\n   1. 乙\n')
    await ordered.user.keyboard('{Shift>}{Tab}{/Shift}')
    await flush()
    expect(ordered.getDoc()).toBe('1. 甲\n2. 乙\n')
    await assertDomMatchesSource(ordered)

    const plain = renderEditor('- 甲\n- 乙\n')
    await clickInRun(plain, 0, 1, 1, 'end')
    await flush()
    await plain.user.keyboard('{Tab}')
    await flush()
    expect(plain.getDoc()).toBe('- 甲\n  - 乙\n')
    await assertDomMatchesSource(plain)
  })

  it('Tab 缩进带子列表的项：子列表留在原缩进（行级操作，不跟着走）', async () => {
    const r = renderEditor('1. 甲\n2. 乙\n   - 子一\n3. 丙\n')
    await clickInRun(r, 0, 1, 1, 'end')
    await flush()
    await r.user.keyboard('{Tab}')
    await flush()
    // 只动那一行，然后同步编号：子列表被上一项接管是设计，不是缺陷。
    expect(r.getDoc()).toBe('1. 甲\n   1. 乙\n   - 子一\n2. 丙\n')
    await assertDomMatchesSource(r)
  })

  it('Shift+Tab 在最外层：该项变正文，列表断成两个', async () => {
    const r = renderEditor('1. 甲\n2. 乙\n3. 丙\n')
    await clickInRun(r, 0, 1, 1, 'end')
    await flush()
    await r.user.keyboard('{Shift>}{Tab}{/Shift}')
    await flush()
    expect(r.getDoc()).toBe('1. 甲\n\n乙\n\n1. 丙\n')
    // 光标原本在行末：标记消失之后它仍在正文末尾（`乙` 在偏移 6，末尾是 7）。
    expect(caretFromDom()).toBe(7)
    await assertDomMatchesSource(r)
  })

  it('Tab 在列表首项：只是一次普通按键，在光标处插两个空格', async () => {
    const r = renderEditor('- 甲乙\n- 丙\n')
    await clickInRun(r, 0, 0, 1, 'middle')
    await flush()
    expect(caretFromDom()).toBe(3)
    await r.user.keyboard('{Tab}')
    await flush()
    expect(r.getDoc()).toBe('- 甲  乙\n- 丙\n')
    expect(caretFromDom()).toBe(5)
    await assertDomMatchesSource(r)
  })

  it('图片在渲染态是真的 <img>，源码一字不丢', async () => {
    const url = 'https://pic1.zhimg.com/v2-11005a90e751b84eb1e2a0bb33c1c142_l.jpg?source=32738c0c&needBackground=1'
    const r = renderEditor(`看图：\n\n![示例图片](${url})\n`)
    await flush()
    const img = r.container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe(url)
    // 源码随图一起留在 DOM 里（隐藏副本），否则从 DOM 重建会丢掉这一行。
    await assertDomMatchesSource(r)
    expect(r.getDoc()).toContain(`![示例图片](${url})`)
  })

  it('图片带上 {width=200}：屏幕上就按 200 宽画，源码一字不丢', async () => {
    const r = renderEditor('看图：\n\n![示例](https://example.com/a.png){width=200}\n')
    await flush()
    const img = r.container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://example.com/a.png')
    expect(img?.getAttribute('width')).toBe('200')
    await assertDomMatchesSource(r)
    expect(r.getDoc()).toContain('{width=200}')
  })

  it('光标进入图片所在行时，图片让位给源码（可编辑）', async () => {
    // 首行放一段文字：初始光标在偏移 0，正好落在第一行，图片行保持渲染态。
    const r = renderEditor('甲\n\n![甲](https://example.com/a.png)\n')
    await flush()
    expect(r.container.querySelector('img')).not.toBeNull()
    const line = [...r.container.querySelectorAll('.vl')].find(
      (el) => el.querySelector('img') !== null,
    ) as HTMLElement
    // 把光标放进图片构造内部：图片应当折叠回源码。
    const range = document.createRange()
    range.setStart(line, 0)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await flush()
    expect(r.container.querySelector('img')).toBeNull()
    expect(line.textContent).toContain('![甲](https://example.com/a.png)')
    await assertDomMatchesSource(r)
  })

  it('六级标题各有各的字号（浏览器默认比例）', async () => {
    const r = renderEditor('# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六\n')
    await flush()
    const sizes = [1, 2, 3, 4, 5, 6].map((level) => {
      const line = r.container.querySelector(`.vl-h${level}`) as HTMLElement | null
      expect(line).not.toBeNull()
      return Number.parseFloat(getComputedStyle(line as HTMLElement).fontSize)
    })
    // `r.container` 就是 `.doc` 本身（harness 的取值器返回它）。
    const base = Number.parseFloat(getComputedStyle(r.container).fontSize)
    // 逐级对应 2 / 1.5 / 1.17 / 1 / 0.83 / 0.67（允许浏览器最小字号造成的偏差）
    const ratios = [2, 1.5, 1.17, 1, 0.83, 0.67]
    ratios.forEach((ratio, i) => {
      expect(sizes[i]).toBeCloseTo(base * ratio, 1)
    })
    // 严格递减，六级彼此可辨
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1])
  })

  it('表格单元格可点进去就地编辑，源码结构不丢', async () => {
    const r = renderEditor('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    // 点单元格文字的开头：旧助手只会落到行尾，这个位置根本表达不出来。
    await clickInRun(r, 0, 2, 0, 'start')
    await r.user.keyboard('X')
    await flush()
    expect(r.getDoc()).toBe('| 甲 | 乙 |\n| --- | --- |\n| X1 | 2 |\n')
    // 再点同一个单元格的末尾：输入落在同一个单元格里，不是下一格。
    await clickInRun(r, 0, 2, 0, 'end')
    await r.user.keyboard('Y')
    await flush()
    // 三行结构一字不差：分隔行必须留在源码里（它不可见，只能从 DOM 的隐藏副本重建），
    // 改动只落在那一个单元格里。
    expect(r.getDoc()).toBe('| 甲 | 乙 |\n| --- | --- |\n| X1Y | 2 |\n')
    await assertDomMatchesSource(r)
  })

  it('有序列表块重置计数器（每段编号从 1 开始）', async () => {
    const r = renderEditor('1. 一\n2. 二\n\n中间段落\n\n1. 甲\n2. 乙\n')
    await flush()
    const blocks = [...r.container.querySelectorAll<HTMLElement>('[data-block]')]
    const lists = blocks.filter((b) => b.getAttribute('data-kind') === 'list')
    expect(lists.length).toBe(2)
    for (const list of lists) expect(getComputedStyle(list).counterReset).toContain('vl-l0')
    // 每个有序行都要拿到计数器的增量来源（渲染态下由 ::before 显示）。
    for (const list of lists) {
      expect(list.querySelector('.vl-ordered')).not.toBeNull()
    }
  })

  it('嵌套有序列表按层级各自计数：源码 1/1/2 与渲染一致', async () => {
    const r = renderEditor('1. 甲\n   1. 乙\n2. 丙\n')
    await flush()
    const lines = [...r.container.querySelectorAll<HTMLElement>('.vl-ordered')]
    expect(lines.map((l) => l.className.match(/vl-l\d/)?.[0])).toEqual(['vl-l0', 'vl-l1', 'vl-l0'])
    // 渲染编号来自每层自己的计数器：内层递增 vl-l1，外层只递增 vl-l0 并重置更深层。
    expect(getComputedStyle(lines[1]).counterIncrement).toContain('vl-l1')
    expect(getComputedStyle(lines[0]).counterReset).toContain('vl-l1')
    // 源码里层数编号就是 1 / 1 / 2，与渲染顺序一致。
    expect(r.getDoc()).toBe('1. 甲\n   1. 乙\n2. 丙\n')
    await assertDomMatchesSource(r)
  })

  it('空行渲染一个 <br> 作为可编辑落点（真实浏览器的插入点依赖它）', async () => {
    // 合成（untrusted）输入不会走浏览器自己的插入点解析，所以"把光标放在空行上
    // 再打字"在测试里能过、在真实浏览器里会把字插到上一行末尾。这条断言把原因
    // 钉住：空行必须带一个 <br> 落点。
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    const emptyLines = [...r.container.querySelectorAll('.vl')].filter(
      (el) => (el.textContent ?? '') === '',
    )
    expect(emptyLines.length).toBeGreaterThan(0)
    for (const el of emptyLines) expect(el.querySelector('[data-br]')).not.toBeNull()
    // <br> 不参与源码重建
    await assertDomMatchesSource(r)
  })

  it('标题行末回车后按退格：一次回车配一次退格，原样还原', async () => {
    const r = renderEditor('# 标题\n\n正文\n')
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('# 标题\n\n\n正文\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('# 标题\n\n正文\n')
    // 行尾 Enter 只插一个换行（`enter-backspace-smoke/10`），一次退格恰好还原，
    // 光标回到回车前的偏移（4 → 5 → 4，落在被删换行的原位上）。空行上的退格
    // 规则（`09`）不变：删掉的是光标前面那个换行，光标留在剩下的空行上。
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  /**
   * 合并换行之后光标落在哪里：**两条编辑路径，两条规则**。
   *
   * 两条路径产出的**文本**一样，落点却**不同**，因为删掉的那个换行不同：
   *
   * - 光标停在**空行**上（C1）：删掉的是光标前面那个换行，join 点落在**上一段内容的末尾**
   *   （这里是"剩下的空行"为零，也就是下一段的行首）；
   * - 光标在**下一行行首**（C2）：删掉的是空行自己那个换行，join 点在**下一行文字之前**
   *   ——光标原地不动，下一行被拉上来。
   *
   * `3e91537`（`backspace-join/01`）曾把 C2 也归一化到"上一段末尾"，理由是两条路径"产出的
   * 文本一样、落点就该一样"；`enter-backspace-smoke/09` 随后把那条循环缩到"光标行内有文字"
   * 时才生效。用户实测报掉的正是 C2：`a\n\nb` 里光标在 `b` 前面按 Backspace，落点被甩到
   * `a` 末尾（偏移 1），而他要的是留在 `b` 前面（偏移 2）。循环已按票删除，见
   * `.scratch/backspace-join/issues/04`；C1 的落点本来就是 join 点，没有受影响。
   */
  it('合并换行的落点：空行上落到上一段末尾，下一行行首则留在下一行文字之前', async () => {
    // 路径 C1：行尾回车开出一个空行，光标就在那个空行上。
    const split = renderEditor('## 有序列表\n## 列表嵌套\n')
    await clickInRun(split, 0, 0, 1, 'end')
    await flush()
    expect(caretFromDom()).toBe(7) // `## 有序列表` 末尾
    await pressEnter(split)
    await flush()
    // 行尾 Enter 是普通断行（`enter-backspace-smoke/10`）：只插一个换行。
    expect(split.getDoc()).toBe('## 有序列表\n\n## 列表嵌套\n')
    await pressBackspace(split)
    await flush()
    expect(split.getDoc()).toBe('## 有序列表\n## 列表嵌套\n')
    // 一次回车配一次退格，原样还原：占位空行被退格删掉（十一审的 Enter 标记），
    // 光标落在合并点 = 下一个标题的行首（原偏移 8）。
    expect(caretFromDom()).toBe(8)

    // 路径 C2：光标在下一行的行首（源码里的行首，`## ` 之前）。先把光标放进这一行，
    // 让 `## ` 显现成可见源码，再移到行首——这就是真的按两次左箭头会到的地方。
    // 空行是**自己的一个 block**，所以第二个标题是 block 2，不是 block 1。
    const atLineStart = renderEditor('## 有序列表\n\n## 列表嵌套\n')
    await flush()
    atLineStart.container.focus({ preventScroll: true })
    const text = atLineStart.blockEl(2)?.querySelector<HTMLElement>('[data-run="1"]')
    if (!text?.firstChild) throw new Error('第二个标题没有文本 run')
    placeCaretAt(text.firstChild, 0)
    await flush()
    const marker = atLineStart.blockEl(2)?.querySelector<HTMLElement>('[data-run="0"]')
    if (!marker?.firstChild) throw new Error('第二个标题没有源码 run')
    placeCaretAt(marker.firstChild, 0)
    await flush()
    expect(caretFromDom()).toBe(9)

    await pressBackspace(atLineStart)
    await flush()
    expect(atLineStart.getDoc()).toBe('## 有序列表\n## 列表嵌套\n')
    // 删掉的是空行自己那个换行（偏移 8），光标原地不动 = 下一行文字之前；
    // C1 删掉的是它前面那个换行，落点是上一段末尾（偏移 7）。两者相差一个换行，
    // 差别就是"光标贴着下面那行"还是"贴着上面那段"。
    expect(caretFromDom()).toBe(8)
  })

  it('空 bullet 上按 Backspace：退出列表，和 Enter 是同一个结果', async () => {
    const r = renderEditor('1. aaa\n2. \n3. bbb\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    expect(caretFromDom()).toBe(10)
    await pressBackspace(r)
    await flush()
    // 标记去掉、空行留下、后面的重新编号。旧行为是删掉标记里的那个空格，
    // 留下 `2.`：编辑器自己的扫描不认它是列表项，markdown-it 认，两边就分岔了。
    expect(r.getDoc()).toBe('1. aaa\n\n2. bbb\n')
    expect(caretFromDom()).toBe(7) // 退出来的那个空行
    await assertDomMatchesSource(r)

    // 光标在行首也一样。旧行为会先把标记并进上一行（`1. aaa2. `）。
    const atStart = renderEditor('1. aaa\n2. \n3. bbb\n')
    await flush()
    await clickInRun(atStart, 0, 1, 0, 'start')
    await flush()
    await pressBackspace(atStart)
    await flush()
    expect(atStart.getDoc()).toBe('1. aaa\n\n2. bbb\n')
    expect(caretFromDom()).toBe(7)
    await assertDomMatchesSource(atStart)
  })

  it('两位数的编号被重排缩短时，光标仍在退出来的那个空行上', async () => {
    const r = renderEditor('10. aaa\n11. \n12. bbb\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    await pressBackspace(r)
    await flush()
    // `10.` → `1.` 之后整篇都短了一格：光标要按重排后的文本算（旧算法按重排前的偏移给 8，
    // 正好落到 `2. bbb` 上）。
    expect(r.getDoc()).toBe('1. aaa\n\n2. bbb\n')
    expect(caretFromDom()).toBe(7)
    await assertDomMatchesSource(r)
  })

  it('空任务项上按 Backspace 同样退出列表', async () => {
    const r = renderEditor('- [ ] \n- 乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('\n- 乙\n')
    // 开头空行不渲染行盒，光标吸附在列表行首（十一审）。
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(r)
  })

  it('只有引用标记的行：Backspace 退出引用，和 Enter 一样', async () => {
    const r = renderEditor('> 引用\n> \n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('> 引用\n\n')
    // 退出引用后光标在引用行尾（尾空行无行盒，吸附，十一审）。
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('围栏里那行 `- ` 是代码，不是空项：Backspace 只删掉那个空格', async () => {
    const r = renderEditor('```\n- \n```\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    await pressBackspace(r)
    await flush()
    // 空项规则不认它（围栏里是文本），于是退回浏览器的普通退格：删掉空格，
    // 而不是把整个 `- ` 标记拿掉（那会把代码示例改掉）。
    expect(r.getDoc()).toBe('```\n-\n```\n')
    await assertDomMatchesSource(r)
  })

  it('光标在下一行行首：一次 Backspace 只吃掉一个换行，光标留在下一行文字之前', async () => {
    const r = renderEditor('甲\n\n\n乙\n')
    await flush()
    // 两个空行是同一个 blank block 的两条视觉行；`乙` 是 block 2。
    // 这条走的是 C2 路径（光标在**下一行行首**，行内有文字）：删掉的是空行自己那个
    // 换行，光标原地不动，`乙` 被拉上来；同一份文档、光标停在**空行**上那条走 C1，
    // 落点在剩下的空行上——两条规则，见上面的「合并换行的落点」。
    await clickInRun(r, 2, 0, 0, 'start')
    await flush()
    expect(caretFromDom()).toBe(4)
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n乙\n')
    // 光标贴在 `乙` 前面（偏移 3 = 剩下的那个空行），不是 `甲` 末尾。
    expect(caretFromDom()).toBe(3)
    await assertDomMatchesSource(r)

    // 连按：换行逐个消失，光标一路跟着 `乙` 走，正文一个字不少——回退被删掉之前，
    // 第一按就把光标甩到 `甲` 末尾，第二按删掉的就是 `甲`（`enter-backspace-smoke/09`）。
    await pressBackspace(r)
    await flush()
    expect([r.getDoc(), caretFromDom()]).toEqual(['甲\n乙\n', 2])
    await pressBackspace(r)
    await flush()
    expect([r.getDoc(), caretFromDom()]).toEqual(['甲乙\n', 1])
    await assertDomMatchesSource(r)
  })

  it('光标在文档开头时不触发合并规则', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    expect(caretFromDom()).toBe(0)
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n乙\n')
  })

  /**
   * 光标停在**空行**上时是另一条规则（`enter-backspace-smoke/09`）。
   *
   * 改动前这一按会被一路甩到上一段末尾（`while (joined[caret - 1] === '\n') caret--`），
   * 于是**第二次** Backspace 删掉的是正文的最后一个字，而剩下的空行一个不少——
   * 空行越多越明显。删掉的就是光标前面那个换行，光标留在剩下的空行上。
   */


  /**
   * 只有空格的行同样是空行（`isBlankLine`，与解析器和视图的口径一致）。
   *
   * 改动前这一按会把光标甩到 `甲` 末尾、再按一次吃掉 `甲`：条件是 `line.text !== ''`，
   * 而 `   ` 被当成了文字，于是又走回「往上找上一段」那条路
   * （`.scratch/enter-backspace-smoke/issues/09`）。
   */
  it('只有空格的行：和空行同一条规则，不甩到上一段末尾', async () => {
    const r = renderEditor('甲\n\n   \n乙\n')
    await flush()
    await clickAtLine(r, 1, 1)
    await flush()
    expect(caretFromDom()).toBe(3) // 空格行的行首

    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n   \n乙\n')
    expect(caretFromDom()).toBe(2)
    // 改动前这里跑不了这行断言：只有空格的行在解析阶段就被丢了字符，DOM 重建出的
    // 源码比模型少那几个空格。现在空白行的字符活在折叠 run 里，往返逐字一致
    // （`.scratch/whitespace-round-trip/issues/01`）。
    await assertDomMatchesSource(r)
  })

  /**
   * 只有空格的行：源码必须原样活下来。
   *
   * 改动前空白行在解析阶段就丢了字符（blank 块的 `raw: ''`），DOM 重建出的源码比模型
   * 少那几个空格，于是**任何一次编辑**都会把它们写没——用户打出来的空白就这么消失，
   * 而且撤销栈里那一步记的是"输入了别的字"，等于不可撤销。
   */
  it('只有空格的行：渲染出来的 DOM 与模型逐字一致', async () => {
    const r = renderEditor('甲\n   \n乙\n')
    await flush()
    await assertDomMatchesSource(r)
  })

  it('只有空格的行：在别处输入一个字符，空格原样保留、字符落在光标处', async () => {
    const r = renderEditor('甲\n   \n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await r.user.keyboard('X')
    await flush()
    expect(r.getDoc()).toBe('X甲\n   \n乙\n')
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(r)
  })

  it('只有空格的行：在这一行上打字，字符落在这一行、空格一个不少（两段之间 = 并段）', async () => {
    const r = renderEditor('甲\n   \n乙\n')
    await flush()
    await clickAtLine(r, 1, 0)
    await flush()
    await r.user.keyboard('X')
    await flush()
    // 空格不参与排版，所以这一行只有一个光标位：行首。打进去的字落在空格**之前**
    // ——比丢掉空格好；这个代价记在 ADR-0002。空格行与空行同一条规则
    // （isBlankLine）：被占用 = 新建一个块（`paragraph-spacing/01` 十审）。
    expect(r.getDoc()).toBe('甲\n\nX   \n\n乙\n')
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('只有空格的行：在行首回车，换行插在光标处（空格之前）', async () => {
    // 回车走 `applyEdit`，它从 DOM 选区读块内偏移。折叠 run 排不出来，读回必须是
    // **行首**；读成"最后一个 run 的末尾"就会把换行插到那几个空格后面，用户看到
    // 光标在行首、换行却出现在空格之后。
    const r = renderEditor('甲\n   \n乙\n')
    await flush()
    await clickAtLine(r, 1, 0)
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n   \n乙\n')
    await assertDomMatchesSource(r)
  })

  /**
   * 非空列表项：在**正文开头**按 Backspace 要把这一项移出列表。
   *
   * 旧行为是把它交给浏览器，删掉的是标记自己的那个分隔空格（`3. ccc` → `3.ccc`）。那一行随后
   * 既不是列表项（`parseListItem` 要求分隔符后有空白），也不匹配内核认的前缀——标记退化成普通
   * 文字，再按几次光标就离开这一行，删掉的是**上一项的内容**。逐次实测记在
   * `.scratch/backspace-unlist/issues/01`。
   */
  it('非空项：正文开头 Backspace 一次移出列表、再一次并进上一行（不碰上一项）', async () => {
    const r = renderEditor('1. aaa\n2. b\n3. ccc\n')
    await flush()
    await clickInRun(r, 0, 2, 1, 'start')
    await flush()
    expect(caretFromDom()).toBe(15) // `ccc` 的起始

    await pressBackspace(r)
    await flush()
    // 标记去掉，正文缩进到上一项的内容列（`2. ` 宽 3），成为它的续行；
    // 光标仍停在这一行的正文起始上（15），没有跳到上一行末尾。
    expect(r.getDoc()).toBe('1. aaa\n2. b\n   ccc\n')
    expect(caretFromDom()).toBe(15)
    await assertDomMatchesSource(r)

    await pressBackspace(r)
    await flush()
    // 再按一次：去掉缩进并并进上一行，接缝处**不加空格**（Typora 给 `2. bccc`）。
    expect(r.getDoc()).toBe('1. aaa\n2. bccc\n')
    expect(caretFromDom()).toBe(11)
    await assertDomMatchesSource(r)
  })

  it('非空项是列表第一项：退化成普通段落，其余项重新编号', async () => {
    const r = renderEditor('1. aaa\n2. bbb\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'start')
    await flush()
    expect(caretFromDom()).toBe(3)

    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('aaa\n1. bbb\n')
    expect(caretFromDom()).toBe(0)
    await assertDomMatchesSource(r)

    // 无序列表的首项也一样。这一段和下面的列表是两个块：非空的 `- ` 能打断段落，
    // 所以正文退成段落之后列表还在（这里断言的是 DOM 与源码在这条接缝上一致）。
    const ul = renderEditor('- aaa\n- bbb\n')
    await flush()
    await clickInRun(ul, 0, 0, 1, 'start')
    await flush()
    expect(caretFromDom()).toBe(2)
    await pressBackspace(ul)
    await flush()
    expect(ul.getDoc()).toBe('aaa\n- bbb\n')
    expect(caretFromDom()).toBe(0)
    await assertDomMatchesSource(ul)
  })

  it('无序项与任务项走同一条规则（标记宽度就是正文要落的列）', async () => {
    const ul = renderEditor('- aaa\n- bbb\n')
    await flush()
    await clickInRun(ul, 0, 1, 1, 'start')
    await flush()
    expect(caretFromDom()).toBe(8)
    await pressBackspace(ul)
    await flush()
    expect(ul.getDoc()).toBe('- aaa\n  bbb\n')
    expect(caretFromDom()).toBe(8)
    await assertDomMatchesSource(ul)

    // 再按一次：去掉缩进并并进上一行，接缝处同样不加空格（和 `1. ` 那条是同一条规则）。
    await pressBackspace(ul)
    await flush()
    expect(ul.getDoc()).toBe('- aaabbb\n')
    expect(caretFromDom()).toBe(5)
    await assertDomMatchesSource(ul)

    const task = renderEditor('- [ ] aaa\n- [ ] bbb\n')
    await flush()
    await clickInRun(task, 0, 1, 1, 'start')
    await flush()
    expect(caretFromDom()).toBe(16)
    await pressBackspace(task)
    await flush()
    // 复选框算在标记里，所以正文落在第 6 列，和上一项的正文对齐。
    expect(task.getDoc()).toBe('- [ ] aaa\n      bbb\n')
    expect(caretFromDom()).toBe(16)
    await assertDomMatchesSource(task)
  })

  it('引用行：正文开头 Backspace 退出引用，正文落在引用的内容列上', async () => {
    const r = renderEditor('> aaa\n> bbb\n')
    await flush()
    await clickInRun(r, 0, 1, 1, 'start')
    await flush()
    expect(caretFromDom()).toBe(8)
    await pressBackspace(r)
    await flush()
    // 引用里的续行在源码里本来就是裸行（lazy continuation），缩进对齐 `aaa`。
    expect(r.getDoc()).toBe('> aaa\n  bbb\n')
    expect(caretFromDom()).toBe(8)
    await assertDomMatchesSource(r)
  })

  it('嵌套项：正文开头 Backspace 退一级，正文还是列表项（T4）', async () => {
    const r = renderEditor('1. aaa\n   1. bbb\n')
    await flush()
    await clickInRun(r, 0, 1, 1, 'start')
    await flush()
    expect(caretFromDom()).toBe(13)
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('1. aaa\n2. bbb\n')
    expect(caretFromDom()).toBe(10) // 正文仍在 `bbb` 之前（退一级后它左移了 3 列）
    await assertDomMatchesSource(r)
  })

  it('围栏里的 `3. ccc` 是文本：新规则让开，只删掉那个空格', async () => {
    const r = renderEditor('```\n3. ccc\n```\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 3)
    await flush()
    expect(caretFromDom()).toBe(7)
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('```\n3.ccc\n```\n')
    await assertDomMatchesSource(r)
  })

  it('光标在正文中间时结构不动：那是普通的一次退格', async () => {
    const r = renderEditor('1. aaa\n2. ccc\n')
    await flush()
    await clickInRun(r, 0, 1, 1, 'middle')
    await flush()
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('1. aaa\n2. cc\n')
  })

  it('删掉一行里唯一的字符（真实按键）：光标留在那条空行上，不跳到结尾', async () => {
    const r = renderEditor('甲\nx\n乙\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    expect(caretFromDom()).toBe(3)

    await pressBackspace(r)
    await flush()
    // 文档对了：`x` 删掉，留下那条空行。光标也必须留在它的行首（偏移 2），
    // 而不是跟着浏览器跳到别处——用户实测：`甲\nx\n乙` 退格后变 `甲\n\n乙<cur>`，
    // 理想是 `甲\n<cur>\n乙`——空行不再渲染行盒，删掉字符后的光标吸附在上一段尾。
    expect(r.getDoc()).toBe('甲\n\n乙\n')
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(r)
  })

  it('浏览器把光标丢去别处也要掰回来：删除后的光标由差分决定，不采信 DOM 读数', async () => {
    const r = renderEditor('甲\nx\n乙\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    expect(caretFromDom()).toBe(3)

    // 模拟真实 Chrome 的退格行为：删掉 `x`（行被清空）之后，把光标丢到
    // 下一段末尾（实测就是 `乙<cur>`）。此时 DOM 源码已经是对的，只有光标错位。
    const xRun = r.runEl(0, 1, 0)!
    xRun.firstChild!.textContent = ''
    const yiRun = r.runEl(0, 2, 0)!
    placeCaretAt(yiRun.firstChild!, 1)
    r.container.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    r.container.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await flush()

    expect(r.getDoc()).toBe('甲\n\n乙\n')
    // 纯删除（差分里没有插入文本）：模型光标 = 被删文本的起点（偏移 2，空行）。
    // 空行不渲染行盒，DOM 视觉锚点吸附在上一段尾（偏移 1，十一审）。
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(r)
  })
})

/**
 * DOM ownership between kernels.
 *
 * `selectionchange` is a document-level event, so every mounted kernel sees it.
 * Without an ownership check the kernel treats any `[data-block]` as its own,
 * reads its own view against the other document's offsets, and then moves ITS
 * caret into the other editor. The app mounts one editor per page, so nothing
 * else exercises this on purpose.
 */
describe('内核只认自己的 DOM', () => {
  it('同页挂载两个编辑器时，一个内核不会把另一个的选区搬到自己这边', async () => {
    const first = renderEditor('# 甲\n\n乙\n')
    const second = renderEditor('# 丙\n\n丁\n')

    // 光标放进第二个编辑器的第二个块。
    const run = second.runEl(2, 0, 0)
    if (!run?.firstChild) throw new Error('second editor: run has no text node')
    placeCaretAt(run.firstChild, 0)
    await flush()

    // 选区留在被点击的那一个里。
    const range = window.getSelection()?.getRangeAt(0)
    expect(second.container.contains(range?.startContainer ?? null)).toBe(true)

    // 真正的判别式在第一个编辑器身上：它没被碰过，caret 仍是 0，所以它的块 0
    // 应该保持 reveal。没有这条守卫时它会误读对方的偏移（块 2 → 4），于是自己
    // 重渲染、块 0 折叠、块 2 显现——两个内核还会来回抢，最后谁后注册谁赢，
    // 所以只看选区在谁那里是分不出来的。
    const firstLine = first.container.querySelector('[data-block="0"] [data-vline="0"]')
    expect(firstLine?.classList.contains('revealed')).toBe(true)
  })
})

/**
 * 段落里的单换行（软换行）在屏幕上也换行——Typora 就是这么显示的。
 *
 * `soft-line-breaks/01` 一度反着做（把段内源码行并成一个视觉行，理由是导出
 * `breaks: false` 会把它折成一个空格）。对着 Typora 实测是错的：`axb` 里在 a、b
 * 之间回车，Typora 是 `a\nb` 两行，编辑器并成一行 `a b`；而且空行那条路还得靠
 * "打字时补空行"去兜（`blank-line-typing/01`）。源码一行＝屏幕一行，打字只插一个
 * 字符，两条都简单了。导出没变：Markdown 里段内单换行就是一个空格。
 */
describe('段落里的软换行也是换行', () => {
  it('一个段落写成两行源码，屏幕上是两行（各占一行，不并排）', async () => {
    const r = renderEditor('alpha beta\ngamma delta\n')
    await flush()

    const first = r.blockEl(0)!.querySelector('[data-vline="0"]') as HTMLElement
    const second = r.blockEl(0)!.querySelector('[data-vline="1"]') as HTMLElement

    // 两行各自一个视觉行：top 不同，且各是块级。
    expect(Math.round(second.getBoundingClientRect().top)).not.toBe(
      Math.round(first.getBoundingClientRect().top),
    )
    expect(getComputedStyle(first).display).toBe('block')
    expect(getComputedStyle(second).display).toBe('block')
    // 行盒仍然是一源码行一个（光标算术按源码行建索引）。
    expect(r.blockEl(0)!.querySelectorAll('[data-vline]')).toHaveLength(2)
    await assertDomMatchesSource(r)
  })

  it('软换行两侧都能落光标，且编辑后源码里的换行还在', async () => {
    const r = renderEditor('alpha beta\ngamma delta\n')
    await flush()

    // 软换行之前（第一行行尾）
    await clickInRun(r, 0, 0, 0, 'end')
    expect(caretFromDom()).toBe(10)
    await r.user.keyboard('X')
    await flush()
    // 关键：软换行不是"可以丢掉的排版"——它必须原样回到源码里。
    expect(r.getDoc()).toBe('alpha betaX\ngamma delta\n')
    await assertDomMatchesSource(r)

    // 软换行之后（第二行内部）。第二行起始于 12（`alpha betaX` 11 字 + 换行），
    // 11 字的 run 取 middle = 6，所以落在 18。
    await clickInRun(r, 0, 1, 0, 'middle')
    expect(caretFromDom()).toBe(18)
    await r.user.keyboard('Y')
    await flush()
    expect(r.getDoc()).toBe('alpha betaX\ngamma Ydelta\n')
    await assertDomMatchesSource(r)
  })

  it('列表项的续行：缩进是容器缩进，光标在块外时折叠掉', async () => {
    const r = renderEditor('- a\n  b\n\nzz\n')
    await flush()
    // 块级标记只在光标位于块内时显现，所以先把光标放到别的块里。
    const elsewhere = [...r.container.querySelectorAll<HTMLElement>('[data-run]')].find(
      (el) => el.textContent === 'zz',
    )
    if (!elsewhere?.firstChild) throw new Error('the zz block has no text node')
    placeCaretAt(elsewhere.firstChild, 0)
    await flush()

    const continuation = r.blockEl(0)!.querySelector('[data-vline="1"]') as HTMLElement
    const runs = [...continuation.querySelectorAll<HTMLElement>('[data-run]')]
    // 续行的两格缩进折叠成 marker run，可见文本从 `b` 开始（不跑到行中间）。
    expect(runs[0].textContent).toBe('  ')
    expect(getComputedStyle(runs[0]).display).toBe('none')
    expect(runs[1].textContent).toBe('b')
    await assertDomMatchesSource(r)
  })
})

/**
 * 空行上打字：源码只多这一个字符（`.scratch/blank-line-typing/issues/01`）。
 *
 * 空行是两段之间的**分隔**：写满它，Markdown 就把这一行读成邻居的软换行续行。以前
 * 段内单换行在屏幕上是并排显示的，所以那一步看起来像"两段粘成一行"；现在源码一行＝
 * 屏幕一行（见 `段落里的软换行也是换行`），字符落在光标那一行就够了——不需要补空行，
 * 也不需要改任何结构。每条用例因此同时钉**源码只多一个字符**和**屏幕上行行分明**。
 */
describe('空行上打字只插一个字符', () => {
  /** 非空行的 (文本, y)：各自一个 y 才叫行行分明。 */
  const contentRows = (r: Rendering) => {
    const content = [...r.container.querySelectorAll<HTMLElement>('[data-vline]')]
      .map((el) => ({ text: el.textContent ?? '', top: Math.round(el.getBoundingClientRect().top) }))
      .filter((row) => row.text !== '')
    return { texts: content.map((row) => row.text), tops: new Set(content.map((row) => row.top)) }
  }


  it('回车之后打字：源码 `甲\n\nx`——Enter 开出的空行是新段占位', async () => {
    const r = renderEditor('甲')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // 行尾 Enter = 硬换行（块级）：段尾开一个空块，光标落在它的占位空行上。
    expect(r.getDoc()).toBe('甲\n')
    expect(caretFromDom()).toBe(2)

    await r.user.keyboard('x')
    await flush()
    // Enter 开出的空行是新段占位：打字 = 新段落的内容（不是软换行续段）。
    expect(r.getDoc()).toBe('甲\n\nx')
    expect(contentRows(r).texts).toEqual(['甲', 'x'])
    expect(contentRows(r).tops.size).toBe(2)
    await assertDomMatchesSource(r)
  })

  it('软换行段中间行行尾 Enter：段落在此断开，下方行成为新段', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    // 光标在「甲」行尾（软换行段的第一行）。
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // Enter 是硬换行：`甲\n乙` 拆成 `甲` / 空行 / `乙`（块级拆块）。
    expect(r.getDoc()).toBe('甲\n\n乙\n')
    // 光标落在右段（乙）段首：中间空白块不渲染行盒，caret 只能停在有行盒的位置
    // （`paragraph-spacing/01` 十一审）。
    expect(caretFromDom()).toBe(3)

    await r.user.keyboard('x')
    await flush()
    // 打字续进右段（光标落在乙首——中间空白块无行盒，`paragraph-spacing/01` 十一审）。
    expect(r.getDoc()).toBe('甲\n\nx乙\n')
    expect(contentRows(r).texts).toEqual(['甲', 'x乙'])
    expect(contentRows(r).tops.size).toBe(2)
    await assertDomMatchesSource(r)
  })

  it('软换行段最后一行行尾 Enter + 打字：新段接在段后', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // 段尾 Enter = 硬换行：段后开一个空块。
    expect(r.getDoc()).toBe('甲\n乙\n\n')
    expect(caretFromDom()).toBe(4)

    await r.user.keyboard('x')
    await flush()
    // 打字 = 新段落：甲段（两行软换行）+ x 段。
    expect(r.getDoc()).toBe('甲\n乙\n\nx\n')
    expect(contentRows(r).texts).toEqual(['甲', '乙', 'x'])
    expect(contentRows(r).tops.size).toBe(3)
    await assertDomMatchesSource(r)
  })

  it('行尾回车再打字：字符自成一段（段落间距不随输入消失）', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // 行尾 Enter = 硬换行：块后开新空块（源里多一个空行）；中间空白块不渲染，
    // 光标吸附在段尾（`paragraph-spacing/01` 十一审），下一次键入经 Enter 标记
    // 归位成新段落。
    expect(r.getDoc()).toBe('甲\n\n\n乙\n')
    expect(caretFromDom()).toBe(1)

    await r.user.keyboard('x')
    await flush()
    // Enter 开出的空行（后一行仍是空）是新段占位：补充前空行边界成独立段，
    // 段落间距不随输入消失（`paragraph-spacing/01` A 方案的保留部分）。
    expect(r.getDoc()).toBe('甲\n\nx\n\n乙\n')
    expect(contentRows(r).texts).toEqual(['甲', 'x', '乙'])
    expect(contentRows(r).tops.size).toBe(3)
    await assertDomMatchesSource(r)
  })


  it('围栏里的空行是代码：字符留在原处，围栏不受影响', async () => {
    const r = renderEditor('```\na\n\nb\n```\n')
    await flush()
    // 围栏块自己收着里面的每一行，空行是 vline 2。
    await clickAtLine(r, 0, 2)
    await flush()
    await r.user.keyboard('x')
    await flush()
    expect(r.getDoc()).toBe('```\na\nx\nb\n```\n')
    await assertDomMatchesSource(r)
  })

  it('一次撤销只收走这一个字符（Enter 占位上的键入）', async () => {
    const r = renderEditor('甲')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    await r.user.keyboard('x')
    await flush()
    expect(r.getDoc()).toBe('甲\n\nx')

    await pressUndo(r)
    await flush()
    // 一次键入 = 一步撤销：回到 Enter 后、打字前的状态。
    expect(r.getDoc()).toBe('甲\n')
    await assertDomMatchesSource(r)
  })

  it('IME：合成期间 DOM 不动，提交后字符落在光标那一行', async () => {
    // 合成期间的 DOM 一个节点都不能换（既有不变量），所以字符落点由提交那一次
    // `input` 决定——模型与 DOM 都是"原地插一个字符"，没有别的结构改动。
    const r = renderEditor('甲乙\n\n丙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    // 光标在「甲乙」行尾：合成把拼音作为裸文本追加进行盒（空行不渲染行盒，
    // 合成点直接落在段内文本之后，`paragraph-spacing/01` 十一审）。
    const line = r.container.querySelector('[data-block="0"] [data-vline="0"]') as HTMLElement

    line.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const composing = document.createTextNode('x')
    line.appendChild(composing)
    line.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    line.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'x' }))
    await flush()
    expect(line.isConnected).toBe(true)
    expect(line.lastChild).toBe(composing)
    expect(r.getDoc()).toBe('甲乙x\n\n丙\n')

    composing.textContent = '写'
    line.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    line.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }))
    line.dispatchEvent(new InputEvent('input', { bubbles: true, data: '写' }))
    await flush()
    expect(r.getDoc()).toBe('甲乙写\n\n丙\n')
    const texts = [...r.container.querySelectorAll<HTMLElement>('[data-vline]')]
      .filter((el) => (el.textContent ?? '') !== '')
      .map((el) => el.textContent)
    expect(texts).toEqual(['甲乙写', '丙'])
    await assertDomMatchesSource(r)
  })
})

/**
 * Enter / Shift+Enter 的语义判据来自用户对 Typora 的实测（`enter-backspace-smoke/01、02`）：
 * **Enter 是硬换行、Shift+Enter 是软换行，换行距离前者大、后者小**（九审恢复——
 * 任何位置 Enter 都是硬换行；块级表达 = 创建新块，`enter-backspace-smoke/10` 九审）。
 * 源码表达：Enter 拆段/开新段（段落边界 = 空行），Shift+Enter 在块内插一个
 * `\n`（软换行，渲染为行尾 `<br>`）。
 */
describe('Enter 硬换行 / Shift+Enter 软换行', () => {
  it('软换行在同一块内渲染为行尾 <br>（Typora DOM 结构，不拆块）', async () => {
    const r = renderEditor('甲\n乙\n')
    await flush()
    // 一个块、两个行盒——软换行不产生块边界。
    const rows = r.container.querySelectorAll('[data-block="0"] [data-vline]')
    expect(rows.length).toBe(2)
    // 第一行行尾挂着 <br data-br="">（下一行是本段的续行）。
    const first = rows[0]
    expect(first?.querySelector('br[data-br]')).not.toBeNull()
    // 最后一行（段尾）没有 <br>。
    const last = rows[1]
    expect(last?.querySelector('br[data-br]')).toBeNull()
    // 行盒结构：run 在后、br 在后（用户给的 Typora 形状）。
    expect(first!.querySelector('br[data-br]')?.previousElementSibling?.hasAttribute('data-run')).toBe(true)
    await assertDomMatchesSource(r)
  })

  it('标题行尾 Enter：也是创建新块（块级），打字即成新段落', async () => {
    const r = renderEditor('# 标题\n')
    await flush()
    // run 0 是 `# ` 标记，行尾 = run 1 的末尾。
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // 标题后开一个空块（硬换行 = 创建新块，标题同样走块级 Enter）。
    expect(r.getDoc()).toBe('# 标题\n\n')

    await r.user.keyboard('x')
    await flush()
    // 打字 = 新段落（普通文本，不是新标题）。
    expect(r.getDoc()).toBe('# 标题\n\nx\n')
    const texts = [...r.container.querySelectorAll<HTMLElement>('[data-vline]')]
      .filter((el) => (el.textContent ?? '') !== '')
      .map((el) => el.textContent)
    expect(texts).toEqual(['# 标题', 'x'])
    await assertDomMatchesSource(r)
  })

  it('硬换行拆出的段没有行尾 <br>；空行分隔的两段行盒干净', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    r.container.querySelectorAll<HTMLElement>('[data-vline]').forEach((row) => {
      // 行尾不应有软换行标记：空行本身的 <br data-br="">（第一段桶）除外
      const br = row.querySelector('br[data-br]')
      const isBlankRow = row.classList.contains('vl-blank')
      expect(br === null || isBlankRow).toBe(true)
    })
    await assertDomMatchesSource(r)
  })

  it('围栏代码行之间没有软换行 <br>', async () => {
    const r = renderEditor('```\na\nb\n```\n')
    await flush()
    const rows = r.container.querySelectorAll('[data-block="0"] [data-vline]')
    rows.forEach((row) => {
      expect(row.querySelector('br[data-br]')).toBeNull()
    })
    await assertDomMatchesSource(r)
  })
  it('段落中间 Enter：源码插入一个空行，把段落拆成两段', async () => {
    const r = renderEditor('甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'middle')
    await flush()
    const caret = caretFromDom() ?? -1
    expect(caret).toBe(1) // 甲|乙
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n乙\n')
    // 光标在新的后一段行首（`甲\n\n` 之后 = 偏移 3）。
    expect(caretFromDom()).toBe(caret + 2)
    const tops = [...r.container.querySelectorAll<HTMLElement>('[data-vline]')]
      .filter((el) => (el.textContent ?? '') !== '')
      .map((el) => Math.round(el.getBoundingClientRect().top))
    expect(new Set(tops).size).toBe(2)
    await assertDomMatchesSource(r)
  })

  it('句中 Enter 后一次 Backspace：撤销拆段，回到拆段前（一次回车配一次退格）', async () => {
    const r = renderEditor('甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'middle')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n乙\n')
    expect(caretFromDom()).toBe(3) // 右段 `乙` 行首
    await pressBackspace(r)
    await flush()
    // 一次退格 = 撤销拆段：`甲\n\n乙` → `甲乙`，光标落在拆分点（甲|乙）。
    // 旧实现把拆段当普通行首 join，第一次只并成软换行 `甲\n乙`、第二次才
    // `甲乙`（用户实测；与 12 号票的尾占位同一族）。
    expect(r.getDoc()).toBe('甲乙\n')
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(r)
  })

  it('句中 Enter 后直接在右段行首打字：字符留在右段（Enter 标记不劫持写入）', async () => {
    const r = renderEditor('甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'middle')
    await flush()
    await pressEnter(r)
    await flush()
    await r.user.keyboard('x')
    await flush()
    // x 落在光标 = 右段行首（Enter 标记的 re-home 只服务空白占位；
    // 内容占位的插入行本来就不是空行，段落化会拒绝它）。
    expect(r.getDoc()).toBe('甲\n\nx乙\n')
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('软换行段第一行句中 Enter 后一次 Backspace：同样撤销拆段', async () => {
    const s = renderEditor('甲乙\n丙\n')
    await flush()
    await clickInRun(s, 0, 0, 0, 'middle')
    await flush()
    await pressEnter(s)
    await flush()
    // raw 含 \n 的段不拆块命令——字符串 fallback 插同样的 `\n\n`，标记同设。
    expect(s.getDoc()).toBe('甲\n\n乙\n丙\n')
    expect(caretFromDom()).toBe(3)
    await pressBackspace(s)
    await flush()
    expect(s.getDoc()).toBe('甲乙\n丙\n')
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(s)
  })

  it('标题句中 Enter 后一次 Backspace：撤销拆段', async () => {
    const r = renderEditor('# 甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'middle')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('# 甲\n\n乙\n')
    expect(caretFromDom()).toBe(5)
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('# 甲乙\n')
    expect(caretFromDom()).toBe(3)
    await assertDomMatchesSource(r)
  })

  it('句尾 Shift+Enter 再打字：软换行留在块内（`甲\nx` 一段），光标在新行', async () => {
    const r = renderEditor('甲')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n')
    // 光标在新行（尾空行 <br>），不被吸回上一行末尾——旧实现会把下一键
    // 并回上一行（`甲x`），Shift+Enter 的软换行被吞掉（用户实测）。
    expect(caretFromDom()).toBe(2)
    await r.user.keyboard('乙')
    await flush()
    // 软占位 = 块的续行：乙 续进甲块，源保持单 \n（Typora 软换行语义）。
    expect(r.getDoc()).toBe('甲\n乙')
    expect(caretFromDom()).toBe(3)
    await assertDomMatchesSource(r)
  })

  it('句尾 Shift+Enter 后一次 Backspace：撤销软换行，回到上一行尾', async () => {
    const s = renderEditor('甲')
    await flush()
    await clickInRun(s, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(s)
    await flush()
    expect(s.getDoc()).toBe('甲\n')
    expect(caretFromDom()).toBe(2)
    await pressBackspace(s)
    await flush()
    expect(s.getDoc()).toBe('甲')
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(s)
  })

  it('段尾 Shift+Enter（后还有段落）再打字：新行属于本块，源 `甲\nx\n\n乙`', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n\n乙\n')
    // 中间软占位（无行盒）：光标吸附在段尾。
    expect(caretFromDom()).toBe(1)
    await r.user.keyboard('x')
    await flush()
    // x 被 re-home 进 Shift+Enter 的新行：`甲\nx` 一段 + 空行 + 乙。
    expect(r.getDoc()).toBe('甲\nx\n\n乙\n')
    expect(caretFromDom()).toBe(3)
    await assertDomMatchesSource(r)
  })

  it('连续句尾 Shift+Enter：每个新行都是软换行（`甲\nx\ny` 一段）', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    await r.user.keyboard('x')
    await flush()
    await pressShiftEnter(r)
    await flush()
    await r.user.keyboard('y')
    await flush()
    expect(r.getDoc()).toBe('甲\nx\ny\n\n乙\n')
    expect(caretFromDom()).toBe(5)
    await assertDomMatchesSource(r)
  })

  it('句首 Enter：上方开空行，光标留在本行行首，Backspace 一次还原', async () => {
    const r = renderEditor('甲乙')
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    expect(caretFromDom()).toBe(0)
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('\n甲乙')
    expect(caretFromDom()).toBe(1)
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('甲乙')
    expect(caretFromDom()).toBe(0)
    await assertDomMatchesSource(r)
  })

  it('空行上 Enter：多开一个空行，光标在新的空行；直接打字成新段', async () => {
    const r = renderEditor('甲')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n')
    await pressEnter(r)
    await flush()
    // 尾空行上 Enter：空行块多一行，光标在新空行（偏移 3）。
    expect(r.getDoc()).toBe('甲\n\n')
    expect(caretFromDom()).toBe(3)
    await r.user.keyboard('x')
    await flush()
    // 空行打字 = 新段（Enter 占位语义，段落化生效）。
    expect(r.getDoc()).toBe('甲\n\nx')
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('空行上 Shift+Enter 同 Enter：空行加一行，打字仍是新段（不续行）', async () => {
    const r = renderEditor('甲')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n')
    expect(caretFromDom()).toBe(3)
    await r.user.keyboard('x')
    await flush()
    expect(r.getDoc()).toBe('甲\n\nx')
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('IME 组合输入落在 Enter 占位：仍是新段落（`啊` Enter `啊` = 两段）', async () => {
    // 组合进行中的每次 input 都会使 handleInput 的 composing 分支把 DOM 直接吸收
    // 成模型——吸收绕过段落化，提交后 DOM 又与模型一致，段落化永远没有机会，
    // `啊` + Enter + `啊`（输入法打的第二个字）变成一段软换行（用户实测）。
    // 占位旁的组合输入现在跳过中期吸收，由 compositionend 的提交走正常段落化。
    const r = renderEditor('啊')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('啊\n')
    // 光标在尾占位空行；组合输入"啊"（含组合中期的输入事件）。
    const blank = r.container.querySelector('.vl-blank')
    if (!blank) throw new Error('没有占位空行')
    placeCaretAt(blank, 0)
    await flush()
    const tn = document.createTextNode('啊')
    blank.insertBefore(tn, blank.firstChild)
    blank.dispatchEvent(
      new InputEvent('beforeinput', { data: '啊', inputType: 'insertCompositionText', bubbles: true, cancelable: true, composed: true }),
    )
    blank.dispatchEvent(
      new InputEvent('input', { data: '啊', inputType: 'insertCompositionText', bubbles: true, composed: true }),
    )
    blank.dispatchEvent(new CompositionEvent('compositionend', { data: '啊', bubbles: true, cancelable: true }))
    blank.dispatchEvent(
      new InputEvent('beforeinput', { data: '啊', inputType: 'insertCompositionText', bubbles: true, cancelable: true, composed: true }),
    )
    blank.dispatchEvent(
      new InputEvent('input', { data: '啊', inputType: 'insertCompositionText', bubbles: true, composed: true }),
    )
    await flush()
    // Enter 的占位打字 = 新段落，不是软换行。
    expect(r.getDoc()).toBe('啊\n\n啊')
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('IME 组合输入落在 Shift+Enter 占位：仍是软换行续行（一段）', async () => {
    const s = renderEditor('甲')
    await flush()
    await clickInRun(s, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(s)
    await flush()
    expect(s.getDoc()).toBe('甲\n')
    const blank = s.container.querySelector('.vl-blank')
    if (!blank) throw new Error('没有占位空行')
    placeCaretAt(blank, 0)
    await flush()
    const tn = document.createTextNode('乙')
    blank.insertBefore(tn, blank.firstChild)
    blank.dispatchEvent(
      new InputEvent('beforeinput', { data: '乙', inputType: 'insertCompositionText', bubbles: true, cancelable: true, composed: true }),
    )
    blank.dispatchEvent(
      new InputEvent('input', { data: '乙', inputType: 'insertCompositionText', bubbles: true, composed: true }),
    )
    blank.dispatchEvent(new CompositionEvent('compositionend', { data: '乙', bubbles: true, cancelable: true }))
    blank.dispatchEvent(
      new InputEvent('beforeinput', { data: '乙', inputType: 'insertCompositionText', bubbles: true, cancelable: true, composed: true }),
    )
    blank.dispatchEvent(
      new InputEvent('input', { data: '乙', inputType: 'insertCompositionText', bubbles: true, composed: true }),
    )
    await flush()
    // Shift+Enter 的占位打字 = 软续行（同块 `甲\n乙`），不被段落化。
    expect(s.getDoc()).toBe('甲\n乙')
    expect(caretFromDom()).toBe(3)
    await assertDomMatchesSource(s)
  })

  it('IME 一次上屏多字符落在 Enter 占位：仍是新段落（`啊` Enter 「你好」= 两段）', async () => {
    // 吸收穿透不止单字符：输入法可以一次提交多个字符（delta > 1），
    // 原 skip 条件（single char）挡不住，`啊` + Enter + 「你好」再次变
    // 成一段软换行（实测）。skip 条件现在按"插入行是空行/占位旁"判定，
    // 与 commit 的段落化判据一致。
    const r = renderEditor('啊')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('啊\n')
    const blank = r.container.querySelector('.vl-blank')
    if (!blank) throw new Error('没有占位空行')
    placeCaretAt(blank, 0)
    await flush()
    // 真实 IME 先开组合；组合文本插入后光标在文本之后。
    blank.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const tn = document.createTextNode('你好')
    blank.insertBefore(tn, blank.firstChild)
    placeCaretAt(tn, 2)
    await flush()
    blank.dispatchEvent(
      new InputEvent('beforeinput', { data: '你好', inputType: 'insertCompositionText', bubbles: true, cancelable: true, composed: true }),
    )
    blank.dispatchEvent(
      new InputEvent('input', { data: '你好', inputType: 'insertCompositionText', bubbles: true, composed: true }),
    )
    blank.dispatchEvent(new CompositionEvent('compositionend', { data: '你好', bubbles: true, cancelable: true }))
    blank.dispatchEvent(
      new InputEvent('beforeinput', { data: '你好', inputType: 'insertCompositionText', bubbles: true, cancelable: true, composed: true }),
    )
    blank.dispatchEvent(
      new InputEvent('input', { data: '你好', inputType: 'insertCompositionText', bubbles: true, composed: true }),
    )
    await flush()
    expect(r.getDoc()).toBe('啊\n\n你好')
    expect(caretFromDom()).toBe(5)
    await assertDomMatchesSource(r)
  })

  it('行尾 Enter 与 Shift+Enter 同款：都只插一个换行（距离差只在段中）', async () => {
    const r = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n\n乙\n')
    // Enter 开的新空块是中间空白（不渲染行盒），光标吸附在段尾（十一审）。
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(r)

    // 同一位置走 Shift+Enter：源同样多一个换行（结果相同），但那是块内的
    // 软换行插值而非新块占位；光标同样吸附在段尾。
    const s = renderEditor('甲\n\n乙\n')
    await flush()
    await clickInRun(s, 0, 0, 0, 'end')
    await flush()
    await pressShiftEnter(s)
    await flush()
    expect(s.getDoc()).toBe('甲\n\n\n乙\n')
    expect(caretFromDom()).toBe(1)
    await assertDomMatchesSource(s)
  })

  it('代码块内 Enter 仍是普通换行（围栏里没有段落可拆）', async () => {
    const r = renderEditor('```\n甲乙\n```\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'middle')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('```\n甲\n乙\n```\n')
    await assertDomMatchesSource(r)
  })

  it('带尾换行的文末行尾 Enter 再打字：Enter 是新段，x 不与上一行并段', async () => {
    const r = renderEditor('甲\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // 行尾已有 \n 可借：Enter 借它开空块（共两个 \n）、光标在占位空行（偏移 2）。
    expect(r.getDoc()).toBe('甲\n\n')
    expect(caretFromDom()).toBe(2)
    await r.user.keyboard('x')
    await flush()
    // Enter 开出的占位空行 = 新段：x 独立成段（前空行在，尾部不留多余空行）。
    expect(r.getDoc()).toBe('甲\n\nx\n')
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('文末行尾 Enter 后一次 Backspace：回到 Enter 前（尾占位空行一次退格就删）', async () => {
    // 无尾换行的文档末尾回车：Enter 开出的是文档**最后**的占位空行（渲染为
    // 自己的 <br> 行）。placeholder 位置 = doc 末尾，旧实现按 `at + 1` 截掉
    // 一个不存在的字符，第一次 Backspace 空转、第二次才 join（用户实测；
    // 复现路径：`A\n` + 光标在 br 行）——现在一次退格删的就是 placeholder
    // 前面的换行，一次回车配一次退格，原样还原。
    const r = renderEditor('甲')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n')
    expect(caretFromDom()).toBe(2) // 光标在渲染出来的空行 <br> 上
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('甲')
    expect(caretFromDom()).toBe(1) // 落在段尾（= 回车前的偏移）
    await assertDomMatchesSource(r)
  })

  it('行尾 Enter 后立即打字、光标滞留在占位行起点：仍是新段落（不并成软换行）', async () => {
    // 某些输入法在组合输入提交的瞬间，DOM 光标还停在占位行盒的起点（<br> 前）
    // 而不是已提交文本之后。旧实现从光标反推插入点，把占位前的换行当成字符
    // 搬进占位，段落化又拒绝"光标行已空白"的补丁，结果整个键被原样吸收成
    // 块内软换行（`甲\nx` 一个块两行）——用户实测：句尾 Enter 后打任意字符
    // 变成了一个块。字符现在取自 diff 的插入点（sharedPrefix），与光标读法
    // 无关，照样段落化成新块。
    const r = renderEditor('甲\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n')
    const blank = r.container.querySelector('.vl-blank')
    if (!blank) throw new Error('没有占位空行')
    placeCaretAt(blank, 0) // 光标停在 <br> 前 = 占位行盒的起点
    await flush()
    const tn = document.createTextNode('x')
    blank.insertBefore(tn, blank.firstChild)
    blank.dispatchEvent(
      new InputEvent('beforeinput', { data: 'x', inputType: 'insertText', bubbles: true, cancelable: true }),
    )
    blank.dispatchEvent(
      new InputEvent('input', { data: 'x', inputType: 'insertText', bubbles: true, composed: true }),
    )
    await flush()
    expect(r.getDoc()).toBe('甲\n\nx\n')
    expect(caretFromDom()).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('表格行上 Enter 是 no-op，行语法保持（不再插裸换行）', async () => {
    const r = renderEditor('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    await clickInRun(r, 0, 2, 0, 'start')
    await flush()
    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    // 表格行没有段落可拆，这个编辑器也没有单元格内换行的表达：Enter 在行内
    // 是 no-op，绝不出 `\n\n`，也绝不在行中间留裸 `\n`（enter-backspace-smoke/06）。
    expect(doc).not.toContain('\n\n')
    expect(doc).toBe('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n')
    expect(doc.split('\n').length).toBe(4) // 行数不变
    await assertDomMatchesSource(r)
  })

  it('表格分隔行上 Enter 不插入段落边界，也不动规则行', async () => {
    const r = renderEditor('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'start')
    await flush()
    await pressEnter(r)
    await flush()
    // 分隔行不可见且不能容纳软换行：Enter 是 no-op，源码一字不动。
    expect(r.getDoc()).toBe('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n')
    await assertDomMatchesSource(r)
  })
})

/**
 * 元素（标题/列表/引用/围栏）内的 Enter / Shift+Enter 行为矩阵：
 * 全部按各自结构语义走——列表/引用抄 marker 续行、空项退出、围栏普通换行、
 * 标题硬软换行各有归处，光标不漂移、不吞键（浏览器逐项实测后固化）。
 */
describe('元素内 Enter / Shift+Enter（标题/列表/引用/围栏矩阵）', () => {
  it('列表行尾 Enter：新项抄 marker；打字落在新项', async () => {
    const r = renderEditor('- 甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    // 列表项不拆段：新行复刻 `- `，光标在新项内容位。
    expect(r.getDoc()).toBe('- 甲乙\n- \n')
    expect(caretFromDom()).toBe(7)
    await r.user.keyboard('丙')
    await flush()
    expect(r.getDoc()).toBe('- 甲乙\n- 丙\n')
    await assertDomMatchesSource(r)
  })

  it('列表句中 Enter：拆成两个项，各自保留 marker', async () => {
    const r = renderEditor('- 甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'middle')
    await flush()
    expect(caretFromDom()).toBe(3) // 甲|乙
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('- 甲\n- 乙\n')
    expect(caretFromDom()).toBe(6) // `- 乙` 内容前
    await assertDomMatchesSource(r)
  })

  it('列表句首 Enter：上方插一个空项，光标留原行', async () => {
    const r = renderEditor('- 甲\n- 乙\n')
    await flush()
    await clickInRun(r, 0, 1, 1, 'start')
    await flush()
    expect(caretFromDom()).toBe(6) // `- 乙` 内容前
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('- 甲\n- \n- 乙\n')
    expect(caretFromDom()).toBe(9) // 光标仍在 `- 乙` 内容前
    await assertDomMatchesSource(r)
  })

  it('任务项行尾 Enter：新项带 checkbox', async () => {
    const r = renderEditor('- [ ] 甲\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('- [ ] 甲\n- [ ] \n')
    await assertDomMatchesSource(r)
  })

  it('嵌套项行尾 Enter：缩进和 marker 一起抄', async () => {
    const r = renderEditor('- 甲\n  - 乙\n')
    await flush()
    await clickInRun(r, 0, 1, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('- 甲\n  - 乙\n  - \n')
    await assertDomMatchesSource(r)
  })

  it('引用行尾 Enter：新行抄 `> `；句中 Enter 拆行也抄', async () => {
    const r = renderEditor('> 甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'middle')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('> 甲\n> 乙\n')
    expect(caretFromDom()).toBe(6) // `> 乙` 内容前
    await clickInRun(r, 0, 1, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('> 甲\n> 乙\n> \n')
    await assertDomMatchesSource(r)
  })

  it('引用内 Shift+Enter：软换行与段落同构——新行仍带 `> `，打字续行并渲染 <br>', async () => {
    // Typora 裁定：引用除样式外交互与普通段落相同——行尾软换行的下一行
    // 仍是引用行（marker 不丢）。旧实现插裸 \n，下一行被甩出引用。
    const r = renderEditor('> 甲乙\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('> 甲乙\n> \n')
    expect(caretFromDom()).toBe(7) // `> ` 后 = 新行内容位
    await r.user.keyboard('丙')
    await flush()
    expect(r.getDoc()).toBe('> 甲乙\n> 丙\n')
    // 渲染与普通段落的软换行同构：第一行行尾有 <br data-br="">。
    const rows = r.container.querySelectorAll('[data-block="0"] [data-vline]')
    expect(rows[0]?.querySelector('br[data-br]')).not.toBeNull()
    await assertDomMatchesSource(r)
  })

  it('引用内连续两次 Enter 退出引用；退出后打字是普通段落', async () => {
    const r = renderEditor('> 甲\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    // 第一次 Enter：空引用行（仍在引用内）。
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('> 甲\n> \n')
    // 第二次 Enter：退出引用——空行分隔、光标在引用外的普通行。
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('> 甲\n\n')
    await r.user.keyboard('乙')
    await flush()
    expect(r.getDoc()).toBe('> 甲\n\n乙')
    await assertDomMatchesSource(r)
  })

  it('嵌套引用行尾 Shift+Enter：`> > ` 一并抄', async () => {
    const r = renderEditor('> > 甲\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('> > 甲\n> > \n')
    await assertDomMatchesSource(r)
  })

  it('引用嵌套列表行尾 Enter：`> - ` 一并抄', async () => {
    const r = renderEditor('> - 甲\n')
    await flush()
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('> - 甲\n> - \n')
    await assertDomMatchesSource(r)
  })

  it('标题句中 Shift+Enter：标题结束，后续是普通文本行', async () => {
    const r = renderEditor('# 甲乙')
    await flush()
    await clickInRun(r, 0, 0, 1, 'middle')
    await flush()
    await pressShiftEnter(r)
    await flush()
    // 标题没有软续行（markdown 语义）：`# 甲` 之后是普通行 `乙`。
    expect(r.getDoc()).toBe('# 甲\n乙')
    await assertDomMatchesSource(r)
  })

  it('标题句首 Enter：上方开空行，光标留标题行首', async () => {
    const r = renderEditor('# 甲乙')
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('\n# 甲乙')
    await assertDomMatchesSource(r)
  })

  it('围栏代码行行尾 Shift+Enter + Backspace：只插换行、一次撤销，代码无损', async () => {
    const r = renderEditor('```\ncode\n```\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('```\ncode\n\n```\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('```\ncode\n```\n')
    await assertDomMatchesSource(r)
  })
})

/**
 * `enter-backspace-smoke/06`：表格单元格内 Enter 绝不破坏表格行。这个编辑器没有
 * 单元格内换行的表达（内联 HTML 一律按文本渲染、表格一行 = 一条源码行），所以
 * Enter / Shift+Enter 在行内是 no-op —— 源码一字不动，选中的「至少不允许破坏
 * 表格行的语法结构」。决策记录在票的 Comments 里。
 */
describe('表格单元格内 Enter：不破坏表格（enter-backspace-smoke/06）', () => {
  const TABLE = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n'

  it('单元格末尾 Enter：源码一字不动，光标原地', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 0, 'end')
    await flush()
    // 光标在 `1` 之后（源码偏移 26 + 1），图钉此刻的位置。
    expect(caretFromDom()).toBe(27)
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe(TABLE)
    expect(caretFromDom()).toBe(27)
    await r.user.keyboard('x')
    await flush()
    // 打字仍然落在同一个单元格里：表格一行未曾被拆散。
    expect(r.getDoc()).toBe('| 甲 | 乙 |\n| --- | --- |\n| 1x | 2 |\n')
    await assertDomMatchesSource(r)
  })

  it('单元格中间 Enter 同样 no-op，表格行不拆散', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 0, 1, 'middle')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe(TABLE)
    expect(r.getDoc().split('\n').length).toBe(4)
    await assertDomMatchesSource(r)
  })

  it('单元格内 Shift+Enter 同样 no-op，不落裸换行', async () => {
    const r = renderEditor(TABLE)
    await flush()
    await clickInRun(r, 0, 2, 0, 'end')
    await flush()
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe(TABLE)
    await assertDomMatchesSource(r)
  })
})

/**
 * `enter-backspace-smoke/07`：Cmd+Down / Ctrl+End 必须把光标移到文档末尾。
 * Chromium 对 contenteditable 里这些「跳到文档边缘」的键没有默认光标动作（实测
 * 普通 contenteditable 同样不动），所以跳转由内核接管；这两个键在 shell 的
 * 快捷键表里也没有绑定。两条用例：合成 Ctrl+End（userEvent 按不了 {End}，
 * 见票面）；真实按键 Cmd+ArrowDown→Cmd+ArrowUp 往返，再补合成 Ctrl+End/Home。
 */
describe('Cmd+Down / Ctrl+End 跳到文档末尾（enter-backspace-smoke/07）', () => {
  const DOC = '第一行\n\n第二行\n\n第三行\n'

  it('Ctrl+End 把光标移到文档末尾', async () => {
    const r = renderEditor(DOC)
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    expect(caretFromDom()).toBe(0)
    // userEvent 按不了 {End}（“Not implemented”，见 enter-backspace-smoke/07），
    // 这里合成一个真实形状的 keydown：内核读的是 event.key / ctrlKey，
    // 与真实按键走同一条 handleKeyDown。
    const event = new KeyboardEvent('keydown', {
      key: 'End',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    r.container.dispatchEvent(event)
    await flush()
    // 文档末尾：尾空行不渲染行盒，视觉锚点 = 最后一行文本末尾（= doc.length - 1，
    // 十一审）。打字仍在文末追加（模型 caret 是 doc.length）。
    expect(caretFromDom()).toBe(DOC.length - 1)
    await assertDomMatchesSource(r)
  })

  it('Ctrl+Home / Cmd+ArrowUp 回文档开头', async () => {
    const r = renderEditor(DOC)
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    // 真实按键 Cmd+ArrowDown 跳文末（单独那条「Cmd+ArrowDown」测试并进本用例：
    // 它就是这个旅程的第一段），Cmd+ArrowUp 回文首。
    await r.user.keyboard('{Meta>}{ArrowDown}{/Meta}')
    await flush()
    expect(caretFromDom()).toBe(DOC.length - 1)
    await assertDomMatchesSource(r)
    await r.user.keyboard('{Meta>}{ArrowUp}{/Meta}')
    await flush()
    expect(caretFromDom()).toBe(0)
    // Ctrl+End 再去文末，Ctrl+Home 回文首（合成 keydown，见上一个用例）。
    const end = new KeyboardEvent('keydown', {
      key: 'End',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    r.container.dispatchEvent(end)
    await flush()
    expect(caretFromDom()).toBe(DOC.length - 1)
    const home = new KeyboardEvent('keydown', {
      key: 'Home',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    r.container.dispatchEvent(home)
    await flush()
    expect(caretFromDom()).toBe(0)
    await assertDomMatchesSource(r)
  })
})

/**
 * 行首退格 vs 结构行（`enter-backspace-smoke/03`、`05`）：
 * Home 到达的是源码行首（标记之前），点击到达的是内容开头；两条路都必须先退出
 * 块结构（unlist / unquote），而不是把标记当文本拼进上一行。
 */
describe('行首退格对结构行的处理', () => {
  it('列表项行首（Home 落点）退格：先取消列表，不把上一行拼进来', async () => {
    const r = renderEditor('1. aaa\n2. b\n3. ccc\n')
    await flush()
    // 让第三项 revealed（标记显现），光标放到标记开头 = Home 的落点。
    await clickInRun(r, 0, 2, 0, 'start')
    await flush()
    const marker = r.blockEl(0)?.querySelector<HTMLElement>('[data-vline="2"] [data-run="0"]')
    if (!marker?.firstChild) throw new Error('没有列表标记 run')
    placeCaretAt(marker.firstChild, 0)
    await flush()
    expect(caretFromDom()).toBe(12) // `1. aaa\n2. b\n` = 12 字符，`3. ` 之前
    await pressBackspace(r)
    await flush()
    // 与内容开头退格同一产物（backspace-unlist/01）：正文落在上一项的内容列。
    expect(r.getDoc()).toBe('1. aaa\n2. b\n   ccc\n')
    expect(caretFromDom()).toBe(15)
    await assertDomMatchesSource(r)
  })

  it('任务项行首退格同样取消列表', async () => {
    const r = renderEditor('- [x] aaa\n- bbb\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'start')
    await flush()
    const marker = r.blockEl(0)?.querySelector<HTMLElement>('[data-vline="0"] [data-run="0"]')
    if (!marker?.firstChild) throw new Error('没有任务标记 run')
    placeCaretAt(marker.firstChild, 0)
    await flush()
    await pressBackspace(r)
    await flush()
    // 第一项：退化成普通段落（没有上一项的内容列可继承）。
    expect(r.getDoc()).toBe('aaa\n- bbb\n')
    await assertDomMatchesSource(r)
  })

  it('引用行行首退格：退出引用，不把上一行吞进来', async () => {
    const r = renderEditor('> 甲\n> 乙\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'start')
    await flush()
    const marker = r.blockEl(0)?.querySelector<HTMLElement>('[data-vline="1"] [data-run="0"]')
    if (!marker?.firstChild) throw new Error('没有引用标记 run')
    placeCaretAt(marker.firstChild, 0)
    await flush()
    await pressBackspace(r)
    await flush()
    // 与"正文开头退格"同样的产物：正文落在引用的内容列（2 个空位）。
    expect(r.getDoc()).toBe('> 甲\n  乙\n')
    await assertDomMatchesSource(r)
  })

  it('代码块第一行行首退格：不把代码粘进围栏（no-op）', async () => {
    const r = renderEditor('```\ncode\n```\n')
    await flush()
    await clickInRun(r, 0, 1, 0, 'start')
    await flush()
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('```\ncode\n```\n')
    await assertDomMatchesSource(r)
  })

  it('代码块第二行行首退格：仍合并上一行代码', async () => {
    const r = renderEditor('```\n甲\n乙\n```\n')
    await flush()
    await clickInRun(r, 0, 2, 0, 'start')
    await flush()
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('```\n甲乙\n```\n')
    await assertDomMatchesSource(r)
  })
})

/**
 * The last hop of the autolink fix: the DOM.
 *
 * `core/view.test.ts` proves a bare URL becomes a run carrying an href, and
 * `platform/autolinks.test.ts` proves the view and the export agree on WHICH
 * links exist. Neither proves the run reaches the screen as a link, and nothing
 * did: `[文字](url)` had no DOM-level coverage either, so `rn-link` + `title`
 * was an untested claim on both paths.
 *
 * It stays a `span` with a `title` rather than becoming an `<a>` — clicking it in
 * edit mode has to place the caret, not follow the link, and a real anchor would
 * make the browser navigate. That is deliberate and asserted here so it is not
 * "fixed" later.
 */
describe('链接在 DOM 里的样子', () => {
  it('裸 URL 渲染成 rn-link，title 是最终的 href（含被改写的形式）', async () => {
    const r = renderEditor('见 https://example.com 与 www.example.net 与 me@example.com\n')
    await flush()
    const links = [...r.container.querySelectorAll<HTMLElement>('.rn-link')]
    expect(links.map((el) => el.textContent)).toEqual([
      'https://example.com',
      'www.example.net',
      'me@example.com',
    ])
    // The href is what the EXPORT would carry: `www.` gains its scheme, the
    // address becomes a mailto:. The visible text still reads as the source.
    expect(links.map((el) => el.title)).toEqual([
      'https://example.com',
      'http://www.example.net',
      'mailto:me@example.com',
    ])
    // Not anchors: in edit mode a click has to land the caret.
    expect(r.container.querySelectorAll('.doc a')).toHaveLength(0)
    await assertDomMatchesSource(r)
  })

  it('autolink 没有"另一副面孔"：光标进去还是同一个 run，而且改得动', async () => {
    // Unlike `[文字](url)`, an autolink has no markers to reveal — its source form
    // and its rendered form are the same characters — so the caret opening it
    // changes nothing and the run stays a link. What matters is that it is still
    // editable, and that recognition follows the source.
    const r = renderEditor('见 https://example.com 结束\n')
    await flush()
    r.container.focus({ preventScroll: true })
    const run = r.runEl(0, 0, 1)
    if (!run?.firstChild) throw new Error('the link run has no text node')

    placeCaretAt(run.firstChild, 4) // between `http` and `s`
    await flush()
    expect(r.container.querySelectorAll('.rn-link')).toHaveLength(1)

    await r.user.keyboard('X')
    expect(r.getDoc()).toBe('见 httpXs://example.com 结束\n')
    await flush()
    // `httpXs:` is not a scheme linkify knows, so the styling must go with it.
    expect(r.container.querySelectorAll('.rn-link')).toHaveLength(0)
    await assertDomMatchesSource(r)
  })
})

/**
 * Footnotes render where they STAND, and stay editable there.
 *
 * The export relocates definitions into a `<section class="footnotes">` at the
 * bottom; the editor deliberately does not, because "view order == source order"
 * is what the caret arithmetic is built on. So what this pins is the marker (the
 * `[1]` the reader sees) plus the two things that must not be lost to rendering:
 * the source, and the ability to type into the note.
 */
describe('脚注在编辑器里', () => {
  const DOC = '见[^1]。\n\n[^1]: 小小补充\n'

  it('引用渲染成上标的 [1]，DOM 文本仍是被折起来的源码', async () => {
    const r = renderEditor(DOC)
    await flush()
    const ref = r.container.querySelector<HTMLElement>('.rn-footnote-ref')
    expect(ref?.textContent).toBe('1')
    // `[1]` 的两个方括号来自 CSS，所以运行里只剩标签本身；源码里那两个标记
    // 仍然是零宽地留在 DOM 里，从 DOM 重建源码才不会丢。
    expect(getComputedStyle(ref!.parentElement!.querySelector('.rn-marker')!).display).toBe('none')
    await assertDomMatchesSource(r)
  })

  it('定义行是 vl-footnote，前缀折叠、标记由属性和 CSS 画出来', async () => {
    const r = renderEditor(DOC)
    await flush()
    const line = r.container.querySelector<HTMLElement>('.vl-footnote')
    expect(line?.dataset.footnote).toBe('1')
    // 前缀 `[^1]: ` 折叠了（零宽），屏幕上剩下的是注脚正文。
    const marker = line!.querySelector<HTMLElement>('.rn-marker')
    expect(marker?.textContent).toBe('[^1]: ')
    expect(getComputedStyle(marker!).display).toBe('none')
    expect(line!.textContent).toContain('小小补充')
    await assertDomMatchesSource(r)
  })

  it('光标进定义行时前缀显现为源码（否则那一行就没法改了）', async () => {
    const r = renderEditor(DOC)
    await flush()
    const line = r.container.querySelector<HTMLElement>('.vl-footnote')!
    r.container.focus({ preventScroll: true })
    const run = line.querySelector<HTMLElement>('[data-run="1"]')
    if (!run?.firstChild) throw new Error('the definition has no text run')
    placeCaretAt(run.firstChild, 0)
    await flush()
    // 显现之后前缀不再是零宽的 `rn-marker`，而是暗色的**可见**源码 —— 与标题、
    // 引用前缀同一套规则（`rn-dim`），所以这一行可以原地改。
    const revealed = line.querySelector<HTMLElement>('[data-run="0"]')
    expect(revealed?.textContent).toBe('[^1]: ')
    expect(revealed?.className).toContain('rn-dim')
    expect(getComputedStyle(revealed!).display).not.toBe('none')
    // 而且画出来的 `[1]` 必须让位：源码已经在显示了，两个形态叠起来就是
    // `[1][^1]: 小小补充`。（这一条最初漏了，正是因为它只测了折叠态。）
    expect(getComputedStyle(line, '::before').content).toBe('none')
    expect(line.className).toContain('revealed')
    await assertDomMatchesSource(r)
  })

  it('引用展开时也不画方括号（否则是 `[^[1]]`）', async () => {
    // 开头先有一个 `见`：编辑器的初始光标在偏移 0，如果引用就在行首，它一上来
    // 就是展开态，那样这条用例的前半段就测不到折叠态了。
    const r = renderEditor('见[^1]。\n')
    await flush()
    expect(r.container.querySelectorAll('.rn-footnote-ref')).toHaveLength(1)

    r.container.focus({ preventScroll: true })
    const label = r.container.querySelector<HTMLElement>('.rn-footnote-ref')
    if (!label?.firstChild) throw new Error('the reference has no text run')
    placeCaretAt(label.firstChild, 0)
    await flush()
    // 标记显现 -> 源码就是这个形态，CSS 不能再补方括号，也不该再着色。
    expect(r.container.querySelectorAll('.rn-footnote-ref')).toHaveLength(0)
    const line = r.container.querySelector<HTMLElement>('.vl')!
    expect(line.textContent).toBe('见[^1]。')
    await assertDomMatchesSource(r)
  })

  it('定义里的正文可以改，改完源码跟着变', async () => {
    const r = renderEditor(DOC)
    await flush()
    r.container.focus({ preventScroll: true })
    const run = r.container.querySelector<HTMLElement>('.vl-footnote [data-run="1"]')
    if (!run?.firstChild) throw new Error('the definition has no text run')
    placeCaretAt(run.firstChild, 0)
    await flush()
    await r.user.keyboard('X')
    expect(r.getDoc()).toBe('见[^1]。\n\n[^1]: X小小补充\n')
  })
})

/**
 * Cmd/Ctrl+click follows a link.
 *
 * A link here is a `span` and not an `<a>` on purpose — a plain click in edit mode
 * has to place the caret — so the browser has nothing to follow and this is done by
 * hand in the kernel's `mousedown`. What the tests pin, beyond the feature: a plain
 * click must still behave exactly as before, and the URL gate is a security
 * boundary rather than a nicety.
 */
describe('Cmd/Ctrl+click 打开链接', () => {
  /**
   * The kernel listens on `mousedown` (in capture) and uses the pointer coordinates
   * for its hit test, so a real rect and a real target are what make this work.
   * `userEvent.pointer` cannot carry modifiers, hence the direct events.
   */
  function modifiedClick(el: HTMLElement, init: MouseEventInit): void {
    const rect = el.getBoundingClientRect()
    const at: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      ...init,
    }
    el.dispatchEvent(new MouseEvent('mousedown', at))
    el.dispatchEvent(new MouseEvent('mouseup', at))
  }

  /**
   * The link's own run, found by class rather than by index: in
   * `见 [文字](url) 结束` the run before the text is the collapsed `[` MARKER
   * (`display: none`, so a zero-sized rect and no hit test), and counting runs to
   * find the right one is how this test first aimed its click at nothing.
   */
  function linkRun(r: Rendering): HTMLElement {
    const el = r.container.querySelector<HTMLElement>('.rn-link')
    if (!el) throw new Error('no link run on the line')
    return el
  }

  async function withOpenSpy(run: (open: ReturnType<typeof vi.spyOn>) => Promise<void>) {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      await run(open)
    } finally {
      open.mockRestore()
    }
  }

  it('Cmd+click 打开显式链接', async () => {
    const r = renderEditor('见 [链接文字](https://x.dev) 结束\n')
    await flush()
    await withOpenSpy(async (open) => {
      modifiedClick(linkRun(r), { metaKey: true })
      expect(open).toHaveBeenCalledWith('https://x.dev', '_blank', 'noopener,noreferrer')
    })
  })

  it('Cmd+click 裸 URL 打开的是归一化之后的绝对地址', async () => {
    // 裸 URL 的 href 不是源码原文：`www.` 要补上 scheme。这里比对的正是导出会写的那个地址。
    const r = renderEditor('见 www.example.net 结束\n')
    await flush()
    await withOpenSpy(async (open) => {
      modifiedClick(linkRun(r), { metaKey: true })
      expect(open).toHaveBeenCalledWith('http://www.example.net', '_blank', 'noopener,noreferrer')
    })
  })

  it('Ctrl+click 也认（Windows/Linux；macOS 上系统会把 ctrl+click 当右键）', async () => {
    const r = renderEditor('见 [链接文字](https://x.dev) 结束\n')
    await flush()
    await withOpenSpy(async (open) => {
      modifiedClick(linkRun(r), { ctrlKey: true })
      expect(open).toHaveBeenCalledTimes(1)
    })
  })

  it('普通点击不打开，仍然是落光标', async () => {
    const r = renderEditor('见 [链接文字](https://x.dev) 结束\n')
    await flush()
    await withOpenSpy(async (open) => {
      modifiedClick(linkRun(r), {})
      expect(open).not.toHaveBeenCalled()
      // 源码里 `链接文字` 占 [3,7)：落光标说明这条老路径没被新分支吃掉。
      const caret = caretFromDom() ?? -1
      expect(caret).toBeGreaterThanOrEqual(3)
      expect(caret).toBeLessThanOrEqual(7)
    })
  })

  it('不可执行的 URL 不跟随（导出的 HTML 也会把它丢掉）', async () => {
    // 跟随一个没校验的 `[x](javascript:…)` 等于把这份 Markdown 变成"点一下就执行"。
    // 门用的是 markdown-it 自己的 validateLink，也就是导出那条路走的同一道门。
    const r = renderEditor('见 [x](javascript:alert(1)) 结束\n')
    await flush()
    await withOpenSpy(async (open) => {
      modifiedClick(linkRun(r), { metaKey: true })
      expect(open).not.toHaveBeenCalled()
    })
  })

  it('Cmd+click 非链接文字不打开', async () => {
    const r = renderEditor('见 普通文字 结束\n')
    await flush()
    const text = r.runEl(0, 0, 0)
    if (!text) throw new Error('the line has no run')
    await withOpenSpy(async (open) => {
      modifiedClick(text, { metaKey: true })
      expect(open).not.toHaveBeenCalled()
    })
  })
})
