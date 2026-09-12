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

  /**
   * 列表在什么情况下**没有**结束。
   *
   * 渲染器是权威：下面每组都先用 markdown-it 看结构，再要求源码里的序数和它一致。
   * 续行、松列表里的空行、项里缩进的围栏都不结束列表，所以后面的同级项要保持序数——
   * 旧实现见到"不是列表项的行"就清空计数器，把同级项改写成 `1.`，而画面还在往下数。
   */
  it('续行不结束列表：后面的同级项保持序数', () => {
    const input = '1. 甲\n   1. 乙\n      乙的续行\n3. 丙\n'
    const out = renumberLists(input)
    expect(out).toBe('1. 甲\n   1. 乙\n      乙的续行\n2. 丙\n')
    // 丙 是同一个 <ol> 里的第 2 项，所以源码里必须是 2。
    expect(structure(out)).toContain('<li>乙乙的续行</li></ol></li><li>丙</li></ol>')
  })

  it('松列表里的空行不结束列表', () => {
    const input = '1. 甲\n   1. 乙\n\n      - 子一\n3. 丙\n'
    const out = renumberLists(input)
    expect(out).toBe('1. 甲\n   1. 乙\n\n      - 子一\n2. 丙\n')
    expect(structure(out)).toContain('</li></ol></li><li>丙</li></ol>')
  })

  it('项里缩进的围栏不结束列表，围栏里那行也不参与编号', () => {
    const input = '1. 甲\n   1. 乙\n      ```\n      1. 假的\n      ```\n3. 丙\n'
    const out = renumberLists(input)
    expect(out).toBe('1. 甲\n   1. 乙\n      ```\n      1. 假的\n      ```\n2. 丙\n')
    expect(structure(out)).toContain('<pre><code>1. 假的</code></pre>')
  })

  it('标记类型变了就是新列表：那一层的计数器跟着重置', () => {
    // 渲染是三个列表（ol / ul / ol），第三个从 1 开始。
    expect(renumberLists('1. a\n- b\n1. c\n')).toBe('1. a\n- b\n1. c\n')
    // 空行 + 换成无序标记，同样不该把 ol 的序数带过去。
    expect(renumberLists('1. a\n\n- b\n1. c\n')).toBe('1. a\n\n- b\n1. c\n')
  })

  /**
   * "哪些行在项里"的界线是**内容列**（缩进 + 标记宽度），不是标记的缩进。
   *
   * 缩进 1–2 格的段落不在 `1. a` 项里，它会结束列表；把它当成项里的内容，
   * 既会算错后面列表的序数，还会让它被并进下一个列表项的文字里
   * （`正文2. c` —— 只有 `1.` 能打断段落）。
   */
  it('缩进不足内容列的正文结束列表', () => {
    const input = '1. a\n2. b\n\n 正文\n\n1. c\n2. d\n'
    expect(renumberLists(input)).toBe(input)
    expect(structure(renumberLists(input))).toContain('<p>正文</p><ol><li>c</li><li>d</li></ol>')

    const glued = '1. a\n\n 正文\n1. c\n'
    expect(renumberLists(glued)).toBe(glued)
    expect(structure(renumberLists(glued))).toContain('<p>正文</p>')
  })

  it('缩进不足内容列的围栏同样结束列表', () => {
    const input = '1. a\n2. b\n\n ```\nx\n ```\n1. c\n'
    expect(renumberLists(input)).toBe(input)
    expect(structure(renumberLists(input))).toContain('<pre><code>x</code></pre><ol><li>c</li></ol>')
  })

  /**
   * 空行之后接回来的是**哪一层**，要看那一层自己的标记类型，不是最内层的。
   *
   * `1. a / - b / (空行) / 1. c` 里嵌进去的是无序列表，回到顶格的 `1. c`
   * 仍然属于外层那个 ol，所以它该是 2。
   */
  it('空行之后接回来的是外层列表：按那一层的标记类型判断', () => {
    const input = '1. a\n   - b\n\n1. c\n'
    const out = renumberLists(input)
    expect(out).toBe('1. a\n   - b\n\n2. c\n')
    // c 是外层那个 ol 的第 2 项（空行让它变成松列表，所以项里包着 <p>）。
    expect(structure(out)).toContain('<li><p>c</p></li></ol>')

    // 更深一层同理：回到子列表那一层，就按子列表那一层计数。
    const deep = '1. a\n   1. b\n      - c\n\n   1. d\n'
    expect(renumberLists(deep)).toBe('1. a\n   1. b\n      - c\n\n   2. d\n')
    expect(structure(renumberLists(deep))).toContain('<li><p>d</p></li></ol>')
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

  it('Tab 在列表首项上不是列表操作：在光标处插入两个空格', () => {
    const doc = '- 甲\n- 乙\n'
    // 没有上一项可依附，Tab 退化成一次普通按键：两个空格落在光标处。
    expect(indentListItem(doc, 2, 'in')).toEqual({ doc: '-   甲\n- 乙\n', caret: 4 })
  })

  it('Tab 在列表首项：插在光标处，不是把整行右移', () => {
    const doc = '- 甲乙\n'
    const result = indentListItem(doc, 3, 'in')
    expect(result).toEqual({ doc: '- 甲  乙\n', caret: 5 })
    // 列表结构不变：还是同一个列表。
    expect(structure(result!.doc)).toBe('<ul><li>甲  乙</li></ul>')
  })

  it('Tab 在首项时不重新编号（它不是列表层级的变化）', () => {
    const doc = '1. 甲\n2. 乙\n'
    // 若这条路径顺手跑了 renumberLists，`2. 乙`（顶格、被当成另一层）会被改写成 `1. 乙`，
    // 而画面上它还是第 2 项。
    expect(indentListItem(doc, 3, 'in')).toEqual({ doc: '1.   甲\n2. 乙\n', caret: 5 })
  })

  it('Tab 只动那一行：子列表留在原缩进，不跟着走', () => {
    const doc = '1. 甲\n2. 乙\n   - 子一\n3. 丙\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'in')
    expect(result?.doc).toBe('1. 甲\n   1. 乙\n   - 子一\n2. 丙\n')
    // 子列表被上一项接管 —— 这是设计（Typora 的缩进是行级的），不是缺陷。
    // 编号照样同步：`3. 丙` 变成新序列的 `2. 丙`。
    expect(structure(result!.doc)).toContain('<li>甲<ol><li>乙</li></ol><ul><li>子一</li></ul></li>')
  })

  it('Tab 的上一项可以跳过空行与续行（松列表、续行之后都不算"首行"）', () => {
    // 空行不结束列表：`2. 乙` 仍是这一列表的第二项，Tab 应该缩进它。
    const loose = '1. 甲\n\n2. 乙\n'
    expect(indentListItem(loose, loose.indexOf('乙'), 'in')?.doc).toBe('1. 甲\n\n   1. 乙\n')
    // 续行也一样：上一行是甲的续行，不等于"上面没有项"。
    const continued = '1. 甲\n   甲的续行\n2. 乙\n'
    expect(indentListItem(continued, continued.indexOf('乙'), 'in')?.doc).toBe(
      '1. 甲\n   甲的续行\n   1. 乙\n',
    )
  })

  it('围栏里的"列表行"不是列表项：Tab / Shift+Tab 都不碰它', () => {
    const doc = '```\n1. 甲\n- 乙\n```\n'
    expect(indentListItem(doc, doc.indexOf('甲'), 'in')).toBeNull()
    expect(indentListItem(doc, doc.indexOf('甲'), 'out')).toBeNull()
    expect(indentListItem(doc, doc.indexOf('乙'), 'in')).toBeNull()
  })

  it('Shift+Tab 退回上一层', () => {
    const doc = '1. 甲\n   1. 乙\n'
    const out = indentListItem(doc, doc.length - 1, 'out')
    expect(out?.doc).toBe('1. 甲\n2. 乙\n')
    // 已经在最外层时不是"无效"，而是变正文：见下面 T3 那一组。
  })

  it('缩出时编号位数变了，光标仍停在正文里原来的位置', () => {
    const doc = '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n   1. jjj\n'
    const result = indentListItem(doc, doc.length - 1, 'out')
    // 缩出成第 10 项：标记从 `1. ` 变成 `10. `，比原来宽一格。
    expect(result?.doc.endsWith('10. jjj\n')).toBe(true)
    // 光标本来在行末，重排之后仍然在行末——按 `offset + delta` 算会差一格。
    expect(result?.caret).toBe(result!.doc.length - 1)
  })

  it('缩进后重新编号：新层级从 1 开始，原层级顺延', () => {
    const doc = '1. 甲\n2. 乙\n3. 丙\n'
    const result = indentListItem(doc, doc.indexOf('丙'), 'in')
    // 丙 缩到 乙 之下，成为新层级的第 1 项；甲乙仍在原层级顺延。
    expect(result?.doc).toBe('1. 甲\n2. 乙\n   1. 丙\n')
  })
})

/**
 * T3：最外层的项按 Shift+Tab —— 不是"无效"，而是**离开列表变正文**。
 *
 * 正文两侧要各补一个空行：紧接着列表项的正文行只是 lazy continuation，
 * 会被并进上一项（`1. 甲\n乙\n3. 丙` 渲染成 `<li>甲乙</li>`），
 * 补了空行才是真的"两个列表"。
 */
describe('Shift+Tab 在最外层：该项变正文，列表断成两个', () => {
  it('列表中间的项：两侧各补一个空行，后面的列表从 1 开始', () => {
    const doc = '1. 甲\n2. 乙\n3. 丙\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'out')
    expect(result?.doc).toBe('1. 甲\n\n乙\n\n1. 丙\n')
    expect(result?.caret).toBe(6) // 正文 `乙` 的行首
    expect(structure(result!.doc)).toBe('<ol><li>甲</li></ol><p>乙</p><ol><li>丙</li></ol>')
  })

  it('列表首项：上方不凭空多出空行', () => {
    const doc = '- 甲\n- 乙\n'
    const result = indentListItem(doc, 2, 'out')
    expect(result?.doc).toBe('甲\n\n- 乙\n')
    expect(result?.caret).toBe(0)
    expect(structure(result!.doc)).toBe('<p>甲</p><ul><li>乙</li></ul>')
  })

  it('只有一个项：不留空行，也不留空列表', () => {
    const doc = '1. 甲\n'
    expect(indentListItem(doc, doc.indexOf('甲'), 'out')).toEqual({ doc: '甲\n', caret: 0 })
  })

  it('末项：只在前面补空行，后面不凭空多出空行', () => {
    const doc = '1. 甲\n2. 乙\n'
    const result = indentListItem(doc, doc.indexOf('乙'), 'out')
    expect(result?.doc).toBe('1. 甲\n\n乙\n')
    expect(result?.caret).toBe(6)
    expect(structure(result!.doc)).toBe('<ol><li>甲</li></ol><p>乙</p>')
  })

  it('光标按重排之后的文本算：上方的 `10.` 变成 `1.` 会挪动偏移', () => {
    const doc = '9. 甲\n10. 乙\n11. 丙\n'
    const result = indentListItem(doc, doc.indexOf('丙'), 'out')
    expect(result?.doc).toBe('1. 甲\n2. 乙\n\n丙\n')
    // 正文 `丙` 在重排后的文档里行首是 11（旧算法按重排前的文本算，给 12）。
    expect(result?.caret).toBe(11)
  })

  it('任务项：标记（含复选框）一起消失', () => {
    const doc = '- [ ] 待办\n- 乙\n'
    expect(indentListItem(doc, doc.indexOf('待办'), 'out')?.doc).toBe('待办\n\n- 乙\n')
  })

  it('正文上 Shift+Tab 什么也不做（不是列表项）', () => {
    expect(indentListItem('正文\n', 0, 'out')).toBeNull()
  })
})
