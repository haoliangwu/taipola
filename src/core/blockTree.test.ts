/**
 * 盒模型迁移第 1+2 步：块树 ↔ 源码双射（`.scratch/block-model/…`）。
 *
 * 断言的是一条台柱不变量：parseBlockTree 产出的块树，
 * serializeBlocks 能**逐字节**还原出源；反向（再 parse）又得到同一棵树。
 * welcome 全篇 + 各边界形态都过一遍 —— 任何未来改动（命令层走块语义时改
 * 序列化、或改 kind 判定）都必须先过这关，否则块树就不再是"源的真值"。
 */
import { describe, expect, it } from 'vitest'
import { WELCOME_DOC } from './welcome'
import { kindOfBlock, listItemDetails, parseBlockTree, type BlockNode } from './blockTree'
import { serializeBlocks, roundTripInvariant } from './serialize'

/** 覆盖全部块类型与边界形态的文档集。 */
const FIXTURES = [
  '草稿\n',
  '草稿',
  '甲段\n\n乙段\n',
  '甲段\n\n乙段',
  '甲段\n\n\n乙段\n', // 连续空行
  '甲段\n\n   \n\n乙段\n', // 空白行（非空源）
  '# 标题\n\n正文\n',
  '## 二\n\n- 甲\n- 乙\n',
  '- 甲\n  - 子甲\n  - 子乙\n    1. 有序\n    2. 继续\n- 乙\n',
  '> 引用甲\n> 引用乙\n\n> > 嵌套\n',
  '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
  '```typescript\nconst a = 1\n```\n',
  '```\necho hi\n```\n',
  '---\n',
  '[^1]: 脚注内容\n',
  '正文[^1]。\n\n[^1]: 脚注\n',
  '\\[E = mc^2\\]\n',
  '软换行：\n这行仍是同一段\n',
  '硬换行：  \n这行断开了\n',
]

describe('kindOfBlock 判定', () => {
  it('每种语义形状得到对应 kind', () => {
    const kind = (raw: string) => kindOfBlock({ raw, headingLevel: 0 })
    expect(kind('# 标题')).toBe('heading')
    expect(kind('## 二')).toBe('heading')
    expect(kind('正文。')).toBe('paragraph')
    expect(kind('> 引用')).toBe('blockquote')
    expect(kind('- 甲')).toBe('list')
    expect(kind('1. 甲')).toBe('list')
    expect(kind('| a |')).toBe('table')
    expect(kind('```ts')).toBe('fence')
    expect(kind('---')).toBe('rule')
    expect(kind('[^1]: 注')).toBe('footnote')
    expect(kind('')).toBe('blank')
    expect(kind('   ')).toBe('blank')
  })

  it('setext 标题（正文+下划线）与已解析的 headingLevel 一致', () => {
    expect(kindOfBlock({ raw: '标题', headingLevel: 1 })).toBe('heading')
    expect(kindOfBlock({ raw: '标题\n===', headingLevel: 1 })).toBe('heading')
    expect(kindOfBlock({ raw: '普通。', headingLevel: 0 })).toBe('paragraph')
  })
})

describe('serializeBlocks 字节双射', () => {
  it('serialize(parse(source)) === source，逐字节（含尾部换行有无）', () => {
    for (const source of [...FIXTURES, WELCOME_DOC]) {
      expect(serializeBlocks(parseBlockTree(source)), JSON.stringify(source.slice(0, 40))).toBe(
        source,
      )
    }
  })

  it('parse(serialize(parse(source))) 得到同一棵树（结构不变）', () => {
    for (const source of [...FIXTURES, WELCOME_DOC]) {
      expect(roundTripInvariant(source), JSON.stringify(source.slice(0, 40))).toBe(true)
    }
  })

  it('welcome 的块树语义齐全：标题/列表/表格/围栏/引用/脚注/空行都在', () => {
    const tree = parseBlockTree(WELCOME_DOC)
    const kinds = new Set(tree.blocks.map((b) => b.kind))
    expect(kinds).toContain('heading')
    expect(kinds).toContain('list')
    expect(kinds).toContain('table')
    expect(kinds).toContain('fence')
    expect(kinds).toContain('blockquote')
    expect(kinds).toContain('rule')
    expect(kinds).toContain('footnote')
    expect(kinds).toContain('blank')
    expect(kinds).toContain('paragraph')
    // 块树不携带源尾状态：尾随的空行本身就是树里的一个 blank 块。
  })

  it('块节点的 raw 是源切片，startLine/endLine 单调铺满', () => {
    const tree = parseBlockTree('甲\n\n乙\n')
    // 尾随的 \n 是源里的一个空行，也是树里的一个 blank 块——尾空行不额外记状态。
    expect(tree.blocks.map((b: BlockNode) => b.raw)).toEqual(['甲', '', '乙', ''])
    expect(tree.blocks[0]?.startLine).toBe(0)
    expect(tree.blocks[1]?.endLine).toBe(2)
    expect(tree.blocks[2]?.endLine).toBe(3)
    expect(tree.blocks[3]?.startLine).toBe(3)
    expect(tree.blocks[3]?.endLine).toBe(4)
  })
})
describe('列表块的 item 子块', () => {
  it('子弹列表：顶层项、嵌套项与续行分开', () => {
    const item = (raw: string) => listItemDetails(raw)
    expect(item('- 甲\n  - 子甲\n  续行（不是项）\n- 乙')).toEqual([
      { line: 0, indent: '', marker: '- ', body: '甲' },
      { line: 1, indent: '  ', marker: '- ', body: '子甲' },
      { line: 3, indent: '', marker: '- ', body: '乙' },
    ])
  })

  it('有序与任务 marker 原样保留', () => {
    const items = listItemDetails('1. 甲\n- [x] 完成\n- [ ] 未完成')
    expect(items.map((i) => i.marker)).toEqual(['1. ', '- [x] ', '- [ ] '])
    expect(items[1]?.body).toBe('完成')
  })

  it('parseBlockTree 把 items 填进 list 块', () => {
    const tree = parseBlockTree('- 甲\n- 乙\n\n正文\n')
    const list = tree.blocks.find((b) => b.kind === 'list')
    expect(list?.items?.map((i) => i.body)).toEqual(['甲', '乙'])
  })
})
