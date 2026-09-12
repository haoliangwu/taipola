import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { documents } from '../platform/documents'
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