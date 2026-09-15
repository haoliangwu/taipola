import { describe, expect, it } from 'vitest'
import { computeLineStates, parseLine, stripInline, visibleToSourceIndex } from './inline'

/** One helper so each syntax case is one line of test data. */
function state(line: string) {
  const [first] = computeLineStates([line])
  return first
}

describe('parseLine：块级前缀', () => {
  const PREFIX_CASES: Array<[string, string]> = [
    ['- 无序', '- '],
    ['* 星号', '* '],
    ['+ 加号', '+ '],
    ['1. 有序', '1. '],
    ['2) 另一种有序', '2) '],
    ['- [x] 任务', '- [x] '],
    ['> 引用', '> '],
    ['  - 缩进两项', '  - '],
    ['    - 缩进四项', '    - '],
  ]
  it.each(PREFIX_CASES)('%s 的前缀是 %j', (line, prefix) => {
    expect(parseLine(line).prefix).toBe(prefix)
  })

  it('普通段落没有前缀', () => {
    expect(parseLine('正文').prefix).toBe('')
  })

  it('围栏、分隔线、表格行各有标志', () => {
    expect(parseLine('```ts').isFence).toBe(true)
    expect(parseLine('~~~').isFence).toBe(true)
    expect(parseLine('---').isRule).toBe(true)
    expect(parseLine('***').isRule).toBe(true)
    expect(parseLine('| a | b |').isTableRow).toBe(true)
    expect(parseLine('| --- | --- |').isTableDelimiter).toBe(true)
    expect(parseLine('| a | b |').isTableDelimiter).toBe(false)
  })
})

describe('computeLineStates：每种 markdown 语法', () => {
  it.each([
    ['# 一级', 'heading'],
    ['###### 六级', 'heading'],
    ['正文', 'text'],
    ['', 'blank'],
    ['   ', 'blank'],
    ['---', 'rule'],
    ['> 引用', 'quote'],
    ['- 项', 'list'],
    ['1. 项', 'list'],
    ['- [x] 已完成', 'task'],
    ['- [ ] 未完成', 'task'],
    ['| a | b |', 'table'],
    ['| --- | --- |', 'table-delim'],
    ['```', 'fence'],
    ['~~~js', 'fence'],
  ])('%j → kind %s', (line, kind) => {
    expect(state(line).kind).toBe(kind)
  })

  it('标题级别 1-6 依次记录下来', () => {
    const lines = ['# a', '## b', '### c', '#### d', '##### e', '###### f']
    expect(computeLineStates(lines).map((s) => s.level)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('有序与无序分开标记，任务框记录勾选状态', () => {
    expect(state('1. 项').ordered).toBe(true)
    expect(state('- 项').ordered).toBe(false)
    expect(state('- [x] 项').checked).toBe(true)
    expect(state('- [ ] 项').checked).toBe(false)
    expect(state('- 项').checked).toBeNull()
  })

  it('缩进与嵌套层级：每深一层加一，回到浅层就退回去', () => {
    const lines = ['- a', '  - b', '    - c', '- d', '  - e']
    const states = computeLineStates(lines)
    expect(states.map((s) => s.indent)).toEqual([0, 2, 4, 0, 2])
    expect(states.map((s) => s.listLevel)).toEqual([0, 1, 2, 0, 1])
  })

  it('非列表行结束嵌套：后面的列表重新从第 0 层算', () => {
    const states = computeLineStates(['- a', '  - b', '正文', '- c'])
    expect(states.map((s) => s.listLevel)).toEqual([0, 1, undefined, 0])
  })

  it('围栏内部一律是代码，里面的 # 与 - 不是标题也不是列表', () => {
    const lines = ['```ts', '# 不是标题', '- 不是列表', '**不解析**', '```', '# 这次是标题']
    const states = computeLineStates(lines)
    expect(states.map((s) => s.kind)).toEqual(['fence', 'code', 'code', 'code', 'fence', 'heading'])
  })

  it('~~~ 围栏与 ``` 一样，且不互相闭合', () => {
    const states = computeLineStates(['~~~', '```', '~~~'])
    expect(states.map((s) => s.kind)).toEqual(['fence', 'code', 'fence'])
  })

  it('围栏内的空行不影响闭合', () => {
    expect(computeLineStates(['```', '', '```']).map((s) => s.kind)).toEqual([
      'fence',
      'code',
      'fence',
    ])
  })

  it('引用里的列表仍算列表，且缩进照算', () => {
    const quoteList = computeLineStates(['> - a', '>   - b'])
    expect(quoteList.map((s) => s.kind)).toEqual(['list', 'list'])
    expect(quoteList.map((s) => s.indent)).toEqual([0, 2])
  })
})

describe('stripInline / visibleToSourceIndex', () => {
  it('剥掉行内标记只留文字', () => {
    expect(stripInline('**粗** 与 *斜* 与 `码`')).toBe('粗 与 斜 与 码')
    expect(stripInline('[链接](https://example.com)')).toBe('链接')
  })

  it('可见序号能映射回源码下标', () => {
    // 可见序号 0 = 第一个可见字符之前 = 源码 0
    expect(visibleToSourceIndex('**粗**', 0)).toBe(0)
    // 可见序号 1 = 越过「粗」之后 = 构造末尾
    expect(visibleToSourceIndex('**粗**', 1)).toBe(5)
    expect(visibleToSourceIndex('abc', 1)).toBe(1)
  })
})

/**
 * A footnote definition is a LINE KIND, not a paragraph.
 *
 * The renderer draws its marker from the line's class, so the definition has to
 * be recognisable per line — and the continuation lines have to come with it, or
 * a note written over two lines would be half styled.
 */
describe('脚注定义行', () => {
  it('定义行是 footnote 类型并带上标签', () => {
    expect(state('[^1]: 补充说明')).toMatchObject({ kind: 'footnote', footnoteLabel: '1' })
    // 缩进三个空格以内仍然算定义（与 markdown-it 的块级规则一致）。
    expect(state('   [^note]: 也认')).toMatchObject({ kind: 'footnote', footnoteLabel: 'note' })
  })

  it('带缩进的续行跟着定义走，但不重复画标记', () => {
    const states = computeLineStates(['[^1]: 第一行', '  第二行', '普通段落'])
    expect(states.map((s) => s.kind)).toEqual(['footnote', 'footnote', 'text'])
    expect(states[0].footnoteLabel).toBe('1')
    // 续行没有标签：渲染层只在有标签时画 `[1]`，否则会画出一个空的 `[]`。
    expect(states[1].footnoteLabel).toBeUndefined()
  })

  it('空行结束定义', () => {
    const states = computeLineStates(['[^1]: 补充', '', '  缩进但不在定义里'])
    expect(states[1].kind).toBe('blank')
    expect(states[2].kind).not.toBe('footnote')
  })

  it('正文中间的 [^1]: 不是定义（markdown-it 也只在块首认）', () => {
    expect(state('见 [^1]: 这是正文').kind).toBe('text')
  })

  it('引用里的懒续行不算定义（markdown-it 也把它当引用的正文）', () => {
    // `> 引用里` 的下一行没有 `>`，是 CommonMark 的懒续行 —— 它仍是引用里的正文，
    // 导出把它整段渲染在 blockquote 里。行级扫描看不见容器，所以要显式挡住：
    // 定义**可以**打断段落和列表，但**不能**打断一个正在懒续的引用。
    const states = computeLineStates(['> 引用里', '[^1]: 引用的一部分吗'])
    expect(states.map((s) => s.kind)).toEqual(['quote', 'text'])
  })

  it('引用结束（空行）之后，定义照常认', () => {
    const states = computeLineStates(['> 引用里', '', '[^1]: 定义'])
    expect(states[2]).toMatchObject({ kind: 'footnote', footnoteLabel: '1' })
  })

  it('段落与列表被打断时仍然是定义（markdown-it 两条都实测过）', () => {
    expect(computeLineStates(['正文第一行', '[^1]: 定义'])[1].kind).toBe('footnote')
    expect(computeLineStates(['- 列表项', '[^1]: 定义'])[1].kind).toBe('footnote')
    expect(computeLineStates(['- 列表项', '  [^1]: 缩进两格'])[1].kind).toBe('footnote')
  })

  it('带 > 前缀的定义行仍是引用（这一处编辑器与导出不同，且早于本次改动）', () => {
    // markdown-it 认 `> [^1]: x` 为定义（整行不产出可见内容），编辑器的行级前缀
    // 规则看不见容器内的定义，所以它显示成引用正文。这是**既有**的偏差，不是本次
    // 引入的：本票只负责把不引入新的偏差这件事钉住。
    expect(computeLineStates(['> [^1]: 带前缀'])[0].kind).toBe('quote')
  })

  it('围栏里的定义写法是代码内容', () => {
    const states = computeLineStates(['```', '[^1]: 不是定义', '```'])
    expect(states[1].kind).toBe('code')
  })
})

describe('stripInline 与行内数学', () => {
  it('$…$ 剥掉定界符、保留表达式', () => {
    expect(stripInline('标题 $E=mc^2$ 结尾')).toBe('标题 E=mc^2 结尾')
  })
})
