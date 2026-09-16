import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { documents } from '../platform/documents'
import { folders, type FolderEntry } from '../platform/folder'
import { savedFolder, type SavedFolderStatus } from '../platform/savedFolder'
import { stubSavedFolder } from '../test/platformStubs'
import { readDocumentSource } from '../editor/render'
import { placeCaretAt } from '../test/editorTestUtils'

/**
 * Puts an unwritten document in its slot, the way a previous session would have
 * left it.
 *
 * A slot is keyed by the document (`taipola:draft:<key>`) and one pointer says
 * which slot was written last — that pointer is what a reload restores.
 */
function seedDraft(key: string, draft: { content: string; name: string; savedAt?: number }) {
  localStorage.setItem(
    `taipola:draft:${key}`,
    JSON.stringify({ savedAt: 1_000, root: null, path: null, ...draft }),
  )
  localStorage.setItem('taipola:active-draft', key)
}

/** Writes another tab's slot behind this session's back. */
function foreignSlot(key: string, content: string, savedAt = 9_999) {
  localStorage.setItem(
    `taipola:draft:${key}`,
    JSON.stringify({ content, name: key, savedAt, root: null, path: null }),
  )
}

function findButton(view: ReturnType<typeof render>, label: string): HTMLButtonElement {
  return view.container.querySelector(
    `.titlebar-right [aria-label="${label}"]`,
  ) as HTMLButtonElement
}

const documentBody = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.doc') as HTMLElement

/** Types one character at the start of the first line, so the document is dirty. */
async function typeInto(view: ReturnType<typeof render>, key: string) {
  const doc = documentBody(view)
  const user = userEvent.setup({ delay: null })
  doc.focus({ preventScroll: true })
  const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
  if (!run?.firstChild) throw new Error('first run has no text node')
  placeCaretAt(run.firstChild, 0)
  await user.keyboard(key)
}

/** Past the draft debounce (500ms), which is where a wrong cross-tab notice would show. */
const pastDraftDebounce = () => new Promise((resolve) => setTimeout(resolve, 700))

/** Past the write-back debounce (1000ms), with room for the async write to settle. */
const pastWriteBack = () => new Promise((resolve) => setTimeout(resolve, 1_300))

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
    seedDraft('untitled.md', {
      content: '# 它FINA==现在能做什么\n\n正文\n',
      name: 'untitled.md',
    })
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
    const draft = documents.draft.load('untitled.md')
    // The real caret sat at the line end, so 4 Backspaces removed 4 characters.
    expect(draft?.content).toBe('# 它FINA==现在\n\n正文\n')
    view.unmount()
  })

  it('标签页转入后台（visibilitychange → hidden）也立刻落盘，不等防抖', async () => {
    seedDraft('untitled.md', { content: '甲\n', name: 'untitled.md' })
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    const doc = view.container.querySelector('.doc') as HTMLElement
    doc.focus({ preventScroll: true })
    const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
    if (!run?.firstChild) throw new Error('first run has no text node')
    placeCaretAt(run.firstChild, 0)
    await user.keyboard('X')

    // 防抖还没到点，盘上还是旧草稿。
    expect(documents.draft.load('untitled.md')?.content).toBe('甲\n')

    // 只派发 visibilitychange（不派发 pagehide），标签页转入后台。
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
      // 这条写入只可能来自 visibilitychange 那条接线。
      expect(documents.draft.load('untitled.md')?.content).toBe('X甲\n')
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

  it('草稿恢复出的文档，导出沿用草稿的文件名', async () => {
    seedDraft('报告.md', { content: '# 标题\n\n正文\n', name: '报告.md' })
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
      // directly: the handler is what is under test, not the pointer path. The
      // desktop export is a menu now (header went icon-only), so each format is
      // two clicks: open the menu, pick the format.
      const user = userEvent.setup({ delay: null })
      const exportButton = () =>
        view.container.querySelector('.titlebar-right [aria-label="导出"]') as HTMLButtonElement
      const menuItem = (label: string) =>
        [...view.container.querySelectorAll('.titlebar-right .mini-menu [role="menuitem"]')].find(
          (el) => el.textContent?.trim() === label,
        ) as HTMLButtonElement

      await user.click(exportButton())
      await user.click(menuItem('导出 HTML'))
      await user.click(exportButton())
      await user.click(menuItem('导出 MD'))

      expect(downloaded).toEqual(['报告.html', '报告.md'])
      view.unmount()
    } finally {
      clickSpy.mockRestore()
    }
  })
})
/**
 * The desktop header's command strip — the icon-only counterpart of the phone's
 * mini group, and the format toolbar's home.
 *
 * The toolbar lives in the titlebar again (`.titlebar-center`, not a row over
 * the document — that row cost the document screen); the command strip is
 * pinned to the same band's right edge (`.titlebar-right`); and every button
 * there is an SVG with an aria-label, because words cost the pill's centring
 * room. The theme toggle's icon follows the theme it would switch INTO.
 */
describe('标题栏命令组', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(folders, 'canOpen').mockReturnValue(true)
  })

  it('格式工具条在标题栏居中带里，桌面命令组全是图标按钮', () => {
    const view = render(<App />)
    expect(view.container.querySelector('.toolbar')?.closest('.titlebar-center')).not.toBeNull()
    expect(view.container.querySelector('.editor-top')).toBeNull()
    for (const name of ['切换主题', '新建', '打开', '打开文件夹', '保存', '导出', '快捷键']) {
      const button = view.container.querySelector(`.titlebar-right [aria-label="${name}"]`)
      expect(button, `${name} 不见了`).not.toBeNull()
      expect(button!.querySelector('svg'), `${name} 应当是画出来的`).not.toBeNull()
    }
    view.unmount()
  })

  it('主题按钮的说明跟着主题走（浅色 → 深色 → 跟随系统）', async () => {
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    const themeButton = view.container.querySelector(
      '.titlebar-right [aria-label="切换主题"]',
    ) as HTMLButtonElement
    const says = () => themeButton.title

    // Default is `system` (nothing stored); the label names the CURRENT theme.
    expect(says()).toContain('跟随系统')
    await user.click(themeButton)
    expect(says()).toContain('浅色')
    expect(view.container.querySelector('.titlebar-right [aria-label="切换主题"] svg')).not.toBeNull()
    await user.click(themeButton)
    expect(says()).toContain('深色')
    await user.click(themeButton)
    expect(says()).toContain('跟随系统')
    view.unmount()
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
    seedDraft('untitled.md', { content: '第一行\n第二行\n', name: 'untitled.md' })
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
    seedDraft('报告.md', { content: '别的文档\n', name: '报告.md' })
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
    seedDraft('报告.md', { content: '原来的内容\n', name: '报告.md' })
    const view = render(<App />)
    const doc = () => view.container.querySelector('.doc') as HTMLElement
    const button = (label: string) =>
      view.container.querySelector(
        `.titlebar-right [aria-label="${label}"]`,
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
    modifiedAt: 111,
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
    // 欢迎文档：没有对应的文件，也没有未写回的内容。
    const view = render(<App />)
    const button = (label: string) =>
      view.container.querySelector(
        `.titlebar-right [aria-label="${label}"]`,
      ) as HTMLButtonElement
    const open = vi.spyOn(documents, 'open').mockResolvedValue(PICKED)
    const confirm = vi.spyOn(window, 'confirm')
    try {
      await act(async () => {
        button('打开').click()
      })

      expect(confirm).not.toHaveBeenCalled()
      expect(readDocumentSource(view.container.querySelector('.doc') as HTMLElement)).toBe(
        '新文件的内容\n',
      )
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('别的.md')
    } finally {
      open.mockRestore()
      confirm.mockRestore()
      view.unmount()
    }
  })

  /**
   * A slot restored on load is content that never reached a file, so it starts
   * UNSAVED — the opposite of what the single global draft used to do, where the
   * restored record was treated as already saved.
   */
  it('从草稿恢复出来的文档算「未保存」，切换之前仍然问', async () => {
    const { view, doc, button } = setup()

    const open = vi.spyOn(documents, 'open').mockResolvedValue(PICKED)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await act(async () => {
        button('打开').click()
      })

      expect(confirm).toHaveBeenCalled()
      expect(readDocumentSource(doc())).toBe('原来的内容\n')
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
 * Two tabs on the SAME document share one slot — decided, not accidental.
 *
 * A write from either tab destroys whatever the other put there, and that part
 * stays: one slot is last-write-wins by definition, and refusing to write would
 * break the autosave the rest of the module exists for. What is removed is the
 * SILENCE. (Two tabs on DIFFERENT documents have nothing to do with each other
 * any more — that is the per-slot baseline, unit-tested in
 * `core/autosave.test.ts`.) This is the only test that reaches the wiring.
 */
describe('跨标签页的草稿', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('另一个标签页写过更新的草稿时提示一次，并且仍然覆盖', async () => {
    seedDraft('报告.md', { content: '原来的\n', name: '报告.md' })
    const view = render(<App />)
    // The other tab wrote after this one loaded its slot — and, importantly,
    // BEFORE this tab's first write, which is the ordering that actually happens.
    foreignSlot('报告.md', '别的标签页写的\n')

    await typeInto(view, 'X')
    // 越过防抖窗口。
    await act(async () => {
      await pastDraftDebounce()
    })

    expect(view.container.querySelector('.toast')?.textContent).toContain('另一个标签页')
    // 后写者赢：这话说得出口，前提是它真的发生了。
    expect(documents.draft.load('报告.md')?.content).toBe('X原来的\n')
    view.unmount()
  })

  it('只有一个标签页时不提示', async () => {
    seedDraft('报告.md', { content: '原来的\n', name: '报告.md' })
    const view = render(<App />)

    await typeInto(view, 'X')
    await act(async () => {
      await pastDraftDebounce()
    })

    expect(view.container.querySelector('.toast')?.textContent ?? '').not.toContain('另一个标签页')
    view.unmount()
  })

  /**
   * The point of a slot per document: another tab working on a DIFFERENT document
   * writes newer records all day, and none of them concern this one. A shared
   * baseline reported every one of them as a conflict.
   */
  it('另一个标签页写的是别的文档：不误报，也不互相覆盖', async () => {
    seedDraft('甲.md', { content: '甲原来的\n', name: '甲.md' })
    const view = render(<App />)
    foreignSlot('乙.md', '乙那份\n')

    await typeInto(view, 'X')
    await act(async () => {
      await pastDraftDebounce()
    })

    expect(view.container.querySelector('.toast')?.textContent ?? '').not.toContain('另一个标签页')
    expect(documents.draft.load('甲.md')?.content).toBe('X甲原来的\n')
    expect(documents.draft.load('乙.md')?.content).toBe('乙那份\n')
    view.unmount()
  })
})

/**
 * The write-back wiring: with a file behind the document, the content gets there
 * on its own and switching stops asking. The policy's own decisions are
 * unit-tested in `core/writeBack.test.ts`; what these reach is the seam between
 * it, the draft slots and the shell's state.
 */
describe('有文件时自动写回', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  /** The file-backed document every test below opens first. */
  const FILE = {
    status: 'opened' as const,
    document: { name: '笔记.md', handle: { file: '笔记.md' } },
    content: '文件里的内容\n',
    modifiedAt: 111,
  }

  /** Opens `FILE` (or `other`) the way the picker would. */
  async function openFile(
    view: ReturnType<typeof render>,
    opened: typeof FILE = FILE,
  ) {
    const open = vi.spyOn(documents, 'open').mockResolvedValueOnce(opened)
    try {
      await act(async () => {
        findButton(view, '打开').click()
      })
    } finally {
      open.mockRestore()
    }
  }

  it('有文件的文档，切换时不再问「还没保存」', async () => {
    const view = render(<App />)
    const saveSpy = vi.spyOn(documents, 'save').mockResolvedValue({
      status: 'saved',
      document: FILE.document,
    })
    const modified = vi.spyOn(documents, 'modifiedAt').mockResolvedValue(FILE.modifiedAt)
    const confirm = vi.spyOn(window, 'confirm')
    try {
      await openFile(view)
      await typeInto(view, 'X')
      expect(readDocumentSource(documentBody(view))).toBe('X文件里的内容\n')

      await openFile(view, {
        ...FILE,
        document: { name: '另一篇.md', handle: { file: '另一篇.md' } },
        content: '另一篇的内容\n',
      })

      expect(confirm).not.toHaveBeenCalled()
      expect(readDocumentSource(documentBody(view))).toBe('另一篇的内容\n')
    } finally {
      saveSpy.mockRestore()
      modified.mockRestore()
      confirm.mockRestore()
      view.unmount()
    }
  })

  it('停顿一秒之后内容写进文件，草稿槽随之消失、脏标记也消失', async () => {
    const view = render(<App />)
    const saveSpy = vi.spyOn(documents, 'save').mockResolvedValue({
      status: 'saved',
      document: FILE.document,
    })
    const modified = vi.spyOn(documents, 'modifiedAt').mockResolvedValue(FILE.modifiedAt)
    try {
      await openFile(view)
      await typeInto(view, 'X')
      await act(async () => {
        await pastWriteBack()
      })

      expect(saveSpy).toHaveBeenCalledWith(FILE.document, 'X文件里的内容\n')
      // 内容已经在文件里了，槽不该再留着。
      expect(localStorage.getItem('taipola:draft:笔记.md')).toBeNull()
      expect(view.container.querySelector('.doc-dot')).toBeNull()
    } finally {
      saveSpy.mockRestore()
      modified.mockRestore()
      view.unmount()
    }
  })

  it('磁盘上的文件被别的程序改过：问一次，拒绝就不写，内容留在草稿里', async () => {
    const view = render(<App />)
    const saveSpy = vi.spyOn(documents, 'save').mockResolvedValue({
      status: 'saved',
      document: FILE.document,
    })
    const modified = vi.spyOn(documents, 'modifiedAt').mockResolvedValue(999)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await openFile(view)
      await typeInto(view, 'X')
      await act(async () => {
        await pastWriteBack()
      })

      expect(confirm).toHaveBeenCalledTimes(1)
      expect(confirm.mock.calls[0]?.[0]).toContain('笔记.md')
      expect(saveSpy).not.toHaveBeenCalled()
      expect(view.container.querySelector('.toast')?.textContent).toContain('停止自动写回')
      expect(JSON.parse(localStorage.getItem('taipola:draft:笔记.md') ?? '{}').content).toBe(
        'X文件里的内容\n',
      )
    } finally {
      saveSpy.mockRestore()
      modified.mockRestore()
      confirm.mockRestore()
      view.unmount()
    }
  })

  it('文件已经找不到了：不写、提示一次并停下来', async () => {
    const view = render(<App />)
    const saveSpy = vi.spyOn(documents, 'save')
    // 读不到修改时间 = 文件被删掉或移走了。照写会把它凭空重建出来。
    const modified = vi.spyOn(documents, 'modifiedAt').mockResolvedValue(null)
    try {
      await openFile(view)
      await typeInto(view, 'X')
      await act(async () => {
        await pastWriteBack()
      })

      expect(saveSpy).not.toHaveBeenCalled()
      expect(view.container.querySelector('.toast')?.textContent).toContain('找不到这个文件')
      expect(documents.draft.load('笔记.md')?.content).toBe('X文件里的内容\n')
    } finally {
      saveSpy.mockRestore()
      modified.mockRestore()
      view.unmount()
    }
  })

  it('写回失败：提示一次并停下来，之后不再自己重试', async () => {
    const view = render(<App />)
    const saveSpy = vi
      .spyOn(documents, 'save')
      .mockResolvedValue({ status: 'failed', error: new Error('disk full') })
    const modified = vi.spyOn(documents, 'modifiedAt').mockResolvedValue(FILE.modifiedAt)
    try {
      await openFile(view)
      await typeInto(view, 'X')
      await act(async () => {
        await pastWriteBack()
      })
      expect(saveSpy).toHaveBeenCalledTimes(1)
      expect(view.container.querySelector('.toast')?.textContent).toContain('写回文件失败')

      await typeInto(view, 'Y')
      await act(async () => {
        await pastWriteBack()
      })
      expect(saveSpy).toHaveBeenCalledTimes(1)
    } finally {
      saveSpy.mockRestore()
      modified.mockRestore()
      view.unmount()
    }
  })
})

/**
 * The folder sidebar: browsing a folder and switching documents inside it.
 *
 * The real directory picker is a system dialog and cannot be automated, so the
 * seam is stubbed here. What that leaves to a human — picking a real folder on a
 * real machine — is written down in the ticket's `## Comments`.
 */
describe('侧栏打开文件夹', () => {
  beforeEach(() => {
    localStorage.clear()
    // The real folder memory must not leak into this file: probe reads
    // nothing and a pick never writes (that record is tested in its own file).
    stubSavedFolder()
    vi.spyOn(folders, 'canOpen').mockReturnValue(true)
  })

  const ROOT = { name: '干草堆', handle: { dir: '干草堆' } }
  const NOTE = { name: '笔记.md', handle: { file: '笔记.md' } }
  const CHAPTER = { name: '一.md', handle: { file: '章节/一.md' } }

  /** Deliberately unsorted, and holding both what shows and what must not. */
  const ROOT_ENTRIES: FolderEntry[] = [
    { name: '截图.png', path: '截图.png', kind: 'file', handle: {} },
    { name: '章节', path: '章节', kind: 'directory', handle: {} },
    { name: '笔记.md', path: '笔记.md', kind: 'file', handle: NOTE.handle },
    { name: '.hidden.md', path: '.hidden.md', kind: 'file', handle: {} },
    { name: '空目录', path: '空目录', kind: 'directory', handle: {} },
  ]

  function stubFolders() {
    return {
      canOpen: vi.spyOn(folders, 'canOpen').mockReturnValue(true),
      pick: vi.spyOn(folders, 'pick').mockResolvedValue(ROOT),
      list: vi.spyOn(folders, 'list').mockImplementation(async (_root, path) => {
        if (path === '章节') {
          return [{ name: '一.md', path: '章节/一.md', kind: 'file', handle: CHAPTER.handle }]
        }
        // 一个真的空目录：展开它必须说一句话，而不是留一片空白。
        if (path === '空目录') return []
        return [...ROOT_ENTRIES]
      }),
    }
  }

  async function openFolder(view: ReturnType<typeof render>) {
    await act(async () => {
      findButton(view, '打开文件夹').click()
    })
  }

  const rows = (view: ReturnType<typeof render>) =>
    [...view.container.querySelectorAll('.file-tree .tree-item')].map((el) =>
      // The disclosure caret is part of the button's text; the name is the rest.
      (el.textContent ?? '').replace(/[▸▾]/g, ''),
    )

  const row = (view: ReturnType<typeof render>, label: string) =>
    [...view.container.querySelectorAll('.tree-item')].find((el) =>
      (el.textContent ?? '').includes(label),
    ) as HTMLButtonElement

  const sidebarAction = (view: ReturnType<typeof render>, label: string) =>
    [...view.container.querySelectorAll('.sidebar-action')].find(
      (el) => el.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined

  const tab = (view: ReturnType<typeof render>, label: string) =>
    [...view.container.querySelectorAll('.sidebar-tab')].find(
      (el) => el.textContent?.trim() === label,
    ) as HTMLButtonElement

  it('打开文件夹：侧栏切到「文件」，只列 Markdown 与目录，目录在前', async () => {
    stubFolders()
    const view = render(<App />)
    try {
      await openFolder(view)

      expect(view.container.querySelector('.sidebar-tab.is-active')?.textContent).toBe('文件')
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('干草堆')
      // 目录在前；同名次按名称升序（码点序，见 `core/fileTree.ts`）。
      expect(rows(view)).toEqual(['空目录', '章节', '笔记.md'])
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('打开文件夹：外壳把选中的文件夹交给记忆（save 接线）', async () => {
    stubFolders()
    const view = render(<App />)
    try {
      await openFolder(view)
      expect(vi.mocked(savedFolder.save)).toHaveBeenCalledWith({
        name: '干草堆',
        handle: { dir: '干草堆' },
      })
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('记忆写入失败（IndexedDB 满之类）：不挡住打开文件夹', async () => {
    stubFolders()
    vi.mocked(savedFolder.save).mockRejectedValueOnce(new Error('disk full'))
    const view = render(<App />)
    try {
      await openFolder(view)
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('干草堆')
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('选择器抛错：提示打开文件夹失败，侧栏不切面板、对方还是空的', async () => {
    vi.spyOn(folders, 'pick').mockRejectedValue(new Error('boom'))
    const view = render(<App />)
    try {
      await openFolder(view)
      expect(view.container.querySelector('.toast')?.textContent).toContain('打开文件夹失败')
      expect(view.container.querySelector('.sidebar-tab.is-active')?.textContent).toBe('大纲')
      expect(view.container.querySelector('.sidebar-root-name')).toBeNull()
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('点目录只展开它，不换掉正在编辑的文档；折叠再展开不再读一次', async () => {
    const stubs = stubFolders()
    const openEntry = vi.spyOn(documents, 'openEntry')
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    try {
      await openFolder(view)
      const before = readDocumentSource(documentBody(view))

      await user.click(row(view, '章节'))

      expect(readDocumentSource(documentBody(view))).toBe(before)
      expect(rows(view)).toEqual(['空目录', '章节', '一.md', '笔记.md'])
      expect(openEntry).not.toHaveBeenCalled()
      expect(stubs.list).toHaveBeenCalledTimes(2)

      // 折叠、再展开：读过的层留在缓存里，不再问一次目录。
      await user.click(row(view, '章节'))
      await user.click(row(view, '章节'))
      expect(rows(view)).toEqual(['空目录', '章节', '一.md', '笔记.md'])
      expect(stubs.list).toHaveBeenCalledTimes(2)
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('展开一个空目录：说一句「没有 Markdown 文档」，不是一片空白', async () => {
    stubFolders()
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    try {
      await openFolder(view)

      await user.click(row(view, '空目录'))

      expect(view.container.querySelector('.tree-note')?.textContent).toBe('没有 Markdown 文档')
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('点文件：当前窗口换文档、不再询问、标题栏显示相对路径、树上高亮', async () => {
    stubFolders()
    vi.spyOn(documents, 'openEntry').mockImplementation(async (doc) => ({
      status: 'opened',
      document: doc,
      content: doc.name === '一.md' ? '第一章\n' : '笔记正文\n',
      modifiedAt: 111,
    }))
    const confirm = vi.spyOn(window, 'confirm')
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    try {
      await openFolder(view)
      // 打开文件夹本身不动当前文档。
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')

      await user.click(row(view, '章节'))
      await user.click(row(view, '一.md'))

      // 有文件句柄 = 内容会自己写回，所以切换不再问任何问题。
      expect(confirm).not.toHaveBeenCalled()
      expect(readDocumentSource(documentBody(view))).toBe('第一章\n')
      // 相对路径，而不是裸文件名：同名文档在两个子目录里才分得开。
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('章节/一.md')
      expect(view.container.querySelector('.doc-name')?.getAttribute('title')).toBe(
        '干草堆/章节/一.md',
      )
      expect(row(view, '一.md').classList.contains('is-active')).toBe(true)
      // 点开的文件就是记忆里要留给下次重载的那一个。
      expect(vi.mocked(savedFolder.rememberFile)).toHaveBeenCalledWith('章节/一.md')

      // Settle before the next switch. Without this the second swap loses: an
      // input/blur round-trip queued by the FIRST switch (and the write-back it
      // started) lands after the second `setDocument` and writes the previous
      // text back through `onChange`. Recorded in the ticket's Comments as an
      // ordering question for a real browser.
      await act(async () => {})
      const openEntry = vi.mocked(documents.openEntry)
      await user.click(row(view, '笔记.md'))
      expect(openEntry).toHaveBeenCalledTimes(2)
      expect(openEntry.mock.calls[1]?.[0]).toEqual({ name: '笔记.md', handle: NOTE.handle })
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('笔记.md')
      expect(confirm).not.toHaveBeenCalled()
      expect(readDocumentSource(documentBody(view))).toBe('笔记正文\n')
      expect(row(view, '笔记.md').classList.contains('is-active')).toBe(true)
      expect(row(view, '一.md').classList.contains('is-active')).toBe(false)
      expect(vi.mocked(savedFolder.rememberFile)).toHaveBeenCalledWith('笔记.md')
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  /**
   * 「点文件不询问」的成立条件是当前文档**有文件**：01 把提示留在没有文件的
   * 文档上（草稿是它唯一的副本），这里钉住那一半，免得读成"什么都不问了"。
   */
  it('当前文档没有文件、又有没保存的内容：切换仍然先问', async () => {
    stubFolders()
    vi.spyOn(documents, 'openEntry').mockResolvedValue({
      status: 'opened',
      document: CHAPTER,
      content: '第一章\n',
      modifiedAt: 111,
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    try {
      await typeInto(view, 'X')
      const before = readDocumentSource(documentBody(view))
      await openFolder(view)

      await user.click(row(view, '章节'))
      await user.click(row(view, '一.md'))

      expect(confirm).toHaveBeenCalledTimes(1)
      // 拒绝之后整篇没被替换。
      expect(readDocumentSource(documentBody(view))).toBe(before)
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('有没写回文件的文档在树上带标记', async () => {
    localStorage.setItem(
      'taipola:draft:干草堆/笔记.md',
      JSON.stringify({
        content: '没写回的改动\n',
        name: '笔记.md',
        savedAt: 1,
        root: '干草堆',
        path: '笔记.md',
      }),
    )
    stubFolders()
    const view = render(<App />)
    try {
      await openFolder(view)

      expect(row(view, '笔记.md').querySelector('.tree-badge')).not.toBeNull()
      expect(row(view, '空目录').querySelector('.tree-badge')).toBeNull()
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('刷新重读读过的层，行还在', async () => {
    const stubs = stubFolders()
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    try {
      await openFolder(view)
      expect(stubs.list).toHaveBeenCalledTimes(1)

      await user.click(sidebarAction(view, '刷新')!)
      // 读目录是异步的：等它落完再断言。
      await act(async () => {})

      expect(stubs.list).toHaveBeenCalledTimes(2)
      expect(rows(view)).toEqual(['空目录', '章节', '笔记.md'])
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('刷新读不动时，树保留原来那些行，只提示一次', async () => {
    const stubs = stubFolders()
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    try {
      await openFolder(view)

      stubs.list.mockRejectedValue(new Error('权限被撤了'))
      await user.click(sidebarAction(view, '刷新')!)
      await act(async () => {})

      // 缓存不是先清后读：读失败不该把用户正在看的树换成一片「正在读取…」。
      expect(rows(view)).toEqual(['空目录', '章节', '笔记.md'])
      expect(view.container.querySelector('.toast')?.textContent).toContain('读取文件夹失败')
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('文件夹选择器被取消：什么都不发生，连面板都不换', async () => {
    vi.spyOn(folders, 'canOpen').mockReturnValue(true)
    vi.spyOn(folders, 'pick').mockResolvedValue(null)
    const view = render(<App />)
    try {
      await openFolder(view)

      expect(view.container.querySelector('.sidebar-tab.is-active')?.textContent).toBe('大纲')
      expect(view.container.querySelector('.sidebar-root-name')).toBeNull()
      expect(view.container.querySelector('.file-tree')).toBeNull()
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('平台不能开文件夹时：入口不出现，也不给一个只能失败的按钮', async () => {
    vi.spyOn(folders, 'canOpen').mockReturnValue(false)
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    try {
      expect(
        view.container.querySelector('.titlebar-right [aria-label="打开文件夹"]'),
      ).toBeNull()
      expect(view.container.querySelector('.titlebar-mini [aria-label="打开文件夹"]')).toBeNull()

      await user.click(tab(view, '文件'))

      expect(sidebarAction(view, '打开文件夹')).toBeUndefined()
      expect(view.container.querySelector('.outline-empty')?.textContent).toContain('不能打开文件夹')
    } finally {
      vi.restoreAllMocks()
      view.unmount()
    }
  })

  it('侧栏面板的选择被记住', () => {
    localStorage.setItem('taipola:sidebar-panel', 'files')
    const view = render(<App />)
    try {
      expect(view.container.querySelector('.sidebar-tab.is-active')?.textContent).toBe('文件')
    } finally {
      view.unmount()
    }
  })
})

/**
 * 重开页面后的文件夹记忆（`.scratch/folder-sidebar/issues/03`）。
 *
 * 权限能不能活过重载是浏览器的决定（Chrome 122+ 有持久权限），所以外壳只认
 * `savedFolder` 给的判词：`restorable` 静默恢复、`offered` 亮一个按钮、
 * 拒绝就消失。真实 IndexedDB 的存取在 `savedFolder.test.ts` 里测，这里换掉。
 */
describe('侧栏记忆上次的文件夹', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(folders, 'canOpen').mockReturnValue(true)
    vi.spyOn(folders, 'list').mockResolvedValue([
      { name: '笔记.md', path: '笔记.md', kind: 'file', handle: {} },
    ])
    // 恢复「上次打开的文件」要过两条接缝：按路径找回句柄（folder 的 `fileAt`），
    // 按句柄读内容（documents 的 `openEntry`）。都桩成「笔记.md 能找到、其他没有」。
    vi.spyOn(folders, 'fileAt').mockImplementation(async (_root, path) =>
      path === '笔记.md'
        ? { name: '笔记.md', path: '笔记.md', kind: 'file', handle: NOTE.handle }
        : null,
    )
    vi.spyOn(documents, 'openEntry').mockImplementation(async (doc) => ({
      status: 'opened',
      document: doc,
      content: '笔记正文\n',
      modifiedAt: 111,
    }))
  })

  const ROOT = { name: '干草堆', handle: { dir: '干草堆' } }
  const NOTE = { name: '笔记.md', handle: { file: '笔记.md' } }

  const sidebarAction = (view: ReturnType<typeof render>, label: string) =>
    [...view.container.querySelectorAll('.sidebar-action')].find(
      (el) => el.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined

  const treeRows = (view: ReturnType<typeof render>) =>
    [...view.container.querySelectorAll('.file-tree .tree-item')].map((el) =>
      (el.textContent ?? '').replace(/[▸▾]/g, ''),
    )

  it('授权还活着：重开页面直接恢复文件夹，没有按钮、树已经在', async () => {
    stubSavedFolder({ status: 'restorable', root: ROOT, lastFile: null })
    // 静默恢复不抢面板（尊重记住的偏好）；把偏好设成「文件」才能看见树，
    // 与「offered」那条（按钮必须可见、自动切面板）对比。
    localStorage.setItem('taipola:sidebar-panel', 'files')
    const view = render(<App />)
    try {
      await act(async () => {})
      await act(async () => {})
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('干草堆')
      expect(sidebarAction(view, '恢复上次的文件夹')).toBeUndefined()
      expect(treeRows(view)).toEqual(['笔记.md'])
    } finally {
      view.unmount()
    }
  })

  it('授权没了：出现「恢复上次的文件夹」，点一下树出来、按钮消失', async () => {
    stubSavedFolder({ status: 'offered', root: ROOT, lastFile: null })
    const view = render(<App />)
    try {
      await act(async () => {})
      // 面板自动切到「文件」，否则这个按钮在没人看的那个面板里。
      expect(view.container.querySelector('.sidebar-tab.is-active')?.textContent).toBe('文件')
      expect(sidebarAction(view, '恢复上次的文件夹')).toBeDefined()
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('没有打开文件夹')

      await act(async () => {
        sidebarAction(view, '恢复上次的文件夹')!.click()
      })
      await act(async () => {})
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('干草堆')
      expect(treeRows(view)).toEqual(['笔记.md'])
      expect(sidebarAction(view, '恢复上次的文件夹')).toBeUndefined()
    } finally {
      view.unmount()
    }
  })

  it('点「恢复」被拒：按钮消失、树不出现，这一会话不再问', async () => {
    stubSavedFolder({ status: 'offered', root: ROOT, lastFile: null })
    vi.mocked(savedFolder.authorize).mockResolvedValueOnce(false)
    const view = render(<App />)
    try {
      await act(async () => {})
      expect(sidebarAction(view, '恢复上次的文件夹')).toBeDefined()

      await act(async () => {
        sidebarAction(view, '恢复上次的文件夹')!.click()
      })
      await act(async () => {})
      expect(sidebarAction(view, '恢复上次的文件夹')).toBeUndefined()
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('没有打开文件夹')
    } finally {
      view.unmount()
    }
  })

  it('点「恢复」时后台出错：提示一次，按钮消失、树不出现', async () => {
    stubSavedFolder({ status: 'offered', root: ROOT, lastFile: null })
    vi.mocked(savedFolder.authorize).mockRejectedValueOnce(new Error('boom'))
    const view = render(<App />)
    try {
      await act(async () => {})
      await act(async () => {
        sidebarAction(view, '恢复上次的文件夹')!.click()
      })
      await act(async () => {})
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('没有打开文件夹')
      expect(sidebarAction(view, '恢复上次的文件夹')).toBeUndefined()
      expect(view.container.querySelector('.toast')?.textContent).toContain('恢复文件夹失败')
    } finally {
      view.unmount()
    }
  })

  it('文件夹回来了，上次打开的文件自己也打开（像一次树点击那样重读）', async () => {
    stubSavedFolder({ status: 'restorable', root: ROOT, lastFile: '笔记.md' })
    const view = render(<App />)
    try {
      await act(async () => {})
      await act(async () => {})
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('笔记.md')
      expect(readDocumentSource(documentBody(view))).toBe('笔记正文\n')
      expect(vi.mocked(documents.openEntry)).toHaveBeenCalledWith(NOTE)
      expect(view.container.querySelector('.toast')?.textContent).toContain('已打开 笔记.md')
    } finally {
      view.unmount()
    }
  })

  it('记忆的文件不在了（改名/删除）：留在欢迎文档，不打扰、不提示', async () => {
    stubSavedFolder({ status: 'restorable', root: ROOT, lastFile: '没了.md' })
    const view = render(<App />)
    try {
      await act(async () => {})
      await act(async () => {})
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()
      expect(view.container.querySelector('.toast')).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('草稿回来的文档已经在同一文件夹里：记忆的文件不能把它顶掉', async () => {
    // 上一会话有一份没写回文件的内容，住在这个文件夹的槽里——它只有这一份拷贝。
    localStorage.setItem(
      'taipola:draft:干草堆/章节/一.md',
      JSON.stringify({
        content: '没写回的内容\n',
        name: '一.md',
        savedAt: 1_000,
        root: '干草堆',
        path: '章节/一.md',
      }),
    )
    localStorage.setItem('taipola:active-draft', '干草堆/章节/一.md')
    stubSavedFolder({ status: 'restorable', root: ROOT, lastFile: '笔记.md' })
    const view = render(<App />)
    try {
      await act(async () => {})
      await act(async () => {})
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('章节/一.md')
      expect(readDocumentSource(documentBody(view))).toBe('没写回的内容\n')
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('授权要再问：不点「恢复」就保持欢迎文档，点了之后文件跟着回来', async () => {
    stubSavedFolder({ status: 'offered', root: ROOT, lastFile: '笔记.md' })
    const view = render(<App />)
    try {
      await act(async () => {})
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()

      await act(async () => {
        sidebarAction(view, '恢复上次的文件夹')!.click()
      })
      await act(async () => {})
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('笔记.md')
      expect(readDocumentSource(documentBody(view))).toBe('笔记正文\n')
    } finally {
      view.unmount()
    }
  })

  it('不点「恢复」、而是新开一个文件夹：上回的记忆文件不跟着来', async () => {
    stubSavedFolder({ status: 'offered', root: ROOT, lastFile: '笔记.md' })
    vi.spyOn(folders, 'pick').mockResolvedValue({ name: '另一个目录', handle: {} })
    const view = render(<App />)
    try {
      await act(async () => {})
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')

      await act(async () => {
        findButton(view, '打开文件夹').click()
      })
      await act(async () => {})
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('另一个目录')
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('点「恢复」前在 welcome 里打过字：不顶掉那半篇没落盘的内容', async () => {
    stubSavedFolder({ status: 'offered', root: ROOT, lastFile: '笔记.md' })
    const confirm = vi.spyOn(window, 'confirm')
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    try {
      await act(async () => {})
      // 用户先往 welcome 里敲了字（草稿是它唯一的拷贝），然后才点「恢复」。
      const doc = documentBody(view)
      doc.focus({ preventScroll: true })
      const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
      if (!run?.firstChild) throw new Error('first run has no text node')
      placeCaretAt(run.firstChild, 0)
      await user.keyboard('X')

      await act(async () => {
        sidebarAction(view, '恢复上次的文件夹')!.click()
      })
      await act(async () => {})
      expect(view.container.querySelector('.doc-name')?.textContent).toBe('welcome.md')
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()
      expect(confirm).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('上次的草稿被手动保存后：记忆的文件也不来顶（保存也是一次选择）', async () => {
    // 另一文件夹 C 的槽位草稿在屏上；恢复的是文件夹干草堆，记忆文件是 笔记.md。
    localStorage.setItem(
      'taipola:draft:C/草稿.md',
      JSON.stringify({
        content: '另一文件夹的草稿\n',
        name: '草稿.md',
        savedAt: 1_000,
        root: 'C',
        path: '草稿.md',
      }),
    )
    localStorage.setItem('taipola:active-draft', 'C/草稿.md')
    stubSavedFolder({ status: 'restorable', root: ROOT, lastFile: '笔记.md' })
    vi.spyOn(documents, 'save').mockResolvedValue({
      status: 'saved',
      document: { name: '草稿.md', handle: {} },
    })
    vi.spyOn(documents, 'modifiedAt').mockResolvedValue(1)
    const view = render(<App />)
    try {
      await act(async () => {})
      await act(async () => {})
      // 草稿还在屏上时，dirty 守卫拦着自动重开。
      expect(readDocumentSource(documentBody(view))).toBe('另一文件夹的草稿\n')
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()

      // 用户手动保存：内容有了第二份拷贝，dirty 变 false，effect 会重跑——
      // 但"保存"本身就是一次选择，记忆无权再把它换掉。
      await act(async () => {
        findButton(view, '保存').click()
      })
      await act(async () => {})
      expect(readDocumentSource(documentBody(view))).toBe('另一文件夹的草稿\n')
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('找回句柄期间用户自己打开了文档：晚回来的记忆不顶掉人家的', async () => {
    stubSavedFolder({ status: 'restorable', root: ROOT, lastFile: '笔记.md' })
    // fileAt 悬着：probe 已落定、文件夹已恢复，但记忆的句柄还没找回来。
    let settle!: (entry: FolderEntry | null) => void
    vi.spyOn(folders, 'fileAt').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    vi.spyOn(documents, 'open').mockResolvedValue({
      status: 'opened',
      document: { name: '自己开的.md', handle: {} },
      content: '我自己打开的\n',
      modifiedAt: 1,
    })
    const view = render(<App />)
    try {
      await act(async () => {})
      // 窗口期里用户用选择器打开了一个文件（这次打开不翻转任何 effect 依赖，
      // 只能靠 await 之后的重查拦住——修的就是这一刀）。
      await act(async () => {
        findButton(view, '打开').click()
      })
      expect(readDocumentSource(documentBody(view))).toBe('我自己打开的\n')

      await act(async () => {
        settle({ name: '笔记.md', path: '笔记.md', kind: 'file', handle: NOTE.handle })
      })
      await act(async () => {})
      expect(readDocumentSource(documentBody(view))).toBe('我自己打开的\n')
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('probe 还悬着就新开了文件夹：晚到的旧记录不把新文件夹顶掉', async () => {
    stubSavedFolder()
    let settle!: (status: SavedFolderStatus) => void
    vi.spyOn(savedFolder, 'probe').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    vi.spyOn(folders, 'pick').mockResolvedValue({ name: '另一个目录', handle: {} })
    const view = render(<App />)
    try {
      await act(async () => {})
      // probe 在路上，用户先自己选了一个文件夹。
      await act(async () => {
        findButton(view, '打开文件夹').click()
      })
      await act(async () => {})
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('另一个目录')

      // probe 这才落定：上一会话的记录不得写回新文件夹之上。
      await act(async () => {
        settle({ status: 'offered', root: ROOT, lastFile: '笔记.md' })
      })
      await act(async () => {})
      expect(view.container.querySelector('.sidebar-root-name')?.textContent).toBe('另一个目录')
      expect(sidebarAction(view, '恢复上次的文件夹')).toBeUndefined()
      expect(vi.mocked(documents.openEntry)).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('恢复落定前用户已经自己打开过文档：记忆的文件不顶掉人家的', async () => {
    stubSavedFolder()
    let settle!: (status: SavedFolderStatus) => void
    vi.spyOn(savedFolder, 'probe').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    vi.spyOn(documents, 'open').mockResolvedValue({
      status: 'opened',
      document: { name: '自己开的.md', handle: {} },
      content: '我自己打开的\n',
      modifiedAt: 1,
    })
    const view = render(<App />)
    try {
      // 用户先自己打开了一个文件（probe 还在路上）。
      await act(async () => {
        findButton(view, '打开').click()
      })
      expect(readDocumentSource(documentBody(view))).toBe('我自己打开的\n')

      // probe 这才落定：文件夹可静默恢复，还带着上次的文件。
      await act(async () => {
        settle({ status: 'restorable', root: ROOT, lastFile: '笔记.md' })
      })
      await act(async () => {})
      expect(readDocumentSource(documentBody(view))).toBe('我自己打开的\n')
    } finally {
      view.unmount()
    }
  })
})

/**
 * The format toolbar's icons.
 *
 * Reported three times, and the third one is why the row is now ONE family: first
 * the 链接 button was visibly larger than every label beside it (it was the emoji
 * `🔗`, which the colour-emoji font paints at its own size while ignoring both
 * `font-size` and `color`), then the rest of the row was still uneven — `▦` a solid
 * block, `•` a speck, `❝` oversized — because a font glyph's ink is whatever that
 * font decides, and finally the six labels that had stayed text (`B I S H1 H2 H3`)
 * were themselves the last thing in the row whose size nothing controlled.
 *
 * They are `<text>` INSIDE the same 16-unit frame now, so a letterform still says
 * what it always said while its ink is measured like every other icon's. These
 * tests hold that: every button draws an SVG, and every SVG's ink fits the frame at
 * a comparable size.
 */
describe('工具栏的图标', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  /** Every command in the row, in draw order. */
  const TOOLBAR = [
    '加粗',
    '斜体',
    '删除线',
    '一级标题',
    '二级标题',
    '三级标题',
    '行内代码',
    '引用',
    '无序列表',
    '有序列表',
    '任务列表',
    '插入表格',
    '代码块',
    '链接',
  ]

  const buttonFor = (view: ReturnType<typeof render>, name: string) =>
    view.container.querySelector(`[aria-label^="${name} "]`) as HTMLElement | null

  it('每一个按钮都是画出来的（一排里不再有字）', () => {
    const view = render(<App />)
    for (const name of TOOLBAR) {
      const button = buttonFor(view, name)
      expect(button, `${name} 不见了`).not.toBeNull()
      expect(button!.querySelector('svg'), `${name} 应当是画出来的`).not.toBeNull()
      // 文字（如果有）必须在这个框里面：裸标签的字号没人管，框里的有。
      expect(button!.querySelector('svg')!.textContent.length >= 0, name).toBe(true)
      for (const node of Array.from(button!.childNodes)) {
        expect(node.nodeType, `${name} 不该有裸文字节点`).not.toBe(Node.TEXT_NODE)
      }
    }
    view.unmount()
  })

  it('每个图标单色、跟随按钮的 color，墨迹收在 16 单位的框内且大小相当', () => {
    const view = render(<App />)
    for (const name of TOOLBAR) {
      const button = buttonFor(view, name)!
      const svg = button.querySelector('svg') as SVGSVGElement

      // 单色 + 继承 currentColor：emoji 做不到的正是这两件事。
      expect(svg.getAttribute('stroke'), name).toBe('currentColor')
      expect(getComputedStyle(svg).stroke, name).toBe(getComputedStyle(button).color)

      // `getBBox()` on a `<text>` reports the font's LINE box (ascent 1em plus
      // descent), not the ink it holds, so a letter at the documented size pokes
      // about a unit out of the frame with none of its glyphs outside. Only the
      // drawn icons are held to the frame exactly.
      const slack = svg.querySelector('text') ? 1 : 0
      const ink = svg.getBBox()
      expect(ink.x, `${name} 左`).toBeGreaterThanOrEqual(-slack)
      expect(ink.y, `${name} 上`).toBeGreaterThanOrEqual(-slack)
      expect(ink.x + ink.width, `${name} 右`).toBeLessThanOrEqual(16 + slack)
      expect(ink.y + ink.height, `${name} 底`).toBeLessThanOrEqual(16 + slack)
      // 大小相当 —— 排成一排时"整齐"的定义就是高度对齐、宽度没有离群的。高度是
      // 这一排对齐的信号（同一套 16 单位网格、同一个描边），宽度只挡住"一个小点"：
      // 字母天生比画出来的形状窄，斜体的 `I` 更是只有一条斜杠。
      expect(ink.height, `${name} 高`).toBeGreaterThan(8.5)
      expect(ink.width, `${name} 宽`).toBeGreaterThan(4)
    }
    view.unmount()
  })

  it('换成 SVG 之后链接命令照旧（图标是外壳，命令没动）', async () => {
    seedDraft('untitled.md', { content: '正文\n', name: 'untitled.md' })
    const view = render(<App />)
    const doc = documentBody(view)
    // 先 focus 再设选区：反过来的话 focus() 会把刚设好的选区清掉（ADR-0002 §2 第 1 条）。
    doc.focus({ preventScroll: true })
    const run = doc.querySelector('[data-block="0"] [data-run="0"]') as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(run)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const user = userEvent.setup({ delay: null })
    await user.click(buttonFor(view, '链接')!)
    expect(readDocumentSource(doc)).toContain('[链接文字](url)')
    view.unmount()
  })
})
