/**
 * The table's right-click menu.
 *
 * Typora keeps the row/column commands here — and puts the COLUMN commands
 * *only* here, with no shortcut at all — so this is the entry that has to exist
 * for "add a column" to be reachable
 * (`.scratch/table-ops/issues/03`). It is the first context menu in the app, so
 * it is also the first thing that has to answer "what is the caret in?" before it
 * can offer anything; the shell asks the kernel
 * (`EditorKernel.tableAtCaret`) and renders nothing when the answer is null.
 *
 * The component is presentational: it draws the items and reports which one was
 * picked. Turning that into a source edit is `core/tables.ts` + the shell's
 * `applyEdit`, the same road every other command takes.
 */
import { useEffect, useRef } from 'react'
import type { TableContext } from '../../core/tables'

/** What the menu can be asked to do. */
export type TableMenuCommand =
  | 'rowAbove'
  | 'rowBelow'
  | 'rowDelete'
  | 'columnLeft'
  | 'columnRight'
  | 'columnDelete'
  | 'delete'

export interface TableMenuState {
  /** Viewport position of the click that opened it. */
  x: number
  y: number
  context: TableContext
}

interface TableMenuProps {
  state: TableMenuState
  onCommand: (command: TableMenuCommand) => void
  onClose: () => void
}

interface TableMenuItem {
  command: TableMenuCommand
  label: string
  /** False when the table's own shape forbids it. */
  enabled: boolean
  /** A divider is drawn ABOVE this item. */
  separator?: boolean
}

/**
 * The menu's items, in the order they are drawn.
 *
 * `enabled` is decided from the table's shape, not from the caret alone: the
 * header row IS the table (deleting it would leave pipe-shaped paragraphs), the
 * `| --- |` row has no cells to add a column beside, and a table with one column
 * has none to delete.
 */
function menuItems(context: TableContext): TableMenuItem[] {
  const onRule = context.cell < 0
  const inHeader = context.line === context.headerLine
  return [
    { command: 'rowAbove', label: '在上方插入行', enabled: true },
    { command: 'rowBelow', label: '在下方插入行', enabled: true },
    {
      command: 'rowDelete',
      label: '删除本行',
      // The header and the rule row are the table's structure, not a row of it.
      enabled: !inHeader && !onRule,
      separator: true,
    },
    { command: 'columnLeft', label: '在左侧插入列', enabled: !onRule },
    { command: 'columnRight', label: '在右侧插入列', enabled: !onRule },
    {
      command: 'columnDelete',
      label: '删除本列',
      enabled: !onRule && context.columns > 1,
      separator: true,
    },
    { command: 'delete', label: '删除表格', enabled: true },
  ]
}

export function TableMenu({ state, onCommand, onClose }: TableMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // A context menu closes the way menus do: a click anywhere outside, or Escape.
  // Both are on the document, because the menu sits at the click point rather
  // than inside a wrapper element to measure against.
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

  return (
    <div
      className="table-menu"
      role="menu"
      aria-label="表格"
      ref={ref}
      style={{ left: state.x, top: state.y }}
    >
      {menuItems(state.context).map((item) => (
        <div key={item.command}>
          {item.separator && <div className="table-menu-sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={!item.enabled}
            onClick={() => onCommand(item.command)}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
