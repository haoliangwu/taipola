/**
 * `platform/html.ts` is the HTML-export path: markdown-it renders, then
 * DOMPurify sanitizes. DOMPurify is a DOM API, so this file can only run in the
 * browser project — which is exactly the point of keeping it out of `core/`.
 */
import { describe, expect, it } from 'vitest'
import { renderDocumentHtml, renderStandaloneHtml } from './html'
import { buildBlockView } from '../core/view'

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

  /**
   * 图片的尺寸后缀在导出里也必须是尺寸，不是正文。
   *
   * 屏幕上那张图有多大，导出的文件里就该有多大——否则又是一处"两个真相"
   * （`autolinks/02`、`soft-line-breaks/01` 都是这么来的）。
   */
  it('图片的 {width=} 后缀变成 width 属性，正文里不留痕迹', () => {
    const html = renderDocumentHtml('![a](x.png){width=200}\n')
    expect(html).toContain('<img src="x.png" alt="a" width="200">')
    expect(html).not.toContain('{width=200}')
  })

  it('作者写的 <img width> 仍然不会被执行（html: false 不变）', () => {
    const html = renderDocumentHtml('<img src="x.png" width="100">\n')
    expect(html).not.toContain('<img')
  })
})

/**
 * 尺寸后缀的两种实现必须给出同一个答案。
 *
 * 屏幕走 `core/view.ts` 的扫描，导出走 markdown-it（`core/markdownIt.ts` 里那条 core 规则）；
 * 两边共用 `readImageSize`，但「图片到哪里结束」是各自解析的。所以这里拿同一份源码各问一次，
 * 比单测任何一边都硬——`autolinks/02` 与 `soft-line-breaks/01` 的教训都是「两边各有一套判断」。
 */
describe('图片尺寸：屏幕与导出是同一套语法', () => {
  /** 屏幕侧为这张图读到的宽度；没有尺寸或压根不渲染成图片时是 undefined。 */
  const widthOnScreen = (src: string) =>
    buildBlockView(src, 0, [], 1)
      .lines[0].runs.map((run) => run.mark.img?.width)
      .find((width) => width !== undefined)

  /** 导出侧写在 <img> 上的宽度。 */
  const widthInExport = (src: string) => /width="(\d+)"/.exec(renderDocumentHtml(src))?.[1]

  it('认的写法两边都认，不认的两边都不认', () => {
    for (const src of [
      '![a](x.png){width=200}',
      '![a](x.png){width=64}',
      '![a](x.png)',
      '![a](x.png){width=abc}',
      '![a](x.png) {width=200}',
      '![a](x.png){width=20%}',
    ]) {
      expect(widthOnScreen(src), src).toBe(widthInExport(src))
    }
    // 上面那条对"两边都读到 undefined"也会通过，所以这份清单里必须有一个真的读到宽度的。
    expect(widthOnScreen('![a](x.png){width=200}')).toBe('200')
  })

  it('同一张图两种尺寸：两个 <img> 各带各的宽度，只存一份文件', () => {
    const html = renderDocumentHtml('![a](x.png){width=200}\n\n![a](x.png){width=64}\n')
    expect(html.match(/src="x\.png"/g)).toHaveLength(2)
    expect(html).toContain('width="200"')
    expect(html).toContain('width="64"')
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

/**
 * The exported FILE, not just its body.
 *
 * `renderDocumentHtml` emits `hljs-*` classes on every code token, and the page a
 * reader opens has no access to this app's CSS — so unless the theme travels with
 * the file, those classes style nothing and exported code blocks are syntax-marked
 * but uncoloured. They were, for the whole life of the feature, because the export's
 * inline `<style>` only ever carried body/pre/code/table rules.
 */
describe('renderStandaloneHtml（导出的整份文件）', () => {
  /** The contents of the file's own `<style>` element. */
  const inlineStyle = (source: string) => {
    const html = renderStandaloneHtml(source, '标题')
    const from = html.indexOf('<style>')
    return { html, css: html.slice(from, html.indexOf('</style>', from)) }
  }

  it('内联了 highlight.js 主题，代码 token 才有颜色', () => {
    const { css } = inlineStyle('```js\nconst a = 1 // c\n```')
    expect(css).toContain('.hljs-keyword')
    expect(css).toContain('.hljs-comment')
    expect(css).toContain('.hljs-number')
    // 主题自带的 base 规则依赖 `.hljs` 类，而围栏渲染器只给 `language-js`
    // （`markdownIt.ts` 用的是 highlight 选项，不是 highlightElement），
    // 所以 .hljs{background:#fff} 不会命中，不会和内联的 pre 底色打架。
    expect(renderDocumentHtml('```js\nconst a = 1\n```')).not.toContain('class="hljs"')
  })

  it('样式在 body 之前，正文里带 hljs token 类', () => {
    const { html } = inlineStyle('```js\nconst a = 1\n```')
    expect(html).toContain('<span class="hljs-keyword">')
    expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('<body>'))
    expect(html.indexOf('.hljs-keyword')).toBeLessThan(html.indexOf('<body>'))
  })

  it('没有代码块时也不必为空，标题里的尖括号不会跑进标签', () => {
    const html = renderStandaloneHtml('正文\n', '<img src=x>')
    expect(html).toContain('<title>img src=x</title>')
    expect(html).not.toContain('<title><img')
  })
})
