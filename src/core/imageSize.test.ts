import { describe, expect, it } from 'vitest'
import { readImageSize } from './imageSize'

/**
 * 语法本身的边界。
 *
 * `{width=200}` 是本仓库往 Markdown 里加的唯一一处扩展语法（`docs/adr/0003`），
 * 所以「什么算、什么不算」要钉死。屏幕和导出共用这个读取器，这一份清单就是两边的共同答案：
 * 宽度先只收整数像素，其余写法一律当正文——宁可窄，也不要两处各自解释。
 */
describe('readImageSize', () => {
  it('读出像素宽度，并给出后缀占几个字符', () => {
    expect(readImageSize('{width=200}')).toEqual({ width: '200', suffixLength: 11 })
    expect(readImageSize('{width=64}后面的正文')).toEqual({ width: '64', suffixLength: 10 })
  })

  it('只认紧跟在图片之后的那一种写法', () => {
    expect(readImageSize(' {width=200}')).toBeNull() // 中间隔了空格
    expect(readImageSize('{ width=200}')).toBeNull() // 花括号里带空格
    expect(readImageSize('{width=200 }')).toBeNull()
    expect(readImageSize('{width=20%}')).toBeNull() // 百分比要落到 style 上，导出禁 style（ADR-0003）
    expect(readImageSize('{width=200px}')).toBeNull() // 不带单位，像素是默认
    expect(readImageSize('{width=abc}')).toBeNull()
    expect(readImageSize('{height=200}')).toBeNull() // 高度还没定
    expect(readImageSize('')).toBeNull()
  })
})
