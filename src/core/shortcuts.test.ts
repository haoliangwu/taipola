import { describe, expect, it } from 'vitest'
import { shortcutFor, type KeyStroke } from './shortcuts'

const mod = (key: string, extra: Partial<KeyStroke> = {}): KeyStroke => ({
  key,
  metaKey: true,
  ...extra,
})

describe('shortcutFor', () => {
  it('格式命令：Cmd/Ctrl + B I E K', () => {
    expect(shortcutFor(mod('b'))).toBe('bold')
    expect(shortcutFor(mod('i'))).toBe('italic')
    expect(shortcutFor(mod('e'))).toBe('inlineCode')
    expect(shortcutFor(mod('k'))).toBe('link')
    // Ctrl 与 Meta 等价
    expect(shortcutFor({ key: 'b', ctrlKey: true })).toBe('bold')
    // 大小写不敏感（按住 Shift 之外的场合 event.key 也可能大写）
    expect(shortcutFor(mod('B'))).toBe('bold')
  })

  it('文件命令：S 保存、Shift+S 另存为、O 打开、N 新建', () => {
    expect(shortcutFor(mod('s'))).toBe('save')
    expect(shortcutFor(mod('s', { shiftKey: true }))).toBe('saveAs')
    expect(shortcutFor(mod('o'))).toBe('open')
    expect(shortcutFor(mod('n'))).toBe('newDocument')
  })

  it('1-6 是标题级别', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(shortcutFor(mod(String(level)))).toBe(`heading${level}`)
    }
    expect(shortcutFor(mod('7'))).toBeNull()
    expect(shortcutFor(mod('0'))).toBeNull()
  })

  it('只差一个修饰键的组合不会串味', () => {
    // Cmd+K 是链接，Cmd+Shift+K 是删除整行
    expect(shortcutFor(mod('k'))).toBe('link')
    expect(shortcutFor(mod('k', { shiftKey: true }))).toBe('deleteLine')
    // Cmd+Shift+\ 切大纲
    expect(shortcutFor(mod('\\', { shiftKey: true }))).toBe('toggleOutline')
    // Cmd+\ 没有绑定
    expect(shortcutFor(mod('\\'))).toBeNull()
  })

  it('Shift 分支是早返回：没绑定的 Shift 组合一律不做声', () => {
    expect(shortcutFor(mod('b', { shiftKey: true }))).toBeNull()
    expect(shortcutFor(mod('1', { shiftKey: true }))).toBeNull()
    expect(shortcutFor(mod('o', { shiftKey: true }))).toBeNull()
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
