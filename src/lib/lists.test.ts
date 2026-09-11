import { describe, expect, it } from 'vitest'
import { indentListItem, parseListItem, renumberLists } from './lists'

describe('renumberLists', () => {
  it('把回车后重复的编号顺延', () => {
    expect(renumberLists('1. 甲\n2. 乙\n3. \n3. 丙\n')).toBe('1. 甲\n2. 乙\n3. \n4. 丙\n')
  })

  it('每段有序列表从 1 开始，逐项递增', () => {
    expect(renumberLists('1. a\n1. b\n1. c\n')).toBe('1. a\n2. b\n3. c\n')
  })

  it('空行或非列表行结束编号', () => {
    expect(renumberLists('1. a\n2. b\n\n正文\n\n1. c\n2. d\n')).toBe(
      '1. a\n2. b\n\n正文\n\n1. c\n2. d\n',
    )
  })

  it('嵌套层级各自编号，回到浅层时深层序列重置', () => {
    const input = '1. a\n   1. a1\n   1. a2\n2. b\n   1. b1\n'
    expect(renumberLists(input)).toBe('1. a\n   1. a1\n   2. a2\n2. b\n   1. b1\n')
  })

  it('保持无序项与任务项原样，保留分隔符风格', () => {
    expect(renumberLists('- a\n1) b\n1) c\n- [ ] d\n')).toBe('- a\n1) b\n2) c\n- [ ] d\n')
  })

  it('不影响普通段落与围栏内容', () => {
    const input = '正文 1. 不是列表\n\n```\n1. 代码里的\n1. 还是代码\n```\n'
    expect(renumberLists(input)).toBe(input)
  })
})

describe('parseListItem', () => {
  it('拆出缩进、标记与正文', () => {
    expect(parseListItem('   1. 甲', 3)).toEqual({
      line: 3,
      indent: '   ',
      marker: '1. ',
      body: '甲',
    })
    expect(parseListItem('- [x] 完成', 0)?.marker).toBe('- [x] ')
    expect(parseListItem('普通段落', 0)).toBeNull()
  })
})

describe('indentListItem', () => {
  it('Tab 把有序项嵌到上一项之下，缩进用父项标记宽度', () => {
    const doc = '1. 甲\n2. 乙\n'
    const result = indentListItem(doc, doc.length - 1, 'in')
    expect(result?.doc).toBe('1. 甲\n   1. 乙\n')
    expect(result?.caret).toBe(doc.length - 1 + 3)
  })

  it('Tab 对无序项用两个空格', () => {
    const doc = '- 甲\n- 乙\n'
    expect(indentListItem(doc, doc.length - 1, 'in')?.doc).toBe('- 甲\n  - 乙\n')
  })

  it('Tab 在首项上无效（没有上一项可依附）', () => {
    expect(indentListItem('- 甲\n- 乙\n', 1, 'in')).toBeNull()
  })

  it('Shift+Tab 退回上一层，回到最外层后无效', () => {
    const doc = '1. 甲\n   1. 乙\n'
    const out = indentListItem(doc, doc.length - 1, 'out')
    expect(out?.doc).toBe('1. 甲\n2. 乙\n')
    expect(indentListItem('1. 甲\n2. 乙\n', 5, 'out')).toBeNull()
  })

  it('缩进后重新编号：新层级从 1 开始，原层级顺延', () => {
    const doc = '1. 甲\n2. 乙\n3. 丙\n'
    const result = indentListItem(doc, doc.indexOf('丙'), 'in')
    // 丙 缩到 乙 之下，成为新层级的第 1 项；甲乙仍在原层级顺延。
    expect(result?.doc).toBe('1. 甲\n2. 乙\n   1. 丙\n')
  })
})
