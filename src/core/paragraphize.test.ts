/**
 * 空行被输入占用时的处置（`.scratch/paragraph-spacing/issues/01`）。
 *
 * 断的是：两段之间**既有**空行上打字 = 字符并入前一段（软换行续行）+ 后一段的
 * 边界保留（Typora 真机实测，`甲\n\n乙` 打 x → `甲\nx\n\n乙`，间距不消失）；
 * Enter 开出的占位空行才补前边界成独立段落；所有非本形状的编辑（段中插入、
 * 删除、替换）原样不动。
 */
import { describe, expect, it } from 'vitest'
import { paragraphizeTypedBlankLine } from './paragraphize'

describe('paragraphizeTypedBlankLine', () => {
  it('两段之间夹空行：字符并入前段（软换行），后段边界保留', () => {
    // 'A\n\nB' 的空行上打 X：'A\nX\nB' → 只补后边界 → 'A\nX\n\nB'
    // （X 与 A 同段紧挨，B 与间距不消失——Typora 实测）
    expect(paragraphizeTypedBlankLine('A\n\nB', 'A\nX\nB', 3)).toEqual({
      doc: 'A\nX\n\nB',
      caret: 3,
    })
  })

  it('段尾 Enter 开出的空行（后一行是空）：补前边界成新段', () => {
    // 'A\n' 行尾 Enter 后的空行打 X：补出前边界 → 'A\n\nX'，新段保留
    expect(paragraphizeTypedBlankLine('A\n', 'A\nX', 3)).toEqual({ doc: 'A\n\nX', caret: 4 })
  })

  it('段尾 Enter 开出的空行（后一行也是空）：补前边界成新段', () => {
    // 'A\n\n\nB' 第一个空行打 X → 补前边界 → 'A\n\nX\n\nB'
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