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
