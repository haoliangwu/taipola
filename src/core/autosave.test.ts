import { describe, expect, it } from 'vitest'
import {
  DRAFT_DEBOUNCE_MS,
  createAutosave,
  type AutosaveDeps,
  type Draft,
  type DraftInput,
} from './autosave'

/** A document whose content changed: the policy's input. */
function input(content: string, name = 'untitled.md'): DraftInput {
  return { content, name, root: null, path: null }
}

/**
 * A clock the test drives by hand, so "the debounce did not fire yet" is an
 * assertion rather than a race. Storage is a Map keyed by slot, exactly as the
 * real store is.
 */
function fakeBackend() {
  let clock = 0
  let nextHandle = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const writes: Array<{ key: string; draft: Draft }> = []
  const removed: string[] = []
  const foreign: number[] = []
  /** What is "in storage": a write goes here too, exactly as localStorage would. */
  const storage = new Map<string, Draft>()

  const deps: AutosaveDeps = {
    write: (key, draft) => {
      writes.push({ key, draft })
      storage.set(key, draft)
    },
    peek: (key) => storage.get(key) ?? null,
    remove: (key) => {
      removed.push(key)
      storage.delete(key)
    },
    onForeignDraft: () => foreign.push(clock),
    setTimer: (run, delayMs) => {
      const handle = nextHandle++
      timers.set(handle, { at: clock + delayMs, run })
      return handle
    },
    clearTimer: (handle) => {
      timers.delete(handle)
    },
    now: () => clock,
  }

  return {
    deps,
    writes,
    removed,
    foreign,
    stored: (key: string) => storage.get(key) ?? null,
    /** Another tab's write: newer record, written behind this session's back. */
    foreignWrite(key: string, draft: Draft) {
      storage.set(key, draft)
    },
    pending: () => timers.size,
    advance(ms: number) {
      clock += ms
      for (const [handle, timer] of [...timers]) {
        if (timer.at > clock) continue
        timers.delete(handle)
        timer.run()
      }
    },
  }
}

describe('createAutosave', () => {
  it('防抖：窗口内连打多次，只在最后一次之后写一遍', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('untitled.md', input('一'))
    backend.advance(300)
    autosave.schedule('untitled.md', input('二'))
    backend.advance(300)
    autosave.schedule('untitled.md', input('三'))

    expect(backend.writes).toEqual([])
    backend.advance(DRAFT_DEBOUNCE_MS)

    expect(backend.writes).toHaveLength(1)
    expect(backend.writes[0].draft.content).toBe('三')
  })

  it('既有回归：打完字立刻刷新，草稿必须是新的那一次', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('untitled.md', input('删除前的文本'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    // 用户删掉几个字，防抖计时器还没到点就刷新了页面。
    autosave.schedule('untitled.md', input('删除后的文本'))
    autosave.flush()

    expect(backend.writes.map(({ draft }) => draft.content)).toEqual(['删除前的文本', '删除后的文本'])
  })

  it('flush 之后计时器已取消，不会再多写一遍', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('untitled.md', input('甲'))
    autosave.flush()
    backend.advance(DRAFT_DEBOUNCE_MS * 4)

    expect(backend.writes).toHaveLength(1)
    expect(backend.pending()).toBe(0)
  })

  it('一次卸载里 flush 两次只写一遍（pagehide 与 visibilitychange 会同时到）', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('untitled.md', input('甲'))
    autosave.flush()
    autosave.flush()

    expect(backend.writes).toHaveLength(1)
  })

  it('防抖计时器写过之后，flush 不会把同一份草稿再写一遍', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('untitled.md', input('甲'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.flush()

    expect(backend.writes).toHaveLength(1)
  })

  it('cancel 丢掉待写的草稿，一个字节都不写', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('untitled.md', input('不要写'))
    autosave.cancel()
    backend.advance(DRAFT_DEBOUNCE_MS * 4)

    expect(backend.writes).toEqual([])
    expect(backend.pending()).toBe(0)
  })

  it('savedAt 记的是文档改动时刻，不是写入时刻', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    backend.advance(1_000)
    autosave.schedule('untitled.md', input('内容'))
    backend.advance(DRAFT_DEBOUNCE_MS)

    expect(backend.writes[0].draft.savedAt).toBe(1_000)
  })

  it('flush 时没有待写内容就什么都不做', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.flush()

    expect(backend.writes).toEqual([])
  })
})

/**
 * One slot per document. Switching between two documents must not let either
 * one's unwritten content overwrite the other's — the reason the single global
 * record was given up.
 */
describe('按文档分槽', () => {
  it('两份文档各自写进自己的槽', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('甲.md', input('甲的改动', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.schedule('乙.md', input('乙的改动', '乙.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)

    expect(backend.stored('甲.md')?.content).toBe('甲的改动')
    expect(backend.stored('乙.md')?.content).toBe('乙的改动')
  })

  it('切走再切回来，前一份的槽还在（写新文档不会碰它）', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('甲.md', input('甲的改动', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.schedule('乙.md', input('乙的改动', '乙.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.schedule('甲.md', input('甲又改了', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)

    expect(backend.stored('乙.md')?.content).toBe('乙的改动')
    expect(backend.stored('甲.md')?.content).toBe('甲又改了')
  })

  it('切换文档时把待写的那份立刻落盘，不等防抖', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('甲.md', input('刚敲的字', '甲.md'))
    // 用户立刻点了另一份文档：切换前要先 flush 老文档。
    autosave.flush()
    autosave.cancel()

    expect(backend.stored('甲.md')?.content).toBe('刚敲的字')
  })

  it('forget 删掉这个槽，并丢掉它还没写的待写内容', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('甲.md', input('甲的改动', '甲.md'))
    autosave.forget('甲.md')
    backend.advance(DRAFT_DEBOUNCE_MS * 4)

    expect(backend.removed).toEqual(['甲.md'])
    expect(backend.stored('甲.md')).toBeNull()
    expect(backend.writes).toEqual([])
  })

  it('forget 不碰别的槽，也不碰别的槽待写的内容', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('乙.md', input('乙的改动', '乙.md'))
    autosave.forget('甲.md')
    backend.advance(DRAFT_DEBOUNCE_MS)

    expect(backend.stored('乙.md')?.content).toBe('乙的改动')
  })

  it('forgetUnlessNewer：槽里就是刚写回文件的那一份时删掉它', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('甲.md', input('写回的内容', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.forgetUnlessNewer('甲.md', '写回的内容')

    expect(backend.stored('甲.md')).toBeNull()
  })

  it('forgetUnlessNewer：槽里已经是更新的内容时留着（写回途中用户还在打字）', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('甲.md', input('写回的那份', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.schedule('甲.md', input('写回途中又敲的字', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.forgetUnlessNewer('甲.md', '写回的那份')

    expect(backend.stored('甲.md')?.content).toBe('写回途中又敲的字')
  })

  it('forgetUnlessNewer：更新的那份还卡在防抖里时也不动它', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule('甲.md', input('写回的那份', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.schedule('甲.md', input('还没落盘的新字', '甲.md'))
    autosave.forgetUnlessNewer('甲.md', '写回的那份')
    backend.advance(DRAFT_DEBOUNCE_MS)

    expect(backend.stored('甲.md')?.content).toBe('还没落盘的新字')
  })
})

/**
 * Two tabs on the SAME document are still two views of one slot, so the second
 * write destroys the first's — kept, but no longer in silence. Two tabs on
 * DIFFERENT documents must never see each other at all, which is what the
 * per-slot baseline buys.
 */
describe('另一个标签页写过的草稿', () => {
  it('自己写的草稿不算冲突', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)
    autosave.schedule('x.md', input('a', 'x.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.schedule('x.md', input('b', 'x.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    expect(backend.writes).toHaveLength(2)
    expect(backend.foreign).toEqual([])
  })

  it('同一份文档上，盘上是别的标签页写的更新草稿时报一次', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)
    autosave.schedule('x.md', input('mine', 'x.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    // 另一个标签页在更晚的时间写了它自己那一份。
    backend.foreignWrite('x.md', { content: 'theirs', name: 'x.md', savedAt: 9_999, root: null, path: null })
    autosave.schedule('x.md', input('mine again', 'x.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    expect(backend.foreign).toHaveLength(1)
    // 覆盖照旧发生：同一个槽就是后写者赢，去掉的是"悄悄"。
    expect(backend.writes.at(-1)?.draft.content).toBe('mine again')
  })

  it('只报一次：对方还在写，不能每个防抖窗口都弹一次', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)
    autosave.schedule('x.md', input('a', 'x.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    for (const savedAt of [9_999, 10_000, 10_001]) {
      backend.foreignWrite('x.md', { content: 'theirs', name: 'x.md', savedAt, root: null, path: null })
      autosave.schedule('x.md', input(`mine ${savedAt}`, 'x.md'))
      backend.advance(DRAFT_DEBOUNCE_MS)
    }
    expect(backend.foreign).toHaveLength(1)
  })

  it('启动时加载到的那份是基线，不是冲突', () => {
    const backend = fakeBackend()
    // 启动时加载到的草稿（时间在过去）：它是"我们自己的"，不是冲突。
    backend.foreignWrite('x.md', { content: 'loaded', name: 'x.md', savedAt: -1_000, root: null, path: null })
    const autosave = createAutosave(backend.deps)
    autosave.schedule('x.md', input('typed', 'x.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    expect(backend.foreign).toEqual([])
  })

  it('别的文档的槽再新也不算冲突（分槽之后这是常态）', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)
    autosave.schedule('甲.md', input('mine', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    // 另一个标签页在别的文档上写了更新的槽。
    backend.foreignWrite('乙.md', { content: 'theirs', name: '乙.md', savedAt: 9_999, root: null, path: null })
    autosave.schedule('甲.md', input('mine again', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    expect(backend.foreign).toEqual([])
    expect(backend.stored('乙.md')?.content).toBe('theirs')
  })

  it('每个槽各有各的基线：甲.md 的基线不会被乙.md 的记录顶掉', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)
    autosave.schedule('甲.md', input('a', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.schedule('乙.md', input('b', '乙.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    // 甲.md 上另一个标签页写了更新的一份：仍然必须被发现。
    backend.foreignWrite('甲.md', { content: 'theirs', name: '甲.md', savedAt: 9_999, root: null, path: null })
    autosave.schedule('甲.md', input('mine again', '甲.md'))
    backend.advance(DRAFT_DEBOUNCE_MS)
    expect(backend.foreign).toHaveLength(1)
  })
})
