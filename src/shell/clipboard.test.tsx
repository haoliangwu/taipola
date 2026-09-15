import { describe, it, expect, beforeEach } from 'vitest'
import { renderWithDoc } from '../test/appTestUtils'
import { readDocumentSource } from '../editor/render'
import { placeCaretAt } from '../test/editorTestUtils'
import { stubSavedFolder } from '../test/platformStubs'
import { WELCOME_DOC } from '../core/welcome'

/**
 * 剪贴板票据 01：复制把「选区对应的 markdown 源码」写进剪贴板，粘贴只认
 * `text/plain` 并走浏览器自己的 `insertText` 插入路径——**渲染 DOM 永远进不了
 * 文档**。
 *
 * 为什么这条路是对的（票据复现）：
 *
 * 1. 浏览器默认的复制把选区序列化成「渲染视图的纯文本」：`#`、`**`、列表短横、
 *    表格管道符全没了，行内数学碎成 `E\n=\nm\nc\n2` 的逐行碎片——编辑器内
 *    复制→粘贴必然丢结构，复制给别的 App 也是坏的。
 * 2. 浏览器默认的粘贴把选区序列化成「渲染 DOM」（`[data-block]`/`[data-vline]`/
 *    `[data-run]` 元素、内联样式齐上阵）插进文档；`sanitizeDom` 认 `data-*`
 *    属性，把这份「穿着我们服装的外来 DOM」当成可信结构，插入点的嵌套又把它
 *    整个埋进活动块的 line box 里——整篇粘贴内容被吸进活动块的那一行。welcome
 *    文档粘贴在标题块上，回来就是「一个巨型标题」。
 *
 * 复制侧改写 `text/plain` 之后，编辑器自产自销的剪辑就是纯源码；粘贴侧只取
 * `text/plain`，所以要么是源码（自产），要么是别的 App 的纯文本（与原来
 * sanitizeDom 展平异源富文本的行为一致，结构还更保真）。
 */

/** 选中整个宿主：等价于 ⌘A 之后浏览器的选区（起点在第一块内，终点在根上）。 */
function selectAll(doc: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(doc)
  const sel = window.getSelection()
  if (!sel) throw new Error('no selection')
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 选中某块某行的整行文本：选区端点落在 run 的文本节点上——真实浏览器的选区端点就是文本节点。 */
function selectLineText(doc: HTMLElement, block: number, vline: number): void {
  const line = doc.querySelector(`[data-block="${block}"] [data-vline="${vline}"]`)
  const node = line?.querySelector('[data-run]')?.firstChild as Text | null
  if (!node) throw new Error('no line text node')
  const range = document.createRange()
  range.selectNodeContents(node)
  const sel = window.getSelection()
  if (!sel) throw new Error('no selection')
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 在建好的选区上触发内核的复制处理，返回它写进剪贴板的 `text/plain`。 */
function copyLikeTheBrowser(doc: HTMLElement): string {
  const transfer = new DataTransfer()
  doc.dispatchEvent(new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true, cancelable: true }))
  return transfer.getData('text/plain')
}

/** 带上 text/plain 与（可有可无的）text/html 触发内核的粘贴处理。 */
function pasteLikeTheBrowser(doc: HTMLElement, plain: string, html?: string): void {
  const transfer = new DataTransfer()
  transfer.setData('text/plain', plain)
  if (html !== undefined) transfer.setData('text/html', html)
  doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
}

/** 光标放到某块最后一行的行尾。 */
function caretToLineEnd(doc: HTMLElement, block = 0): void {
  const runs = [...doc.querySelectorAll(`[data-block="${block}"] [data-run]`)]
  const node = runs[runs.length - 1]?.lastChild as Text | null
  if (!node) throw new Error('no run text')
  placeCaretAt(node, node.textContent?.length ?? 0)
}

describe('复制（clipboard/01）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('复制的 text/plain 是选区对应的源码切片，不是渲染文本', async () => {
    const { view, doc } = await renderWithDoc('# 标题甲\n\n第二行内容\n')
    // 块 0 是标题、块 1 是空行、块 2 才是段落。
    selectLineText(doc, 2, 0)
    expect(copyLikeTheBrowser(doc)).toBe('第二行内容')
    view.unmount()
  })

  it('全选复制：完整源码进剪贴板，表格管道符、标记、公式都在', async () => {
    const { view, doc } = await renderWithDoc(WELCOME_DOC)
    selectAll(doc)
    expect(copyLikeTheBrowser(doc)).toBe(WELCOME_DOC)
    view.unmount()
  })

  it('全选复制：开头被折叠的标记不在选区里也进剪贴板', async () => {
    // 光标离开第一块时它收起成渲染态，`# ` 折叠隐藏——Chromium 的全选选区
    // 从第一个可见字符开始，`# ` 不可能在范围内。复制必须把行首标记补回来，
    // 否则整篇复制会丢第一个标记（clipboard/03）。
    const { view, doc } = await renderWithDoc('# 甲\n\n第二行内容\n')
    const lines = [...doc.querySelectorAll('[data-vline]')]
    const main = lines[lines.length - 2] // 「第二行内容」
    const mainRun = main.querySelector('[data-run]')?.firstChild as Text
    placeCaretAt(mainRun, mainRun.textContent?.length ?? 0)
    const hidden = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run]') as HTMLElement
    expect(getComputedStyle(hidden).display).toBe('none')
    // 仿照 Chromium 的全选：从第一个可见 run 选到行尾的空行。
    const firstVisible = [...doc.querySelectorAll('[data-block="0"] [data-vline="0"] [data-run]')].find(
      (r) => getComputedStyle(r).display !== 'none',
    ) as HTMLElement
    const lastLine = lines[lines.length - 1] as HTMLElement
    const range = document.createRange()
    range.setStart(firstVisible.firstChild as Text, 0)
    range.setEnd(lastLine, 0)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    expect(copyLikeTheBrowser(doc)).toBe('# 甲\n\n第二行内容\n')
    view.unmount()
  })

  it('剪切：选区源码同样进剪贴板（cut 会触发 copy，走同一个处理）', async () => {
    const { view, doc } = await renderWithDoc('甲\n\n乙\n')
    selectLineText(doc, 0, 0)
    expect(copyLikeTheBrowser(doc)).toBe('甲')
    view.unmount()
  })
})

describe('粘贴（clipboard/02）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('剪贴板带 text/html（编辑器自己的渲染 DOM）时只认纯文本', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    pasteLikeTheBrowser(
      doc,
      '# 嗯\n\n段落',
      '<div class="blk" data-block="0" data-kind="heading">&lt;div class="blk" data-block="0" data-kind="heading"&gt;',
    )
    // 渲染 DOM 若被当结构插入，源码里会冒出它自己的字面文本或合并痕迹；
    // 只认 text/plain 时，源码就是纯文本重解析出的形状。
    expect(readDocumentSource(doc)).toBe('借用# 嗯\n\n段落\n')
    view.unmount()
  })

  it('粘贴含标记的文本：逐字进模型，继续打字落在粘贴文本之后', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    pasteLikeTheBrowser(doc, 'AB**CD**E')
    expect(readDocumentSource(doc)).toBe('借用AB**CD**E\n')
    const user = (await import('@testing-library/user-event')).default.setup({ delay: null })
    await user.keyboard('!')
    expect(readDocumentSource(doc)).toBe('借用AB**CD**E!\n')
    view.unmount()
  })

  it('粘贴多行源码：换行进模型，重新解析出块', async () => {
    const { view, doc } = await renderWithDoc('借用\n')
    caretToLineEnd(doc)
    // 粘贴文本自身以 \n 结尾，落在原文档行尾（其后再有一个原文档的换行）。
    pasteLikeTheBrowser(doc, '第一行\n\n## 标题\n\n- 甲\n- 乙\n')
    expect(readDocumentSource(doc)).toBe('借用第一行\n\n## 标题\n\n- 甲\n- 乙\n\n')
    view.unmount()
  })

  it('整篇复制再粘贴：文档逐字节还原（welcome 全篇，含表格与公式）', async () => {
    const { view, doc } = await renderWithDoc(WELCOME_DOC)
    selectAll(doc)
    const copied = copyLikeTheBrowser(doc)
    expect(copied).toBe(WELCOME_DOC)
    // 浏览器真实剪贴板同时携带 text/html（渲染 DOM）与 text/plain（源码）。
    pasteLikeTheBrowser(doc, copied, doc.innerHTML)
    expect(readDocumentSource(doc)).toBe(WELCOME_DOC)
    view.unmount()
  })
})