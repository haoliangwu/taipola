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
    ...(run.mark.code ? { code: true } : {}),
    ...(run.mark.link ? { link: run.mark.link } : {}),
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
