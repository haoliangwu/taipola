import { describe, expect, it } from 'vitest'
import {
  deleteLine,
  insertLink,
  insertSnippet,
  toggleHeading,
  toggleInline,
  toggleInlineCode,
  type EditBuffers,
} from './editCommands'

/** Applies a command and reports the resulting source plus the new selection. */
function run(value: string, start: number, end: number, command: (b: EditBuffers) => void) {
  const buffer: EditBuffers = { value, start, end }
  command(buffer)
  return {
    value: buffer.value,
    start: buffer.start,
    end: buffer.end,
    selected: buffer.value.slice(buffer.start, buffer.end),
  }
}

describe('toggleInline（粗体 / 斜体 / 删除线）', () => {
  it('包裹选中的文字，选区留在文字上', () => {
    expect(run('hello', 0, 5, (b) => toggleInline(b, '**'))).toEqual({
      value: '**hello**',
      start: 2,
      end: 7,
      selected: 'hello',
    })
  })

  it('再次执行则去掉包裹', () => {
    expect(run('**hello**', 2, 7, (b) => toggleInline(b, '**')).value).toBe('hello')
  })

  it('选区本身含标记时去掉标记', () => {
    expect(run('**hello**', 0, 9, (b) => toggleInline(b, '**')).value).toBe('hello')
  })

  it('空选区插入一对标记，光标落在中间', () => {
    const result = run('ab', 1, 1, (b) => toggleInline(b, '**'))
    expect(result.value).toBe('a****b')
    expect(result.start).toBe(3)
    expect(result.end).toBe(3)
  })

  it('斜体与删除线用各自的标记', () => {
    expect(run('x', 0, 1, (b) => toggleInline(b, '*')).value).toBe('*x*')
    expect(run('x', 0, 1, (b) => toggleInline(b, '~~')).value).toBe('~~x~~')
  })
})

describe('toggleInlineCode', () => {
  it('单行选区用反引号包裹', () => {
    expect(run('code', 0, 4, toggleInlineCode).value).toBe('`code`')
  })

  it('多行选区升级成围栏代码块', () => {
    const result = run('a\nb', 0, 3, toggleInlineCode)
    expect(result.value).toBe('```\na\nb\n```')
    expect(result.selected).toBe('a\nb')
  })

  it('空选区给出两个反引号，光标在中间', () => {
    const result = run('', 0, 0, toggleInlineCode)
    expect(result.value).toBe('``')
    expect(result.start).toBe(1)
  })
})

describe('insertLink', () => {
  it('选中文字变成链接，选区停在 url 上等用户输入', () => {
    const result = run('见 text 处', 2, 6, insertLink)
    expect(result.value).toBe('见 [text](url) 处')
    expect(result.selected).toBe('url')
  })

  it('选中的是 URL 时把 URL 放进括号，光标留在方括号里', () => {
    const result = run('https://x.dev', 0, 13, insertLink)
    expect(result.value).toBe('[](https://x.dev)')
    expect(result.start).toBe(1)
    expect(result.end).toBe(1)
  })

  it('没有选中内容时给出占位文字并选中它', () => {
    const result = run('', 0, 0, insertLink)
    expect(result.value).toBe('[链接文字](url)')
    expect(result.selected).toBe('链接文字')
  })

  it('已有链接被选中时展开成纯文字', () => {
    expect(run('见 [text](https://x.dev) 处', 3, 7, insertLink).value).toBe('见 text 处')
  })

  it('图片 alt 里插链接会被拒绝（不产出非法嵌套）', () => {
    // `![[alt](url)](src)` 解析不回图片，所以这里宁可什么都不做。
    const result = run('![alt](https://x.dev/a.png)', 2, 5, insertLink)
    expect(result.value).toBe('![alt](https://x.dev/a.png)')
  })
})

describe('toggleHeading', () => {
  it('给当前行加标题前缀，光标跟着位移', () => {
    const result = run('标题', 1, 1, (b) => toggleHeading(b, 2))
    expect(result.value).toBe('## 标题')
    expect(result.start).toBe(4)
  })

  it('同一级别再按一次则取消标题', () => {
    expect(run('## 标题', 4, 4, (b) => toggleHeading(b, 2)).value).toBe('标题')
  })

  it('换级别时替换前缀', () => {
    expect(run('# 标题', 3, 3, (b) => toggleHeading(b, 3)).value).toBe('### 标题')
  })

  it('只影响光标所在行', () => {
    const result = run('a\nb', 2, 2, (b) => toggleHeading(b, 1))
    expect(result.value).toBe('a\n# b')
  })

  it('1-6 级都能设', () => {
    expect(run('x', 0, 0, (b) => toggleHeading(b, 6)).value).toBe('###### x')
  })
})

describe('deleteLine', () => {
  it('删掉中间一行（连换行一起）', () => {
    const result = run('a\nb\nc', 2, 2, deleteLine)
    expect(result.value).toBe('a\nc')
    expect(result.start).toBe(2)
  })

  it('删掉最后一行时不留空行', () => {
    expect(run('a\nb', 2, 2, deleteLine).value).toBe('a')
  })

  it('只有一行时清空', () => {
    expect(run('only', 2, 2, deleteLine).value).toBe('')
  })
})

describe('insertSnippet', () => {
  it('行中间插入时先补一个换行', () => {
    const result = run('ab', 1, 1, (b) => insertSnippet(b, '> '))
    expect(result.value).toBe('a\n> b')
    // 光标停在插入片段之后（`\n> ` 占 3 个字符）
    expect(result.start).toBe(4)
  })

  it('已在行首则不再补换行', () => {
    const result = run('a\nb', 2, 2, (b) => insertSnippet(b, '- '))
    expect(result.value).toBe('a\n- b')
  })
})
