import { describe, expect, it } from 'vitest'
import { WRITE_BACK_DEBOUNCE_MS, createWriteBack, type WriteBackDeps } from './writeBack'

/**
 * The write-back policy, driven by a clock the test owns and a fake file.
 *
 * What is worth pinning here is not "the text arrived" — that is `documents.save`
 * and its own tests — but the four decisions around it: the debounce, the
 * one-time question when the file changed underneath, giving up after a write
 * that did not happen, and never writing a stale text after a newer one.
 */
function fakeFile(options: { modifiedAt?: number; writeOk?: boolean; confirm?: boolean } = {}) {
  let clock = 0
  let nextHandle = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const writes: string[] = []
  const asked: number[] = []
  const written: string[] = []
  const stopped: string[] = []
  /** The file's modification time, as the fake filesystem reports it. Null = gone. */
  let modifiedAt: number | null = options.modifiedAt ?? 100

  const deps: WriteBackDeps = {
    openedAt: 100,
    currentModifiedAt: async () => modifiedAt,
    write: async (text) => {
      writes.push(text)
      if (options.writeOk === false) return false
      written.push(text)
      // A real write moves the file's modification time.
      modifiedAt = (modifiedAt ?? 0) + 1
      return true
    },
    confirmOverwrite: () => {
      asked.push(clock)
      return options.confirm ?? true
    },
    onWritten: (text) => written.push(text),
    onStopped: (reason) => stopped.push(reason),
    setTimer: (run, delayMs) => {
      const handle = nextHandle++
      timers.set(handle, { at: clock + delayMs, run })
      return handle
    },
    clearTimer: (handle) => {
      timers.delete(handle)
    },
  }

  return {
    deps,
    writes,
    asked,
    written,
    stopped,
    pending: () => timers.size,
    setModifiedAt: (value: number) => {
      modifiedAt = value
    },
    /** The file was deleted or moved out from under us. */
    setMissing: () => {
      modifiedAt = null
    },
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

/** Lets the policy's async write settle. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createWriteBack', () => {
  it('防抖：连续输入停下一段时间之后才写一次，内容是最后一次', async () => {
    const file = fakeFile()
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('一')
    file.advance(400)
    writeBack.schedule('二')
    file.advance(400)
    writeBack.schedule('三')

    expect(file.writes).toEqual([])
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()

    expect(file.writes).toEqual(['三'])
  })

  it('flush 立刻写（页面要走了，没有时间等防抖）', async () => {
    const file = fakeFile()
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('刚敲的字')
    writeBack.flush()
    await settle()

    expect(file.writes).toEqual(['刚敲的字'])
  })

  it('文件没被别的东西改过时不问', async () => {
    const file = fakeFile({ modifiedAt: 100 })
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('内容')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()

    expect(file.asked).toEqual([])
    expect(file.writes).toEqual(['内容'])
  })

  it('文件被别的东西改过时问一次；确认之后照写', async () => {
    const file = fakeFile({ modifiedAt: 999, confirm: true })
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('内容')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()

    expect(file.asked).toHaveLength(1)
    expect(file.writes).toEqual(['内容'])
  })

  it('拒绝覆盖：一个字都不写，并停掉自动写回', async () => {
    const file = fakeFile({ modifiedAt: 999, confirm: false })
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('内容')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()

    expect(file.writes).toEqual([])
    expect(file.stopped).toEqual(['declined'])
  })

  it('拒绝之后继续打字也不再写（问过一次就不再问）', async () => {
    const file = fakeFile({ modifiedAt: 999, confirm: false })
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('内容')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()
    writeBack.schedule('更多内容')
    file.advance(WRITE_BACK_DEBOUNCE_MS * 4)
    await settle()

    expect(file.writes).toEqual([])
    expect(file.asked).toHaveLength(1)
  })

  it('写回自己成功之后更新基线：下一次不再把「自己刚写的」当成外部改动', async () => {
    const file = fakeFile({ modifiedAt: 100 })
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('第一次')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()
    writeBack.schedule('第二次')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()

    expect(file.asked).toEqual([])
    expect(file.writes).toEqual(['第一次', '第二次'])
  })

  it('写回没能发生（权限被撤 / 磁盘满）：报一次失败并停下来', async () => {
    const file = fakeFile({ writeOk: false })
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('内容')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()
    writeBack.schedule('更多内容')
    file.advance(WRITE_BACK_DEBOUNCE_MS * 4)
    await settle()

    expect(file.stopped).toEqual(['failed'])
    expect(file.writes).toEqual(['内容'])
  })

  it('写到一半又改了：写完这一次，再用最新的内容写一次', async () => {
    const file = fakeFile()
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('第一版')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    writeBack.schedule('第二版')
    await settle()
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()

    expect(file.writes).toEqual(['第一版', '第二版'])
  })

  it('cancel 丢掉待写的内容（文档已经换掉了）', async () => {
    const file = fakeFile()
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('内容')
    writeBack.cancel()
    file.advance(WRITE_BACK_DEBOUNCE_MS * 4)
    await settle()

    expect(file.writes).toEqual([])
  })

  it('settle（用户自己保存了）丢掉待写的内容', async () => {
    const file = fakeFile()
    const writeBack = createWriteBack(file.deps)

    writeBack.schedule('内容')
    writeBack.savedByHand()
    file.advance(WRITE_BACK_DEBOUNCE_MS * 4)
    await settle()

    expect(file.writes).toEqual([])
  })

  it('文件已经找不到了（被删掉或移走）：一个字都不写，报 missing 并停下来', async () => {
    const file = fakeFile()
    const writeBack = createWriteBack(file.deps)
    file.setMissing()

    writeBack.schedule('内容')
    file.advance(WRITE_BACK_DEBOUNCE_MS)
    await settle()

    // 读不到修改时间不等于"没什么可比"：照写会把删掉的文件凭空重建出来。
    expect(file.writes).toEqual([])
    expect(file.stopped).toEqual(['missing'])
  })

  it('没有待写内容时 flush 什么都不做', async () => {
    const file = fakeFile()
    const writeBack = createWriteBack(file.deps)

    writeBack.flush()
    await settle()

    expect(file.writes).toEqual([])
  })
})
