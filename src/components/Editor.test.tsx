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

export const WELCOME = `# 欢迎使用 taipola

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
