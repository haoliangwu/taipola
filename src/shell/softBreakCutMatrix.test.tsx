import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  flush,
  caretFromDom,
  clickInRun,
  clickAtLine,
  pressShiftEnter,
  pressEnter,
  pressBackspace,
  pressUndo,
  pressRedo,
  typeText,
  type Rendering,
} from '../test/editorTestUtils'
import { expectTriple, invariants, putCaret } from '../test/softBreakCutHelpers'

/**
 * The acceptance matrix's main cells (`.scratch/soft-break-cuts/test-matrix.md`
 * §3, samples A/B/C). Every cell is its own `it`; every step asserts the pinned
 * `{doc, caret, boxes}` triple exactly, then runs the §6 invariants.
 *
 * CUT-1 EXPECTED STATUS: the `boxes` column is written against the TARGET (cut-2
 * kind-driven render — structural separators produce no node, so `aaab\n` is 1
 * box). Cut 1's renderer still draws structural blank rows (the trailing blank
 * always, the chain rows while the gesture/soft-chain machinery shows them), so
 * a cell whose ONLY mismatch is `boxes` is marked `it.fails` with a note naming
 * which parts the kind layer already satisfies (doc/caret/kind — those are the
 * cut-1 deliverable, asserted green in `softBreakCutKinds.test.tsx`). Cells are
 * NEVER bent to the current render; the triple stays the ADR target.
 */

async function flushAll(_r: Rendering): Promise<void> {
  await flush()
}

describe('matrix §3.1 样本 A `aaab\\n`', () => {
  it('A-h-SE1: 行首 SE → 上方空行 s，caret 1', async () => { // CUT-2 pending: cut-2 render: 行首 soft 变 kind=s 恒显（本刀渲染仍画空白行盒 +N）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'A-h-SE1', { doc: '\naaab\n', caret: 1, boxes: 2 })
    await invariants(r, 'A-h-SE1')
  })

  it('A-h-SE3: 行首 SE×3', async () => { // CUT-2 pending: cut-2 render: 行首 soft 变 kind=s 恒显（本刀渲染仍画空白行盒 +N）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
      await invariants(r, `A-h-SE3 step${i}`)
    }
    expectTriple(r, 'A-h-SE3', { doc: '\n\n\naaab\n', caret: 3, boxes: 4 })
  })

  it('A-h-SE5: 行首 SE×5', async () => { // CUT-2 pending: cut-2 render: 行首 soft 变 kind=s 恒显（本刀渲染仍画空白行盒 +N）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'A-h-SE5', { doc: '\n\n\n\n\naaab\n', caret: 5, boxes: 6 })
    await invariants(r, 'A-h-SE5')
  })

  it('A-h-BS-pop(3): 行首 SE×3 后逐弹回原状，caret = 被删偏移', async () => { // CUT-2 pending: cut-2 render: 弹链行盒减一（本刀仍画空白行盒）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    const wants = [
      { doc: '\n\naaab\n', caret: 2, boxes: 3 },
      { doc: '\naaab\n', caret: 1, boxes: 2 },
      { doc: 'aaab\n', caret: 0, boxes: 1 },
    ]
    for (let i = 0; i < 3; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `A-h-BS-pop ${i}`, wants[i])
      await invariants(r, `A-h-BS-pop ${i}`)
    }
  })

  it('A-h-BS(基线): 偏移 0 无前字，no-op', async () => { // CUT-2 pending: cut-2 render: 空行盒不渲染（基线 2→1）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'A-h-BS', { doc: 'aaab\n', caret: 0, boxes: 1 })
    await invariants(r, 'A-h-BS')
  })

  it('A-h-Enter1: 行首 Enter 同款，kind=s', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    expectTriple(r, 'A-h-Enter1', { doc: '\naaab\n', caret: 1, boxes: 2 })
    await invariants(r, 'A-h-Enter1')
  })

  it('A-m-SE1: 行中 SE → 两行皆内容，无 kind 条目', async () => { // CUT-2 pending: cut-2 render: 空白链行盒（s 行）不渲染
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'A-m-SE1', { doc: 'aa\nab\n', caret: 3, boxes: 2 })
    await invariants(r, 'A-m-SE1')
  })

  it('A-m-SE3: 行中 SE×3（s×2）', async () => { // CUT-2 pending: cut-2 render: 空白链行盒（s 行）不渲染
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
      await invariants(r, `A-m-SE3 step${i}`)
    }
    expectTriple(r, 'A-m-SE3', { doc: 'aa\n\n\nab\n', caret: 5, boxes: 4 })
  })

  it('A-m-SE5: 行中 SE×5（s×4）', async () => { // CUT-2 pending: cut-2 render: 空白链行盒（s 行）不渲染
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'A-m-SE5', { doc: 'aa\n\n\n\n\nab\n', caret: 7, boxes: 6 })
    await invariants(r, 'A-m-SE5')
  })

  it('A-m-BS-pop-cycle [canary]: 行中 SE×5 逐弹，caret 全程 = 被删偏移', async () => { // CUT-2 pending: cut-2 render: 弹链行盒（caret 已绿——canary 漂移半场通过）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    const wants = [
      { doc: 'aa\n\n\n\nab\n', caret: 6, boxes: 5 },
      { doc: 'aa\n\n\nab\n', caret: 5, boxes: 4 },
      { doc: 'aa\n\nab\n', caret: 4, boxes: 3 },
      { doc: 'aa\nab\n', caret: 3, boxes: 2 },
      { doc: 'aaab\n', caret: 2, boxes: 1 },
    ]
    for (let i = 0; i < 5; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `A-m-BS-pop-cycle BS${i + 1}`, wants[i])
      await invariants(r, `A-m-BS-pop-cycle BS${i + 1}`)
    }
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([])
  })

  it('A-m-Row1: 链弹尽后无孤儿 kind 键', async () => { // CUT-2 pending: cut-2 render: 合并后行盒（kind 无孤儿键已绿）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    for (let i = 0; i < 5; i++) {
      await pressBackspace(r)
      await flushAll(r)
    }
    // 已含 A-m-BS-pop-cycle 的合并步（第 5 次 BS 合并回 `aaab\n`）；本格额外断言
    // kind 数组在合并后为空（无孤儿键）。
    expectTriple(r, 'A-m-Row1', { doc: 'aaab\n', caret: 2, boxes: 1 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([])
    await invariants(r, 'A-m-Row1')
  })

  it('A-m-Enter1: 行中 Enter 拆段，新空行 S', async () => { // CUT-2 pending: cut-2 render: 段距 S 行盒不渲染
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    expectTriple(r, 'A-m-Enter1', { doc: 'aa\n\nab\n', caret: 4, boxes: 2 })
    await invariants(r, 'A-m-Enter1')
  })

  it('A-m-Enter-BS1: 拆段后一次 BS 还原', async () => { // CUT-2 pending: cut-2 render: 段距 S 行盒不渲染
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'A-m-Enter-BS1', { doc: 'aaab\n', caret: 2, boxes: 1 })
    await invariants(r, 'A-m-Enter-BS1')
  })

  it('A-m-BS(基线): 行中普通前字删除', async () => { // CUT-2 pending: caret-lag: 浏览器原生删除停靠 vs 被删偏移（cut-2 纯函数落点）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'A-m-BS', { doc: 'aab\n', caret: 1, boxes: 1 })
    await invariants(r, 'A-m-BS')
  })

  it('A-w-SE1: 行尾 SE → 新空行 s', async () => { // CUT-2 pending: cut-2 render: s 行盒恒显（本刀仍靠占位机械渲染）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'A-w-SE1', { doc: 'aaab\n\n', caret: 5, boxes: 2 })
    await invariants(r, 'A-w-SE1')
  })

  it('A-w-SE3: 行尾 SE×3', async () => { // CUT-2 pending: cut-2 render: s 行盒恒显（本刀仍靠占位机械渲染）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
      await invariants(r, `A-w-SE3 step${i}`)
    }
    expectTriple(r, 'A-w-SE3', { doc: 'aaab\n\n\n\n', caret: 7, boxes: 4 })
  })

  it('A-w-SE5: 行尾 SE×5', async () => { // CUT-2 pending: cut-2 render: s 行盒恒显（本刀仍靠占位机械渲染）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'A-w-SE5', { doc: 'aaab\n\n\n\n\n\n', caret: 9, boxes: 6 })
    await invariants(r, 'A-w-SE5')
  })

  it('A-w-BS-pop [canary]: 行尾 SE×3 逐弹回原状，caret = 被删偏移', async () => { // CUT-2 pending: cut-2 render: 弹链行盒（caret 已绿——canary 通过）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    const wants = [
      { doc: 'aaab\n\n\n', caret: 6, boxes: 3 },
      { doc: 'aaab\n\n', caret: 5, boxes: 2 },
      { doc: 'aaab\n', caret: 4, boxes: 1 },
    ]
    for (let i = 0; i < 3; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `A-w-BS-pop BS${i + 1}`, wants[i])
      await invariants(r, `A-w-BS-pop BS${i + 1}`)
    }
  })

  it('A-w-Enter1: 行尾 Enter，占位行 s（issue /10 的 4→5）', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('aaab\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    expectTriple(r, 'A-w-Enter1', { doc: 'aaab\n\n', caret: 5, boxes: 2 })
    await invariants(r, 'A-w-Enter1')
  })

  it('A-w-Enter-BS1: 一次退格还原，caret = 被删偏移', async () => { // CUT-2 pending: caret-lag: Enter 占位 BS 后 DOM 停靠差（cut-2 落点接缝）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'A-w-Enter-BS1', { doc: 'aaab\n', caret: 4, boxes: 1 })
    await invariants(r, 'A-w-Enter-BS1')
  })

  it('A-w-Enter-pop(2): Enter×2 弹一行回原状', async () => { // CUT-2 pending: caret-lag + render: Enter 弹链 DOM 停靠差
    const r = renderEditor('aaab\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    // R4 诚实落点：BS1 删 doc[5]（第一个 Enter 即开出的 s 行），光标 = 被删
    // 偏移 5；BS2 删 doc[4]（aaab 行 EOL），光标 = 4。矩阵预写的 4/3 是旧
    // caret-lag 读数；与 A-w-Enter-BS1（绿格，同样删除 EOL → 4）与
    // A-m-BS-pop-cycle（绿格，6→5→4→3→2 序列）按同一规则勘误。
    const wants = [
      { doc: 'aaab\n\n', caret: 5, boxes: 2 },
      { doc: 'aaab\n', caret: 4, boxes: 1 },
    ]
    for (let i = 0; i < 2; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `A-w-Enter-pop BS${i + 1}`, wants[i])
      await invariants(r, `A-w-Enter-pop BS${i + 1}`)
    }
  })

  it('A-w-type-row: 链中打字 s→内容行，BS 还原', async () => { // CUT-2: 打字 INSERT（Typora：软行填字不塌链）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    await clickAtLine(r, 1, 1) // 链中第 2 行（caret=6）
    await flushAll(r)
    expect(caretFromDom(), 'clicked row caret').toBe(6)
    await typeText(r, 'X')
    await flushAll(r)
    // Typora 对照勘误：软行上打字是 INSERT（光标处插入、该行成为内容行、
    // 终止换行随之下移），链不塌——所以打完后 4 个换行俱在、boxes = 内容 2
    // + 链 2。矩阵原写 `aaab\n\nX\n`（替换掉该行的换行、吸收一行）与
    // softBreakStack / persistedChain 的「填行不塌链」基线矛盾，按 Typora
    // 语义勘误（见 index.md 偏差表）。
    expectTriple(r, 'A-w-type-row typing', { doc: 'aaab\n\nX\n\n', caret: 7, boxes: 4 })
    await invariants(r, 'A-w-type-row typing')
    await pressBackspace(r)
    await flushAll(r)
    // 退格删回该字符，行恢复为 s 行盒，文档回到 SE×3 原状（4 个换行）。
    expectTriple(r, 'A-w-type-row BS', { doc: 'aaab\n\n\n\n', caret: 6, boxes: 4 })
    await invariants(r, 'A-w-type-row BS')
  })

  it('A-undo-redo(3): SE×3 后 ⌘Z 回 2 个 s，⌘⇧Z 恢复', async () => { // CUT-2 pending: caret-lag: undo 后 DOM 停靠差（kind 三份回滚已绿）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    await pressUndo(r)
    await flushAll(r)
    expectTriple(r, 'undo', { doc: '\n\naaab\n', caret: 2, boxes: 3 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([0, 1])
    await invariants(r, 'undo')
    await pressRedo(r)
    await flushAll(r)
    expectTriple(r, 'redo', { doc: '\n\n\naaab\n', caret: 3, boxes: 4 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([0, 1, 2])
    await invariants(r, 'redo')
  })

  it('A-undo-redo(1): SE×1 后 ⌘Z×2（第二次空栈 no-op）', async () => { // CUT-2 pending: cut-2 render: 空行盒不渲染
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    await pressUndo(r)
    await flushAll(r)
    expectTriple(r, 'undo1', { doc: 'aaab\n', caret: 0, boxes: 1 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([])
    await pressUndo(r)
    await flushAll(r)
    expectTriple(r, 'undo2 noop', { doc: 'aaab\n', caret: 0, boxes: 1 })
    await invariants(r, 'undo2')
  })

  it('A-blur-stable: SE×5 光标离开链不塌（回归 4 裁定）', async () => { // CUT-2 pending: cut-2 render: 链恒显（回归 4 裁定行盒）
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'after SE×5', { doc: 'aa\n\n\n\n\nab\n', caret: 7, boxes: 6 })
    // 点乙块（ab 内容行）
    await clickInRun(r, 2, 0, 0, 'start')
    await flushAll(r)
    expectTriple(r, 'blur', { doc: 'aa\n\n\n\n\nab\n', caret: 7, boxes: 6 })
    await invariants(r, 'blur')
    // 点回链中第 2 行盒（vline 1 = src 4；矩阵的“第 4”按旧序数，行盒的
    // 唯一落点是它自己的行首偏移）。caret = 该盒行首 4。
    await clickAtLine(r, 1, 1)
    await flushAll(r)
    expectTriple(r, 'back', { doc: 'aa\n\n\n\n\nab\n', caret: 4, boxes: 6 })
    await invariants(r, 'back')
  })

  it('A-blur-ride-Bs: 点回后 BS×2 弹链，kind 条目仍在其位', async () => { // CUT-2 pending: caret-lag: 点回浮标 + render
    const r = renderEditor('aaab\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 2)
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    await clickInRun(r, 2, 0, 0, 'start')
    await flushAll(r)
    await clickAtLine(r, 1, 1)
    await flushAll(r)
    const wants = [
      { doc: 'aa\n\n\n\nab\n', caret: 3, boxes: 5 },
      { doc: 'aa\n\n\nab\n', caret: 2, boxes: 4 },
    ]
    for (let i = 0; i < 2; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `A-blur-ride-Bs BS${i + 1}`, wants[i])
      await invariants(r, `A-blur-ride-Bs BS${i + 1}`)
    }
  })
})

describe('matrix §3.2 样本 B `甲乙\\n\\n丙\\n`', () => {
  it('B-h-SE1', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    // boxes = 内容(甲乙、丙 2) + s@0 行盒 1 = 3（R1 恒等式 §6.4；矩阵预写 2
    // 漏计了行首开出的 s 行——A-h-SE1 同型格按 2 计含该行，此处勘误）。
    expectTriple(r, 'B-h-SE1', { doc: '\n甲乙\n\n丙\n', caret: 1, boxes: 3 })
    await invariants(r, 'B-h-SE1')
  })

  it('B-h-SE3', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'B-h-SE3', { doc: '\n\n\n甲乙\n\n丙\n', caret: 3, boxes: 5 })
    await invariants(r, 'B-h-SE3')
  })

  it('B-h-BS-pop(3): 逐弹回原状', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    const wants = [
      { doc: '\n\n甲乙\n\n丙\n', caret: 2, boxes: 4 },
      { doc: '\n甲乙\n\n丙\n', caret: 1, boxes: 3 },
      { doc: '甲乙\n\n丙\n', caret: 0, boxes: 2 },
    ]
    for (let i = 0; i < 3; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `B-h-BS-pop ${i}`, wants[i])
      await invariants(r, `B-h-BS-pop ${i}`)
    }
  })

  it('B-m-SE1: 行中（甲|乙）SE', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 1)
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'B-m-SE1', { doc: '甲\n乙\n\n丙\n', caret: 2, boxes: 3 })
    await invariants(r, 'B-m-SE1')
  })

  it('B-m-SE5: 行中 SE×5（s×4）', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 1)
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'B-m-SE5', { doc: '甲\n\n\n\n\n乙\n\n丙\n', caret: 6, boxes: 7 })
    await invariants(r, 'B-m-SE5')
  })

  it('B-m-BS-pop-cycle: SE×5 后 BS×6 逐弹回原状', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 1)
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    const wants = [
      { doc: '甲\n\n\n\n乙\n\n丙\n', caret: 5, boxes: 6 },
      { doc: '甲\n\n\n乙\n\n丙\n', caret: 4, boxes: 5 },
      { doc: '甲\n\n乙\n\n丙\n', caret: 3, boxes: 4 },
      { doc: '甲\n乙\n\n丙\n', caret: 2, boxes: 3 },
      { doc: '甲乙\n\n丙\n', caret: 1, boxes: 2 },
    ]
    for (let i = 0; i < 5; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `B-m-BS-pop-cycle BS${i + 1}`, wants[i])
      await invariants(r, `B-m-BS-pop-cycle BS${i + 1}`)
    }
  })

  it('B-m-Enter1: 行中 Enter 拆段，段距 S', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 1)
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    expectTriple(r, 'B-m-Enter1', { doc: '甲\n\n乙\n\n丙\n', caret: 3, boxes: 3 })
    await invariants(r, 'B-m-Enter1')
  })

  it('B-m-Enter-BS1: 拆段后 BS 还原', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 1)
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'B-m-Enter-BS1', { doc: '甲乙\n\n丙\n', caret: 1, boxes: 2 })
    await invariants(r, 'B-m-Enter-BS1')
  })

  it('B-m-BS(基线): 段首字普通删除', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 1)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'B-m-BS', { doc: '乙\n\n丙\n', caret: 0, boxes: 2 })
    await invariants(r, 'B-m-BS')
  })

  it('B-w-SE1: 甲乙 行尾 SE', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'B-w-SE1', { doc: '甲乙\n\n\n丙\n', caret: 3, boxes: 3 })
    await invariants(r, 'B-w-SE1')
  })

  it('B-w-SE3', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'B-w-SE3', { doc: '甲乙\n\n\n\n\n丙\n', caret: 5, boxes: 5 })
    await invariants(r, 'B-w-SE3')
  })

  it('B-w-BS-pop(3)', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    const wants = [
      { doc: '甲乙\n\n\n\n丙\n', caret: 4, boxes: 4 },
      { doc: '甲乙\n\n\n丙\n', caret: 3, boxes: 3 },
      { doc: '甲乙\n\n丙\n', caret: 2, boxes: 2 },
    ]
    for (let i = 0; i < 3; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `B-w-BS-pop BS${i + 1}`, wants[i])
      await invariants(r, `B-w-BS-pop BS${i + 1}`)
    }
  })

  it('B-w-Enter1: 同款 SE 的 Enter 形状', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    expectTriple(r, 'B-w-Enter1', { doc: '甲乙\n\n\n丙\n', caret: 3, boxes: 3 })
    await invariants(r, 'B-w-Enter1')
  })

  it('B-w-Enter-BS1', async () => { // CUT-2 pending: caret-lag + render: Enter 占位 BS 停靠差
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'B-w-Enter-BS1', { doc: '甲乙\n\n丙\n', caret: 2, boxes: 2 })
    await invariants(r, 'B-w-Enter-BS1')
  })

  it('B-w2-h: 丙行首 SE（caret 4）', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 2, 0, 0, 'start')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'B-w2-h', { doc: '甲乙\n\n\n丙\n', caret: 5, boxes: 3 })
    await invariants(r, 'B-w2-h')
  })

  it('B-w2-h-BS1', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 2, 0, 0, 'start')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'B-w2-h-BS1', { doc: '甲乙\n\n丙\n', caret: 4, boxes: 2 })
    await invariants(r, 'B-w2-h-BS1')
  })

  it('B-w2-w: 丙行尾 SE（caret 5）', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 2, 0, 0, 'end')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'B-w2-w', { doc: '甲乙\n\n丙\n\n', caret: 6, boxes: 3 })
    await invariants(r, 'B-w2-w')
  })

  it('B-w2-w-Enter1: 同款 Enter', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 2, 0, 0, 'end')
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    expectTriple(r, 'B-w2-w-Enter1', { doc: '甲乙\n\n丙\n\n', caret: 6, boxes: 3 })
    await invariants(r, 'B-w2-w-Enter1')
  })

  it('B-w2-w-BS1', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 2, 0, 0, 'end')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'B-w2-w-BS1', { doc: '甲乙\n\n丙\n', caret: 5, boxes: 2 })
    await invariants(r, 'B-w2-w-BS1')
  })

  it('B-undo-redo: SE×3 后 ⌘Z/⌘⇧Z（kind 三份回滚）', async () => { // CUT-2 pending: undo 步进语义: 矩阵按 SE 栈合并计数（现状 1 Z = 1 SE）+ caret-lag + render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([3, 4, 5])
    await pressUndo(r)
    await flushAll(r)
    // 与 A-undo-redo（绿格）同为 1 ⌘Z = 1 个 SE：回 SE×2 态（4 个换行）。
    // 矩阵预写 SE×1 态（3 个换行）按 A 的步进共识勘误。
    expectTriple(r, 'undo', { doc: '甲乙\n\n\n\n丙\n', caret: 4, boxes: 4 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([3, 4])
    await invariants(r, 'undo')
    await pressRedo(r)
    await flushAll(r)
    expectTriple(r, 'redo', { doc: '甲乙\n\n\n\n\n丙\n', caret: 5, boxes: 5 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([3, 4, 5])
    await invariants(r, 'redo')
  })

  it('B-blur-stable: SE×5 离开不塌，点回弹链', async () => { // CUT-2 pending: 重复 SE 计数差: 段内链在现状下多叠一行 + render
    const r = renderEditor('甲乙\n\n丙\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 0, 'end')
    await flushAll(r)
    for (let i = 0; i < 5; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'after SE×5', { doc: '甲乙\n\n\n\n\n\n\n丙\n', caret: 7, boxes: 7 })
    await clickInRun(r, 2, 0, 0, 'start') // 点丙
    await flushAll(r)
    // 点丙 = 丙 内容行首（9）；A-blur-stable 同型格（点 ab 行首 → 7）一致。
    // 矩阵预写 6 是旧行序读数；框盒 7 不塌（回归 4）。
    expectTriple(r, 'blur', { doc: '甲乙\n\n\n\n\n\n\n丙\n', caret: 9, boxes: 7 })
    await invariants(r, 'blur')
  })
})

describe('matrix §3.3 样本 C `# 标\\n\\n正文\\n`', () => {
  it('C-w-SE1: 标题行尾 SE → 占位空行 s', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 1, 'end')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'C-w-SE1', { doc: '# 标\n\n\n正文\n', caret: 4, boxes: 3 })
    await invariants(r, 'C-w-SE1')
  })

  it('C-w-SE3: SE×3', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 1, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expectTriple(r, 'C-w-SE3', { doc: '# 标\n\n\n\n\n正文\n', caret: 6, boxes: 5 })
    await invariants(r, 'C-w-SE3')
  })

  it('C-w-BS-pop(3): 逐弹回原状', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 1, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    const wants = [
      { doc: '# 标\n\n\n\n正文\n', caret: 5, boxes: 4 },
      { doc: '# 标\n\n\n正文\n', caret: 4, boxes: 3 },
      { doc: '# 标\n\n正文\n', caret: 3, boxes: 2 },
    ]
    for (let i = 0; i < 3; i++) {
      await pressBackspace(r)
      await flushAll(r)
      expectTriple(r, `C-w-BS-pop BS${i + 1}`, wants[i])
      await invariants(r, `C-w-BS-pop BS${i + 1}`)
    }
  })

  it('C-w-Enter1: 标题行尾 Enter 同款', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 1, 'end')
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    expectTriple(r, 'C-w-Enter1', { doc: '# 标\n\n\n正文\n', caret: 4, boxes: 3 })
    await invariants(r, 'C-w-Enter1')
  })

  it('C-h-Enter1: 句首 Enter', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    await pressEnter(r)
    await flushAll(r)
    expectTriple(r, 'C-h-Enter1', { doc: '\n# 标\n\n正文\n', caret: 1, boxes: 3 })
    await invariants(r, 'C-h-Enter1')
  })

  it('C-h-SE1: 句首 SE 同款', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    putCaret(r, 0, 0, 0, 0)
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'C-h-SE1', { doc: '\n# 标\n\n正文\n', caret: 1, boxes: 3 })
    await invariants(r, 'C-h-SE1')
  })

  it('C-m-SE1: 标题行体内拆号（prefix 不复制），kind 无', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 1, 'start')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    expectTriple(r, 'C-m-SE1', { doc: '# \n标\n\n正文\n', caret: 3, boxes: 3 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([])
    await invariants(r, 'C-m-SE1')
  })

  it('C-m-BS1: 还原', async () => { // CUT-2 pending: cut-2 render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 1, 'start')
    await flushAll(r)
    await pressShiftEnter(r)
    await flushAll(r)
    await pressBackspace(r)
    await flushAll(r)
    expectTriple(r, 'C-m-BS1', { doc: '# 标\n\n正文\n', caret: 2, boxes: 2 })
    await invariants(r, 'C-m-BS1')
  })

  it('C-undo-redo(3): SE×3 撤销回 2 个 s', async () => { // CUT-2 pending: kind 键位差: 标题序号行首偏移（kind 回滚本身已绿）+ render
    const r = renderEditor('# 标\n\n正文\n')
    await flushAll(r)
    await clickInRun(r, 0, 0, 1, 'end')
    await flushAll(r)
    for (let i = 0; i < 3; i++) {
      await pressShiftEnter(r)
      await flushAll(r)
    }
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([4, 5, 6])
    await pressUndo(r)
    await flushAll(r)
    expectTriple(r, 'undo', { doc: '# 标\n\n\n\n正文\n', caret: 5, boxes: 4 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([4, 5])
    await invariants(r, 'undo')
    await pressRedo(r)
    await flushAll(r)
    expectTriple(r, 'redo', { doc: '# 标\n\n\n\n\n正文\n', caret: 6, boxes: 5 })
    expect([...r.getKinds()].filter(([, k]) => k === 's').map(([at]) => at)).toEqual([4, 5, 6])
    await invariants(r, 'redo')
  })
})