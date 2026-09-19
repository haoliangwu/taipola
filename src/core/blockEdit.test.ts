/**
 * 盒模型迁移第 3 步首个切片：段落中段硬换行走块语义
 * （`.scratch/block-model/issues/02`）。
 *
 * 断的是台柱不变量：中段 Enter 的产出与旧实现**逐字符一致**（`甲也` 中段 →
 * `甲\n\n也`，光标 +2），且新源仍是合法块树（serialize→parse 双射不破）。
 * 块树编辑的行号平移也在断言的射程内：拆一块，后面的块都要往下挪两行。
 */
import { describe, expect, it } from 'vitest'
import { parseBlockTree, type BlockNode, type BlockTree } from './blockTree'
import { serializeBlocks, roundTripInvariant } from './serialize'
import {
  backspaceJoinParagraphs,
  enterEndParagraph,
  enterMidParagraph,
  growParagraphGap,
  joinParagraphWithAbove,
  splitParagraphAtMid,
} from './blockEdit'

const par = (raw: string, startLine: number, endLine?: number): BlockNode => ({
  kind: 'paragraph' as const,
  raw,
  startLine,
  endLine: endLine ?? startLine + 1,
  headingLevel: 0,
})

describe('splitParagraphAtMid 块语义', () => {
  it('中段拆成 [A, blank, B]，行号正确铺满', () => {
    const tree = {
      blocks: [
        par('前', 0),
        par('甲也', 1),
        par('后', 2),
      ],
    }
    const result = splitParagraphAtMid(tree, 1, 1)
    expect(result).not.toBeNull()
    expect(result!.tree.blocks.map((b) => b.raw)).toEqual(['前', '甲', '', '也', '后'])
    expect(result!.tree.blocks.map((b) => `${b.startLine}-${b.endLine}`)).toEqual([
      '0-1',
      '1-2',
      '2-3',
      '3-4',
      '4-5', // 「后」原 2-3 → 平移 +2
    ])
    expect(result!.addedChars).toBe(2)
  })

  it('serialize 产出与字符串实现逐字相同', () => {
    const tree: BlockTree = { blocks: [par('前', 0), par('甲也', 1), par('后', 2)] }
    const result = splitParagraphAtMid(tree, 1, 1)!
    expect(serializeBlocks(result.tree)).toBe('前\n甲\n\n也\n后')
  })

  it('串尾拆块：列表/引用块不在切片范围（返回 null 走回退）', () => {
    const tree: BlockTree = {
      blocks: [
        { ...par('甲也', 0), kind: 'list' },
        { ...par('乙', 1), kind: 'blockquote' },
      ],
    }
    expect(splitParagraphAtMid(tree, 0, 1)).toBeNull()
    expect(splitParagraphAtMid(tree, 1, 1)).toBeNull()
  })

  it('多重行段（软换行）不在切片范围', () => {
    const tree: BlockTree = { blocks: [par('甲\n乙', 0, 2)] }
    expect(splitParagraphAtMid(tree, 0, 1)).toBeNull()
  })
})

describe('enterMidParagraph（命令级，旧行为逐字一致）', () => {
  it('段落中段 Enter：前后文拼接正确、光标 = live + 2', () => {
    // source '甲也\n\n后'：甲也 是段落块（块 0，live 在 甲|也 = offset 1）
    const result = enterMidParagraph('甲也\n\n后', 0, 1, 1)
    expect(result).toEqual({ source: '甲\n\n也\n\n后', caret: 3 })
  })

  it('拆完的新树 round-trip 不破（双射）', () => {
    const source = '前文。\n\n甲也\n\n后文。\n'
    const tree = parseBlockTree(source)
    const paragraphIndex = tree.blocks.findIndex((b) => b.kind === 'paragraph' && b.raw === '甲也')
    const result = splitParagraphAtMid(tree, paragraphIndex, 1)!
    expect(roundTripInvariant(serializeBlocks(result.tree))).toBe(true)
  })
})
describe('joinParagraphWithAbove（Backspace 行首并段）', () => {
  it('段 A、单个空行、段 B → 合并成软换行段，后续行号 -1', () => {
    const tree: BlockTree = {
      blocks: [
        par('前', 0),
        par('甲', 1),
        blank(2),
        par('乙', 3),
        par('后', 4),
      ],
    }
    const joined = joinParagraphWithAbove(tree, 3)
    expect(joined).not.toBeNull()
    expect(joined!.blocks.map((b) => b.raw)).toEqual(['前', '甲\n乙', '后'])
    expect(joined!.blocks.map((b) => `${b.startLine}-${b.endLine}`)).toEqual(['0-1', '1-3', '3-4'])
  })

  it('serialize 与字符串实现逐字相同（一次 Backspace 删一个换行）', () => {
    const tree: BlockTree = {
      blocks: [par('甲', 0), blank(1), par('乙', 2)],
    }
    const joined = joinParagraphWithAbove(tree, 2)!
    expect(serializeBlocks(joined)).toBe('甲\n乙')
  })

  it('多个空行 / 光标块不是段落段 → 返回 null 走回退', () => {
    const doubleBlank: BlockTree = { blocks: [par('甲', 0), par('空', 1, 3), par('乙', 3)] }
    const listAbove: BlockTree = { blocks: [par('甲', 0), blank(1), { ...par('乙', 2), kind: 'list' }] }
    expect(joinParagraphWithAbove(doubleBlank, 2)).toBeNull()
    expect(joinParagraphWithAbove(listAbove, 2)).toBeNull()
  })

  it('上方是软换行多行段同样可并（字符串路径也只删一个换行）', () => {
    const softAbove: BlockTree = { blocks: [par('甲\n续', 0, 2), blank(2), par('乙', 3)] }
    const joined = joinParagraphWithAbove(softAbove, 2)
    expect(joined).not.toBeNull()
    expect(joined!.blocks[0]?.raw).toBe('甲\n续\n乙')
  })

  it('命令级：合并后 round-trip 不破', () => {
    const source = '前文。\n\n甲\n\n乙\n\n后文。'
    const tree = parseBlockTree(source)
    const index = tree.blocks.findIndex((b) => b.kind === 'paragraph' && b.raw === '乙')
    expect(index).toBeGreaterThan(0)
    const next = backspaceJoinParagraphs(source, index)!
    expect(next).toBe('前文。\n\n甲\n乙\n\n后文。')
    expect(roundTripInvariant(next)).toBe(true)
  })
})

const blank = (startLine: number): BlockNode => ({
  kind: 'blank' as const,
  raw: '',
  startLine,
  endLine: startLine + 1,
  headingLevel: 0,
})

describe('growParagraphGap（行尾 Enter）', () => {
  it('段落后有空行：插入新空行块，后续整体 +1', () => {
    const tree: BlockTree = { blocks: [par('甲', 0), blank(1), par('乙', 2), par('后', 3)] }
    const grown = growParagraphGap(tree, 0)!
    expect(serializeBlocks(grown.tree)).toBe('甲\n\n\n乙\n后')
    expect(grown.tree.blocks.map((b) => `${b.startLine}-${b.endLine}`)).toEqual([
      '0-1', '1-2', '2-3', '3-4', '4-5',
    ])
    expect(grown.addedChars).toBe(1)
    expect(grown.caretDelta).toBe(1)
  })

  it('段落是末块且无尾换行：追加一个空行块', () => {
    const tree: BlockTree = { blocks: [par('甲', 0)] }
    const grown = growParagraphGap(tree, 0)!
    expect(serializeBlocks(grown.tree)).toBe('甲\n')
    expect(grown.tree.blocks.map((b) => `${b.startLine}-${b.endLine}`)).toEqual(['0-1', '1-2'])
  })

  it('段落是末块但有尾空行：空行 +1（= 两次 Enter 之间）', () => {
    const tree: BlockTree = { blocks: [par('甲', 0), blank(1)] }
    const grown = growParagraphGap(tree, 0)!
    expect(serializeBlocks(grown.tree)).toBe('甲\n\n')
  })

  it('非段落块 → null 回退；多行软换行段的段尾 Enter 同样开空块（九审）', () => {
    const list: BlockTree = { blocks: [{ ...par('甲', 0), kind: 'list' }, blank(1)] }
    const soft: BlockTree = { blocks: [par('甲\n乙', 0, 2), blank(2)] }
    expect(growParagraphGap(list, 0)).toBeNull()
    const grown = growParagraphGap(soft, 0)!
    expect(serializeBlocks(grown.tree)).toBe('甲\n乙\n\n')
    expect(grown.tree.blocks.map((b) => `${b.startLine}-${b.endLine}`)).toEqual([
      '0-2', '2-3', '3-4',
    ])
    expect(grown.addedChars).toBe(1)
    expect(grown.caretDelta).toBe(1)
  })

  it('命令级：round-trip 不破，caretDelta 区分追加/生长', () => {
    const source = '前面。\n\n段落\n\n后面。'
    const tree = parseBlockTree(source)
    const index = tree.blocks.findIndex((b) => b.kind === 'paragraph' && b.raw === '段落')
    const next = enterEndParagraph(source, index)!
    expect(next.source).toBe('前面。\n\n段落\n\n\n后面。')
    // Enter 插入的新空行紧跟段落：光标 = 段尾 + 1 个换行
    expect(next.caretDelta).toBe(1)
    expect(roundTripInvariant(next.source)).toBe(true)
    const lastIndex = parseBlockTree('末段').blocks.length - 1
    expect(enterEndParagraph('末段', lastIndex)!.caretDelta).toBe(1)
  })
})
