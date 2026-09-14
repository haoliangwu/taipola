/**
 * The file seam, driven by fake adapters.
 *
 * Two adapters implement `StorageAdapter` — write-back through the File System
 * Access API and a download-only fallback — and which one you get depends on the
 * browser. That is exactly why the seam exists, and why these tests inject a
 * fake instead of stubbing `window`: the point of the interface is that the
 * caller never learns which adapter is behind it, so the test shouldn't either.
 */
import { describe, expect, it } from 'vitest'
import { createDocuments, type StorageAdapter } from './documents'

interface Download {
  text: string
  filename: string
  mime: string
}

const HANDLE_A = { file: 'a' }
const HANDLE_B = { file: 'b' }

/** A platform with no File System Access API: read, then download. */
function downloadOnly(downloads: Download[]): StorageAdapter {
  return {
    writeBack: false,
    pickOpen: async () => ({ name: 'note.md', content: '# 笔记\n', handle: null, modifiedAt: 111 }),
    download: (text, filename, mime) => downloads.push({ text, filename, mime }),
  }
}

/** A platform that can save back into the file it opened. */
function writeBack(
  downloads: Download[],
  writes: Array<{ handle: unknown; text: string }>,
  overrides: {
    pickSave?: () => Promise<{ name: string; handle: unknown } | null>
    writeOk?: boolean
    modifiedAtNow?: number
    modifiedAtThrows?: boolean
  } = {},
): StorageAdapter {
  return {
    writeBack: true,
    pickOpen: async () => ({ name: 'note.md', content: '# 笔记\n', handle: HANDLE_A, modifiedAt: 111 }),
    pickSave: overrides.pickSave ?? (async (name) => ({ name, handle: HANDLE_B })),
    write: async (handle, text) => {
      writes.push({ handle, text })
      return overrides.writeOk ?? true
    },
    modifiedAt: async () => {
      if (overrides.modifiedAtThrows) throw new Error('the file is gone')
      return overrides.modifiedAtNow ?? 111
    },
    download: (text, filename, mime) => downloads.push({ text, filename, mime }),
  }
}

describe('open', () => {
  it('把文件的内容和身份交回来', async () => {
    const documents = createDocuments(downloadOnly([]))
    const result = await documents.open()
    expect(result).toMatchObject({
      status: 'opened',
      content: '# 笔记\n',
      document: { name: 'note.md' },
    })
  })

  it('连文件的修改时间一起交回来（写回之前要拿它比对）', async () => {
    const documents = createDocuments(downloadOnly([]))
    const result = await documents.open()
    expect(result).toMatchObject({ modifiedAt: 111 })
  })

  it('用户取消是一个结果，不是异常', async () => {
    const documents = createDocuments({
      writeBack: false,
      pickOpen: async () => null,
      download: () => {},
    })
    await expect(documents.open()).resolves.toEqual({ status: 'cancelled' })
  })

  it('真实的失败也走返回值，调用者不必认识异常类型', async () => {
    const documents = createDocuments({
      writeBack: false,
      pickOpen: async () => {
        throw new Error('permission denied')
      },
      download: () => {},
    })
    const result = await documents.open()
    expect(result.status).toBe('failed')
  })
})

describe('save：不支持写回时走下载', () => {
  it('保存即下载，并报回 downloaded', async () => {
    const downloads: Download[] = []
    const documents = createDocuments(downloadOnly(downloads))

    const result = await documents.save(null, '# 正文\n')

    expect(result).toEqual({ status: 'downloaded', name: 'untitled.md' })
    expect(downloads).toHaveLength(1)
    expect(downloads[0].text).toBe('# 正文\n')
    expect(downloads[0].filename).toBe('untitled.md')
  })

  it('沿用当前文档的文件名，并且不再追加 .md', async () => {
    const downloads: Download[] = []
    const documents = createDocuments(downloadOnly(downloads))

    await documents.save({ name: 'report.md', handle: null }, 'x')

    expect(downloads[0].filename).toBe('report.md')
  })

  // The welcome document has a name but no handle. Resolving the name from the
  // handle alone is what made the title bar and the save dialog disagree.
  it('没有句柄时用调用方给的名字，而不是自己编一个', async () => {
    const downloads: Download[] = []
    const documents = createDocuments(downloadOnly(downloads))

    const result = await documents.save(null, '# 正文\n', { name: 'welcome.md' })

    expect(result).toEqual({ status: 'downloaded', name: 'welcome.md' })
    expect(downloads[0].filename).toBe('welcome.md')
  })

  it('有句柄时句柄的名字说了算', async () => {
    const downloads: Download[] = []
    const documents = createDocuments(downloadOnly(downloads))

    await documents.save({ name: 'report.md', handle: null }, 'x', { name: 'welcome.md' })

    expect(downloads[0].filename).toBe('report.md')
  })
})

describe('save：支持写回时写回原文件', () => {
  it('写回同一个文件，不下载', async () => {
    const downloads: Download[] = []
    const writes: Array<{ handle: unknown; text: string }> = []
    const documents = createDocuments(writeBack(downloads, writes))
    const opened = await documents.open()
    if (opened.status !== 'opened') throw new Error('expected an opened document')

    const result = await documents.save(opened.document, '改过了\n')

    expect(result).toEqual({ status: 'saved', document: opened.document })
    expect(writes).toEqual([{ handle: HANDLE_A, text: '改过了\n' }])
    expect(downloads).toEqual([])
  })

  it('没有打开的文档时弹保存选择器，并记住新身份', async () => {
    const writes: Array<{ handle: unknown; text: string }> = []
    const documents = createDocuments(writeBack([], writes))

    const result = await documents.save(null, '新文档\n')

    expect(result).toEqual({ status: 'saved', document: { name: 'untitled.md', handle: HANDLE_B } })
    expect(writes).toEqual([{ handle: HANDLE_B, text: '新文档\n' }])
  })

  it('保存选择器建议的名字也可以是调用方给的', async () => {
    const documents = createDocuments(writeBack([], []))

    const result = await documents.save(null, '新文档\n', { name: 'welcome.md' })

    expect(result).toEqual({ status: 'saved', document: { name: 'welcome.md', handle: HANDLE_B } })
  })

  it('另存为也会弹选择器：用户取消时什么都没写', async () => {
    const writes: Array<{ handle: unknown; text: string }> = []
    const documents = createDocuments(
      writeBack([], writes, { pickSave: async () => null }),
    )
    const opened = await documents.open()
    if (opened.status !== 'opened') throw new Error('expected an opened document')

    const result = await documents.save(opened.document, '改过了\n', { forcePicker: true })

    expect(result).toEqual({ status: 'cancelled' })
    expect(writes).toEqual([])
  })

  it('拒绝写权限等于用户取消', async () => {
    const documents = createDocuments(writeBack([], [], { writeOk: false }))
    const opened = await documents.open()
    if (opened.status !== 'opened') throw new Error('expected an opened document')

    await expect(documents.save(opened.document, 'x')).resolves.toEqual({ status: 'cancelled' })
  })
})

describe('写回这个能力本身', () => {
  it('能写回的平台说自己能，只有下载的平台说自己不能', () => {
    expect(createDocuments(writeBack([], [])).canWriteBack).toBe(true)
    expect(createDocuments(downloadOnly([])).canWriteBack).toBe(false)
  })

  it('问得出文件的修改时间', async () => {
    const documents = createDocuments(writeBack([], [], { modifiedAtNow: 4_242 }))
    const opened = await documents.open()
    if (opened.status !== 'opened') throw new Error('expected an opened document')

    await expect(documents.modifiedAt(opened.document)).resolves.toBe(4_242)
  })

  it('平台不会写回时不装作问得到', async () => {
    const documents = createDocuments(downloadOnly([]))
    await expect(documents.modifiedAt({ name: 'note.md', handle: null })).resolves.toBeNull()
  })

  it('文件已经没了：返回 null，而不是把异常扔给调用者', async () => {
    const documents = createDocuments(writeBack([], [], { modifiedAtThrows: true }))
    const opened = await documents.open()
    if (opened.status !== 'opened') throw new Error('expected an opened document')

    await expect(documents.modifiedAt(opened.document)).resolves.toBeNull()
  })
})

describe('export', () => {
  it('导出 HTML 走完整的独立文件，文件名换成 .html', async () => {
    const downloads: Download[] = []
    const documents = createDocuments(downloadOnly(downloads))

    documents.exportHtml('# 标题\n', '笔记.md')

    expect(downloads).toHaveLength(1)
    expect(downloads[0].filename).toBe('笔记.html')
    expect(downloads[0].text).toContain('<!doctype html>')
    expect(downloads[0].text).toContain('<h1>标题</h1>')
  })

  it('导出 MD 原样下载源码', async () => {
    const downloads: Download[] = []
    const documents = createDocuments(downloadOnly(downloads))

    documents.exportMarkdown('# 标题\n', '笔记.txt')

    expect(downloads[0]).toMatchObject({ text: '# 标题\n', filename: '笔记.txt.md' })
  })

  it('只剥掉 markdown 扩展名，普通带点的文件名原样保留', async () => {
    const downloads: Download[] = []
    const documents = createDocuments(downloadOnly(downloads))

    documents.exportHtml('x\n', 'notes.v2')

    expect(downloads[0].filename).toBe('notes.v2.html')
  })
})
