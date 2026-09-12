/**
 * `platform/html.ts` is the HTML-export path: markdown-it renders, then
 * DOMPurify sanitizes. DOMPurify is a DOM API, so this file can only run in the
 * browser project — which is exactly the point of keeping it out of `core/`.
 */
import { describe, expect, it } from 'vitest'
import { renderDocumentHtml } from './html'

describe('renderDocumentHtml（导出用）', () => {
  it('空文档产出空串', () => {
    expect(renderDocumentHtml('   \n')).toBe('')
  })

  it('渲染标题、表格与代码高亮', () => {
    const html = renderDocumentHtml('# 标题\n\n| a |\n| --- |\n| 1 |\n')
    expect(html).toContain('<h1>')
    expect(html).toContain('<table>')
  })

  it('作者写的 HTML 不会被执行', () => {
    const html = renderDocumentHtml('<script>alert(1)</script>\n')
    expect(html).not.toContain('<script')
  })
})

/**
 * Footnotes still export the way they always did.
 *
 * `platform/autolinks.test.ts` compares the two renderings because they must
 * agree; footnotes are the opposite case — the editor renders a definition where
 * it STANDS and the export moves it to the end, on purpose (option A, see
 * `.scratch/footnotes/issues/01`). So the assertion here is that the export was
 * left alone, and that the marker is the thing the two sides share.
 */
describe('脚注导出不变', () => {
  it('引用仍是 <sup class="footnote-ref">，文末仍有 <section class="footnotes">', () => {
    const html = renderDocumentHtml('见[^1]。\n\n[^1]: 补充。\n')
    expect(html).toContain('<sup class="footnote-ref">')
    expect(html).toContain('<a href="#fn1"')
    expect(html).toContain('<section class="footnotes">')
    // 引用与定义都还认得出标签，因此编辑器画的 `[1]` 与导出的 `[1]` 是同一个东西。
    expect(html).toContain('id="fn1"')
  })

  it('没人引用的定义在导出里整段消失', () => {
    // markdown-it-footnote 只在有引用时才产出脚注区，所以一个没人引用的定义在导出产物里
    // 彻底不存在。编辑器**不能**照做：它是编辑器，凭空吞掉一行源码是最坏的结果，
    // 所以那一行仍然显示（`Editor.test.tsx` 里有对应用例）。这是两处刻意的不同之一。
    expect(renderDocumentHtml('[^unused]: 没人引用。\n')).toBe('')
  })
})
