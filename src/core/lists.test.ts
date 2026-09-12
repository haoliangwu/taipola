import { describe, expect, it } from 'vitest'
import { indentListItem, parseListItem, renumberLists } from './lists'
import { md } from './markdownIt'

/** markdown-it's own structure for `source`, with whitespace folded away. */
const structure = (source: string) => md.render(source).replace(/\s*\n\s*/g, '')

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

/**
 * 缩进的主体是一个"项"，不是一行：子列表、续行、项里的围栏都在下面那几行上，
 * 它们必须跟着一起平移。只重写 `lines[index]` 会把子列表留在原缩进，
 * 于是它从"这一项的子列表"变成"上一项下的另一个列表"——换父，不是少缩几格。
 *
 * 结构断言一律走 markdown-it，不比空格数：空格对了结构错也是可能的。
 */
describe('indentListItem 带着整个项一起走', () => {
  it('有序项下的无序子列表：仍在那一项内部（不再被劈成两个列表）', () => {
    const doc = '1. 甲\n2. 乙\n   - 子一\n   - 子二\n3. 丙\n'
    const offset = doc.indexOf('乙')
    const result = indentListItem(doc, offset, 'in')
    expect(result?.doc).toBe('1. 甲\n   1. 乙\n      - 子一\n      - 子二\n2. 丙\n')
    // 光标在项自己那行，随该项的缩进一起走。
    expect(result?.caret).toBe(offset + 3)
    expect(structure(result!.doc)).toContain('<li>乙<ul><li>子一</li><li>子二</li></ul></li>')
  })

  it('有序项下的有序子列表：子列表跟着走，不被顺延成兄弟', () => {
    const doc = '1. 甲\n2. 乙\n   1. 子一\n3. 丙\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'in')
    expect(result?.doc).toBe('1. 甲\n   1. 乙\n      1. 子一\n2. 丙\n')
    expect(structure(result!.doc)).toContain('<li>乙<ol><li>子一</li></ol></li>')
  })

  it('无序项下的子列表同样跟着走', () => {
    const doc = '- 甲\n- 乙\n  - 子一\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'in')
    expect(result?.doc).toBe('- 甲\n  - 乙\n    - 子一\n')
    expect(structure(result!.doc)).toContain('<li>乙<ul><li>子一</li></ul></li>')
  })

  it('多行项的续行跟着一起平移（不再靠 lazy continuation 侥幸并进去）', () => {
    // 不留后续兄弟项：续行会让 renumberLists 清空编号（另见
    // `.scratch/list-renumber/issues/01`），那是另一条规则，别混进这条断言。
    const doc = '1. 甲\n2. 乙\n   乙的续行\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'in')
    expect(result?.doc).toBe('1. 甲\n   1. 乙\n      乙的续行\n')
    // 续行仍并进乙：渲染出的是一个 li，不是一个 li 加一个段落。
    expect(structure(result!.doc)).toContain('<li>乙乙的续行</li>')
  })

  it('松列表里夹着的空行不跟着平移，也不会被写上缩进', () => {
    const doc = '1. 甲\n2. 乙\n\n   - 子一\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'in')
    expect(result?.doc).toBe('1. 甲\n   1. 乙\n\n      - 子一\n')
    expect(structure(result!.doc)).toContain('<li><p>乙</p><ul><li>子一</li></ul></li>')
  })

  it('Shift+Tab 也带着子项走：子项的相对层级不变', () => {
    const doc = '1. 甲\n   1. 乙\n      - 子一\n2. 丙\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'out')
    expect(result?.doc).toBe('1. 甲\n2. 乙\n   - 子一\n3. 丙\n')
    expect(structure(result!.doc)).toContain('<li>乙<ul><li>子一</li></ul></li>')
  })

  it('主体永远是光标所在的那一项：在子项上按 Tab 只动子项', () => {
    const doc = '1. 甲\n2. 乙\n   - 子一\n   - 子二\n3. 丙\n'
    const result = indentListItem(doc, doc.indexOf('子二'), 'in')
    // 子二 嵌到 子一 之下；父项、子一、丙 都不动。
    expect(result?.doc).toBe('1. 甲\n2. 乙\n   - 子一\n     - 子二\n3. 丙\n')
  })

  it('光标在续行上时 Tab 什么也不做（续行不是列表项）', () => {
    const doc = '1. 甲\n2. 乙\n   乙的续行\n'
    expect(indentListItem(doc, doc.indexOf('续行'), 'in')).toBeNull()
  })

  it('项里缩进的围栏块跟着一起平移', () => {
    const doc = '1. 甲\n2. 乙\n   ```js\n   x = 1\n   ```\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'in')
    expect(result?.doc).toBe('1. 甲\n   1. 乙\n      ```js\n      x = 1\n      ```\n')
    expect(structure(result!.doc)).toContain('<li>乙<pre><code class="language-js">')
  })

  it('行级规则的边界：齐左的续行不在跨度里', () => {
    // 这一层看不到解析器，只能按缩进判断"哪几行属于这一项"。齐左的续行缩进并不大于
    // 该项，所以留在原地——它仍然被渲染进这一项，靠的是 Markdown 的 lazy
    // continuation，不是我们把它缩进去的。实测与边界都记在
    // `.scratch/list-indent/issues/01-indent-does-not-carry-nested-items.md`。
    const doc = '1. 甲\n2. 乙\n续行\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'in')
    expect(result?.doc).toBe('1. 甲\n   1. 乙\n续行\n')
    expect(structure(result!.doc)).toContain('<li>乙续行</li>')
  })

  it('光标不在列表项上时什么也不做（项外）', () => {
    expect(indentListItem('正文\n- 甲\n', 0, 'in')).toBeNull()
  })

  it('缩出时光标若落在被删掉的缩进里，就贴到行首，不跳进上一块', () => {
    const doc = '1. 甲\n   1. 乙\n'
    const result = indentListItem(doc, 7, 'out') // 行内第 2 列，正处于 '   ' 这段缩进里
    expect(result?.doc).toBe('1. 甲\n2. 乙\n')
    expect(result?.caret).toBe(5) // 新行首，而不是上一行末尾（更不是文档开头）
  })
})
