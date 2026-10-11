import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  flush,
  caretFromDom,
  typeText,
  clickInRun,
} from '../test/editorTestUtils'
import { invariants, assertUntouchedPrefix } from '../test/softBreakCutHelpers'

/**
 * Matrix §8 (R8 / ADR-0005 §2.4 (a)): normalization may touch ONLY the lines
 * this session's commits actually rewrote; every other byte must be identical.
 *
 * Cut-1 status: the kernel/write path carries NO serializer at all — the write
 * hands the model over verbatim, so the boundary holds vacuously today (`before`
 * bytes survive as long as the edit landed where declared). This cell pins the
 * claim's machine form: type on 丙 ONLY, then assert every other line of sample B
 * is byte-identical to the session-start snapshot. Cut 2's write-side
 * normalization must keep this green for the same "edited line" definition.
 */

describe('matrix §8 写回字节不变（R8，样本 B）', () => {
  it('只编辑丙行：甲乙行、中间空行、全体未编辑区间逐字节不变', async () => {
    const before = '甲乙\n\n丙\n'
    const r = renderEditor(before)
    await flush()
    // 丙行内打一个字（caret 在 丙 行行尾 = 5）。
    await clickInRun(r, 2, 0, 0, 'end')
    await flush()
    expect(caretFromDom()).toBe(5)
    await typeText(r, '丁')
    await flush()
    await invariants(r, 'R8')

    const after = r.getDoc()
    // 被打字的是丙行（行索引 2）；其余每行逐字节不变。
    const edited = assertUntouchedPrefix(after, before, 'R8')
    expect(edited).toEqual([2])
    expect(after).toBe('甲乙\n\n丙丁\n')
    // 写回通道的字节身份：当前保存路径把模型原样交给文件适配器——没有
    // 任何全局序列化器，故上面模型级字节身份直接迁移到写盘文本。
  })

  it('编辑区内的行允许规范化（§2.4 (a) 的另一半：只证明边界，不引入规范化）', async () => {
    const r = renderEditor('甲\n\n丙\n')
    await flush()
    await clickInRun(r, 2, 0, 0, 'end')
    await flush()
    await typeText(r, 'x')
    await flush()
    // 段距空行（行 1）没被编辑：必须逐字节不动。
    expect(r.getDoc()).toBe('甲\n\n丙x\n')
    expect(assertUntouchedPrefix(r.getDoc(), '甲\n\n丙\n', 'R8b')).toEqual([2])
  })
})