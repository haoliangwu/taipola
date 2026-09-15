import { describe, expect, it } from 'vitest'
import {
  changeHeadingLevel,
  clearFormat,
  deleteLine,
  indentSelection,
  insertFootnote,
  insertHr,
  insertLink,
  insertLinkReference,
  insertSnippet,
  toggleBlockPrefix,
  toggleHeading,
  toggleInline,
  toggleInlineCode,
  toggleInlineMath,
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
    // 光标停在插入片段之后（`> ` 占 2 个字符）
    expect(result.start).toBe(4)
  })

  it('已在行首则不再补换行', () => {
    const result = run('a\nb', 2, 2, (b) => insertSnippet(b, '- '))
    expect(result.value).toBe('a\n- b')
  })
})

describe('toggleHeading level 0（Typora ⌘0：清除标题）', () => {
  it('标题行变为普通段落', () => {
    expect(run('## 标题', 4, 4, (b) => toggleHeading(b, 0)).value).toBe('标题')
  })

  it('普通段落按 ⌘0 是无操作', () => {
    const result = run('段落', 2, 2, (b) => toggleHeading(b, 0))
    expect(result.value).toBe('段落')
    expect(result.start).toBe(2)
  })
})

describe('changeHeadingLevel（⌘= 升 / ⌘- 降）', () => {
  it('升一级与降一级', () => {
    expect(run('## 中', 4, 4, (b) => changeHeadingLevel(b, -1)).value).toBe('# 中')
    expect(run('## 中', 4, 4, (b) => changeHeadingLevel(b, 1)).value).toBe('### 中')
  })

  it('四个边界全部无操作：段落升/降、h1 升、h6 降', () => {
    expect(run('段落', 2, 2, (b) => changeHeadingLevel(b, 1)).value).toBe('段落')
    expect(run('段落', 2, 2, (b) => changeHeadingLevel(b, -1)).value).toBe('段落')
    expect(run('# 一', 3, 3, (b) => changeHeadingLevel(b, -1)).value).toBe('# 一')
    expect(run('###### 六', 8, 8, (b) => changeHeadingLevel(b, 1)).value).toBe('###### 六')
  })

  it('光标跟随位移', () => {
    const result = run('## 标题', 5, 5, (b) => changeHeadingLevel(b, -1))
    expect(result.value).toBe('# 标题')
    expect(result.start).toBe(4)
  })
})

describe('clearFormat（⌘\：只剥行内标记）', () => {
  it('剥掉粗体/斜体/删除线/代码，保留文字', () => {
    const result = run('**粗** ~~删~~ `码` *斜*', 0, 19, (b) => clearFormat(b))
    expect(result.value).toBe('粗 删 码 斜')
  })

  it('链接只留文字', () => {
    expect(run('[文字](https://x)', 0, 15, (b) => clearFormat(b)).value).toBe('文字')
  })

  it('图片不被破坏（alt 里的链接不剥）', () => {
    const img = '![图](img.png)'
    expect(run(img, 0, img.length, (b) => clearFormat(b)).value).toBe(img)
  })

  it('嵌套标记逐层剥', () => {
    expect(run('**粗 *斜* 内**', 0, 11, (b) => clearFormat(b)).value).toBe('粗 斜 内')
  })

  it('空选区是无操作', () => {
    const result = run('**粗**', 1, 1, (b) => clearFormat(b))
    expect(result.value).toBe('**粗**')
    expect(result.start).toBe(1)
  })
})

describe('toggleBlockPrefix（⌥⌘Q/U/O/X：块级切换）', () => {
  it('引用：加与剥', () => {
    expect(run('引用', 2, 2, (b) => toggleBlockPrefix(b, 'quote')).value).toBe('> 引用')
    expect(run('> 引用', 5, 5, (b) => toggleBlockPrefix(b, 'quote')).value).toBe('引用')
  })

  it('无序列表：加、剥、以及从有序换标记', () => {
    expect(run('项', 1, 1, (b) => toggleBlockPrefix(b, 'ul')).value).toBe('- 项')
    expect(run('- 项', 4, 4, (b) => toggleBlockPrefix(b, 'ul')).value).toBe('项')
    expect(run('2. 项', 5, 5, (b) => toggleBlockPrefix(b, 'ul')).value).toBe('- 项')
    // 任务行已带 '-' 前缀：剥成普通段落是「已有该种前缀」的规则
    expect(run('- [ ] 事', 8, 8, (b) => toggleBlockPrefix(b, 'ul')).value).toBe('[ ] 事')
  })

  it('有序列表：加、剥、换标记，并重排编号', () => {
    expect(run('项', 1, 1, (b) => toggleBlockPrefix(b, 'ol')).value).toBe('1. 项')
    expect(run('- 项', 4, 4, (b) => toggleBlockPrefix(b, 'ol')).value).toBe('1. 项')
    expect(run('3. 项', 5, 5, (b) => toggleBlockPrefix(b, 'ol')).value).toBe('项')
    expect(run('9. 甲\n丙', 5, 5, (b) => toggleBlockPrefix(b, 'ol')).value).toBe('1. 甲\n2. 丙')
  })

  it('任务列表：加、剥、有列表时保留标记加勾选', () => {
    expect(run('事', 1, 1, (b) => toggleBlockPrefix(b, 'task')).value).toBe('- [ ] 事')
    expect(run('- [ ] 事', 9, 9, (b) => toggleBlockPrefix(b, 'task')).value).toBe('事')
    expect(run('- 项', 4, 4, (b) => toggleBlockPrefix(b, 'task')).value).toBe('- [ ] 项')
    expect(run('1. 项', 5, 5, (b) => toggleBlockPrefix(b, 'task')).value).toBe('1. [ ] 项')
  })

  it('选区覆盖多行时逐行切换', () => {
    const result = run('甲\n乙\n丙', 0, 4, (b) => toggleBlockPrefix(b, 'quote'))
    expect(result.value).toBe('> 甲\n> 乙\n丙')
    expect(result.start).toBe(0)
  })

  it('切换只作用光标所在行', () => {
    expect(run('a\n> b', 1, 1, (b) => toggleBlockPrefix(b, 'quote')).value).toBe('> a\n> b')
    expect(run('a\n> b', 2, 2, (b) => toggleBlockPrefix(b, 'quote')).value).toBe('a\nb')
  })
})

describe('indentSelection（⌘]/⌘[：镜像 Tab 语义）', () => {
  it('列表内缩进/反缩进并重排', () => {
    const inResult = run('- 甲', 4, 4, (b) => indentSelection(b, 'in'))
    // 无上层项时 Tab 是插普通空格（内核 plainIndent 语义）
    expect(inResult.value).toBe('- 甲  ')
    expect(inResult.start).toBe(6)
  })

  it('按 Shift+Tab 语义反缩进最外层项 = 出列表', () => {
    const result = run('- 甲', 4, 4, (b) => indentSelection(b, 'out'))
    expect(result.value).toBe('甲')
  })

  it('围栏内无操作', () => {
    const result = run('```\n- 甲\n```', 9, 9, (b) => indentSelection(b, 'in'))
    expect(result.value).toBe('```\n- 甲\n```')
  })
})

describe('insertFootnote（⌥⌘R）', () => {
  it('无选区：光标处插空引用，定义行追加文末', () => {
    const result = run('正文', 2, 2, insertFootnote)
    expect(result.value).toBe('正文[^1]\n\n[^1]: ')
  })

  it('有选区：文字不搬家，引用号跟在后面', () => {
    const result = run('一段文字', 1, 3, insertFootnote)
    expect(result.value).toBe('一段文[^1]字\n\n[^1]: ')
    expect(result.selected).toBe('[^1]')
  })

  it('编号取现存最大 +1', () => {
    const result = run('x[^2]y\n\n[^2]: 定义', 1, 1, insertFootnote)
    expect(result.value).toBe('x[^3][^2]y\n\n[^2]: 定义\n\n[^3]: ')
  })
})

describe('insertLinkReference（⌥⌘L）', () => {
  it('无选区无操作', () => {
    const result = run('文字', 2, 2, insertLinkReference)
    expect(result.value).toBe('文字')
  })

  it('有选区：包成引用式链接，定义行追加文末', () => {
    const result = run('链接文字', 0, 3, insertLinkReference)
    expect(result.value).toBe('[链接文][1]字\n\n[1]: ')
    expect(result.selected).toBe('[链接文][1]')
  })

  it('编号不与既有定义冲突', () => {
    const result = run('甲\n\n[1]: url', 0, 1, insertLinkReference)
    expect(result.value).toBe('[甲][2]\n\n[1]: url\n\n[2]: ')
  })
})

describe('insertHr（⌥⌘-）', () => {
  it('当前行后插入 ---，光标在其后', () => {
    const result = run('a\nb', 1, 1, insertHr)
    expect(result.value).toBe('a\n---\nb')
    expect(result.start).toBe(5)
  })

  it('最后一行后插入', () => {
    const result = run('a', 1, 1, insertHr)
    expect(result.value).toBe('a\n---')
    expect(result.start).toBe(5)
  })
})

describe('toggleInlineMath（⌃M）', () => {
  it('折叠光标扩选整词并包 $…$', () => {
    const result = run('甲=乙', 1, 1, toggleInlineMath)
    expect(result.value).toBe('$甲=乙$')
  })

  it('有选区直接包（不扩选）', () => {
    const result = run('前 x 后', 2, 3, toggleInlineMath)
    expect(result.value).toBe('前 $x$ 后')
  })

  it('光标在数学内部时剥除定界符（绝不插出 $$ 坏文本）', () => {
    expect(run('前 $a+b$ 后', 4, 4, toggleInlineMath).value).toBe('前 a+b 后')
    // \(…\) 形态同样剥
    expect(run('\\(x\\)', 2, 2, toggleInlineMath).value).toBe('x')
  })

  it('扩选包完后再次按 ⌃M 可剥掉（toggle 语义）', () => {
    const result = run('甲=乙', 1, 1, toggleInlineMath)
    const second = run(result.value, result.start, result.end, toggleInlineMath)
    expect(second.value).toBe('甲=乙')
  })
})

describe('clearFormat 与行内数学（`$` 恒剥、表达式保留）', () => {
  it('剥 $…$ / \\(…\\) / \\[…\\] 定界符', () => {
    expect(run('$E=mc^2$ 与 \\(\\alpha\\) 与 \\[\\beta\\]', 0, 33, (b) => clearFormat(b)).value).toBe('E=mc^2 与 \\alpha 与 \\beta')
  })
})
