/**
 * `renderMarkdown` is the HTML-export path: it goes through markdown-it and then
 * DOMPurify, which needs a DOM — hence the `.browser.test.ts` name. Everything
 * else in `markdown.test.ts` is pure and runs in node.
 */
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown（导出用）', () => {
  it('空文档产出空串', () => {
    expect(renderMarkdown('   \n')).toBe('')
  })

  it('渲染标题、表格与代码高亮', () => {
    const html = renderMarkdown('# 标题\n\n| a |\n| --- |\n| 1 |\n')
    expect(html).toContain('<h1>')
    expect(html).toContain('<table>')
  })

  it('作者写的 HTML 不会被执行', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n')
    expect(html).not.toContain('<script')
  })
})
