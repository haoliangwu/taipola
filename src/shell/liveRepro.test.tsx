import { describe, it, expect } from 'vitest'
import {
  renderEditor,
  caretFromDom,
  flush,
  clickInRun,
  pressShiftEnter,
  pressBackspace,
  assertDomMatchesSource,
} from '../test/editorTestUtils'

// 线上站点（e6bbdc1 部署后）真实浏览器复现的两条线索：
// 1) 标题行末 Shift+Enter 不渲染任何新行，且后续 Backspace 吃字符
// 2) 段落 soft 栈清空后，光标落在下一段行首（应为段末），多按一次
//    Backspace 触发段落合并而非删字符（bug E，2 已修）
describe('线上复现：标题与段落的软断行', () => {
  it('标题行末 Shift+Enter：渲染软断行行盒，光标骑新行', async () => {
    const r = renderEditor('# 标题\n\n正文\n')
    await flush()
    // 标题的 run 0 是被折叠的 `# ` 标记，文本在 run 1
    await clickInRun(r, 0, 0, 1, 'end')
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('# 标题\n\n\n正文\n')
    // 新行 = 第 5 个源码偏移（标题段后的第一个空行），是可见行盒。
    expect(caretFromDom()).toBe(5)
    const rows = [...r.container.querySelectorAll('.blk')].map((b) => {
      const lines = [...b.querySelectorAll('[data-vline]')].map((l) => l.textContent)
      return `[${lines.join(' / ')}]`
    })
    // 空行占位块渲染了一行（`[]` —— 单个空行盒的文本就是 `''`）：fresh s 行
    // 开一个行盒，预存的分隔行（S）不渲染（R1——段落空隙由段距承载，
    // paragraph-spacing 十一审）。旧实现把分隔行也渲染成 `[ / ]` 再隐藏
    // （data-ph-sep）。
    expect(rows.some((s) => s === '[]')).toBe(true)
    await assertDomMatchesSource(r)
    // 已知与 Typora 的分歧（接受，非 bug）：Typora 把软行留在标题内；
    // taipola 在标题下方开一个空行栈。上方断言钉住后者。
  })

  it('段落栈清空后光标应停段末（下一段存在时）', async () => {
    const r = renderEditor('甲乙\n\n丙\n')
    await flush()
    await clickInRun(r, 0, 0, 0, 'end')
    await pressShiftEnter(r)
    await flush()
    expect(r.getDoc()).toBe('甲乙\n\n\n丙\n')
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('甲乙\n\n丙\n')
    // 关键：光标应回到段末 offset 2，而非下一段行首或空分隔行。
    expect(caretFromDom()).toBe(2)
    // 紧接着再按一次 Backspace：Typora 语义 = 删『乙』，而不是合并下一段。
    await pressBackspace(r)
    await flush()
    expect(r.getDoc()).toBe('甲\n\n丙\n')
    await assertDomMatchesSource(r)
  })
})
