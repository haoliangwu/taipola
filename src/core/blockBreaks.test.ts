import { describe, expect, it } from 'vitest'
import { keepBlockBreak } from './blockBreaks'

/**
 * 在空行上写入内容时，这一行要保住自己的块。
 *
 * 纯算术：给定"打字前 / 打字后"两份源码和打字后的光标，回答"要不要在上下补空行、补完光标在哪"。
 * 判定用真实场景（见 `.scratch/blank-line-typing/issues/01`），这里逐条钉住。
 */
describe('keepBlockBreak', () => {
  it('两段之间的空行：上下各补一个空行', () => {
    // 打字前 `甲\n\n乙`，光标在空行上打 `x` → `甲\nx\n乙`（这才是浏览器交回来的源码）。
    const result = keepBlockBreak('甲\n\n乙', '甲\nx\n乙', 3)
    expect(result).toEqual({ doc: '甲\n\nx\n\n乙', caret: 4 })
  })

  it('上一行非空、下面没有行：只补上面', () => {
    expect(keepBlockBreak('甲\n', '甲\nx', 3)).toEqual({ doc: '甲\n\nx', caret: 4 })
  })

  it('上面没有行、下面非空：只补下面', () => {
    expect(keepBlockBreak('\n甲', 'x\n甲', 1)).toEqual({ doc: 'x\n\n甲', caret: 1 })
  })

  it('下面本来就是空行：不补', () => {
    // 空行串里的第一行被写入；下一行仍是空行，没有会被并进去的邻居。
    expect(keepBlockBreak('\n\n甲', 'x\n\n甲', 1)).toBeNull()
  })

  it('文末幽灵行：上一行是空行，两侧都不补', () => {
    expect(keepBlockBreak('甲\n\n', '甲\n\nx', 4)).toBeNull()
  })

  it('空文档里打字：没有邻居，不补', () => {
    expect(keepBlockBreak('', 'x', 1)).toBeNull()
  })

  it('围栏里的空行是代码：不补', () => {
    const before = '```\na\n\nb\n```\n'
    const after = '```\na\nx\nb\n```\n'
    expect(keepBlockBreak(before, after, 7)).toBeNull()
  })

  it('本来就有内容的行上打字：不补（段内软换行是正文，不是空行）', () => {
    expect(keepBlockBreak('甲x\n\n乙', '甲xy\n\n乙', 3)).toBeNull()
  })

  it('插入的只有空白（空格 / Enter 的换行）：不补', () => {
    expect(keepBlockBreak('甲\n\n乙', '甲\n \n乙', 3)).toBeNull()
    expect(keepBlockBreak('甲\n\n乙', '甲\n\n\n乙', 3)).toBeNull()
  })

  it('光标读数不在这次写入里：仍然补，光标落在写入末尾（IME 提交时块编号会错位）', () => {
    // 合成提交那一次 `input` 上，模型里已经有临时字母、DOM 还是旧结构，`data-block`
    // 已经不再指同一个块，读回来的光标可能是文档末尾。判定不看光标，落点退回写入末尾。
    expect(keepBlockBreak('甲\n\n乙', '甲\nx\n乙', 6)).toEqual({
      doc: '甲\n\nx\n\n乙',
      caret: 4,
    })
  })

  it('多行粘贴到空行：整块都与邻居隔开', () => {
    // 粘贴 `p\nq` 覆盖那条空行，落点是 `p` 起始（2），光标在粘贴文本之后（5）。
    const result = keepBlockBreak('甲\n\n乙', '甲\np\nq\n乙', 5)
    expect(result).toEqual({ doc: '甲\n\np\nq\n\n乙', caret: 6 })
  })

  it('Shift+Enter 开出来的行是软换行续行：不补', () => {
    // `甲` + Shift+Enter + `x` 得到 `甲\nx`——两个源码行、一个段落，正是软换行的意思。
    expect(keepBlockBreak('甲\n', '甲\nx', 3, 2)).toBeNull()
    // 同一份源码，若这一行不是 Shift+Enter 开的（比如点在两段之间的空行上），照补。
    expect(keepBlockBreak('甲\n', '甲\nx', 3)).toEqual({ doc: '甲\n\nx', caret: 4 })
  })

  it('删除：不补', () => {
    expect(keepBlockBreak('甲\n\n乙', '甲\n乙', 2)).toBeNull()
    expect(keepBlockBreak('甲\n\n乙', '甲\n\n', 3)).toBeNull()
  })

  it('上面的邻居在围栏里、这一行在围栏外：照补', () => {
    const before = '```\na\n```\n\nb\n'
    const after = '```\na\n```\nx\nb\n'
    expect(keepBlockBreak(before, after, 11)).toEqual({
      doc: '```\na\n```\n\nx\n\nb\n',
      caret: 12,
    })
  })
})
