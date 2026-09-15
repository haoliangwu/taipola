import { describe, expect, it } from 'vitest'
import { shortcutFor, type KeyStroke } from './shortcuts'

const mod = (key: string, extra: Partial<KeyStroke> = {}): KeyStroke => ({
  key,
  metaKey: true,
  ...extra,
})

describe('shortcutFor', () => {
  it('格式命令：Cmd/Ctrl + B I K（E 已被 ⌃` 取代）', () => {
    expect(shortcutFor(mod('b'))).toBe('bold')
    expect(shortcutFor(mod('i'))).toBe('italic')
    expect(shortcutFor(mod('k'))).toBe('link')
    // ⌘E 移除：行内代码的键位严格对齐 Typora 的 ⌃`
    expect(shortcutFor(mod('e'))).toBeNull()
    // Ctrl 与 Meta 等价
    expect(shortcutFor({ key: 'b', ctrlKey: true })).toBe('bold')
    // 大小写不敏感（按住 Shift 之外的场合 event.key 也可能大写）
    expect(shortcutFor(mod('B'))).toBe('bold')
  })

  it('⌃ 系只认 Control（Typora 键位）：⌃` 行内代码、⌃⇧` 删除线、⌃M 行内数学', () => {
    expect(shortcutFor({ key: '`', ctrlKey: true })).toBe('inlineCode')
    // Shift+` 在多数布局报 '~'，与 toggleOutline 的 '|' 同理，两个都收
    expect(shortcutFor({ key: '`', ctrlKey: true, shiftKey: true })).toBe('strike')
    expect(shortcutFor({ key: '~', ctrlKey: true, shiftKey: true })).toBe('strike')
    expect(shortcutFor({ key: 'm', ctrlKey: true })).toBe('inlineMath')
    // 严格 ctrl-only：带上 Meta 就不再是 ⌃ 键
    expect(shortcutFor({ key: '`', ctrlKey: true, metaKey: true })).toBeNull()
    expect(shortcutFor(mod('m'))).toBeNull()
    expect(shortcutFor({ key: '~', ctrlKey: true })).toBeNull()
  })

  it('⌘0 清除标题（Typora Paragraph）', () => {
    expect(shortcutFor(mod('0'))).toBe('paragraph')
  })

  it('⌘= / ⌘+ / ⌘- 升降标题（shift 有无都认，容忍布局的 = 与 +）', () => {
    expect(shortcutFor(mod('='))).toBe('headingIncrease')
    expect(shortcutFor(mod('=', { shiftKey: true }))).toBe('headingIncrease')
    expect(shortcutFor(mod('+', { shiftKey: true }))).toBe('headingIncrease')
    expect(shortcutFor({ key: '=', ctrlKey: true, shiftKey: true })).toBe('headingIncrease')
    expect(shortcutFor(mod('-'))).toBe('headingDecrease')
  })

  it('⌘\\ 清除格式、⌘] 缩进、⌘[ 反缩进', () => {
    expect(shortcutFor(mod('\\'))).toBe('clearFormat')
    expect(shortcutFor(mod(']'))).toBe('indent')
    expect(shortcutFor(mod('['))).toBe('outdent')
  })

  it('⌥⌘ 系（Typora 段落键位）：Q 引用 / O 有序 / U 无序 / X 任务 / C 围栏 / R 脚注 / L 链接引用 / T 表格 / - 水平线', () => {
    expect(shortcutFor(mod('q', { altKey: true }))).toBe('quote')
    expect(shortcutFor(mod('o', { altKey: true }))).toBe('orderedList')
    expect(shortcutFor(mod('u', { altKey: true }))).toBe('unorderedList')
    expect(shortcutFor(mod('x', { altKey: true }))).toBe('taskList')
    expect(shortcutFor(mod('c', { altKey: true }))).toBe('codeBlock')
    expect(shortcutFor(mod('r', { altKey: true }))).toBe('footnotes')
    expect(shortcutFor(mod('l', { altKey: true }))).toBe('linkReference')
    expect(shortcutFor(mod('t', { altKey: true }))).toBe('table')
    expect(shortcutFor(mod('-', { altKey: true }))).toBe('hr')
    // Ctrl+Alt 与 Meta+Alt 等价（⌥⌘ 系看齐 meta||ctrl 惯例）
    expect(shortcutFor({ key: 'q', ctrlKey: true, altKey: true })).toBe('quote')
    // 无 Alt 不串味
    expect(shortcutFor(mod('q'))).toBeNull()
    expect(shortcutFor(mod('u'))).toBeNull()
    expect(shortcutFor(mod('x'))).toBeNull()
    expect(shortcutFor(mod('-'))).toBe('headingDecrease')
    expect(shortcutFor(mod('h', { altKey: true }))).toBeNull()
  })

  it('文件命令：S 保存、Shift+S 另存为、O 打开、N 新建', () => {
    expect(shortcutFor(mod('s'))).toBe('save')
    expect(shortcutFor(mod('s', { shiftKey: true }))).toBe('saveAs')
    expect(shortcutFor(mod('o'))).toBe('open')
    expect(shortcutFor(mod('n'))).toBe('newDocument')
  })

  it('1-6 是标题级别，0 是清除标题', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(shortcutFor(mod(String(level)))).toBe(`heading${level}`)
    }
    expect(shortcutFor(mod('7'))).toBeNull()
    expect(shortcutFor(mod('0'))).toBe('paragraph')
  })

  it('只差一个修饰键的组合不会串味', () => {
    // Cmd+K 是链接，Cmd+Shift+K 是删除整行
    expect(shortcutFor(mod('k'))).toBe('link')
    expect(shortcutFor(mod('k', { shiftKey: true }))).toBe('deleteLine')
    // Cmd+Shift+\ 切大纲。Shift+反斜杠在浏览器里报的是 '|'——只认 '\' 的话
    // 这个绑定永远不会触发（老实现就是这样），所以两个都收。
    expect(shortcutFor(mod('|', { shiftKey: true }))).toBe('toggleOutline')
    expect(shortcutFor(mod('\\', { shiftKey: true }))).toBe('toggleOutline')
    // Cmd+\ 是清除格式（Typora Clear Format）
    expect(shortcutFor(mod('\\'))).toBe('clearFormat')
  })

  it('Shift 分支是早返回：没绑定的 Shift 组合一律不做声', () => {
    expect(shortcutFor(mod('b', { shiftKey: true }))).toBeNull()
    expect(shortcutFor(mod('1', { shiftKey: true }))).toBeNull()
    expect(shortcutFor(mod('x', { shiftKey: true }))).toBeNull()
  })

  it('Cmd/Ctrl+Shift+O 打开文件夹，接力给 Cmd/Ctrl+O 打开文件', () => {
    expect(shortcutFor(mod('o', { shiftKey: true }))).toBe('openFolder')
    expect(shortcutFor(mod('o'))).toBe('open')
  })

  it('Escape 只在没有修饰键时模糊焦点', () => {
    expect(shortcutFor({ key: 'Escape' })).toBe('blur')
    expect(shortcutFor(mod('Escape'))).toBeNull()
  })

  it('没有修饰键时什么都不接管，浏览器保留自己的默认行为', () => {
    // null 的语义是"调用者不要 preventDefault"：Cmd+P 要能弹出打印对话框。
    expect(shortcutFor({ key: 'b' })).toBeNull()
    expect(shortcutFor({ key: 's' })).toBeNull()
    expect(shortcutFor({ key: '1' })).toBeNull()
    expect(shortcutFor(mod('p'))).toBeNull()
    expect(shortcutFor(mod('z'))).toBeNull()
  })
})
