import { useCallback, useEffect, useState } from 'react'
import { visibleEntries } from '../core/fileTree'
import { folders, type FolderEntry, type FolderRoot } from '../platform/folder'
import { savedFolder } from '../platform/savedFolder'

/**
 * The folder the sidebar is showing, and the levels of it that have been read.
 *
 * Read ON DEMAND: opening a folder reads its top level, and a subdirectory is
 * read the first time it is expanded. A folder of a few hundred documents is
 * then one directory read rather than a walk of the whole tree, and the levels
 * the user never looked at cost nothing.
 *
 * Read levels are CACHED until `refresh`. There is no watching here — the
 * platform offers no change notifications — so a folder edited elsewhere shows
 * its old rows until the user asks for them again, which is the honest behaviour
 * rather than one that guesses when to re-read.
 */
export interface FileTreeState {
  root: FolderRoot | null
  /** The rows of a directory, or undefined while that level has not been read. */
  rows(path: string): FolderEntry[] | undefined
  isExpanded(path: string): boolean
  isBusy(path: string): boolean
  /**
   * True while the last session's folder is stored but needs one click to come
   * back (its permission does not survive the reload). See `savedFolder.ts`.
   */
  resumePrompt: boolean
  /** Shows the directory picker. `false` when the user declined or it failed. */
  openFolder(): Promise<boolean>
  /** One click: restore the last session's folder. `false` when denied. */
  resume(): Promise<boolean>
  /** Opens or closes one directory, reading it the first time. */
  toggle(path: string): void
  /** Re-reads every level that has been read. */
  refresh(): void
}

export function useFileTree(onError: (message: string) => void): FileTreeState {
  const [root, setRoot] = useState<FolderRoot | null>(null)
  const [children, setChildren] = useState<ReadonlyMap<string, FolderEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  /**
   * The folder the last session left, waiting for one click. Non-null while the
   * offer is on screen; `resumePrompt` is this presence.
   */
  const [offeredRoot, setOfferedRoot] = useState<FolderRoot | null>(null)

  const read = useCallback(
    async (folder: FolderRoot, path: string) => {
      setBusy((current) => new Set(current).add(path))
      try {
        const entries = await folders.list(folder, path)
        setChildren((current) => new Map(current).set(path, visibleEntries(entries)))
      } catch (error) {
        // Whatever was already read stays on screen: a folder that became
        // unreadable should not blank the tree the user was working in.
        onError(`读取文件夹失败：${String(error)}`)
      } finally {
        setBusy((current) => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
      }
    },
    [onError],
  )

  /** The tail every folder takes — picked now or restored from last time. */
  const applyRoot = useCallback(
    async (folder: FolderRoot) => {
      setRoot(folder)
      setChildren(new Map())
      setExpanded(new Set())
      await read(folder, '')
    },
    [read],
  )

  const openFolder = useCallback(async () => {
    try {
      const picked = await folders.pick()
      if (!picked) return false
      // Best effort: remembering the folder is a convenience, not part of the
      // pick — a full IndexedDB must neither fail the open nor leak a rejected
      // promise into the console.
      savedFolder.save(picked).catch(() => {})
      setOfferedRoot(null)
      await applyRoot(picked)
      return true
    } catch (error) {
      onError(`打开文件夹失败：${String(error)}`)
      return false
    }
  }, [applyRoot, onError])

  /**
   * The one click the sidebar offers while `resumePrompt` is true.
   *
   * NOTHING is awaited before `authorize`: `requestPermission` must run inside
   * the click's user activation, and an IndexedDB round-trip between the click
   * and the call could let that activation expire. The record was already read
   * at mount (`offeredRoot`), so the click goes straight to the gesture.
   */
  const resume = useCallback(async () => {
    const root = offeredRoot
    if (root === null) return false
    setOfferedRoot(null)
    try {
      if (!(await savedFolder.authorize(root))) return false
      await applyRoot(root)
      return true
    } catch (error) {
      onError(`恢复文件夹失败：${String(error)}`)
      return false
    }
  }, [applyRoot, offeredRoot, onError])

  // What the previous session left: restore it silently when the permission
  // survived, hold a one-click offer when it did not, and do nothing otherwise.
  // A storage failure is "nothing" — never an error to show on load.
  useEffect(() => {
    let cancelled = false
    void savedFolder
      .probe()
      .then((record) => {
        if (cancelled) return
        if (record.status === 'restorable') void applyRoot(record.root)
        else if (record.status === 'offered') setOfferedRoot(record.root)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [applyRoot])

  const toggle = useCallback(
    (path: string) => {
      const opening = !expanded.has(path)
      setExpanded((current) => {
        const next = new Set(current)
        if (opening) next.add(path)
        else next.delete(path)
        return next
      })
      // A level already read keeps its cache: collapsing and expanding again is
      // how someone looks at two things in turn, not a request to re-read.
      if (opening && root !== null && !children.has(path)) void read(root, path)
    },
    [children, expanded, read, root],
  )

  const refresh = useCallback(() => {
    if (root === null) return
    // The cache is NOT cleared first: a level that cannot be read this time keeps
    // the rows it had, instead of leaving a tree of "正在读取…" behind a failure.
    for (const path of new Set(['', ...children.keys()])) void read(root, path)
  }, [children, read, root])

  return {
    root,
    rows: (path) => children.get(path),
    isExpanded: (path) => expanded.has(path),
    isBusy: (path) => busy.has(path),
    resumePrompt: offeredRoot !== null,
    openFolder,
    resume,
    toggle,
    refresh,
  }
}
