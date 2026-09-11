import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { loadDraft } from './lib/files'

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
    const rect = run.getBoundingClientRect()
    const user = userEvent.setup({ delay: null })
    await user.pointer({
      target: run,
      keys: '[MouseLeft]',
      coords: { x: rect.width - 2, y: rect.height / 2 },
    })
    for (let i = 0; i < 4; i++) await user.keyboard('{Backspace}')
    // Let the input event commit, then simulate the refresh's pagehide BEFORE
    // the 500ms debounce timer would ever fire.
    await new Promise((resolve) => setTimeout(resolve, 50))
    window.dispatchEvent(new Event('pagehide'))
    const draft = loadDraft()
    // The real caret sat at the line end, so 4 Backspaces removed 4 characters.
    expect(draft?.content).toBe('# 它FINA==现在\n\n正文\n')
    view.unmount()
  })
})