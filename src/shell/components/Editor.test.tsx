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

  it('点击标题文本中间后按 Enter，标题按光标位置拆成两行', async () => {
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
    expect(doc.split('\n').length).toBeGreaterThan(1)
    // 标题在光标处断成两行：两半拼回去正好还是原来那一行标题。
    const [first, second] = doc.split('\n')
    expect(first + second).toBe(heading)
    await assertDomMatchesSource(r)
  })

  it('点击标题行末按 Enter，标题下新增一个空行', async () => {
    await clickInRun(r, 0, 0, 1, 'end')
    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    expect(doc).toMatch(/^# 欢迎使用 taipola\n\n\n/)
    // 光标必须落在新开的那一行行首，而不是插入点之后一行（ADR §7 第 1 条）。
    // 手工推算：标题 14 字，行尾偏移 14；新行起始于 15。旧算术 `at + 1` 给 16。
    expect(caretFromDom()).toBe(15)
    await assertDomMatchesSource(r)
  })

  it('段落行末按 Enter 也能换行（行末不再是 no-op）', async () => {
    const p = renderEditor('一段文字\n\n第二段\n')
    await clickInRun(p, 0, 0, 0, 'end')
    await pressEnter(p)
    await flush()
    expect(p.getDoc()).toBe('一段文字\n\n\n第二段\n')
    // 同上：段落 4 字，行尾偏移 4，新行起始于 5。
    expect(caretFromDom()).toBe(5)
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
    expect(r.getDoc()).toBe('# 头\n正文甲\n正文乙\n')
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
  const TABLE_DOC = `| 快捷键 | 作用 |\n| --- | --- |\n| Cmd/Ctrl + B | 加粗 |\n| Cmd/Ctrl + I | 斜体 |\n`

  it('表格文档渲染稳定，输入不触发重渲染循环', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const r = renderEditor(TABLE_DOC)
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
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('第一段文字\n\n\n\n第二段\n')
    // 两次回车都要把光标带到新开的空行上（ADR §7 S5：修复前光标停在下一段行首）。
    // 手工推算：段 5 字，第一次回车后新行起始于 6，第二次回车后起始于 7。
    expect(caretFromDom()).toBe(7)
    // 键盘输入，不用 typeText：user.type 会先点一次容器，光标会被点走。
    await r.user.keyboard('X')
    await flush()
    // 每次回车都在光标所在行"下方"开新行，光标跟着新行走：X 独占一行，
    // 上下各留一个空行（上行来自第一次回车，下行是第二段前原有的空行）。
    // 关键性质是 X 不粘进下一段——修复前这里是 'X第二段'。
    expect(r.getDoc()).toBe('第一段文字\n\nX\n\n第二段\n')
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
    expect(r.getDoc()).toBe('标题行测试\n\n\n')
    await r.user.keyboard('第二行')
    await flush()
    expect(r.getDoc()).toBe('标题行测试\n第二行\n\n')
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

  it('标题行末回车后按退格：只并回一行，不吃掉标题字符', async () => {
    const r = renderEditor('# 标题\n\n正文\n')
    await clickInRun(r, 0, 0, 1, 'end')
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('# 标题\n\n\n正文\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('# 标题\n\n正文\n')
    // 并回一行之后，光标停在接缝上：标题 4 字，接缝就是偏移 4。
    // （修复前那条路会先被浏览器吃掉一个字符、再让光标脱离所有块。）
    expect(caretFromDom()).toBe(4)
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
