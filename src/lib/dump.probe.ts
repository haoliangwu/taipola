import { describe, it } from 'vitest'
import { extractHeadings, parseDocument, computeStats } from './markdown'

const DOCS: Array<[string, string]> = [
  ['empty', ''],
  ['one line no newline', 'a'],
  ['one line', 'a\n'],
  ['two paragraphs', 'a\n\nb\n'],
  ['heading + list', '# h\n\n- l\n'],
  ['trailing blanks', 'x\n\n\n'],
  ['table', '| a | b |\n| --- | --- |\n| 1 | 2 |\n'],
  ['setext', 'Title\n=====\n'],
  ['nested list', '- a\n  - b\n'],
]

describe('DUMP', () => {
  it('structures', () => {
    const out = DOCS.map(([name, doc]) => {
      const parsed = parseDocument(doc)
      return {
        name,
        len: doc.length,
        offsets: parsed.offsets,
        blocks: parsed.blocks.map((b) => ({
          raw: JSON.stringify(b.raw),
          start: b.startLine,
          end: b.endLine,
          level: b.headingLevel,
          text: b.headingText,
        })),
      }
    })
    console.log('DUMP ' + JSON.stringify(out))
    console.log('HEADINGS ' + JSON.stringify(extractHeadings('a\n\n# h1\n\n```\n# not a heading\n```\n\nh2\n---\n')))
    console.log('STATS ' + JSON.stringify(computeStats('你好 world\nsecond line\n')))
  })
})
