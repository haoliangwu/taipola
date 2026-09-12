import { describe, expect, it } from 'vitest'
import { DRAFT_DEBOUNCE_MS, createAutosave, type AutosaveDeps, type Draft } from './autosave'

/**
 * A clock the test drives by hand, so "the debounce did not fire yet" is an
 * assertion rather than a race.
 */
function fakeBackend() {
  let clock = 0
  let nextHandle = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const writes: Draft[] = []
  const foreign: number[] = []
  /** What is "in storage": a write goes here too, exactly as localStorage would. */
  let stored: Draft | null = null

  const deps: AutosaveDeps = {
    write: (draft) => {
      writes.push(draft)
      stored = draft
    },
    peek: () => stored,
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
    foreign,
    /** Another tab's write: newer record, written behind this session's back. */
    foreignWrite(draft: Draft) {
      stored = draft
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

    autosave.schedule({ content: '一', name: 'untitled.md' })
    backend.advance(300)
    autosave.schedule({ content: '二', name: 'untitled.md' })
    backend.advance(300)
    autosave.schedule({ content: '三', name: 'untitled.md' })

    expect(backend.writes).toEqual([])
    backend.advance(DRAFT_DEBOUNCE_MS)

    expect(backend.writes).toHaveLength(1)
    expect(backend.writes[0].content).toBe('三')
  })

  it('既有回归：打完字立刻刷新，草稿必须是新的那一次', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule({ content: '删除前的文本', name: 'untitled.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)
    // 用户删掉几个字，防抖计时器还没到点就刷新了页面。
    autosave.schedule({ content: '删除后的文本', name: 'untitled.md' })
    autosave.flush()

    expect(backend.writes.map((draft) => draft.content)).toEqual(['删除前的文本', '删除后的文本'])
  })

  it('flush 之后计时器已取消，不会再多写一遍', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule({ content: '甲', name: 'untitled.md' })
    autosave.flush()
    backend.advance(DRAFT_DEBOUNCE_MS * 4)

    expect(backend.writes).toHaveLength(1)
    expect(backend.pending()).toBe(0)
  })

  it('一次卸载里 flush 两次只写一遍（pagehide 与 visibilitychange 会同时到）', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule({ content: '甲', name: 'untitled.md' })
    autosave.flush()
    autosave.flush()

    expect(backend.writes).toHaveLength(1)
  })

  it('防抖计时器写过之后，flush 不会把同一份草稿再写一遍', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule({ content: '甲', name: 'untitled.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.flush()

    expect(backend.writes).toHaveLength(1)
  })

  it('cancel 丢掉待写的草稿，一个字节都不写', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.schedule({ content: '不要写', name: 'untitled.md' })
    autosave.cancel()
    backend.advance(DRAFT_DEBOUNCE_MS * 4)

    expect(backend.writes).toEqual([])
    expect(backend.pending()).toBe(0)
  })

  it('savedAt 记的是文档改动时刻，不是写入时刻', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    backend.advance(1_000)
    autosave.schedule({ content: '内容', name: 'untitled.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)

    expect(backend.writes[0].savedAt).toBe(1_000)
  })

  it('flush 时没有待写内容就什么都不做', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)

    autosave.flush()

    expect(backend.writes).toEqual([])
  })
})

/**
 * One global draft slot: two tabs are two views of ONE draft, so the second tab's
 * write really does destroy the first's. Kept as-is, but no longer in silence.
 */
describe('另一个标签页写过的草稿', () => {
  it('自己写的草稿不算冲突', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)
    autosave.schedule({ content: 'a', name: 'x.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)
    autosave.schedule({ content: 'b', name: 'x.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)
    expect(backend.writes).toHaveLength(2)
    expect(backend.foreign).toEqual([])
  })

  it('盘上是别的标签页写的更新草稿时报一次', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)
    autosave.schedule({ content: 'mine', name: 'x.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)
    // 另一个标签页在更晚的时间写了它自己那一份。
    backend.foreignWrite({ content: 'theirs', name: 'x.md', savedAt: 9_999 })
    autosave.schedule({ content: 'mine again', name: 'x.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)
    expect(backend.foreign).toHaveLength(1)
    // 覆盖照旧发生：全局一份就是后写者赢，去掉的是"悄悄"。
    expect(backend.writes.at(-1)?.content).toBe('mine again')
  })

  it('只报一次：对方还在写，不能每个防抖窗口都弹一次', () => {
    const backend = fakeBackend()
    const autosave = createAutosave(backend.deps)
    autosave.schedule({ content: 'a', name: 'x.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)
    for (const savedAt of [9_999, 10_000, 10_001]) {
      backend.foreignWrite({ content: 'theirs', name: 'x.md', savedAt })
      autosave.schedule({ content: `mine ${savedAt}`, name: 'x.md' })
      backend.advance(DRAFT_DEBOUNCE_MS)
    }
    expect(backend.foreign).toHaveLength(1)
  })

  it('启动时加载到的那份是基线，不是冲突', () => {
    const backend = fakeBackend()
    // 启动时加载到的草稿（时间在过去）：它是"我们自己的"，不是冲突。
    backend.foreignWrite({ content: 'loaded', name: 'x.md', savedAt: -1_000 })
    const autosave = createAutosave(backend.deps)
    autosave.schedule({ content: 'typed', name: 'x.md' })
    backend.advance(DRAFT_DEBOUNCE_MS)
    expect(backend.foreign).toEqual([])
  })
})
