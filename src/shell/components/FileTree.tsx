import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { editNameError, ensureMarkdownExtension, firstFreeName, parentOf } from '../../core/fileTree'
import type { FolderEntry } from '../../platform/folder'
import type { FileTreeState } from '../useFileTree'

/**
 * The tree's inline edit: either a new document being typed into a directory,
 * or an existing document being renamed. Which one, and where, is the shell's
 * half (`App` holds it for the menu); the INPUT is this component's.
 */
export type TreeEditing =
  | { kind: 'create'; dirPath: string }
  | { kind: 'rename'; entry: FolderEntry }

interface FileTreeProps {
  tree: FileTreeState
  /** Path of the document on screen, relative to the folder root, or null. */
  activePath: string | null
  /** Whether this document has content that never reached its file. */
  hasDraft(entry: FolderEntry): boolean
  onOpen(entry: FolderEntry): void
  /** The inline edit currently on screen, if any. */
  editing: TreeEditing | null
  onRowMenu(entry: FolderEntry, x: number, y: number): void
  /** A VALIDATED name (`.md` ensured, no collision). */
  onEditSubmit(name: string): void
  onEditCancel(): void
  onError(message: string): void
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
 * The rows' commands live on a right-click (`TreeMenu`).
 */
export function FileTree({
  tree,
  activePath,
  hasDraft,
  onOpen,
  editing,
  onRowMenu,
  onEditSubmit,
  onEditCancel,
  onError,
}: FileTreeProps) {
  // A new document is typed into a directory, so the directory has to be open to
  // show the input. Opening it here (the first toggle reads it) means the shell
  // never has to know the tree's expansion rules.
  useEffect(() => {
    if (editing?.kind === 'create' && editing.dirPath !== '') {
      if (!tree.isExpanded(editing.dirPath)) tree.toggle(editing.dirPath)
    }
  }, [editing, tree])

  if (tree.root === null) return null

  const top = tree.rows('')
  if (top === undefined) return <div className="outline-empty">正在读取…</div>
  if (top.length === 0) return <div className="outline-empty">这个文件夹里没有 Markdown 文档。</div>

  const props: RowsProps = {
    entries: top,
    depth: 0,
    tree,
    activePath,
    hasDraft,
    onOpen,
    editing,
    onRowMenu,
    onEditSubmit,
    onEditCancel,
    onError,
  }

  return (
    <ul className="outline-list file-tree">
      {editing?.kind === 'create' && editing.dirPath === '' && (
        <li className="tree-item tree-edit-row" style={indent(0)}>
          <EditRow
            initial={firstFreeName(names(tree.rows('') ?? []), 'untitled.md')}
            taken={names(tree.rows('') ?? [])}
            exclude={null}
            onSubmit={onEditSubmit}
            onCancel={onEditCancel}
            onError={onError}
          />
        </li>
      )}
      <Rows {...props} />
    </ul>
  )
}

function Rows({
  entries,
  depth,
  tree,
  activePath,
  hasDraft,
  onOpen,
  editing,
  onRowMenu,
  onEditSubmit,
  onEditCancel,
  onError,
}: RowsProps) {
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
            onContextMenu={(event) => {
              event.preventDefault()
              onRowMenu(entry, event.clientX, event.clientY)
            }}
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
                {editing?.kind === 'create' && editing.dirPath === entry.path && (
                <li className="tree-item tree-edit-row" style={indent(depth + 1)}>
                  <EditRow
                    initial={firstFreeName(names(children), 'untitled.md')}
                    taken={names(children)}
                    exclude={null}
                    onSubmit={onEditSubmit}
                    onCancel={onEditCancel}
                    onError={onError}
                  />
                </li>
              )}
                <Rows
                  entries={children}
                  depth={depth + 1}
                  tree={tree}
                  activePath={activePath}
                  hasDraft={hasDraft}
                  onOpen={onOpen}
                  editing={editing}
                  onRowMenu={onRowMenu}
                  onEditSubmit={onEditSubmit}
                  onEditCancel={onEditCancel}
                  onError={onError}
                />
              </ul>
            ))}
        </li>
      )
    }

    const active = activePath === entry.path
    // The row being renamed is replaced by its input; the document row keeps
    // nothing of itself while the user is typing.
    if (editing?.kind === 'rename' && editing.entry.path === entry.path) {
      const siblings = tree.rows(parentOf(entry.path)) ?? []
      return (
        <li key={entry.path} className="tree-item tree-edit-row" style={indent(depth)}>
          <EditRow
            initial={entry.name}
            taken={names(siblings)}
            exclude={entry.name}
            onSubmit={onEditSubmit}
            onCancel={onEditCancel}
            onError={onError}
          />
        </li>
      )
    }

    return (
      <li key={entry.path}>
        <button
          type="button"
          className={`outline-item tree-item${active ? ' is-active' : ''}`}
          style={indent(depth)}
          title={entry.name}
          aria-current={active ? 'true' : undefined}
          onClick={() => onOpen(entry)}
          onContextMenu={(event) => {
            event.preventDefault()
            onRowMenu(entry, event.clientX, event.clientY)
          }}
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

/** The sibling rows' names — what a new or renamed name must not collide with. */
function names(entries: readonly FolderEntry[]): ReadonlySet<string> {
  return new Set(entries.map((entry) => entry.name))
}

interface EditRowProps {
  initial: string
  /** The sibling names a new or renamed name must not collide with. */
  taken: ReadonlySet<string>
  /** The name being renamed (its own name is not a collision). */
  exclude: string | null
  onSubmit(name: string): void
  onCancel(): void
  onError(message: string): void
}

/**
 * The name input of an inline edit. Enter confirms through `core/fileTree`'s
 * naming rules (`.md` ensured, collisions refused — the input stays open with a
 * message); Escape or a click-away cancels. The shell never hears the text,
 * only the outcome.
 */
function EditRow({ initial, taken, exclude, onSubmit, onCancel, onError }: EditRowProps) {
  const [draft, setDraft] = useState(initial)
  const doneRef = useRef(false)

  // Enter, Escape and blur can race a submit (unmount fires blur): once an
  // outcome has been decided, the other two have nothing to decide.
  const once = (fn: () => void) => () => {
    if (doneRef.current) return
    doneRef.current = true
    fn()
  }

  const submit = () => {
    const name = ensureMarkdownExtension(draft.trim())
    // Renaming to the very same name is not a rename; cancel silently.
    if (exclude !== null && name === exclude) {
      onCancel()
      return
    }
    const error = editNameError(name, taken, exclude)
    if (error !== null) {
      doneRef.current = false
      onError(error)
      return
    }
    onSubmit(name)
  }

  return (
    <input
      className="tree-edit-input"
      type="text"
      aria-label={exclude === null ? '新文件名字' : '重命名为'}
      value={draft}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') once(submit)()
        else if (event.key === 'Escape') once(onCancel)()
      }}
      onBlur={once(onCancel)}
      onFocus={(event) => event.target.select()}
    />
  )
}