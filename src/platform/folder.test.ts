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

/**
 * A file handle bound to its node and its parent, so the mutations the seam
 * offers (move / remove) actually change the tree the fake serves. Renames are
 * in place: a cross-directory move is not something this seam does.
 */
function fileHandle(node: FakeNode, parent: FakeNode) {
  return {
    kind: 'file' as const,
    name: node.name,
    async move(_directory: unknown, newName?: string) {
      if (newName !== undefined) node.name = newName
    },
    async remove() {
      if (!parent.children) return
      const index = parent.children.indexOf(node)
      if (index >= 0) parent.children.splice(index, 1)
    },
  }
}

function directory(node: FakeNode) {
  return {
    kind: 'directory' as const,
    name: node.name,
    async *values() {
      for (const child of node.children ?? []) {
        yield child.kind === 'directory' ? directory(child) : fileHandle(child, node)
      }
    },
    async getDirectoryHandle(name: string) {
      const child = (node.children ?? []).find((candidate) => candidate.name === name)
      if (!child) throw new DOMException(`no such directory: ${name}`, 'NotFoundError')
      // A name that exists but is a file: the kind mismatch a browser reports
      // as a TypeError — `fileAt` maps it to "no file here".
      if (child.kind !== 'directory') throw new TypeError(`not a directory: ${name}`)
      return directory(child)
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      let child = (node.children ?? []).find((candidate) => candidate.name === name)
      if (!child) {
        // `create: true` makes the file, exactly as the browser would. Nothing
        // else may conjure one up.
        if (!(options?.create === true)) {
          throw new DOMException(`no such file: ${name}`, 'NotFoundError')
        }
        child = { name, kind: 'file' }
        node.children = [...(node.children ?? []), child]
      }
      // A name that exists but is a directory: the kind mismatch a browser
      // reports as TypeMismatchError (older Chrome) — `fileAt` maps it too.
      if (child.kind !== 'file') throw new DOMException(`not a file: ${name}`, 'TypeMismatchError')
      return fileHandle(child, node)
    },
    async removeEntry(name: string) {
      const children = node.children ?? []
      const index = children.findIndex((candidate) => candidate.name === name)
      if (index < 0) throw new DOMException(`no such entry: ${name}`, 'NotFoundError')
      children.splice(index, 1)
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

/** A fresh copy of the fixture, for tests that MUTATE it. */
function freshTree() {
  return directory(structuredClone(TREE))
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

describe('fileAt', () => {
  it('按路径把文件句柄找回来，根级与深层都行', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    expect(await folders.fileAt(root, '笔记.md')).toMatchObject({
      name: '笔记.md',
      path: '笔记.md',
      kind: 'file',
      handle: { kind: 'file', name: '笔记.md' },
    })
    expect(await folders.fileAt(root, '章节/一.md')).toMatchObject({
      name: '一.md',
      path: '章节/一.md',
      kind: 'file',
      handle: { kind: 'file', name: '一.md' },
    })
    expect(await folders.fileAt(root, '章节/上/序.md')).toMatchObject({
      name: '序.md',
      path: '章节/上/序.md',
      kind: 'file',
      handle: { kind: 'file', name: '序.md' },
    })
  })

  it('文件不在了（改名/删除）：返回 null，而不是抛给调用者', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    expect(await folders.fileAt(root, '没了.md')).toBeNull()
    expect(await folders.fileAt(root, '章节/没了.md')).toBeNull()
    expect(await folders.fileAt(root, '章节/上/没了.md')).toBeNull()
  })

  it('路径中间是文件、或最后一段是目录：也是 null（两种"种类不对"报错都走到）', async () => {
    const folders = fileSystemAccessFolders(apiWith(directory(TREE)))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    // 中间一段是文件：往文件里走目录 → 假 API 报 TypeError。
    expect(await folders.fileAt(root, '笔记.md/下面.md')).toBeNull()
    // 最后一段是目录：getFileHandle 拿到目录名 → 假 API 报 TypeMismatchError。
    expect(await folders.fileAt(root, '章节')).toBeNull()
  })
})

describe('createFile', () => {
  it('在目录里造出一个空文件，路径相对根；list 能看到它', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    const created = await folders.createFile(root, '', '新文档.md')

    expect(created).toMatchObject({
      name: '新文档.md',
      path: '新文档.md',
      kind: 'file',
      handle: { kind: 'file', name: '新文档.md' },
    })
    expect((await folders.list(root, '')).some((e) => e.path === '新文档.md')).toBe(true)
  })

  it('深层目录也能建', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    const created = await folders.createFile(root, '章节/上', '续.md')

    expect(created.path).toBe('章节/上/续.md')
    expect((await folders.list(root, '章节/上')).some((e) => e.path === '章节/上/续.md')).toBe(true)
  })

  it('名字已存在时浏览器静默返回已有的那个（查重是调用者的责任）', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    const created = await folders.createFile(root, '', '笔记.md')

    expect(created.name).toBe('笔记.md')
    expect((await folders.list(root, '')).length).toBe(4) // 没有多出一条
  })

  it('目录不存在就抛出去，调用者去提示', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    await expect(folders.createFile(root, '没有这个目录', 'x.md')).rejects.toThrow()
  })
})

describe('renameFile', () => {
  it('原地改名：旧路径找不到了，新路径找得到', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    await folders.renameFile(root, '笔记.md', '新名字.md')

    expect(await folders.fileAt(root, '笔记.md')).toBeNull()
    expect(await folders.fileAt(root, '新名字.md')).not.toBeNull()
  })

  it('深层文件同样改', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    await folders.renameFile(root, '章节/一.md', '二.md')

    expect(await folders.fileAt(root, '章节/一.md')).toBeNull()
    expect(await folders.fileAt(root, '章节/二.md')).not.toBeNull()
  })

  it('文件不在了就抛出去（调用者先查过重，也拦不住并发删除）', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    await expect(folders.renameFile(root, '没了.md', '别的.md')).rejects.toThrow()
  })
})

describe('removeFile', () => {
  it('删掉文件：list 不再列它，fileAt 找不到', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    await folders.removeFile(root, '笔记.md')

    expect(await folders.fileAt(root, '笔记.md')).toBeNull()
    expect((await folders.list(root, '')).some((e) => e.path === '笔记.md')).toBe(false)
  })

  it('深层文件同样删', async () => {
    const folders = fileSystemAccessFolders(apiWith(freshTree()))
    const root = await folders.pick()
    if (!root) throw new Error('expected a folder')

    await folders.removeFile(root, '章节/上/序.md')

    expect(await folders.fileAt(root, '章节/上/序.md')).toBeNull()
    expect((await folders.list(root, '章节/上')).length).toBe(0)
  })
})
