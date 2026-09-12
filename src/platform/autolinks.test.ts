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
 *
 * It is NOT "the two renderings are always identical", and pretending otherwise
 * was this ticket's first mistake. Four shapes still differ, all of them
 * export-side defects, and they are pinned below as a bounded table rather than
 * left to be rediscovered.
 */
import { describe, expect, it } from 'vitest'
import { buildBlockView } from '../core/view'
import { md } from '../core/markdownIt'
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
  // 星号三条：markdown-it 有一条**刻意**的收尾 `*` 裁剪（免得吃掉强调的收尾标记），
  // linkify-it 自己没有，所以这条规则是我们补上的，两边因此一致。
  { name: 'URL 结尾的星号：两边都裁掉', lines: ['https://x.dev/a*'] },
  { name: 'URL 被星号包住', lines: ['*https://x.dev/a*'] },
  { name: 'URL 结尾的波浪号：两边都保留（对比星号）', lines: ['https://x.dev/a~~'] },
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
   * The four shapes where the two renderings still differ — pinned on BOTH sides,
   * so the list is bounded and cannot quietly grow, and so a future change that
   * "fixes" the view by matching the export has to argue with this comment first.
   *
   * Every one is an EXPORT-side defect, and the editor is deliberately the side
   * that does not move. Following the export would mean: a code span that stops
   * rendering as code, an href the reader cannot map back to the source
   * (`https://x.dev%60c%60`), and link text that is neither what the user typed
   * nor valid Markdown. `.scratch/autolinks/issues/02` carries the mechanisms and
   * the decision to make; the two tests below pin the mechanisms themselves, so
   * they go red — and this table can be deleted — if markdown-it ever fixes them.
   */
  it.each([
    {
      name: '删除线里的裸域名：导出的快路径 pretest 说"没有链接"',
      lines: ['~~example.com~~'],
      view: [{ text: 'example.com', href: 'http://example.com' }],
      exported: [] as Link[],
    },
    {
      name: '反斜杠 + URL：导出的 scheme 回扫窗口被 pending 长度截断',
      lines: ['\\https://x.dev'],
      view: [{ text: 'https://x.dev', href: 'https://x.dev' }],
      exported: [] as Link[],
    },
    {
      name: 'URL 紧贴行内代码：导出的 URL 把反引号也吃了进去',
      lines: ['https://x.dev`c`'],
      view: [{ text: 'https://x.dev', href: 'https://x.dev' }],
      exported: [{ text: 'https://x.dev`c`', href: 'https://x.dev%60c%60' }],
    },
    {
      name: 'URL 紧贴加粗：导出的 URL 把 `a**b` 也吃了进去',
      lines: ['https://x.dev/a**b**'],
      view: [{ text: 'https://x.dev/a', href: 'https://x.dev/a' }],
      exported: [{ text: 'https://x.dev/a**b', href: 'https://x.dev/a**b' }],
    },
  ])('已知分歧（导出侧缺陷）：$name', ({ lines, view: expected, exported }) => {
    expect(viewLinks(lines)).toEqual(expected)
    expect(exportLinks(lines)).toEqual(exported)
  })

  it('分歧机制 1：`~~` 里的裸域名是被 pretest 快路径漏掉的，不是规则不同意', () => {
    // 导出确实解析出了删除线，只是那个 text token 从来没被访问过 —— `<s>` 在，
    // 链接不在。所以这是缺陷，不是"两种读法都说得通"。
    expect(renderDocumentHtml('~~example.com~~')).toContain('<s>example.com</s>')
    // 快路径对同一个东西给出两个答案：整段说"没有"，单独的域名说"有"。
    expect(md.linkify.pretest('~~example.com~~')).toBe(false)
    expect(md.linkify.pretest('example.com')).toBe(true)
    expect(md.linkify.match('example.com')).not.toBeNull()
  })

  it('分歧机制 2：`\\https://x.dev` 的回扫窗口只够到 `ttps`', () => {
    // markdown-it 的回扫上界是 `pos - min(10, pending.length, pos)`，而这里的
    // pending 只有 `http` 那么长，于是它问的是 `ttps://x.dev`。
    // `\h` 在 CommonMark 里根本不是转义（只对 ASCII 标点生效），所以"这是个链接、
    // 前面有个字面反斜杠"才是对 Markdown 的忠实读法 —— 编辑器是对的。
    expect(md.linkify.matchAtStart('ttps://x.dev')).toBeNull()
    expect(md.linkify.matchAtStart('https://x.dev')).not.toBeNull()
  })
})
