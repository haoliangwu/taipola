import { describe, expect, it } from 'vitest'
import { buildBlockView, type BlockView } from './view'

/** Builds a single-block view; `reveal` holds block-local caret offsets. */
function view(raw: string, reveal: number[] = []): BlockView {
  const lineCount = raw === '' ? 1 : raw.split('\n').length
  return buildBlockView(raw, 0, reveal, lineCount)
}

/** What the DOM would rebuild for this block (the lossless-view invariant). */
function reconstruct(v: BlockView): string {
  return v.lines.map((line) => line.runs.map((run) => run.text).join('')).join('\n')
}

function runs(v: BlockView, line = 0) {
  return v.lines[line].runs.map((run) => ({
    text: run.text,
    marker: run.marker,
    dim: run.dim === true,
    ...(run.mark.bold ? { bold: true } : {}),
    ...(run.mark.italic ? { italic: true } : {}),
    ...(run.mark.strike ? { strike: true } : {}),
    ...(run.mark.highlight ? { highlight: true } : {}),
    ...(run.mark.superscript ? { superscript: true } : {}),
    ...(run.mark.subscript ? { subscript: true } : {}),
    ...(run.mark.code ? { code: true } : {}),
    ...(run.mark.link ? { link: run.mark.link } : {}),
    ...(run.mark.math ? { math: run.mark.math } : {}),
    ...(run.mark.hl ? { hl: run.mark.hl } : {}),
    ...(run.mark.footnoteRef ? { footnoteRef: run.mark.footnoteRef } : {}),
    ...(run.mark.img ? { img: run.mark.img.src } : {}),
  }))
}

const SYNTAX = [
  '正文一段',
  '**粗体** 与普通',
  '*斜体*',
  '~~删除线~~',
  '`行内代码`',
  '[链接文字](https://example.com)',
  '![示例](https://example.com/a.png)',
  '# 一级标题',
  '###### 六级标题',
  '- 无序项',
  '1. 有序项',
  '- [x] 任务项',
  '> 引用行',
  '---',
  '```ts',
  '```',
  '| a | b |',
  '| --- | --- |',
  '混合 **粗** 与 `码` 与 [链](https://x.dev)',
]

describe('视图是无损的（除表格分隔行这一处刻意例外）', () => {
  it.each(SYNTAX)('%j 能按 run 拼回原文（表格行是刻意的例外）', (raw) => {
    const v = view(raw)
    if (raw.trim().startsWith('|')) {
      // 表格的管道符不进视图：单元格式 grid item，管道符没有排版宽度。
      // 从 DOM 重建源码时由 `normalizeTables` 的规范形式（`| a | b |`）补回，
      // 分隔行则整行渲染为空（那条线由表头下边线承担）。
      expect(reconstruct(v)).not.toContain('|')
      return
    }
    expect(reconstruct(v)).toBe(raw)
  })

  it('多行块按行拼回原文', () => {
    const raw = '```ts\nconst a = 1\n# 不是标题\n```'
    expect(reconstruct(view(raw))).toBe(raw)
  })

  it('折叠态的 run 覆盖整行：每个源码字符要么可见、要么在 marker run 里', () => {
    const v = view('混合 **粗** 与 `码`')
    const sources = v.lines[0].runs.map((run) => ({ start: run.src, len: run.text.length }))
    expect(sources[0].start).toBe(0)
    for (let i = 1; i < sources.length; i++) {
      expect(sources[i].start).toBe(sources[i - 1].start + sources[i - 1].len)
    }
    const last = sources[sources.length - 1]
    expect(last.start + last.len).toBe('混合 **粗** 与 `码`'.length)
  })

  it('sourceToVisible 与 visibleToSource 互为逆映射', () => {
    const v = view('前 **粗** 后')
    const line = v.lines[0]
    line.sourceToVisible.forEach((visible, source) => {
      if (visible < 0) return
      expect(line.visibleToSource[visible]).toBe(source)
    })
    expect(line.visibleToSource).toHaveLength(line.text.length)
  })

  /**
   * 空白行（只有空格/制表符）对 Markdown 是空行，但那几个字符是用户打的源码：
   * 视图必须自己把它们交出来，否则渲染层只能去 `block.raw` 里补，视图就不再是
   * DOM 的唯一真相了（`.scratch/whitespace-round-trip/issues/01`）。
   *
   * 交出来的方式是**一个折叠 run**：源码在，排版宽度一点不占，看上去仍是空行。
   */
  it('只有空格的行：源码在折叠 run 里，一个可见格都不占', () => {
    const v = view('甲\n   \n乙')
    expect(v.lines).toHaveLength(3)
    expect(reconstruct(v)).toBe('甲\n   \n乙')
    expect(v.lines[1].runs.map((run) => ({ text: run.text, marker: run.marker }))).toEqual([
      { text: '   ', marker: true },
    ])
    expect(v.lines[1].text).toBe('')
    expect(v.lines[1].sourceToVisible).toEqual([-1, -1, -1])
  })

  it('一个字都没有的空行不带 run：形状与改动前一致', () => {
    const v = buildBlockView('', 0, [], 2)
    expect(v.lines.every((line) => line.runs.length === 0)).toBe(true)
  })

  it('围栏里的空白行仍按普通行渲染：空格是排得出来的列位', () => {
    // 空白行的快路径必须绕开代码内容：围栏里的空格不是"看不见的语法"，而是代码
    // 自己的缩进，折叠掉光标就落不到第 4 列上了。
    const v = view('```\n   \n```')
    expect(runs(v, 1)).toEqual([{ text: '   ', marker: false, dim: false }])
  })
})

describe('行内标记：折叠与显现', () => {
  it('粗体折叠时标记不可见、内容仍是粗体', () => {
    expect(runs(view('**粗体**'))).toEqual([
      { text: '**', marker: true, dim: false },
      { text: '粗体', marker: false, dim: false, bold: true },
      { text: '**', marker: true, dim: false },
    ])
    expect(view('**粗体**').lines[0].text).toBe('粗体')
  })

  it('光标进入构造后标记显形，行文本等于源码', () => {
    const v = view('**粗体**', [3])
    expect(v.lines[0].text).toBe('**粗体**')
    expect(runs(v).some((r) => r.marker)).toBe(false)
  })

  it.each([
    ['*斜体*', 'italic'],
    ['~~删除线~~', 'strike'],
    ['`行内代码`', 'code'],
  ] as const)('%s 折叠后只剩内容并带对应样式', (raw, style) => {
    const v = view(raw)
    const visible = runs(v).filter((r) => !r.marker)
    expect(visible).toHaveLength(1)
    expect(visible[0][style as 'italic' | 'strike' | 'code']).toBe(true)
  })

  it('链接保留 href，图片折叠成一个 run 携带图片信息', () => {
    expect(runs(view('[文字](https://x.dev)'))[1].link).toBe('https://x.dev')
    const image = view('![alt](https://x.dev/a.png)')
    expect(runs(image)).toEqual([
      { text: '![alt](https://x.dev/a.png)', marker: false, dim: false, img: 'https://x.dev/a.png' },
    ])
  })

  it('光标进图片构造则恢复源码文本（图片让位）', () => {
    const v = view('![alt](https://x.dev/a.png)', [3])
    expect(runs(v).every((r) => r.img === undefined)).toBe(true)
    expect(v.lines[0].text).toBe('![alt](https://x.dev/a.png)')
  })

  /*
   * 尺寸后缀 `{width=200}`（`core/imageSize.ts`）属于图片本身：它和 `![alt](url)` 是同一个
   * run，屏幕上是同一张图，源码里的字符一个不少。写这份文件的其他编辑器会把后缀当正文显示，
   * 这是选这条语法的已知代价（`.scratch/image-resize/issues/01`）。
   */
  it('图片可以带尺寸后缀：同一个 run，width 一并带走', () => {
    const source = '![alt](https://x.dev/a.png){width=200}'
    const v = view(source)
    expect(runs(v)).toEqual([
      { text: source, marker: false, dim: false, img: 'https://x.dev/a.png' },
    ])
    expect(v.lines[0].runs[0].mark.img).toEqual({
      src: 'https://x.dev/a.png',
      alt: 'alt',
      width: '200',
    })
    // 无损：run 拼回去就是原来的源码，DOM 重建不会丢后缀。
    expect(reconstruct(v)).toBe(source)
  })

  it('光标落在尺寸后缀里也恢复源码（图片一样让位）', () => {
    const source = '![alt](https://x.dev/a.png){width=200}'
    const v = view(source, [source.length - 2])
    expect(runs(v).every((r) => r.img === undefined)).toBe(true)
    expect(reconstruct(v)).toBe(source)
  })

  it('不写尺寸后缀时不带 width', () => {
    expect(view('![alt](https://x.dev/a.png)').lines[0].runs[0].mark.img?.width).toBeUndefined()
  })

  it('代码围栏内的行内标记是字面量', () => {
    const v = view('```\nconst a = **x**\n```')
    const code = runs(v, 1)
    expect(code).toHaveLength(1)
    expect(code[0].text).toBe('const a = **x**')
    expect(code[0].bold).toBeUndefined()
  })
})

describe('块级标记：折叠与显现', () => {
  it.each([
    ['# 标题', '# '],
    ['- 列表', '- '],
    ['1. 列表', '1. '],
    ['- [x] 任务', '- [x] '],
    ['> 引用', '> '],
  ])('%j 折叠时前缀是 marker run', (raw, prefix) => {
    const first = runs(view(raw))[0]
    expect(first).toEqual({ text: prefix, marker: true, dim: false })
  })

  it('光标在块内时前缀以 dim 形式显现', () => {
    const first = runs(view('# 标题', [2]))[0]
    expect(first).toEqual({ text: '# ', marker: false, dim: true })
  })

  it('分隔线折叠成不可见的 marker，显现时是 dim 的 ---', () => {
    expect(runs(view('---'))).toEqual([{ text: '---', marker: true, dim: false }])
    expect(runs(view('---', [1]))).toEqual([{ text: '---', marker: false, dim: true }])
  })

  it('围栏行整行折叠，光标进入代码块时以 dim 显现（含语言标识）', () => {
    const collapsed = view('```ts\ncode\n```')
    expect(runs(collapsed, 0)).toEqual([{ text: '```ts', marker: true, dim: false }])
    const revealed = view('```ts\ncode\n```', [1])
    expect(runs(revealed, 0)).toEqual([{ text: '```ts', marker: false, dim: true }])
  })
})

describe('嵌套与表格结构', () => {
  it('嵌套列表每行各有自己的缩进来源（源码偏移）', () => {
    const v = view('- a\n  - b\n    - c')
    expect(v.lines.map((l) => l.sourceStart)).toEqual([0, 4, 10])
  })

  it('Markdown 表格行拆成单元格，管道符不进文本', () => {
    const v = view('| a | b |')
    expect(v.lines[0].text).toBe('ab')
    expect(v.lines[0].cellRuns).toEqual([[0], [1]])
  })

  it('空单元格也算一格', () => {
    const v = view('| a |  |')
    expect(v.lines[0].cellRuns).toEqual([[0], []])
  })

  it('表格分隔行渲染成空行（那一行的高度由表头承担）', () => {
    const v = view('| --- | --- |')
    expect(v.lines[0].runs).toEqual([])
    expect(v.lines[0].text).toBe('')
  })

  it('空块按官方行跨度补足行盒', () => {
    const v = buildBlockView('', 0, [], 3)
    expect(v.lines).toHaveLength(3)
    expect(v.lines.every((l) => l.runs.length === 0)).toBe(true)
  })
})

describe('段落内单换行（软换行）', () => {
  it('行盒按源码行切分，runs 拼回源码一字不差', () => {
    // 每个源码行一个行盒、各占一个视觉行（Typora 的显示方式）；光标的定位算术
    // 按源码行建索引、按行累加基线，所以行盒永远不能合并。
    const view = buildBlockView('alpha beta\ngamma delta', 0, [], 2, [0])
    expect(view.lines).toHaveLength(2)
    expect(view.lines.map((line) => line.runs.map((r) => r.text).join('')).join('\n')).toBe(
      'alpha beta\ngamma delta',
    )
  })

  it('续行的容器缩进折叠成 marker run，行内文本不带缩进', () => {
    const view = buildBlockView('- a\n  b', 0, [], 2, [0])
    const continuation = view.lines[1]
    expect(continuation.runs[0]).toMatchObject({ text: '  ', marker: true })
    expect(continuation.text).toBe('b')
  })

  it('不是续行的那一行，缩进就是内容（不折叠）', () => {
    // 同一个块里，`continues` 才是"这行是上一行的续行"的依据：它是折叠缩进的唯一理由。
    const view = buildBlockView('alpha\n  beta', 0, [], 2, [])
    expect(view.lines[1].text).toBe('  beta')
  })
})

/**
 * Bare URLs are links in the exported HTML, and were plain text here — the same
 * document with two truths, where the truth the user cannot see is the one that
 * rewrites what they typed (`www.x.dev` gains `http://`, an address becomes a
 * `mailto:`).
 *
 * The recogniser is markdown-it's own linkify-it, so what these pin is really
 * WHERE markdown-it applies it: the two passes, and the text runs it visits. The
 * hrefs are the ones the exported HTML carries, and `platform/autolinks.test.ts`
 * asserts the two renderings against each other directly.
 */
describe('裸 URL：编辑器与导出同一套规则', () => {
  // Two forms only: what is pinned HERE is the run's SHAPE — one run, no markers,
  // carrying the href. One plain scheme and one the recogniser rewrites (`www.`
  // gains its scheme) cover that. The full seven-form corpus lives in
  // `platform/autolinks.test.ts`, where the two renderings are compared; copying
  // its href list here would be a second copy of one expectation.
  it.each([
    ['https://example.com', 'https://example.com'],
    ['www.example.net', 'http://www.example.net'],
  ])('%s 是一个带 href 的链接 run', (raw, href) => {
    expect(runs(view(`${raw} 后面`))).toEqual([
      { text: raw, marker: false, dim: false, link: href },
      { text: ' 后面', marker: false, dim: false },
    ])
  })

  it('紧贴中文也能切出来，且不含句末的句号', () => {
    expect(runs(view('网址是https://example.com。结束'))).toEqual([
      { text: '网址是', marker: false, dim: false },
      { text: 'https://example.com', marker: false, dim: false, link: 'https://example.com' },
      { text: '。结束', marker: false, dim: false },
    ])
  })

  it('加粗里的网址照认；行内代码里与既有链接的文字里都不认（与导出同规则）', () => {
    expect(runs(view('**https://example.com**'))).toEqual([
      { text: '**', marker: true, dim: false },
      {
        text: 'https://example.com',
        marker: false,
        dim: false,
        bold: true,
        link: 'https://example.com',
      },
      { text: '**', marker: true, dim: false },
    ])

    expect(runs(view('`https://example.com`'))).toEqual([
      { text: '`', marker: true, dim: false },
      { text: 'https://example.com', marker: false, dim: false, code: true },
      { text: '`', marker: true, dim: false },
    ])

    expect(runs(view('[https://example.com](https://other.com)'))).toEqual([
      { text: '[', marker: true, dim: false },
      {
        text: 'https://example.com',
        marker: false,
        dim: false,
        link: 'https://other.com',
      },
      { text: '](https://other.com)', marker: true, dim: false },
    ])
  })

  it('跨软换行：切在换行处，点留在外面', () => {
    const v = buildBlockView('see https://example.\ncom here', 0, [], 2)
    expect(runs(v, 0)).toEqual([
      { text: 'see ', marker: false, dim: false },
      { text: 'https://example', marker: false, dim: false, link: 'https://example' },
      { text: '.', marker: false, dim: false },
    ])
    expect(runs(v, 1)).toEqual([{ text: 'com here', marker: false, dim: false }])
  })

  it('只改样式不改字符：runs 仍然拼回原文', () => {
    const raw = 'A https://example.com B user@example.com C 网址是www.example.net。'
    expect(reconstruct(view(raw))).toBe(raw)
  })
})

/**
 * Footnotes, option A: rendered WHERE THEY ARE, not moved to the end.
 *
 * The export relocates definitions into a `<section class="footnotes">` at the
 * bottom. The editor cannot: the whole caret model is "view order == source
 * order, one line box per source line". So the definition is rendered in place,
 * as the note it is, and the screen is deliberately not the export's layout. What
 * DOES have to match is the reference marker (`[1]`) and editability.
 */
describe('脚注：引用与定义就地在位渲染', () => {
  it('正文里的 [^1] 折成上标的 [1]：`[^` 与 `]` 是标记，标签是内容', () => {
    expect(runs(view('[^1] 后面'))).toEqual([
      { text: '[^', marker: true, dim: false },
      { text: '1', marker: false, dim: false, footnoteRef: '1' },
      { text: ']', marker: true, dim: false },
      { text: ' 后面', marker: false, dim: false },
    ])
  })

  it('标签可以不止一个字符，也认中文标签', () => {
    expect(runs(view('[^note] x'))[1]).toEqual({
      text: 'note',
      marker: false,
      dim: false,
      footnoteRef: 'note',
    })
    expect(runs(view('[^注] x'))[1].footnoteRef).toBe('注')
  })

  it('光标在引用里时显示源码，且**不再**带上会被画出来的标记', () => {
    // 关键的一条：`[1]` 是渲染层根据这个 mark 画出来的。展开时源码正在显示，
    // 如果 mark 还在，屏幕上就是 `[^[1]]` —— 两个形态叠在一起。
    const collapsed = view('[^1] 后面')
    expect(collapsed.lines[0].runs.filter((r) => r.mark.footnoteRef).length).toBe(1)

    const opened = view('[^1] 后面', [1])
    expect(opened.lines[0].runs.every((r) => r.marker === false)).toBe(true)
    expect(opened.lines[0].runs.some((r) => r.mark.footnoteRef !== undefined)).toBe(false)
    expect(opened.lines[0].text).toBe('[^1] 后面')
  })

  it('定义行的 `[^1]: ` 是块级前缀：光标不在其中就折叠，那行带上标签', () => {
    const v = buildBlockView('[^1]: 小小补充', 0, [], 1)
    expect(runs(v)).toEqual([
      { text: '[^1]: ', marker: true, dim: false },
      { text: '小小补充', marker: false, dim: false },
    ])
    expect(v.lines[0].text).toBe('小小补充')
    // 标签**不**在这里：它是"这一行是什么"的一部分，由 `computeLineStates` 给出
    // （`inline.test.ts` 钉住），渲染层从行状态读它。视图再算一遍的话，围栏里的
    // `[^1]: ` 会被算成定义行——那个 bug 就是这么来的。标签到 DOM 的那一跳由
    // `Editor.test.tsx` 的 `data-footnote` 用例覆盖。
  })

  it('光标进定义块时前缀显现为暗色源码，内容仍可编辑', () => {
    const v = buildBlockView('[^1]: 小小补充', 0, [2], 1)
    expect(runs(v)[0]).toMatchObject({ text: '[^1]: ', marker: false, dim: true })
    expect(v.lines[0].text).toBe('[^1]: 小小补充')
  })

  it('定义行里的 `[^1]` 不再被当成行内引用（否则会和块级前缀打架）', () => {
    // 只有一个 marker run，而不是被引用 token 切成四段。
    expect(runs(view('[^1]: 小小补充')).filter((r) => r.marker)).toHaveLength(1)
  })

  it('多行定义：续行也在，且能一字不差地拼回源码', () => {
    const raw = '[^1]: 第一行\n  第二行\n'
    const v = buildBlockView(raw.trimEnd(), 0, [], 2)
    expect(v.lines[1].runs.map((r) => r.text).join('')).toBe('  第二行')
    expect(reconstruct(v)).toBe(raw.trimEnd())
  })

  it('引用与定义都在时，源码仍然无损', () => {
    const raw = '见[^1]。\n\n[^1]: 补充。'
    const v = buildBlockView(raw, 0, [], 3)
    expect(reconstruct(v)).toBe(raw)
  })
})

describe('行内数学（IM02: $…$ / \\(…\\) / \\[…\\]）', () => {
  it('$…$ 折叠时内容 run 带 math 标记，展开时撤回（显示源码）', () => {
    const collapsed = runs(view('a $x+1$ b', []))
    const mathRun = collapsed.find((r) => (r as { math?: string }).math !== undefined)
    expect(mathRun).toMatchObject({ text: 'x+1', math: 'x+1' })
    const opened = runs(view('a $x+1$ b', [3]))
    expect(opened.some((r) => (r as { math?: string }).math !== undefined)).toBe(false)
    // 展开态行文本 = 源码（无损视图）
    expect(reconstruct(view('a $x+1$ b', [3]))).toBe('a $x+1$ b')
  })

  const mathOf = (raw: string): unknown =>
    runs(view(raw)).find((r) => (r as { math?: string }).math !== undefined) ?? null

  it('$ 规则：Pandoc 四条边界', () => {
    expect(mathOf('$x$')).toMatchObject({ text: 'x', math: 'x' })
    expect(runs(view('price $5')).every((r) => !(r as { math?: string }).math)).toBe(true) // 无闭合
    expect(mathOf('$ 5$')).toBeNull() // 开符后空格
    expect(mathOf('$5 $')).toBeNull() // 闭符前空格
    expect(mathOf('$x\\ y$')).toMatchObject({ math: 'x\\ y' }) // 转义空格
    expect(mathOf('$5$')).toMatchObject({ math: '5' }) // 数字内容可以
    expect(mathOf('$x\\$y$')).toMatchObject({ math: 'x\\$y' }) // 转义 $
    expect(mathOf('a$b$c')).toMatchObject({ text: 'b', math: 'b' }) // 无词边界
  })

  it('$$…$$ 按自然分片处理（display math 出界，不承诺显示）', () => {
    // $$x$$ = 字面 $ + 行内 math(x) + 字面 $：内层 $x$ 是合法行内对
    const r = runs(view('$$x$$'))
    expect(r.filter((run) => (run as { math?: string }).math !== undefined)).toHaveLength(1)
    expect(reconstruct(view('$$x$$'))).toBe('$$x$$') // 光源无损
  })

  it('\\(…\\) 与 \\[…\\] 同样识别', () => {
    expect(mathOf('\\(\\alpha\\)')).toMatchObject({ math: '\\alpha' })
    expect(mathOf('\\[\\beta\\]')).toMatchObject({ math: '\\beta' })
    expect(mathOf('\\( \\alpha\\)')).toBeNull() // 开符后空格
  })
})

describe('EXTRA_INLINE 三族（IM01: == ^ ~，默认关）', () => {
  it('默认全关：三者保持字面', () => {
    expect(reconstruct(view('==高== ^上^ ~下~'))).toBe('==高== ^上^ ~下~')
    expect(runs(view('==高==')).every((r) => !r.marker)).toBe(true)
  })

  it('开启后识别：高亮/上标/下标', async () => {
    const { EXTRA_INLINE } = await import('./view')
    EXTRA_INLINE.highlight = true
    EXTRA_INLINE.superscript = true
    EXTRA_INLINE.subscript = true
    try {
      expect(runs(view('==高==')).find((r) => (r as any).highlight)).toMatchObject({ text: '高', highlight: true })
      expect(runs(view('H^2^O')).find((r) => (r as any).superscript)).toMatchObject({ text: '2', superscript: true })
      expect(runs(view('H~2~O')).find((r) => (r as any).subscript)).toMatchObject({ text: '2', subscript: true })
      // 展开（光标在内）时标记显形、行文本 = 源码
      expect(reconstruct(view('==高==', [1]))).toBe('==高==')
      // ~~ 比 ~ 先匹配：删除线优先
      expect(runs(view('x~~y~~z')).find((r) => (r as any).strike)).toMatchObject({ text: 'y', strike: true })
      // 内容禁裸空格：^a b^ 不成对
      expect(runs(view('^a b^'))[0].text).toBe('^a b^')
    } finally {
      EXTRA_INLINE.highlight = false
      EXTRA_INLINE.superscript = false
      EXTRA_INLINE.subscript = false
    }
  })

  it('clearFormat 跟随开关：关时不剥、开时剥', async () => {
    const { clearFormat } = await import('./editCommands')
    const run = (value: string, start: number, end: number) => {
      const b = { value, start, end }
      clearFormat(b)
      return b.value
    }
    expect(run('==高==', 0, 5)).toBe('==高==')
    const { EXTRA_INLINE } = await import('./view')
    EXTRA_INLINE.highlight = true
    try {
      expect(run('==高==', 0, 5)).toBe('高')
    } finally {
      EXTRA_INLINE.highlight = false
    }
  })
})

describe('裸标记对是字面文本（caret-assertions/02）', () => {
  it('`**` / `~~` / 空反引号不被当成空构造：无 marker、偏移全部可寻址', () => {
    for (const raw of ['段落**', '段落~~', '段落``']) {
      const line = view(raw).lines[0]
      expect(line.markers).toHaveLength(0)
      expect(line.runs.map((r) => r.text).join('')).toBe(raw)
      // 每个源码偏移都有可见格可落——否则光标只能回退到标记之前
      expect(line.sourceToVisible.every((cell) => cell !== -1)).toBe(true)
    }
  })

  it('有内容的成对标记照旧解析', () => {
    const line = view('**b**').lines[0]
    expect(line.runs.map((r) => r.text).join('')).toBe('**b**')
    expect(view('**b**').lines[0].text).toBe('b')
  })
})

describe('代码块高亮', () => {
  it('带语言的围栏：内容行按 token 分段，且仍然逐字拼回源码', () => {
    const raw = '```ts\ninterface B {\n  startLine: number\n}\n```'
    const v = view(raw)
    expect(reconstruct(v)).toBe(raw)

    const code = runs(v, 1)
    expect(code.length).toBeGreaterThan(1)
    expect(code.find((r) => r.text === 'interface')?.hl).toBe('hljs-keyword')
    expect(code.map((r) => r.text).join('')).toBe('interface B {')
  })

  it('分段之后每个 run 的 src 仍然首尾相接（否则光标映射会错位）', () => {
    const raw = '```ts\nlet a = 1\nlet b = 2\n```'
    const v = view(raw)
    for (const line of v.lines.slice(1, 3)) {
      let at = line.runs[0].src
      for (const run of line.runs) {
        expect(run.src).toBe(at)
        at += run.text.length
      }
    }
    // 第二行从自己的起点算块内偏移，不是从 0
    expect(v.lines[2].runs[0].src).toBe(raw.indexOf('let b'))
  })

  it('折叠态与显现态的分段完全一致：显现只换可见性，不换文本节点', () => {
    // ADR-0002 §1。光标在块内时围栏行由一个 marker run 变成 dim run，但代码内容
    // 行的边界与文本必须一模一样，否则锚在里面的光标会被挪走。
    const raw = '```ts\nconst a: number = 1\n```'
    const shape = (v: BlockView) =>
      v.lines.map((line) => line.runs.map((r) => ({ text: r.text, src: r.src, hl: r.mark.hl })))
    expect(shape(view(raw, [1]))).toEqual(shape(view(raw)))
  })

  it('跨行的块注释两行都带同一个 class——整块高亮，不是逐行', () => {
    const raw = '```js\nlet a = 1\n/* one\n   two */\n```'
    const v = view(raw)
    expect(reconstruct(v)).toBe(raw)
    expect(runs(v, 2).every((r) => r.hl === 'hljs-comment')).toBe(true)
    expect(runs(v, 3).every((r) => r.hl === 'hljs-comment')).toBe(true)
  })

  it('不带语言或语言不认识：整行一个 run，不着色', () => {
    for (const raw of ['```nope\nconst a = 1\n```', '```\nconst a = 1\n```']) {
      const code = runs(view(raw), 1)
      expect(code).toHaveLength(1)
      expect(code[0].hl).toBeUndefined()
      expect(code[0].text).toBe('const a = 1')
    }
  })

  it('超过高亮上限的块整行退回，不留半截 token', () => {
    const body = Array.from({ length: 1001 }, (_, i) => `const v${i} = 1`).join('\n')
    const v = view('```js\n' + body + '\n```')
    expect(v.lines[1].runs).toHaveLength(1)
    expect(v.lines[1].runs[0].mark.hl).toBeUndefined()
    expect(reconstruct(v)).toBe('```js\n' + body + '\n```')
  })

  it('围栏行本身不是内容行：折叠态是一个 marker run', () => {
    const v = view('```js\nconst a = 1\n```')
    expect(runs(v, 0)).toEqual([{ text: '```js', marker: true, dim: false }])
    expect(runs(v, 2)).toEqual([{ text: '```', marker: true, dim: false }])
  })

  it('围栏内的 Markdown 语法仍然是字面量（高亮不会把它变回构造）', () => {
    const v = view('```js\nconst a = **x**\n```')
    const code = runs(v, 1)
    expect(code.map((r) => r.text).join('')).toBe('const a = **x**')
    expect(code.some((r) => r.bold)).toBe(false)
    expect(code.every((r) => r.marker === false)).toBe(true)
  })
})
