import { describe, expect, it } from 'vitest'
import { computeStats, extractHeadings, parseDocument } from './markdown'

/**
 * Structural invariants of `parseDocument`.
 *
 * Blocks tile the source: each block's `raw` is followed by exactly one newline
 * (the separator, implied rather than stored), line ranges are contiguous, and a
 * trailing blank block always exists so the caret has somewhere to sit after the
 * last newline. Every assertion here is a property, not a golden string: they
 * hold for any document, so the net does not need updating when content changes.
 */
function check(source: string) {
  const parsed = parseDocument(source)
  const { blocks, offsets } = parsed

  expect(offsets.length).toBe(blocks.length + 1)
  expect(offsets[0]).toBe(0)
  expect(blocks.length).toBeGreaterThan(0)

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    expect(block.index).toBe(i)
    expect(block.raw).not.toMatch(/\n$/)
    // Contiguous lines, in order.
    if (i > 0) expect(block.startLine).toBe(blocks[i - 1].endLine)
    expect(block.endLine).toBeGreaterThan(block.startLine)
    // The official span can be WIDER than the raw: a list range often covers the
    // blank line after its last item, and the view pads to the span so a caret
    // can reach it. It can never be narrower.
    expect(block.endLine - block.startLine).toBeGreaterThanOrEqual(
      block.raw === '' ? 1 : block.raw.split('\n').length,
    )
    // Blocks tile the source with nothing but newlines in between. Usually that
    // is exactly one separator newline; a list block can absorb the blank line
    // after its last item, which makes the gap longer — never shorter.
    if (i < blocks.length - 1) {
      const gap = source.slice(offsets[i] + block.raw.length, offsets[i + 1])
      expect(gap).toMatch(/^\n+$/)
    } else {
      expect(offsets[i] + block.raw.length).toBeLessThanOrEqual(source.length)
    }
  }

  // The last block always reaches the end of the document.
  expect(blocks[blocks.length - 1].endLine).toBe(source.split('\n').length)
  return parsed
}

describe('parseDocument 结构不变量', () => {
  it('空文档也有一个块（光标要有落点）', () => {
    const parsed = check('')
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].raw).toBe('')
  })

  it.each([
    ['无换行结尾', 'a'],
    ['单行', 'a\n'],
    ['两段', 'a\n\nb\n'],
    ['标题 + 列表', '# h\n\n- l\n'],
    ['尾部连续空行', 'x\n\n\n'],
    ['表格', '| a | b |\n| --- | --- |\n| 1 | 2 |\n'],
    ['setext 标题', 'Title\n=====\n'],
    ['嵌套列表', '- a\n  - b\n'],
    ['引用与围栏', '> q\n\n```ts\nx\n```\n'],
    ['整篇欢迎文档', '# 标题\n\n正文 **粗**。\n\n1. 一\n2. 二\n\n---\n'],
  ])('%s', (_name, source) => {
    check(source)
  })

  it('表格是一个块，行数正确', () => {
    const { blocks } = parseDocument('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(blocks).toHaveLength(2) // 表格 + 尾部空块
    expect(blocks[0].raw.split('\n')).toHaveLength(3)
    expect(blocks[0].endLine - blocks[0].startLine).toBe(3)
  })

  it('嵌套列表是一个块', () => {
    const { blocks } = parseDocument('- a\n  - b\n')
    expect(blocks[0].raw).toBe('- a\n  - b')
  })

  it('ATX 标题带级别与纯文本', () => {
    const { blocks } = parseDocument('## 二级 **重点**\n')
    expect(blocks[0].headingLevel).toBe(2)
    expect(blocks[0].headingText).toBe('二级 重点')
  })

  it('setext 标题也算标题', () => {
    const h1 = parseDocument('Title\n=====\n').blocks[0]
    expect(h1.headingLevel).toBe(1)
    expect(h1.headingText).toBe('Title')
    const h2 = parseDocument('Sub\n---\n').blocks[0]
    expect(h2.headingLevel).toBe(2)
  })

  it('结尾换行会补一个空块', () => {
    const { blocks } = parseDocument('a\n')
    expect(blocks).toHaveLength(2)
    expect(blocks[1].raw).toBe('')
  })
})

describe('extractHeadings（大纲）', () => {
  it('按顺序取出 1-6 级标题与 1-based 行号', () => {
    const source = '# 一\n\n### 三\n\n###### 六\n'
    expect(extractHeadings(source)).toEqual([
      { level: 1, text: '一', line: 1 },
      { level: 3, text: '三', line: 3 },
      { level: 6, text: '六', line: 5 },
    ])
  })

  it('剥掉行内标记，空标题有占位文本', () => {
    expect(extractHeadings('# **粗** 与 `码`\n')[0].text).toBe('粗 与 码')
    expect(extractHeadings('#\n')).toEqual([])
    expect(extractHeadings('#  \n')[0].text).toBe('(空标题)')
  })

  it('围栏里的 # 不算标题', () => {
    const source = '# 真标题\n\n```\n# 不是标题\n```\n\n## 又真了\n'
    expect(extractHeadings(source).map((h) => h.text)).toEqual(['真标题', '又真了'])
  })

  it('setext 标题也进大纲（parseDocument 早就在认它）', () => {
    expect(extractHeadings('Title\n=====\n')).toEqual([{ level: 1, text: 'Title', line: 1 }])
    expect(extractHeadings('Sub\n---\n')).toEqual([{ level: 2, text: 'Sub', line: 1 }])
  })

  it('setext 前瞻不外溢：分割线、列表项、引用、围栏', () => {
    // 上一行是空行时，`---` 是分割线而不是标题下划线（CommonMark）。
    expect(extractHeadings('上段\n\n---\n')).toEqual([])
    // 列表项与引用不是段落行，不在它们下面找下划线。
    expect(extractHeadings('- 项\n---\n')).toEqual([])
    expect(extractHeadings('> 引用\n---\n')).toEqual([])
    // 围栏里的 `===` 是代码内容。
    expect(extractHeadings('```\nTitle\n===\n```\n')).toEqual([])
    // 下划线行本身不是正文：`Title / ===== / ---` 是 h1 + 分割线，
    // 不是 h1 再加一个正文为 `=====` 的 h2（渲染器给的是 h1 + hr）。
    expect(extractHeadings('Title\n=====\n---\n')).toEqual([{ level: 1, text: 'Title', line: 1 }])
    expect(extractHeadings('Title\n--\n--\n')).toEqual([{ level: 2, text: 'Title', line: 1 }])
  })

  it('setext 与 ATX 混排时按源码顺序进大纲', () => {
    const doc = '# 一\n\nTitle\n=====\n\n## 二\n\nSub\n---\n'
    expect(extractHeadings(doc).map((h) => [h.level, h.text, h.line])).toEqual([
      [1, '一', 1],
      [1, 'Title', 3],
      [2, '二', 6],
      [2, 'Sub', 8],
    ])
  })
})

describe('computeStats', () => {
  it('字数按 CJK 逐字 + 拉丁词计，字符数是源码长度', () => {
    const stats = computeStats('你好 world\nsecond line\n')
    expect(stats.chars).toBe(21)
    expect(stats.lines).toBe(3)
    expect(stats.words).toBe(5) // 你好(2) + world/second/line(3)
    expect(stats.readingMinutes).toBeGreaterThanOrEqual(1)
  })

  it('空文档是 1 行', () => {
    expect(computeStats('').lines).toBe(1)
  })
})

describe('软换行（段落内单换行）', () => {
  it('标出哪一行的行尾换行是软换行，用块内行号', () => {
    expect(parseDocument('alpha beta\ngamma delta\n').blocks[0].softBreakAfter).toEqual([0])
    // 同一个列表项的续行是软换行……
    expect(parseDocument('- a\n  b\n').blocks[0].softBreakAfter).toEqual([0])
    // ……两个列表项之间不是
    expect(parseDocument('- a\n- b\n').blocks[0].softBreakAfter).toEqual([])
    // 硬换行（行尾两个空格）不是软换行
    expect(parseDocument('a  \nb\n').blocks[0].softBreakAfter).toEqual([])
    // 围栏里的换行是字面内容
    expect(parseDocument('```\na\nb\n```\n').blocks[0].softBreakAfter).toEqual([])
  })
})
