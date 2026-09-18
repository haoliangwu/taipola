/**
 * 空行被输入占用时的处置（`.scratch/paragraph-spacing/issues/01`）。
 *
 * 断的是：结构外的空行被打字占用 = 该行**新建一个块**（用户裁定，十审）——
 * 补上缺失的两侧边界成为独立段落（`甲\n\n乙` 打 x → `甲\n\nx\n\n乙`，三段；
 * `甲\n` Enter 打 x → `甲\n\nx`）；所有非本形状的编辑（段中插入、删除、
 * 替换）原样不动。
 */
import { describe, expect, it } from 'vitest'
import { paragraphizeTypedBlankLine } from './paragraphize'

describe('paragraphizeTypedBlankLine', () => {
  it('两段之间夹空行：输入后两侧补出段落边界（x 成为新块）', () => {
    // 'A\n\nB' 的空行上打 X：'A\nX\nB' → 'A\n\nX\n\nB' —— 三个段落
    expect(paragraphizeTypedBlankLine('A\n\nB', 'A\nX\nB', 3)).toEqual({
      doc: 'A\n\nX\n\nB',
      caret: 4,
    })
  })

  it('段尾 Enter 开出的空行：补前边界成新段', () => {
    // 'A\n' 行尾 Enter 后的空行打 X：补出前边界 → 'A\n\nX'，新段保留
    expect(paragraphizeTypedBlankLine('A\n', 'A\nX', 3)).toEqual({ doc: 'A\n\nX', caret: 4 })
  })

  it('连续多个空行：只补缺的一侧，原空行保留', () => {
    // 'A\n\n\nB' 第一个空行打 X → 'A\nX\n\nB' → 补前边界 → 'A\n\nX\n\nB'
    expect(paragraphizeTypedBlankLine('A\n\n\nB', 'A\nX\n\nB', 3)).toEqual({
      doc: 'A\n\nX\n\nB',
      caret: 4,
    })
  })

  it('文档开头的空行：后侧补边界，前侧不补', () => {
    expect(paragraphizeTypedBlankLine('\nB', 'X\nB', 1)).toEqual({ doc: 'X\n\nB', caret: 1 })
  })

  it('文档末尾的空行：前侧已由原文的空行 fence，后侧不补', () => {
    expect(paragraphizeTypedBlankLine('A\n\n', 'A\n\nX', 4)).toBeNull()
  })

  it('段落中间打字：不触发（原行不是空行）', () => {
    expect(paragraphizeTypedBlankLine('AB', 'AXB', 2)).toBeNull()
  })

  it('删除/替换：不触发', () => {
    expect(paragraphizeTypedBlankLine('A\n\nB', 'A\nB', 2)).toBeNull()
    expect(paragraphizeTypedBlankLine('A\nX\nB', 'A\nY\nB', 3)).toBeNull()
  })

  it('键入后整行仍是空白（空格）：不触发', () => {
    expect(paragraphizeTypedBlankLine('A\n\nB', 'A\n \nB', 3)).toBeNull()
  })
})