/**
 * The file tree's right-click menu.
 *
 * The mirror of `TableMenu` for the folder tree: a row's commands live here —
 * 新建文件 on a directory row, 重命名 and 删除 on a document row — and nowhere
 * else. It is deliberately the same markup and styles as the table's menu
 * (`.table-menu`), so the app's two row menus cannot drift in look or feel.
 *
 * The component is presentational: it draws the items and reports which one was
 * picked. The mutation itself is the shell's (`useFileTree` + `core/fileTree`
 * naming helpers), the same road every other command takes.
 */
import { useEffect, useRef } from 'react'
import type { FolderEntry } from '../../platform/folder'

/** What the menu can be asked to do. */
export type TreeMenuCommand = 'createFile' | 'rename' | 'delete'

export interface TreeMenuState {
  /** Viewport position of the click that opened it. */
  x: number
  y: number
  entry: FolderEntry
}

interface TreeMenuProps {
  state: TreeMenuState
  onCommand: (command: TreeMenuCommand, entry: FolderEntry) => void
  onClose: () => void
}

export function TreeMenu({ state, onCommand, onClose }: TreeMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // A context menu closes the way menus do: a click anywhere outside, or Escape.
  // Both are on the document, because the menu sits at the click point rather
  // than inside a wrapper element to measure against. (Same contract as
  // `TableMenu`, and leaving through the same door keeps them from drifting.)
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !ref.current?.contains(target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  // A directory can take a new document at its contents; a document can be
  // renamed or removed. Renaming or removing a directory is deliberately absent
  // (`move()` has no directory form, and deletion skips the recycle bin).
  const items: { command: TreeMenuCommand; label: string; separator?: boolean }[] =
    state.entry.kind === 'directory'
      ? [{ command: 'createFile', label: '新建文件' }]
      : [
          { command: 'rename', label: '重命名' },
          { command: 'delete', label: '删除', separator: true },
        ]

  return (
    <div
      className="table-menu"
      role="menu"
      aria-label="文件"
      ref={ref}
      style={{ left: state.x, top: state.y }}
    >
      {items.map((item) => (
        <div key={item.command}>
          {item.separator && <div className="table-menu-sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => onCommand(item.command, state.entry)}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}