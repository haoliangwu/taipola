/**
 * 空行被输入占用 → 该行成为独立段落（`.scratch/paragraph-spacing/issues/01`）。
 *
 * 断的是：段落边界在任何输入下都保住，段落间距（挂段落块的 margin）因此
 * 不会"随输入消失"；以及所有非本形状的编辑（段中插入、删除、替换）原样不动。
 */
import { describe, expect, it } from 'vitest'
import { paragraphizeTypedBlankLine } from './paragraphize'

describe('paragraphizeTypedBlankLine', () => {
  it('两段之间夹空行：输入后两侧补出段落边界', () => {
    // 'A\n\nB' 的空行上打 X：'A\nX\nB' → 'A\n\nX\n\nB'
    expect(paragraphizeTypedBlankLine('A\n\nB', 'A\nX\nB', 3)).toEqual({
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

  it('连续多个空行：只补缺的一侧，原空行保留', () => {
    // 'A\n\n\nB' 第一个空行打 X → 'A\nX\n\nB' → 补前边界 → 'A\n\nX\n\nB'
    expect(paragraphizeTypedBlankLine('A\n\n\nB', 'A\nX\n\nB', 3)).toEqual({
      doc: 'A\n\nX\n\nB',
      caret: 4,
    })
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
