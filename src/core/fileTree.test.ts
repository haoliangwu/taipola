/**
 * The tree's two rules, pinned in the node layer.
 *
 * What is worth testing here is what the tree SHOWS and in what order: which
 * entries are rows at all (documents and folders, nothing hidden), and that the
 * order is a property of the entries rather than of the order the filesystem
 * happened to hand them over.
 */
import { describe, expect, it } from 'vitest'
import { childPath, isHiddenName, isMarkdownName, visibleEntries, type TreeEntry } from './fileTree'

function entry(name: string, kind: TreeEntry['kind'] = 'file'): TreeEntry {
  return { name, path: name, kind }
}

describe('isMarkdownName', () => {
  it('认识 md 与 markdown，大小写不敏感', () => {
    expect(isMarkdownName('笔记.md')).toBe(true)
    expect(isMarkdownName('笔记.MD')).toBe(true)
    expect(isMarkdownName('笔记.Markdown')).toBe(true)
  })

  it('别的扩展名不是文档', () => {
    expect(isMarkdownName('笔记.txt')).toBe(false)
    expect(isMarkdownName('截图.png')).toBe(false)
    expect(isMarkdownName('md')).toBe(false)
    expect(isMarkdownName('笔记.md.bak')).toBe(false)
  })
})

describe('isHiddenName', () => {
  it('点开头的一律不显示', () => {
    expect(isHiddenName('.git')).toBe(true)
    expect(isHiddenName('.obsidian')).toBe(true)
    expect(isHiddenName('.env')).toBe(true)
  })

  it('node_modules 也不显示（它总是和 README 一起出现）', () => {
    expect(isHiddenName('node_modules')).toBe(true)
  })

  it('普通名字照常显示', () => {
    expect(isHiddenName('章节')).toBe(false)
    expect(isHiddenName('笔记.md')).toBe(false)
  })
})

describe('childPath', () => {
  it('根下的条目就是它自己的名字', () => {
    expect(childPath('', '一.md')).toBe('一.md')
  })

  it('子目录里的条目带上父路径', () => {
    expect(childPath('章节', '一.md')).toBe('章节/一.md')
    expect(childPath('章节/上', '一.md')).toBe('章节/上/一.md')
  })
})

describe('visibleEntries', () => {
  it('只留下文档与目录', () => {
    const rows = visibleEntries([
      entry('笔记.md'),
      entry('截图.png'),
      entry('章节', 'directory'),
      entry('说明.txt'),
    ])

    expect(rows.map((row) => row.name)).toEqual(['章节', '笔记.md'])
  })

  it('隐藏项一律不出现', () => {
    const rows = visibleEntries([
      entry('.git', 'directory'),
      entry('node_modules', 'directory'),
      entry('.hidden.md'),
      entry('正文.md'),
    ])

    expect(rows.map((row) => row.name)).toEqual(['正文.md'])
  })

  it('目录排在文档前面，各自按名称升序、大小写不敏感', () => {
    const rows = visibleEntries([
      entry('beta.md'),
      entry('Zeta', 'directory'),
      entry('Alpha.md'),
      entry('alpha2', 'directory'),
    ])

    expect(rows.map((row) => row.name)).toEqual(['alpha2', 'Zeta', 'Alpha.md', 'beta.md'])
  })

  it('顺序不取决于文件系统给的顺序', () => {
    const forwards = visibleEntries([entry('a.md'), entry('b.md'), entry('c.md')])
    const backwards = visibleEntries([entry('c.md'), entry('b.md'), entry('a.md')])

    expect(forwards).toEqual(backwards)
  })

  it('条目上挂着的东西（句柄之类）原样留着', () => {
    const withHandle = [{ ...entry('笔记.md'), handle: { file: '笔记.md' } }]

    expect(visibleEntries(withHandle)[0]?.handle).toEqual({ file: '笔记.md' })
  })

  it('不改动传进来的数组', () => {
    const input = [entry('b.md'), entry('a.md')]

    visibleEntries(input)

    expect(input.map((row) => row.name)).toEqual(['b.md', 'a.md'])
  })
})
