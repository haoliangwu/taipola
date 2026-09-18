/**
 * 文档图片的渲染属性（`.scratch/img-render-attrs/issues/01`）。
 *
 * 图片解码默认同步可能卡主线程一小段；`decoding="async"` 让解码不挡帧。`loading="lazy"`
 * 明确不上——图片随源码揭示/折叠反复重建，惰性拉取的语义被稀释（票里有完整论证）。
 *
 * 注意：光标在图片构造内部时图片让位显示源码（`view.ts` 的 reveal 语义），所以断言
 * 渲染态要把光标点到别处的段落再量。
 */
import { describe, expect, it } from 'vitest'
import { clickInRun, flush, renderEditor } from '../test/editorTestUtils'

describe('文档图片', () => {
  it('<img> 带 decoding="async"', async () => {
    const r = renderEditor('![图](pic.png)\n\n正文\n')
    await flush()
    // 光标默认在文档开头（图片构造内）→ 让位显示源码；点进正文段落让它渲染。
    await clickInRun(r, 2, 0, 0)
    await flush()
    const img = r.container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.decoding).toBe('async')
  })

  it('{width=…} 尺寸后缀照旧生效', async () => {
    const r = renderEditor('![图](pic.png){width=200}\n\n正文\n')
    await flush()
    await clickInRun(r, 2, 0, 0)
    await flush()
    expect(r.container.querySelector('img')?.getAttribute('width')).toBe('200')
  })
})