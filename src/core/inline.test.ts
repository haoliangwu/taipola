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

  it('围栏里的定义写法是代码内容', () => {
    const states = computeLineStates(['```', '[^1]: 不是定义', '```'])
    expect(states[1].kind).toBe('code')
  })
})
