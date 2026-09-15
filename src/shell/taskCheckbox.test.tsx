import { describe, it, expect, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithDoc } from '../test/appTestUtils'
import { readDocumentSource } from '../editor/render'
import { placeCaretAt } from '../test/editorTestUtils'
import { stubSavedFolder } from '../test/platformStubs'

/**
 * task-checkbox 票据 01：任务清单的勾选框可点击（对齐 Typora）。
 *
 * 勾选框是 CSS 伪元素（`.vl-task:not(.revealed)::before`），DOM 里没有元素可点——
 * 内核按几何命中「行盒左缘到首个可见文字之间」这条装饰带。用例因此用**视口坐标**点击，
 * 与 `clickInRun` 同理（`user.pointer` 的 coords 是绝对视口坐标，不是元素内偏移）。
 *
 * 每个用例都先把光标放在任务清单**之外**的段落里：光标在行内时那行显示源码（揭示态），
 * 勾选框本来就不该可点。
 */

const DOC = '前言\n\n- [ ] 甲\n'
const TASK_BLOCK = 2

/** 把光标放进第一段，任务行随之回到渲染态。 */
function caretInParagraph(doc: HTMLElement): void {
  const run = doc.querySelector('[data-block="0"] [data-run]')?.firstChild as Text | null
  if (!run) throw new Error('no paragraph run')
  placeCaretAt(run, 0)
}

/** 渲染态任务行的勾选框中心，视口坐标。 */
function boxCenter(doc: HTMLElement) {
  const line = doc.querySelector(
    `[data-block="${TASK_BLOCK}"] [data-vline="0"]`,
  ) as HTMLElement | null
  if (!line) throw new Error('no task line')
  const text = line.querySelector('[data-run]:not(.rn-marker)') as HTMLElement | null
  if (!text) throw new Error('no visible run')
  const range = document.createRange()
  range.selectNodeContents(text)
  const textRect = range.getBoundingClientRect()
  const lineRect = line.getBoundingClientRect()
  return { target: line, x: (lineRect.left + textRect.left) / 2, y: lineRect.top + lineRect.height / 2 }
}

async function clickBox(doc: HTMLElement) {
  const user = userEvent.setup({ delay: null })
  const box = boxCenter(doc)
  await user.pointer({ target: box.target, keys: '[MouseLeft]', coords: { x: box.x, y: box.y } })
  return user
}

describe('任务勾选框点击翻转（task-checkbox/01）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSavedFolder()
  })

  it('点击渲染态勾选框：模型 [ ] → [x]，再点回 [ ]', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    caretInParagraph(doc)
    await clickBox(doc)
    expect(readDocumentSource(doc)).toBe('前言\n\n- [x] 甲\n')

    caretInParagraph(doc)
    await clickBox(doc)
    expect(readDocumentSource(doc)).toBe('前言\n\n- [ ] 甲\n')
    view.unmount()
  })

  it('点击勾选框不把光标带进该行（行盒保持渲染态，不揭示源码）', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    caretInParagraph(doc)
    await clickBox(doc)
    const line = doc.querySelector(`[data-block="${TASK_BLOCK}"] [data-vline="0"]`) as HTMLElement
    expect(line.className).toContain('vl-task')
    expect(line.className).not.toContain('revealed')
    view.unmount()
  })

  it('撤销把勾选还原', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    caretInParagraph(doc)
    const user = await clickBox(doc)
    expect(readDocumentSource(doc)).toBe('前言\n\n- [x] 甲\n')

    doc.focus()
    caretInParagraph(doc)
    await user.keyboard('{Control>}z{/Control}')
    expect(readDocumentSource(doc)).toBe('前言\n\n- [ ] 甲\n')
    view.unmount()
  })

  it('点击正文（勾选框右侧）仍只是放光标，不翻转', async () => {
    const { view, doc } = await renderWithDoc(DOC)
    caretInParagraph(doc)
    const user = userEvent.setup({ delay: null })
    const run = doc.querySelector(
      `[data-block="${TASK_BLOCK}"] [data-run]:not(.rn-marker)`,
    ) as HTMLElement
    const rect = run.getBoundingClientRect()
    await user.pointer({
      target: run,
      keys: '[MouseLeft]',
      coords: { x: rect.left + 1, y: rect.top + rect.height / 2 },
    })
    expect(readDocumentSource(doc)).toBe(DOC)
    view.unmount()
  })
})