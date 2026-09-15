import { describe, expect, it } from 'vitest'
import { parseDocument } from './markdown'
import { buildBlockView } from './view'
import { WELCOME_DOC } from './welcome'

/**
 * The welcome document is the first thing a visitor reads, and it doubles as the
 * feature list — so it drifts: it advertised `Cmd/Ctrl + E` for inline code for
 * a whole release after that binding was replaced by `⌃\``. These tests hold the
 * two properties that matter: the demo text must survive the editor's own view
 * (a stray backtick in a table cell would corrupt the table), and it must not
 * send readers to a key that no longer exists.
 */

/** What a block renders as, line by line, rebuilt from its view. */
function viewText(raw: string, start: number, lineCount: number): string {
  const view = buildBlockView(raw, start, [], lineCount)
  return view.lines.map((line) => line.runs.map((run) => run.text).join('')).join('\n')
}

describe('欢迎文档', () => {
  it('每一块都能被视图无损重建（围栏 / 数学 / 行内标记都不破）', () => {
    const { blocks, offsets } = parseDocument(WELCOME_DOC)
    for (const block of blocks) {
      // Tables are the documented exception: their pipes are not view text at all,
      // the DOM readback re-inserts them (`render.ts` `textOfLine`). The table has
      // its own test below.
      if (block.raw.trimStart().startsWith('|')) continue
      // The parser may widen a block's span past its raw (a list absorbs the
      // blank line after it, and the view pads to the span so the caret has a
      // line to sit on), which shows up as trailing blank lines only.
      const rebuilt = viewText(block.raw, offsets[block.index], block.endLine - block.startLine)
      expect(rebuilt.replace(/\n+$/, ''), `block ${block.index} 重建不一致`).toBe(block.raw)
    }
  })

  it('快捷键表解析成 11 行，含反引号的键位没被反引号弄坏', () => {
    const { blocks, offsets } = parseDocument(WELCOME_DOC)
    const table = blocks.find((block) => block.raw.startsWith('| 快捷键'))
    expect(table, '快捷键表不见了').toBeDefined()
    const text = viewText(table!.raw, offsets[table!.index], table!.endLine - table!.startLine)
    expect(text.split('\n')).toHaveLength(13) // 表头 + 分隔行 + 11 行
    expect(text).toContain('⌃`')
    expect(text).toContain('⌥⌘Q')
  })

  it('不再宣传已经移除的键位', () => {
    expect(WELCOME_DOC).not.toContain('Cmd/Ctrl + E')
  })

  it('演示链接指向仓库，并留了一句求 star 的话', () => {
    // The demo links used to point at example.com — a placeholder a reader cannot
    // act on. They now point at the repo, so the one place the reader is invited to
    // click is the place that actually exists.
    expect(WELCOME_DOC).not.toContain('example.com')
    expect(WELCOME_DOC).toContain('[链接](https://github.com/haoliangwu/taipola)')
    expect(WELCOME_DOC).toContain('https://github.com/haoliangwu/taipola')
    expect(WELCOME_DOC).toContain('小星星')
  })

  it('新功能都在演示里出现', () => {
    for (const feature of ['⌃M', '$E = mc^2$', '直接点它就能勾上', '⌥⌘Q', '⌘\\', '⌥⌘-']) {
      expect(WELCOME_DOC).toContain(feature)
    }
  })
})
