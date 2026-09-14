import { describe, expect, it } from 'vitest'
import { isBlankLine, lineOfOffset, offsetForLine } from './lines'

describe('isBlankLine', () => {
  it('空字符串、只有空格或制表符的行都算空行', () => {
    expect(isBlankLine('')).toBe(true)
    expect(isBlankLine('   ')).toBe(true)
    expect(isBlankLine('\t \t')).toBe(true)
  })

  it('有任何别的字符就不是空行', () => {
    expect(isBlankLine('甲')).toBe(false)
    expect(isBlankLine(' 甲 ')).toBe(false)
    expect(isBlankLine('-')).toBe(false)
  })
})

describe('line arithmetic', () => {
  it('offsetForLine / lineOfOffset 互为反函数', () => {
    const text = '第一行\n第二行\n第三行'
    expect(offsetForLine(text, 1)).toBe(0)
    expect(offsetForLine(text, 2)).toBe(4)
    expect(offsetForLine(text, 3)).toBe(8)
    expect(offsetForLine(text, 9)).toBe(text.length)
    expect(lineOfOffset(text, 0)).toBe(1)
    expect(lineOfOffset(text, 4)).toBe(2)
    expect(lineOfOffset(text, 7)).toBe(2)
    expect(lineOfOffset(text, 8)).toBe(3)
  })
})
