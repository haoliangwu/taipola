import type { CSSProperties } from 'react'
import type { FolderEntry } from '../../platform/folder'
import type { FileTreeState } from '../useFileTree'

interface FileTreeProps {
  tree: FileTreeState
  /** Path of the document on screen, relative to the folder root, or null. */
  activePath: string | null
  /** Whether this document has content that never reached its file. */
  hasDraft(entry: FolderEntry): boolean
  onOpen(entry: FolderEntry): void
}

interface RowsProps extends FileTreeProps {
  entries: readonly FolderEntry[]
  depth: number
}

/**
 * The depth travels as a CSS custom property rather than as a style attribute per
 * level: how far a row is indented is a stylesheet decision, and the component
 * only knows how deep it is.
 */
function indent(depth: number): CSSProperties {
  return { '--depth': depth } as CSSProperties
}

/**
 * The folder's documents, as rows.
 *
 * Only what the user opened: a directory renders its children when it is
 * expanded, and a document row is a plain button — clicking it replaces the
 * document on screen, which is why the row says which one is on screen already.
 */
export function FileTree({ tree, activePath, hasDraft, onOpen }: FileTreeProps) {
  if (tree.root === null) return null

  const top = tree.rows('')
  if (top === undefined) return <div className="outline-empty">正在读取…</div>
  if (top.length === 0) return <div className="outline-empty">这个文件夹里没有 Markdown 文档。</div>

  return (
    <ul className="outline-list file-tree">
      <Rows
        entries={top}
        depth={0}
        tree={tree}
        activePath={activePath}
        hasDraft={hasDraft}
        onOpen={onOpen}
      />
    </ul>
  )
}

function Rows({ entries, depth, tree, activePath, hasDraft, onOpen }: RowsProps) {
  return entries.map((entry) => {
    if (entry.kind === 'directory') {
      const open = tree.isExpanded(entry.path)
      const children = tree.rows(entry.path)
      return (
        <li key={entry.path}>
          <button
            type="button"
            className="outline-item tree-item"
            style={indent(depth)}
            aria-expanded={open}
            title={entry.name}
            onClick={() => tree.toggle(entry.path)}
          >
            <span className="tree-caret" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            {entry.name}
          </button>
          {open &&
            (children === undefined ? (
              <div className="outline-empty tree-note" style={indent(depth + 1)}>
                {tree.isBusy(entry.path) ? '正在读取…' : '读不到这个目录'}
              </div>
            ) : children.length === 0 ? (
              <div className="outline-empty tree-note" style={indent(depth + 1)}>
                没有 Markdown 文档
              </div>
            ) : (
              <ul className="tree-children">
                <Rows
                  entries={children}
                  depth={depth + 1}
                  tree={tree}
                  activePath={activePath}
                  hasDraft={hasDraft}
                  onOpen={onOpen}
                />
              </ul>
            ))}
        </li>
      )
    }

    const active = activePath === entry.path
    return (
      <li key={entry.path}>
        <button
          type="button"
          className={`outline-item tree-item${active ? ' is-active' : ''}`}
          style={indent(depth)}
          title={entry.name}
          aria-current={active ? 'true' : undefined}
          onClick={() => onOpen(entry)}
        >
          <span className="tree-name">{entry.name}</span>
          {hasDraft(entry) && (
            <span className="tree-badge" title="有还没写回文件的内容" aria-hidden="true" />
          )}
        </button>
      </li>
    )
  })
}
