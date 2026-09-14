/**
 * The folder memory: IndexedDB round-trip and the permission gate, against a
 * REAL IndexedDB (Chromium provides it) with a fake permission verdict.
 *
 * A real directory handle cannot be constructed in a test — the picker is a
 * system dialog — so the record travels as a plain clonable object and the
 * permission half is injected. Real handles are serializable by the same
 * structured clone the plain object goes through, which is exactly what
 * VS Code relies on for its recent folders.
 *
 * Each test builds its own named database so parallel files never meet.
 */
import { describe, expect, it } from 'vitest'
import { makeSavedFolder, type FolderPermission } from './savedFolder'

const fresh = (permission: FolderPermission) =>
  makeSavedFolder({ dbName: `taipola-test-${Math.random().toString(36).slice(2)}`, permission })

const verdicts = (query: 'granted' | 'prompt' | 'denied', request?: 'granted' | 'denied'): FolderPermission => ({
  query: async () => query,
  request: async () => request ?? (query === 'granted' ? 'granted' : 'denied'),
})

const ROOT = { name: '干草堆', handle: { kind: 'directory', name: '干草堆' } }

describe('savedFolder（文件夹记忆）', () => {
  it('没有记录：probe 是 none，什么也不恢复', async () => {
    const saved = fresh(verdicts('granted'))
    expect(await saved.probe()).toEqual({ status: 'none' })
  })

  it('存了之后 probe：授权还在 → restorable，名字和 handle 原样回来', async () => {
    const saved = fresh(verdicts('granted'))
    await saved.save(ROOT)
    const result = await saved.probe()
    expect(result).toEqual({
      status: 'restorable',
      root: { name: '干草堆', handle: { kind: 'directory', name: '干草堆' } },
      lastFile: null,
    })
  })

  it('存了之后 probe：授权要再问 → offered（按钮那条路）', async () => {
    const saved = fresh(verdicts('prompt'))
    await saved.save(ROOT)
    expect(await saved.probe()).toEqual({ status: 'offered', root: ROOT, lastFile: null })
  })

  it('探到 denied：记录被清掉（连权限之后恢复也不会再冒出来）', async () => {
    // 单靠 probe 自身看不出"清了没有"——denied 的 probe 两种实现都返回 none。
    // 让权限先 denied 再恢复：记录还在的话就会以 restorable 冒出来。
    let verdict: 'granted' | 'prompt' | 'denied' = 'denied'
    const saved = fresh({
      query: async () => verdict,
      request: async () => 'denied',
    })
    await saved.save(ROOT)
    expect(await saved.probe()).toEqual({ status: 'none' })
    verdict = 'granted'
    expect(await saved.probe()).toEqual({ status: 'none' })
  })

  it('授权失败（request 被拒）：authorize 返回 false，记录被清', async () => {
    const saved = fresh(verdicts('prompt', 'denied'))
    await saved.save(ROOT)
    expect(await saved.authorize(ROOT)).toBe(false)
    expect(await saved.probe()).toEqual({ status: 'none' })
  })

  it('authorize 成功：返回 true，记录保留（记忆还在，只是这次会话拿到了授权）', async () => {
    const saved = fresh(verdicts('prompt', 'granted'))
    await saved.save(ROOT)
    expect(await saved.authorize(ROOT)).toBe(true)
    expect(await saved.probe()).toEqual({ status: 'offered', root: ROOT, lastFile: null })
  })

  it('换文件夹：save 覆盖旧记录，probe 读到新名字', async () => {
    const saved = fresh(verdicts('prompt'))
    await saved.save(ROOT)
    await saved.save({ name: '另一个目录', handle: { kind: 'directory', name: '另一个目录' } })
    expect(await saved.probe()).toEqual({
      status: 'offered',
      root: { name: '另一个目录', handle: { kind: 'directory', name: '另一个目录' } },
      lastFile: null,
    })
  })

  it('记住文件：probe 把路径带回来（restorable 与 offered 两条路都带）', async () => {
    const granted = fresh(verdicts('granted'))
    await granted.save(ROOT)
    await granted.rememberFile('章节/一.md')
    expect(await granted.probe()).toEqual({
      status: 'restorable',
      root: ROOT,
      lastFile: '章节/一.md',
    })
    const offered = fresh(verdicts('prompt'))
    await offered.save(ROOT)
    await offered.rememberFile('章节/一.md')
    expect(await offered.probe()).toEqual({ status: 'offered', root: ROOT, lastFile: '章节/一.md' })
  })

  it('记住文件：点一次记一次，后来者覆盖', async () => {
    const saved = fresh(verdicts('granted'))
    await saved.save(ROOT)
    await saved.rememberFile('a.md')
    await saved.rememberFile('章节/b.md')
    expect(await saved.probe()).toEqual({
      status: 'restorable',
      root: ROOT,
      lastFile: '章节/b.md',
    })
  })

  it('换文件夹（save）：上次文件夹的记忆文件一并清掉，不带到新文件夹', async () => {
    const saved = fresh(verdicts('granted'))
    await saved.save(ROOT)
    await saved.rememberFile('a.md')
    await saved.save({ name: '另一个目录', handle: { kind: 'directory', name: '另一个目录' } })
    expect(await saved.probe()).toEqual({
      status: 'restorable',
      root: { name: '另一个目录', handle: { kind: 'directory', name: '另一个目录' } },
      lastFile: null,
    })
  })

  it('clear：文件夹和记忆的文件一起忘掉', async () => {
    const saved = fresh(verdicts('granted'))
    await saved.save(ROOT)
    await saved.rememberFile('a.md')
    await saved.clear()
    expect(await saved.probe()).toEqual({ status: 'none' })
  })

  it('clear 之后 probe 是 none', async () => {
    const saved = fresh(verdicts('granted'))
    await saved.save(ROOT)
    await saved.clear()
    expect(await saved.probe()).toEqual({ status: 'none' })
  })
})