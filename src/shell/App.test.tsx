import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { documents } from '../platform/documents'
import { readDocumentSource } from '../editor/render'
import { placeCaretAt } from '../test/editorTestUtils'

/**
 * App-level draft-persistence regression.
 *
 * Reported: deleting a chunk of text, then refreshing the page, restored the
 * OLD draft (the deleted text "came back"). The 500ms debounced save dies with
 * the page on unload, so edits made just before a refresh never reached
 * localStorage. `pagehide` must flush synchronously.
 */
describe('草稿持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('编辑后立即刷新（pagehide）草稿不回退', async () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({
        content: '# 它FINA==现在能做什么\n\n正文\n',
        name: 'untitled.md',
        savedAt: Date.now(),
      }),
    )
    const view = render(<App />)
    const doc = view.container.querySelector('.doc') as HTMLElement
    const run = doc.querySelector(
      '[data-block="0"] [data-vline="0"] [data-run="1"]',
    ) as HTMLElement
    const user = userEvent.setup({ delay: null })
    // The caret has to sit at the run's end for the 4 Backspaces below to delete
    // 4 characters. Placed explicitly rather than clicked: a synthetic click has
    // no browser default action, so aiming one at a coordinate and then counting
    // the characters it deleted would be asserting the editor's fallback rather
    // than the click. (README pitfall #1: focus first, then set the range.)
    doc.focus({ preventScroll: true })
    const text = run.firstChild
    if (!text) throw new Error('run has no text node')
    placeCaretAt(text, text.textContent?.length ?? 0)
    for (let i = 0; i < 4; i++) await user.keyboard('{Backspace}')
    // Let the input event commit, then simulate the refresh's pagehide BEFORE
    // the 500ms debounce timer would ever fire.
    await new Promise((resolve) => setTimeout(resolve, 50))
    window.dispatchEvent(new Event('pagehide'))
    const draft = documents.draft.load()
    // The real caret sat at the line end, so 4 Backspaces removed 4 characters.
    expect(draft?.content).toBe('# 它FINA==现在\n\n正文\n')
    view.unmount()
  })

  it('标签页转入后台（visibilitychange → hidden）也立刻落盘，不等防抖', async () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '甲\n', name: 'untitled.md', savedAt: Date.now() }),
    )
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    const doc = view.container.querySelector('.doc') as HTMLElement
    doc.focus({ preventScroll: true })
    const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
    if (!run?.firstChild) throw new Error('first run has no text node')
    placeCaretAt(run.firstChild, 0)
    await user.keyboard('X')

    // 防抖还没到点，盘上还是旧草稿。
    expect(documents.draft.load()?.content).toBe('甲\n')

    // 只派发 visibilitychange（不派发 pagehide），标签页转入后台。
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
      // 这条写入只可能来自 visibilitychange 那条接线。
      expect(documents.draft.load()?.content).toBe('X甲\n')
    } finally {
      Reflect.deleteProperty(document, 'visibilityState')
    }
    view.unmount()
  })
})

/**
 * The export filename comes from the name the shell SHOWS.
 *
 * A draft restored on load has a name but no file handle (`doc === null`), so an
 * export that asked the document handle for its name produced `untitled.html`
 * for a document the title bar was calling `报告.md`. The shell already owns the
 * display name — the export must be handed that, not the save target.
 */
describe('导出文件名', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('草稿恢复出的文档，导出沿用草稿的文件名', () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '# 标题\n\n正文\n', name: '报告.md', savedAt: Date.now() }),
    )
    const downloaded: string[] = []
    // `downloadFile` hands the browser an <a download=…> and clicks it; that is
    // the observable, so record the name instead of letting a real download run.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded.push(this.download)
      })

    try {
      const view = render(<App />)
      // The titlebar hides these buttons under 900px, so dispatch the click
      // directly: the handler is what is under test, not the pointer path.
      const button = (label: string) =>
        [...view.container.querySelectorAll('.text-button')].find(
          (el) => el.textContent?.trim() === label,
        ) as HTMLButtonElement

      button('导出 HTML').click()
      button('导出 MD').click()

      expect(downloaded).toEqual(['报告.html', '报告.md'])
      view.unmount()
    } finally {
      clickSpy.mockRestore()
    }
  })
})
/**
 * The shortcut WIRING, which `core/shortcuts.test.ts` cannot reach.
 *
 * That file proves which key means which command. It cannot prove that the
 * command then runs the right thing — the mapping from command name to action is
 * the shell's half, and it had no coverage at all before this.
 */
describe('快捷键接线', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('Cmd/Ctrl+B 加粗，Cmd/Ctrl+Shift+K 删掉整行（同一个 K 的两种修饰键）', async () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '第一行\n第二行\n', name: 'untitled.md', savedAt: Date.now() }),
    )
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    const doc = view.container.querySelector('.doc') as HTMLElement
    doc.focus({ preventScroll: true })
    const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
    if (!run?.firstChild) throw new Error('first run has no text node')
    placeCaretAt(run.firstChild, 0)

    await user.keyboard('{Control>}b{/Control}')
    // 加粗包住空选区：插入一对着标记，光标落在中间。
    expect(readDocumentSource(doc)).toBe('****第一行\n第二行\n')

    await user.keyboard('{Control>}{Shift>}k{/Shift}{/Control}')
    // 删掉光标所在那一整行，而不是走链接（Cmd+K）那条路。
    expect(readDocumentSource(doc)).toBe('第二行\n')

    view.unmount()
  })
})

/**
 * The welcome document's NAME is part of the welcome document.
 *
 * Reported: a fresh page called it `untitled.md` in the title bar, and the
 * console helper `__welcome__()` restored the text while leaving the name of
 * whatever file had been open, so the helper looked like it had half worked.
 */
describe('欢迎文档的名字', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('首次打开时标题栏就是 welcome.md', () => {
    const view = render(<App />)
    expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')
    view.unmount()
  })

  it('__welcome__ 连名字一起恢复，而不是只换正文', async () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '别的文档\n', name: '报告.md', savedAt: Date.now() }),
    )
    const view = render(<App />)
    expect(view.container.querySelector('.doc-name')?.textContent).toBe('报告.md')

    const scope = window as typeof window & { __welcome__?: () => string }
    expect(scope.__welcome__, 'console helper missing').toBeTypeOf('function')
    await act(async () => {
      scope.__welcome__?.()
    })

    expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')
    view.unmount()
  })
})

/**
 * Discarding unsaved work asks first — everywhere, from one place.
 *
 * Reported: 「打开」 replaced the whole document with no prompt at all, while
 * 「新建」 asked. The replacement is unrecoverable: `setDocument` clears the undo
 * stack and the debounced draft is overwritten half a second later. The
 * operation that silently discarded your work was the one you had been taught to
 * trust, because the app does prompt for the other one.
 */
describe('丢弃未保存内容前的确认', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  function setup() {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '原来的内容\n', name: '报告.md', savedAt: Date.now() }),
    )
    const view = render(<App />)
    const doc = () => view.container.querySelector('.doc') as HTMLElement
    const button = (label: string) =>
      [...view.container.querySelectorAll('.text-button')].find(
        (el) => el.textContent?.trim() === label,
      ) as HTMLButtonElement
    return { view, doc, button }
  }

  /** Type one character at the start, so the document is genuinely dirty. */
  async function makeDirty(doc: HTMLElement) {
    const user = userEvent.setup({ delay: null })
    doc.focus({ preventScroll: true })
    const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
    if (!run?.firstChild) throw new Error('first run has no text node')
    placeCaretAt(run.firstChild, 0)
    await user.keyboard('X')
    expect(readDocumentSource(doc)).toBe('X原来的内容\n')
  }

  /** The file the picker is about to hand back. */
  const PICKED = {
    status: 'opened' as const,
    document: { name: '别的.md', handle: null },
    content: '新文件的内容\n',
  }

  it('未保存 + 打开并选到文件：拒绝之后连撤销栈都没被动过', async () => {
    const { view, doc, button } = setup()
    await makeDirty(doc())

    const open = vi.spyOn(documents, 'open').mockResolvedValue(PICKED)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await act(async () => {
        button('打开').click()
      })

      // 顺序是"先选文件、再问"：问题里点得出文件名，用户才知道要丢弃哪一篇换来哪一篇。
      expect(open, '应该先让用户选出要打开的文件').toHaveBeenCalled()
      expect(confirm.mock.calls[0]?.[0]).toContain('别的.md')

      // 内容、文件名都还在 —— 被拒绝的那一次「打开」整个没有发生。
      expect(readDocumentSource(doc())).toBe('X原来的内容\n')
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('报告.md')

      // 撤销栈也没被清空。这是"整篇没被替换"的机器可验证形式：`setDocument`
      // 会清空 undoStack，若它被调用过，这条 Ctrl+Z 就什么也撤不掉。
      const user = userEvent.setup({ delay: null })
      await user.keyboard('{Control>}z{/Control}')
      expect(readDocumentSource(doc())).toBe('原来的内容\n')
    } finally {
      open.mockRestore()
      confirm.mockRestore()
      view.unmount()
    }
  })

  it('确认丢弃之后：内容换掉了，撤销栈也确实清了', async () => {
    // 上一条断言"拒绝之后 Ctrl+Z 还能撤掉那个 X"，这条是它的对照组：
    // 真正走完一次替换之后，同一个 Ctrl+Z 什么也撤不回来。两条一起，
    // 才说明上一条不是因为按键没送到编辑器而通过的。
    const { view, doc, button } = setup()
    await makeDirty(doc())

    const open = vi.spyOn(documents, 'open').mockResolvedValue(PICKED)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      await act(async () => {
        button('打开').click()
      })

      expect(readDocumentSource(doc())).toBe('新文件的内容\n')
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('别的.md')

      const user = userEvent.setup({ delay: null })
      doc().focus({ preventScroll: true })
      await user.keyboard('{Control>}z{/Control}')
      expect(readDocumentSource(doc())).toBe('新文件的内容\n')
    } finally {
      open.mockRestore()
      confirm.mockRestore()
      view.unmount()
    }
  })

  it('没有未保存改动时不问，直接打开', async () => {
    const { view, doc, button } = setup()
    const open = vi.spyOn(documents, 'open').mockResolvedValue(PICKED)
    const confirm = vi.spyOn(window, 'confirm')
    try {
      await act(async () => {
        button('打开').click()
      })

      expect(confirm).not.toHaveBeenCalled()
      expect(readDocumentSource(doc())).toBe('新文件的内容\n')
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('别的.md')
    } finally {
      open.mockRestore()
      confirm.mockRestore()
      view.unmount()
    }
  })

  it('新建：仍然是动作之前问，措辞一个字没变', async () => {
    const { view, doc, button } = setup()
    await makeDirty(doc())

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      await act(async () => {
        button('新建').click()
      })

      // 不经过系统选择器，所以只有"动作之前问"这一种可能；措辞与重构前一致。
      expect(confirm.mock.calls[0]?.[0]).toBe('当前文档还没保存，确定新建吗？')
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('untitled.md')
    } finally {
      confirm.mockRestore()
      view.unmount()
    }
  })
})

/**
 * The draft is ONE global record, shared by every tab — decided, not accidental.
 *
 * So a write from either tab destroys whatever the other put there, and that part
 * stays: a global draft is last-write-wins by definition, and refusing to write
 * would break the autosave the rest of the module exists for. What is removed is
 * the SILENCE, and this is the only test that reaches the wiring — the policy
 * itself is unit-tested in `core/autosave.test.ts`.
 */
describe('草稿是全局一份', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('另一个标签页写过更新的草稿时提示一次，并且仍然覆盖', async () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '原来的\n', name: '报告.md', savedAt: 1_000 }),
    )
    const view = render(<App />)
    // The other tab wrote after this one loaded its draft — and, importantly,
    // BEFORE this tab's first write, which is the ordering that actually happens.
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '别的标签页写的\n', name: '报告.md', savedAt: 9_999 }),
    )

    const user = userEvent.setup({ delay: null })
    const doc = view.container.querySelector('.doc') as HTMLElement
    doc.focus({ preventScroll: true })
    const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
    if (!run?.firstChild) throw new Error('first run has no text node')
    placeCaretAt(run.firstChild, 0)
    await user.keyboard('X')
    // 越过防抖窗口。
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(view.container.querySelector('.toast')?.textContent).toContain('另一个标签页')
    // 后写者赢：这话说得出口，前提是它真的发生了。
    expect(JSON.parse(localStorage.getItem('taipola:draft') ?? '{}').content).toBe('X原来的\n')
    view.unmount()
  })

  it('只有一个标签页时不提示', async () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '原来的\n', name: '报告.md', savedAt: 1_000 }),
    )
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    const doc = view.container.querySelector('.doc') as HTMLElement
    doc.focus({ preventScroll: true })
    const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
    if (!run?.firstChild) throw new Error('first run has no text node')
    placeCaretAt(run.firstChild, 0)
    await user.keyboard('X')
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(view.container.querySelector('.toast')?.textContent ?? '').not.toContain('另一个标签页')
    view.unmount()
  })
})
