/**
 * The draft store, against the real localStorage.
 *
 * What is worth pinning: one slot per document (so two documents cannot eat each
 * other's unwritten work), the cap that keeps a long session from filling the
 * origin's storage, and the one-time adoption of the old single-record draft so
 * that upgrading does not silently drop what the user was writing.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Draft } from '../core/autosave'
import { DRAFT_SLOT_LIMIT, localStorageDraft } from './draft'

function draft(content: string, savedAt = 1): Draft {
  return { content, name: 'x.md', savedAt, root: null, path: null }
}

describe('localStorageDraft', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('一个文档一个槽：两份文档互不覆盖', () => {
    localStorageDraft.save('甲.md', { ...draft('甲的改动'), name: '甲.md' })
    localStorageDraft.save('乙.md', { ...draft('乙的改动'), name: '乙.md' })

    expect(localStorageDraft.load('甲.md')?.content).toBe('甲的改动')
    expect(localStorageDraft.load('乙.md')?.content).toBe('乙的改动')
  })

  it('没有这个槽时读回 null', () => {
    expect(localStorageDraft.load('从来没有过.md')).toBeNull()
  })

  it('has 说得出哪份文档还有没写回的内容', () => {
    localStorageDraft.save('甲.md', draft('甲的改动'))

    expect(localStorageDraft.has('甲.md')).toBe(true)
    expect(localStorageDraft.has('乙.md')).toBe(false)
  })

  it('坏掉的记录不算「有内容」', () => {
    localStorage.setItem('taipola:draft:坏.md', '{ 这不是 JSON')

    expect(localStorageDraft.has('坏.md')).toBe(false)
  })

  it('写入的槽成为「最后编辑的那个」', () => {
    localStorageDraft.save('甲.md', draft('甲'))
    localStorageDraft.save('乙.md', draft('乙'))

    expect(localStorageDraft.active()).toBe('乙.md')
  })

  it('删掉槽之后就找不到了，活跃指针也不再指着它', () => {
    localStorageDraft.save('甲.md', draft('甲'))
    localStorageDraft.remove('甲.md')

    expect(localStorageDraft.load('甲.md')).toBeNull()
    expect(localStorageDraft.active()).toBeNull()
  })

  it('删掉一个槽不会动到别的槽和指针', () => {
    localStorageDraft.save('甲.md', draft('甲'))
    localStorageDraft.save('乙.md', draft('乙'))
    localStorageDraft.remove('甲.md')

    expect(localStorageDraft.load('乙.md')?.content).toBe('乙')
    expect(localStorageDraft.active()).toBe('乙.md')
  })

  it('存进去的内容坏了就当没有（草稿是尽力而为的）', () => {
    localStorage.setItem('taipola:draft:坏.md', '{ 这不是 JSON')
    localStorage.setItem(
      'taipola:draft:缺内容.md',
      JSON.stringify({ name: 'x.md', savedAt: 1 }),
    )

    expect(localStorageDraft.load('坏.md')).toBeNull()
    expect(localStorageDraft.load('缺内容.md')).toBeNull()
  })

  it('老的记录里没有 root/path 时补成 null', () => {
    localStorage.setItem(
      'taipola:draft:老.md',
      JSON.stringify({ content: '老格式', name: '老.md', savedAt: 5 }),
    )

    expect(localStorageDraft.load('老.md')).toEqual({
      content: '老格式',
      name: '老.md',
      savedAt: 5,
      root: null,
      path: null,
    })
  })

  it('槽有上限：写满之后淘汰最旧的那一份', () => {
    for (let i = 0; i < DRAFT_SLOT_LIMIT; i++) {
      localStorageDraft.save(`第${i}.md`, { ...draft(`内容 ${i}`, i), name: `第${i}.md` })
    }
    // 第 0 份是最旧的，新的这份把它挤掉。
    localStorageDraft.save('新的.md', { ...draft('新内容', 9_999), name: '新的.md' })

    expect(localStorageDraft.load('第0.md')).toBeNull()
    expect(localStorageDraft.load('第1.md')?.content).toBe('内容 1')
    expect(localStorageDraft.load('新的.md')?.content).toBe('新内容')
  })

  it('更新已有的槽不会触发淘汰（上限数的是文档数）', () => {
    for (let i = 0; i < DRAFT_SLOT_LIMIT; i++) {
      localStorageDraft.save(`第${i}.md`, { ...draft(`内容 ${i}`, i), name: `第${i}.md` })
    }
    localStorageDraft.save('第0.md', { ...draft('第0又改了', 9_999), name: '第0.md' })

    expect(localStorageDraft.load('第0.md')?.content).toBe('第0又改了')
    expect(localStorageDraft.load('第5.md')?.content).toBe('内容 5')
  })

  /**
   * Before slots there was ONE global record at `taipola:draft`. Whoever is
   * writing in this editor right now has one of those; dropping it on upgrade
   * would look exactly like the editor losing their text.
   */
  it('老的单条记录被搬进它自己名字的槽，并成为活跃的那一个', () => {
    localStorage.setItem(
      'taipola:draft',
      JSON.stringify({ content: '升级前写的东西', name: '报告.md', savedAt: 7 }),
    )

    expect(localStorageDraft.active()).toBe('报告.md')
    expect(localStorageDraft.load('报告.md')?.content).toBe('升级前写的东西')
    // 老键被清掉，不会每分钟再被搬一次。
    expect(localStorage.getItem('taipola:draft')).toBeNull()
    expect(localStorageDraft.active()).toBe('报告.md')
  })
})
