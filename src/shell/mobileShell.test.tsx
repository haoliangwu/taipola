/**
 * 窄屏外壳：大纲变 drawer，命令面挪进 header 的 mini 组。
 *
 * `page.viewport` 重设的是测试 iframe 的尺寸，媒体查询跟着切——所以这里测的是真的断点，
 * 不是"断言 CSS 文本里写了这条规则"。窄屏那一组就是票据
 * `.scratch/mobile-view/issues/01-narrow-screen-shell-chrome.md` 的回归测试：
 * 改动前 `.outline` 被媒体查询无条件藏掉，标题栏那个开关点了没有任何反应。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { page } from 'vitest/browser'
import App from './App'
import { documents } from '../platform/documents'

const NARROW = [390, 844] as const
const NARROW_SMALL = [360, 780] as const
const DESKTOP = [1280, 800] as const

/** 视口是 iframe 级别的状态，别漏给同文件后面的用例。 */
afterEach(async () => {
  vi.restoreAllMocks()
  localStorage.clear()
  await page.viewport(...DESKTOP)
})
function renderApp() {
  const view = render(<App />)
  const user = userEvent.setup({ delay: null })
  const el = (selector: string) => view.container.querySelector<HTMLElement>(selector)
  const visible = (selector: string) => {
    const node = el(selector)
    return node !== null && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0
  }
  return { view, user, el, visible, container: view.container }
}

describe('窄屏外壳（390px）', () => {
  beforeEach(async () => {
    await page.viewport(...NARROW)
  })

  it('大纲默认收起：画布留给自己', () => {
    const { el } = renderApp()
    expect(el('.outline')).toBeNull()
    expect(el('.scrim')).toBeNull()
  })

  it('标题栏那个开关不再点了没反应', async () => {
    const { user, el, visible } = renderApp()
    await user.click(el('[aria-label="切换大纲"]')!)
    // 改动前这一步在窄屏上什么都不会发生（`.outline { display: none }`）。
    expect(visible('.outline')).toBe(true)
    expect(visible('.scrim')).toBe(true)
    // 再点一次收起来。
    await user.click(el('[aria-label="切换大纲"]')!)
    expect(el('.outline')).toBeNull()
  })

  it('点遮罩关闭抽屉', async () => {
    const { user, el } = renderApp()
    await user.click(el('[aria-label="切换大纲"]')!)
    await user.click(el('.scrim')!)
    expect(el('.outline')).toBeNull()
  })

  it('Escape 关闭抽屉', async () => {
    const { user, el } = renderApp()
    await user.click(el('[aria-label="切换大纲"]')!)
    await user.keyboard('{Escape}')
    expect(el('.outline')).toBeNull()
  })

  it('跳转到大纲里的一项之后自动关闭（抽屉不能挡着刚跳到的位置）', async () => {
    const { user, el } = renderApp()
    await user.click(el('[aria-label="切换大纲"]')!)
    const item = el('.outline-item')!
    expect(item).not.toBeNull()
    await user.click(item)
    expect(el('.outline')).toBeNull()
  })

  it('格式工具条让位给 mini 组，保存与导出都点得通', async () => {
    // 回写成功之后就沿用同一个显示名——用 `x.md` 会让后面的导出断言测到假名字。
    const save = vi.spyOn(documents, 'save').mockImplementation(async (_doc, _value, options) => ({
      status: 'saved',
      document: { name: options?.name ?? 'welcome.md', handle: null },
    }))
    const html = vi.spyOn(documents, 'exportHtml')
    const markdown = vi.spyOn(documents, 'exportMarkdown')

    const { user, el, visible } = renderApp()
    expect(visible('.toolbar')).toBe(false)
    expect(visible('.titlebar-mini')).toBe(true)

    await user.click(el('.titlebar-mini [aria-label="保存"]')!)
    // 与桌面组同一份显示名：手机上的保存不该是"另一个保存"。
    expect(save).toHaveBeenCalledWith(null, expect.any(String), {
      forcePicker: false,
      name: 'welcome.md',
    })

    await user.click(el('.titlebar-mini [aria-label="导出"]')!)
    const items = [...el('.mini-menu')!.querySelectorAll('button')]
    expect(items.map((b) => b.textContent?.trim())).toEqual(['导出 HTML', '导出 MD'])
    await user.click(items[0])
    expect(html).toHaveBeenCalledWith(expect.any(String), 'welcome.md')
    // 选完就收起来，菜单不该留在屏幕上。
    expect(el('.mini-menu')).toBeNull()

    await user.click(el('.titlebar-mini [aria-label="导出"]')!)
    await user.click(el('.mini-menu')!.querySelectorAll('button')[1])
    expect(markdown).toHaveBeenCalledWith(expect.any(String), 'welcome.md')
  })

  it('点别处关掉导出菜单', async () => {
    const { user, el } = renderApp()
    await user.click(el('.titlebar-mini [aria-label="导出"]')!)
    expect(el('.mini-menu')).not.toBeNull()
    await user.click(el('.doc-name')!)
    expect(el('.mini-menu')).toBeNull()
  })

  it('跨断点时会按新模式重判：抽屉不会留在画布上，常驻栏会回来', async () => {
    // 桌面 → 窄：原来的常驻列不能变成盖住文档的抽屉。
    await page.viewport(...DESKTOP)
    const { el, visible, view } = renderApp()
    expect(visible('.outline')).toBe(true)
    await act(async () => {
      await page.viewport(...NARROW)
      // iframe 改尺寸之后浏览器还要跑一轮布局才会派发 matchMedia 的 change。
      await new Promise((r) => setTimeout(r, 60))
    })
    expect(el('.outline')).toBeNull()
    // 窄 → 桌面：常驻栏回来（回到该模式的默认），遮罩不占位。
    await act(async () => {
      await page.viewport(...DESKTOP)
      await new Promise((r) => setTimeout(r, 60))
    })
    expect(visible('.outline')).toBe(true)
    expect(visible('.scrim')).toBe(false)
    view.unmount()
  })

  it('长文件名不会把 header 撑出横向溢出（360 与 390 都试）', async () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({
        content: '# 标题\n\n正文\n',
        name: '一个相当长的文件名用来撑爆头部预算的报告.md',
        savedAt: Date.now(),
      }),
    )
    for (const [width, height] of [NARROW, NARROW_SMALL]) {
      await page.viewport(width, height)
      const { el, view, visible } = renderApp()
      const header = el('.titlebar')!
      // 断言 header 自己的预算：改动前这里是 676/390（整条格式工具条挤在里面），
      // 而文档级的 scrollWidth 一直是相等的，量不出问题。
      expect(header.clientWidth).toBe(width)
      expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)
      // 文件名被省略号截断，而不是把 mini 组挤出屏幕。
      expect(visible('.titlebar-mini')).toBe(true)
      expect(el('.doc-name')!.clientWidth).toBeLessThan(width / 2)
      view.unmount()
    }
  })
})

describe('桌面外壳（1280px）不变', () => {
  beforeEach(async () => {
    await page.viewport(...DESKTOP)
  })

  it('大纲仍是常驻栏，工具条在，mini 组与遮罩不可见', () => {
    const { el, visible } = renderApp()
    expect(visible('.outline')).toBe(true)
    expect(visible('.toolbar')).toBe(true)
    expect(visible('.titlebar-right')).toBe(true)
    expect(visible('.titlebar-mini')).toBe(false)
    // 遮罩元素即使存在也不该占位（`.outline` 开着时它才被渲染，桌面上一律 display: none）。
    expect(visible('.scrim')).toBe(false)
    // 而且它还是"那一列"，不是抽屉：定位没变、宽度还是 244px。
    // （截图对比过：改动前后桌面版像素零差异，这条是那份证据在测试里的替身。）
    const outline = el('.outline')!
    expect(getComputedStyle(outline).position).toBe('static')
    expect(outline.getBoundingClientRect().width).toBe(244)
  })

  it('开关在桌面上仍是收起/展开那一列', async () => {
    const { user, el } = renderApp()
    await user.click(el('[aria-label="切换大纲"]')!)
    expect(el('.outline')).toBeNull()
  })
})