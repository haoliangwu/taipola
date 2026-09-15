import { describe, expect, it } from 'vitest'
import { fenceLanguage, highlightCode, tokensByLine, type CodeToken } from './codeHighlight'

const joined = (tokens: CodeToken[]) => tokens.map((t) => t.text).join('')

/**
 * The highlighter feeds the editor's run segmentation, and the editor's whole
 * caret model rests on "the runs of a line concatenate back to the source"
 * (ADR-0002 §1). So a token stream that is not an exact partition of its input is
 * not a cosmetic problem — it is model corruption. These tests hold that.
 */
describe('代码高亮 token 流', () => {
  it('片段拼接与源码逐字节一致（模型安全的底线）', () => {
    const cases: Array<[string, string]> = [
      ['javascript', 'const a = 1 // c\n/* multi\n   line */\nlet b = `t${a}`'],
      ['typescript', 'interface B {\n  startLine: number\n}'],
      ['python', 'def f(x):\n    """doc\n    more"""\n    return x + 1'],
      ['rust', 'fn main() { let v: Vec<u8> = vec![1]; }'],
      ['json', '{"a": [1, true, null]}'],
      ['sql', 'SELECT id FROM t WHERE x = 1'],
      ['diff', '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new'],
      ['xml', '<div class="x">\n  <script>var y = 1</script>\n</div>'],
      ['markdown', '# t\n\n```js\nconst z=1\n```'],
      ['bash', 'set -e\nfor f in *.ts; do echo "$f"; done'],
      ['yaml', 'a: 1\nb:\n  - x'],
      ['css', '.a { color: red }'],
    ]
    for (const [lang, code] of cases) {
      const tokens = highlightCode(code, lang)
      expect(tokens, `${lang} 应当被识别`).not.toBeNull()
      expect(joined(tokens!), `${lang} 往返不一致`).toBe(code)
      expect(
        tokens!.every((t) => t.text !== ''),
        `${lang} 不应该产出空片段`,
      ).toBe(true)
    }
  })

  it('确实产出了 scope 类，而不是退化成整块一个片段', () => {
    const tokens = highlightCode('const a = 1', 'javascript')!
    expect(tokens.length).toBeGreaterThan(2)
    expect(tokens.find((t) => t.text === 'const')?.cls).toBe('hljs-keyword')
    expect(tokens.find((t) => t.text === '1')?.cls).toBe('hljs-number')
  })

  it('分层 scope 映射成 hljs 自己的复合类名（title.function → hljs-title function_）', () => {
    const tokens = highlightCode('function greet() {}', 'javascript')!
    expect(tokens.some((t) => t.cls === 'hljs-title function_')).toBe(true)
  })

  it('多行构造按整块高亮，再按行切开——每一行都带着同一个 class', () => {
    const code = 'let a = 1\n/* one\n   two */\nlet b = 2'
    const tokens = highlightCode(code, 'javascript')!
    // 注释在 token 流里是**一个**跨行片段：逐行高亮不可能得到这个。
    const comment = tokens.find((t) => t.cls === 'hljs-comment')
    expect(comment?.text).toBe('/* one\n   two */')

    const lines = code.split('\n')
    const perLine = tokensByLine(tokens, lines)!
    expect(perLine.map(joined)).toEqual(lines)
    expect(perLine[1].every((t) => t.cls === 'hljs-comment')).toBe(true)
    expect(perLine[2].every((t) => t.cls === 'hljs-comment')).toBe(true)
  })

  it('空行切出来是空 token 列表，不是空片段', () => {
    const code = 'let a = 1\n\nlet b = 2'
    const perLine = tokensByLine(highlightCode(code, 'javascript')!, code.split('\n'))!
    expect(perLine.map(joined)).toEqual(['let a = 1', '', 'let b = 2'])
    expect(perLine[1]).toEqual([])
  })

  it('未知语言或没有语言 → null（不着色，也不抛）', () => {
    expect(highlightCode('x=1', null)).toBeNull()
    expect(highlightCode('x=1', '')).toBeNull()
    expect(highlightCode('x=1', 'nope-not-a-language')).toBeNull()
  })

  it('别名和常见写法都认', () => {
    for (const lang of ['js', 'javascript', 'ts', 'typescript', 'py', 'sh', 'yml']) {
      expect(highlightCode('const a = 1', lang), lang).not.toBeNull()
    }
  })

  it('切不齐时 tokensByLine 返回 null（让调用方退回整行一个 run）', () => {
    const tokens = highlightCode('const a = 1', 'javascript')!
    expect(tokensByLine(tokens, ['const a = 2'])).toBeNull()
    expect(tokensByLine(tokens, ['const a = 1', 'extra'])).toBeNull()
    expect(tokensByLine(tokens, ['const a ='])).toBeNull()
  })

  it('fenceLanguage 取 info string 的第一个空白分隔词', () => {
    expect(fenceLanguage('js')).toBe('js')
    expect(fenceLanguage('  typescript  ')).toBe('typescript')
    expect(fenceLanguage('js title="x"')).toBe('js')
    expect(fenceLanguage('')).toBeNull()
    expect(fenceLanguage('   ')).toBeNull()
  })

  it('子语言不把 language: 前缀当成类名', () => {
    const tokens = highlightCode('<script>var y = 1</script>', 'xml')!
    expect(joined(tokens)).toBe('<script>var y = 1</script>')
    expect(tokens.some((t) => t.cls.includes('language:'))).toBe(false)
    expect(tokens.some((t) => t.cls.includes('hljs-keyword'))).toBe(true)
  })
})
