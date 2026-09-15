import { beforeEach, describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithDoc } from '../test/appTestUtils'
import { placeCaretAt } from '../test/editorTestUtils'
import { readDocumentSource } from '../editor/render'
import { stubSavedFolder } from '../test/platformStubs'

/**
 * 编辑器内的代码块高亮（`.scratch/code-highlighting/issues/01`）。
 *
 * 高亮把一行拆成多个 run —— 这正好踩在 ADR-0002 §1 的地界上：「run 分段在隐藏与
 * 显现两个状态间保持一致」，以及「源码是权威，DOM 只是反射」。所以这里测的不是
 * "有没有颜色"，而是**拆完之后光标还在不在用户看到的地方**、DOM 还能不能逐字拼回源码。
 */

const DOC = '```ts\nconst a: number = 1\n```'

/** 把光标放到某个 run 文本里的第 `at` 个字符处。 */
function caretInto(el: Element | null, at: number): void {
  const text = el?.firstChild as Text | null
  if (!text) throw new Error('no run text')
  placeCaretAt(text, at)
}

/** 直接读某一行盒里所有 run 的文本。 */
function lineText(doc: HTMLElement, vline: number): string {
  const runs = [...doc.querySelectorAll(`[data-block="0"] [data-vline="${vline}"] [data-run]`)]
  return runs.map((run) => run.textContent ?? '').join('')
}

describe('代码块高亮：渲染', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('围栏内容被拆成多个 token run，且 DOM 仍逐字保留整篇源码', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const runs = [...doc.querySelectorAll('[data-block="0"] [data-vline="1"] [data-run]')]
    expect(runs.length).toBeGreaterThan(1)
    expect(runs.some((run) => run.classList.contains('hljs-keyword'))).toBe(true)
    // 逐字回到源码 —— 拆分不许让任何字符多出来或消失
    expect(readDocumentSource(doc)).toBe(DOC)
    expect(lineText(doc, 1)).toBe('const a: number = 1')
    view.unmount()
  })

  it('围栏行不是 token run：整行仍是一个标记', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const runs = [...doc.querySelectorAll('[data-block="0"] [data-vline="0"] [data-run]')]
    expect(runs).toHaveLength(1)
    expect(runs[0].textContent).toBe('```ts')
    // 光标在这块里（`renderWithDoc` 把焦点给了编辑器），所以它是 dim 的显现态；
    // 无论折叠还是显现，它都不该拿到任何 token 类。
    expect(runs[0].className).toContain('rn-dim')
    expect(runs[0].className).not.toContain('hljs-')
    view.unmount()
  })

  it('语言不认识时不着色，但仍然是代码块', async () => {
    const { view, doc } = await renderWithDoc('```nope\nconst a = 1\n```')
    const runs = [...doc.querySelectorAll('[data-block="0"] [data-vline="1"] [data-run]')]
    expect(runs).toHaveLength(1)
    expect(runs[0].className).toContain('rn-codeblock')
    expect(runs[0].className).not.toContain('hljs-')
    view.unmount()
  })

  it('run 上不挂裸 `hljs` 类（否则导入主题的 .hljs{background:#fff} 会在深色下刷白底）', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    expect(doc.querySelector('[data-run].hljs')).toBeNull()
    view.unmount()
  })
})

describe('代码块高亮：光标仍在用户看到的位置', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('在高亮 run 中间打字，字符落在那个位置', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const user = userEvent.setup({ delay: null })
    // `const` 的第 2 个字符之后 —— 这是**拆分之后**才存在的位置：整行一个 run 时
    // 它一样存在，但拆成 token 之后 run 的 data-src 必须仍然算得对。
    caretInto(doc.querySelector('[data-vline="1"] .hljs-keyword'), 2)
    await user.keyboard('X')
    expect(readDocumentSource(doc)).toBe('```ts\ncoXnst a: number = 1\n```')
    view.unmount()
  })

  it('逐字符输入：每一步模型都与按键逐字一致', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const user = userEvent.setup({ delay: null })
    caretInto(doc.querySelector('[data-vline="1"] .hljs-keyword'), 5)
    const seen: string[] = []
    for (const ch of ' X') {
      await user.keyboard(ch)
      seen.push(lineText(doc, 1))
    }
    expect(seen).toEqual(['const  a: number = 1', 'const X a: number = 1'])
    expect(readDocumentSource(doc)).toBe('```ts\nconst X a: number = 1\n```')
    view.unmount()
  })

  it('在高亮行里 Backspace 删的是块内字符', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const user = userEvent.setup({ delay: null })
    const runs = [...doc.querySelectorAll('[data-block="0"] [data-vline="1"] [data-run]')]
    const last = runs[runs.length - 1].firstChild as Text
    placeCaretAt(last, last.textContent?.length ?? 0)
    await user.keyboard('{Backspace}')
    expect(readDocumentSource(doc)).toBe('```ts\nconst a: number = \n```')
    expect(lineText(doc, 1)).toBe('const a: number = ')
    view.unmount()
  })

  it('Enter 在代码块内换行，新行同样被着色', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const user = userEvent.setup({ delay: null })
    const runs = [...doc.querySelectorAll('[data-block="0"] [data-vline="1"] [data-run]')]
    const last = runs[runs.length - 1].firstChild as Text
    placeCaretAt(last, last.textContent?.length ?? 0)
    await user.keyboard('{Enter}let b = 2')
    expect(readDocumentSource(doc)).toBe('```ts\nconst a: number = 1\nlet b = 2\n```')
    const runs2 = [...doc.querySelectorAll('[data-block="0"] [data-vline="2"] [data-run]')]
    expect(runs2.some((run) => run.classList.contains('hljs-keyword'))).toBe(true)
    view.unmount()
  })
})

describe('代码块的盒子：内边距加在行上，且不动逐行基线', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('代码文字不贴着自己背景的边缘', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const line = doc.querySelector<HTMLElement>('[data-block="0"] .vl-code')!
    const run = line.querySelector<HTMLElement>('.rn')!
    const inset = run.getBoundingClientRect().left - line.getBoundingClientRect().left
    expect(inset).toBeGreaterThan(6)
    expect(parseFloat(getComputedStyle(line).paddingLeft)).toBeGreaterThan(6)
    view.unmount()
  })

  it('空代码块也有盒子：围栏行自己就是一格行盒', async () => {
    // ⌥⌘C 插入的正是这种块：两条围栏、还没有任何内容行。它的可见高度来自围栏行
    // 自己的行盒——围栏行的内容是 0 高（run 是 display:none），所以上下留白是
    // "一行源码 = 一个行盒"给的，不是 padding 给的。改成 padding 会让光标进入这个块
    // 时（围栏标记显现成文字）整个块长高 26px：`table-ops/issues/02`。
    const { view, doc } = await renderWithDoc('```ts\n```')
    const fences = [...doc.querySelectorAll<HTMLElement>('[data-block="0"] .vl-fence')]
    expect(fences).toHaveLength(2)
    const lineHeight = parseFloat(getComputedStyle(doc).lineHeight)
    for (const fence of fences) {
      expect(fence.getBoundingClientRect().height).toBeCloseTo(lineHeight, 1)
      expect(parseFloat(getComputedStyle(fence).paddingTop)).toBe(0)
    }
    view.unmount()
  })

  it('围栏嵌在列表里时，列表自己的行不会被刷成代码背景', async () => {
    // 嵌套围栏归属**列表**的块（`core/markdown.ts` 只收 depth-0），所以把背景画在
    // 块上会连列表项和空行一起刷成代码色。背景留在行上就没有这个问题。
    const { view, doc } = await renderWithDoc('- 项\n\n  ```js\n  const a = 1\n  ```\n')
    const listLine = doc.querySelector<HTMLElement>('[data-block="0"] .vl-list')!
    expect(getComputedStyle(listLine).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    const codeLine = doc.querySelector<HTMLElement>('[data-block="0"] .vl-code')!
    expect(getComputedStyle(codeLine).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    // 而且它照样有内边距
    expect(parseFloat(getComputedStyle(codeLine).paddingLeft)).toBeGreaterThan(6)
    view.unmount()
  })

  it('代码行的高度仍然等于文档行高——内边距不能撑高行盒', async () => {
    // ADR-0002 §1：光标算术按源码行建索引、按行累加基线。行高一旦被内边距改变，
    // 每多一行就多累积一点偏移。所以纵向内边距只给围栏行，内容行只有横向的。
    const { view, doc } = await renderWithDoc('```ts\nconst a = 1\nlet b = 2\n```')
    const lineHeight = parseFloat(getComputedStyle(doc).lineHeight)
    const heights = [...doc.querySelectorAll<HTMLElement>('[data-block="0"] .vl-code')].map(
      (line) => line.getBoundingClientRect().height,
    )
    expect(heights).toHaveLength(2)
    for (const height of heights) expect(height).toBeCloseTo(lineHeight, 1)
    view.unmount()
  })
})

describe('代码 token 的配色不会被吞掉（层叠契约）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  /** 代码行里一个没有 token 类的 run —— 它必须保持正文色。 */
  function plainRun(doc: HTMLElement): HTMLElement {
    const run = [...doc.querySelectorAll<HTMLElement>('[data-vline="1"] [data-run]')].find(
      (el) => !el.className.includes('hljs-'),
    )
    if (!run) throw new Error('代码行里没有普通 run')
    return run
  }

  it('浅色下 token 的颜色必须不同于普通 run（`.rn-codeblock` 曾把它压回正文色）', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const keyword = doc.querySelector<HTMLElement>('[data-vline="1"] .hljs-keyword')!
    const plain = plainRun(doc)
    // 这条断言就是回归测试本身：修复前两者**完全相等**（实测 rgb(31,31,34)）
    expect(getComputedStyle(keyword).color).not.toBe(getComputedStyle(plain).color)
    // 并且真的是导入主题给的颜色，不是别的什么
    expect(getComputedStyle(keyword).color).toBe('rgb(215, 58, 73)')
    expect(getComputedStyle(plain).color).toBe('rgb(31, 31, 34)')
    view.unmount()
  })

  it('深色下命中重上色后的 token 颜色（`.ln-code` 那条从未生效过）', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    const keyword = doc.querySelector<HTMLElement>('[data-vline="1"] .hljs-keyword')!
    const plain = plainRun(doc)
    document.documentElement.setAttribute('data-theme', 'dark')
    try {
      expect(getComputedStyle(keyword).color).toBe('rgb(255, 157, 177)')
      expect(getComputedStyle(plain).color).toBe('rgb(228, 228, 231)')
    } finally {
      document.documentElement.removeAttribute('data-theme')
    }
    view.unmount()
  })
})
