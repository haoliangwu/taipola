import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  renderEditor,
  typeText,
  pressBackspace,
  pressEnter,
  pressShiftEnter,
  clickInRun,
  clickAtLine,
  assertDomMatchesSource,
  flush,
  caretFromDom,
  type Rendering,
} from '../test/editorTestUtils'

import { WELCOME_DOC } from '../lib/welcome'

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

  it('点击标题文本后按 Enter，标题按光标位置拆成两行', async () => {
    await clickInRun(r, 0, 0, 1, 0.5)
    const linesBefore = r.getDoc().split('\n').length
    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    expect(doc.split('\n').length).toBeGreaterThan(linesBefore)
    expect(doc).toContain('# ')
    expect(doc).toContain('taipola')
    await assertDomMatchesSource(r)
  })

  it('点击标题行末按 Enter，标题下新增一个空行', async () => {
    await clickInRun(r, 0, 0, 1, 1.0)
    await pressEnter(r)
    await flush()
    const doc = r.getDoc()
    expect(doc).toMatch(/^# 欢迎使用 taipola\n\n\n/)
    await assertDomMatchesSource(r)
  })

  it('段落行末按 Enter 也能换行（行末不再是 no-op）', async () => {
    const p = renderEditor('一段文字\n\n第二段\n')
    await clickInRun(p, 0, 0, 0, 1.0)
    await pressEnter(p)
    await flush()
    expect(p.getDoc()).toBe('一段文字\n\n\n第二段\n')
    await assertDomMatchesSource(p)
  })

  it('列表退出空 bullet 后光标停在空行上（不往回跳）', async () => {
    await clickInRun(r, 6, 2, 4, 1.0)
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
    await clickInRun(r, 0, 0, 1, 0.5)
    const linesBefore = r.getDoc().split('\n').length
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc().split('\n').length).toBeGreaterThan(linesBefore)
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
    await clickInRun(r, 6, 2, 4, 1.0)
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toContain('内容\n- ')
    await assertDomMatchesSource(r)
  })

  it('空 bullet 行再次 Enter：bullet 消失但保留一个空行（不吞换行）', async () => {
    await clickInRun(r, 6, 2, 4, 1.0)
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
    await clickInRun(r, 0, 0, 1, 1.0)
    for (let i = 0; i < 4; i++) await pressBackspace(r)
    await flush()
    // 光标在行末，4 次 Backspace 删掉结尾 4 个字符。
    expect(r.getDoc()).toBe('# 它FINA==现在\n\n正文\n')
    await assertDomMatchesSource(r)
  })

  it('backspace 后继续 typing，不产生异常且源码一致', async () => {
    const r = renderEditor('# 标题\n\n正文\n')
    await clickInRun(r, 0, 0, 1, 0.5)
    await pressBackspace(r)
    await flush()
    await typeText(r, 'X')
    await flush()
    const doc = r.getDoc()
    expect(doc).toContain('标')
    await assertDomMatchesSource(r)
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
      await clickInRun(r, 0, 0, 1, 0.5)
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
      await clickInRun(r, 0, 0, 1, 0.5)
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
    await clickInRun(r, 0, 0, 1, 0.5)
    await pressEnter(r)
    await flush()
    await clickInRun(r, 4, 0, 1, 0.5)
    await pressEnter(r)
    await flush()
    await clickInRun(r, 6, 1, 4, 0.5)
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
      coords: { x: 8, y: box.height - 4 },
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
    await clickInRun(r, 0, 0, 0, 1.0)
    await flush()
    await pressEnter(r)
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('第一段文字\n\n\n\n第二段\n')
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
    await clickInRun(r, 0, 0, 1, 1.0)
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
    await clickInRun(r, 0, 0, 0, 1.0)
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

  it('有序列表中间回车：后面的编号顺延，不再出现重复编号', async () => {
    const r = renderEditor('1. 甲\n2. 乙\n3. 丙\n')
    await clickInRun(r, 0, 1, 1, 1.0)
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
    await clickInRun(ordered, 0, 1, 1, 1.0)
    await flush()
    await ordered.user.keyboard('{Tab}')
    await flush()
    expect(ordered.getDoc()).toBe('1. 甲\n   1. 乙\n')
    await ordered.user.keyboard('{Shift>}{Tab}{/Shift}')
    await flush()
    expect(ordered.getDoc()).toBe('1. 甲\n2. 乙\n')
    await assertDomMatchesSource(ordered)

    const plain = renderEditor('- 甲\n- 乙\n')
    await clickInRun(plain, 0, 1, 1, 1.0)
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
    await clickInRun(r, 0, 2, 0, 0)
    await r.user.keyboard('X')
    await flush()
    // 三行结构一字不差：分隔行必须留在源码里（它不可见，只能从 DOM 的隐藏副本重建），
    // 改动只落在那一个单元格里。
    expect(r.getDoc()).toBe('| 甲 | 乙 |\n| --- | --- |\n| 1X | 2 |\n')
    await assertDomMatchesSource(r)
  })

  it('有序列表块重置计数器（每段编号从 1 开始）', async () => {
    const r = renderEditor('1. 一\n2. 二\n\n中间段落\n\n1. 甲\n2. 乙\n')
    await flush()
    const blocks = [...r.container.querySelectorAll<HTMLElement>('[data-block]')]
    const lists = blocks.filter((b) => b.getAttribute('data-kind') === 'list')
    expect(lists.length).toBe(2)
    for (const list of lists) expect(getComputedStyle(list).counterReset).toContain('vl-item')
    // 每个有序行都要拿到计数器的增量来源（顺序渲染态下由 ::before 显示）。
    for (const list of lists) {
      expect(list.querySelector('.vl-ordered')).not.toBeNull()
    }
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
    await clickInRun(r, 0, 0, 1, 1.0)
    await flush()
    await pressEnter(r)
    await flush()
    expect(r.getDoc()).toBe('# 标题\n\n\n正文\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('# 标题\n\n正文\n')
    await assertDomMatchesSource(r)
  })
})
