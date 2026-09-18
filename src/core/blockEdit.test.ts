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
import { enterMidParagraph, splitParagraphAtMid } from './blockEdit'

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