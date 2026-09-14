/**
 * The folder seam, driven by a fake directory API.
 *
 * What is worth pinning here is the walking and the shape: one level per call,
 * paths built relative to the root, a subdirectory found by following its
 * segments — and a dismissed picker reported as a result rather than thrown at
 * the caller. The fake is an API, not a `Folders`: the point of the seam is that
 * the browser half is the interesting half.
 */
import { describe, expect, it } from 'vitest'
import { fileSystemAccessFolders } from './folder'

interface FakeNode {
  name: string
  kind: 'file' | 'directory'
  children?: FakeNode[]
}

function directory(node: FakeNode) {
  return {
    kind: 'directory' as const,
    name: node.name,
    async *values() {
      for (const child of node.children ?? []) {
        yield child.kind === 'directory' ? directory(child) : { kind: 'file' as const, name: child.name }
      }
    },
    async getDirectoryHandle(name: string) {
      const child = (node.children ?? []).find(
        (candidate) => candidate.name === name && candidate.kind === 'directory',
      )
      if (!child) throw new DOMException(`no such directory: ${name}`, 'NotFoundError')
      return directory(child)
    },
  }
}

/** A folder with a subdirectory, a hidden file and a non-document in it. */
const TREE: FakeNode = {
  name: '干草堆',
  kind: 'directory',
  children: [
    { name: '笔记.md', kind: 'file' },
    { name: '截图.png', kind: 'file' },
    { name: '.hidden', kind: 'file' },
    {
      name: '章节',
      kind: 'directory',
      children: [
        { name: '一.md', kind: 'file' },
        { name: '上', kind: 'directory', children: [{ name: '序.md', kind: 'file' }] },
      ],
    },
  ],
}

function apiWith(handle: ReturnType<typeof directory> | null, fail?: unknown) {
  return {
    showDirectoryPicker: async () => {
      if (fail) throw fail
      if (!handle) throw new DOMException('dismissed', 'AbortError')
      return handle
    },
  }
}

describe('canOpen', () => {
  it('没有目录选择器就说自己不能开', () => {
    expect(fileSystemAccessFolders({}).canOpen()).toBe(false)
  })

  it('有目录选择器就说自己能开', () => {
    expect(fileSystemAccessFolders(apiWith(directory(TREE))).canOpen()).toBe(true)
  })
})

describe('pick', () => {
  it('把文件夹的名字与句柄交回来', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))

    const root = await folders.pick()

    expect(root?.name).toBe('干草堆')
    expect(root?.handle).toBeDefined()
  })

  it('用户取消是一个结果，不是异常', async () => {
    // 选择器被关掉：一个 AbortError，翻译成 null。
    const folders = fileSystemAccessFolders(apiWith(null))

    await expect(folders.pick()).resolves.toBeNull()
  })

  it('真正的失败照旧抛出去（调用者要能提示）', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE), new Error('没有权限')))

    await expect(folders.pick()).rejects.toThrow('没有权限')
  })

  it('平台没有这个 API 时也是 null，而不是崩', async () => {
    await expect(fileSystemAccessFolders({}).pick()).resolves.toBeNull()
  })
})

describe('list', () => {
  it('列出一层，路径相对文件夹根', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    const entries = await folders.list(root, '')

    expect(entries.map((entry) => entry.path)).toEqual([
      '笔记.md',
      '截图.png',
      '.hidden',
      '章节',
    ])
    expect(entries.map((entry) => entry.kind)).toEqual([
      'file',
      'file',
      'file',
      'directory',
    ])
  })

  it('只读一层：子目录的内容不会顺手被读出来', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    const entries = await folders.list(root, '')

    expect(entries.some((entry) => entry.path === '章节/一.md')).toBe(false)
  })

  it('子目录按路径逐段走下去', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    const entries = await folders.list(root, '章节')

    expect(entries.map((entry) => entry.path)).toEqual(['章节/一.md', '章节/上'])
  })

  it('两层深也走得下去', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    const entries = await folders.list(root, '章节/上')

    expect(entries.map((entry) => entry.path)).toEqual(['章节/上/序.md'])
  })

  it('目录不在了就抛出去，调用者去提示', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    await expect(folders.list(root, '没有这个目录')).rejects.toThrow()
  })
})
