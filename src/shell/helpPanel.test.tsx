/**
 * 快捷键帮助浮窗（标题栏右上角的 `?`）。
 *
 * 这一份列表的"真伪"由 `core/shortcutHelp.test.ts` 保证（每一条键位都要能被
 * `shortcutFor` 还原成它旁边写的那个命令）。这里管的是外壳那一半：按钮在不在、
 * 浮窗里是不是**全部**快捷键、图标有没有跟上、以及它按 app 里其他弹层的方式关掉。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { page } from 'vitest/browser'
import userEvent from '@testing-library/user-event'
import App from './App'
import { SHORTCUT_GROUPS } from '../core/shortcutHelp'
import { seedDoc } from '../test/appTestUtils'

const NARROW = [390, 844] as const
const DESKTOP = [1280, 800] as const

afterEach(async () => {
  localStorage.clear()
  await page.viewport(...DESKTOP)
})
import { stubSavedFolder } from '../test/platformStubs'

function helpButton(container: HTMLElement): HTMLElement {
  return container.querySelector('[aria-label="快捷键"]') as HTMLElement
}

function panel(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.help-panel')
}

describe('快捷键浮窗', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
    seedDoc('正文\n')
  })

  it('标题栏里有帮助按钮，默认不露出浮窗', () => {
    const view = render(<App />)
    expect(helpButton(view.container)).not.toBeNull()
    expect(panel(view.container)).toBeNull()
    view.unmount()
  })

  it('点开：每一组、每一条快捷键都在里面', async () => {
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    await user.click(helpButton(view.container))

    const open = panel(view.container)!
    expect(open).not.toBeNull()
    for (const group of SHORTCUT_GROUPS) {
      // 组标题
      expect(
        [...open.querySelectorAll('.help-group h2')].map((h) => h.textContent),
        '组标题',
      ).toContain(group.title)
      // 组里每一条：名字 + 键位
      for (const item of group.items) {
        const row = [...open.querySelectorAll('.help-group li')].find(
          (li) => li.querySelector('.help-name')?.textContent === item.name,
        )
        expect(row, `${item.name} 不见了`).toBeDefined()
        expect(row!.querySelector('kbd')?.textContent).toBe(item.keys)
      }
    }
    view.unmount()
  })

  it('有工具栏图标的条目都画出来了，且和工具栏是同一套', async () => {
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    await user.click(helpButton(view.container))
    const open = panel(view.container)!

    // 加粗那一行必须画一个 svg（不是文字标签）——浮窗同时是工具栏的图例。
    const boldRow = [...open.querySelectorAll('.help-group li')].find(
      (li) => li.querySelector('.help-name')?.textContent === '加粗',
    )!
    expect(boldRow.querySelector('.help-icon svg')).not.toBeNull()

    // 没有图标的条目留空位，但格子还在（名字不会因此左右跳动）。
    const noIcon = [...open.querySelectorAll('.help-group li')].find(
      (li) => li.querySelector('.help-name')?.textContent === '保存',
    )!
    expect(noIcon.querySelector('.help-icon svg')).not.toBeNull()
    view.unmount()
  })

  it('再点一次、点别处、按 Esc 都能关掉', async () => {
    const view = render(<App />)
    const user = userEvent.setup({ delay: null })
    await user.click(helpButton(view.container))
    await user.click(helpButton(view.container))
    expect(panel(view.container)).toBeNull()

    await user.click(helpButton(view.container))
    await user.keyboard('{Escape}')
    expect(panel(view.container)).toBeNull()

    await user.click(helpButton(view.container))
    await user.click(document.body)
    expect(panel(view.container)).toBeNull()
    view.unmount()
  })

  it('窄屏（手机）上它不可见：手机没有键盘可查', async () => {
    // `page.viewport` 重设的是测试 iframe 的尺寸，媒体查询跟着切——真断点，不是
    // 断言 CSS 文本。按钮跟着桌面组走（`.titlebar-right` 在窄屏下 `display: none`），
    // 所以它在 DOM 里但看不见也点不着；窄屏 header 只有 mini 组，那个组的成员在
    // `mobileShell.test.tsx` 里被钉死。
    await page.viewport(...NARROW)
    const view = render(<App />)
    const button = helpButton(view.container)
    const desktopGroup = button.closest('.titlebar-right') as HTMLElement
    expect(getComputedStyle(desktopGroup).display).toBe('none')
    expect(button.getBoundingClientRect().width).toBe(0)
    view.unmount()
  })
})
