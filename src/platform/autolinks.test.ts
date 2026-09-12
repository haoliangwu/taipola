/**
 * The acceptance test for bare URLs: **one source, two renderings, the same
 * links.**
 *
 * The bug was a divergence — a URL in a paragraph was an `<a>` in the export and
 * a `data-run` span in the editor — so the only assertion that can actually close
 * it is a comparison, not a list of expected hrefs. Anything that re-implements
 * the recogniser, or applies it to the wrong text, shows up here as a difference
 * rather than as a test that was updated to match.
 *
 * Both sides are the real ones: the view comes from `buildBlockView` (what the
 * editor renders) and the export from `renderDocumentHtml` (what the file
 * contains). The corpus is the ticket's probe document plus the four traps, and
 * every case is its own paragraph so a failure names the construct that broke.
 */
import { describe, expect, it } from 'vitest'
import { buildBlockView } from '../core/view'
import { renderDocumentHtml } from './html'

interface Link {
  text: string
  href: string
}

/** Every link the editor would show, in document order. */
function viewLinks(lines: string[]): Link[] {
  const view = buildBlockView(lines.join('\n'), 0, [], lines.length)
  return view.lines
    .flatMap((line) => line.runs)
    .filter((run) => !run.marker && run.mark.link !== undefined)
    .map((run) => ({ text: run.text, href: run.mark.link ?? '' }))
}

/** Every link the exported HTML carries, in document order. */
function exportLinks(lines: string[]): Link[] {
  const html = renderDocumentHtml(lines.join('\n'))
  const dom = new DOMParser().parseFromString(html, 'text/html')
  return [...dom.querySelectorAll('a')].map((anchor) => ({
    text: anchor.textContent ?? '',
    href: anchor.getAttribute('href') ?? '',
  }))
}

/**
 * Each case is one paragraph (the last one is two lines, to keep a URL that a
 * soft break cuts in half inside a single block).
 */
const CASES: Array<{ name: string; lines: string[] }> = [
  {
    name: '七种形态：scheme、www、裸域名、邮箱、紧贴中文',
    lines: [
      'A https://example.com B http://example.org C www.example.net D user@example.com',
      'E ftp://example.io F example.com G 网址是https://example.com/path?q=1#f 这里结束',
    ],
  },
  { name: '句末标点不并进链接', lines: ['网址是https://example.com。结束'] },
  { name: '加粗里的网址照认', lines: ['**https://example.com**'] },
  { name: '行内代码里不认（是字面量）', lines: ['`https://example.com` 不是链接'] },
  { name: '既有链接的文字里不认', lines: ['[https://example.com](https://other.com)'] },
  { name: '标题、引用、列表里的网址', lines: ['# 标题里的 https://example.com'] },
  { name: '引用与列表', lines: ['> 引用里的 https://example.com', '- 列表里的 www.example.net'] },
  { name: '表格单元格里的网址', lines: ['| 名字 | 链接 |', '| --- | --- |', '| a | https://example.com |'] },
  { name: '混合：粗体、代码、既有链接、裸 URL 同处一行', lines: ['混合 **粗** 与 `https://code.dev` 与 [链](https://x.dev) 与裸 https://plain.io'] },
  { name: '邮箱紧贴中文', lines: ['联系user@example.com。'] },
  { name: '软换行把 URL 切成两半', lines: ['see https://example.', 'com here'] },
  { name: 'linkify 不认的 scheme：两边都不该造出链接', lines: ['file:///tmp/x 与 javascript:alert(1) 都不算'] },
  // 下面这些是刻意的对抗样本：每一条的边界都由 linkify-it 的规则决定，也正是
  // 手写正则最容易与导出发叉的地方。
  { name: '大写 scheme', lines: ['HTTPS://EXAMPLE.COM 后面'] },
  { name: 'URL 的查询串里还有 http://', lines: ['https://example.com/?next=https://other.com 结束'] },
  { name: 'URL 紧跟加粗结束标记', lines: ['**粗**https://example.com'] },
  { name: 'URL 后面紧跟加粗开始标记', lines: ['https://example.com**粗**'] },
  { name: 'URL 里带括号与下划线', lines: ['https://en.wikipedia.org/wiki/Foo_(bar) 结束'] },
  { name: '邮箱在加粗里', lines: ['**mail me@example.com**'] },
  { name: '邮箱在删除线里（走 core 规则，两边一致）', lines: ['~~mail me@example.com~~'] },
  { name: '删除线旁边有 URL', lines: ['~~code~~ https://strike.dev'] },
  { name: '行首裸域名，行尾 URL', lines: ['example.com 开头，https://example.com 结尾'] },
  { name: 'URL 贴着中文收尾', lines: ['https://example.com中文结尾'] },
  { name: '反斜杠转义的冒号', lines: ['http\\://example.com'] },
]

describe('裸 URL：视图与导出得到同一组链接', () => {
  it.each(CASES)('$name', ({ lines }) => {
    expect(viewLinks(lines)).toEqual(exportLinks(lines))
  })

  it('语料确实包含链接（否则上面每一条都会以"两边都是空"通过）', () => {
    const total = CASES.reduce((sum, c) => sum + exportLinks(c.lines).length, 0)
    expect(total).toBeGreaterThanOrEqual(12)
  })

  /**
   * A KNOWN divergence, pinned instead of hidden: `~~https://x.dev~~` exports as
   * a link that SWALLOWS the closing tildes, `<a href="https://x.dev~~">`.
   *
   * The editor shows a clean link inside strikethrough, which is the sane
   * reading, and it is deliberately not changed to match: `~~` is a syntax marker
   * to it, and the exported href is simply broken (`https://x.dev~~` is not a
   * URL). The editor is the side that reads right, so the fix — if any — belongs
   * in the export, and that is a separate decision.
   *
   * The mechanism is markdown-it's rule ORDER, not a choice of ours. Its inline
   * rules run `… linkify … strikethrough …`, and linkify-it does not treat `~` as
   * trailing punctuation — measured, `matchAtStart('https://x.dev~~')` returns a
   * 20-character match with both tildes in it. The URL therefore eats the closing
   * `~~` before the strikethrough rule ever runs. That same rule carries an
   * explicit trailing-`*` trim (markdown-it special-cases emphasis), which is why
   * `**https://x.dev**` agrees.
   *
   * Note how narrow it is: the email case above goes through markdown-it's CORE
   * linkify rule, which only looks at `text` tokens and so respects the
   * strikethrough tokens. Only a `://` URL sitting flush against `~~` is affected.
   */
  it('已知分歧：~~URL~~ 的导出把波浪号吞进了链接（编辑器是对的）', () => {
    const lines = ['~~https://strike.dev~~ 后面']
    expect(viewLinks(lines)).toEqual([
      { text: 'https://strike.dev', href: 'https://strike.dev' },
    ])
    expect(exportLinks(lines)).toEqual([
      { text: 'https://strike.dev~~', href: 'https://strike.dev~~' },
    ])
  })
})
